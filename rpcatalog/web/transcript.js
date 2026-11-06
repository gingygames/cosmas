/* ============================================================
   Transcripts in the app: the "Přepis" section of a video (coverage strip, live progress,
   chapters, characters, proposals, the transcript itself) and the queue indicator in the
   channel column. The Přepisy page is in transcripts.js.
   ============================================================ */
'use strict';

const TR = {
  COLORS: { 'Já': 'var(--accent)', Discord: 'var(--blue)', Hra: 'var(--ok)', Obraz: 'var(--violet)', Zvuk: 'var(--text-2)' },
  PHASE: { queued: tr('Queued'), speech: tr('Speech'), vision: tr('Picture'), chapters: tr('Chronicle'), paused: tr('Paused'),
    done: tr('Done'), error: tr('Error'), skipped: tr('Interrupted'), canceled: tr('Canceled') },
  KIND: { event: ['calendar-plus', tr('Event')], character: ['user-round-plus', tr('Character')], place: ['map-pin-plus', tr('Place')], faction: ['shield-plus', tr('Faction')] },
  /** Display name of a speaker / track; the stored names ('Já', 'Hra', 'Obraz', 'Zvuk' + optional suffix) stay Czech. */
  label(s) {
    const [w, ...rest] = (s || '').split(' ');
    const L = { 'Já': tr('Me'), Hra: tr('Game'), Obraz: tr('Picture'), Zvuk: tr('Audio') }[w];
    return L ? [L, ...rest].join(' ') : s;
  },
  queue: null,
  _subs: new Set(),
  color(s) { return TR.COLORS[(s || '').split(' ')[0]] || 'var(--text-2)'; },
  on(fn) { TR._subs.add(fn); return () => TR._subs.delete(fn); },
  play(id, t) { API.call('media.play', { id, offset: Math.max(0, (t || 0) - 1) }); },
  eta(s) { return s == null ? '' : s < 90 ? tr('~{s} s left', { s: Math.max(5, Math.round(s / 5) * 5) }) : tr('~{time} left', { time: fmt.durHuman(s) }); },
  fold(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); },
  running(st) { return !!st && ['queued', 'speech', 'vision', 'chapters', 'paused'].includes(st.phase); },
  async refreshQueue() { TR.queue = await API.call('analysis.queue').catch(() => TR.queue); TR._subs.forEach(fn => fn({ phase: 'queue' })); AIQ.update(); },
};

API.on('analysis', ev => {
  if (ev.queue) TR.queue = ev.queue;
  if (ev.phase === 'done' && ev.id) { const m = App.mediaById.get(ev.id); if (m) m.transcribed = true; }
  for (const fn of [...TR._subs]) fn(ev);
  AIQ.update();
});

/* ---------------- queue indicator in the channel column ---------------- */
const AIQ = {
  el: null,
  mount() {
    const ch = document.querySelector('#channels');
    if (!ch) return false;
    if (this.el && this.el.isConnected) return true;
    this.el = h('.aiq.hidden', { onclick: e => { if (!e.target.closest('button')) App.go('transcripts'); } },
      h('.aiq-ic', icon('audio-lines')),
      h('.grow', { style: { minWidth: 0 } }, h('.aiq-t.ellipsis'), h('.aiq-s.ellipsis'), h('.aiq-bar', h('i'))),
      h('button.npb.aiq-pause', { onclick: () => API.call('analysis.pause', { paused: !(TR.queue && TR.queue.paused) }).then(TR.refreshQueue) }, icon('pause')));
    ch.insertBefore(this.el, ch.querySelector('.userbar'));
    return true;
  },
  update() {
    if (!this.mount()) return;
    const q = TR.queue;
    const cur = q && q.current, waiting = q ? q.queue.length : 0;
    const show = !!(q && (cur || waiting || q.paused));
    this.el.classList.toggle('hidden', !show);
    if (!show) return;
    const paused = q.paused || q.auto_paused;
    this.el.classList.toggle('paused', !!paused);
    const pct = cur && cur.p != null ? Math.round(cur.p * 100) : 0;
    $('.aiq-t', this.el).textContent = paused ? (q.auto_paused ? tr('Paused – {game} running', { game: q.auto_paused }) : tr('Transcriptions paused'))
      : cur ? `${TR.PHASE[cur.phase] || tr('Transcript')} · ${pct} %` : tr('Transcripts · {n} queued', { n: waiting });
    $('.aiq-s', this.el).textContent = cur ? [cur.title, TR.eta(cur.eta), waiting ? tr('+{n} queued', { n: waiting }) : ''].filter(Boolean).join(' · ') : '';
    $('.aiq-bar i', this.el).style.width = pct + '%';
    $('.aiq-pause', this.el).replaceChildren(icon(q.paused ? 'play' : 'pause'));
    $('.aiq-pause', this.el).title = q.paused ? tr('Resume') : tr('Pause transcriptions');
  },
};
(function waitForShell() { if (AIQ.mount()) TR.refreshQueue(); else setTimeout(waitForShell, 400); })();

