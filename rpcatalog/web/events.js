/* ============================================================
   Events – tree, event page (write-up, journal, recordings,
   attachments, characters, sub-events), proposals
   ============================================================ */
'use strict';

(() => {
const CSS = `
.ev { display: flex; height: 100%; min-height: 0; }
.ev-side { display: flex; flex-direction: column; }
.ev-side .top { padding: 10px 2px 6px; display: flex; flex-direction: column; gap: 8px; }
.ev-side .top h2 { margin: 0; flex: 1; font-size: 11.5px; font-weight: 650; letter-spacing: .03em; text-transform: uppercase; color: var(--text-3); }
.ev-side .top .input { height: 30px; font-size: 13px; }
.ev-tree { padding: 0 0 12px; }
.ev-node { display: flex; align-items: center; gap: 7px; height: 32px; padding-right: 6px; border-radius: 4px; cursor: pointer;
  color: var(--text-2); position: relative; }
.ev-node:hover { background: var(--hover); color: var(--text); }
.ev-node.on { background: var(--active); color: var(--text); }
.ev-node .car { width: 18px; display: grid; place-items: center; color: var(--text-3); flex: none; }
.ev-node .car i { font-size: 14px; }
.ev-node .bar { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.ev-node .nm { flex: 1; min-width: 0; font-size: 13.5px; }
.ev-node .dt { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.ev-node .cnt { font-size: 11px; color: var(--text-3); display: inline-flex; gap: 3px; align-items: center; }
.ev-node.drop-in { outline: 2px dashed rgba(227,179,65,.7); outline-offset: -2px; background: var(--accent-soft); }
.ev-node.drop-before::before, .ev-node.drop-after::after { content: ''; position: absolute; left: 8px; right: 8px; height: 2px;
  background: var(--accent); border-radius: 2px; }
.ev-node.drop-before::before { top: -1px; } .ev-node.drop-after::after { bottom: -1px; }
.ev-main { flex: 1; min-width: 0; overflow: auto; }
.ev-cover { position: relative; height: 210px; overflow: hidden; }
.ev-cover .img { position: absolute; inset: 0; background-size: cover; background-position: center; filter: saturate(1.05); }
.ev-cover .shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(13,15,19,.2) 0%, rgba(13,15,19,.55) 55%, var(--bg) 100%); }
.ev-cover .inner { position: absolute; left: 0; right: 0; bottom: 0; padding: 0 36px 14px; }
.ev-cover .crumbs { font-size: 12.5px; color: var(--text-2); display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
.ev-cover .crumbs a { color: var(--text-2); cursor: pointer; }
.ev-cover .crumbs a:hover { color: var(--accent); }
.ev-cover .ttl { width: 100%; font: 700 32px/1.15 var(--font-display); letter-spacing: -.5px; background: none; border: 0; outline: none;
  color: #fff; text-shadow: 0 2px 16px rgba(0,0,0,.5); padding: 2px 0; }
.ev-cover .acts { position: absolute; right: 24px; top: 16px; display: flex; gap: 6px; }
.ev-cover .acts .btn { background: rgba(13,15,19,.55); backdrop-filter: blur(8px); }
.ev-body { padding: 6px 36px 60px; max-width: 1180px; }
.ev-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin: 6px 0 14px; }
.ev-meta .box { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.ev-meta .box .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--text-3); display: flex; align-items: center; gap: 6px; }
.ev-meta .box .lbl i { font-size: 13px; }
.ev-meta input.input { height: 30px; }
.ev-swatches { display: flex; gap: 6px; flex-wrap: wrap; }
.ev-swatches span { width: 20px; height: 20px; border-radius: 6px; cursor: pointer; border: 2px solid transparent; }
.ev-swatches span.on { border-color: #fff; }
.ev-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin: 18px 0 16px; position: sticky; top: 0; background: var(--bg); z-index: 5; padding-top: 6px; }
.ev-tabs button { height: 38px; padding: 0 14px; border: 0; background: none; color: var(--text-2); cursor: pointer; font-size: 13.5px;
  display: inline-flex; align-items: center; gap: 7px; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.ev-tabs button:hover { color: var(--text); }
.ev-tabs button.on { color: var(--accent-2); border-bottom-color: var(--accent); }
.ev-tabs .n { font-size: 11px; padding: 0 6px; border-radius: 99px; background: var(--surface-2); color: var(--text-3); }
.entry { position: relative; padding-left: 30px; margin-bottom: 22px; }
.entry::before { content: ''; position: absolute; left: 9px; top: 26px; bottom: -22px; width: 2px; background: var(--border); }
.entry:last-child::before { display: none; }
.entry .pin { position: absolute; left: 0; top: 6px; width: 20px; height: 20px; border-radius: 50%; background: var(--surface-3);
  border: 2px solid var(--accent); display: grid; place-items: center; }
.entry .pin::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.entry .head { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.entry .head .ttl { font: 600 16px var(--font-display); flex: 1; min-width: 200px; }
.entry .head input[type=datetime-local] { width: 200px; height: 30px; }
.entry .head .ig { width: 170px; height: 30px; }
.entry .atts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.att-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
.att { border-radius: 12px; overflow: hidden; background: var(--surface); border: 1px solid var(--border); cursor: pointer; position: relative; }
.att:hover { border-color: var(--border-2); }
.att .im { aspect-ratio: 4/3; background: #05060a center/cover no-repeat; }
.att .fi { aspect-ratio: 4/3; display: grid; place-items: center; color: var(--text-3); background: var(--surface-2); }
.att .fi i { font-size: 34px; }
.att .cap { padding: 7px 10px; font-size: 12px; }
.att .att-src { position: absolute; left: 6px; top: 6px; display: inline-flex; gap: 4px; align-items: center; padding: 2px 8px 2px 6px;
  border-radius: 4px; background: rgba(0,0,0,.72); color: #fff; font-size: 11.5px; font-variant-numeric: tabular-nums; }
.att .att-src:hover { background: var(--accent); color: var(--accent-ink); }
.att .cap .faint { font-size: 11px; }
.att.sm { width: 120px; }
.att.sm .im, .att.sm .fi { aspect-ratio: 16/10; }
.att.sm .cap { padding: 4px 7px; font-size: 11px; }
.dropzone { border: 1.5px dashed var(--border-2); border-radius: 12px; padding: 18px; text-align: center; color: var(--text-3); margin-bottom: 14px; }
.dropzone.drop-target { border-color: var(--accent); color: var(--accent-2); }
.lk { display: grid; grid-template-columns: 200px 1fr auto; gap: 14px; align-items: center; padding: 10px; border-radius: 12px;
  background: var(--surface); border: 1px solid var(--border); margin-bottom: 10px; }
.lk .mtile { width: 200px; }
.lk .note { height: 30px; }
.sg { display: grid; grid-template-columns: 54px 150px 1fr auto; gap: 12px; align-items: center; padding: 8px 10px; border-radius: 12px; }
.sg:hover { background: var(--hover); }
.sg .mtile { width: 150px; }
.score { width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700;
  background: conic-gradient(var(--c) calc(var(--p) * 1%), var(--surface-3) 0); position: relative; }
.score::before { content: ''; position: absolute; inset: 4px; border-radius: 50%; background: var(--bg); }
.score span { position: relative; }
.why { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
.why span { font-size: 11px; padding: 1px 7px; border-radius: 99px; background: var(--surface-2); color: var(--text-2); }
.ev-dash { padding: 0 32px 40px; }
.ev-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.ev-card { border-radius: 14px; background: var(--surface); border: 1px solid var(--border); overflow: hidden; cursor: pointer;
  transition: transform .18s var(--ease), border-color .15s; }
.ev-card:hover { transform: translateY(-2px); border-color: var(--border-2); }
.ev-card .cv { height: 92px; background-size: cover; background-position: center; position: relative; }
.ev-card .cv::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, transparent, rgba(22,26,32,.9)); }
.ev-card .bd { padding: 10px 14px 13px; }
.ev-card .bd .t { font: 600 15px var(--font-display); }
.cta { display: flex; gap: 16px; align-items: center; padding: 18px 20px; border-radius: 16px; margin-bottom: 18px;
  background: linear-gradient(120deg, rgba(227,179,65,.16), rgba(167,123,232,.08)); border: 1px solid rgba(227,179,65,.25); }
.cta i.big { font-size: 30px; color: var(--accent); }
.prop { display: grid; grid-template-columns: 24px 1fr auto; gap: 12px; align-items: start; padding: 12px; border-radius: 12px;
  border: 1px solid var(--border); background: var(--surface); margin-bottom: 8px; }
.prop .strip { display: flex; gap: 6px; margin-top: 8px; overflow: hidden; }
.prop .strip .mtile { width: 112px; flex: none; }
.child-list .list-row { padding: 10px 12px; border: 1px solid var(--border); background: var(--surface); margin-bottom: 8px; border-radius: 12px; }
`;
document.head.appendChild(h('style', CSS));

let root, side, main, tree, current = null, tab = 'write', unsubs = [], filterQ = '';
const collapsed = new Set((App.ui.evCollapsed || []));

/* ---------------- tree ---------------- */
function renderTree() {
  clear(tree);
  const q = filterQ.trim().toLowerCase();
  const matches = e => inScope(e) && (!q || e.title.toLowerCase().includes(q) || (e.tags || []).some(t => t.includes(q)));
  const hasMatch = e => matches(e) || App.childrenOf(e.id).some(hasMatch);
  const walk = (pid, depth) => {
    for (const e of App.childrenOf(pid)) {
      if (!hasMatch(e)) continue;
      const kids = App.childrenOf(e.id);
      const open = q || !collapsed.has(e.id);
      const node = h('.ev-node' + (e.id === current ? '.on' : ''), {
        style: { paddingLeft: 4 + depth * 16 + 'px' }, draggable: 'true', 'data-id': e.id,
        onclick: () => open_(e.id),
        oncontextmenu: ev => nodeMenu(ev, e),
      },
      h('span.car', { onclick: ev => { ev.stopPropagation(); if (!kids.length) return; collapsed.has(e.id) ? collapsed.delete(e.id) : collapsed.add(e.id); App.ui.evCollapsed = [...collapsed]; App.saveUi(); renderTree(); } },
        kids.length ? icon(open ? 'chevron-down' : 'chevron-right') : null),
      h('span.bar', { style: { background: e.color || 'var(--accent)' } }),
      h('span.nm.ellipsis', e.title),
      e.link_count ? h('span.cnt', { title: tr('Recordings') }, icon('film'), e.link_count) : null,
      h('span.dt', e.start_time ? fmt.d(e.start_time).toLocaleDateString(I18N.locale, { day: 'numeric', month: 'numeric' }) : ''));
      wireDnD(node, e);
      tree.appendChild(node);
      if (open) walk(e.id, depth + 1);
    }
  };
  walk(null, 0);
  if (!App.events.length) tree.appendChild(h('.faint.small', { style: { padding: '14px 10px' } }, tr('No events yet. Create the first one, or let them be suggested from your recordings.')));
  const rootDrop = h('div', { style: { height: '60px' } });
  rootDrop.addEventListener('dragover', ev => { if (ev.dataTransfer.types.includes('application/x-event')) { ev.preventDefault(); rootDrop.classList.add('drop-target'); } });
  rootDrop.addEventListener('dragleave', () => rootDrop.classList.remove('drop-target'));
  rootDrop.addEventListener('drop', async ev => {
    rootDrop.classList.remove('drop-target');
    const id = Number(ev.dataTransfer.getData('application/x-event'));
    if (id) { await API.call('event.move', { id, parent_id: null }); App.loadEvents(); }
  });
  tree.appendChild(rootDrop);
}

function wireDnD(node, e) {
  node.addEventListener('dragstart', ev => { ev.dataTransfer.setData('application/x-event', String(e.id)); ev.dataTransfer.effectAllowed = 'move'; });
  const zone = ev => {
    const r = node.getBoundingClientRect(), y = ev.clientY - r.top;
    return y < r.height * .25 ? 'before' : y > r.height * .75 ? 'after' : 'in';
  };
  const clearCls = () => node.classList.remove('drop-in', 'drop-before', 'drop-after');
  node.addEventListener('dragover', ev => {
    const t = ev.dataTransfer.types;
    if (t.includes('application/x-media')) { ev.preventDefault(); clearCls(); node.classList.add('drop-in'); }
    else if (t.includes('application/x-event')) { ev.preventDefault(); clearCls(); node.classList.add('drop-' + zone(ev)); }
  });
  node.addEventListener('dragleave', clearCls);
  node.addEventListener('drop', async ev => {
    const z = zone(ev); clearCls(); ev.preventDefault();
    const media = ev.dataTransfer.getData('application/x-media');
    if (media) {
      const n = await API.call('link.add', { event_id: e.id, media_ids: JSON.parse(media) });
      toast(tr('Linked to “{title}”: {n}', { title: e.title, n }));
      await App.refresh('events', 'media');
      if (current === e.id) renderPage();
      return;
    }
    const id = Number(ev.dataTransfer.getData('application/x-event'));
    if (!id || id === e.id) return;
    if (z === 'in') await API.call('event.move', { id, parent_id: e.id });
    else {
      const sibs = App.childrenOf(e.parent_id).filter(x => x.id !== id);
      const idx = sibs.findIndex(x => x.id === e.id) + (z === 'after' ? 1 : 0);
      await API.call('event.move', { id, parent_id: e.parent_id, position: idx });
    }
    await App.loadEvents();
  });
}

function nodeMenu(ev, e) {
  menu(ev, [
    { label: tr('Open'), icon: 'arrow-up-right', onClick: () => open_(e.id) },
    { label: tr('New sub-event'), icon: 'corner-down-right', onClick: () => newEvent(e.id) },
    { label: tr('Move to top level'), icon: 'arrow-up-to-line', disabled: !e.parent_id, onClick: async () => { await API.call('event.move', { id: e.id, parent_id: null }); App.loadEvents(); } },
    { sep: true },
    { label: tr('Delete…'), icon: 'trash-2', danger: true, onClick: () => deleteEvent(e) },
  ]);
}

function open_(id) {
  current = id; tab = tab || 'write';
  $$('.ev-node', tree).forEach(n => n.classList.toggle('on', Number(n.dataset.id) === id));
  renderPage();
}

async function newEvent(parentId = null, defaults = {}) {
  const title = await promptDialog(parentId ? tr('New sub-event') : tr('New event'), tr('Title'), '', { placeholder: tr('e.g. Ambush of the caravan near Rataje') });
  if (!title) return;
  const parent = parentId ? App.eventsById.get(parentId) : null;
  const id = await API.call('event.create', { title, parent_id: parentId, start: defaults.start ?? parent?.start_time ?? null, end: defaults.end ?? parent?.end_time ?? null });
  if (parentId) collapsed.delete(parentId);
  await App.loadEvents();
  tab = 'write'; open_(id);
}

async function deleteEvent(e) {
  const kids = [];
  const walk = id => App.childrenOf(id).forEach(c => { kids.push(c); walk(c.id); });
  walk(e.id);
  const q = kids.length
    ? trn(kids.length, 'Delete “{title}” and {n} sub-event?', 'Delete “{title}” and {n} sub-events?', { title: e.title })
    : tr('Delete “{title}”?', { title: e.title });
  const ok = await confirmDialog(tr('Delete event'), q + '\n\n' + tr('The write-up, journal and attachments of this event will be deleted. Videos are kept.'), { danger: true, okLabel: tr('Delete') });
  if (!ok) return;
  await API.call('event.delete', { id: e.id });
  if (current === e.id || kids.some(k => k.id === current)) current = null;
  await App.refresh('events', 'media');
  renderPage();
}

/* ---------------- page ---------------- */
let pageToken = 0, ev = null;
async function renderPage() {
  const token = ++pageToken;
  if (!current) { renderDashboard(); return; }
  ev = await API.call('event.get', { id: current });
  if (token !== pageToken) return;
  if (!ev) { current = null; renderDashboard(); return; }
  clear(main);
  Shell.header({ icon: 'calendar-range', title: ev.title, topic: [fmt.range(ev.start_time, ev.end_time), ev.ingame_date, ev.location].filter(Boolean).join(' · '),
    actions: [shareButton('event', ev.id, { cls: 'button.tb-btn', compact: true })] });
  Shell.setContext({ label: tr('In this event'), chars: [...new Set(ev.char_links.map(l => l.character_id))] });
  const save = debounce(async fields => { await API.call('event.update', { id: ev.id, ...fields }); App.loadEvents(); }, 250);
  const saveNow = async fields => { await API.call('event.update', { id: ev.id, ...fields }); Object.assign(ev, fields); await App.loadEvents(); };

  // cover
  const cover = ev.cover_id ? ev.attachments.find(a => a.id === ev.cover_id) : null;
  const coverImg = h('.img', { style: cover ? { backgroundImage: `url("${cover.url}")` } :
    { background: `color-mix(in srgb, ${ev.color || '#888'} 38%, var(--bg-2))` } });
  const ttl = h('input.ttl', { value: ev.title, placeholder: tr('Event title'), onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); },
    onchange: e => saveNow({ title: e.target.value.trim() || tr('Untitled') }) });
  const path = App.eventPath(ev.id).slice(0, -1);
  main.appendChild(h('.ev-cover', coverImg, h('.shade'),
    h('.acts',
      h('button.btn.sm', { title: tr('Cover from attachments'), onclick: e => coverMenu(e) }, icon('image'), tr('Cover')),
      h('button.btn.sm.icon', { title: tr('More'), onclick: e => menu(e, [
        { label: tr('New sub-event'), icon: 'corner-down-right', onClick: () => newEvent(ev.id) },
        { label: tr('Show on timeline'), icon: 'chart-gantt', onClick: () => App.go('timeline', { focus: ev.id }) },
        { sep: true },
        { label: tr('Delete event…'), icon: 'trash-2', danger: true, onClick: () => deleteEvent(App.eventsById.get(ev.id)) },
      ]) }, icon('ellipsis'))),
    h('.inner',
      h('.crumbs', h('a', { onclick: () => { current = null; renderPage(); renderTree(); } }, icon('calendar-range'), ' ' + tr('Events')),
        path.map(p => [icon('chevron-right'), h('a', { onclick: () => open_(p.id) }, p.title)])),
      ttl)));

  // meta boxes
  const startIn = h('input.input', { type: 'datetime-local', value: fmt.toInput(ev.start_time), onchange: () => saveTimes() });
  const endIn = h('input.input', { type: 'datetime-local', value: fmt.toInput(ev.end_time), onchange: () => saveTimes() });
  async function saveTimes() {
    let s = fmt.fromInput(startIn.value), e = fmt.fromInput(endIn.value);
    if (s && e && e < s) { e = s + 3600; endIn.value = fmt.toInput(e); }
    if (s && !e) { e = s + 3600; endIn.value = fmt.toInput(e); }
    await saveNow({ start_time: s, end_time: s ? e : null });
  }
  const body = h('.ev-body');
  body.appendChild(h('.ev-meta',
    h('.box', h('.lbl', icon('clock'), tr('When (real time)')), h('.row', startIn), h('.row', endIn),
      h('button.btn.sm.ghost', { style: { alignSelf: 'flex-start' }, onclick: async () => {
        const r = await API.call('event.range_from_links', { id: ev.id });
        if (!r) { toast(tr('The event has no linked recordings yet'), 'err'); return; }
        startIn.value = fmt.toInput(r.start); endIn.value = fmt.toInput(r.end); App.loadEvents(); toast(tr('Time set from recordings'));
      } }, icon('wand-sparkles'), tr('From recordings'))),
    h('.box', h('.lbl', icon('server'), tr('Server')),
      serverPicker(ev.server_id, async id => { await saveNow({ server_id: id }); renderPage(); }, App.scope.game),
      h('.lbl', icon('scroll-text'), tr('In-game date')),
      h('input.input', { value: ev.ingame_date || '', placeholder: tr('e.g. 14th day after the harvest, 1403'), onkeydown: e => e.stopPropagation(), onchange: e => saveNow({ ingame_date: e.target.value }) }),
      h('.lbl', icon('map-pin'), tr('Place')),
      (() => {
        const pl = ev.place_id && (App.places || []).find(p => p.id === ev.place_id);
        return h('.row', pl ? h('span.chip.on', { onclick: () => App.go('places', { id: pl.id }) }, icon('map-pin'), pl.name)
          : h('input.input', { value: ev.location || '', placeholder: tr('e.g. Rataje, tavern'), onkeydown: e => e.stopPropagation(), onchange: e => saveNow({ location: e.target.value }) }),
        h('button.btn.sm', { title: tr('Pick from the place catalog'), onclick: async () => {
          const id = await pickPlace(tr('Where did the event take place?')); if (!id) return;
          App.places = await API.call('places.list');
          const p2 = App.places.find(x => x.id === id);
          await saveNow({ place_id: id, location: p2 ? p2.name : '' }); renderPage();
        } }, icon('map'), pl ? '' : tr('From catalog')),
        pl ? h('button.btn.sm.ghost.icon', { title: tr('Unlink place'), onclick: async () => { await saveNow({ place_id: null }); renderPage(); } }, icon('x')) : null);
      })()),
    h('.box', h('.lbl', icon('palette'), tr('Color and tags')),
      h('.ev-swatches', PALETTE.map(c => h('span' + (c === ev.color ? '.on' : ''), { style: { background: c },
        onclick: async () => { await saveNow({ color: c }); renderPage(); renderTree(); } }))),
      tagEditor(ev.tags || [], tags => API.call('event.update', { id: ev.id, tags }).then(() => App.loadEvents())))));

  // characters
  const roleOf = new Map(); const mentioned = new Set();
  ev.char_links.forEach(l => { if (l.source === 'manual') roleOf.set(l.character_id, l.role); else mentioned.add(l.character_id); });
  const entryMentions = new Set(ev.entries.flatMap(en => en.chars || []));
  const charsRow = h('.row.wrap', { style: { gap: '8px' } });
  [...roleOf.keys()].map(id => App.charsById.get(id)).filter(Boolean).forEach(c => charsRow.appendChild(charChip(c, {
    role: roleOf.get(c.id),
    onClick: e => menu(e, [
      { label: tr('Character profile'), icon: 'user', onClick: () => App.go('characters', { id: c.id }) },
      { label: tr('Edit role…'), icon: 'pencil', onClick: async () => { const r = await promptDialog(tr('Role in event'), c.name, roleOf.get(c.id) || '', { placeholder: tr('e.g. victim, witness, leader') }); if (r !== null) { await API.call('char.link', { character_id: c.id, target_type: 'event', target_id: ev.id, role: r }); renderPage(); } } },
      { label: tr('Remove from event'), icon: 'x', danger: true, onClick: async () => { await API.call('char.unlink', { character_id: c.id, target_type: 'event', target_id: ev.id }); App.refresh('events', 'chars'); renderPage(); } },
    ]),
  })));
  const onlyMentioned = [...new Set([...mentioned, ...entryMentions])].filter(id => !roleOf.has(id)).map(id => App.charsById.get(id)).filter(Boolean);
  onlyMentioned.forEach(c => charsRow.appendChild(h('span', { title: tr('Mentioned in text') }, charChip(c, { role: tr('mention') }))));
  charsRow.appendChild(h('button.btn.sm', { onclick: async () => {
    const ids = await pickCharacters([...roleOf.keys()], { title: tr('Characters in event') });
    if (!ids) return;
    for (const id of ids) if (!roleOf.has(id)) await API.call('char.link', { character_id: id, target_type: 'event', target_id: ev.id, role: '' });
    for (const id of roleOf.keys()) if (!ids.includes(id)) await API.call('char.unlink', { character_id: id, target_type: 'event', target_id: ev.id });
    App.refresh('events', 'chars'); renderPage();
  } }, icon('user-plus'), tr('Add characters')));
  body.appendChild(h('.section-title', icon('users'), tr('Characters'), h('.line')));
  body.appendChild(charsRow);

  // tabs
  const counts = { journal: ev.entries.length, media: ev.links.length, files: ev.attachments.length, children: ev.children.length };
  const tabs = [['write', 'file-text', tr('Write-up')], ['journal', 'notebook-pen', tr('Journal')], ['media', 'film', tr('Recordings')],
    ['files', 'paperclip', tr('Attachments')], ['children', 'git-branch', tr('Sub-events')]];
  const tabBar = h('.ev-tabs', tabs.map(([k, ic, label]) => h('button' + (tab === k ? '.on' : ''), { onclick: () => { tab = k; renderPage(); } },
    icon(ic), label, counts[k] ? h('span.n', counts[k]) : null)));
  body.appendChild(tabBar);
  const pane = h('div');
  body.appendChild(pane);
  main.appendChild(body);

  if (tab === 'write') paneWrite(pane);
  else if (tab === 'journal') paneJournal(pane);
  else if (tab === 'media') paneMedia(pane);
  else if (tab === 'files') paneFiles(pane);
  else paneChildren(pane);
}

