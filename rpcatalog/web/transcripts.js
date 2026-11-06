/* ============================================================
   Přepisy – queue, PC load, Kronikář AI proposals and all transcript settings
   ============================================================ */
'use strict';

(() => {
let root, tab = 'queue', timer = null, offs = [];
const hist = { gpu: [], cpu: [] };

function mount(r, params) {
  root = r;
  if (params && params.tab) tab = params.tab;
  Shell.header({ icon: 'captions', title: 'Přepisy', topic: 'řeč, obraz a Kronikář AI – na tvém PC nebo přes placenou službu' });
  render();
  offs.push(TR.on(ev => { if (tab === 'queue' && ev.phase !== undefined) renderQueueLive(); }));
  timer = setInterval(pollStats, 2000);
  pollStats();
}
function unmount() { clearInterval(timer); timer = null; offs.forEach(f => f()); offs = []; }

function render() {
  clear(root);
  const tabs = h('.seg.trp-tabs', [['queue', 'list-ordered', 'Fronta a výkon'], ['proposals', 'sparkles', 'Návrhy'], ['ai', 'cpu', 'Kde běží AI'], ['settings', 'sliders-horizontal', 'Nastavení']].map(([k, ic, label]) =>
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
    j.speech ? h('span.trp-what', icon('audio-lines'), 'řeč') : null,
    j.vision ? h('span.trp-what', icon('scan-eye'), 'obraz') : null,
    j.vision_ranges ? h('span.trp-what', icon('scan-eye'), `úsek ${fmt.clock(j.vision_ranges[0][0])}–${fmt.clock(j.vision_ranges[0][1])}`) : null,
    j.chapters ? h('span.trp-what', icon('sparkles'), 'kronika') : null);
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
      h('div', h('b', q.paused ? 'Přepisy jsou pozastavené' : q.queue.length ? 'Spouštím…' : 'Nic se nezpracovává'),
        h('.small.faint', q.paused ? 'Fronta čeká, až pokračuješ.' : 'Přidej videa z Knihovny (pravý klik → Přepis) nebo níže „Přepsat chybějící“.')),
      h('.grow'), q.paused ? h('button.btn.primary', { onclick: () => API.call('analysis.pause', { paused: false }).then(TR.refreshQueue) }, icon('play'), 'Pokračovat') : null));
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
            h('button.btn.sm.ghost', { title: 'Hotové části zůstanou, příště naváže', onclick: () => API.call('analysis.skip') }, icon('skip-forward'), 'Přeskočit video'),
            h('button.btn.sm.ghost', { onclick: () => App.go('library', { select: [c.id] }) }, icon('panel-right-open'), 'Otevřít video')))));
    }
    const paused = q.paused || q.auto_paused;
    const order = ['speech', 'vision', 'chapters'];
    clear($('.trp-steps', cur)).append(order.filter(p => p === 'speech' ? c.speech : p === 'vision' ? (c.vision || c.vision_ranges) : c.chapters).map(p =>
      h('span.trs-step' + (order.indexOf(p) < order.indexOf(c.phase) ? '.done' : p === c.phase ? '.on' : ''), icon({ speech: 'audio-lines', vision: 'scan-eye', chapters: 'sparkles' }[p]), TR.PHASE[p])));
    const pct = Math.round((c.p || 0) * 100);
    $('.trs-bar i', cur).style.width = pct + '%';
    $('.trp-pct', cur).textContent = pct + ' %';
    $('.trp-msg', cur).textContent = paused ? (q.auto_paused ? `Pozastaveno – běží hra ${q.auto_paused}` : 'Pozastaveno') : (c.msg || '…');
    $('.trp-eta', cur).textContent = [TR.eta(c.eta), c.speed ? `${Math.round(c.speed)}× rychleji než reálný čas` : '', c.started ? `běží ${fmt.durHuman((Date.now() / 1000) - c.started)}` : ''].filter(Boolean).join(' · ');
    $('.trp-pausebtn', cur).replaceChildren(icon(q.paused ? 'play' : 'pause'), q.paused ? 'Pokračovat' : 'Pozastavit');
    $('.trp-cur', cur).classList.toggle('paused', !!paused);
  }
  // waiting jobs
  clear(qu);
  if (q.queue.length) {
    qu.append(h('.section-title', icon('list-ordered'), `Ve frontě · ${q.queue.length}`, h('.line'),
      h('span.tiny.faint', `~${fmt.durHuman(q.queue.reduce((a, j) => a + estimate(j), 0))}`)));
    q.queue.forEach((j, i) => {
      const m = App.mediaById.get(j.id);
      qu.appendChild(h('.trp-q', { draggable: 'true',
        ondragstart: e => { e.dataTransfer.setData('text/x-job', j.key); },
        ondragover: e => e.preventDefault(),
        ondrop: e => { e.preventDefault(); const k = e.dataTransfer.getData('text/x-job'); if (k && k !== j.key) API.call('analysis.move', { key: k, index: i }).then(TR.refreshQueue); } },
        h('span.trp-n', i + 1), h('.trp-q-th', m && m.thumb ? h('img', { src: m.thumb }) : null),
        h('.grow', { style: { minWidth: 0 } }, h('.ellipsis', j.title), h('.row', jobChips(j), h('span.tiny.faint', `${fmt.durHuman(j.duration)} záznamu · ~${fmt.durHuman(estimate(j))}`))),
        h('button.btn.sm.ghost.icon', { title: 'Na začátek fronty', disabled: i === 0, onclick: () => API.call('analysis.move', { key: j.key, index: 0 }).then(TR.refreshQueue) }, icon('arrow-up-to-line')),
        h('button.btn.sm.ghost.icon', { title: 'Odebrat', onclick: () => API.call('analysis.remove', { key: j.key }).then(TR.refreshQueue) }, icon('x'))));
    });
  }
  // finished
  clear(hi);
  if (q.history.length) {
    hi.append(h('.section-title', icon('history'), 'Dokončeno', h('.line')));
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
    h('.row', h('b', 'Knihovna'), h('.grow'), h('span.small.faint', `${done} z ${ov.count} videí · ${fmt.durHuman(ov.total_s - ov.missing_s)} z ${fmt.durHuman(ov.total_s)}`)),
    h('.trs-bar.big', h('i', { style: { width: pct + '%', background: 'var(--ok)' } })),
    ov.missing_ids.length ? h('.row.wrap', { style: { marginTop: '10px', gap: '12px' } },
      h('label.row.small', vision, 'i obraz v rozhovorech'), h('label.row.small', chron, 'Kronikář AI'),
      h('.grow'),
      h('button.btn.primary', { onclick: async () => {
        if (!await AISetup.ensure()) return;
        await API.call('analysis.start', { ids: ov.missing_ids, speech: true, vision: vision.checked, chapters: chron.checked });
        TR.refreshQueue(); renderOverview(); toast(`${ov.missing_ids.length} videí ve frontě`);
      } }, icon('list-plus'), `Přepsat chybějící (${ov.missing_ids.length}) · ~${fmt.durHuman(ov.missing_s / 45)}+`))
      : h('.small', { style: { marginTop: '8px', color: 'var(--ok)' } }, icon('circle-check'), ' Všechna videa mají přepis řeči.')));
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
    h('.row', h('b', 'Vytížení PC'), h('.grow'), h('span.tiny.faint', q && q.running ? 'přepis běží' : 'nečinné')),
    g ? h('.tiny.faint', { style: { margin: '2px 0 8px' } }, g.name) : h('.small.faint', 'Grafická karta NVIDIA nenalezena (nvidia-smi).'),
    g ? [meter('GPU', g.util, 100, Math.round(g.util) + ' %', g.util > 95), spark(hist.gpu, 'var(--accent)'),
      meter('Paměť GPU', g.mem_used, g.mem_total, `${gb(g.mem_used)} / ${gb(g.mem_total)}`, g.mem_used / g.mem_total > 0.92),
      meter('Teplota', g.temp, 95, Math.round(g.temp) + ' °C', g.temp > 82),
      meter('Příkon', g.power, g.power_limit || 450, `${Math.round(g.power)} W`)] : null,
    s.cpu != null ? [meter('CPU', s.cpu, 100, Math.round(s.cpu) + ' %'), spark(hist.cpu, 'var(--blue)')] : null,
    s.ram_total ? meter('RAM', s.ram_used, s.ram_total, `${gb(s.ram_used)} / ${gb(s.ram_total)}`) : null,
    s.worker_ram ? h('.tiny.faint', { style: { marginTop: '6px' } }, `Proces přepisu: ${gb(s.worker_ram)} RAM · priorita ${({ idle: 'nejnižší', below: 'snížená', normal: 'normální' })[App.settings.ai_priority || 'below']}`) : null,
    q && q.auto_paused ? h('.trp-warn', icon('gamepad-2'), `Pozastaveno – běží ${q.auto_paused}. Po ukončení hry se pokračuje samo.`) : null);
}