/* ---------------- proposals review (also used by the Přepisy page) ---------------- */
function proposalCard(p, { onDone } = {}) {
  const d = p.data;
  const [ic, label] = TR.KIND[p.kind] || ['sparkles', p.kind];
  const name = h('input.input.bare.prop-name', { value: d.title || d.name || '', onkeydown: e => e.stopPropagation() });
  const text = h('textarea.input.prop-text', { rows: 2, onkeydown: e => e.stopPropagation() }, d.text || '');
  const who = (d.chars || []).map(id => App.charsById.get(id)).filter(Boolean);
  const unknown = (d.who || []).filter(n => !who.some(c => TR.fold(c.name).startsWith(TR.fold(n).split(' ')[0])));
  const card = h('.tprop.' + p.kind,
    h('.prop-head', h('span.prop-kind', icon(ic), label), name,
      h('button.btn.sm.ghost', { title: tr('Play from here'), onclick: () => TR.play(p.media_id, d.t) }, icon('play'),
        fmt.clock(d.t) + (d.t_end && p.kind === 'event' ? '–' + fmt.clock(d.t_end) : ''))),
    text,
    p.kind === 'event' ? h('.row.wrap.small', { style: { gap: '6px' } },
      d.place ? h('span.chip', icon('map-pin'), d.place, d.place_id ? null : h('span.faint', ' ' + tr('(new)'))) : null,
      who.map(c => charChip(c)), unknown.map(n => h('span.chip.faint', { title: tr('Unknown character') }, icon('user'), n))) : null,
    h('.row.prop-act',
      h('.grow'),
      h('button.btn.sm.ghost', { onclick: async () => { await API.call('analysis.proposal_reject', { id: p.id }); card.classList.add('gone'); onDone && onDone(p, false); } }, icon('x'), tr('Reject')),
      h('button.btn.sm.primary', { onclick: async () => {
        const edits = { text: text.value.trim() };
        edits[p.kind === 'event' ? 'title' : 'name'] = name.value.trim();
        const r = await API.call('analysis.proposal_accept', { id: p.id, edits });
        card.classList.add('gone');
        const nm = { name: name.value.trim() };
        toast(p.kind === 'event' ? tr('Event “{name}” added to the chronicle', nm)
          : p.kind === 'character' ? tr('Character “{name}” added to the chronicle', nm)
          : p.kind === 'place' ? tr('Place “{name}” added to the chronicle', nm)
          : p.kind === 'faction' ? tr('Faction “{name}” added to the chronicle', nm)
          : tr('“{name}” added to the chronicle', nm), 'ok',
          r ? { label: tr('Open'), onClick: () => App.go({ event: 'events', character: 'characters', place: 'places', faction: 'factions' }[r.kind], { id: r.id }) } : null);
        App.refresh('events', 'chars', 'media');
        onDone && onDone(p, true);
      } }, icon('check'), tr('Accept'))));
  return card;
}

async function reviewProposals(mediaId) {
  const props = await API.call('analysis.proposals', { media_id: mediaId });
  const body = h('.prop-list');
  const left = h('span.faint');
  const count = () => { left.textContent = tr('{n} left', { n: body.querySelectorAll('.tprop:not(.gone)').length }); };
  const order = { event: 0, character: 1, place: 2, faction: 3 };
  props.sort((a, b) => (order[a.kind] - order[b.kind]) || (a.data.t - b.data.t)).forEach(p => body.appendChild(proposalCard(p, { onDone: count })));
  count();
  modal({ title: tr('Cosmas AI suggestions'), icon: 'sparkles', xwide: true,
    body: h('div', h('.small.muted', { style: { marginBottom: '10px' } },
      tr('From the transcript of this recording. Accepting creates an event linked to the video (with time, place and characters) or a new character, place or faction. You can edit the text and name before accepting.'), ' ', left), body) });
}
window.reviewProposals = reviewProposals;