function coverMenu(e) {
  const imgs = ev.attachments.filter(a => a.kind === 'image').concat(ev.entries.flatMap(en => en.attachments.filter(a => a.kind === 'image')));
  menu(e, [
    ...imgs.slice(0, 12).map(a => ({ label: a.caption || a.orig_name || tr('image'), icon: 'image', onClick: async () => { await API.call('event.update', { id: ev.id, cover_id: a.id }); App.loadEvents(); renderPage(); } })),
    imgs.length ? { sep: true } : null,
    { label: tr('Upload image…'), icon: 'upload', onClick: async () => { const got = await API.call('att.pick', { owner_type: 'event', owner_id: ev.id, images_only: true }); if (got.length) { await API.call('event.update', { id: ev.id, cover_id: got[0].id }); App.loadEvents(); renderPage(); } } },
    { label: tr('Screenshot from player'), icon: 'camera', onClick: async () => { const a = await API.call('att.snapshot', { owner_type: 'event', owner_id: ev.id }); await API.call('event.update', { id: ev.id, cover_id: a.id }); App.loadEvents(); renderPage(); } },
    ev.cover_id ? { label: tr('Remove cover'), icon: 'x', onClick: async () => { await API.call('event.update', { id: ev.id, cover_id: null }); App.loadEvents(); renderPage(); } } : null,
  ]);
}

