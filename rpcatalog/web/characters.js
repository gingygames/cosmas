/* ============================================================
   Postavy – character database
   ============================================================ */
'use strict';
const DISCORD_WORLDS = [['cechy-1403', tr('Bohemia 1403')], ['moderni-mesto', tr('Modern city')], ['postapo', tr('Post-apocalypse')], ['horor', tr('Horror')]];

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
  const kindGroup = { mine: tr('My characters'), player: tr('Characters'), npc: 'NPC' };

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
    flushSave();
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
    const search = h('input.input', { placeholder: tr('Search name, faction, player…'), value: state.q });
    search.addEventListener('input', debounce(() => { state.q = search.value; renderItems(); }, 120));
    search.addEventListener('keydown', e => e.stopPropagation());
    const factions = [...new Set(App.chars.flatMap(c => (c.factions || []).length ? c.factions.map(f => f.name) : (c.faction ? [c.faction] : [])))].sort((a, b) => a.localeCompare(b, I18N.locale));
    const kindSeg = h('.seg',
      [['all', tr('All')], ['mine', tr('Mine')], ['player', tr('Characters')], ['npc', 'NPC']].map(([k, l]) =>
        h('button' + (state.kind === k ? '.on' : ''), { onclick: () => { state.kind = k; renderList(); } }, l)));
    const layoutSeg = h('.seg',
      h('button' + (state.layout === 'list' ? '.on' : ''), { title: tr('List'), onclick: () => setLayout('list') }, icon('list')),
      h('button' + (state.layout === 'grid' ? '.on' : ''), { title: tr('Cards'), onclick: () => setLayout('grid') }, icon('layout-grid')));
    side.append(
      h('.ch-head', h('h1', tr('Characters')), layoutSeg,
        h('button.btn.primary.sm', { onclick: newCharacter }, icon('user-plus'), tr('New character'))),
      h('.ch-filters',
        h('.search', icon('search'), search),
        h('.row', kindSeg),
        factions.length ? h('.row.wrap', { style: { gap: '5px' } },
          h('.chip' + (!state.faction ? '.on' : ''), { onclick: () => { state.faction = ''; renderList(); } }, tr('All factions')),
          factions.map(f => h('.chip' + (state.faction === f ? '.on' : ''), { onclick: () => { state.faction = state.faction === f ? '' : f; renderList(); } }, f))) : null),
      h('.ch-list'),
      h('.tiny.faint', { style: { padding: '4px 16px 8px' } }, tr('Ctrl / Shift + click = select multiple characters for bulk editing')));
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
      list.appendChild(emptyState('users', tr('No characters yet'), tr('Create your character, players and NPCs. Tag them in entries with @.'),
        h('button.btn.primary', { onclick: newCharacter }, icon('user-plus'), tr('New character'))));
      return;
    }
    if (!items.length) { list.appendChild(h('.faint.small', { style: { padding: '14px 8px' } }, tr('Nothing matches the filter.'))); return; }
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
      h('.grow', h('.nm.ellipsis', c.name, testChip(c)),
        h('.meta.ellipsis', [c.faction, c.player ? tr('played by {player}', { player: c.player }) : ''].filter(Boolean).join(' · ') || CHAR_KIND[c.kind]?.label)),
      evCount(c) ? h('.cnt', icon('calendar-days'), evCount(c)) : null);
  }

  function card(c) {
    const st = CHAR_STATUS[c.status] || CHAR_STATUS.unknown;
    const pic = h('.pic', { style: c.portrait ? { backgroundImage: `url("${c.portrait}")` } : { background: c.color || '#e3b341' } },
      c.portrait ? null : initials(c.name), h('span.st', { style: { background: st.color }, title: st.label }));
    if (c.status === 'dead') pic.style.filter = 'grayscale(1) brightness(.75)';
    return h('.ch-card' + (c.id === state.id ? '.on' : '') + (sel.has(c.id) ? '.msel' : ''), { 'data-cid': c.id, onclick: e => clickChar(e, c), oncontextmenu: e => listMenu(e, c) },
      pic, h('.info', h('.nm', c.name), h('.meta', [c.faction || CHAR_KIND[c.kind]?.label, evCount(c) ? tr('{n} ev.', { n: evCount(c) }) : ''].filter(Boolean).join(' · '))));
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
    const upd = async fields => { for (const id of ids) await API.call('char.update', { id, ...fields }); await App.loadChars(); renderList(); renderBulkBar(); toast(trn(ids.length, 'Updated {n} character', 'Updated {n} characters')); };
    clear(bar).append(
      h('.row', h('b', trn(ids.length, '{n} character selected', '{n} characters selected')), h('.grow'), h('button.btn.sm.ghost.icon', { title: tr('Clear selection'), onclick: () => { sel.clear(); renderList(); renderBulkBar(); } }, icon('x'))),
      h('.row.wrap', { style: { gap: '6px' } },
        h('button.btn.sm', { onclick: e => menu(e, Object.entries(CHAR_KIND).map(([k, v]) => ({ label: v.label, icon: v.icon, onClick: () => upd({ kind: k }) }))) }, tr('Type')),
        h('button.btn.sm', { onclick: e => menu(e, Object.entries(CHAR_STATUS).map(([k, v]) => ({ label: v.label, onClick: () => upd({ status: k }) }))) }, tr('Status')),
        h('button.btn.sm', { onclick: e => menu(e, [...(App.factions || []).map(f => ({ label: f.name, onClick: async () => {
          const role = await promptDialog(tr('Role'), tr('Role in “{name}” (optional)', { name: f.name }), ''); if (role === null) return;
          await API.call('faction.members_add', { id: f.id, character_ids: ids, role }); await App.loadChars(); renderList(); renderBulkBar(); toast(tr('Added to faction'));
        } })), { sep: true }, { label: tr('New faction / house…'), icon: 'plus', onClick: async () => {
          const n = await promptDialog(tr('New faction / house'), tr('Name'), ''); if (!n) return;
          const fid = await API.call('faction.create', { name: n });
          await API.call('faction.members_add', { id: fid, character_ids: ids, role: '' }); App.factions = await API.call('factions.list'); await App.loadChars(); renderList(); renderBulkBar();
        } }]) }, tr('Faction')),
        h('button.btn.sm', { onclick: e => menu(e, [...(App.players || []).map(p => ({ label: p.name, onClick: () => upd({ player_id: p.id }) })),
          { sep: true }, { label: tr('New player…'), icon: 'plus', onClick: async () => { const n = await promptDialog(tr('New player'), tr('Nickname'), ''); if (!n) return; const pid = await API.call('player.create', { name: n }); App.players = await API.call('players.list'); upd({ player_id: pid }); } },
          { label: tr('No player'), onClick: () => upd({ player_id: null }) }]) }, tr('Player')),
        h('button.btn.sm', { onclick: e => menu(e, PALETTE.map(col => ({ label: col, onClick: () => upd({ color: col, own_style: 1 }) }))) }, tr('Color')),
        h('button.btn.sm', { onclick: e => menu(e, bulkItems(ids).find(x => x && x.icon === 'server').submenu) }, tr('Server')),
        h('button.btn.sm', { title: tr('All bulk edits (also by right-clicking the selected characters)'), onclick: e => menu(e, bulkItems(ids)) }, icon('ellipsis')),
        h('button.btn.sm', { onclick: async () => {
          const r = await pickEvent({ title: trn(ids.length, 'Add {n} character to an event', 'Add {n} characters to an event'), withNote: false });
          if (!r) return;
          const role = await promptDialog(tr('Role in event'), tr('Role (optional)'), '', { placeholder: tr('e.g. witnesses, guards') });
          for (const id of ids) await API.call('char.link', { character_id: id, target_type: 'event', target_id: r.id, role: role || '' });
          await App.refresh('events', 'chars'); toast(tr('Added to event'), 'ok', { label: tr('Open'), fn: () => App.go('events', { id: r.id }) });
        } }, icon('calendar-plus'), tr('Add to event')),
        h('button.btn.sm.danger', { onclick: async () => {
          if (!await confirmDialog(tr('Delete characters'), trn(ids.length, 'Really delete {n} character?\nTheir profiles, relationships and attachments will be gone.', 'Really delete {n} characters?\nTheir profiles, relationships and attachments will be gone.'), { danger: true, okLabel: tr('Delete') })) return;
          for (const id of ids) await API.call('char.delete', { id });
          sel.clear(); state.id = null; state.editor = null;
          await App.refresh('chars', 'events'); renderList(); renderBulkBar(); toast(tr('Characters deleted'));
        } }, icon('trash-2'))));
  }

  function bulkItems(ids) {
    const upd = async fields => { for (const id of ids) await API.call('char.update', { id, ...fields }); await App.loadChars(); renderList(); renderBulkBar(); toast(trn(ids.length, 'Updated {n} character', 'Updated {n} characters')); };
    const svList = App.servers.filter(s => !App.scope.game || s.game === App.scope.game);
    return [
      { head: trn(ids.length, '{n} selected character', '{n} selected characters') },
      { label: tr('Type'), icon: 'shapes', submenu: Object.entries(CHAR_KIND).map(([k, v]) => ({ label: v.label, icon: v.icon, onClick: () => upd({ kind: k }) })) },
      { label: tr('Status'), icon: 'heart-pulse', submenu: Object.entries(CHAR_STATUS).map(([k, v]) => ({ label: v.label, onClick: () => upd({ status: k }) })) },
      { label: tr('Gender'), icon: 'users-round', submenu: [['m', tr('male')], ['f', tr('female')], ['', tr('unspecified')]].map(([g, l]) => ({ label: l, onClick: () => upd({ gender: g }) })) },
      { label: tr('Server'), icon: 'server', submenu: [...svList.map(s => ({ label: App.scope.game ? s.name : `${s.name} · ${s.game}`, onClick: async () => {
        await API.call('server.assign', { type: 'char', ids, server_id: s.id }); await App.loadChars(); renderList(); toast(tr('Moved to {server}', { server: s.name }));
      } })), { label: tr('New server…'), icon: 'plus', onClick: () => serverDialog({ game: App.scope.game }, { switchScope: false, onSaved: async id => {
        await API.call('server.assign', { type: 'char', ids, server_id: id }); await App.loadChars(); renderList(); } }) },
      { label: tr('No server'), onClick: async () => { await API.call('server.assign', { type: 'char', ids, server_id: null }); await App.loadChars(); renderList(); } }] },
      { label: tr('Faction'), icon: 'shield', submenu: [...(App.factions || []).map(f => ({ label: f.name, onClick: async () => {
        await API.call('faction.members_add', { id: f.id, character_ids: ids, role: '' }); await App.loadChars(); renderList(); toast(tr('Added to {name}', { name: f.name }));
      } })), { label: tr('New faction / house…'), icon: 'plus', onClick: async () => {
        const n = await promptDialog(tr('New faction / house'), tr('Name'), ''); if (!n) return;
        const fid = await API.call('faction.create', { name: n }); await API.call('faction.members_add', { id: fid, character_ids: ids, role: '' });
        await App.loadChars(); renderList();
      } }] },
      { label: tr('Player'), icon: 'gamepad-2', submenu: [...(App.players || []).map(p => ({ label: p.name, onClick: () => upd({ player_id: p.id }) })), { label: tr('No player'), onClick: () => upd({ player_id: null }) }] },
      { label: tr('Color'), icon: 'palette', submenu: [{ label: tr('From faction'), onClick: () => upd({ own_style: 0 }) }, ...PALETTE.map(col => ({ label: col, onClick: () => upd({ color: col, own_style: 1 }) }))] },
      { label: tr('Add to an event…'), icon: 'calendar-plus', onClick: async () => {
        const r = await pickEvent({ title: trn(ids.length, 'Add {n} character to an event', 'Add {n} characters to an event'), withNote: false }); if (!r) return;
        for (const id of ids) await API.call('char.link', { character_id: id, target_type: 'event', target_id: r.id, role: '' });
        await App.refresh('events', 'chars'); toast(tr('Added to event'));
      } },
      { sep: true },
      { label: tr('Clear selection'), icon: 'x', onClick: () => { sel.clear(); renderList(); renderBulkBar(); } },
      { label: trn(ids.length, 'Delete {n} character…', 'Delete {n} characters…'), icon: 'trash-2', danger: true, onClick: async () => {
        if (!await confirmDialog(tr('Delete characters'), trn(ids.length, 'Really delete {n} character?', 'Really delete {n} characters?'), { danger: true, okLabel: tr('Delete') })) return;
        for (const id of ids) await API.call('char.delete', { id });
        sel.clear(); state.id = null; await App.refresh('chars', 'events'); renderList(); renderBulkBar(); toast(tr('Characters deleted'));
      } },
    ];
  }

  function listMenu(e, c) {
    if (sel.size > 1 && sel.has(c.id)) { renderBulkBar(); return menu(e, bulkItems([...sel])); }
    menu(e, [
      { label: tr('Open'), icon: 'user', onClick: () => select(c.id) },
      { label: tr('Add to event…'), icon: 'calendar-plus', onClick: () => addToEvent(c.id) },
      { sep: true },
      testMenuItem('character', c),
      { label: tr('Delete character'), icon: 'trash-2', danger: true, onClick: () => deleteChar(c) },
    ]);
  }

  async function newCharacter() {
    const name = await promptDialog(tr('New character'), tr('Character name'), '', { placeholder: tr('e.g. Jindřich ze Skalice') });
    if (!name) return;
    const kind = state.kind !== 'all' ? state.kind : 'player';
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const id = await API.call('char.create', { name, kind, color });
    await App.loadChars();
    select(id);
    toast(tr('Character created'));
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
      emptyState('user-round', tr('Select a character'), tr('Or create a new one – profile, portrait, relationships, events and mentions in one place.'),
        h('button.btn.primary', { onclick: newCharacter }, icon('user-plus'), tr('New character')))));
  }

  async function loadDetail(id, keepScroll = false) {
    const d = $('.ch-detail', root); if (!d) return;
    const scroll = keepScroll ? d.scrollTop : 0;
    // unsaved biography and fields go to their own character before anything is loaded again
    if (state.editor) state.editor.flush();
    flushSave();
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
      title: tr('Click to change the portrait, or drag / paste (Ctrl+V) an image here'),
      style: c.portrait ? { backgroundImage: `url("${c.portrait}")` } : { background: c.color || '#e3b341' },
      onclick: e => menu(e, [
        { label: tr('Choose image from file…'), icon: 'image-up', onClick: async () => {
          const url = await API.call('char.portrait', { id: c.id });
          if (url) { await App.loadChars(); loadDetail(c.id, true); }
        } },
        { label: tr('Crop from the playing video'), icon: 'crop', disabled: !App.player.media_id, onClick: async () => {
          const grab = await grabFrame();
          if (grab && await portraitFromGrab(grab, c.id)) loadDetail(c.id, true);
        } },
        c.portrait ? { label: tr('Adjust the crop of the current portrait'), icon: 'scan', onClick: async () => {
          const blob = await fetch(c.portrait).then(r => r.blob()).catch(() => null);
          if (!blob) return toast(tr('Could not load the portrait'), 'err');
          const src = await readAsDataURL(blob);
          await portraitFromGrab({ data: src, moment: null, caption: tr('portrait'), media_id: null, pos: null }, c.id);
          loadDetail(c.id, true);
        } } : null,
      ].filter(Boolean)),
    }, c.portrait ? null : initials(c.name), h('.ov', icon('image-up'), c.portrait ? tr('Change portrait') : tr('Add portrait')));
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
        c.gender ? h('span.ch-kind', c.gender === 'f' ? tr('female') : tr('male')) : null,
        h('span.ch-kind', h('span.dot', { style: { background: st.color } }), st.label),
        ptagChips(c.player_tags), h('.grow'),
        h('button.btn.sm', { onclick: () => { state.editing = true; renderDetail(state.detail); } }, icon('pencil'), tr('Edit')),
        h('button.btn.sm', { onclick: () => addToEvent(c.id) }, icon('calendar-plus'), tr('Add to event')),
        shareButton('character', c.id),
        h('button.btn.sm.ghost.icon', { title: tr('More actions'), onclick: e => menu(e, [
          { label: tr('Change portrait…'), icon: 'image-up', onClick: () => portrait.click() },
          c.portrait ? { label: tr('Remove portrait'), icon: 'image-off', onClick: async () => { await API.call('char.update', { id: c.id, portrait_id: null }); await App.loadChars(); loadDetail(c.id, true); } } : null,
          { sep: true },
          testMenuItem('character', c),
          { label: tr('Delete character'), icon: 'trash-2', danger: true, onClick: () => deleteChar(c) },
        ]) }, icon('ellipsis'))),
      h('h1.ch-title', c.name, testChip(c)),
      c.aliases ? h('.small.muted', tr('Also: {aliases}', { aliases: c.aliases })) : null,
      c.summary ? h('.ch-summary', c.summary) : null,
      gone ? h('.ch-fate', icon(c.status === 'dead' ? 'skull' : 'circle-help'),
        h('span', c.status === 'dead' ? tr('Died') : tr('Went missing'),
          c.status_ingame ? ` · ${c.status_ingame}` : '', c.status_date ? ` · ${fmt.date(c.status_date)}` : ''),
        statusEv ? h('a', { onclick: () => App.go('events', { id: statusEv.id }), style: { cursor: 'pointer' } }, ' → ', statusEv.title) : null,
        c.status_note ? h('.faint', { style: { width: '100%' } }, c.status_note) : null) : null,
      h('.ch-info',
        (c.factions || []).length ? h('.ch-kv', h('.k', tr('Factions and houses')), h('.v.row.wrap', { style: { gap: '6px' } }, c.factions.map(fChip))) :
          (c.faction ? info(tr('Faction'), c.faction) : null),
        player ? h('.ch-kv', h('.k', tr('Played by')), h('.v', h('a', { style: { cursor: 'pointer' }, onclick: () => App.go('players', { id: player.id }) }, player.name))) : info(tr('Played by'), c.player),
        h('.ch-kv', h('.k', tr('In the catalog')), h('.v.faint', trn(evN, '{n} event', '{n} events') + ' · ' + trn(mN, '{n} recording', '{n} recordings')))));

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
      name.addEventListener('input', () => update({ name: name.value.trim() || tr('Unnamed') }));
      name.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); });
      const summary = h('input.input', { value: c.summary || '', placeholder: tr('Short description – who they are in one sentence'), onkeydown: e => e.stopPropagation(), oninput: e => update({ summary: e.target.value }) });
      const fateBox = h('div');
      const renderFate = () => {
        clear(fateBox);
        if (c.status !== 'dead' && c.status !== 'missing') return;
        const ev = c.status_event_id && App.eventsById.get(c.status_event_id);
        const date = h('input.input', { type: 'date', value: c.status_date ? fmt.toInput(c.status_date).slice(0, 10) : '', style: { width: '160px' },
          onchange: e => update({ status_date: e.target.value ? new Date(e.target.value).getTime() / 1000 : null }) });
        fateBox.append(h('.ch-fields', { style: { marginTop: '4px' } },
          h('label.field', c.status === 'dead' ? tr('Date of death (real)') : tr('Went missing (real date)'), date),
          h('label.field', tr('In-game date'), h('input.input', { value: c.status_ingame || '', placeholder: tr('e.g. summer 1403'), onkeydown: e => e.stopPropagation(), oninput: e => update({ status_ingame: e.target.value }) })),
          h('label.field', tr('Event'), h('.row',
            ev ? h('span.chip.on', { onclick: () => App.go('events', { id: ev.id }) }, h('span.dot', { style: { background: ev.color } }), ev.title) : h('span.faint.small', tr('not linked')),
            h('button.btn.sm', { onclick: async () => { const r = await pickEvent({ title: tr('In which event?'), moment: c.status_date, withNote: false }); if (r) { update({ status_event_id: r.id }); c.status_event_id = r.id; renderFate(); } } }, icon('link'), ev ? tr('Change') : tr('Select')),
            ev ? h('button.btn.sm.ghost.icon', { onclick: () => { update({ status_event_id: null }); c.status_event_id = null; renderFate(); } }, icon('x')) : null))),
          h('input.input', { value: c.status_note || '', placeholder: tr('How it happened (optional)'), style: { marginTop: '8px' }, onkeydown: e => e.stopPropagation(), oninput: e => update({ status_note: e.target.value }) }));
      };
      renderFate();
      const facBox = h('.row.wrap', { style: { gap: '6px' } });
      const renderFac = () => {
        clear(facBox).append(...(c.factions || []).map(f => h('span.chip', { style: { borderLeft: `3px solid ${f.color || '#888'}` } }, f.name, f.role ? h('span.faint', ' · ' + f.role) : null,
          h('span.x', { onclick: async () => { await API.call('faction.member_remove', { id: f.id, character_id: c.id }); c.factions = c.factions.filter(x => x.id !== f.id); renderFac(); App.loadChars(); } }, icon('x')))),
        h('button.btn.sm', { onclick: e => menu(e, [
          ...(App.factions || []).filter(f => !(c.factions || []).some(x => x.id === f.id)).map(f => ({ label: f.name, onClick: async () => {
            const role = await promptDialog(tr('Role'), tr("Character's role in “{name}”", { name: f.name }), '', { placeholder: tr('e.g. head of the house, member') });
            if (role === null) return;
            await API.call('faction.members_add', { id: f.id, character_ids: [c.id], role });
            c.factions = [...(c.factions || []), { id: f.id, name: f.name, color: f.color, role }]; renderFac(); App.loadChars();
          } })),
          { sep: true },
          { label: tr('New faction / house…'), icon: 'plus', onClick: async () => {
            const n = await promptDialog(tr('New faction / house'), tr('Name'), ''); if (!n) return;
            const fid = await API.call('faction.create', { name: n, kind: /^(rod|páni)/i.test(n) ? 'rod' : 'frakce' });
            await API.call('faction.members_add', { id: fid, character_ids: [c.id], role: '' });
            App.factions = await API.call('factions.list'); await App.loadChars(); loadDetail(c.id, true);
          } },
        ]) }, icon('plus'), tr('Add')));
      };
      renderFac();
      const playerSel = h('select.input', { style: { width: '220px' }, onchange: async e => {
        let v = e.target.value;
        if (v === '__new') {
          const n = await promptDialog(tr('New player'), tr('Player nickname'), ''); if (!n) { e.target.value = c.player_id || ''; return; }
          v = await API.call('player.create', { name: n }); App.players = await API.call('players.list');
        }
        update({ player_id: v ? Number(v) : null }); c.player_id = v ? Number(v) : null;
      } }, h('option', { value: '' }, tr('— nobody / unknown —')),
      (App.players || []).map(p => h('option', { value: p.id, selected: c.player_id === p.id }, p.name)), h('option', { value: '__new' }, tr('+ new player…')));
      // postava pro Discord (karta v botovi; synchronizuje se s webovou kronikou)
      const discordBox = () => {
        const world = h('select.input', { style: { width: '220px' }, disabled: !c.discord_use, onchange: e => { update({ discord_world: e.target.value }); c.discord_world = e.target.value; } },
          [['', tr('— choose a world —')], ...DISCORD_WORLDS].map(([k, l]) => h('option', { value: k, selected: (c.discord_world || '') === k }, l)));
        return h('.col', { style: { gap: '6px' } },
          h('.row.wrap', { style: { gap: '14px' } },
            h('label.check', h('input', { type: 'checkbox', checked: !!c.discord_use, onchange: async e => {
              const box = e.target;
              if (box.checked) {   // the card in the bot comes from the web chronicle → needs the Discord sign-in
                const st = await API.call('sync.status').catch(() => null);
                if (st && !st.has_token) {
                  box.checked = false;
                  const ok = await confirmDialog(tr('Use on Discord'), tr('Characters get to the Discord bot through the web chronicle. Sign in with Discord first – it takes a moment.'), { okLabel: tr('Sign in with Discord') });
                  if (!ok || !(await webSignIn())) return;
                  box.checked = true;
                }
              }
              c.discord_use = box.checked ? 1 : 0; update({ discord_use: c.discord_use }); world.disabled = !c.discord_use;
            } }), tr('Use on Discord')),
            h('label.field', tr('World'), world)),
          h('.tiny.faint', tr('Private character = a card only for you in the bot; shared via link or public = a card in the 🧙│postavy channel.')));
      };
      const swatches = h('.ch-swatches', PALETTE.map(col => h('span.ch-swatch' + (c.color === col ? '.on' : ''), {
        style: { background: col }, title: col,
        onclick: e => { update({ color: col, own_style: 1 }); c.color = col; $$('.ch-swatch', swatches).forEach(x => x.classList.remove('on')); e.currentTarget.classList.add('on'); d.style.setProperty('--ch-tint', hexA(col, .16)); if (!c.portrait) portrait.style.background = col; },
      })));
      return h('.main',
        h('.row', h('b.grow', tr('Edit basic info')),
          h('button.btn.sm.primary', { onclick: async () => { state.editing = false; await flushSave(); loadDetail(c.id, true); } }, icon('check'), tr('Done'))),
        name, summary,
        h('.ch-fields',
          h('label.field', tr('Type'), seg('kind', kindOrder.map(k => [k, CHAR_KIND[k].label, CHAR_KIND[k].icon]))),
          h('label.field', tr('Gender (for relationship wording)'), seg('gender', [['m', tr('male')], ['f', tr('female')], ['', '?']])),
          h('label.field', tr('Status'), seg('status', Object.entries(CHAR_STATUS).map(([k, v]) => [k, v.label]), renderFate)),
          field(tr('Nicknames / other names'), 'aliases', tr('comma-separated')),
          h('label.field', tr('Played by (player)'), playerSel)),
        fateBox,
        h('label.field', tr('Factions and houses'), facBox),
        h('label.field', tr('Server'), serverPicker(c.server_id, id => { update({ server_id: id }); c.server_id = id; flushSave().then(() => loadDetail(c.id, true)); }, App.scope.game)),
        discordBox(),
        h('.row', { style: { gap: '14px' } }, h('.small.faint', tr('Color')), swatches,
          (c.factions || []).length ? h('button.btn.sm' + (!c.own_style ? '.active' : ''), { title: tr("Color and background are taken from the first faction's coat of arms"),
            onclick: async () => { update({ own_style: 0 }); await flushSave(); loadDetail(c.id, true); } }, icon('shield'), tr('From faction')) : null));
    };

    const hero = h('.ch-hero', portrait, state.editing ? edit() : view());
    if (c.banner) hero.appendChild(h('.ch-banner', { style: { backgroundImage: `url("${c.banner}")` }, title: tr('Style taken from: {source}', { source: c.style_from }) }));

    /* bio editor */
    const editor = RichEditor({
      html: c.body_html || '', placeholder: tr('Biography, personality, what you know about the character, key moments… (@ to mention another character, Ctrl+V pastes a screenshot)'),
      ownerType: 'character', ownerId: c.id, minHeight: 220,
      onChange: html => { c.body_html = html; API.call('char.update', { id: c.id, body_html: html }).then(() => App.loadChars()); },
    });
    state.editor = editor;

    const left = h('div',
      h('.ch-sec', h('.section-title', icon('scroll-text'), tr('Biography and notes'), h('.line')), editor.el),
      h('.ch-sec', h('.section-title', icon('messages-square'), tr('Journal mentions'), h('span.faint', c.entries.length || ''), h('.line')),
        c.entries.length ? c.entries.map(en => h('.ch-entry', { onclick: () => App.go('events', { id: en.event_id }) },
          h('.row', h('.ev.grow.ellipsis', icon('calendar'), ' ', en.event_title || tr('Event')),
            h('.tiny.faint', en.ingame_date || (en.entry_time ? fmt.date(en.entry_time) : ''))),
          en.title ? h('div', { style: { fontWeight: 600, marginTop: '3px' } }, en.title) : null,
          h('.ex', en.excerpt || '…')))
          : h('.faint.small', tr('The character has not been mentioned in any entry yet. Type @ and the name in the entry editor.'))),
      (c.places || []).length ? h('.ch-sec', h('.section-title', tr('Property — {n}', { n: c.places.length })),
        h('.row.wrap', { style: { gap: '6px' } }, c.places.map(p => h('span.chip', { onclick: () => App.go('places', { id: p.id }) }, icon('map-pin'), p.name)))) : null,
      h('.ch-sec', h('.section-title', tr('Pigeon post'), h('button.btn.sm.ghost', { style: { marginLeft: 'auto' }, onclick: () => App.go('letters', { char: c.id }) }, icon('mail'), tr("Character's letters")))),
      (c.bookmarks || []).length ? h('.ch-sec', h('.section-title', icon('bookmark'), tr('Moments in videos'), h('span.faint', c.bookmarks.length), h('.line')),
        h('div', c.bookmarks.sort((a, b) => (a.abs || 0) - (b.abs || 0)).map(b => bmRow(b, { showMedia: true })))) : null,
      window.looksSection ? window.looksSection(c.id) : null,
      window.mentionsSection ? window.mentionsSection('character', c.id) : null,
      h('.ch-sec', h('.section-title', icon('film'), tr('Recordings'), h('span.faint', c.media.length || ''), h('.line'),
        h('button.btn.sm.ghost', { onclick: () => App.go('library') }, icon('library'), tr('Library'))),
      c.media.length ? h('.ch-media', c.media.map(m => h('div', { oncontextmenu: e => menu(e, [
        { label: tr('Play'), icon: 'play', onClick: () => API.call('media.play', { id: m.id }) },
        { label: tr('Remove from character'), icon: 'user-minus', danger: true, onClick: async () => { await API.call('char.unlink', { character_id: c.id, target_type: 'media', target_id: m.id }); App.refresh('chars', 'media'); loadDetail(c.id, true); } },
      ]) }, mediaTile(m), h('.cap', m.name), h('.tiny.faint', fmt.dt(m.start)))))
        : h('.faint.small', tr('No recordings. In the Library, tag the characters that appear in a clip.'))));

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
      if (await confirmDialog(tr('Pasted image'), tr('Use the pasted image as the character portrait?\n(No = just add it to attachments)'), { okLabel: tr('As portrait') })) setPortraitFromFiles(c.id, files);
      else { await uploadFiles('character', c.id, files); loadDetail(c.id, true); toast(tr('Added to attachments')); }
    };
  }

  async function setPortraitFromFiles(id, files) {
    const atts = await uploadFiles('character', id, files.slice(0, 1));
    if (!atts.length) return;
    await API.call('char.portrait', { id, att_id: atts[0].id });
    await App.loadChars();
    loadDetail(id, true);
    toast(tr('Portrait set'));
  }

  /* relations */
  /** What `o` is to `c` in relation r (gendered by o). */
  function relLabel(r, c, o) {
    if (r.kind && REL_BY_KEY.has(r.kind)) return relWord(r.kind, r.a_id === c.id ? 'b' : 'a', o);
    if (r.a_id === c.id) return r.label || tr('relationship');
    return r.label ? tr('{label} (reverse)', { label: r.label }) : tr('relationship');
  }

  function relationsSection(c) {
    const rows = c.relations.map(r => {
      const otherId = r.a_id === c.id ? r.b_id : r.a_id;
      const o = App.charsById.get(otherId);
      if (!o) return null;
      return h('.ch-rel', { style: { cursor: 'pointer' }, title: tr('Click = open character'), onclick: () => select(o.id) },
        avatar(o, 32), h('.grow', h('div', { style: { fontWeight: 600 } }, o.name),
          h('.tiny.faint', r.note || o.faction || CHAR_KIND[o.kind]?.label || '')),
        h('span.lbl', { title: tr('Edit relationship'), style: { cursor: 'pointer' }, onclick: e => { e.stopPropagation(); relationEditor(c, r); } }, relLabel(r, c, o)),
        h('button.btn.sm.ghost.icon', { title: tr('Edit relationship'), onclick: e => { e.stopPropagation(); relationEditor(c, r); } }, icon('pencil')),
        h('button.btn.sm.ghost.icon.x', { title: tr('Remove relationship'), onclick: async e => {
          e.stopPropagation(); await API.call('rel.delete', { id: r.id }); loadDetail(c.id, true);
        } }, icon('x')));
    }).filter(Boolean);
    return h('.ch-sec', { style: { marginTop: '18px' } },
      h('.section-title', icon('heart-handshake'), tr('Relationships'), h('.line'),
        h('button.btn.sm.ghost', { onclick: () => addRelation(c) }, icon('plus'), tr('Add'))),
      rows.length ? rows : h('.faint.small', tr('Family, friends, enemies, superiors… Add a relationship to another character.')));
  }

  async function addRelation(c) {
    const ids = await pickCharacters([], { title: tr('Relationship: {name} and…', { name: c.name }), multi: false });
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
    const custom = h('input.input', { placeholder: tr('Custom: what {other} is to {name}…', { other: o.name, name: c.name }),
      value: r && !r.kind ? r.label || '' : '', oninput: () => { if (custom.value.trim()) { pick = null; renderOpts(); } } });
    const note = h('textarea.input', { rows: 2, placeholder: tr('Note (since when, how they met, a debt of 20 groschen…)') }, r ? r.note || '' : '');
    const gender = who => h('.seg', [['m', tr('male')], ['f', tr('female')], ['', '?']].map(([g, l]) => h('button' + ((who.gender || '') === g ? '.on' : ''), {
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
              title: tr('{a} is to {b}: {rel}', { a: oo.name, b: cc.name, rel: word }) + '\n' + tr('{a} is to {b}: {rel}', { a: cc.name, b: oo.name, rel: back }),
              onclick: () => { pick = { kind: t[0], oRole }; custom.value = ''; renderOpts(); },
            }, word));
          }
        }
        opts.appendChild(row);
      }
      const t = pick && REL_BY_KEY.get(pick.kind);
      preview.textContent = t ? tr('{a} is to {b}: {rel}', { a: oo.name, b: cc.name, rel: relWord(pick.kind, pick.oRole, oo) }) + ' · ' + tr('{a} is to {b}: {rel}', { a: cc.name, b: oo.name, rel: relWord(pick.kind, pick.oRole === 'b' ? 'a' : 'b', cc) })
        : custom.value.trim() ? tr('{a} is to {b}: {rel}', { a: oo.name, b: cc.name, rel: custom.value.trim() }) : tr('Choose a relationship type or write your own.');
    };
    const preview = h('.small', { style: { padding: '8px 10px', borderRadius: '6px', background: 'var(--surface-2)' } });
    renderG(); renderOpts();
    modal({
      title: r ? tr('Edit relationship') : tr('New relationship'), icon: 'heart-handshake', wide: true,
      body: h('.col', { style: { gap: '12px' } },
        h('.small.faint', tr("Characters' gender – the relationship wording follows it (lover m. / lover f.…)")), gBox,
        opts, custom, note, preview),
      actions: [
        r ? { label: tr('Delete relationship'), danger: true, icon: 'trash-2', onClick: async () => { await API.call('rel.delete', { id: r.id }); loadDetail(c.id, true); } } : null,
        { label: tr('Cancel') },
        { label: tr('Save'), primary: true, icon: 'check', onClick: async () => {
          const fields = pick
            ? { a_id: pick.oRole === 'b' ? c.id : o.id, b_id: pick.oRole === 'b' ? o.id : c.id, kind: pick.kind, label: '' }
            : { a_id: c.id, b_id: o.id, kind: '', label: custom.value.trim() };
          if (!fields.kind && !fields.label) { toast(tr('Choose a relationship type or write your own'), 'err'); return false; }
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
        h('.d', [e.ingame_date, e.start_time ? fmt.range(e.start_time, e.end_time) : tr('no date')].filter(Boolean).join(' · ')),
        (roles.length || viaMention) ? h('.roles', roles.map(r => h('span.role', r)),
          viaMention && !manual ? h('span.role', { title: tr('The character is mentioned in the text') }, icon('at-sign'), ' ' + tr('mention')) : null) : null,
        manual ? h('button.btn.sm.ghost.icon.x', { title: tr('Remove from event'), onclick: async ev => {
          ev.stopPropagation();
          await API.call('char.unlink', { character_id: c.id, target_type: 'event', target_id: e.id });
          await App.refresh('chars', 'events'); loadDetail(c.id, true);
        } }, icon('x')) : null);
    });
    return h('.ch-sec',
      h('.section-title', icon('calendar-days'), tr('Events'), h('span.faint', c.events.length || ''), h('.line'),
        h('button.btn.sm.ghost', { onclick: () => addToEvent(c.id) }, icon('plus'), tr('Add'))),
      items.length ? h('.ch-tl', items) : h('.faint.small', tr('The character is not in any event yet.')));
  }

  async function addToEvent(charId) {
    const pick = await pickEvent({ title: tr('Add character to an event'), withNote: false });
    if (!pick) return;
    const role = await promptDialog(tr('Role in event'), tr('What role did the character have there? (optional)'), '', { placeholder: tr('e.g. witness, accused, negotiator') });
    await API.call('char.link', { character_id: charId, target_type: 'event', target_id: pick.id, role: role || '' });
    await App.refresh('chars', 'events');
    if (state.id === charId) loadDetail(charId, true);
    toast(tr('Character added to the event'));
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
          isImg ? { label: tr('Set as portrait'), icon: 'user-round', onClick: async () => { await API.call('char.portrait', { id: c.id, att_id: a.id }); await App.loadChars(); loadDetail(c.id, true); } } : null,
          { label: tr('Edit caption'), icon: 'pencil', onClick: async () => { const v = await promptDialog(tr('Caption'), tr('Attachment caption'), a.caption || ''); if (v !== null) { await API.call('att.update', { id: a.id, caption: v }); loadDetail(c.id, true); } } },
          a.media_id ? { label: tr('Play source video'), icon: 'play', onClick: () => API.call('att.play_source', { id: a.id }) } : null,
          { label: tr('Open'), icon: 'external-link', onClick: () => API.call('att.open', { id: a.id }) },
          { label: tr('Show in folder'), icon: 'folder-open', onClick: () => API.call('att.reveal', { id: a.id }) },
          { sep: true },
          { label: tr('Delete'), icon: 'trash-2', danger: true, onClick: async () => {
            if (!await confirmDialog(tr('Delete attachment'), tr('Delete “{name}”?', { name: a.caption || a.orig_name }), { danger: true, okLabel: tr('Delete') })) return;
            await API.call('att.delete', { id: a.id });
            if (c.portrait_id === a.id) await API.call('char.update', { id: c.id, portrait_id: null });
            await App.loadChars(); loadDetail(c.id, true);
          } },
        ]),
      }, isImg ? null : icon('file'), isImg ? null : h('.fn', a.orig_name || tr('file')));
      return el;
    });
    const drop = h('.ch-dropzone', { onclick: async () => { const got = await API.call('att.pick', { owner_type: 'character', owner_id: c.id }); if (got && got.length) loadDetail(c.id, true); } },
      h('div', icon('upload'), h('div', tr('Add or drag here'))));
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drop-target'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drop-target'));
    drop.addEventListener('drop', async e => {
      e.preventDefault(); drop.classList.remove('drop-target');
      if (!e.dataTransfer.files.length) return;
      await uploadFiles('character', c.id, [...e.dataTransfer.files]); loadDetail(c.id, true); toast(tr('Attachments added'));
    });
    return h('.ch-sec',
      h('.section-title', icon('images'), tr('Attachments and images'), h('span.faint', c.attachments.length || ''), h('.line')),
      h('.ch-atts', tiles, drop));
  }

  async function deleteChar(c) {
    if (!await confirmDialog(tr('Delete character'), tr('Really delete “{name}”?\nTheir profile, relationships and attachments will be gone. Events and recordings will remain.', { name: c.name }), { danger: true, okLabel: tr('Delete') })) return;
    await API.call('char.delete', { id: c.id });
    if (state.id === c.id) { state.id = null; state.editor = null; }
    await App.refresh('chars', 'events');
    if (!root) return;
    if (App.chars.length) select(App.chars[0].id); else { renderList(); renderEmptyDetail(); }
    toast(tr('Character deleted'));
  }

  function hexA(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return `rgba(227,179,65,${a})`;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }

  Views.register('characters', { title: tr('characters'), short: tr('Characters'), icon: 'users', order: 30, members: false, mount, unmount });
})();
