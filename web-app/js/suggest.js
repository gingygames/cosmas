/* ============================================================
   Smart suggestions – JS port of rpcatalog/suggest.py.
   Media rows are plain objects; M (store.js) gives kind / end time.
   ============================================================ */
'use strict';

const Suggest = (() => {
  const HOUR = 3600;
  const fmtGap = s => { s = Math.abs(s); return s < HOUR ? `${Math.floor(s / 60)} min` : `${(s / HOUR).toFixed(1).replace('.', ',')} h`; };
  const fmtClock = s => {
    s = Math.floor(Math.max(0, s || 0));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    const p = n => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
  };
  const sameDay = (a, b) => new Date(a * 1000).toDateString() === new Date(b * 1000).toDateString();

  function eventRange(ev, linked) {
    const s = ev.start_time, e = ev.end_time;
    if (s && e && e > s) return [s, e];
    if (s) return [s, s + 2 * HOUR];
    const spans = linked.filter(m => m.start_time).map(m => [m.start_time, M.end(m)]);
    if (spans.length) return [Math.min(...spans.map(x => x[0])), Math.max(...spans.map(x => x[1]))];
    return null;
  }

  function suggestForEvent(ev, all, linkedIds, linkTitles, maxItems = 60) {
    const linked = all.filter(m => linkedIds.has(m.id));
    const rng = eventRange(ev, linked);
    if (!rng) return [];
    const [s, e] = rng;
    const games = new Map();
    linked.forEach(m => games.set(m.game, (games.get(m.game) || 0) + 1));
    const mainGame = [...games.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const evTags = new Set(ev.tags || []);
    const out = [];
    for (const m of all) {
      if (linkedIds.has(m.id) || !m.start_time) continue;
      const ms = m.start_time, me = M.end(m) || m.start_time;
      let score = 0, offset = null; const reasons = [];
      const overlap = Math.min(e, me) - Math.max(s, ms);
      if (overlap > 0) {
        const shorter = Math.max(1, Math.min(e - s, me - ms));
        score = 60 + 40 * Math.min(1, overlap / shorter);
        reasons.push(`překrývá se (${fmtGap(overlap)})`);
        if (ms < s - 60 && M.kind(m) !== 'clip') { offset = s - ms; reasons.push(`událost začíná v čase ${fmtClock(offset)}`); }
      } else {
        const gap = ms >= e ? ms - e : s - me;
        if (gap < 6 * HOUR) { score = 45 * (1 - gap / (6 * HOUR)); reasons.push(`${fmtGap(gap)} ${ms >= e ? 'po' : 'před'}`); }
        else if (sameDay(ms, s)) { score = 5; reasons.push('stejný den'); }
      }
      if (score <= 0) continue;
      if (mainGame && m.game === mainGame) { score += 15; reasons.push('stejná hra'); } else if (mainGame) score -= 15;
      const shared = (m.tags || []).filter(t => evTags.has(t)).sort();
      if (shared.length) { score += 10 * shared.length; reasons.push(shared.map(t => '#' + t).join(' ')); }
      const others = linkTitles.get(m.id);
      if (others) { score -= 10; reasons.push('už v: ' + others.slice(0, 2).join(', ')); }
      if (score > 3) out.push({ media: m, score, reasons, offset });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, maxItems);
  }

  function eventsAt(events, t, pad = 2 * HOUR) {
    const ranked = [];
    for (const ev of events) {
      const s = ev.start_time;
      if (!s) continue;
      const e = ev.end_time || s + 2 * HOUR;
      if (s <= t && t <= e) ranked.push([0, e - s, ev]);
      else { const d = t < s ? s - t : t - e; if (d <= pad) ranked.push([1, d, ev]); }
    }
    ranked.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return ranked.map(r => r[2]);
  }

  function partOfDay(t) {
    const h = new Date(t * 1000).getHours();
    return h < 5 ? 'noc' : h < 12 ? 'dopoledne' : h < 18 ? 'odpoledne' : 'večer';
  }

  function clusterSessions(media, gapMinutes = 45, linkedIds = new Set()) {
    const items = media.filter(m => m.start_time && !linkedIds.has(m.id)).sort((a, b) => a.start_time - b.start_time);
    const groups = []; let cur = [], curEnd = null;
    for (const m of items) {
      if (cur.length && (m.start_time - curEnd > gapMinutes * 60 || m.game !== cur[0].game)) { groups.push(cur); cur = []; curEnd = null; }
      cur.push(m);
      curEnd = Math.max(curEnd || 0, M.end(m) || m.start_time);
    }
    if (cur.length) groups.push(cur);
    const p = n => String(n).padStart(2, '0');
    return groups.map(g => {
      const start = Math.min(...g.map(m => m.start_time));
      const end = Math.max(...g.map(m => M.end(m) || m.start_time));
      const d = new Date(start * 1000);
      return { title: `${g[0].game} – ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${partOfDay(start)}`, start, end, game: g[0].game, media: g };
    }).reverse();
  }

  return { suggestForEvent, eventsAt, clusterSessions, fmtClock };
})();