/* ---- write-up ---- */
function paneWrite(pane) {
  const ed = RichEditor({
    html: ev.body_html || '', ownerType: 'event', ownerId: ev.id, minHeight: 320,
    placeholder: tr('Describe what happened… Type @ to tag a character, paste screenshots with Ctrl+V.'),
    onChange: async html => { await API.call('event.update', { id: ev.id, body_html: html }); ev.body_html = html; App.refresh('events', 'chars'); },
  });
  pane.appendChild(ed.el);
  pane.appendChild(h('.faint.tiny', { style: { marginTop: '8px' } }, icon('save'), ' ' + tr('Saved automatically.')));
}

/* ---- journal ---- */
function paneJournal(pane) {
  pane.appendChild(h('.row', { style: { marginBottom: '16px' } },
    h('button.btn.primary', { onclick: async () => {
      const id = await API.call('entry.create', { event_id: ev.id, title: '', entry_time: Date.now() / 1000 });
      await App.loadEvents(); await renderPage(); setTimeout(() => { const el = $(`[data-entry="${id}"] .ttl`); el && el.focus(); }, 60);
    } }, icon('plus'), tr('New entry')),
    h('span.faint.small', tr('Dated notes on the event – progress, character journal, testimonies, evidence…'))));
  if (!ev.entries.length) {
    pane.appendChild(emptyState('notebook-pen', tr('The journal is empty'), tr('Each entry has its own date (real and in-game), text, tagged characters and attachments.')));
    return;
  }
  for (const en of ev.entries) {
    const save = fields => API.call('entry.update', { id: en.id, ...fields }).then(() => App.refresh('events', 'chars'));
    const atts = h('.atts');
    const renderAtts = () => {
      clear(atts);
      en.attachments.forEach((a, i) => atts.appendChild(attCard(a, { small: true, list: en.attachments, index: i, onChange: () => renderPage() })));
      atts.appendChild(h('button.btn.sm.ghost', { onclick: async () => { const got = await API.call('att.pick', { owner_type: 'entry', owner_id: en.id }); en.attachments.push(...got); renderAtts(); } }, icon('paperclip'), tr('Attachment')));
      atts.appendChild(h('button.btn.sm.ghost', { onclick: async () => { const a = await API.call('att.snapshot', { owner_type: 'entry', owner_id: en.id }); en.attachments.push(a); renderAtts(); } }, icon('camera'), tr('Screenshot')));
    };
    renderAtts();
    const ed = RichEditor({ html: en.body_html, ownerType: 'entry', ownerId: en.id, minHeight: 90,
      placeholder: tr('What happened… (@ = character, Ctrl+V = screenshot)'), onChange: html => save({ body_html: html }) });
    pane.appendChild(h('.entry', { 'data-entry': en.id },
      h('.pin'),
      h('.head',
        h('input.input.bare.ttl', { value: en.title || '', placeholder: tr('Entry title'), onkeydown: e => e.stopPropagation(), onchange: e => save({ title: e.target.value }) }),
        h('input.input', { type: 'datetime-local', title: tr('Real date and time'), value: fmt.toInput(en.entry_time), onchange: e => save({ entry_time: fmt.fromInput(e.target.value) }) }),
        h('input.input.ig', { value: en.ingame_date || '', placeholder: tr('in-game date'), title: tr('In-game date'), onkeydown: e => e.stopPropagation(), onchange: e => save({ ingame_date: e.target.value }) }),
        h('button.btn.ghost.icon.sm', { title: tr('Delete entry'), onclick: async () => {
          if (await confirmDialog(tr('Delete entry'), tr('Delete this entry including its attachments?'), { danger: true, okLabel: tr('Delete') })) {
            await API.call('entry.delete', { id: en.id }); App.refresh('events', 'chars'); renderPage();
          }
        } }, icon('trash-2'))),
      ed.el, atts));
  }
}

