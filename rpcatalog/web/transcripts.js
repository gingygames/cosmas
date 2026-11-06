/* ============================================================
   Přepisy – queue, PC load, Kronikář AI proposals and all transcript settings
   ============================================================ */
'use strict';

(() => {
let root, tab = 'queue', timer = null, offs = [];
let flushSettings = null;   // settings changed within the debounce, saved together (see renderSettings)
const hist = { gpu: [], cpu: [] };

function mount(r, params) {
  root = r;
  if (params && params.tab) tab = params.tab;
  Shell.header({ icon: 'captions', title: tr('transcripts'), topic: tr('speech, picture and Cosmas AI – on your PC or through a paid service') });
  render();
  offs.push(TR.on(ev => { if (tab === 'queue' && ev.phase !== undefined) renderQueueLive(); }));
  timer = setInterval(pollStats, 2000);
  pollStats();
}
function unmount() { if (flushSettings) flushSettings(); clearInterval(timer); timer = null; offs.forEach(f => f()); offs = []; }

function render() {
  if (flushSettings) flushSettings();
  clear(root);
  const tabs = h('.seg.trp-tabs', [['queue', 'list-ordered', tr('Queue and performance')], ['proposals', 'sparkles', tr('Suggestions')], ['ai', 'cpu', tr('Where AI runs')], ['settings', 'sliders-horizontal', tr('Settings')]].map(([k, ic, label]) =>
    h('button' + (tab === k ? '.on' : ''), { onclick: () => { tab = k; render(); } }, icon(ic), label, k === 'proposals' ? h('span.trp-badge#trp-pbadge') : null)));
  const body = h('.trp-body');
  root.append(h('.trp', h('.row.trp-top', tabs), body));
  updateBadge();
  if (tab === 'queue') renderQueue(body);
  else if (tab === 'proposals') renderProposals(body);
  else if (tab === 'ai') AISetup.render(body);
  else renderSettings(body);
}
async function updateBadge() {
  const ov = await API.call('analysis.overview').catch(() => null);
  const b = $('#trp-pbadge', root);
  if (b && ov) { b.textContent = ov.proposals || ''; b.classList.toggle('hidden', !ov.proposals); }
}

/* ---------------- queue + PC load ---------------- */
function renderQueue(body) {
  body.append(h('.trp-cols',
    h('.trp-main', h('#trp-current'), h('#trp-queue'), h('#trp-overview'), h('#trp-history')),
    h('.trp-side', h('#trp-monitor.card'))));
  renderQueueLive();
  renderOverview();
}

function jobChips(j) {
  return h('.row.wrap', { style: { gap: '4px' } },
    j.speech ? h('span.trp-what', icon('audio-lines'), tr('speech')) : null,
    j.vision ? h('span.trp-what', icon('scan-eye'), tr('picture')) : null,
    j.vision_ranges ? h('span.trp-what', icon('scan-eye'), tr('section {from}–{to}', { from: fmt.clock(j.vision_ranges[0][0]), to: fmt.clock(j.vision_ranges[0][1]) })) : null,
    j.chapters ? h('span.trp-what', icon('sparkles'), tr('chronicle')) : null);
}

function renderQueueLive() {
  const q = TR.queue;
  const cur = $('#trp-current', root), qu = $('#trp-queue', root), hi = $('#trp-history', root);
  if (!cur || !q) return;
  // current job: built once per job, then only numbers change (no jumping)
  const c = q.current;
  if (!c) {
    cur.dataset.key = '';
    clear(cur).append(h('.card.trp-idle', icon(q.paused ? 'pause' : 'circle-check'),
      h('div', h('b', q.paused ? tr('Transcriptions are paused') : q.queue.length ? tr('Starting…') : tr('Nothing is being processed')),
        h('.small.faint', q.paused ? tr('The queue is waiting for you to resume.') : tr('Add videos from the Library (right-click → Transcript) or use “Transcribe missing” below.'))),
      h('.grow'), q.paused ? h('button.btn.primary', { onclick: () => API.call('analysis.pause', { paused: false }).then(TR.refreshQueue) }, icon('play'), tr('Resume')) : null));
  } else {
    if (cur.dataset.key !== c.key) {
      cur.dataset.key = c.key;
      const m = App.mediaById.get(c.id);
      clear(cur).append(h('.card.trp-cur',
        h('.trp-cur-th', m && m.thumb ? h('img', { src: m.thumb }) : icon('film')),
        h('.grow', { style: { minWidth: 0 } },
          h('.row', h('.trp-cur-title.ellipsis', c.title), h('.grow'), h('span.trp-pct')),
          h('.trp-steps'),
          h('.trs-bar.big', h('i')),
          h('.row', h('.trp-msg.ellipsis.small'), h('.grow'), h('.trp-eta.tiny.faint')),
          h('.row.wrap', { style: { marginTop: '8px' } },
            h('button.btn.sm.trp-pausebtn', { onclick: () => API.call('analysis.pause', { paused: !TR.queue.paused }).then(TR.refreshQueue) }),
            h('button.btn.sm.ghost', { title: tr('Finished parts are kept; it continues next time'), onclick: () => API.call('analysis.skip') }, icon('skip-forward'), tr('Skip video')),
            h('button.btn.sm.ghost', { onclick: () => App.go('library', { select: [c.id] }) }, icon('panel-right-open'), tr('Open video'))))));
    }
    const paused = q.paused || q.auto_paused;
    const order = ['speech', 'vision', 'chapters'];
    clear($('.trp-steps', cur)).append(order.filter(p => p === 'speech' ? c.speech : p === 'vision' ? (c.vision || c.vision_ranges) : c.chapters).map(p =>
      h('span.trs-step' + (order.indexOf(p) < order.indexOf(c.phase) ? '.done' : p === c.phase ? '.on' : ''), icon({ speech: 'audio-lines', vision: 'scan-eye', chapters: 'sparkles' }[p]), TR.PHASE[p])));
    const pct = Math.round((c.p || 0) * 100);
    $('.trs-bar i', cur).style.width = pct + '%';
    $('.trp-pct', cur).textContent = pct + ' %';
    $('.trp-msg', cur).textContent = paused ? (q.auto_paused ? tr('Paused – the game {game} is running', { game: q.auto_paused }) : tr('Paused')) : (c.msg || '…');
    $('.trp-eta', cur).textContent = [TR.eta(c.eta), c.speed ? tr('{x}× faster than real time', { x: Math.round(c.speed) }) : '', c.started ? tr('running for {time}', { time: fmt.durHuman((Date.now() / 1000) - c.started) }) : ''].filter(Boolean).join(' · ');
    $('.trp-pausebtn', cur).replaceChildren(icon(q.paused ? 'play' : 'pause'), q.paused ? tr('Resume') : tr('Pause'));
    $('.trp-cur', cur).classList.toggle('paused', !!paused);
  }
  // waiting jobs
  clear(qu);
  if (q.queue.length) {
    qu.append(h('.section-title', icon('list-ordered'), `${tr('Queued')} · ${q.queue.length}`, h('.line'),
      h('span.tiny.faint', `~${fmt.durHuman(q.queue.reduce((a, j) => a + estimate(j), 0))}`)));
    q.queue.forEach((j, i) => {
      const m = App.mediaById.get(j.id);
      qu.appendChild(h('.trp-q', { draggable: 'true',
        ondragstart: e => { e.dataTransfer.setData('text/x-job', j.key); },
        ondragover: e => e.preventDefault(),
        ondrop: e => { e.preventDefault(); const k = e.dataTransfer.getData('text/x-job'); if (k && k !== j.key) API.call('analysis.move', { key: k, index: i }).then(TR.refreshQueue); } },
        h('span.trp-n', i + 1), h('.trp-q-th', m && m.thumb ? h('img', { src: m.thumb }) : null),
        h('.grow', { style: { minWidth: 0 } }, h('.ellipsis', j.title), h('.row', jobChips(j), h('span.tiny.faint', tr('{duration} of recording · ~{time}', { duration: fmt.durHuman(j.duration), time: fmt.durHuman(estimate(j)) })))),
        h('button.btn.sm.ghost.icon', { title: tr('Move to the front of the queue'), disabled: i === 0, onclick: () => API.call('analysis.move', { key: j.key, index: 0 }).then(TR.refreshQueue) }, icon('arrow-up-to-line')),
        h('button.btn.sm.ghost.icon', { title: tr('Remove'), onclick: () => API.call('analysis.remove', { key: j.key }).then(TR.refreshQueue) }, icon('x'))));
    });
  }
  // finished
  clear(hi);
  if (q.history.length) {
    hi.append(h('.section-title', icon('history'), tr('Finished'), h('.line')));
    q.history.slice(0, 15).forEach(x => hi.appendChild(h('.trp-h.' + x.phase, { onclick: () => App.go('library', { select: [x.id] }) },
      icon({ done: 'circle-check', error: 'circle-alert', skipped: 'circle-pause' }[x.phase] || 'circle'),
      h('.grow.ellipsis', x.title), h('span.tiny.faint.ellipsis', { style: { maxWidth: '45%' } }, x.msg || ''), h('span.tiny.faint', fmt.time(x.finished)))));
  }
}

/** Rough minutes on an RTX-class GPU: speech ~45× realtime, picture ~1 frame per 3 s, chronicle ~40 s per 15 min. */
function estimate(j) {
  const d = j.duration || 0;
  let s = j.speech ? d / 45 : 0;
  if (j.vision) s += d * 0.75 / 8 * 0.5 * 3.2;
  if (j.vision_ranges) s += j.vision_ranges.reduce((a, [x, y, st]) => a + (y - x) / st * 3.2, 0);
  if (j.chapters) s += d / 900 * 40;
  return s;
}

async function renderOverview() {
  const box = $('#trp-overview', root);
  const ov = await API.call('analysis.overview').catch(() => null);
  if (!box || !ov) return;
  const done = ov.count - ov.missing_ids.length;
  const pct = ov.total_s ? (ov.total_s - ov.missing_s) / ov.total_s * 100 : 0;
  const vision = h('input', { type: 'checkbox' }), chron = h('input', { type: 'checkbox', checked: true });
  clear(box).append(h('.card.trp-ov',
    h('.row', h('b', tr('Library')), h('.grow'), h('span.small.faint', tr('{done} of {count} videos · {time} of {total}', { done, count: ov.count, time: fmt.durHuman(ov.total_s - ov.missing_s), total: fmt.durHuman(ov.total_s) }))),
    h('.trs-bar.big', h('i', { style: { width: pct + '%', background: 'var(--ok)' } })),
    ov.missing_ids.length ? h('.row.wrap', { style: { marginTop: '10px', gap: '12px' } },
      h('label.row.small', vision, tr('also picture in conversations')), h('label.row.small', chron, tr('Cosmas AI')),
      h('.grow'),
      h('button.btn.primary', { onclick: async () => {
        if (!await AISetup.ensure()) return;
        await API.call('analysis.start', { ids: ov.missing_ids, speech: true, vision: vision.checked, chapters: chron.checked });
        TR.refreshQueue(); renderOverview(); toast(trn(ov.missing_ids.length, '{n} video queued', '{n} videos queued'));
      } }, icon('list-plus'), tr('Transcribe missing ({n}) · ~{time}+', { n: ov.missing_ids.length, time: fmt.durHuman(ov.missing_s / 45) })))
      : h('.small', { style: { marginTop: '8px', color: 'var(--ok)' } }, icon('circle-check'), ' ' + tr('All videos have a speech transcript.'))));
}

/* PC load: GPU, VRAM, temperature, CPU, RAM with a short history */
async function pollStats() {
  if (tab !== 'queue') return;
  const box = $('#trp-monitor', root);
  if (!box) return;
  const r = await API.call('analysis.stats').catch(() => null);
  if (!r || !box.isConnected) return;
  const s = r.system, g = s.gpu;
  if (r.queue) { TR.queue = r.queue; renderQueueLive(); AIQ.update(); }
  hist.gpu.push(g ? g.util : 0); hist.cpu.push(s.cpu || 0);
  for (const k in hist) if (hist[k].length > 60) hist[k].shift();
  const gb = b => (b / 2 ** 30).toFixed(1) + ' GB';
  const meter = (label, val, max, text, warn) => h('.trp-meter' + (warn ? '.warn' : ''),
    h('.row', h('span', label), h('.grow'), h('b', text)), h('.trs-bar', h('i', { style: { width: Math.min(100, val / max * 100) + '%' } })));
  const spark = (arr, color) => {
    const pts = arr.map((v, i) => `${(i / 59) * 100},${30 - v / 100 * 28}`).join(' ');
    return h('svg', { viewBox: '0 0 100 30', preserveAspectRatio: 'none', class: 'trp-spark', innerHTML: `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>` });
  };
  const q = r.queue;
  clear(box).append(
    h('.row', h('b', tr('PC load')), h('.grow'), h('span.tiny.faint', q && q.running ? tr('transcription running') : tr('idle'))),
    g ? h('.tiny.faint', { style: { margin: '2px 0 8px' } }, g.name) : h('.small.faint', tr('NVIDIA graphics card not found (nvidia-smi).')),
    g ? [meter('GPU', g.util, 100, Math.round(g.util) + ' %', g.util > 95), spark(hist.gpu, 'var(--accent)'),
      meter(tr('GPU memory'), g.mem_used, g.mem_total, `${gb(g.mem_used)} / ${gb(g.mem_total)}`, g.mem_used / g.mem_total > 0.92),
      meter(tr('Temperature'), g.temp, 95, Math.round(g.temp) + ' °C', g.temp > 82),
      meter(tr('Power draw'), g.power, g.power_limit || 450, `${Math.round(g.power)} W`)] : null,
    s.cpu != null ? [meter('CPU', s.cpu, 100, Math.round(s.cpu) + ' %'), spark(hist.cpu, 'var(--blue)')] : null,
    s.ram_total ? meter('RAM', s.ram_used, s.ram_total, `${gb(s.ram_used)} / ${gb(s.ram_total)}`) : null,
    s.worker_ram ? h('.tiny.faint', { style: { marginTop: '6px' } }, tr('Transcription process: {ram} RAM · priority {priority}', { ram: gb(s.worker_ram), priority: ({ idle: tr('lowest'), below: tr('reduced'), normal: tr('normal') })[App.settings.ai_priority || 'below'] })) : null,
    q && q.auto_paused ? h('.trp-warn', icon('gamepad-2'), tr('Paused – {game} is running. It resumes automatically after the game closes.', { game: q.auto_paused })) : null);
}

/* ---------------- proposals ---------------- */
async function renderProposals(body) {
  const props = await API.call('analysis.proposals', {});
  if (!props.length) {
    body.append(emptyState('sparkles', tr('No suggestions'), tr('Cosmas AI suggests events, characters, places and factions after processing a recording (the “Chronicle” step).')));
    return;
  }
  const groups = new Map();
  for (const p of props) { if (!groups.has(p.media_id)) groups.set(p.media_id, []); groups.get(p.media_id).push(p); }
  const order = { event: 0, character: 1, place: 2, faction: 3 };
  for (const [mid, ps] of groups) {
    const m = ps[0].media;
    const list = h('.prop-list');
    ps.sort((a, b) => (order[a.kind] - order[b.kind]) || (a.data.t - b.data.t)).forEach(p => list.appendChild(proposalCard(p, { onDone: updateBadge })));
    body.appendChild(h('.card.trp-pgroup',
      h('.row', m && m.thumb ? h('img.trp-pth', { src: m.thumb }) : null, h('.grow', h('b', m ? m.name : 'Video'), h('.tiny.faint', m ? fmt.dt(m.start) : '')),
        h('span.small.faint', trn(ps.length, '{n} suggestion', '{n} suggestions')),
        h('button.btn.sm.ghost', { onclick: async () => {
          if (!await confirmDialog(tr('Reject all suggestions for this video?'), tr('The same suggestions will not appear again.'))) return;
          for (const p of ps) await API.call('analysis.proposal_reject', { id: p.id });
          render();
        } }, tr('Reject all'))),
      list));
  }
}

/* ---------------- settings ---------------- */
async function renderSettings(body) {
  const s = await API.call('settings.get');
  const models = await API.call('analysis.models').catch(() => ({ whisper: [], ollama: null }));
  // every change is collected – two settings changed within the debounce are both saved (not just the last one)
  let pend = {};
  const push = debounce(async () => {
    const values = pend; pend = {};
    if (!Object.keys(values).length) return;
    Object.assign(App.settings, values);
    await API.call('settings.set', { values: { ...values, _rescan: false } });
    toast(tr('Saved – applies from the next video in the queue'));
  }, 350);
  const save = (k, v) => { pend[k] = v; push(); };
  flushSettings = () => push.flush();
  const val = (k, d) => s[k] ?? d;
  const toggle = (k, label, hint) => h('label.trp-opt', h('input', { type: 'checkbox', checked: !!val(k), onchange: e => save(k, e.target.checked) }),
    h('div', h('div', label), hint ? h('.tiny.faint', hint) : null));
  const slider = (k, label, min, max, step, unit, hint, fmtv = v => v) => {
    const out = h('b', fmtv(val(k)) + unit);
    return h('.trp-opt.col', h('.row', h('span', label), h('.grow'), out),
      h('input.trp-range', { type: 'range', min, max, step, value: val(k), oninput: e => { out.textContent = fmtv(+e.target.value) + unit; }, onchange: e => save(k, +e.target.value) }),
      hint ? h('.tiny.faint', hint) : null);
  };
  const select = (k, label, opts, hint) => h('.trp-opt.col', h('span', label),
    h('select.input', { onchange: e => save(k, e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(val(k)) === String(v) ? 'selected' : null }, l))),
    hint ? h('.tiny.faint', hint) : null);
  const card = (ic, title, desc, ...items) => h('.card.trp-set', h('h3', icon(ic), title), desc ? h('.small.faint', desc) : null, h('.trp-grid', items));
  const tracks = new Set(val('ai_tracks', []));
  const procs = h('textarea.input', { rows: 2, placeholder: (models.games || []).join(', ') || tr('e.g. KingdomCome.exe'),
    onchange: e => save('ai_pause_processes', e.target.value.split(/[\n,]/).map(x => x.trim()).filter(Boolean)), onkeydown: e => e.stopPropagation() },
    (val('ai_pause_processes', []) || []).join(', '));
  const ctx = h('textarea.input', { rows: 3, placeholder: tr('e.g. Kingdom Come: Deliverance II, RP server Kingdoms Connected, Bohemia in 1403. I play Lukáš of Ratají, a scribe in Malešov.'),
    onchange: e => save('ai_context', e.target.value), onkeydown: e => e.stopPropagation() }, val('ai_context', ''));

  body.append(
    h('.trp-warn', icon('cpu'), h('span', ...(([a, b]) => [a, h('a', { style: { cursor: 'pointer', fontWeight: 600 }, onclick: () => { tab = 'ai'; render(); } }, tr('Where AI runs')), b])(tr('Where AI runs (this computer or a paid service) and which models it uses is set in the {tab} tab.').split('{tab}')))),
    card('audio-lines', tr('Speech'), tr('Each audio track is transcribed separately so it is clear who is speaking.'),
      select('ai_language', tr('Language'), [['cs', tr('Czech')], ['sk', tr('Slovak')], ['en', tr('English')], ['', tr('Detect automatically')]]),
      h('.trp-opt.col', h('span', tr('Tracks to transcribe')), h('.row.wrap', ['Já', 'Hra', 'Discord', 'Zvuk'].map(t => h('span.chip' + (tracks.has(t) ? '.on' : ''), {
        onclick: e => { tracks.has(t) ? tracks.delete(t) : tracks.add(t); e.currentTarget.classList.toggle('on'); save('ai_tracks', [...tracks]); } },
        h('span.dot', { style: { background: TR.color(t) } }), { 'Já': tr('Me (microphone)'), Hra: tr('Game (in-game voice, NPC)'), Discord: 'Discord', Zvuk: tr('Audio (no separate tracks)') }[t]))),
        h('.tiny.faint', tr('In games with voice chat, other players are on the Game track.'))),
      slider('ai_batch_size', tr('Batch (this PC only)'), 4, 32, 4, '', tr('More = faster, more GPU memory.')),
      slider('ai_beam_size', tr('Search accuracy (beam)'), 1, 8, 1, '', tr('5 is a good compromise, 1 is the fastest.')),
      slider('ai_vad_threshold', tr('Speech sensitivity'), 0.2, 0.8, 0.05, '', tr('Lower = catches even quiet mumbling, but more noise.'), v => (+v).toFixed(2)),
      toggle('ai_junk_filter', tr('Filter out nonsense'), tr('Typical Whisper “hallucinations” in silence (“Subtitles by…”).'))),
    card('scan-eye', tr('Picture'), tr('Frames are described mainly during conversations: often when the scene changes (walking around the world), only occasionally when characters sit and the scene stays the same.'),
      select('ai_vision_width', tr('Frame size'), [[512, tr('512 px – fast')], [768, tr('768 px – recommended')], [1024, tr('1024 px – reads even small text')]]),
      toggle('ai_vision_dialog', tr('Describe the picture during conversations')),
      slider('ai_dialog_every', tr('In conversation, scene changing'), 2, 30, 1, ' s', tr('How often to look when characters are moving.')),
      slider('ai_static_every', tr('In conversation, scene still'), 10, 180, 5, ' s', tr('When characters sit and the picture does not change.')),
      slider('ai_motion_threshold', tr('What counts as a “scene change”'), 0.01, 0.2, 0.01, '', tr('Lower = more sensitive to motion.'), v => (+v).toFixed(2)),
      slider('ai_conv_gap', tr('Pause that ends a conversation'), 5, 90, 5, ' s'),
      slider('ai_base_every', tr('Outside conversations'), 0, 600, 30, ' s', tr('0 = do not describe the picture outside conversations.')),
      toggle('ai_detect_names', tr('Read name tags above characters'), tr('Names above heads and in the interface – linked to characters and players.')),
      toggle('ai_detect_faces', tr('Look for faces during conversations'), tr('Face crops can be used as a character portrait with one click.'))),
    card('scan-face', tr('Recognising characters by appearance'), tr('Characters on frames are recognised by their clothes, hair and face. References are created automatically from name tags above heads and from your confirmations (click a character on a frame). References from the same evening take priority, older ones weigh less – clothes change from time to time.'),
      toggle('ai_appearance', tr('Recognise characters by appearance')),
      slider('ai_look_threshold', tr('Required match'), 0.4, 0.9, 0.01, '', tr('Higher = fewer mistakes, but recognises fewer characters.'), v => (+v).toFixed(2)),
      slider('ai_look_margin', tr('Lead over the second most similar'), 0, 0.2, 0.01, '', tr('Protects against confusing similarly dressed characters.'), v => (+v).toFixed(2)),
      slider('ai_look_half_life', tr('Reference ageing'), 3, 180, 1, ' ' + tr('days'), tr('After how many days an older reference (different clothes?) gets an extra half weight.')),
      h('.trp-opt.col', h('span', tr('After confirming or changing settings')),
        h('button.btn.sm', { onclick: async e => { e.target.disabled = true; const n = await API.call('analysis.rematch_all'); e.target.disabled = false; toast(trn(n, 'Re-matched {n} video', 'Re-matched {n} videos')); } }, icon('refresh-cw'), tr('Re-match all videos')))),
    card('sparkles', tr('Cosmas AI'), tr('After transcription it goes through the recording in blocks (split at pauses between conversations) with a running memory of the story, a summary of the previous evening and knowledge of characters, places and factions from the database. It suggests chapters, events and new entries.'),
      toggle('ai_chapters', tr('Run Cosmas AI after transcription')),
      slider('ai_chapter_minutes', tr('Block length'), 5, 40, 5, ' min', tr('Shorter = more detailed chapters, longer processing.')),
      toggle('ai_chapter_bookmarks', tr('Chapters as moments'), tr('Shown on the player timeline and in Moments.')),
      h('.trp-opt.col.wide', h('span', tr('About the game and server (for all models)')), ctx)),
    card('link', tr('Linking'), null,
      toggle('ai_autolink', tr('Add recognised characters to the video'), tr('If you remove a character, it will not be added to that video again.')),
      toggle('ai_subtitles', tr('Subtitles in the player'), tr('The V key turns them on and off.'))),
    card('gauge', tr('Performance'), null,
      select('ai_priority', tr('Process priority'), [['idle', tr('Lowest – never slows the PC down')], ['below', tr('Reduced (recommended)')], ['normal', tr('Normal')]]),
      toggle('ai_pause_gaming', tr('Pause while I play'), tr('Frees the graphics card for the game. Resumes automatically after the game closes.')),
      toggle('ai_pause_any_game', tr('Detect games automatically'), tr('Anything launched from Steam, Epic, Xbox, GOG, Ubisoft, Rockstar, EA, Battle.net libraries.')),
      h('.trp-opt.col.wide', h('span', tr('Game processes')), procs, h('.tiny.faint', tr('Empty = games found in recordings: {list}', { list: (models.games || []).join(', ') || '—' })))));
}

Views.register('transcripts', { title: tr('transcripts'), short: tr('Transcripts'), icon: 'captions', order: 45, members: false, mount, unmount });
})();
