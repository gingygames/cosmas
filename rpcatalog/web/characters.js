/* ============================================================
   Postavy – character database
   ============================================================ */
'use strict';

(() => {
  const CSS = `
  .ch-wrap { display: flex; height: 100%; min-height: 0; }
  .ch-side { width: 340px; flex: none; display: flex; flex-direction: column; border-right: 1px solid var(--border); background: var(--bg-2); min-height: 0; }
  .ch-side.grid-mode { width: 520px; }
  .ch-side .ch-head { padding: 18px 16px 10px; display: flex; align-items: center; gap: 8px; }
  .ch-side .ch-head h1 { margin: 0; font: 600 20px var(--font-display); flex: 1; }
  .ch-filters { padding: 0 16px 10px; display: flex; flex-direction: column; gap: 8px; }
  .ch-list { flex: 1; overflow: auto; padding: 4px 10px 16px; }
  .ch-group { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); margin: 14px 6px 6px; display: flex; gap: 8px; align-items: center; }
  .ch-group .n { color: var(--text-3); font-weight: 400; }
  .ch-row { display: flex; align-items: center; gap: 11px; padding: 8px 10px; border-radius: 10px; cursor: pointer; position: relative; }
  .ch-row:hover { background: var(--hover); }
  .rel-opts { max-height: 46vh; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
  .rel-grp { font-size: 11.5px; font-weight: 650; text-transform: uppercase; letter-spacing: .03em; color: var(--text-3); margin-top: 6px; }
  .ch-row.msel, .ch-card.msel { box-shadow: inset 0 0 0 2px var(--accent); background: var(--accent-soft); }
  .ch-bulk { flex: none; padding: 10px 12px; border-top: 1px solid var(--border); background: var(--bg-0); display: flex; flex-direction: column; gap: 8px; }
  .ch-row.on { background: var(--accent-soft); }
  .ch-row .nm { font-weight: 600; font-size: 13.5px; }
  .ch-row .meta { font-size: 11.5px; color: var(--text-3); }
  .ch-row .st { width: 9px; height: 9px; border-radius: 50%; position: absolute; left: 36px; top: 34px; border: 2px solid var(--bg-2); }
  .ch-row .cnt { margin-left: auto; font-size: 11px; color: var(--text-3); display: flex; align-items: center; gap: 4px; }
  .ch-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
  .ch-card { border-radius: 12px; background: var(--surface); border: 1px solid var(--border); overflow: hidden; cursor: pointer; transition: transform .15s var(--ease), border-color .15s; }
  .ch-card:hover { transform: translateY(-2px); border-color: var(--border-2); }
  .ch-card.on { border-color: rgba(227,179,65,.6); box-shadow: 0 0 0 2px var(--accent-soft); }
  .ch-card .pic { aspect-ratio: 1/1; background-size: cover; background-position: center top; display: grid; place-items: center; font: 700 34px var(--font-display); color: rgba(0,0,0,.6); position: relative; }
  .ch-card .pic .st { position: absolute; right: 8px; top: 8px; width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 2px rgba(0,0,0,.4); }
  .ch-card .info { padding: 8px 10px 10px; }
  .ch-card .nm { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ch-card .meta { font-size: 11px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .ch-detail { flex: 1; min-width: 0; overflow: auto; }
  .ch-hero { position: relative; padding: 28px 32px 22px; display: flex; gap: 26px; align-items: flex-end;
    background: linear-gradient(180deg, var(--ch-tint, rgba(227,179,65,.12)), transparent 85%); border-bottom: 1px solid var(--border); }
  .ch-portrait { width: 168px; height: 210px; flex: none; border-radius: 16px; background: var(--surface-2) center top / cover no-repeat;
    border: 1px solid var(--border-2); box-shadow: var(--shadow); cursor: pointer; position: relative; overflow: hidden;
    display: grid; place-items: center; font: 700 56px var(--font-display); color: rgba(0,0,0,.55); }
  .ch-portrait .ov { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
    background: rgba(0,0,0,.55); color: #fff; font: 500 12px var(--font); opacity: 0; transition: opacity .2s; }
  .ch-portrait .ov i { font-size: 22px; }
  .ch-portrait:hover .ov, .ch-portrait.drop-target .ov { opacity: 1; }
  .ch-portrait.dead { filter: grayscale(1) brightness(.75); }
  .ch-hero .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .ch-name { font: 700 30px/1.15 var(--font-display); letter-spacing: -.4px; background: transparent; border: 1px solid transparent; border-radius: 9px; padding: 2px 6px; margin-left: -7px; width: 100%; outline: none; }
  .ch-name:hover { border-color: var(--border); }
  .ch-name:focus { border-color: rgba(227,179,65,.5); background: var(--bg-2); }
  .ch-summary { font-size: 14px; color: var(--text-2); }
  .ch-hero { overflow: hidden; }
  .ch-hero > * { position: relative; z-index: 1; }
  .ch-hero > .ch-banner { position: absolute; z-index: 0; right: -40px; top: -30px; width: 380px; height: 380px; background: center / contain no-repeat;
    opacity: .13; filter: saturate(.8); pointer-events: none; }
  .ch-title { margin: 2px 0 0; font: 800 30px/1.15 var(--font-display); letter-spacing: -.4px; }
  .ch-kind { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px; border-radius: 4px; background: var(--surface-2); font-size: 12px; color: var(--text-2); }
  .ch-kind i { font-size: 13px; }
  .ch-info { display: flex; flex-wrap: wrap; gap: 8px 28px; margin-top: 6px; }
  .ch-kv .k { font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; color: var(--text-3); margin-bottom: 3px; }
  .ch-kv .v { font-size: 14px; }
  .ch-fate { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 6px; background: var(--danger-soft); color: var(--text); font-size: 13.5px; }
  .ch-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
  .ch-swatches { display: flex; gap: 6px; align-items: center; }
  .ch-swatch { width: 22px; height: 22px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; box-shadow: 0 0 0 1px var(--border-2); }
  .ch-swatch.on { border-color: #fff; }
  .ch-status { display: inline-flex; align-items: center; gap: 6px; }
  .ch-body { padding: 8px 32px 40px; display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(300px, 1fr); gap: 26px; }
  @media (max-width: 1250px) { .ch-body { grid-template-columns: 1fr; } }
  .ch-sec { margin-top: 18px; }
  .ch-sec .section-title { margin-top: 0; }
  .ch-rel { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 10px; }
  .ch-rel:hover { background: var(--hover); }
  .ch-rel .lbl { font-size: 12px; color: var(--accent-2); background: var(--accent-soft); padding: 1px 8px; border-radius: 99px; }
  .ch-rel .x { margin-left: auto; opacity: 0; }
  .ch-rel:hover .x { opacity: 1; }
  .ch-tl { position: relative; padding-left: 20px; }
  .ch-tl::before { content: ""; position: absolute; left: 6px; top: 6px; bottom: 6px; width: 2px; background: var(--border-2); border-radius: 2px; }
  .ch-tl-item { position: relative; padding: 8px 10px; border-radius: 10px; cursor: pointer; margin-bottom: 4px; }
  .ch-tl-item:hover { background: var(--hover); }
  .ch-tl-item::before { content: ""; position: absolute; left: -19px; top: 14px; width: 10px; height: 10px; border-radius: 50%; background: var(--ev, var(--accent)); box-shadow: 0 0 0 3px var(--bg); }
  .ch-tl-item .t { font-weight: 600; }
  .ch-tl-item .d { font-size: 11.5px; color: var(--text-3); }
  .ch-tl-item .roles { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 3px; }
  .ch-tl-item .role { font-size: 11px; padding: 0 7px; border-radius: 99px; background: var(--surface-3); color: var(--text-2); }
  .ch-tl-item .x { position: absolute; right: 6px; top: 8px; opacity: 0; }
  .ch-tl-item:hover .x { opacity: 1; }
  .ch-media { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .ch-media .cap { font-size: 11.5px; color: var(--text-2); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ch-entry { padding: 10px 12px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); margin-bottom: 8px; cursor: pointer; }
  .ch-entry:hover { border-color: var(--border-2); }
  .ch-entry .ev { font-size: 11.5px; color: var(--accent); }
  .ch-entry .ex { font-size: 13px; color: var(--text-2); margin-top: 3px; }
  .ch-atts { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
  .ch-att { aspect-ratio: 1/1; border-radius: 10px; background: var(--surface-2) center / cover; border: 1px solid var(--border); cursor: pointer; position: relative; overflow: hidden; display: grid; place-items: center; color: var(--text-3); }
  .ch-att .fn { position: absolute; left: 0; right: 0; bottom: 0; font-size: 10.5px; padding: 3px 6px; background: rgba(0,0,0,.6); color: #ddd; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ch-att.portrait { box-shadow: 0 0 0 2px var(--accent); }
  .ch-dropzone { border: 1.5px dashed var(--border-2); border-radius: 10px; display: grid; place-items: center; color: var(--text-3); font-size: 12px; cursor: pointer; aspect-ratio: 1/1; text-align: center; padding: 6px; }
  .ch-dropzone:hover { color: var(--text-2); border-color: rgba(227,179,65,.5); }
  `;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);

  let root = null, state = null, unsubs = [];

  const kindOrder = ['mine', 'player', 'npc'];
  const kindGroup = { mine: 'Moje postavy', player: 'Hráči', npc: 'NPC' };

  function mount(r, params = {}) {
    root = r;
    state = {
      q: '', kind: 'all', faction: '',
      layout: App.ui.charsLayout || 'list',
      id: params.id || App.ui.charId || null,
      detail: null, editor: null, editing: false,
    };
    if (state.id && !App.charsById.has(state.id)) state.id = null;
    if (!state.id && App.chars.length) state.id = App.chars[0].id;
    root.appendChild(h('.ch-wrap', h('.ch-side'), h('.ch-detail')));
    unsubs.push(App.on('chars', () => { renderList(); }));
    unsubs.push(App.on('events', () => { if (state.id) loadDetail(state.id, true); }));
    renderList();
    if (state.id) loadDetail(state.id); else renderEmptyDetail();
  }

  function unmount() {
    if (state && state.editor) state.editor.flush();
    unsubs.forEach(u => u()); unsubs = []; root = null;
  }

  /* ---------------- list ---------------- */
  function filtered() {
    const term = state.q.trim().toLowerCase();
    return App.chars.filter(c => inScope(c) &&
      (state.kind === 'all' || c.kind === state.kind) &&
      (!state.faction || (c.factions || []).some(f => f.name === state.faction) || (c.faction || '') === state.faction) &&
      (!term || `${c.name} ${c.aliases} ${c.faction} ${c.player} ${c.summary}`.toLowerCase().includes(term)));
  }

  function renderList() {
    if (!root) return;
    const side = $('.ch-side', root);
    clear(side);
    side.classList.toggle('grid-mode', state.layout === 'grid');
    const search = h('input.input', { placeholder: 'Hledat jméno, frakci, hráče…', value: state.q });
    search.addEventListener('input', debounce(() => { state.q = search.value; renderItems(); }, 120));
    search.addEventListener('keydown', e => e.stopPropagation());
    const factions = [...new Set(App.chars.flatMap(c => (c.factions || []).length ? c.factions.map(f => f.name) : (c.faction ? [c.faction] : [])))].sort((a, b) => a.localeCompare(b, 'cs'));
    const kindSeg = h('.seg',
      [['all', 'Vše'], ['mine', 'Moje'], ['player', 'Hráči'], ['npc', 'NPC']].map(([k, l]) =>
        h('button' + (state.kind === k ? '.on' : ''), { onclick: () => { state.kind = k; renderList(); } }, l)));
    const layoutSeg = h('.seg',
      h('button' + (state.layout === 'list' ? '.on' : ''), { title: 'Seznam', onclick: () => setLayout('list') }, icon('list')),
      h('button' + (state.layout === 'grid' ? '.on' : ''), { title: 'Karty', onclick: () => setLayout('grid') }, icon('layout-grid')));
    side.append(
      h('.ch-head', h('h1', 'Postavy'), layoutSeg,
        h('button.btn.primary.sm', { onclick: newCharacter }, icon('user-plus'), 'Nová')),
      h('.ch-filters',
        h('.search', icon('search'), search),
        h('.row', kindSeg),
        factions.length ? h('.row.wrap', { style: { gap: '5px' } },
          h('.chip' + (!state.faction ? '.on' : ''), { onclick: () => { state.faction = ''; renderList(); } }, 'Všechny frakce'),
          factions.map(f => h('.chip' + (state.faction === f ? '.on' : ''), { onclick: () => { state.faction = state.faction === f ? '' : f; renderList(); } }, f))) : null),
      h('.ch-list'),
      h('.tiny.faint', { style: { padding: '4px 16px 8px' } }, 'Ctrl / Shift + klik = výběr více postav k hromadné úpravě'));
    renderItems();
    renderBulkBar();
  }

  function setLayout(l) { state.layout = l; App.ui.charsLayout = l; App.saveUi(); renderList(); }

  function evCount(c) { return (c.counts && (c.counts.event || 0)) || 0; }

  function renderItems() {
    const list = $('.ch-list', root); if (!list) return;
    clear(list);
    const items = filtered();
    if (!App.chars.length) {
      list.appendChild(emptyState('users', 'Zatím žádné postavy', 'Založ svou postavu, hráče a NPC. Označuj je v zápisech přes @.',
        h('button.btn.primary', { onclick: newCharacter }, icon('user-plus'), 'Nová postava')));
      return;
    }
    if (!items.length) { list.appendChild(h('.faint.small', { style: { padding: '14px 8px' } }, 'Nic neodpovídá filtru.')); return; }
    const groups = state.kind === 'all' ? kindOrder.map(k => [k, items.filter(c => c.kind === k)]) : [[state.kind, items]];
    for (const [k, arr] of groups) {
      if (!arr.length) continue;
      if (state.kind === 'all') list.appendChild(h('.ch-group', icon(CHAR_KIND[k]?.icon || 'user'), kindGroup[k] || k, h('span.n', arr.length)));
      if (state.layout === 'grid') {
        list.appendChild(h('.ch-cards', arr.map(card)));
      } else {
        arr.forEach(c => list.appendChild(row(c)));
      }
    }
  }

  function row(c) {
    const st = CHAR_STATUS[c.status] || CHAR_STATUS.unknown;
    return h('.ch-row' + (c.id === state.id ? '.on' : '') + (sel.has(c.id) ? '.msel' : ''), { 'data-cid': c.id, onclick: e => clickChar(e, c), oncontextmenu: e => listMenu(e, c) },
      avatar(c, 38), h('span.st', { style: { background: st.color }, title: st.label }),
      h('.grow', h('.nm.ellipsis', c.name),
        h('.meta.ellipsis', [c.faction, c.player ? `hraje ${c.player}` : ''].filter(Boolean).join(' · ') || CHAR_KIND[c.kind]?.label)),
      evCount(c) ? h('.cnt', icon('calendar-days'), evCount(c)) : null);
  }

  function card(c) {
    const st = CHAR_STATUS[c.status] || CHAR_STATUS.unknown;
    const pic = h('.pic', { style: c.portrait ? { backgroundImage: `url("${c.portrait}")` } : { background: c.color || '#e3b341' } },
      c.portrait ? null : initials(c.name), h('span.st', { style: { background: st.color }, title: st.label }));
    if (c.status === 'dead') pic.style.filter = 'grayscale(1) brightness(.75)';
    return h('.ch-card' + (c.id === state.id ? '.on' : '') + (sel.has(c.id) ? '.msel' : ''), { 'data-cid': c.id, onclick: e => clickChar(e, c), oncontextmenu: e => listMenu(e, c) },
      pic, h('.info', h('.nm', c.name), h('.meta', [c.faction || CHAR_KIND[c.kind]?.label, evCount(c) ? `${evCount(c)} ud.` : ''].filter(Boolean).join(' · '))));
  }

  /* ---- multi-select + bulk editing ---- */
  const sel = new Set();
  let anchor = null;
  function clickChar(e, c) {
    if (e.ctrlKey || e.metaKey) {
      if (!sel.size && state.id) sel.add(state.id);
      sel.has(c.id) ? sel.delete(c.id) : sel.add(c.id); anchor = c.id;
    } else if (e.shiftKey && anchor != null) {
      const ids = filtered().map(x => x.id), a = ids.indexOf(anchor), b = ids.indexOf(c.id);
      ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(id => sel.add(id));
    } else {
      sel.clear(); anchor = c.id; select(c.id); return;
    }
    $$('[data-cid]', root).forEach(el => el.classList.toggle('msel', sel.has(Number(el.dataset.cid))));
    renderBulkBar();
  }
  function renderBulkBar() {
    let bar = $('.ch-bulk', root);
    const side = $('.ch-side', root);
    if (!side) return;
    if (!bar) { bar = h('.ch-bulk'); side.appendChild(bar); }
    if (sel.size < 2) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const ids = [...sel];
    const upd = async fields => { for (const id of ids) await API.call('char.update', { id, ...fields }); await App.loadChars(); renderList(); renderBulkBar(); toast(`Upraveno ${ids.length} postav`); };
    clear(bar).append(
      h('.row', h('b', `${ids.length} vybráno`), h('.grow'), h('button.btn.sm.ghost.icon', { title: 'Zrušit výběr', onclick: () => { sel.clear(); renderList(); renderBulkBar(); } }, icon('x'))),
      h('.row.wrap', { style: { gap: '6px' } },
        h('button.btn.sm', { onclick: e => menu(e, Object.entries(CHAR_KIND).map(([k, v]) => ({ label: v.label, icon: v.icon, onClick: () => upd({ kind: k }) }))) }, 'Typ'),
        h('button.btn.sm', { onclick: e => menu(e, Object.entries(CHAR_STATUS).map(([k, v]) => ({ label: v.label, onClick: () => upd({ status: k }) }))) }, 'Stav'),
        h('button.btn.sm', { onclick: e => menu(e, [...(App.factions || []).map(f => ({ label: f.name, onClick: async () => {
          const role = await promptDialog('Role', `Role ve „${f.name}“ (nepovinné)`, ''); if (role === null) return;
          await API.call('faction.members_add', { id: f.id, character_ids: ids, role }); await App.loadChars(); renderList(); renderBulkBar(); toast('Přidáno do frakce');
        } })), { sep: true }, { label: 'Nová frakce / rod…', icon: 'plus', onClick: async () => {
          const n = await promptDialog('Nová frakce / rod', 'Název', ''); if (!n) return;
          const fid = await API.call('faction.create', { name: n });
          await API.call('faction.members_add', { id: fid, character_ids: ids, role: '' }); App.factions = await API.call('factions.list'); await App.loadChars(); renderList(); renderBulkBar();
        } }]) }, 'Frakce'),
        h('button.btn.sm', { onclick: e => menu(e, [...(App.players || []).map(p => ({ label: p.name, onClick: () => upd({ player_id: p.id }) })),
          { sep: true }, { label: 'Nový hráč…', icon: 'plus', onClick: async () => { const n = await promptDialog('Nový hráč', 'Přezdívka', ''); if (!n) return; const pid = await API.call('player.create', { name: n }); App.players = await API.call('players.list'); upd({ player_id: pid }); } },
          { label: 'Bez hráče', onClick: () => upd({ player_id: null }) }]) }, 'Hráč'),
        h('button.btn.sm', { onclick: e => menu(e, PALETTE.map(col => ({ label: col, onClick: () => upd({ color: col }) }))) }, 'Barva'),
        h('button.btn.sm', { onclick: async () => {
          const r = await pickEvent({ title: `Přidat ${ids.length} postav do události`, withNote: false });
          if (!r) return;
          const role = await promptDialog('Role v události', 'Role (nepovinné)', '', { placeholder: 'např. svědci, stráž' });
          for (const id of ids) await API.call('char.link', { character_id: id, target_type: 'event', target_id: r.id, role: role || '' });
          await App.refresh('events', 'chars'); toast('Přidáno do události', 'ok', { label: 'Otevřít', fn: () => App.go('events', { id: r.id }) });
        } }, icon('calendar-plus'), 'Do události'),
        h('button.btn.sm.danger', { onclick: async () => {
          if (!await confirmDialog('Smazat postavy', `Opravdu smazat ${ids.length} postav?\nZmizí jejich profily, vztahy a přílohy.`, { danger: true, okLabel: 'Smazat' })) return;
          for (const id of ids) await API.call('char.delete', { id });
          sel.clear(); state.id = null; state.editor = null;
          await App.refresh('chars', 'events'); renderList(); renderBulkBar(); toast('Postavy smazány');
        } }, icon('trash-2'))));
  }

  function listMenu(e, c) {
    if (sel.size > 1 && sel.has(c.id)) { renderBulkBar(); return menu(e, [{ head: `${sel.size} vybraných postav – úpravy dole v seznamu` }]); }
    menu(e, [
      { label: 'Otevřít', icon: 'user', onClick: () => select(c.id) },
      { label: 'Přidat do události…', icon: 'calendar-plus', onClick: () => addToEvent(c.id) },
      { sep: true },
      { label: 'Smazat postavu', icon: 'trash-2', danger: true, onClick: () => deleteChar(c) },
    ]);
  }

  async function newCharacter() {
    const name = await promptDialog('Nová postava', 'Jméno postavy', '', { placeholder: 'např. Jindřich ze Skalice' });
    if (!name) return;
    const kind = state.kind !== 'all' ? state.kind : 'npc';
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const id = await API.call('char.create', { name, kind, color });
    await App.loadChars();
    select(id);
    toast('Postava vytvořena');
  }

  function select(id) {
    if (state.editor) state.editor.flush();
    flushSave();
    state.editing = false;
    state.id = id; App.ui.charId = id; App.saveUi();
    $$('.ch-row, .ch-card', root).forEach(el => el.classList.remove('on'));
    renderItems();
    loadDetail(id);
  }

  /* ---------------- detail ---------------- */
  function renderEmptyDetail() {
    const d = $('.ch-detail', root); clear(d);
    d.appendChild(h('div', { style: { height: '100%', display: 'grid', placeItems: 'center' } },
      emptyState('user-round', 'Vyber postavu', 'Nebo založ novou – profil, portrét, vztahy, události a zmínky na jednom místě.',
        h('button.btn.primary', { onclick: newCharacter }, icon('user-plus'), 'Nová postava'))));
  }

  async function loadDetail(id, keepScroll = false) {
    const d = $('.ch-detail', root); if (!d) return;
    const scroll = keepScroll ? d.scrollTop : 0;
    const c = await API.call('char.get', { id });
    if (!root || state.id !== id) return;
    if (!c) { state.id = null; renderEmptyDetail(); return; }
    state.detail = c;
    renderDetail(c);
    d.scrollTop = scroll;
  }

  // changes are collected and saved together (several quick edits must not overwrite each other)
  let pending = {}, pendingId = null;
  async function flushSave() {
    if (!pendingId || !Object.keys(pending).length) return;
    const fields = pending, id = pendingId; pending = {};
    await API.call('char.update', Object.assign({ id }, fields));
    App.loadChars();
  }
  const save = debounce(flushSave, 400);

  function update(fields) {
    if (pendingId !== state.detail.id) { flushSave(); pendingId = state.detail.id; }
    Object.assign(state.detail, fields);
    Object.assign(pending, fields);
    save();
  }

  function renderDetail(c) {
    const d = $('.ch-detail', root); clear(d);
    if (state.editor) { state.editor.flush(); state.editor = null; }
    d.style.setProperty('--ch-tint', hexA(c.color || '#e3b341', .16));

    /* portrait */
    const portrait = h('.ch-portrait' + (c.status === 'dead' ? '.dead' : ''), {
      title: 'Klikni pro změnu portrétu, nebo sem přetáhni / vlož (Ctrl+V) obrázek',
      style: c.portrait ? { backgroundImage: `url("${c.portrait}")` } : { background: c.color || '#e3b341' },
      onclick: e => menu(e, [
        { label: 'Vybrat obrázek ze souboru…', icon: 'image-up', onClick: async () => {
          const url = await API.call('char.portrait', { id: c.id });
          if (url) { await App.loadChars(); loadDetail(c.id, true); }
        } },
        { label: 'Vyříznout z přehrávaného videa', icon: 'crop', disabled: !App.player.media_id, onClick: async () => {
          const grab = await grabFrame();
          if (grab && await portraitFromGrab(grab, c.id)) loadDetail(c.id, true);
        } },
        c.portrait ? { label: 'Upravit výřez současného portrétu', icon: 'scan', onClick: async () => {
          const blob = await fetch(c.portrait).then(r => r.blob()).catch(() => null);
          if (!blob) return toast('Portrét nejde načíst', 'err');
          const src = await readAsDataURL(blob);
          await portraitFromGrab({ data: src, moment: null, caption: 'portrét', media_id: null, pos: null }, c.id);
          loadDetail(c.id, true);
        } } : null,
      ].filter(Boolean)),
    }, c.portrait ? null : initials(c.name), h('.ov', icon('image-up'), c.portrait ? 'Změnit portrét' : 'Přidat portrét'));
    portrait.addEventListener('dragover', e => { e.preventDefault(); portrait.classList.add('drop-target'); });
    portrait.addEventListener('dragleave', () => portrait.classList.remove('drop-target'));
    portrait.addEventListener('drop', async e => {
      e.preventDefault(); portrait.classList.remove('drop-target');
      const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
      if (files.length) setPortraitFromFiles(c.id, files);
    });

    /* ---- header: read-only view, "Upravit" switches the basic info to a form ---- */
    const st = CHAR_STATUS[c.status] || CHAR_STATUS.unknown;
    const evN = c.events.length, mN = c.media.length;
    const gone = c.status === 'dead' || c.status === 'missing';
    const statusEv = c.status_event_id && App.eventsById.get(c.status_event_id);
    const player = c.player_id && (App.players || []).find(p => p.id === c.player_id);
    const fChip = f => h('span.chip', { style: { borderLeft: `3px solid ${f.color || '#888'}` }, onclick: () => App.go('factions', { id: f.id }) },
      f.name, f.role ? h('span.faint', ' · ' + f.role) : null);
    const info = (k, v) => v ? h('.ch-kv', h('.k', k), h('.v', v)) : null;
    const view = () => h('.main',
      h('.row', { style: { gap: '8px' } },
        h('span.ch-kind', icon(CHAR_KIND[c.kind]?.icon || 'user'), CHAR_KIND[c.kind]?.label || ''),
        c.gender ? h('span.ch-kind', c.gender === 'f' ? 'žena' : 'muž') : null,
        h('span.ch-kind', h('span.dot', { style: { background: st.color } }), st.label),
        ptagChips(c.player_tags), h('.grow'),
        h('button.btn.sm', { onclick: () => { state.editing = true; renderDetail(state.detail); } }, icon('pencil'), 'Upravit'),
        h('button.btn.sm', { onclick: () => addToEvent(c.id) }, icon('calendar-plus'), 'Do události'),
        h('button.btn.sm.ghost.icon', { title: 'Další akce', onclick: e => menu(e, [
          { label: 'Změnit portrét…', icon: 'image-up', onClick: () => portrait.click() },
          c.portrait ? { label: 'Odebrat portrét', icon: 'image-off', onClick: async () => { await API.call('char.update', { id: c.id, portrait_id: null }); await App.loadChars(); loadDetail(c.id, true); } } : null,
          { sep: true },
          { label: 'Smazat postavu', icon: 'trash-2', danger: true, onClick: () => deleteChar(c) },
        ]) }, icon('ellipsis'))),
      h('h1.ch-title', c.name),
      c.aliases ? h('.small.muted', 'Také: ' + c.aliases) : null,
      c.summary ? h('.ch-summary', c.summary) : null,
      gone ? h('.ch-fate', icon(c.status === 'dead' ? 'skull' : 'circle-help'),
        h('span', c.status === 'dead' ? 'Zemřel/a' : 'Zmizel/a',
          c.status_ingame ? ` · ${c.status_ingame}` : '', c.status_date ? ` · ${fmt.date(c.status_date)}` : ''),
        statusEv ? h('a', { onclick: () => App.go('events', { id: statusEv.id }), style: { cursor: 'pointer' } }, ' → ', statusEv.title) : null,
        c.status_note ? h('.faint', { style: { width: '100%' } }, c.status_note) : null) : null,
      h('.ch-info',
        (c.factions || []).length ? h('.ch-kv', h('.k', 'Frakce a rody'), h('.v.row.wrap', { style: { gap: '6px' } }, c.factions.map(fChip))) :
          (c.faction ? info('Frakce', c.faction) : null),
        player ? h('.ch-kv', h('.k', 'Hraje'), h('.v', h('a', { style: { cursor: 'pointer' }, onclick: () => App.go('players', { id: player.id }) }, player.name))) : info('Hraje', c.player),
        h('.ch-kv', h('.k', 'V katalogu'), h('.v.faint', `${evN} ${fmt.plural(evN, 'událost', 'události', 'událostí')} · ${mN} ${fmt.plural(mN, 'záznam', 'záznamy', 'záznamů')}`))));

    const edit = () => {
      const field = (label, key, placeholder) => {
        const inp = h('input.input', { value: c[key] || '', placeholder });
        inp.addEventListener('input', () => update({ [key]: inp.value }));
        inp.addEventListener('keydown', e => e.stopPropagation());
        return h('label.field', label, inp);
      };
      const seg = (key, opts, after) => h('.seg', opts.map(([k, l, ic]) => h('button' + ((c[key] || '') === k ? '.on' : ''), {
        onclick: e => { update({ [key]: k }); c[key] = k; $$('button', e.currentTarget.parentNode).forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); after && after(); },
      }, ic ? icon(ic) : null, l)));
      const name = h('input.ch-name', { value: c.name, spellcheck: 'false' });
      name.addEventListener('input', () => update({ name: name.value.trim() || 'Bez jména' }));
      name.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); });
      const summary = h('input.input', { value: c.summary || '', placeholder: 'Krátký popis – kdo to je jednou větou', onkeydown: e => e.stopPropagation(), oninput: e => update({ summary: e.target.value }) });
      const fateBox = h('div');
      const renderFate = () => {
        clear(fateBox);
        if (c.status !== 'dead' && c.status !== 'missing') return;
        const ev = c.status_event_id && App.eventsById.get(c.status_event_id);
        const date = h('input.input', { type: 'date', value: c.status_date ? fmt.toInput(c.status_date).slice(0, 10) : '', style: { width: '160px' },
          onchange: e => update({ status_date: e.target.value ? new Date(e.target.value).getTime() / 1000 : null }) });
        fateBox.append(h('.ch-fields', { style: { marginTop: '4px' } },
          h('label.field', c.status === 'dead' ? 'Datum úmrtí (reálné)' : 'Zmizel/a (reálné datum)', date),
          h('label.field', 'Datum ve hře', h('input.input', { value: c.status_ingame || '', placeholder: 'např. léto 1403', onkeydown: e => e.stopPropagation(), oninput: e => update({ status_ingame: e.target.value }) })),
          h('label.field', 'Událost', h('.row',
            ev ? h('span.chip.on', { onclick: () => App.go('events', { id: ev.id }) }, h('span.dot', { style: { background: ev.color } }), ev.title) : h('span.faint.small', 'nepřipojeno'),
            h('button.btn.sm', { onclick: async () => { const r = await pickEvent({ title: 'Ve které události?', moment: c.status_date, withNote: false }); if (r) { update({ status_event_id: r.id }); c.status_event_id = r.id; renderFate(); } } }, icon('link'), ev ? 'Změnit' : 'Vybrat'),
            ev ? h('button.btn.sm.ghost.icon', { onclick: () => { update({ status_event_id: null }); c.status_event_id = null; renderFate(); } }, icon('x')) : null))),
          h('input.input', { value: c.status_note || '', placeholder: 'Jak se to stalo (nepovinné)', style: { marginTop: '8px' }, onkeydown: e => e.stopPropagation(), oninput: e => update({ status_note: e.target.value }) }));
      };
      renderFate();
      const facBox = h('.row.wrap', { style: { gap: '6px' } });
      const renderFac = () => {
        clear(facBox).append(...(c.factions || []).map(f => h('span.chip', { style: { borderLeft: `3px solid ${f.color || '#888'}` } }, f.name, f.role ? h('span.faint', ' · ' + f.role) : null,
          h('span.x', { onclick: async () => { await API.call('faction.member_remove', { id: f.id, character_id: c.id }); c.factions = c.factions.filter(x => x.id !== f.id); renderFac(); App.loadChars(); } }, icon('x')))),
        h('button.btn.sm', { onclick: e => menu(e, [
          ...(App.factions || []).filter(f => !(c.factions || []).some(x => x.id === f.id)).map(f => ({ label: f.name, onClick: async () => {
            const role = await promptDialog('Role', `Role postavy v „${f.name}“`, '', { placeholder: 'např. hlava rodu, člen' });
            if (role === null) return;
            await API.call('faction.members_add', { id: f.id, character_ids: [c.id], role });
            c.factions = [...(c.factions || []), { id: f.id, name: f.name, color: f.color, role }]; renderFac(); App.loadChars();
          } })),
          { sep: true },
          { label: 'Nová frakce / rod…', icon: 'plus', onClick: async () => {
            const n = await promptDialog('Nová frakce / rod', 'Název', ''); if (!n) return;
            const fid = await API.call('faction.create', { name: n, kind: /^(rod|páni)/i.test(n) ? 'rod' : 'frakce' });
            await API.call('faction.members_add', { id: fid, character_ids: [c.id], role: '' });
            App.factions = await API.call('factions.list'); await App.loadChars(); loadDetail(c.id, true);
          } },
        ]) }, icon('plus'), 'Přidat'));
      };
      renderFac();
      const playerSel = h('select.input', { style: { width: '220px' }, onchange: async e => {
        let v = e.target.value;
        if (v === '__new') {
          const n = await promptDialog('Nový hráč', 'Přezdívka hráče', ''); if (!n) { e.target.value = c.player_id || ''; return; }
          v = await API.call('player.create', { name: n }); App.players = await API.call('players.list');
        }
        update({ player_id: v ? Number(v) : null }); c.player_id = v ? Number(v) : null;
      } }, h('option', { value: '' }, '— nikdo / neznámý —'),
      (App.players || []).map(p => h('option', { value: p.id, selected: c.player_id === p.id }, p.name)), h('option', { value: '__new' }, '+ nový hráč…'));
      const swatches = h('.ch-swatches', PALETTE.map(col => h('span.ch-swatch' + (c.color === col ? '.on' : ''), {
        style: { background: col }, title: col,
        onclick: e => { update({ color: col, own_style: 1 }); c.color = col; $$('.ch-swatch', swatches).forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); d.style.setProperty('--ch-tint', hexA(col, .16)); if (!c.portrait) portrait.style.background = col; },
      })));
      return h('.main',
        h('.row', h('b.grow', 'Úprava základních údajů'),
          h('button.btn.sm.primary', { onclick: async () => { state.editing = false; await flushSave(); loadDetail(c.id, true); } }, icon('check'), 'Hotovo')),
        name, summary,
        h('.ch-fields',
          h('label.field', 'Typ', seg('kind', kindOrder.map(k => [k, CHAR_KIND[k].label, CHAR_KIND[k].icon]))),
          h('label.field', 'Rod (pro skloňování vztahů)', seg('gender', [['m', 'muž'], ['f', 'žena'], ['', '?']])),
          h('label.field', 'Stav', seg('status', Object.entries(CHAR_STATUS).map(([k, v]) => [k, v.label]), renderFate)),
          field('Přezdívky / jiná jména', 'aliases', 'oddělené čárkou'),
          h('label.field', 'Hraje (hráč)', playerSel)),
        fateBox,
        h('label.field', 'Frakce a rody', facBox),
        h('label.field', 'Server', serverPicker(c.server_id, id => { update({ server_id: id }); c.server_id = id; flushSave().then(() => loadDetail(c.id, true)); }, App.scope.game)),
        h('.row', { style: { gap: '14px' } }, h('.small.faint', 'Barva'), swatches,
          (c.factions || []).length ? h('button.btn.sm' + (!c.own_style ? '.active' : ''), { title: 'Barva a pozadí se převezmou z erbu první frakce',
            onclick: async () => { update({ own_style: 0 }); await flushSave(); loadDetail(c.id, true); } }, icon('shield'), 'Podle frakce') : null));
    };

    const hero = h('.ch-hero', portrait, state.editing ? edit() : view());
    if (c.banner) hero.appendChild(h('.ch-banner', { style: { backgroundImage: `url("${c.banner}")` }, title: `Vzhled podle: ${c.style_from}` }));

    /* bio editor */
    const editor = RichEditor({
      html: c.body_html || '', placeholder: 'Životopis, povaha, co o postavě víš, důležité okamžiky… (@ pro zmínku jiné postavy, Ctrl+V vloží screen)',
      ownerType: 'character', ownerId: c.id, minHeight: 220,
      onChange: html => { state.detail.body_html = html; API.call('char.update', { id: c.id, body_html: html }).then(() => App.loadChars()); },
    });
    state.editor = editor;

    const left = h('div',
      h('.ch-sec', h('.section-title', icon('scroll-text'), 'Životopis a poznámky', h('.line')), editor.el),
      h('.ch-sec', h('.section-title', icon('messages-square'), 'Zmínky v deníku', h('span.faint', c.entries.length || ''), h('.line')),
        c.entries.length ? c.entries.map(en => h('.ch-entry', { onclick: () => App.go('events', { id: en.event_id }) },
          h('.row', h('.ev.grow.ellipsis', icon('calendar'), ' ', en.event_title || 'Událost'),
            h('.tiny.faint', en.ingame_date || (en.entry_time ? fmt.date(en.entry_time) : ''))),
          en.title ? h('div', { style: { fontWeight: 600, marginTop: '3px' } }, en.title) : null,
          h('.ex', en.excerpt || '…')))
          : h('.faint.small', 'Postava zatím nebyla zmíněna v žádném zápisu. V editoru zápisu napiš @ a jméno.')),
      (c.places || []).length ? h('.ch-sec', h('.section-title', `Majetek — ${c.places.length}`),
        h('.row.wrap', { style: { gap: '6px' } }, c.places.map(p => h('span.chip', { onclick: () => App.go('places', { id: p.id }) }, icon('map-pin'), p.name)))) : null,
      h('.ch-sec', h('.section-title', 'Holubí pošta', h('button.btn.sm.ghost', { style: { marginLeft: 'auto' }, onclick: () => App.go('letters', { char: c.id }) }, icon('mail'), 'Dopisy postavy'))),
      (c.bookmarks || []).length ? h('.ch-sec', h('.section-title', icon('bookmark'), 'Momenty ve videích', h('span.faint', c.bookmarks.length), h('.line')),
        h('div', c.bookmarks.sort((a, b) => (a.abs || 0) - (b.abs || 0)).map(b => bmRow(b, { showMedia: true })))) : null,
      h('.ch-sec', h('.section-title', icon('film'), 'Záznamy', h('span.faint', c.media.length || ''), h('.line'),
        h('button.btn.sm.ghost', { onclick: () => App.go('library') }, icon('library'), 'Knihovna')),
      c.media.length ? h('.ch-media', c.media.map(m => h('div', { oncontextmenu: e => menu(e, [
        { label: 'Přehrát', icon: 'play', onClick: () => API.call('media.play', { id: m.id }) },
        { label: 'Odebrat z postavy', icon: 'user-minus', danger: true, onClick: async () => { await API.call('char.unlink', { character_id: c.id, target_type: 'media', target_id: m.id }); App.refresh('chars', 'media'); loadDetail(c.id, true); } },
      ]) }, mediaTile(m), h('.cap', m.name), h('.tiny.faint', fmt.dt(m.start)))))
        : h('.faint.small', 'Žádné záznamy. V Knihovně označ u klipu postavy, které v něm vystupují.')));

    const right = h('div',
      relationsSection(c),
      eventsSection(c),
      attachmentsSection(c));

    d.append(hero, h('.ch-body', left, right));

    d.onpaste = async e => {
      if (e.target.closest('.rte')) return;
      const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      if (await confirmDialog('Vložený obrázek', 'Použít vložený obrázek jako portrét postavy?\n(Ne = jen přidat do příloh)', { okLabel: 'Jako portrét' })) setPortraitFromFiles(c.id, files);
      else { await uploadFiles('character', c.id, files); loadDetail(c.id, true); toast('Přidáno do příloh'); }
    };
  }

  async function setPortraitFromFiles(id, files) {
    const atts = await uploadFiles('character', id, files.slice(0, 1));
    if (!atts.length) return;
    await API.call('char.portrait', { id, att_id: atts[0].id });
    await App.loadChars();
    loadDetail(id, true);
    toast('Portrét nastaven');
  }

  /* relations */
  /** What `o` is to `c` in relation r (gendered by o). */
  function relLabel(r, c, o) {
    if (r.kind && REL_BY_KEY.has(r.kind)) return relWord(r.kind, r.a_id === c.id ? 'b' : 'a', o);
    if (r.a_id === c.id) return r.label || 'vztah';
    return r.label ? `${r.label} (opačně)` : 'vztah';
  }

  function relationsSection(c) {
    const rows = c.relations.map(r => {
      const otherId = r.a_id === c.id ? r.b_id : r.a_id;
      const o = App.charsById.get(otherId);
      if (!o) return null;
      return h('.ch-rel', { style: { cursor: 'pointer' }, title: 'Klik = otevřít postavu', onclick: () => select(o.id) },
        avatar(o, 32), h('.grow', h('div', { style: { fontWeight: 600 } }, o.name),
          h('.tiny.faint', r.note || o.faction || CHAR_KIND[o.kind]?.label || '')),
        h('span.lbl', { title: 'Upravit vztah', style: { cursor: 'pointer' }, onclick: e => { e.stopPropagation(); relationEditor(c, r); } }, relLabel(r, c, o)),
        h('button.btn.sm.ghost.icon', { title: 'Upravit vztah', onclick: e => { e.stopPropagation(); relationEditor(c, r); } }, icon('pencil')),
        h('button.btn.sm.ghost.icon.x', { title: 'Odebrat vztah', onclick: async e => {
          e.stopPropagation(); await API.call('rel.delete', { id: r.id }); loadDetail(c.id, true);
        } }, icon('x')));
    }).filter(Boolean);
    return h('.ch-sec', { style: { marginTop: '18px' } },
      h('.section-title', icon('heart-handshake'), 'Vztahy', h('.line'),
        h('button.btn.sm.ghost', { onclick: () => addRelation(c) }, icon('plus'), 'Přidat')),
      rows.length ? rows : h('.faint.small', 'Rodina, přátelé, nepřátelé, nadřízení… Přidej vztah k jiné postavě.'));
  }

  async function addRelation(c) {
    const ids = await pickCharacters([], { title: `Vztah: ${c.name} a…`, multi: false });
    if (!ids || !ids.length || ids[0] === c.id) return;
    relationEditor(c, null, ids[0]);
  }

  /** Create or edit a relation between c and another character, with gendered labels. */
  function relationEditor(c, r, otherId) {
    const oid = r ? (r.a_id === c.id ? r.b_id : r.a_id) : otherId;
    const o = App.charsById.get(oid);
    if (!o) return;
    // chosen option: { kind, oRole: 'b' (o is the b-role, c is a) | 'a' }  or custom text
    let pick = r && r.kind ? { kind: r.kind, oRole: r.a_id === c.id ? 'b' : 'a' } : null;
    const custom = h('input.input', { placeholder: 'Vlastní: kým je ' + o.name + ' pro ' + c.name + '…',
      value: r && !r.kind ? r.label || '' : '', oninput: () => { if (custom.value.trim()) { pick = null; renderOpts(); } } });
    const note = h('textarea.input', { rows: 2, placeholder: 'Poznámka (od kdy, jak se poznali, dluh 20 grošů…)' }, r ? r.note || '' : '');
    const gender = who => h('.seg', [['m', 'muž'], ['f', 'žena'], ['', '?']].map(([g, l]) => h('button' + ((who.gender || '') === g ? '.on' : ''), {
      onclick: async () => { await API.call('char.update', { id: who.id, gender: g }); who.gender = g; await App.loadChars(); renderOpts(); renderG(); },
    }, l)));
    const gBox = h('.row.wrap', { style: { gap: '18px' } });
    const renderG = () => clear(gBox).append(
      h('.row', h('span.small.muted', c.name), gender(App.charsById.get(c.id) || c)),
      h('.row', h('span.small.muted', o.name), gender(App.charsById.get(o.id) || o)));
    const opts = h('.rel-opts');
    const renderOpts = () => {
      clear(opts);
      const cc = App.charsById.get(c.id) || c, oo = App.charsById.get(o.id) || o;
      for (const [group, list] of REL_TYPES) {
        opts.appendChild(h('.rel-grp', group));
        const row = h('.row.wrap', { style: { gap: '6px' } });
        for (const t of list) {
          for (const oRole of (t[2] ? ['b', 'a'] : ['b'])) {
            const on = pick && pick.kind === t[0] && pick.oRole === oRole;
            const word = relWord(t[0], oRole, oo);
            const back = relWord(t[0], oRole === 'b' ? 'a' : 'b', cc);
            row.appendChild(h('span.chip' + (on ? '.on' : ''), {
              title: `${oo.name} je pro ${cc.name}: ${word}\n${cc.name} je pro ${oo.name}: ${back}`,
              onclick: () => { pick = { kind: t[0], oRole }; custom.value = ''; renderOpts(); },
            }, word));
          }
        }
        opts.appendChild(row);
      }
      const t = pick && REL_BY_KEY.get(pick.kind);
      preview.textContent = t ? `${oo.name} je pro ${cc.name}: ${relWord(pick.kind, pick.oRole, oo)} · ${cc.name} je pro ${oo.name}: ${relWord(pick.kind, pick.oRole === 'b' ? 'a' : 'b', cc)}`
        : custom.value.trim() ? `${oo.name} je pro ${cc.name}: ${custom.value.trim()}` : 'Vyber typ vztahu nebo napiš vlastní.';
    };
    const preview = h('.small', { style: { padding: '8px 10px', borderRadius: '6px', background: 'var(--surface-2)' } });
    renderG(); renderOpts();
    modal({
      title: r ? 'Upravit vztah' : 'Nový vztah', icon: 'heart-handshake', wide: true,
      body: h('.col', { style: { gap: '12px' } },
        h('.small.faint', 'Rod postav – podle něj se vztah skloní (milenec / milenka…)'), gBox,
        opts, custom, note, preview),
      actions: [
        r ? { label: 'Smazat vztah', danger: true, icon: 'trash-2', onClick: async () => { await API.call('rel.delete', { id: r.id }); loadDetail(c.id, true); } } : null,
        { label: 'Zrušit' },
        { label: 'Uložit', primary: true, icon: 'check', onClick: async () => {
          const fields = pick
            ? { a_id: pick.oRole === 'b' ? c.id : o.id, b_id: pick.oRole === 'b' ? o.id : c.id, kind: pick.kind, label: '' }
            : { a_id: c.id, b_id: o.id, kind: '', label: custom.value.trim() };
          if (!fields.kind && !fields.label) { toast('Vyber typ vztahu nebo napiš vlastní', 'err'); return false; }
          fields.note = note.value.trim();
          if (r) await API.call('rel.update', { id: r.id, ...fields });
          else await API.call('rel.add', fields);
          loadDetail(c.id, true);
        } },
      ].filter(Boolean),
    });
  }

  /* events */
  function eventsSection(c) {
    const items = c.events.map(e => {
      const roles = [...new Set(e.roles || [])];
      const viaMention = (e.via || []).some(v => v !== 'manual');
      const manual = (e.via || []).includes('manual');
      return h('.ch-tl-item', { style: { '--ev': e.color || 'var(--accent)' }, onclick: () => App.go('events', { id: e.id }) },
        h('.t', e.title),
        h('.d', [e.ingame_date, e.start_time ? fmt.range(e.start_time, e.end_time) : 'bez data'].filter(Boolean).join(' · ')),
        (roles.length || viaMention) ? h('.roles', roles.map(r => h('span.role', r)),
          viaMention && !manual ? h('span.role', { title: 'Postava je zmíněna v textu' }, icon('at-sign'), ' zmínka') : null) : null,
        manual ? h('button.btn.sm.ghost.icon.x', { title: 'Odebrat z události', onclick: async ev => {
          ev.stopPropagation();
          await API.call('char.unlink', { character_id: c.id, target_type: 'event', target_id: e.id });
          await App.refresh('chars', 'events'); loadDetail(c.id, true);
        } }, icon('x')) : null);
    });
    return h('.ch-sec',
      h('.section-title', icon('calendar-days'), 'Události', h('span.faint', c.events.length || ''), h('.line'),
        h('button.btn.sm.ghost', { onclick: () => addToEvent(c.id) }, icon('plus'), 'Přidat')),
      items.length ? h('.ch-tl', items) : h('.faint.small', 'Postava zatím není v žádné události.'));
  }

  async function addToEvent(charId) {
    const pick = await pickEvent({ title: 'Přidat postavu do události', withNote: false });
    if (!pick) return;
    const role = await promptDialog('Role v události', 'Jakou roli tam postava měla? (nepovinné)', '', { placeholder: 'např. svědek, obviněný, vyjednavač' });
    await API.call('char.link', { character_id: charId, target_type: 'event', target_id: pick.id, role: role || '' });
    await App.refresh('chars', 'events');
    if (state.id === charId) loadDetail(charId, true);
    toast('Postava přidána do události');
  }

  /* attachments */
  function attachmentsSection(c) {
    const imgs = c.attachments.filter(a => a.kind === 'image');
    const tiles = c.attachments.map(a => {
      const isImg = a.kind === 'image';
      const el = h('.ch-att' + (c.portrait_id === a.id ? '.portrait' : ''), {
        style: isImg ? { backgroundImage: `url("${a.url}")` } : {},
        title: [a.caption || a.orig_name, a.taken_at ? fmt.dt(a.taken_at) : ''].filter(Boolean).join('\n'),
        onclick: () => isImg ? lightbox(imgs, imgs.indexOf(a)) : API.call('att.open', { id: a.id }),
        oncontextmenu: e => menu(e, [
          isImg ? { label: 'Nastavit jako portrét', icon: 'user-round', onClick: async () => { await API.call('char.portrait', { id: c.id, att_id: a.id }); await App.loadChars(); loadDetail(c.id, true); } } : null,
          { label: 'Upravit popisek', icon: 'pencil', onClick: async () => { const v = await promptDialog('Popisek', 'Popisek přílohy', a.caption || ''); if (v !== null) { await API.call('att.update', { id: a.id, caption: v }); loadDetail(c.id, true); } } },
          a.media_id ? { label: 'Přehrát zdrojové video', icon: 'play', onClick: () => API.call('att.play_source', { id: a.id }) } : null,
          { label: 'Otevřít', icon: 'external-link', onClick: () => API.call('att.open', { id: a.id }) },
          { label: 'Zobrazit ve složce', icon: 'folder-open', onClick: () => API.call('att.reveal', { id: a.id }) },
          { sep: true },
          { label: 'Smazat', icon: 'trash-2', danger: true, onClick: async () => {
            if (!await confirmDialog('Smazat přílohu', `Smazat „${a.caption || a.orig_name}“?`, { danger: true, okLabel: 'Smazat' })) return;
            await API.call('att.delete', { id: a.id });
            if (c.portrait_id === a.id) await API.call('char.update', { id: c.id, portrait_id: null });
            await App.loadChars(); loadDetail(c.id, true);
          } },
        ]),
      }, isImg ? null : icon('file'), isImg ? null : h('.fn', a.orig_name || 'soubor'));
      return el;
    });
    const drop = h('.ch-dropzone', { onclick: async () => { const got = await API.call('att.pick', { owner_type: 'character', owner_id: c.id }); if (got && got.length) loadDetail(c.id, true); } },
      h('div', icon('upload'), h('div', 'Přidat nebo přetáhnout')));
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drop-target'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drop-target'));
    drop.addEventListener('drop', async e => {
      e.preventDefault(); drop.classList.remove('drop-target');
      if (!e.dataTransfer.files.length) return;
      await uploadFiles('character', c.id, [...e.dataTransfer.files]); loadDetail(c.id, true); toast('Přílohy přidány');
    });
    return h('.ch-sec',
      h('.section-title', icon('images'), 'Přílohy a obrázky', h('span.faint', c.attachments.length || ''), h('.line')),
      h('.ch-atts', tiles, drop));
  }

  async function deleteChar(c) {
    if (!await confirmDialog('Smazat postavu', `Opravdu smazat „${c.name}“?\nZmizí její profil, vztahy a přílohy. Události a záznamy zůstanou.`, { danger: true, okLabel: 'Smazat' })) return;
    await API.call('char.delete', { id: c.id });
    if (state.id === c.id) { state.id = null; state.editor = null; }
    await App.refresh('chars', 'events');
    if (!root) return;
    if (App.chars.length) select(App.chars[0].id); else { renderList(); renderEmptyDetail(); }
    toast('Postava smazána');
  }

  function hexA(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return `rgba(227,179,65,${a})`;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }

  Views.register('characters', { title: 'postavy', short: 'Postavy', icon: 'users', order: 30, members: false, mount, unmount });
})();