/* ---- linked recordings + suggestions ---- */
async function paneMedia(pane) {
  const links = [...ev.links].sort((a, b) => ((a.media.start || 0) + (a.offset || 0)) - ((b.media.start || 0) + (b.offset || 0)));
  const total = links.reduce((s, l) => s + (l.media.duration || 0), 0);
  pane.appendChild(h('.row', { style: { marginBottom: '12px' } },
    h('span.muted', trn(links.length, '{n} recording', '{n} recordings') + ' · ' + fmt.durHuman(total)),
    h('.grow'),
    h('button.btn', { onclick: () => App.go('library', { select: links.map(l => l.media_id) }) }, icon('clapperboard'), tr('Show in library')),
    h('button.btn', { onclick: async () => {
      const ids = await pickFromLibrary();
      if (ids && ids.length) { await API.call('link.add', { event_id: ev.id, media_ids: ids }); await App.refresh('events', 'media'); renderPage(); }
    } }, icon('plus'), tr('Add recordings'))));
  if (!links.length) pane.appendChild(h('.faint.small', { style: { margin: '0 0 14px' } }, tr('Drag videos from the Library onto an event in the tree on the left, or use the suggestions below.')));

  // moments (bookmarks / virtual clips) of this event, in story order
  const refresh = async () => { ev = await API.call('event.get', { id: ev.id }); renderPage(); };
  const bms = [...(ev.bookmarks || [])].sort((a, b) => (a.abs || a.t) - (b.abs || b.t));
  const momBox = h('div', { style: { marginBottom: '18px' } },
    h('.section-title', icon('bookmark'), tr('Moments') + (bms.length ? ' · ' + bms.length : ''), h('.line')));
  if (bms.length) momBox.append(...bms.map(b => bmRow(b, { showMedia: true, onChange: refresh, hideEvent: true })));
  else momBox.appendChild(h('.faint.small', { style: { padding: '2px 8px' } },
    tr('Moments and video segments assigned to this event. During playback press P (moment straight into the event) or B and assign it later.')));
  pane.appendChild(momBox);
  // unassigned bookmarks inside this event's recordings -> quick assign
  if (links.length) {
    const linkedIds = new Set(links.map(l => l.media_id));
    API.call('bm.list', { include_auto: false }).then(all => {
      const t0 = ev.start_time, t1 = ev.end_time;
      const cand = all.filter(b => !b.event_id && linkedIds.has(b.media_id) && (!t0 || !t1 || !b.abs || (b.abs >= t0 - 600 && b.abs <= t1 + 600)));
      if (!cand.length) return;
      momBox.appendChild(h('.small.muted', { style: { margin: '10px 8px 4px' } }, icon('sparkles'), ' ' + tr('Unassigned moments in these recordings ({n})', { n: cand.length }),
        h('button.btn.sm.ghost', { style: { marginLeft: '8px' }, onclick: async () => {
          for (const b of cand) await API.call('bm.update', { id: b.id, event_id: ev.id });
          toast(tr('Assigned {n}', { n: cand.length })); await bmChanged(); refresh();
        } }, icon('check-check'), tr('Assign all'))));
      momBox.append(...cand.map(b => h('div', { style: { opacity: .75 } }, bmRow(b, { showMedia: true, onChange: refresh }))));
    });
  }

  pane.appendChild(h('.section-title', icon('film'), tr('Recordings'), h('.line')));
  for (const l of links) {
    const m = l.media;
    const moment = (m.start || 0) + (l.offset || 0);
    pane.appendChild(h('.lk',
      mediaTile(m, { onClick: () => API.call('media.play', { id: m.id, offset: l.offset }) }),
      h('.col', { style: { gap: '6px' } },
        h('.row', h('b.ellipsis', m.name), h('span.badge.' + m.type, KIND[m.type].label)),
        h('.small.muted', icon('clock'), ' ', fmt.dt(moment), l.offset != null ? h('span', ' · ' + tr('in video from') + ' ', h('span.kbd', fmt.clock(l.offset))) : ` · ${fmt.dur(m.duration)}`),
        h('input.input.note', { value: l.note || '', placeholder: tr('Note – what matters in this shot'), onkeydown: e => e.stopPropagation(),
          onchange: e => API.call('link.update', { id: l.id, note: e.target.value }) }),
        m.duration ? bmStrip(m, bms.filter(b => b.media_id === m.id), { onChange: refresh }) : null),
      h('.col', { style: { gap: '6px' } },
        h('button.btn.sm', { onclick: () => API.call('media.play', { id: m.id, offset: l.offset }) }, icon('play'), l.offset != null ? fmt.clock(l.offset) : tr('Play')),
        h('button.btn.sm.ghost.danger', { onclick: async () => { await API.call('link.delete', { id: l.id }); await App.refresh('events', 'media'); renderPage(); } }, icon('unlink'), tr('Remove')))));
  }
  // suggestions
  const sugBox = h('div');
  pane.appendChild(h('.section-title', icon('sparkles'), tr('Suggestions'), h('.line')));
  pane.appendChild(sugBox);
  sugBox.appendChild(h('.faint.small', tr('Searching…')));
  const sug = await API.call('event.suggest', { id: ev.id });
  clear(sugBox);
  if (!sug.length) { sugBox.appendChild(h('.faint.small', tr('No suggestions. Set the event time, or link the first recording – I will find more based on it.'))); return; }
  const high = sug.filter(s => s.score >= 80);
  if (high.length) sugBox.appendChild(h('.row', { style: { marginBottom: '8px' } },
    h('button.btn.primary.sm', { onclick: async () => {
      for (const s of high) await API.call('link.add', { event_id: ev.id, media_ids: [s.media.id], offset: s.offset });
      toast(tr('Linked {n}', { n: high.length })); await App.refresh('events', 'media'); renderPage();
    } }, icon('check-check'), tr('Link all above 80% ({n})', { n: high.length }))));
  for (const s of sug.slice(0, 24)) {
    const col = s.score >= 80 ? 'var(--ok)' : s.score >= 50 ? 'var(--accent)' : 'var(--text-3)';
    sugBox.appendChild(h('.sg',
      h('.score', { style: { '--p': s.score, '--c': col } }, h('span', s.score)),
      mediaTile(s.media, { onClick: () => API.call('media.play', { id: s.media.id, offset: s.offset }) }),
      h('div', h('b.ellipsis', s.media.name), h('.small.faint', `${s.media.game} · ${fmt.dt(s.media.start)} · ${fmt.dur(s.media.duration)}`),
        h('.why', s.reasons.map(r => h('span', r)))),
      h('button.btn.sm', { onclick: async () => {
        await API.call('link.add', { event_id: ev.id, media_ids: [s.media.id], offset: s.offset });
        await App.refresh('events', 'media'); renderPage();
      } }, icon('plus'), tr('Attach'))));
  }
}

