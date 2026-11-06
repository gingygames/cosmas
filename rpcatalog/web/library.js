/* ============================================================
   Library – browse, filter, edit and organise recordings
   ============================================================ */
'use strict';

(() => {
const CSS = `
.lib { display: flex; height: 100%; min-height: 0; }
.lib-side { padding: 0; }
.lib-side .grp { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3);
  margin: 16px 10px 6px; display: flex; align-items: center; }
.lib-side .grp button { margin-left: auto; }
.lib-side .it { display: flex; align-items: center; gap: 9px; height: 32px; padding: 0 10px; border-radius: 8px; cursor: pointer;
  color: var(--text-2); font-size: 13px; }
.lib-side .it:hover { background: var(--hover); color: var(--text); }
.lib-side .it.on { background: var(--accent-soft); color: var(--accent-2); }
.lib-side .it .n { margin-left: auto; font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.lib-side .it.sub { padding-left: 34px; height: 28px; font-size: 12.5px; }
.lib-side .it i { font-size: 15px; }
.lib-side .it.drop-target { outline-offset: -1px; }
.lib-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.lib-grid-wrap > .game-hero { margin: -4px -24px 0; }
.lib-grid-wrap > div > .toolbar { padding-left: 0; padding-right: 0; }
.game-hero { position: relative; height: 230px; flex: none; overflow: hidden; display: flex; align-items: flex-end; }
.game-hero .bgimg { position: absolute; inset: 0; background: center 35% / cover no-repeat; }
.game-hero::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.05) 0%, rgba(0,0,0,.25) 45%, var(--bg) 100%); }
.game-hero .in { position: relative; z-index: 1; padding: 0 24px 16px; display: flex; align-items: flex-end; gap: 24px; width: 100%; }
.game-hero h2 { margin: 0; font: 800 34px/1.1 var(--font-display); color: #fff; text-shadow: 0 2px 12px rgba(0,0,0,.6); letter-spacing: -.5px; }
.game-hero .stats { display: flex; gap: 26px; margin-top: 12px; }
.game-hero .stat .k { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: rgba(255,255,255,.6); font-weight: 600; }
.game-hero .stat .v { font-size: 14px; color: #fff; font-weight: 600; }
.game-hero .btn.play { height: 44px; padding: 0 26px; font-size: 15px; font-weight: 700; background: var(--ok); color: #fff; }
.game-hero .btn.play:hover { filter: brightness(1.1); }
.lib-grid-wrap { flex: 1; overflow: auto; padding: 4px 24px 30px; }
.lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--card-w, 250px), 1fr)); gap: 16px; }
.lib-day { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 10px; margin: 14px 0 -4px; }
.lib-day h3 { margin: 0; font: 600 15px var(--font-display); }
.lib-day h3::first-letter { text-transform: uppercase; }
.lib-day .faint { font-size: 12px; }
.lib-day .line { flex: 1; height: 1px; background: var(--border); align-self: center; }
.mcard { border-radius: 6px; background: var(--surface); overflow: hidden; cursor: pointer;
  transition: background .12s; position: relative; user-select: none; }
.mcard:hover { background: var(--surface-2); }
.mcard.sel { box-shadow: 0 0 0 2px var(--accent); }
.mcard.playing::after { content: ''; position: absolute; inset: 0; border: 2px solid var(--ok); border-radius: 6px; pointer-events: none; }
.mcard .th { position: relative; aspect-ratio: 16/9; background: #05060a; overflow: hidden; }
.mcard .th img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .35s var(--ease); }
.mcard:hover .th img { transform: scale(1.02); }
.mcard .th .badge { position: absolute; left: 8px; top: 8px; backdrop-filter: blur(8px); }
.mcard .th .dur { position: absolute; right: 8px; bottom: 8px; background: rgba(0,0,0,.72); color: #fff; font-size: 11.5px;
  padding: 2px 7px; border-radius: 6px; font-variant-numeric: tabular-nums; }
.mcard .th .flags { position: absolute; right: 8px; top: 8px; display: flex; gap: 4px; }
.mcard .th .flags span { width: 24px; height: 24px; border-radius: 4px; display: grid; place-items: center; background: rgba(0,0,0,.6);
  color: var(--accent-2); backdrop-filter: blur(6px); }
.mcard .th .flags i { font-size: 13px; }
.mcard .th .pl { position: absolute; inset: 0; display: grid; place-items: center; opacity: 0; transition: opacity .2s;
  background: linear-gradient(180deg, transparent 40%, rgba(0,0,0,.5)); }
.mcard .th .pl span { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--accent);
  color: var(--accent-ink); transform: scale(.9); transition: transform .15s var(--ease); }
.mcard .th .pl i { font-size: 20px; margin-left: 2px; }
.mcard:hover .th .pl { opacity: 1; }
.mcard:hover .th .pl span { transform: scale(1); }
[data-rmid] > .resume { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(255,255,255,.25); z-index: 1; pointer-events: none; }
[data-rmid] > .resume i { display: block; height: 100%; background: var(--danger); }
.mcard .th .bm { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; }
.mcard .th .bm b { position: absolute; bottom: 0; width: 3px; height: 3px; background: var(--accent); border-radius: 2px; }
.mcard .meta { padding: 10px 12px 11px; }
.mcard .t { font-weight: 600; font-size: 13.5px; }
.mcard .s { font-size: 12px; color: var(--text-3); margin-top: 2px; display: flex; align-items: center; gap: 6px; }
.mcard .tags { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; min-height: 0; }
.mcard.missing { opacity: .5; }
.mcard.compact .meta { padding: 7px 10px 8px; }
.lib-insp { width: 360px; flex: none; overflow: auto; background: var(--bg-2);
  animation: slidein .2s var(--ease); }
.lib-insp.in-modal { width: auto; background: none; animation: none; overflow: visible; }
.lib-insp.in-modal .pad { padding: 0; }
.lib-insp.pane { width: auto; animation: none; background: var(--bg); overflow: visible; }
.lib-insp .hero { position: relative; aspect-ratio: 16/9; background: #000; cursor: pointer; }
.lib-insp .hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
.lib-insp .hero .pl { position: absolute; inset: 0; display: grid; place-items: center; background: linear-gradient(180deg, transparent 50%, rgba(0,0,0,.6)); }
.lib-insp .hero .pl span { width: 54px; height: 54px; border-radius: 50%; display: grid; place-items: center; background: var(--accent);
  color: var(--accent-ink); }
.lib-insp .hero .pl i { font-size: 24px; margin-left: 3px; }
.lib-insp .pad { padding: 14px 16px; }
.lib-insp .title-in { font: 600 17px var(--font-display); }
.lib-insp .kv { display: grid; grid-template-columns: 92px 1fr; gap: 6px 10px; font-size: 12.5px; }
.lib-insp .kv .k { color: var(--text-3); }
.lib-insp .rowlist .list-row { padding: 6px 8px; font-size: 13px; }
.tag-input { display: flex; flex-wrap: wrap; gap: 6px; padding: 5px 6px; border-radius: 9px; background: var(--bg-2);
  border: 1px solid var(--border-2); min-height: 34px; align-items: center; }
.tag-input:focus-within { border-color: rgba(227,179,65,.55); }
.tag-input input { border: 0; outline: none; background: none; flex: 1; min-width: 80px; height: 22px; }
.tag-input .chip { height: 22px; padding: 0 8px; }
.bulkbar { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); display: flex; gap: 6px; align-items: center;
  padding: 8px 10px 8px 16px; border-radius: 14px; background: var(--surface-3); border: 1px solid var(--border-2);
  box-shadow: var(--shadow); animation: pop .2s var(--ease); z-index: 20; }
`;
document.head.appendChild(h('style', CSS));

const SORTS = {
  new: { label: tr('Newest'), fn: (a, b) => (b.start || 0) - (a.start || 0) },
  old: { label: tr('Oldest'), fn: (a, b) => (a.start || 0) - (b.start || 0) },
  long: { label: tr('Longest'), fn: (a, b) => (b.duration || 0) - (a.duration || 0) },
  name: { label: tr('Name'), fn: (a, b) => a.name.localeCompare(b.name, I18N.locale) },
};

let S = null;  // view state

function state() {
  const ui = App.ui.lib || (App.ui.lib = {});
  return {
    filter: ui.filter || { type: 'all' },
    kinds: new Set(ui.kinds || ['clip', 'session', 'manual']),
    sort: ui.sort || 'new',
    group: ui.group !== false,
    showShort: !!ui.showShort,
    size: ui.size || 250,
    q: '',
    sel: new Set(),
    anchor: null,
    albumItems: null,
    expanded: new Set(ui.expanded || []),
  };
}
function persist() {
  App.ui.lib = { filter: S.filter, kinds: [...S.kinds], sort: S.sort, group: S.group, showShort: S.showShort,
    size: S.size, expanded: [...S.expanded] };
  App.saveUi();
}

function filtered() {
  let items = App.media;
  const f = S.filter;
  items = items.filter(m => inScope(m, 'media'));
  if (f.type === 'unlinked') items = items.filter(m => !m.linked);
  else if (f.type === 'fav') items = items.filter(m => m.favorite);
  else if (f.type === 'tag') items = items.filter(m => m.tags.includes(f.tag));
  else if (f.type === 'char') items = items.filter(m => (m.chars || []).includes(f.id));
  else if (f.type === 'album') items = items.filter(m => S.albumItems && S.albumItems.has(m.id));
  items = items.filter(m => S.kinds.has(m.type));
  if (!S.showShort) {
    const lim = App.settings.short_session_seconds || 60;
    items = items.filter(m => !(m.type === 'session' && (m.duration || 0) < lim));
  }
  const q = S.q.trim().toLowerCase();
  if (q) {
    const words = q.split(/\s+/);
    items = items.filter(m => {
      const hay = [m.name, m.medal_title, m.description, m.game, ...(m.tags || []).map(t => '#' + t),
        ...(m.chars || []).map(id => App.charsById.get(id)?.name || '')].join(' ').toLowerCase();
      return words.every(w => hay.includes(w)) || (S.trHits && S.trHits.has(m.id));
    });
  }
  if (f.type === 'album' && S.sort === 'new' && S.albumOrder) {
    return [...items].sort((a, b) => (S.albumOrder.get(a.id) ?? 0) - (S.albumOrder.get(b.id) ?? 0));
  }
  return [...items].sort(SORTS[S.sort].fn);
}

async function transcribe(ms, opts) {
  if (!await AISetup.ensure()) return;
  await API.call('analysis.start', { ids: ms.map(m => m.id), speech: true, ...opts });
  TR.refreshQueue();
  toast(ms.length > 1 ? trn(ms.length, '{n} video queued for transcription', '{n} videos queued for transcription') : tr('Transcription started – progress is shown in the video panel'));
}

/** Library search also looks into what was said (and seen) in transcribed videos. */
async function searchTranscripts() {
  S.trHits = null;
  renderGrid();
  const q = S.q.trim();
  if (q.length < 3) return;
  const hits = await API.call('analysis.search', { q }).catch(() => []);
  if (q !== S.q.trim()) return;
  S.trHits = new Map();
  for (const x of hits) if (!S.trHits.has(x.media_id)) S.trHits.set(x.media_id, x);   // best hit per video
  renderGrid();
}

function trHit(m) {
  const x = S.q.trim() && S.trHits && S.trHits.get(m.id);
  if (!x) return null;
  return h('.tr-hit', { title: tr('Play from here'), onclick: e => { e.stopPropagation(); play(m, Math.max(0, x.t - 1)); } },
    h('span.kbd', fmt.clock(x.t)), h('span.ellipsis', `${x.speaker}: `, x.snippet.split(/[[\]]/).map((p, i) => i % 2 ? h('mark', p) : p)));
}

/* ---------------- sidebar ---------------- */
function renderSide(side) {
  clear(side);
  const it = (label, ic, spec, n, extra = {}) => {
    const on = JSON.stringify(spec) === JSON.stringify(S.filter);
    const el = h('.it' + (on ? '.on' : '') + (extra.sub ? '.sub' : ''), {
      onclick: () => { S.filter = spec; S.sel.clear(); loadAlbum().then(() => { persist(); render(); }); },
      oncontextmenu: extra.menu,
    }, ic ? icon(ic) : (extra.dot ? h('span.dot', { style: { background: extra.dot } }) : null), h('span.ellipsis', label), n != null ? h('span.n', n) : null);
    if (extra.drop) dropZone(el, extra.drop);
    return el;
  };
  const all = App.media.filter(m => inScope(m, 'media'));
  side.appendChild(it(tr('All'), 'library', { type: 'all' }, all.length));
  side.appendChild(it(tr('Not in an event'), 'inbox', { type: 'unlinked' }, all.filter(m => !m.linked).length));
  side.appendChild(it(tr('Favorites'), 'star', { type: 'fav' }, all.filter(m => m.favorite).length));

  side.appendChild(h('.grp', tr('Albums'), h('button.btn.ghost.sm.icon', { title: tr('New album'), onclick: newAlbum }, icon('plus'))));
  if (!App.albums.length) side.appendChild(h('.it.faint', { style: { cursor: 'default' } }, icon('folder-plus'), h('span.small', tr('No albums yet'))));
  App.albums.forEach(a => side.appendChild(it(a.name, 'folder', { type: 'album', id: a.id }, a.n, {
    drop: ids => API.call('media.bulk', { ids, op: 'album_add', value: a.id }).then(() => { toast(tr('Added to album {name}', { name: a.name })); App.refresh('media', 'meta'); }),
    menu: e => menu(e, [
      { label: tr('Rename'), icon: 'pencil', onClick: async () => { const n = await promptDialog(tr('Rename album'), tr('Name'), a.name); if (n) { await API.call('album.rename', { id: a.id, name: n }); App.refresh('meta'); } } },
      { label: tr('Delete album'), icon: 'trash-2', danger: true, onClick: async () => { if (await confirmDialog(tr('Delete album'), tr('Delete album “{name}”? The videos will stay.', { name: a.name }), { danger: true, okLabel: tr('Delete') })) { await API.call('album.delete', { id: a.id }); S.filter = { type: 'all' }; App.refresh('meta'); } } },
    ]),
  })));

  const counts = new Map();
  all.forEach(m => (m.chars || []).forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
  const inVideos = App.chars.filter(c => counts.get(c.id));
  if (inVideos.length) {          // no empty heading when no character is tagged in a video yet
    side.appendChild(h('.grp', tr('Characters')));
    inVideos.forEach(c => {
      const row = it(c.name, null, { type: 'char', id: c.id }, counts.get(c.id));
      row.insertBefore(avatar(c, 18), row.firstChild);
      side.appendChild(row);
    });
  }

  if (App.tags.length) {
    side.appendChild(h('.grp', tr('Tags')));
    App.tags.forEach(([t, n]) => side.appendChild(it('#' + t, null, { type: 'tag', tag: t }, n)));
  }
}

function gameColor(g) {
  let x = 0; for (const ch of g || '') x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[x % PALETTE.length];
}

function dropZone(el, onIds) {
  el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('application/x-media')) { e.preventDefault(); el.classList.add('drop-target'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', e => {
    el.classList.remove('drop-target');
    const raw = e.dataTransfer.getData('application/x-media');
    if (raw) { e.preventDefault(); onIds(JSON.parse(raw)); }
  });
}
window.mediaDropZone = dropZone;

async function loadAlbum() {
  if (S.filter.type === 'album') {
    const ids = await API.call('album.items', { id: S.filter.id });
    S.albumItems = new Set(ids); S.albumOrder = new Map(ids.map((id, i) => [id, i]));
  } else { S.albumItems = null; S.albumOrder = null; }
}

async function newAlbum(ids) {
  const name = await promptDialog(tr('New album'), tr('Album name'), '', { placeholder: tr('e.g. Best moments') });
  if (!name) return;
  await API.call('album.create', { name, ids: Array.isArray(ids) ? ids : null });
  toast(tr('Album “{name}” created', { name }));
  App.refresh('meta', 'media');
}

/* ---------------- grid ---------------- */
let root, side, grid, gridWrap, insp, head, bulk, countEl, heroEl;

function renderHero() {
  if (!heroEl) return;
  const f = { game: App.scope.game };
  if (!f.game) { heroEl.classList.add('hidden'); clear(heroEl); return; }
  const list = App.media.filter(m => inScope(m, 'media'));
  const sess = list.filter(m => m.type !== 'clip');
  const latest = [...list].sort((a, b) => (b.start || 0) - (a.start || 0))[0];
  const gg = Shell.games().find(g => g.game === f.game) || {};
  const cover = { thumb: gg.banner || gg.thumb };
  if (!cover.thumb) cover.thumb = (list.find(m => m.thumb) || {}).thumb;
  const total = list.reduce((s, m) => s + (m.duration || 0), 0);
  const nEv = App.events.filter(e => e.link_count && e.start_time).length;
  const stat = (k, v) => h('.stat', h('.k', k), h('.v', v));
  heroEl.classList.remove('hidden');
  clear(heroEl).append(
    h('.bgimg', { style: cover.thumb ? { backgroundImage: `url("${cover.thumb}")` } : { background: gameHue(f.game) } }),
    h('.in',
      h('.grow',
        h('h2', f.game),
        h('.stats',
          stat(tr('Recorded'), fmt.durHuman(total)),
          stat(tr('Full recordings'), String(sess.length)),
          stat(tr('Clips'), String(list.length - sess.length)),
          stat(tr('Latest'), latest && latest.start ? fmt.rel(latest.start) : '—'))),
      latest ? h('button.btn.play', { onclick: () => play(latest) }, icon('play'), tr('Play latest')) : null,
      h('button.btn', { onclick: () => App.go('events', { propose: true }) }, icon('wand-sparkles'), tr('Suggest events')),
      h('button.btn.icon', { title: tr('Game icon and banner'), onclick: () => gameArtDialog(f.game) }, icon('image'))));
  void nEv;
}

function render() {
  if (!root) return;
  renderSide(side);
  renderHero();
  renderGrid();
  renderInspector();
}

function card(m) {
  const playing = App.player.media_id === m.id;
  const el = h('.mcard' + (S.sel.has(m.id) ? '.sel' : '') + (playing ? '.playing' : '') + (m.missing ? '.missing' : '') + (S.size < 200 ? '.compact' : ''), {
    draggable: 'true', 'data-id': m.id,
    onclick: e => select(m.id, e),
    ondblclick: () => play(m),
    oncontextmenu: e => { if (!S.sel.has(m.id)) { S.sel.clear(); S.sel.add(m.id); S.anchor = m.id; refreshSel(); } cardMenu(e); },
    ondragstart: e => {
      if (!S.sel.has(m.id)) { S.sel.clear(); S.sel.add(m.id); refreshSel(); }
      e.dataTransfer.setData('application/x-media', JSON.stringify([...S.sel]));
      e.dataTransfer.effectAllowed = 'copyLink';
    },
  },
  h('.th', { 'data-rmid': m.id }, m.thumb ? h('img', { src: m.thumb, loading: 'lazy', draggable: 'false' }) : h('.empty', { style: { padding: '30px' } }, icon('film')),
    h('span.badge.' + m.type, KIND[m.type]?.label),
    h('.flags', m.favorite ? h('span', { title: tr('Favorites') }, icon('star')) : null,
      m.linked ? h('span', { title: tr('In an event') }, icon('link')) : null,
      m.sidecars ? h('span', { title: tr('Separate audio tracks') }, icon('audio-lines')) : null,
      m.tr && m.tr.speech ? h('span.tr-flag', { title: tr('Has a speech transcript') }, icon('captions')) : null,
      m.tr && m.tr.vision ? h('span.tr-flag.vis', { title: tr('Has picture descriptions') }, icon('scan-eye')) : null),
    h('span.dur', fmt.dur(m.duration)),
    m.duration ? h('.bm', (m.bookmarks || []).filter(b => b.source !== 'auto' || b.event_id).map(b => h('b', {
      style: { left: (b.t / m.duration * 100) + '%', width: b.t_end ? Math.max(0.6, (b.t_end - b.t) / m.duration * 100) + '%' : null, background: b.color || null },
    }))) : null,
    resumeBar(m),
    h('.pl', { onclick: e => { e.stopPropagation(); play(m); } }, h('span', icon('play')))),
  h('.meta',
    h('.t.ellipsis', m.name, testChip(m)),
    h('.s', h('span.ellipsis', `${fmt.time(m.start)} · ${m.game}`)),
    (m.tags.length || (m.chars || []).length) ? h('.tags',
      (m.chars || []).length ? avatarStack(m.chars, 20, 4) : null,
      m.tags.slice(0, 4).map(t => h('span.tag', '#' + t))) : null,
    trHit(m)));
  return el;
}

function renderGrid() {
  const items = filtered();
  S.items = items;
  clear(grid);
  grid.style.setProperty('--card-w', S.size + 'px');
  if (!items.length) {
    grid.appendChild(h('div', { style: { gridColumn: '1/-1' } }, emptyState('search-x', tr('Nothing here'),
      S.q ? tr('Try a different search or turn on more recording types.') : tr('No videos in this filter yet.'))));
  }
  let lastDay = null;
  const dayTotals = {};
  if (S.group && S.sort in { new: 1, old: 1 }) items.forEach(m => { const k = m.start ? new Date(m.start * 1000).toDateString() : '?'; dayTotals[k] = (dayTotals[k] || 0) + (m.duration || 0); });
  const frag = document.createDocumentFragment();
  for (const m of items) {
    if (S.group && S.sort in { new: 1, old: 1 }) {
      const k = m.start ? new Date(m.start * 1000).toDateString() : '?';
      if (k !== lastDay) {
        lastDay = k;
        const n = items.filter(x => x.start && new Date(x.start * 1000).toDateString() === k).length;
        frag.appendChild(h('.lib-day', h('h3', m.start ? fmt.dateLong(m.start) : tr('No date')),
          h('span.faint', `${trn(n, '{n} video', '{n} videos')} · ${fmt.durHuman(dayTotals[k])}`), h('.line')));
      }
    }
    frag.appendChild(card(m));
  }
  grid.appendChild(frag);
  const total = items.reduce((s, m) => s + (m.duration || 0), 0);
  countEl.textContent = `${trn(items.length, '{n} video', '{n} videos')} · ${fmt.durHuman(total)}`;
  const svx = App.scope.server && App.serversById.get(App.scope.server);
  Shell.header({ icon: App.scope.game ? 'gamepad-2' : 'clapperboard', title: App.scope.game ? (svx ? `${App.scope.game} · ${svx.name}` : App.scope.game) : tr('library'), topic: countEl.textContent,
    actions: [h('button.tb-btn', { title: tr('Load new recordings (F5)'), onclick: () => { API.call('rescan'); toast(tr('Looking for new recordings…')); } }, icon('refresh-cw'))] });
  renderBulk();
}

function refreshSel() {
  $$('.mcard', grid).forEach(c => c.classList.toggle('sel', S.sel.has(Number(c.dataset.id))));
  renderInspector(); renderBulk();
}

function select(id, e) {
  if (e.shiftKey && S.anchor != null) {
    const ids = S.items.map(m => m.id);
    const a = ids.indexOf(S.anchor), b = ids.indexOf(id);
    if (!e.ctrlKey) S.sel.clear();
    ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => S.sel.add(x));
  } else if (e.ctrlKey || e.metaKey) {
    S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); S.anchor = id;
  } else {
    S.sel.clear(); S.sel.add(id); S.anchor = id;
  }
  refreshSel();
}

