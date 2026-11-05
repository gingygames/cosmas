/* ============================================================
   Parse messages copied from Discord (select messages → Ctrl+C).
   Handles the cozy layout ("Name — 30.10.2026 18:42", also split over
   three lines), compact layout ("[18:42] Name: text"), Czech and English
   relative days ("Dnes v 18:42", "Yesterday at 6:42 PM").
   ============================================================ */
'use strict';

(function (root) {
  const SEP = /^\s*[—–-]\s*$/;
  const TIME = /(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?\s*[Mm]\.?)?/;

  function parseStamp(text, now = new Date()) {
    if (!text) return null;
    const t = text.trim();
    const tm = t.match(TIME);
    if (!tm) return null;
    let hh = +tm[1]; const mm = +tm[2];
    if (tm[3]) { const pm = /p/i.test(tm[3]); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
    let d = null;
    const low = t.toLowerCase();
    if (/^(dnes|today)/.test(low)) d = new Date(now);
    else if (/^(včera|vcera|yesterday)/.test(low)) { d = new Date(now); d.setDate(d.getDate() - 1); }
    else {
      let m = t.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);            // 30.10.2026 / 30. 10. 2026
      if (m) d = new Date(+m[3], +m[2] - 1, +m[1]);
      else if ((m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/))) d = new Date(+m[3], +m[1] - 1, +m[2]);   // 10/30/2026 (US)
      else if ((m = t.match(/(\d{4})-(\d{2})-(\d{2})/))) d = new Date(+m[1], +m[2] - 1, +m[3]);
      else if (/^\[?\d{1,2}:\d{2}/.test(t) || /^\d{1,2}:\d{2}/.test(t)) d = new Date(now);       // time only
    }
    if (!d || isNaN(d)) return null;
    d.setHours(hh, mm, 0, 0);
    return d.getTime() / 1000;
  }

  const looksLikeStamp = s => !!s && s.length < 48 && TIME.test(s) &&
    (/\d{1,2}[./]\s*\d{1,2}[./]\s*\d{4}|\d{4}-\d{2}-\d{2}|dnes|včera|vcera|today|yesterday/i.test(s) || /^\s*\d{1,2}:\d{2}(\s*[AaPp]\.?[Mm]\.?)?\s*$/.test(s));

  /** text -> [{author, sent_at, body}] (body without the header lines) */
  function parseDiscordCopy(text, now = new Date()) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const out = [];
    let cur = null;
    const start = (author, stamp, firstLine = '') => {
      if (cur) out.push(cur);
      cur = { author: author.trim().replace(/^@/, ''), sent_at: parseStamp(stamp, now), body: firstLine ? [firstLine] : [] };
    };
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      let m;
      // compact: [18:42] Name: text      or   [30.10.2026 18:42] Name: text
      if ((m = ln.match(/^\s*\[([^\]]{3,40})\]\s*([^:]{1,40}):\s?(.*)$/)) && looksLikeStamp(m[1])) { start(m[2], m[1], m[3]); continue; }
      // cozy, one line: Name — 30.10.2026 18:42
      if ((m = ln.match(/^(.{1,40}?)\s+[—–]\s+(.+)$/)) && looksLikeStamp(m[2])) { start(m[1], m[2]); continue; }
      // cozy, three lines: Name / — / stamp
      if (ln.trim() && SEP.test(lines[i + 1] || '') && looksLikeStamp(lines[i + 2] || '')) { start(ln, lines[i + 2]); i += 2; continue; }
      // cozy, two lines: Name / stamp (some Discord builds)
      const nxt = (lines[i + 1] || '').replace(/^\s*[—–]\s*/, '');
      if (ln.trim() && ln.length < 40 && !TIME.test(ln) && /^\s*(\d|dnes|včera|vcera|today|yesterday)/i.test(nxt) && !/\s[—–]\s/.test(nxt) && looksLikeStamp(nxt)) {
        start(ln, (lines[i + 1] || '').replace(/^\s*[—–]\s*/, '')); i += 1; continue;
      }
      if (!cur) cur = { author: '', sent_at: null, body: [] };
      cur.body.push(ln);
    }
    if (cur) out.push(cur);
    return out.map(m => ({ ...m, body: m.body.join('\n').replace(/^\s+|\s+$/g, '') })).filter(m => m.body);
  }

  root.parseDiscordCopy = parseDiscordCopy;
  root.parseDiscordStamp = parseStamp;
  if (typeof module !== 'undefined') module.exports = { parseDiscordCopy, parseStamp };
})(typeof window !== 'undefined' ? window : globalThis);