function pickFromLibrary() {
  return new Promise(resolve => {
    const sel = new Set(); let done = false;
    const q = h('input.input', { placeholder: tr('Search…'), autofocus: true });
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px', marginTop: '12px', maxHeight: '60vh', overflow: 'auto' } });
    const render = () => {
      clear(grid);
      const t = q.value.toLowerCase();
      App.media.filter(m => !t || (m.name + ' ' + m.game + ' ' + m.tags.join(' ')).toLowerCase().includes(t)).slice(0, 300).forEach(m => {
        const tile = mediaTile(m, { onClick: () => { sel.has(m.id) ? sel.delete(m.id) : sel.add(m.id); render(); } });
        if (sel.has(m.id)) tile.style.outline = '3px solid var(--accent)';
        grid.appendChild(h('div', tile, h('.tiny.ellipsis', { style: { marginTop: '4px' } }, m.name), h('.tiny.faint', fmt.dt(m.start))));
      });
    };
    q.addEventListener('input', render); q.addEventListener('keydown', e => e.stopPropagation());
    modal({ title: tr('Select recordings'), icon: 'film', xwide: true, body: h('div', q, grid),
      onClose: () => { if (!done) resolve(null); },
      actions: [{ label: tr('Cancel'), onClick: () => { done = true; resolve(null); } },
        { label: tr('Link selected'), primary: true, onClick: () => { done = true; resolve([...sel]); } }] });
    render();
  });
}