/* ---------------- the Přepis section of one video ---------------- */
function transcriptSection(m) {
  const st = { data: null, q: '', hidden: new Set(), charFilter: null, limit: 400, sel: null, state: null };
  const status = h('.trs-pills');
  const actions = h('button.btn.sm.ghost.icon', { title: tr('More options'), onclick: e => moreMenu(e) }, icon('ellipsis'));
  const cov = h('.trs-cov');
  const covInfo = h('.trs-covinfo.tiny.faint');
  const selBar = h('.trs-selbar.hidden');
  const prog = buildProgress();
  const meta = h('.trs-meta');
  const search = h('input.input', { placeholder: tr('Search the transcript…'), onkeydown: e => e.stopPropagation(),
    oninput: debounce(e => { st.q = e.target.value; st.limit = 400; renderList(); }, 180) });
  const chips = h('.row.wrap.trs-chips');
  const count = h('.tiny.faint.trs-count');
  const list = h('.trs-list');
  const empty = h('.trs-empty.hidden');
  const root = h('.trs',
    h('.section-title', icon('captions'), tr('Transcript'), h('.line'), status, actions),
    empty, h('.trs-covwrap', cov, selBar, covInfo), prog.el, meta,
    h('.trs-tools', search, chips, count), list);

  const off = TR.on(ev => {
    if (!root.isConnected) { off(); return; }
    if (ev.phase === 'queue') { prog.update(st.state); return; }
    if (ev.id !== m.id) return;
    st.state = ev;
    prog.update(ev);
    if (ev.imported || ['done', 'error', 'skipped', 'canceled'].includes(ev.phase)) load();
    else renderPills();
  });
  const offPlayer = App.on('player', () => { if (!root.isConnected) { offPlayer(); return; } drawPlayhead(); });

  async function load() {
    const d = await API.call('analysis.get', { id: m.id }).catch(() => null);
    if (!d || !root.isConnected) return;
    st.data = d;
    if (!st.state && d.state) st.state = d.state;
    prog.update(st.state);
    renderPills(); renderEmpty(); renderCoverage(); renderMeta(); renderChips(); renderList();
  }

  const start = async (opts) => (await AISetup.ensure()) && API.call('analysis.start', { ids: [m.id], ...opts }).then(q => { TR.queue = q; TR._subs.forEach(fn => fn({ phase: 'queue' })); AIQ.update(); }).catch(() => {});

  function moreMenu(e) {
    const d = st.data || {};
    const has = what => d.done && d.done[what];
    menu(e, [
      { label: tr('Transcribe speech'), icon: 'audio-lines', onClick: () => start({ speech: true, chapters: false }) },
      { label: tr('Describe the picture in conversations'), icon: 'scan-eye', onClick: () => start({ speech: true, vision: true, chapters: false }) },
      { label: tr('Cosmas AI – chapters, events, suggestions'), icon: 'sparkles', onClick: () => start({ speech: true, chapters: true }) },
      { label: tr('Everything (speech, picture, chronicle)'), icon: 'wand-sparkles', onClick: () => start({ speech: true, vision: true, chapters: true }) },
      { sep: true },
      { label: tr('Full transcript as text'), icon: 'file-text', disabled: !d.timeline, onClick: () => API.call('analysis.open_timeline', { id: m.id }) },
      { label: tr('Transcription queue and settings'), icon: 'settings-2', onClick: () => App.go('transcripts') },
      { sep: true },
      { label: tr('Delete and redo'), icon: 'rotate-ccw', submenu: [
        { label: tr('Speech'), onClick: () => redo('speech') }, { label: tr('Picture'), onClick: () => redo('vision') },
        { label: tr('Chronicle (chapters, suggestions)'), onClick: () => redo('chapters') }, { label: tr('Everything'), danger: true, onClick: () => redo('all') }] },
    ].filter(Boolean));
    void has;
  }
  async function redo(what) {
    const q = { speech: () => tr('Delete the speech transcript of this video?'), vision: () => tr('Delete the picture descriptions of this video?'),
      chapters: () => tr('Delete the chronicle of this video?'), all: () => tr('Delete all results of this video?') }[what]();
    if (!await confirmDialog(q,
      tr('The results will then be recreated with the current settings.'), { danger: true, okLabel: tr('Delete and reprocess') })) return;
    await API.call('analysis.delete', { id: m.id, what });
    await load();
    start({ speech: true, vision: what === 'vision' || what === 'all' ? true : false, chapters: what === 'chapters' || what === 'all' ? true : undefined });
  }

  /* ---- status pills */
  function renderPills() {
    const d = st.data;
    if (!d) return;
    const rows = d.rows, nSpeech = rows.filter(r => r.speaker !== 'Obraz').length, nImg = rows.length - nSpeech;
    const pill = (ic, text, cls, title) => h('span.trs-pill' + (cls ? '.' + cls : ''), { title }, icon(ic), text);
    clear(status).append(
      nSpeech ? pill('audio-lines', nSpeech, 'ok', trn(nSpeech, '{n} utterance', '{n} utterances')) : null,
      nImg ? pill('scan-eye', nImg, 'vio', trn(nImg, '{n} described frame', '{n} described frames')) : null,
      d.coverage.chapters.length ? pill('book-open', d.coverage.chapters.length, 'acc', trn(d.coverage.chapters.length, '{n} chapter', '{n} chapters')) : null,
      d.proposals ? h('span.trs-pill.hot', { title: tr('Cosmas AI suggestions'), onclick: () => reviewProposals(m.id).then(load) }, icon('sparkles'), d.proposals) : null);
  }

  function renderEmpty() {
    const d = st.data;
    const nothing = !d.rows.length && !TR.running(st.state);
    empty.classList.toggle('hidden', !nothing);
    if (!nothing) return;
    clear(empty).append(
      h('.small.muted', d.available ? tr('Speech transcription (microphone, game, Discord), picture descriptions in conversations and Cosmas AI, which turns it into chapters, events and suggestions for the database. Runs on your PC or through a paid service (Transcripts → Where AI runs).')
        : tr('Speech transcription on this PC is not available here – choose a paid service for speech in Transcripts → Where AI runs.')),
      d.available ? h('.row.wrap',
        h('button.btn.sm.primary', { onclick: () => start({ speech: true }) }, icon('audio-lines'), tr('Transcribe speech')),
        h('button.btn.sm', { onclick: () => start({ speech: true, vision: true }) }, icon('scan-eye'), tr('Speech + picture')),
        h('.tiny.faint', tr('~{time} speech', { time: fmt.durHuman((m.duration || 0) / 45) }))) : null);
  }

  /* ---- live progress (updated in place, fixed height) */
  function buildProgress() {
    const el = h('.trs-prog.hidden');
    const steps = h('.trs-steps');
    const bar = h('.trs-bar', h('i'));
    const pct = h('span.trs-pct');
    const msg = h('.trs-msg.ellipsis');
    const eta = h('.trs-eta.tiny.faint');
    const btns = h('.row.trs-btns');
    el.append(h('.row', steps, h('.grow'), pct), bar, h('.row', msg, h('.grow'), eta), btns);
    let lastKey = '';
    return { el, update(ev) {
      const q = TR.queue;
      const cur = q && q.current && q.current.id === m.id ? q.current : null;
      const waiting = q && q.queue.find(j => j.id === m.id);
      const run = cur || waiting || (ev && TR.running(ev) && ev.phase !== 'queued');
      el.classList.toggle('hidden', !run);
      if (!run) return;
      const job = cur || waiting || {};
      const phase = cur ? (q.paused || q.auto_paused ? 'paused' : cur.phase) : 'queued';
      const order = ['speech', 'vision', 'chapters'].filter(p => p === 'speech' ? job.speech !== false : job[p === 'vision' ? 'vision' : 'chapters'] || (p === 'vision' && job.vision_ranges));
      const key = order.join() + '|' + (cur ? cur.phase : 'q');
      if (key !== lastKey) {
        lastKey = key;
        const ai = order.indexOf(cur ? cur.phase : '');
        clear(steps).append(order.map((p, i) => h('span.trs-step' + (i < ai ? '.done' : i === ai ? '.on' : ''), icon({ speech: 'audio-lines', vision: 'scan-eye', chapters: 'sparkles' }[p]), TR.PHASE[p])));
        clear(btns).append(
          h('button.btn.sm.ghost', { onclick: () => API.call('analysis.pause', { paused: !(TR.queue && TR.queue.paused) }).then(TR.refreshQueue) }, icon('pause'), tr('Pause / resume')),
          cur ? h('button.btn.sm.ghost', { title: tr('Stop this video – finished parts are kept'), onclick: () => API.call('analysis.skip') }, icon('skip-forward'), tr('Skip'))
            : h('button.btn.sm.ghost', { onclick: () => API.call('analysis.remove', { key: waiting.key }).then(TR.refreshQueue) }, icon('x'), tr('Remove from queue')),
          h('.grow'),
          h('button.btn.sm.ghost', { onclick: () => App.go('transcripts') }, icon('list-ordered'), tr('Queue')));
      }
      el.classList.toggle('paused', phase === 'paused');
      const p = cur && cur.p != null ? cur.p : 0;
      $('i', bar).style.width = Math.round(p * 100) + '%';
      pct.textContent = cur ? Math.round(p * 100) + ' %' : '';
      msg.textContent = phase === 'paused' ? (q.auto_paused ? tr('Paused – {game} is running', { game: q.auto_paused }) : tr('Paused'))
        : cur ? (cur.msg || tr('Working…')) : tr('Queued (position {n})', { n: q.queue.indexOf(waiting) + 1 });
      eta.textContent = cur ? [TR.eta(cur.eta), cur.speed ? tr('{x}× faster than real time', { x: Math.round(cur.speed) }) : ''].filter(Boolean).join(' · ') : '';
    } };
  }

  /* ---- coverage strip: what is transcribed / seen / summarised over the whole video */
  function conversations(rows, gap = 20) {
    const spans = [];
    for (const r of rows) {
      if (r.speaker === 'Obraz') continue;
      const a = r.t, b = r.t_end || r.t + 3;
      if (spans.length && a - spans[spans.length - 1][1] <= gap) spans[spans.length - 1][1] = Math.max(spans[spans.length - 1][1], b);
      else spans.push([a, b]);
    }
    return spans;
  }
  function renderCoverage() {
    const d = st.data, dur = d.duration || m.duration || 1;
    const pc = t => (Math.max(0, Math.min(dur, t)) / dur * 100) + '%';
    const lanes = [];
    const cv = d.coverage;
    const speakers = [...new Set([...(d.speakers || []), ...Object.keys(cv.speech_chunks)])];
    for (const sp of speakers) {
      const lane = h('.cov-lane', { 'data-label': sp });
      const done = new Set(cv.speech_chunks[sp] || []);
      const n = Math.ceil(dur / cv.chunk_s);
      for (let k = 0; k < n; k++) lane.appendChild(h(done.has(k) ? 'b.cov-done' : 'b.cov-todo', { style: { left: pc(k * cv.chunk_s), width: `calc(${pc(Math.min(cv.chunk_s, dur - k * cv.chunk_s))} + 1px)` } }));
      for (const r of d.rows) if (r.speaker === sp) lane.appendChild(h('i', { style: { left: pc(r.t), width: `max(2px, ${pc((r.t_end || r.t + 2) - r.t)})`, background: TR.color(sp) } }));
      lanes.push(h('.cov-row', h('span.cov-lbl', { style: { color: TR.color(sp) } }, TR.label(sp)), lane));
    }
    const img = h('.cov-lane');
    const seen = d.frames.filter(f => !f.skip), skipped = d.frames.filter(f => f.skip);
    const spans = conversations(d.rows);
    const covered = t => d.frames.some(f => Math.abs(f.t - t) < 25);
    for (const [a, b] of spans) {        // conversations without any look at the picture yet
      if (!covered((a + b) / 2) && !d.frames.some(f => f.t >= a && f.t <= b)) img.appendChild(h('b.cov-todo', { style: { left: pc(a), width: `max(2px, ${pc(b - a)})` }, title: tr('Conversation without picture description') }));
    }
    for (const f of skipped) img.appendChild(h('i.cov-skip', { style: { left: pc(f.t) } }));
    for (const f of seen) img.appendChild(h('i.cov-tick' + (f.names.length ? '.named' : '') + (f.faces.length ? '.face' : ''), { style: { left: pc(f.t) } }));
    lanes.push(h('.cov-row', h('span.cov-lbl', { style: { color: TR.color('Obraz') } }, tr('Picture')), img));
    const chap = h('.cov-lane.chap');
    cv.chapters.forEach((c, i) => chap.appendChild(h('b.cov-ch' + (i % 2 ? '.alt' : ''), { style: { left: pc(c.t), width: pc((c.t_end || c.t + 600) - c.t) }, title: `${fmt.clock(c.t)} ${c.title}` }, c.title)));
    lanes.push(h('.cov-row', h('span.cov-lbl', tr('Chronicle')), chap));
    const ph = h('.cov-ph');
    const selEl = h('.cov-sel.hidden');
    const area = h('.cov-area', lanes, ph, selEl);
    clear(cov).append(area);
    drawPlayhead();
    // info line
    const speechDone = speakers.reduce((a, sp) => a + (cv.speech_chunks[sp] || []).length, 0), speechAll = speakers.length * Math.ceil(dur / cv.chunk_s);
    const convS = spans.reduce((a, [x, y]) => a + (y - x), 0);
    const convSeen = spans.filter(([a, b]) => d.frames.some(f => f.t >= a && f.t <= b)).reduce((a, [x, y]) => a + (y - x), 0);
    clear(covInfo).append(
      h('span', icon('audio-lines'), ' ' + tr('speech {pct} %', { pct: speechAll ? Math.round(speechDone / speechAll * 100) : 0 })),
      h('span', icon('scan-eye'), ' ' + tr('picture in conversations {pct} % · {seen} described, {skipped} unchanged', { pct: convS ? Math.round(convSeen / convS * 100) : 0, seen: seen.length, skipped: skipped.length })),
      d.frames.some(f => f.names.length) ? h('span', icon('tag'), ' ' + tr('name tags {n}×', { n: d.frames.filter(f => f.names.length).length })) : null,
      d.frames.some(f => f.faces.length) ? h('span', icon('scan-face'), ' ' + tr('faces {n}', { n: d.frames.reduce((a, f) => a + f.faces.length, 0) })) : null,
      h('span.grow'), h('span', tr('drag to select a section')));
    // interaction: hover = time, click = play, drag = select a range for picture processing
    const tAt = e => { const r = area.getBoundingClientRect(); return Math.max(0, Math.min(dur, (e.clientX - r.left - 58) / (r.width - 58) * dur)); };
    area.onmousemove = e => { area.title = fmt.clock(tAt(e)); };
    area.onmousedown = e => {
      if (e.button !== 0) return;
      const a = tAt(e); let b = a, moved = false;
      const mv = ev => { b = tAt(ev); moved = Math.abs(b - a) > dur / 300; if (moved) showSel(Math.min(a, b), Math.max(a, b)); };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); if (!moved) TR.play(m.id, a); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      e.preventDefault();
    };
    function showSel(a, b) {
      st.sel = [a, b];
      selEl.classList.remove('hidden');
      selEl.style.left = `calc(58px + (100% - 58px) * ${a / dur})`; selEl.style.width = `calc((100% - 58px) * ${(b - a) / dur})`;
      renderSelBar();
    }
  }
  function renderSelBar() {
    if (!st.sel) { selBar.classList.add('hidden'); return; }
    const [a, b] = st.sel;
    const step = h('select.input.sm', [4, 8, 15, 30, 60].map(s => h('option', { value: s, selected: s === 8 ? 'selected' : null }, tr('every {s} s', { s }))));
    const n = () => Math.ceil((b - a) / +step.value);
    const info = h('span.tiny.faint');
    const upd = () => { info.textContent = trn(n(), '{n} frame · ~{time}', '{n} frames · ~{time}', { time: fmt.durHuman(n() * 3.2) }); };
    step.onchange = upd; upd();
    selBar.classList.remove('hidden');
    clear(selBar).append(icon('scan-eye'), h('b', `${fmt.clock(a)}–${fmt.clock(b)}`), step, info, h('.grow'),
      h('button.btn.sm.ghost', { onclick: () => TR.play(m.id, a) }, icon('play')),
      h('button.btn.sm.primary', { onclick: () => { start({ speech: false, vision: false, chapters: false, ranges: [[a, b, +step.value]] }); st.sel = null; renderSelBar(); $('.cov-sel', cov)?.classList.add('hidden'); toast(tr('Section added to the queue')); } }, tr('Describe picture')),
      h('button.btn.sm.ghost.icon', { onclick: () => { st.sel = null; renderSelBar(); $('.cov-sel', cov)?.classList.add('hidden'); } }, icon('x')));
  }
  function drawPlayhead() {
    const ph = $('.cov-ph', cov);
    if (!ph) return;
    const p = App.player || {};
    const on = p.media_id === m.id && m.duration;
    ph.classList.toggle('hidden', !on);
    if (on) ph.style.left = `calc(58px + (100% - 58px) * ${Math.min(1, (p.pos || 0) / m.duration)})`;
  }

  /* ---- summary, chapters, characters, proposals */
  function renderMeta() {
    const d = st.data, cv = d.coverage;
    clear(meta);
    if (d.proposals) meta.appendChild(h('.trs-banner', icon('sparkles'),
      h('.grow', h('b', trn(d.proposals, 'Cosmas AI suggests {n} entry', 'Cosmas AI suggests {n} entries')),
        h('.tiny.faint', tr('events, new characters, places and factions from this recording'))),
      h('button.btn.sm.primary', { onclick: () => reviewProposals(m.id).then(load) }, tr('Review suggestions'))));
    if (cv.summary && cv.summary.text) {
      meta.appendChild(h('details.trs-sum', { open: true }, h('summary', icon('book-open'), tr('Recording summary')),
        h('p', cv.summary.text),
        (cv.summary.moments || []).length ? h('ul', cv.summary.moments.map(x => h('li', x))) : null));
    }
    if (cv.chapters.length) {
      meta.appendChild(h('details.trs-chaps', h('summary', icon('list'), `${tr('Chapters')} · ${cv.chapters.length}`),
        cv.chapters.map(c => h('.trs-chap-row', { onclick: () => { jumpTo(c.t); TR.play(m.id, c.t); } },
          h('span.kbd', fmt.clock(c.t)), h('.grow', h('b', c.title), h('.tiny.faint', c.summary))))));
    }
    if ((d.groups || []).length) {
      meta.appendChild(h('details.trs-groups', { open: true },
        h('summary', icon('users-round'), `${tr('Unrecognised characters')} · ${trn(d.groups.length, '{n} group by appearance', '{n} groups by appearance')}`),
        h('.tiny.faint', { style: { margin: '4px 0 6px' } }, tr('Same clothes and hair = most likely the same character. One answer tags the whole group and creates references for other videos.')),
        d.groups.map(g => h('.trs-group',
          h('.trs-group-imgs', g.urls.filter(Boolean).map(u => h('img', { src: u, loading: 'lazy' }))),
          h('.grow', { style: { minWidth: 0 } }, h('b', tr('{n}× in the recording', { n: g.members.length })),
            g.names.length ? h('.tiny.faint.ellipsis', tr('name tags: {list}', { list: g.names.map(([n, k]) => `${n} (${k}×)`).join(', ') })) : null),
          h('button.btn.sm', { onclick: async () => {
            const ids = await pickCharacters([], { title: g.names.length ? tr('Who is it? (name tag: {name})', { name: g.names[0][0] }) : tr('Who is it?'), multi: false });
            const id = Array.isArray(ids) ? ids[0] : ids;
            if (!id) return;
            const n = await API.call('analysis.group_label', { media_id: m.id, members: g.members, character_id: id });
            toast(tr('{n}× tagged as {name} – references saved', { n, name: App.charsById.get(id)?.name || tr('character') }));
            load();
          } }, icon('user-search'), tr('Who is it…'))))));
    }
    const byChar = new Map();
    for (const x of d.mentions) { if (!byChar.has(x.character_id)) byChar.set(x.character_id, []); byChar.get(x.character_id).push(x); }
    if (byChar.size) {
      meta.appendChild(h('.trs-chars', h('span.tiny.faint', tr('In the recording:')),
        [...byChar.entries()].map(([id, xs]) => [App.charsById.get(id), xs]).filter(([c]) => c).sort((a, b) => b[1].length - a[1].length).map(([c, xs]) =>
          h('span.chip' + (st.charFilter === c.id ? '.on' : ''), { title: tr('{n}× – {kinds}. Click = only these places', { n: xs.length, kinds: [...new Set(xs.map(x => ({ speech: tr('mentioned in speech'), seen: tr('name tag / confirmed in picture'), look: tr('recognised by appearance'), ai: tr('from the chronicle') }[x.kind])))].join(', ') }),
            onclick: () => { st.charFilter = st.charFilter === c.id ? null : c.id; renderMeta(); renderList(); } },
          avatar(c, 18), c.name, h('span.faint', xs.length), xs.some(x => x.kind === 'seen') ? icon('eye') : null,
          xs.some(x => x.kind === 'look') ? icon('scan-face') : null))));
    }
  }
  function jumpTo(t) {
    const row = [...list.querySelectorAll('[data-t]')].find(r => +r.dataset.t >= t);
    if (row) list.scrollTop = row.offsetTop - list.offsetTop - 8;
  }

  /* ---- speaker chips + transcript list */
  function renderChips() {
    const rows = st.data.rows;
    const speakers = [...new Set(rows.map(r => r.speaker))];
    clear(chips).append(speakers.map(s => h('span.chip' + (st.hidden.has(s) ? '' : '.on'), {
      onclick: () => { st.hidden.has(s) ? st.hidden.delete(s) : st.hidden.add(s); renderChips(); renderList(); },
    }, h('span.dot', { style: { background: TR.color(s) } }), `${TR.label(s)} · ${rows.filter(r => r.speaker === s).length}`)));
  }
  function nameMarker() {
    // characters found in this video: highlight their names (Czech endings) in the text
    const stems = [];
    for (const id of new Set(st.data.mentions.map(x => x.character_id))) {
      const c = App.charsById.get(id);
      if (!c) continue;
      for (const n of [c.name, ...(c.aliases || '').split(',')]) for (const w of (n || '').split(/\s+/)) {
        if (w.length < 3 || w[0] !== w[0].toUpperCase()) continue;
        let f = TR.fold(w); if (f.length >= 4 && 'aeiouy'.includes(f.slice(-1))) f = f.slice(0, -1);
        stems.push([f, c]);
      }
    }
    return stems;
  }
  function richText(text, stems, words) {
    const parts = [];
    const re = /[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu;
    for (const tok of text.match(re) || []) {
      const f = TR.fold(tok);
      const hit = /^\p{Lu}/u.test(tok) && stems.find(([s]) => f.startsWith(s) && f.length - s.length <= 4);
      if (hit) parts.push(h('a.trs-name', { style: { color: hit[1].color }, onclick: e => { e.stopPropagation(); App.go('characters', { id: hit[1].id }); } }, tok));
      else if (words.length && words.some(w => f.includes(w))) parts.push(h('mark', tok));
      else parts.push(tok);
    }
    return parts;
  }
  function renderList() {
    const d = st.data;
    if (!d) return;
    const top = list.scrollTop;
    const words = st.q.trim() ? TR.fold(st.q).split(/\s+/).filter(Boolean) : [];
    const near = st.charFilter ? d.mentions.filter(x => x.character_id === st.charFilter).map(x => x.t) : null;
    const frames = new Map(d.frames.map(f => [Math.round(f.t * 10), f]));
    const shown = d.rows.filter(r => !st.hidden.has(r.speaker) && (!near || near.some(t => Math.abs(t - r.t) <= 20))
      && words.every(w => TR.fold(r.text).includes(w)));
    const stems = nameMarker();
    const chapters = d.coverage.chapters;
    const frag = document.createDocumentFragment();
    let lastEnd = null, ci = 0;
    for (const r of shown.slice(0, st.limit)) {
      while (!words.length && !near && ci < chapters.length && chapters[ci].t <= r.t) {
        frag.appendChild(h('.trs-chap', h('span.kbd', fmt.clock(chapters[ci].t)), h('b', chapters[ci].title)));
        ci++;
      }
      if (lastEnd != null && !words.length && r.t - lastEnd >= 60) frag.appendChild(h('.trs-gap', tr('pause {time}', { time: fmt.durHuman(r.t - lastEnd) })));
      lastEnd = Math.max(lastEnd || 0, r.t_end || r.t);
      const f = r.speaker === 'Obraz' ? frames.get(Math.round(r.t * 10)) : null;
      frag.appendChild(h('.trs-row' + (f ? '.img' : ''), { 'data-t': r.t, onclick: () => TR.play(m.id, r.t) },
        h('span.kbd', fmt.clock(r.t)),
        h('span.trs-who', { style: { color: TR.color(r.speaker) } }, TR.label(r.speaker)),
        h('.trs-body',
          f && f.thumb ? h('img.trs-thumb', { src: f.thumb, loading: 'lazy' }) : null,
          h('span.trs-text', richText(r.text, stems, words)),
          f && (f.names.length || f.faces.length || (f.persons || []).length) ? h('.trs-extra',
            (f.persons || []).map(p => personChip(r.t, p)),
            f.names.filter(n => !(f.persons || []).some(p => p.name === n)).map(n => h('span.trs-tag', icon('tag'), n)),
            f.faces.map(x => h('img.trs-face', { src: x.url, title: tr('Face – click: use as character portrait'), onclick: e => { e.stopPropagation(); facePortrait(r.t, x); } }))) : null),
        h('.trs-act',
          h('button.npb', { title: tr('Moment here'), onclick: async e => { e.stopPropagation(); await API.call('bm.create', { media_id: m.id, t: r.t, title: r.text.slice(0, 70) }); toast(tr('Moment added')); } }, icon('bookmark-plus')))));
    }
    if (shown.length > st.limit) frag.appendChild(h('button.btn.sm.ghost', { onclick: () => { st.limit += 600; renderList(); } }, tr('Show more ({n})', { n: shown.length - st.limit })));
    if (!shown.length && d.rows.length) frag.appendChild(h('.faint.small', { style: { padding: '12px' } }, tr('Nothing matches the filter.')));
    clear(list).appendChild(frag);
    list.classList.toggle('hidden', !d.rows.length);
    list.scrollTop = top;
    count.textContent = (words.length || near) ? trn(shown.length, '{n} result', '{n} results') : '';
    $('.trs-tools', root).classList.toggle('hidden', !d.rows.length);
  }
  /** One person on a frame: crop + who it is (name tag, confirmed, or recognised by clothing/hair/face). */
  function personChip(t, p) {
    const hit = p.hit, c = hit && App.charsById.get(hit.character_id);
    const how = hit ? { tag: ['tag', tr('name tag above the head')], user: ['user-check', tr('confirmed by you')], look: ['scan-face', tr('by appearance')] }[hit.source] : null;
    const label = c ? c.name : p.name || tr('unknown');
    return h('span.trs-person' + (hit ? '.' + hit.source : '.unknown'), {
      title: [label, how ? how[1] + (hit.source === 'look' ? ' ' + tr('(match {pct} %)', { pct: Math.round(hit.score * 100) }) : '') : tr('not recognised – click and say who it is'),
        p.look].filter(Boolean).join('\n'),
      onclick: e => { e.stopPropagation(); personMenu(e, t, p, c); },
    }, p.url ? h('img', { src: p.url, loading: 'lazy' }) : null,
      h('span.trs-pname', how ? icon(how[0]) : icon('circle-help'), h('span.ellipsis', label),
        hit && hit.source === 'look' ? h('span.trs-score', Math.round(hit.score * 100) + ' %') : null));
  }
  function personMenu(e, t, p, c) {
    const label = async (cid, verdict) => {
      await API.call('analysis.person_label', { media_id: m.id, t, idx: p.idx, character_id: cid, verdict });
      toast(verdict === 'yes' ? tr('Saved – the character will be recognised elsewhere by this reference') : tr('Saved – not them here'));
      load();
    };
    const pick = async () => {
      const ids = await pickCharacters([], { title: tr('Who is it?'), multi: false });
      const id = Array.isArray(ids) ? ids[0] : ids;
      if (id) label(id, 'yes');
    };
    menu(e, [
      c && p.hit.source === 'look' ? { label: tr('Yes, it is {name}', { name: c.name }), icon: 'check', onClick: () => label(c.id, 'yes') } : null,
      c ? { label: tr('It is not {name}', { name: c.name }), icon: 'x', onClick: () => label(c.id, 'no') } : null,
      { label: c ? tr('It is someone else…') : tr('Who is it…'), icon: 'user-search', onClick: pick },
      c ? { sep: true } : null,
      c ? { label: tr('Open character {name}', { name: c.name }), icon: 'user', onClick: () => App.go('characters', { id: c.id }) } : null,
    ].filter(Boolean));
  }
  async function facePortrait(t, face) {
    const ids = await pickCharacters([], { title: tr('Whose face is this?'), multi: false });
    const id = Array.isArray(ids) ? ids[0] : ids;
    if (!id) return;
    await API.call('analysis.face_portrait', { media_id: m.id, t, file: face.file, character_id: id });
    toast(tr('Portrait set')); App.refresh('chars');
  }

  load();
  return root;
}
window.transcriptSection = transcriptSection;