/* ---------------- proposals ---------------- */
async function renderProposals(body) {
  const props = await API.call('analysis.proposals', {});
  if (!props.length) {
    body.append(emptyState('sparkles', 'Žádné návrhy', 'Kronikář AI navrhuje události, postavy, místa a frakce po zpracování záznamu (krok „Kronika“).'));
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
        h('span.small.faint', `${ps.length} ${fmt.plural(ps.length, 'návrh', 'návrhy', 'návrhů')}`),
        h('button.btn.sm.ghost', { onclick: async () => {
          if (!await confirmDialog('Zamítnout všechny návrhy tohoto videa?', 'Stejné návrhy už se znovu neobjeví.')) return;
          for (const p of ps) await API.call('analysis.proposal_reject', { id: p.id });
          render();
        } }, 'Zamítnout vše')),
      list));
  }
}

/* ---------------- settings ---------------- */
async function renderSettings(body) {
  const s = await API.call('settings.get');
  const models = await API.call('analysis.models').catch(() => ({ whisper: [], ollama: null }));
  const save = debounce(async (k, v) => {
    App.settings[k] = v;
    await API.call('settings.set', { values: { [k]: v, _rescan: false } });
    toast('Uloženo – platí od dalšího videa ve frontě');
  }, 350);
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
  const procs = h('textarea.input', { rows: 2, placeholder: (models.games || []).join(', ') || 'např. KingdomCome.exe',
    onchange: e => save('ai_pause_processes', e.target.value.split(/[\n,]/).map(x => x.trim()).filter(Boolean)), onkeydown: e => e.stopPropagation() },
    (val('ai_pause_processes', []) || []).join(', '));
  const ctx = h('textarea.input', { rows: 3, placeholder: 'např. Kingdom Come: Deliverance II, RP server Kingdoms Connected, Čechy roku 1403. Hraju za Lukáše z Ratají, písaře v Malešově.',
    onchange: e => save('ai_context', e.target.value), onkeydown: e => e.stopPropagation() }, val('ai_context', ''));

  body.append(
    h('.trp-warn', icon('cpu'), h('span', 'Kde AI běží (tento počítač nebo placená služba) a které modely používá, se nastavuje v záložce ', h('a', { style: { cursor: 'pointer', fontWeight: 600 }, onclick: () => { tab = 'ai'; render(); } }, 'Kde běží AI'), '.')),
    card('audio-lines', 'Řeč', 'Každá zvuková stopa se přepisuje zvlášť, aby bylo jasné, kdo mluví.',
      select('ai_language', 'Jazyk', [['cs', 'čeština'], ['sk', 'slovenština'], ['en', 'angličtina'], ['', 'poznat automaticky']]),
      h('.trp-opt.col', h('span', 'Stopy k přepisu'), h('.row.wrap', ['Já', 'Hra', 'Discord', 'Zvuk'].map(t => h('span.chip' + (tracks.has(t) ? '.on' : ''), {
        onclick: e => { tracks.has(t) ? tracks.delete(t) : tracks.add(t); e.currentTarget.classList.toggle('on'); save('ai_tracks', [...tracks]); } },
        h('span.dot', { style: { background: TR.color(t) } }), { 'Já': 'Já (mikrofon)', Hra: 'Hra (hlas ve hře, NPC)', Discord: 'Discord', Zvuk: 'Zvuk (bez oddělených stop)' }[t]))),
        h('.tiny.faint', 'Ve hře s hlasovým chatem jsou ostatní hráči ve stopě Hra.')),
      slider('ai_batch_size', 'Dávka (jen na tomto PC)', 4, 32, 4, '', 'Víc = rychlejší, víc paměti GPU.'),
      slider('ai_beam_size', 'Přesnost hledání (beam)', 1, 8, 1, '', '5 je dobrý kompromis, 1 je nejrychlejší.'),
      slider('ai_vad_threshold', 'Citlivost na řeč', 0.2, 0.8, 0.05, '', 'Nižší = zachytí i tiché mumlání, ale víc šumu.', v => (+v).toFixed(2)),
      toggle('ai_junk_filter', 'Filtrovat nesmysly', 'Typické „halucinace“ Whisperu v tichu („Titulky vytvořil…“).')),
    card('scan-eye', 'Obraz', 'Snímky se popisují hlavně při rozhovorech: když se scéna mění (chůze po světě), často; když postavy sedí a scéna je stejná, jen občas.',
      select('ai_vision_width', 'Velikost snímku', [[512, '512 px – rychlé'], [768, '768 px – doporučeno'], [1024, '1024 px – čte i drobný text']]),
      toggle('ai_vision_dialog', 'Popisovat obraz během rozhovorů'),
      slider('ai_dialog_every', 'Při rozhovoru, scéna se mění', 2, 30, 1, ' s', 'Jak často se podívat, když se postavy pohybují.'),
      slider('ai_static_every', 'Při rozhovoru, scéna stojí', 10, 180, 5, ' s', 'Když postavy sedí a obraz se nemění.'),
      slider('ai_motion_threshold', 'Co je „změna scény“', 0.01, 0.2, 0.01, '', 'Nižší = citlivější na pohyb.', v => (+v).toFixed(2)),
      slider('ai_conv_gap', 'Pauza, která ukončí rozhovor', 5, 90, 5, ' s'),
      slider('ai_base_every', 'Mimo rozhovory', 0, 600, 30, ' s', '0 = mimo rozhovory obraz nepopisovat.'),
      toggle('ai_detect_names', 'Číst jmenovky nad postavami', 'Jména nad hlavami a v rozhraní – propojí se s postavami a hráči.'),
      toggle('ai_detect_faces', 'Hledat tváře při rozhovorech', 'Výřezy tváří jdou jedním klikem použít jako portrét postavy.')),
    card('scan-face', 'Poznávání postav podle vzhledu', 'Postavy na snímcích se poznají podle oblečení, vlasů a obličeje. Vzory vznikají samy ze jmenovek nad hlavou a z tvých potvrzení (klik na postavu u snímku). Vzory ze stejného večera mají přednost, starší váží méně – oblečení se občas mění.',
      toggle('ai_appearance', 'Poznávat postavy podle vzhledu'),
      slider('ai_look_threshold', 'Potřebná shoda', 0.4, 0.9, 0.01, '', 'Vyšší = méně omylů, ale pozná méně postav.', v => (+v).toFixed(2)),
      slider('ai_look_margin', 'Náskok před druhou nejpodobnější', 0, 0.2, 0.01, '', 'Chrání před záměnou podobně oblečených postav.', v => (+v).toFixed(2)),
      slider('ai_look_half_life', 'Stárnutí vzorů', 3, 180, 1, ' dní', 'Po kolika dnech má starší vzor (jiné oblečení?) poloviční váhu navíc.'),
      h('.trp-opt.col', h('span', 'Po potvrzení nebo změně nastavení'),
        h('button.btn.sm', { onclick: async e => { e.target.disabled = true; const n = await API.call('analysis.rematch_all'); e.target.disabled = false; toast(`Znovu porovnáno ${n} videí`); } }, icon('refresh-cw'), 'Znovu porovnat všechna videa'))),
    card('sparkles', 'Kronikář AI', 'Po přepisu projde záznam po blocích (dělených v pauzách mezi rozhovory) s průběžnou pamětí děje, se shrnutím předchozího večera a se znalostí postav, míst a frakcí z databáze. Navrhne kapitoly, události a nové záznamy.',
      toggle('ai_chapters', 'Spouštět Kronikáře AI po přepisu'),
      slider('ai_chapter_minutes', 'Délka bloku', 5, 40, 5, ' min', 'Kratší = podrobnější kapitoly, delší zpracování.'),
      toggle('ai_chapter_bookmarks', 'Kapitoly jako záložky', 'Ukážou se na ose přehrávače a v Momentech.'),
      h('.trp-opt.col.wide', h('span', 'O hře a serveru (pro všechny modely)'), ctx)),
    card('link', 'Propojení', null,
      toggle('ai_autolink', 'Přidávat rozpoznané postavy k videu', 'Když postavu odebereš, už se k tomu videu znovu nepřidá.'),
      toggle('ai_subtitles', 'Titulky v přehrávači', 'Klávesa V je zapne a vypne.')),
    card('gauge', 'Výkon', null,
      select('ai_priority', 'Priorita procesu', [['idle', 'Nejnižší – nikdy nezpomalí PC'], ['below', 'Snížená (doporučeno)'], ['normal', 'Normální']]),
      toggle('ai_pause_gaming', 'Pozastavit, když hraju', 'Uvolní grafickou kartu pro hru. Po ukončení hry pokračuje samo.'),
      toggle('ai_pause_any_game', 'Poznat hry automaticky', 'Cokoli spuštěného z knihoven Steam, Epic, Xbox, GOG, Ubisoft, Rockstar, EA, Battle.net.'),
      h('.trp-opt.col.wide', h('span', 'Procesy her'), procs, h('.tiny.faint', 'Prázdné = hry nalezené v záznamech: ' + ((models.games || []).join(', ') || '—')))));
}

Views.register('transcripts', { title: 'přepisy', short: 'Přepisy', icon: 'captions', order: 45, members: false, mount, unmount });
})();