/* ---- attachments ---- */
function attCard(a, { small = false, list = null, index = 0, onChange } = {}) {
  const el = h('.att' + (small ? '.sm' : ''), {
    onclick: () => { if (a.kind === 'image') { const imgs = (list || [a]).filter(x => x.kind === 'image'); lightbox(imgs, Math.max(0, imgs.indexOf(a))); } else API.call('att.open', { id: a.id }); },
    oncontextmenu: e => menu(e, [
      { label: tr('Open'), icon: 'external-link', onClick: () => API.call('att.open', { id: a.id }) },
      a.media_id ? { label: tr('Play video from {time}', { time: fmt.clock(a.media_offset) }), icon: 'play', onClick: () => API.call('att.play_source', { id: a.id }) } : null,
      a.kind === 'image' && ev ? { label: tr('Set as cover'), icon: 'image', onClick: async () => { await API.call('event.update', { id: ev.id, cover_id: a.id }); App.loadEvents(); renderPage(); } } : null,
      { label: tr('Edit caption…'), icon: 'pencil', onClick: async () => { const c = await promptDialog(tr('Caption'), tr('Attachment caption'), a.caption || ''); if (c !== null) { await API.call('att.update', { id: a.id, caption: c }); a.caption = c; onChange && onChange(); } } },
      { label: tr('Show in folder'), icon: 'folder-open', onClick: () => API.call('att.reveal', { id: a.id }) },
      { sep: true },
      { label: tr('Delete'), icon: 'trash-2', danger: true, onClick: async () => { if (await confirmDialog(tr('Delete attachment'), tr('Delete “{title}”?', { title: a.caption || a.orig_name }), { danger: true, okLabel: tr('Delete') })) { await API.call('att.delete', { id: a.id }); onChange && onChange(); } } },
    ]),
  },
  a.kind === 'image' ? h('.im', { style: { backgroundImage: `url("${a.url}")` } }) : h('.fi', icon('file-text')),
  a.media_id ? h('span.att-src', { title: tr('Play the source video at this time'),
    onclick: e => { e.stopPropagation(); API.call('att.play_source', { id: a.id }); } },
  icon('play'), a.media_offset != null ? fmt.clock(a.media_offset) : tr('video')) : null,
  h('.cap', h('.ellipsis', a.caption || a.orig_name || tr('attachment')), h('.faint.ellipsis', a.taken_at ? fmt.dt(a.taken_at) : fmt.size(a.size))));
  return el;
}
window.attCard = attCard;