/** "Zmínky v záznamech" for a character / place / faction page. */
function mentionsSection(type, id, { title = tr('In recordings (transcript)') } = {}) {
  const box = h('.ch-sec.trm', h('.section-title', icon('captions'), title, h('.line')), h('.faint.small', tr('Loading…')));
  API.call('analysis.entity_mentions', { type, id }).then(groups => {
    if (!box.isConnected && !groups) return;
    box.lastChild.remove();
    if (!groups.length) { box.appendChild(h('.faint.small', tr('Has not appeared in any transcribed recording yet.'))); return; }
    const total = groups.reduce((a, g) => a + g.hits.length, 0);
    $('.section-title', box).insertBefore(h('span.faint', total), $('.line', box));
    for (const g of groups) {
      box.appendChild(h('.trm-media',
        h('.trm-head', { onclick: () => App.go('library', { select: [g.media.id] }) }, g.media.thumb ? h('img', { src: g.media.thumb }) : null,
          h('.grow', h('.ellipsis', g.media.name), h('.tiny.faint', fmt.dt(g.media.start)))),
        h('.trm-hits', g.hits.slice(0, 12).map(x => h('.trm-hit', { onclick: () => TR.play(g.media.id, x.t - 2), title: x.text || '' },
          h('span.kbd', fmt.clock(x.t)), icon({ speech: 'audio-lines', seen: 'eye', look: 'scan-face', ai: 'sparkles' }[x.kind] || 'dot'),
          h('span.ellipsis', x.text || { seen: tr('name tag / confirmed in picture'), look: tr('recognised by appearance'), speech: tr('mention in speech'), ai: tr('from the chronicle') }[x.kind] || ''))),
          g.hits.length > 12 ? h('.tiny.faint', tr('+ {n} more', { n: g.hits.length - 12 })) : null)));
    }
  }).catch(() => {});
  return box;
}
window.mentionsSection = mentionsSection;