function play(m, offset) { API.call('media.play', { id: m.id, offset: offset ?? null }); }
function selected() { return [...S.sel].map(id => App.mediaById.get(id)).filter(Boolean); }

/* ---------------- actions ---------------- */
async function linkToEvent(ms) {
  const times = ms.map(m => m.start).filter(Boolean);
  const r = await pickEvent({ moment: times.length ? Math.min(...times) : null });
  if (!r) return;
  const n = await API.call('link.add', { event_id: r.id, media_ids: ms.map(m => m.id), note: r.note });
  toast(tr('Linked to event ({n})', { n }), 'ok', { label: tr('Open'), fn: () => App.go('events', { id: r.id }) });
  App.refresh('media', 'events');
}
async function eventFromSelection(ms) {
  const times = ms.map(m => m.start).filter(Boolean);
  const start = times.length ? Math.min(...times) : null;
  const end = ms.length ? Math.max(...ms.map(m => m.end || m.start || 0)) : null;
  const def = ms.length === 1 ? ms[0].name : `${ms[0].game} – ${start ? fmt.date(start) : ''}`;
  const title = await promptDialog(tr('New event'), trn(ms.length, 'Event name ({n} recording will be linked)', 'Event name ({n} recordings will be linked)'), def);
  if (!title) return;
  const id = await API.call('event.create', { title, start, end, media_ids: ms.map(m => m.id) });
  await App.refresh('media', 'events');
  App.go('events', { id });
}
async function addTags(ms) {
  const t = await promptDialog(tr('Add tags'), trn(ms.length, 'Tags for {n} video', 'Tags for {n} videos'), '', { placeholder: tr('#kidnapping #police') });
  if (!t) return;
  const tags = t.split(/[\s,]+/).map(x => x.replace(/^#/, '')).filter(Boolean);
  await API.call('media.bulk', { ids: ms.map(m => m.id), op: 'add_tags', value: tags });
  App.refresh('media', 'meta');
}
async function addChars(ms) {
  const ids = await pickCharacters([], { title: tr('Who is in the video?') });
  if (!ids || !ids.length) return;
  for (const c of ids) await API.call('media.bulk', { ids: ms.map(m => m.id), op: 'char_add', value: c });
  App.refresh('media', 'chars');
}
async function deleteMedia(ms) {
  const size = ms.reduce((s, m) => s + (m.size || 0), 0);
  const names = ms.slice(0, 6).map(m => '• ' + m.name).join('\n') + (ms.length > 6 ? '\n…' : '');
  const linked = ms.filter(m => m.linked).length;
  const ok = await confirmDialog(tr('Delete to Recycle Bin'),
    trn(ms.length, 'Move {n} video ({size}) to the Recycle Bin?', 'Move {n} videos ({size}) to the Recycle Bin?', { size: fmt.size(size) }) + `\n\n${names}` +
    (linked ? '\n\n' + trn(linked, '{n} of them is in events – the links will disappear.', '{n} of them are in events – the links will disappear.') : '') +
    '\n\n' + tr('Medal will then show them as missing in its library.'), { danger: true, okLabel: tr('Move to Recycle Bin') });
  if (!ok) return;
  const r = await API.call('media.delete', { ids: ms.map(m => m.id) });
  S.sel.clear();
  if (r.failed.length) toast(tr('Some videos could not be deleted: {list}', { list: r.failed.join(', ') }), 'err');
  else toast(tr('Moved to the Recycle Bin: {n}', { n: ms.length }));
  App.refresh('media', 'events', 'meta');
}

function cardMenu(e) {
  const ms = selected(); if (!ms.length) return;
  const one = ms.length === 1 ? ms[0] : null;
  const fav = ms.every(m => m.favorite);
  menu(e, [
    one ? { label: tr('Play'), icon: 'play', onClick: () => play(one) } : null,
    one ? { label: tr('Play in a separate window'), icon: 'picture-in-picture-2', onClick: () => API.call('media.play', { id: one.id, popout: true }) } : null,
    { sep: true },
    { label: tr('Link to event…'), icon: 'link', onClick: () => linkToEvent(ms) },
    { label: tr('New event from selection'), icon: 'calendar-plus', onClick: () => eventFromSelection(ms) },
    { label: tr('Tag characters…'), icon: 'users', onClick: () => addChars(ms) },
    { label: tr('Add tags…'), icon: 'tag', onClick: () => addTags(ms) },
    { label: tr('Transcript'), icon: 'captions', submenu: [
      { label: tr('Transcribe speech'), icon: 'audio-lines', onClick: () => transcribe(ms, { chapters: false }) },
      { label: tr('Speech + Kosmas AI'), icon: 'sparkles', onClick: () => transcribe(ms, { chapters: true }) },
      { label: tr('Speech + picture in conversations + Kosmas AI'), icon: 'wand-sparkles', onClick: () => transcribe(ms, { vision: true, chapters: true }) },
      { sep: true },
      { label: tr('Transcription queue'), icon: 'list-ordered', onClick: () => App.go('transcripts') },
    ] },
    { label: tr('Add to album'), icon: 'folder-plus', submenu: [
      ...App.albums.map(a => ({ label: a.name, icon: 'folder', onClick: async () => { await API.call('media.bulk', { ids: ms.map(m => m.id), op: 'album_add', value: a.id }); toast(tr('Added to “{name}”', { name: a.name })); App.refresh('meta'); } })),
      App.albums.length ? { sep: true } : null,
      { label: tr('New album…'), icon: 'plus', onClick: () => newAlbum(ms.map(m => m.id)) },
    ] },
    S.filter.type === 'album' ? { label: tr('Remove from album'), icon: 'folder-minus', onClick: async () => { await API.call('media.bulk', { ids: ms.map(m => m.id), op: 'album_remove', value: S.filter.id }); await loadAlbum(); App.refresh('meta'); } } : null,
    { label: tr('Change type'), icon: 'shapes', submenu: [
      { label: tr('Automatic'), onClick: () => bulk_('kind', null) },
      ...Object.entries(KIND).map(([k, v]) => ({ label: v.label, icon: v.icon, onClick: () => bulk_('kind', k) })),
    ] },
    { label: fav ? tr('Remove from favorites') : tr('Add to favorites'), icon: 'star', onClick: () => bulk_('favorite', !fav) },
    { sep: true },
    one ? { label: tr('Edit info…'), icon: 'pencil', onClick: () => editMediaDialog(one) } : null,
    { label: 'Server', icon: 'server', submenu: [
      ...App.servers.filter(s => ms.every(m => m.game === s.game)).map(s => ({ label: s.name, onClick: async () => { await API.call('server.assign', { type: 'media', ids: ms.map(m => m.id), server_id: s.id }); App.refresh('media'); } })),
      { label: tr('No server'), onClick: async () => { await API.call('server.assign', { type: 'media', ids: ms.map(m => m.id), server_id: null }); App.refresh('media'); } },
    ] },
    one ? { label: tr('Show in folder'), icon: 'folder-open', onClick: () => API.call('media.reveal', { id: one.id }) } : null,
    testMenuItem('media', ms),
    { label: tr('Delete to Recycle Bin…'), icon: 'trash-2', danger: true, onClick: () => deleteMedia(ms) },
  ]);
  async function bulk_(op, value) { await API.call('media.bulk', { ids: ms.map(m => m.id), op, value }); App.refresh('media'); }
}

function renderBulk() {
  if (!bulk) return;
  const n = S.sel.size;
  bulk.classList.toggle('hidden', n < 2);
  if (n < 2) return;
  const ms = selected();
  clear(bulk).append(
    h('b', tr('{n} selected', { n })), h('span.faint.small', fmt.durHuman(ms.reduce((s, m) => s + (m.duration || 0), 0))), h('.vsep'),
    h('button.btn.sm', { onclick: () => linkToEvent(ms) }, icon('link'), tr('To event')),
    h('button.btn.sm', { onclick: () => eventFromSelection(ms) }, icon('calendar-plus'), tr('New event')),
    h('button.btn.sm', { onclick: () => addChars(ms) }, icon('users'), tr('Characters')),
    h('button.btn.sm', { onclick: () => addTags(ms) }, icon('tag'), tr('Tags')),
    h('button.btn.sm', { onclick: e => cardMenu(e) }, icon('ellipsis')),
    h('button.btn.sm.ghost.icon', { title: tr('Clear selection'), onclick: () => { S.sel.clear(); refreshSel(); } }, icon('x')));
}

/* ---------------- inspector ---------------- */
let inspToken = 0, lastDetail = false;
/** True while the video info is shown under the docked player instead (second pane). */
function detailPaneShown() { return !!(App.player && App.player.detail); }

async function renderInspector() {
  const ms = selected();
  if (ms.length !== 1 || detailPaneShown()) { insp.classList.add('hidden'); return; }
  insp.classList.remove('hidden');
  const token = ++inspToken;
  await mediaPanel(insp, ms[0].id, { isCurrent: () => token === inspToken, rerender: renderInspector });
}

/** Full info/editing panel for one video (library inspector, pane under the player, edit dialog). */
async function mediaPanel(box, id, { hero = true, isCurrent = () => true, rerender = () => {} } = {}) {
  const m = await API.call('media.get', { id });
  if (!isCurrent() || !m) return;
  clear(box);
  const save = async fields => {
    await API.call('media.update', { id: m.id, ...fields });
    App.refresh('media', 'meta');
  };
  const title = h('input.input.bare.title-in', { value: m.title || '', placeholder: m.medal_title || m.name,
    onchange: e => save({ title: e.target.value.trim() || null }), onkeydown: e => { if (e.key === 'Enter') e.target.blur(); } });
  const desc = h('textarea.input', { rows: 3, placeholder: tr('Notes, what happened, who was there…'), onchange: e => save({ description: e.target.value }) }, m.description || '');

  const gameIn = h('input.input', { value: m.game || '', list: 'lib-games', onchange: e => e.target.value.trim() && save({ game: e.target.value.trim() }) });
  const kindSeg = h('.seg', [['', 'Auto'], ...Object.entries(KIND).map(([k, v]) => [k, v.label])].map(([k, label]) =>
    h('button' + ((m.kind_override || '') === k ? '.on' : ''), { onclick: () => save({ kind_override: k || null }) }, label)));

  box.append(
    hero ? h('.hero', { 'data-rmid': m.id, onclick: () => play(m) }, m.thumb ? h('img', { src: m.thumb }) : null, resumeBar(m), h('.pl', h('span', icon('play')))) : null,
    h('.pad.col', { style: { gap: '12px' } },
      h('.row', title, h('button.btn.ghost.icon' + (m.favorite ? '.active' : ''), { title: tr('Favorites'), onclick: () => save({ favorite: !m.favorite }) }, icon('star'))),
      h('.row.small.muted.wrap', h('span.badge.' + m.type, KIND[m.type]?.label), h('span', fmt.range(m.start, m.end)), h('span.faint', '· ' + fmt.dur(m.duration))),
      tagEditor(m.tags, tags => save({ tags })),
      desc,
      h('.section-title', icon('users'), tr('Characters'), h('.line')),
      h('.row.wrap', (m.chars || []).map(id => App.charsById.get(id)).filter(Boolean).map(c =>
        charChip(c, { onRemove: () => save({ chars: m.chars.filter(x => x !== c.id) }) })),
      h('button.btn.sm', { onclick: async () => { const ids = await pickCharacters(m.chars || [], { title: tr('Who is in the video?') }); if (ids) save({ chars: ids }); } }, icon('user-plus'), tr('Tag'))),
      h('.section-title', icon('calendar-range'), tr('Events'), h('.line')),
      h('.rowlist', m.links.length ? m.links.map(l => h('.list-row', { onclick: () => App.go('events', { id: l.event_id }) },
        h('span.dot', { style: { background: App.eventsById.get(l.event_id)?.color || 'var(--accent)' } }),
        h('.grow.ellipsis', l.event_title), l.offset != null ? h('span.kbd', fmt.clock(l.offset)) : null)) :
        h('.faint.small', { style: { padding: '2px 8px' } }, tr('Not in any event yet'))),
      h('.row', h('button.btn.sm', { onclick: () => linkToEvent([m]) }, icon('link'), tr('Link to event')),
        h('button.btn.sm.ghost', { onclick: () => eventFromSelection([m]) }, icon('calendar-plus'), tr('New event'))),
      h('.section-title', icon('folder'), tr('Albums'), h('.line')),
      h('.row.wrap', App.albums.map(a => h('span.chip' + (m.albums.includes(a.id) ? '.on' : ''), {
        onclick: async () => { await API.call('media.bulk', { ids: [m.id], op: m.albums.includes(a.id) ? 'album_remove' : 'album_add', value: a.id }); App.refresh('meta'); rerender(); },
      }, a.name)), h('span.chip', { onclick: () => newAlbum([m.id]) }, icon('plus'), tr('New'))),
      h('.section-title', icon('bookmark'), tr('Moments') + (m.bm_full.length ? ' · ' + m.bm_full.length : ''), h('.line'),
        h('button.btn.sm.ghost', { title: tr('Moment at the current playback position (B)'), onclick: () => addBookmarkHere(m.id).then(rerender) }, icon('bookmark-plus'), tr('Add'))),
      m.bm_full.length ? h('div', bmStrip(m, m.bm_full, { onChange: rerender }),
        h('div', m.bm_full.filter(b => b.source !== 'auto' || b.event_id || b.note).map(b => bmRow(b, { onChange: rerender }))),
        m.bm_full.some(b => b.source === 'auto' && !b.event_id && !b.note) ? h('.tiny.faint', { style: { padding: '2px 10px' } },
          trn(m.bm_full.filter(b => b.source === 'auto' && !b.event_id && !b.note).length, '+ {n} automatic game moment (grey ticks)', '+ {n} automatic game moments (grey ticks)')) : null)
        : h('.faint.small', { style: { padding: '2px 8px' } }, tr('Press B during playback. Shift+B marks the start and end of a section.')),
      window.transcriptSection ? window.transcriptSection(m) : null,
      h('.section-title', icon('info'), tr('Details'), h('.line')),
      h('.kv',
        h('.k', tr('Game')), gameIn,
        h('.k', 'Server'), serverPicker(m.server_id, async id => { await API.call('media.update', { id: m.id, server_id: id }); await App.refresh('media'); rerender(); }, m.game),
        h('.k', 'YouTube'), h('input.input', { value: m.youtube || '', placeholder: tr('link or video ID – for the web chronicle'),
          title: tr('Only videos uploaded to YouTube are sent to the web (the files themselves are not uploaded)'),
          onkeydown: e => e.stopPropagation(), onchange: e => save({ youtube: e.target.value.trim() || null }) }),
        h('.k', tr('Type')), kindSeg,
        h('.k', tr('Size')), h('div', fmt.size(m.size)),
        h('.k', tr('Audio')), h('div', (m.tracks.length ? m.tracks.map(t => ({ all: tr('All'), game: tr('Game'), mic: tr('Microphone'), discord: 'Discord', system: tr('System') }[t.role] || t.name || tr('Track'))).join(', ') : '—') + (m.sidecars ? ' ' + tr('+ {n} separate', { n: m.sidecars }) : '')),
        h('.k', tr('File')), h('.small.faint', { style: { wordBreak: 'break-all' } }, m.path)),
      h('datalist', { id: 'lib-games' }, App.games.map(([g]) => h('option', { value: g }))),
      h('.row', { style: { marginTop: '6px' } },
        h('button.btn', { onclick: () => play(m) }, icon('play'), tr('Play')),
        h('button.btn.ghost', { onclick: () => API.call('media.reveal', { id: m.id }) }, icon('folder-open'), tr('In folder')),
        h('button.btn.ghost', { title: tr('Video thumbnail'), onclick: e => menu(e, [
          { label: tr('Current frame from the player (T)'), icon: 'camera', disabled: App.player.media_id !== m.id, onClick: () => API.call('player.action', { act: 'thumb' }) },
          { label: tr('Choose image…'), icon: 'image-up', onClick: async () => { if (await API.call('media.thumb_pick', { id: m.id })) { await App.refresh('media'); rerender(); } } },
          m.custom_thumb ? { label: tr('Restore original thumbnail'), icon: 'rotate-ccw', onClick: async () => { await API.call('media.thumb_reset', { id: m.id }); await App.refresh('media'); rerender(); } } : null,
        ]) }, icon('image'), tr('Thumbnail')),
        h('.grow'),
        h('button.btn.danger', { onclick: () => deleteMedia([m]) }, icon('trash-2')))));
}

window.mediaPanel = mediaPanel;


function editMediaDialog(m) {
  const box = h('.lib-insp.in-modal');
  modal({ title: tr('Video info'), icon: 'pencil', wide: true, body: box, onClose: () => App.refresh('media', 'meta') });
  const rerender = () => mediaPanel(box, m.id, { hero: false, rerender });
  rerender();
}

function tagEditor(tags, onChange) {
  tags = [...tags];
  const box = h('.tag-input');
  const inp = h('input', { placeholder: tags.length ? '' : tr('#tag, Enter…'), list: 'lib-tags' });
  const render = () => {
    clear(box);
    tags.forEach(t => box.appendChild(h('span.chip', '#' + t, h('span.x', { onclick: () => { tags = tags.filter(x => x !== t); onChange(tags); render(); } }, icon('x')))));
    box.appendChild(inp);
    box.appendChild(h('datalist', { id: 'lib-tags' }, App.tags.map(([t]) => h('option', { value: t }))));
  };
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && inp.value.trim()) {
      e.preventDefault();
      const t = inp.value.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '_');
      if (t && !tags.includes(t)) { tags.push(t); onChange(tags); }
      inp.value = ''; render(); inp.focus();
    } else if (e.key === 'Backspace' && !inp.value && tags.length) { tags.pop(); onChange(tags); render(); inp.focus(); }
  });
  render();
  return box;
}
window.tagEditor = tagEditor;

