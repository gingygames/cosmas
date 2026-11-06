/* ============================================================
   Galerie – all screenshots and images attached anywhere
   ============================================================ */
'use strict';

(() => {
  const CSS = `
  .gal-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .gal-scroll { flex: 1; overflow: auto; padding: 0 24px 40px; }
  .gal-month { font: 600 15px var(--font-display); margin: 22px 0 10px; display: flex; align-items: baseline; gap: 10px; text-transform: capitalize; }
  .gal-month .n { font: 400 12px var(--font); color: var(--text-3); text-transform: none; }
  .gal-grid { column-width: 260px; column-gap: 10px; }
  .gal-item { break-inside: avoid; margin-bottom: 10px; position: relative; border-radius: 12px; overflow: hidden; cursor: zoom-in;
    background: var(--surface-2); border: 1px solid var(--border); }
  .gal-item img { width: 100%; display: block; transition: transform .35s var(--ease); }
  .gal-item:hover img { transform: scale(1.03); }
  .gal-item .cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 26px 11px 9px;
    background: linear-gradient(transparent, rgba(0,0,0,.85)); color: #fff; opacity: 0; transition: opacity .2s; }
  .gal-item:hover .cap { opacity: 1; }
  .gal-item .cap .t { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gal-item .cap .o { font-size: 11px; color: #d6d9df; display: flex; gap: 6px; align-items: center; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .gal-item .src { position: absolute; top: 8px; right: 8px; height: 22px; padding: 0 7px; border-radius: 6px; background: rgba(0,0,0,.6);
    color: #fff; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; backdrop-filter: blur(4px); }
  .gal-item .src:hover { background: var(--accent); color: var(--accent-ink); }
  `;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);

  let root = null, state = null, unsubs = [];

  function mount(r) {
    root = r;
    state = { items: [], filter: App.ui.galFilter || 'all', q: '' };
    const search = h('input.input', { placeholder: tr('Search captions, events, characters…') });
    search.addEventListener('input', debounce(() => { state.q = search.value; render(); }, 150));
    search.addEventListener('keydown', e => e.stopPropagation());
    root.appendChild(h('.gal-wrap',
      h('.page-head', h('div', h('h1', tr('Gallery')), h('.sub.gal-sub', tr('Loading…'))), h('.grow')),
      h('.toolbar',
        h('.search', { style: { width: '340px' } }, icon('search'), search),
        h('.seg.gal-seg'),
      ),
      h('.gal-scroll')));
    renderSeg();
    unsubs.push(App.on('events', load), App.on('chars', load));
    load();
  }

  function unmount() { unsubs.forEach(u => u()); unsubs = []; root = null; }

  async function load() {
    const items = await API.call('gallery');
    if (!root) return;
    state.items = items.sort((a, b) => (b.taken_at || b.created_at || 0) - (a.taken_at || a.created_at || 0));
    render();
  }

  function renderSeg() {
    const seg = $('.gal-seg', root); clear(seg);
    [['all', tr('Everything'), 'images'], ['event', tr('Events'), 'calendar-days'], ['character', tr('Characters'), 'users']].forEach(([k, l, ic]) =>
      seg.appendChild(h('button' + (state.filter === k ? '.on' : ''), {
        onclick: () => { state.filter = k; App.ui.galFilter = k; App.saveUi(); renderSeg(); render(); },
      }, icon(ic), l)));
  }

  function filtered() {
    const term = state.q.trim().toLowerCase();
    return state.items.filter(a => {
      const type = a.owner_type === 'character' ? 'character' : 'event';
      if (state.filter !== 'all' && state.filter !== type) return false;
      if (term && !`${a.caption || ''} ${a.orig_name || ''} ${a.owner_title || ''}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }

  function render() {
    if (!root) return;
    const box = $('.gal-scroll', root); clear(box);
    const items = filtered();
    $('.gal-sub', root).textContent = trn(state.items.length, '{n} image', '{n} images');
    if (!state.items.length) {
      box.appendChild(emptyState('images', tr('No images yet'),
        h('div', { html: tr('Paste a screenshot with <span class="kbd">Ctrl+V</span> into an entry of an event or character,<br>or use <b>screenshot from video</b> in the player – it saves the current frame together with a link to the time in the video.') })));
      return;
    }
    if (!items.length) { box.appendChild(h('.faint', { style: { padding: '20px 0' } }, tr('Nothing matches the filter.'))); return; }
    const groups = new Map();
    for (const a of items) {
      const t = a.taken_at || a.created_at;
      const key = t ? fmt.month(t) : tr('no date');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    }
    for (const [month, arr] of groups) {
      box.appendChild(h('.gal-month', month, h('span.n', `${arr.length}`)));
      box.appendChild(h('.gal-grid', arr.map(a => tile(a, items))));
    }
  }

  function ownerIcon(a) { return a.owner_type === 'character' ? 'user' : 'calendar-days'; }

  function openOwner(a) {
    if (a.char_id) App.go('characters', { id: a.char_id });
    else if (a.event_id) App.go('events', { id: a.event_id });
  }

  function tile(a, list) {
    const t = a.taken_at || a.created_at;
    return h('.gal-item', {
      onclick: () => lightbox(list, list.indexOf(a)),
      oncontextmenu: e => itemMenu(e, a),
    },
    h('img', { src: a.url, loading: 'lazy', alt: a.caption || '' }),
    a.media_id ? h('span.src', { title: tr('Play the source video at this time'), onclick: e => { e.stopPropagation(); API.call('att.play_source', { id: a.id }); } },
      icon('play'), a.media_offset != null ? fmt.clock(a.media_offset) : tr('video')) : null,
    h('.cap',
      h('.t', a.caption || a.orig_name || tr('Image')),
      h('.o', icon(ownerIcon(a)), h('span.ellipsis', a.owner_title || '—'), t ? h('span', '· ' + fmt.dt(t)) : null)));
  }

  function itemMenu(e, a) {
    const ownerLabel = a.owner_type === 'character' ? tr('Open character') : tr('Open event');
    menu(e, [
      (a.event_id || a.char_id) ? { label: ownerLabel, icon: ownerIcon(a), onClick: () => openOwner(a) } : null,
      a.media_id ? { label: tr('Play source video'), icon: 'play', onClick: () => API.call('att.play_source', { id: a.id }) } : null,
      { label: tr('Edit caption'), icon: 'pencil', onClick: async () => {
        const v = await promptDialog(tr('Caption'), tr('Image caption'), a.caption || '');
        if (v === null) return;
        await API.call('att.update', { id: a.id, caption: v }); a.caption = v; render();
      } },
      { label: tr('Open in image viewer'), icon: 'external-link', onClick: () => API.call('att.open', { id: a.id }) },
      { label: tr('Show in folder'), icon: 'folder-open', onClick: () => API.call('att.reveal', { id: a.id }) },
      { sep: true },
      { label: tr('Delete'), icon: 'trash-2', danger: true, onClick: async () => {
        if (!await confirmDialog(tr('Delete image'), tr('Delete “{name}”? The file will be removed from the catalog data.', { name: a.caption || a.orig_name || tr('image') }), { danger: true, okLabel: tr('Delete') })) return;
        await API.call('att.delete', { id: a.id });
        state.items = state.items.filter(x => x.id !== a.id); render(); toast(tr('Image deleted'));
      } },
    ]);
  }

  Views.register('gallery', { title: tr('Gallery'), short: tr('Gallery'), icon: 'images', order: 50, mount, unmount });
})();