function paneFiles(pane) {
  const zone = h('.dropzone', icon('upload'), ' ' + tr('Drop files or screenshots here, or paste them with') + ' ', h('span.kbd', 'Ctrl+V'),
    h('.row', { style: { justifyContent: 'center', marginTop: '10px' } },
      h('button.btn.sm', { onclick: async () => { await API.call('att.pick', { owner_type: 'event', owner_id: ev.id }); renderPage(); } }, icon('paperclip'), tr('Choose files')),
      h('button.btn.sm', { onclick: async () => { await API.call('att.snapshot', { owner_type: 'event', owner_id: ev.id }); toast(tr('Screenshot saved')); renderPage(); } }, icon('camera'), tr('Screenshot from player'))));
  zone.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); zone.classList.add('drop-target'); } });
  zone.addEventListener('dragleave', () => zone.classList.remove('drop-target'));
  zone.addEventListener('drop', async e => { e.preventDefault(); zone.classList.remove('drop-target'); await uploadFiles('event', ev.id, e.dataTransfer.files); renderPage(); });
  pane.appendChild(zone);
  const all = [...ev.attachments, ...ev.entries.flatMap(en => en.attachments.map(a => ({ ...a, fromEntry: en.title || tr('entry') })))];
  if (!all.length) { pane.appendChild(h('.faint.small', tr('No attachments yet.'))); return; }
  const grid = h('.att-grid');
  all.sort((a, b) => (a.taken_at || a.created_at) - (b.taken_at || b.created_at))
    .forEach((a, i) => grid.appendChild(attCard(a, { list: all, index: i, onChange: () => renderPage() })));
  pane.appendChild(grid);
}

/* ---- sub-events ---- */
function paneChildren(pane) {
  pane.appendChild(h('.row', { style: { marginBottom: '12px' } }, h('button.btn.primary', { onclick: () => newEvent(ev.id) }, icon('plus'), tr('New sub-event'))));
  const kids = App.childrenOf(ev.id);
  if (!kids.length) { pane.appendChild(emptyState('git-branch', tr('No sub-events'), tr('Split a larger story into chapters – e.g. “Investigation” → “Questioning a witness”, “Arrest”.'))); return; }
  const list = h('.child-list');
  kids.forEach(k => list.appendChild(h('.list-row', { onclick: () => open_(k.id) },
    h('span.dot', { style: { background: k.color, width: '10px', height: '10px' } }),
    h('.grow', h('b', k.title), h('.small.faint', [fmt.range(k.start_time, k.end_time), k.location].filter(Boolean).join(' · ')), k.excerpt ? h('.small.muted.ellipsis', k.excerpt) : null),
    avatarStack(k.chars || [], 24), k.link_count ? h('span.chip', icon('film'), k.link_count) : null, icon('chevron-right', 'faint'))));
  pane.appendChild(list);
}