/* ---------------- mount ---------------- */
let unsubs = [];
function onKey(e) {
  if (e.target.closest('input, textarea, [contenteditable="true"]')) return;
  if (e.key === 'Delete' && S.sel.size) { e.preventDefault(); deleteMedia(selected()); }
  else if (e.key === 'Enter' && S.sel.size === 1) { e.preventDefault(); play(selected()[0]); }
  else if (e.key === 'a' && e.ctrlKey) { e.preventDefault(); S.items.forEach(m => S.sel.add(m.id)); refreshSel(); }
  else if (e.key === 'Escape' && S.sel.size) { S.sel.clear(); refreshSel(); }
  else if (e.key === 'f' && e.ctrlKey) { e.preventDefault(); $('#lib-search').focus(); }
}

Views.register('library', {
  title: tr('Library'), short: tr('Library'), icon: 'clapperboard', order: 10,
  async mount(r, params) {
    root = r; S = S || state(); S.q = '';
    if (params.select) { S.filter = { type: 'all' }; S.sel = new Set(params.select); }
    if (S.filter.type === 'game') S.filter = { type: 'all' };
    if (params.game) { S.filter = { type: 'all' }; S.sel.clear(); Shell.setGuild(params.game); }
    if (params.char) { S.filter = { type: 'char', id: params.char }; S.sel.clear(); }
    side = h('.lib-side');
    Shell.slot().appendChild(side);
    const search = h('input.input#lib-search', { placeholder: tr('Search names, #tags, characters, games…  (Ctrl+F)'), value: S.q,
      oninput: debounce(e => { S.q = e.target.value; searchTranscripts(); }, 150), onkeydown: e => e.stopPropagation() });
    const kindChips = h('.row', Object.entries(KIND).map(([k, v]) => h('span.chip' + (S.kinds.has(k) ? '.on' : ''), {
      onclick: e => { S.kinds.has(k) ? S.kinds.delete(k) : S.kinds.add(k); e.currentTarget.classList.toggle('on'); persist(); renderGrid(); },
    }, icon(v.icon), v.plural)));
    const sortSel = h('select.input', { style: { width: '140px' }, onchange: e => { S.sort = e.target.value; persist(); renderGrid(); } },
      Object.entries(SORTS).map(([k, v]) => h('option', { value: k, selected: S.sort === k ? 'selected' : null }, v.label)));
    const size = h('input', { type: 'range', min: 170, max: 380, value: S.size, style: { width: '90px', accentColor: 'var(--accent)' },
      title: tr('Card size'), oninput: e => { S.size = +e.target.value; grid.style.setProperty('--card-w', S.size + 'px'); persist(); } });
    countEl = h('span.faint.small');
    heroEl = h('.game-hero.hidden');
    head = h('div',
      h('.toolbar', { style: { paddingTop: '14px' } },
        h('.search', { style: { flex: '1', minWidth: '240px', maxWidth: '520px' } }, icon('search'), search),
        kindChips,
        h('label.check', h('input', { type: 'checkbox', checked: S.showShort, onchange: e => { S.showShort = e.target.checked; persist(); renderGrid(); } }), tr('short recordings')),
        h('label.check', h('input', { type: 'checkbox', checked: S.group, onchange: e => { S.group = e.target.checked; persist(); renderGrid(); } }), tr('by day')),
        h('.grow'), icon('layout-grid', 'faint'), size, sortSel));
    grid = h('.lib-grid');
    gridWrap = h('.lib-grid-wrap', { onclick: e => { if (e.target === gridWrap || e.target === grid) { S.sel.clear(); refreshSel(); } } }, grid);
    bulk = h('.bulkbar.hidden');
    insp = h('.lib-insp.hidden');
    gridWrap.prepend(heroEl, head);
    root.appendChild(h('.lib', h('.lib-main', { style: { position: 'relative' } }, gridWrap, bulk), insp));
    await loadAlbum();
    render();
    if (params.select) { const first = $(`.mcard[data-id="${params.select[0]}"]`, grid); first && first.scrollIntoView({ block: 'center' }); }
    unsubs = [
      App.on('media', () => { for (const id of [...S.sel]) if (!App.mediaById.has(id)) S.sel.delete(id); loadAlbum().then(render); }),
      App.on('albums', () => renderSide(side)),
      App.on('gameart', () => renderHero()),
      App.on('chars', () => { renderSide(side); renderGrid(); }),
      App.on('events', () => renderInspector()),
      App.on('player', () => {
        $$('.mcard', grid).forEach(c => c.classList.toggle('playing', Number(c.dataset.id) === App.player.media_id));
        const d = detailPaneShown();
        if (d !== lastDetail) { lastDetail = d; renderInspector(); }
      }),
    ];
    document.addEventListener('keydown', onKey);
  },
  unmount() { unsubs.forEach(u => u()); unsubs = []; document.removeEventListener('keydown', onKey); root = null; },
});
})();
