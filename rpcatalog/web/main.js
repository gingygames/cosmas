/* ============================================================
   Boot + global wiring
   ============================================================ */
'use strict';

window.PANE = new URLSearchParams(location.search).get('pane');

/* refresh after the other page (main window / pane under the player) changed something */
const syncRefresh = debounce(async (methods) => {
  if (methods.has('ui.save')) {
    const b = await API.call('bootstrap');
    App.ui = b.settings.ui || {}; App.settings = b.settings; applyAppearance();
    methods.delete('ui.save');
    if (!methods.size) return;
  }
  await Promise.all([App.refresh('media', 'events', 'chars', 'meta'), App.loadServers()]);
  App.emit('bookmarks');
  App.emit('synced');
}, 350);
const pendingSync = new Set();
API.on('sync', d => {
  if (d.src === API.src) return;
  pendingSync.add(d.method);
  const m = new Set(pendingSync); pendingSync.clear();
  syncRefresh(m);
});

function playerKeys(e) {
  if (e.defaultPrevented) return;
  if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if ($('.backdrop')) return;
  let act = null;
  if (e.key === ' ') act = 'pause';
  else if (e.key === 'ArrowLeft') act = e.shiftKey ? '-30' : '-5';
  else if (e.key === 'ArrowRight') act = e.shiftKey ? '+30' : '+5';
  else if (e.key === 'f' && !e.ctrlKey) act = 'fs';
  else if (e.key === 'm' && !e.ctrlKey) act = 'mute';
  else if (e.key === 'p' && !e.ctrlKey) act = 'pin';
  else if (e.key === 's' && !e.ctrlKey) act = 'snap';
  else if (e.key.toLowerCase() === 'b' && !e.ctrlKey) act = e.shiftKey ? 'range' : 'bm';
  else if (e.key === 'c' && !e.ctrlKey) act = 'tagchar';
  else if (e.key === 'i' && !e.ctrlKey) act = 'clip_in';
  else if (e.key === 'o' && !e.ctrlKey) act = 'clip_out';
  else if (e.key === 't' && !e.ctrlKey) act = 'thumb';
  else if (e.ctrlKey && /^[1-9]$/.test(e.key)) act = 't' + e.key;
  else if (e.key === 'F5') { API.call('rescan'); toast('Hledám nové záznamy…'); e.preventDefault(); return; }
  if (act) { e.preventDefault(); API.call('player.action', { act }); }
}

/* ---------- pane under the docked player: info + editing of the playing video ---------- */
async function bootDetailPane() {
  await API.init();
  await App.boot();
  applyAppearance();
  document.documentElement.classList.add('pane-detail');
  const root = $('#app');
  const box = h('.lib-insp.pane');
  const scroller = h('.pane-scroll', box);
  let cur = null, token = 0;
  const render = async () => {
    const id = App.player.media_id;
    if (!id) { clear(root).append(emptyState('film', 'Nic se nepřehrává', 'Tady se ukážou a půjdou upravit informace o přehrávaném videu.')); return; }
    if (!root.contains(scroller)) clear(root).append(scroller);
    const t = ++token;
    const keep = scroller.scrollTop;
    await mediaPanel(box, id, { hero: false, isCurrent: () => t === token, rerender: render });
    if (cur === id) scroller.scrollTop = keep;
  };
  API.on('player', d => {
    App.player = d; App.emit('player', d);
    if (d.media_id !== cur) { cur = d.media_id; scroller.scrollTop = 0; render(); }
  });
  API.on('media-changed', () => App.refresh('media', 'events').then(render));
  API.on('bookmark', () => setTimeout(render, 150));
  App.on('synced', render);
  App.on('bookmarks', () => {});
  document.addEventListener('keydown', playerKeys);
  document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea, [contenteditable="true"]')) e.preventDefault(); });
  render();
}

(async () => {
  if (window.PANE === 'detail') return bootDetailPane();
  await API.init();
  await App.boot();
  applyAppearance();
  App.on('synced', () => {});
  Views.buildRail();
  (async () => {
    const missing = Shell.games().map(g => g.game).filter(g => !(App.gameArt[g] || {}).icon);
    const tried = new Set(App.ui.artTried || []);
    const todo = missing.filter(g => !tried.has(g));
    if (!todo.length) return;
    const r = await API.call('game.art_auto', { games: todo }).catch(() => null);
    App.ui.artTried = [...tried, ...todo]; App.saveUi();
    if (r && r.done.length) { App.gameArt = r.art; Shell.renderGuilds(); App.emit('gameart'); }
  })();
  const start = App.ui.view && Views.defs[App.ui.view] && App.ui.view !== 'settings' ? App.ui.view : 'home';
  App.go(start);

  /* notifications from Python */
  API.on('media-changed', () => App.refresh('media', 'events'));
  API.on('player', d => { App.player = d; App.emit('player', d); });
  API.on('navigate', d => App.go(d.view, d.params || {}));
  API.on('pin', async d => {
    // player asked to attach the current moment to an event
    const m = App.mediaById.get(d.media_id);
    const moment = m && m.start ? m.start + d.offset : null;
    const r = await pickEvent({ title: 'Záložka do události', moment });
    if (!r) return;
    await API.call('bm.create', { media_id: d.media_id, t: d.offset, event_id: r.id, title: r.note });
    toast(`Záložka ${fmt.clock(d.offset)} přidána do události`, 'ok', { label: 'Otevřít', fn: () => App.go('events', { id: r.id, tab: 'media' }) });
    bmChanged();
  });
  API.on('bookmark', d => {
    // B / Shift+B in the player created a bookmark
    toast(d.t_end != null ? `Úsek ${fmt.clock(d.t)}–${fmt.clock(d.t_end)} uložen` : `Záložka ${fmt.clock(d.t)} uložena`, 'ok',
      { label: 'Popsat', fn: () => bmEditor(d.id) });
    bmChanged();
  });
  API.on('snapshot', () => snapshotFlow());   // S / Snímek in the player
  API.on('tagchar', async d => {
    // O / "Postava" in the player: who is here at this moment (stored as a bookmark with characters)
    const ids = await pickCharacters([], { title: `Kdo je ve videu v ${fmt.clock(d.t)}?` });
    if (!ids || !ids.length) return;
    const names = ids.map(id => App.charsById.get(id)?.name).filter(Boolean);
    const id = await API.call('bm.create', { media_id: d.media_id, t: d.t, chars: ids, title: names.join(', ') });
    toast(`Označeno: ${names.join(', ')} v ${fmt.clock(d.t)}`, 'ok', { label: 'Upravit', fn: () => bmEditor(id) });
    bmChanged(); App.loadChars();
  });
  API.on('toast', d => toast(d.msg, d.type || 'ok'));
  API.on('clip-exported', d => {
    toast('Klip vyexportován', 'ok', { label: 'Ve složce', fn: () => API.call('media.reveal', { id: d.id }) });
    App.refresh('media');
  });
  API.on('resumed', d => {
    toast(`Pokračuji od ${fmt.clock(d.pos)}, kde jsi skončil`, 'ok', { label: 'Od začátku', fn: () => {
      API.call('player.action', { act: 'seek0' }); API.call('media.resume_clear', { id: d.media_id });
    } });
  });

  /* global player shortcuts (not while typing) */
  document.addEventListener('keydown', playerKeys);
  document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea, [contenteditable="true"]')) e.preventDefault(); });
})();