/* ---------------- dashboard (no selection) ---------------- */
async function renderDashboard() {
  clear(main);
  Shell.header({ icon: 'calendar-range', title: tr('events'), topic: trn(App.events.length, '{n} event', '{n} events') });
  Shell.setContext(null);
  const unlinkedSessions = App.media.filter(m => !m.linked && m.type !== 'clip' && (m.duration || 0) >= (App.settings.short_session_seconds || 60));
  const dash = h('.ev-dash');
  main.appendChild(h('.page-head', h('div', h('h1', tr('Events')), h('.sub', trn(App.events.length, '{n} event', '{n} events') + ' · ' + trn(App.chars.length, '{n} character', '{n} characters'))),
    h('.grow'), h('button.btn.primary', { onclick: () => newEvent() }, icon('plus'), tr('New event'))));
  if (unlinkedSessions.length) {
    dash.appendChild(h('.cta', icon('sparkles', 'big'),
      h('.grow', h('b', trn(unlinkedSessions.length, '{n} recording is not in any event yet', '{n} recordings are not in any event yet')),
        h('.small.muted', tr('I will group them by game nights and suggest events from them – just tick and name them.'))),
      h('button.btn.primary', { onclick: propose }, icon('wand-sparkles'), tr('Suggest events'))));
  }
  const recent = [...App.events].sort((a, b) => (b.start_time || b.created_at || 0) - (a.start_time || a.created_at || 0)).slice(0, 18);
  if (recent.length) {
    dash.appendChild(h('.section-title', tr('Recent events'), h('.line')));
    dash.appendChild(h('.ev-cards', recent.map(e => h('.ev-card', { onclick: () => open_(e.id) },
      h('.cv', { style: e.cover ? { backgroundImage: `url("${e.cover}")` } : { background: `linear-gradient(135deg, ${e.color}66, ${e.color}11)` } }),
      h('.bd', h('.t.ellipsis', e.title), h('.small.faint', [fmt.range(e.start_time, e.end_time), e.location].filter(Boolean).join(' · ')),
        e.excerpt ? h('.small.muted', { style: { marginTop: '6px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, e.excerpt) : null,
        h('.row', { style: { marginTop: '8px' } }, avatarStack(e.chars || [], 22), h('.grow'),
          e.link_count ? h('span.chip', icon('film'), e.link_count) : null, e.entry_count ? h('span.chip', icon('notebook-pen'), e.entry_count) : null))))));
  } else if (!unlinkedSessions.length) {
    dash.appendChild(emptyState('calendar-range', tr('No events yet'), tr('Create the first event and link recordings from the library to it.')));
  }
  main.appendChild(dash);
}

/* ---------------- proposals ---------------- */
async function propose() {
  const gameSel = h('select.input', { style: { width: '220px' } }, h('option', { value: '' }, tr('All games')),
    App.games.map(([g, n]) => h('option', { value: g }, `${g} (${n})`)));
  const gap = h('input.input', { type: 'number', min: 5, max: 600, value: App.settings.event_gap_minutes || 45, style: { width: '90px' } });
  const list = h('div', { style: { maxHeight: '60vh', overflow: 'auto', marginTop: '12px' } });
  let props = [];
  const load = async () => {
    clear(list).appendChild(h('.faint', tr('Calculating…')));
    props = await API.call('event.propose', { gap: Number(gap.value), game: gameSel.value || null });
    clear(list);
    if (!props.length) { list.appendChild(h('.faint', tr('Nothing to suggest – all recordings are already in events.'))); return; }
    props.forEach(p => {
      p.on = false;
      const cb = h('input', { type: 'checkbox', style: { accentColor: 'var(--accent)', width: '17px', height: '17px', marginTop: '4px' }, onchange: e => { p.on = e.target.checked; } });
      const title = h('input.input.bare', { value: p.title, style: { fontWeight: 600, fontSize: '14px' }, onkeydown: e => e.stopPropagation(), oninput: e => { p.title = e.target.value; } });
      const total = p.media.reduce((s, m) => s + (m.duration || 0), 0);
      list.appendChild(h('.prop', cb,
        h('div', title, h('.small.faint', `${fmt.range(p.start, p.end)} · ${trn(p.media.length, '{n} recording', '{n} recordings')} · ${tr('{duration} recorded', { duration: fmt.durHuman(total) })}`),
          h('.strip', p.media.slice(0, 8).map(m => mediaTile(m)))),
        h('span.chip', p.game)));
    });
  };
  gameSel.onchange = load; gap.onchange = load;
  modal({
    title: tr('Suggest events from recordings'), icon: 'wand-sparkles', xwide: true,
    body: h('div', h('.muted.small', tr('Recordings that are not in any event yet, grouped by game nights. Tick, name and create – the recordings are linked to the events right away.')),
      h('.row', { style: { marginTop: '12px' } }, h('span.small', tr('Game')), gameSel, h('span.small', tr('new group after a break of')), gap, h('span.small', tr('min'))), list),
    actions: [{ label: tr('Cancel') }, { label: tr('Create selected'), primary: true, icon: 'check', onClick: async () => {
      const chosen = props.filter(p => p.on);
      if (!chosen.length) { toast(tr('Nothing is selected'), 'err'); return false; }
      const ids = await API.call('event.create_many', { items: chosen.map(p => ({ title: p.title, start: p.start, end: p.end, media_ids: p.media.map(m => m.id) })) });
      toast(trn(ids.length, 'Created {n} event', 'Created {n} events'));
      await App.refresh('events', 'media');
      open_(ids[ids.length - 1]);
    } }],
  });
  load();
}
window.proposeEvents = propose;

/* ---------------- mount ---------------- */
Views.register('events', {
  title: tr('Events'), short: tr('Events'), icon: 'calendar-range', order: 20,
  mount(r, params) {
    root = r;
    if (params.id) { current = params.id; const e = App.eventsById.get(params.id); e && App.eventPath(e.id).forEach(p => collapsed.delete(p.id)); }
    if (params.tab) tab = params.tab;
    tree = h('.ev-tree');
    side = h('.ev-side',
      h('.top', h('.row', h('h2', tr('Tree')),
        h('button.btn.sm.icon', { title: tr('Suggest from recordings'), onclick: propose }, icon('wand-sparkles')),
        h('button.btn.sm.primary', { onclick: () => newEvent() }, icon('plus'), tr('New'))),
      h('.search', icon('search'), h('input.input', { placeholder: tr('Search events…'), value: filterQ, onkeydown: e => e.stopPropagation(),
        oninput: e => { filterQ = e.target.value; renderTree(); } }))),
      tree);
    main = h('.ev-main');
    Shell.slot().appendChild(side);
    root.appendChild(h('.ev', main));
    renderTree(); renderPage();
    if (params.create) setTimeout(() => newEvent(null, { start: params.start ?? null, end: params.start ? params.start + 3600 : null }), 50);
    if (params.propose) setTimeout(propose, 50);
    unsubs = [
      App.on('events', () => { renderTree(); if (!current) renderDashboard(); }),
      App.on('chars', () => renderTree()),
    ];
  },
  unmount() { unsubs.forEach(u => u()); unsubs = []; root = null; pageToken++; },
});
})();