/** "Vzhled v záznamech": how a character looked over time (references from name tags and confirmations). */
function looksSection(charId) {
  const box = h('.ch-sec.trl', h('.section-title', icon('scan-face'), tr('Appearance in recordings'), h('.line')), h('.faint.small', tr('Loading…')));
  const render = async () => {
    const refs = await API.call('analysis.char_looks', { id: charId }).catch(() => []);
    while (box.childNodes.length > 1) box.lastChild.remove();
    if (!refs.length) {
      box.appendChild(h('.faint.small', tr('No references yet. They are created automatically when a name tag is visible above the character in a video, or when you confirm who a character on a frame is – then the character is recognised even without a name tag (clothes, hair, face).')));
      return;
    }
    box.appendChild(h('.tiny.faint', { style: { marginBottom: '6px' } },
      trn(refs.length, '{n} reference · the character is recognised by it even without a name tag. Newer references take priority (clothes change).', '{n} references · the character is recognised by them even without a name tag. Newer references take priority (clothes change).')));
    box.appendChild(h('.trl-grid', refs.slice().reverse().map(r => h('.trl-item', {
      title: [fmt.dt(r.abs_time) || r.media, r.look, r.source === 'tag' ? tr('from a name tag') : tr('confirmed by you')].filter(Boolean).join('\n'),
      onclick: () => TR.play(r.media_id, r.t),
      oncontextmenu: e => menu(e, [
        { label: tr('Play this moment'), icon: 'play', onClick: () => TR.play(r.media_id, r.t) },
        { label: tr('Not this character – remove reference'), icon: 'trash-2', danger: true, onClick: async () => { await API.call('analysis.ref_delete', { id: r.id }); render(); } },
      ]),
    }, r.url ? h('img', { src: r.url, loading: 'lazy' }) : icon('user'),
      h('span.trl-src', icon(r.source === 'tag' ? 'tag' : 'user-check'), r.face ? icon('smile') : null),
      h('span.trl-date', r.abs_time ? fmt.date(r.abs_time) : '')))));
  };
  render();
  return box;
}
window.looksSection = looksSection;
