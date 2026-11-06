"""Smart suggestions: which recordings belong to an event, and grouping into events."""
import datetime as dt
from collections import Counter

from .i18n import lang, tr

HOUR = 3600.0


def fmt_gap(seconds):
    seconds = abs(seconds)
    if seconds < HOUR:
        return f"{int(seconds // 60)} min"
    h = f"{seconds / HOUR:.1f} h"
    return h.replace(".", ",") if lang() == "cs" else h


def event_range(event, linked_media):
    """Time window of an event: its own start/end, else the span of its references."""
    s, e = event.get("start_time"), event.get("end_time")
    if s and e and e > s:
        return s, e
    if s:
        return s, s + 2 * HOUR
    spans = [(m.start_time, m.end_time) for m in linked_media if m.start_time]
    if spans:
        return min(a for a, _ in spans), max(b for _, b in spans)
    return None


def suggest_for_event(event, all_media, linked_ids, link_titles, max_items=60):
    """Rank media that probably belong to the event.

    linked_ids:  ids already linked to this event (excluded)
    link_titles: {media_id: [titles of other events it is linked to]}
    Returns list of dicts: media, score, reasons, offset.
    """
    linked = [m for m in all_media if m.id in linked_ids]
    rng = event_range(event, linked)
    if not rng:
        return []
    s, e = rng
    games = Counter(m.game for m in linked)
    main_game = games.most_common(1)[0][0] if games else None
    ev_tags = set(event.get("tags") or [])

    out = []
    for m in all_media:
        if m.id in linked_ids or not m.start_time:
            continue
        ms, me = m.start_time, m.end_time or m.start_time
        score, reasons, offset = 0.0, [], None
        overlap = min(e, me) - max(s, ms)
        if overlap > 0:
            shorter = max(1.0, min(e - s, me - ms))
            score = 60 + 40 * min(1.0, overlap / shorter)
            reasons.append(tr("overlaps ({gap})", gap=fmt_gap(overlap)))
            if ms < s - 60 and m.effective_kind != "clip":
                offset = s - ms
                reasons.append(tr("event starts at {time}", time=fmt_clock(offset)))
        else:
            gap = (ms - e) if ms >= e else (s - me)
            if gap < 6 * HOUR:
                score = 45 * (1 - gap / (6 * HOUR))
                reasons.append(tr("{gap} after" if ms >= e else "{gap} before", gap=fmt_gap(gap)))
            elif dt.date.fromtimestamp(ms) == dt.date.fromtimestamp(s):
                score = 5
                reasons.append(tr("same day"))
        if score <= 0:
            continue
        if main_game and m.game == main_game:
            score += 15
            reasons.append(tr("same game"))
        elif main_game:
            score -= 15
        shared = ev_tags & set(m.tags or [])
        if shared:
            score += 10 * len(shared)
            reasons.append(" ".join("#" + t for t in sorted(shared)))
        others = link_titles.get(m.id)
        if others:
            score -= 10
            reasons.append(tr("already in: {events}", events=", ".join(others[:2])))
        if score > 3:
            out.append({"media": m, "score": score, "reasons": reasons, "offset": offset})
    out.sort(key=lambda x: -x["score"])
    return out[:max_items]


def events_at(events, t, pad=2 * HOUR):
    """Events ranked by how well they match a real-world moment t."""
    ranked = []
    for ev in events:
        s, e = ev.get("start_time"), ev.get("end_time")
        if not s:
            continue
        e = e or s + 2 * HOUR
        if s <= t <= e:
            ranked.append((0, e - s, ev))
        else:
            dist = s - t if t < s else t - e
            if dist <= pad:
                ranked.append((1, dist, ev))
    ranked.sort(key=lambda x: (x[0], x[1]))
    return [r[2] for r in ranked]


def fmt_clock(seconds):
    seconds = int(max(0, seconds or 0))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def part_of_day(t):
    h = dt.datetime.fromtimestamp(t).hour
    if h < 5:
        return tr("night")
    if h < 12:
        return tr("morning")
    if h < 18:
        return tr("afternoon")
    return tr("evening")


def cluster_sessions(media, gap_minutes=45, linked_ids=frozenset()):
    """Group recordings into play sessions (gap > gap_minutes splits them).

    Only media not yet linked to any event are used. Returns a list of proposals
    {title, start, end, game, media: [...]} newest first."""
    items = sorted((m for m in media if m.start_time and m.id not in linked_ids),
                   key=lambda m: m.start_time)
    groups, cur, cur_end = [], [], None
    for m in items:
        if cur and (m.start_time - cur_end > gap_minutes * 60 or m.game != cur[0].game):
            groups.append(cur)
            cur, cur_end = [], None
        cur.append(m)
        cur_end = max(cur_end or 0, m.end_time or m.start_time)
    if cur:
        groups.append(cur)
    out = []
    for g in groups:
        start = min(m.start_time for m in g)
        end = max(m.end_time or m.start_time for m in g)
        day = dt.datetime.fromtimestamp(start).strftime("%d.%m.%Y")
        out.append({
            "title": f"{g[0].game} – {day} {part_of_day(start)}",
            "start": start, "end": end, "game": g[0].game, "media": g,
        })
    out.reverse()
    return out
