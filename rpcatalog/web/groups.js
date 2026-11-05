/* ============================================================
   Frakce a rody + Hráči – groups of characters (one shared view)
   ============================================================ */
'use strict';

(() => {
document.head.appendChild(h('style', `
.gp { display: flex; height: 100%; min-height: 0; }
.gp-side { width: 300px; flex: none; display: flex; flex-direction: column; background: var(--bg-2); min-height: 0; }
.gp-side .top { padding: 14px 12px 8px; display: flex; flex-direction: column; gap: 8px; }
.gp-list { flex: 1; overflow: auto; padding: 0 8px 16px; }
.gp-grp { font-size: 11.5px; font-weight: 650; letter-spacing: .03em; text-transform: uppercase; color: var(--text-3); margin: 14px 6px 4px; }
.gp-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 4px; cursor: pointer; }
.gp-row:hover { background: var(--hover); }
.gp-row.on { background: var(--active); }
.gp-row .nm { font-weight: 600; font-size: 14px; }
.gp-row .meta { font-size: 12px; color: var(--text-3); }
.gp-ico { width: 34px; height: 34px; border-radius: 8px; flex: none; display: grid; place-items: center; background: center / cover no-repeat;
  color: #111; font-weight: 800; font-size: 13px; }
.gp-detail { flex: 1; min-width: 0; overflow: auto; }
.gp-hero { padding: 26px 32px 20px; display: flex; gap: 24px; align-items: flex-start; border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, color-mix(in srgb, var(--gc, #888) 22%, transparent), transparent); }
.gp-img { width: 132px; height: 132px; border-radius: 16px; flex: none; background: var(--surface-2) center / cover no-repeat; cursor: pointer;
  display: grid; place-items: center; font: 800 44px var(--font-display); color: rgba(0,0,0,.55); position: relative; overflow: hidden; }
.gp-img .ov { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.55); color: #fff; opacity: 0; font: 500 12px var(--font); }
.gp-img:hover .ov { opacity: 1; }
.gp-hero h1 { margin: 0; font: 800 30px/1.15 var(--font-display); }
.gp-hero .kind { font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; color: var(--gc, var(--accent)); }
.gp-hero .sum { color: var(--text-2); margin-top: 6px; }
.gp-body { padding: 8px 32px 40px; display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(280px, 1fr); gap: 28px; }
@media (max-width: 1200px) { .gp-body { grid-template-columns: 1fr; } }
.gp-mem { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; }
.gp-m { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; background: var(--surface); cursor: pointer; }
.gp-m:hover { background: var(--surface-2); }
.gp-m .r { font-size: 12px; color: var(--accent-2); }
.gp-m .s { font-size: 12px; color: var(--text-3); }
.gp-m.dead { opacity: .5; }
.gp-ev { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer; }
.gp-ev:hover { background: var(--hover); }
.gp-form { display: grid; grid-template-columns: 110px 1fr; gap: 10px 12px; align-items: center; margin-top: 10px; max-width: 640px; }
.gp-form .k { color: var(--text-3); font-size: 12.5px; }
.ptag { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 3px; font-size: 11.5px; font-weight: 600;
  background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent-2); }
`));

const FACTION_KINDS = [['rod', 'Rody', 'Rod', 'crown'], ['frakce', 'Frakce', 'Frakce', 'flag'], ['cech', 'Cechy', 'Cech', 'hammer'],
  ['rad', 'Řády', 'Řád', 'shield'], ['mesto', 'Města a vesnice', 'Město / vesnice', 'castle'], ['jine', 'Ostatní', 'Jiné', 'circle-dot']];
const FK = new Map(FACTION_KINDS.map(k => [k[0], k]));
const PLACE_KINDS = [['hrad', 'Hrady a tvrze', 'Hrad / tvrz', 'castle'], ['mesto', 'Města', 'Město', 'building-2'],
  ['vesnice', 'Vesnice', 'Vesnice', 'house'], ['krcma', 'Krčmy a hostince', 'Krčma', 'beer'], ['cirkev', 'Kostely a kláštery', 'Kostel / klášter', 'church'],
  ['budova', 'Domy a dílny', 'Dům / dílna', 'warehouse'], ['priroda', 'Krajina', 'Les / krajina', 'trees'], ['jine', 'Ostatní', 'Jiné', 'map-pin']];
const PK = new Map(PLACE_KINDS.map(k => [k[0], k]));
const KINDS = { factions: FACTION_KINDS, places: PLACE_KINDS };

/** Pick a place (or create one). Resolves to place id or null. */
window.pickPlace = async function (title = 'Vybrat místo') {
  const list = await API.call('places.list');
  return new Promise(resolve => {
    let done = false;
    const q = h('input.input', { placeholder: 'Hledat místo nebo napsat nové…', autofocus: true });
    const box = h('.picker-list');
    const render = () => {
      clear(box);
      const t = q.value.trim().toLowerCase();
      list.filter(p => !t || p.name.toLowerCase().includes(t)).forEach(p => box.appendChild(h('.list-row', {
        onclick: () => { done = true; resolve(p.id); m.close(); },
      }, icon((PK.get(p.kind) || PK.get('jine'))[3]), h('.grow', p.name), h('.tiny.faint', p.owner_name || ''))));
      if (t && !list.some(p => p.name.toLowerCase() === t)) box.appendChild(h('.list-row', {
        onclick: async () => { const id = await API.call('place.create', { name: q.value.trim() }); App.places = await API.call('places.list'); done = true; resolve(id); m.close(); },
      }, icon('plus'), h('span', 'Nové místo ', h('b', `„${q.value.trim()}“`))));
    };
    q.addEventListener('input', render); q.addEventListener('keydown', e => e.stopPropagation());
    const m = modal({ title, icon: 'map-pin', body: h('div', q, box), onClose: () => { if (!done) resolve(null); } });
    render();
  });
};
const splitTags = t => (t || '').split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean);
window.ptagChips = tags => (tags || []).length ? h('span.row', { style: { gap: '4px', display: 'inline-flex' } }, tags.map(t => h('span.ptag', t))) : null;

const CONF = {
  factions: {
    title: 'frakce a rody', icon: 'shield', list: 'factions.list', get: 'faction.get', create: 'faction.create', update: 'faction.update',
    del: 'faction.delete', img: 'faction.emblem', imgKey: 'emblem', owner: 'faction', noun: 'frakce', newLabel: 'Nová frakce / rod',
    empty: 'Rody, frakce, cechy, města… Přidej je a připoj k nim postavy s rolí (hlava rodu, vazal, člen…).',
    memberIds: g => g.members.map(m => m.character_id), roleOf: (g, cid) => (g.members.find(m => m.character_id === cid) || {}).role,
    addMembers: async (g, ids) => { const role = await promptDialog('Role ve frakci', 'Role (nepovinné)', '', { placeholder: 'např. hlava rodu, člen, vazal' }); if (role === null) return false; await API.call('faction.members_add', { id: g.id, character_ids: ids, role }); },
    setRole: (g, cid, role) => API.call('faction.members_add', { id: g.id, character_ids: [cid], role }),
    removeMember: (g, cid) => API.call('faction.member_remove', { id: g.id, character_id: cid }),
  },
  places: {
    title: 'místa', icon: 'map', list: 'places.list', get: 'place.get', create: 'place.create', update: 'place.update',
    del: 'place.delete', img: 'place.image', imgKey: 'image', owner: 'place', noun: 'místo', newLabel: 'Nové místo',
    empty: 'Hrady, města, krčmy, lesy… Ke každému místu jde nastavit, komu patří (postava nebo frakce), kde leží a co se tam stalo.',
    memberIds: () => [], roleOf: () => '', addMembers: null, setRole: null, removeMember: null,
  },
  players: {
    title: 'hráči', icon: 'gamepad-2', list: 'players.list', get: 'player.get', create: 'player.create', update: 'player.update',
    del: 'player.delete', img: 'player.avatar', imgKey: 'avatar', owner: 'player', noun: 'hráč', newLabel: 'Nový hráč',
    empty: 'Lidé za postavami. Jeden hráč může mít víc postav (i z minulosti). Štítky hráče (např. admin) se propíšou k jeho postavám a momentům.',
    memberIds: g => g.characters, roleOf: () => '',
    addMembers: async (g, ids) => { for (const id of ids) await API.call('char.update', { id, player_id: g.id }); },
    setRole: null,
    removeMember: (g, cid) => API.call('char.update', { id: cid, player_id: null }),
  },
};

function makeView(kind) {
  const C = CONF[kind];
  let root, list = [], cur = null, editing = false, q = '', editor = null, unsub = [];

  async function loadList() { list = await API.call(C.list); App[kind] = list; }
  function img(g, size = 34, cls = '.gp-ico') {
    const src = g[C.imgKey];
    return h(cls, { style: src ? { backgroundImage: `url("${src}")`, width: size + 'px', height: size + 'px' } : { background: g.color || '#888', width: size + 'px', height: size + 'px' } },
      src ? null : initials(g.name));
  }

  function renderSide() {
    const side = $('.gp-side', root);
    const search = h('input.input', { placeholder: 'Hledat…', value: q, onkeydown: e => e.stopPropagation(), oninput: debounce(e => { q = e.target.value; renderRows(); }, 120) });
    clear(side).append(
      h('.top', h('.row', h('b.grow', C.title[0].toUpperCase() + C.title.slice(1)), h('button.btn.sm.primary', { onclick: create }, icon('plus'), 'Nový')),
        h('.search', icon('search'), search)),
      h('.gp-list'));
    renderRows();
  }
  function renderRows() {
    const box = $('.gp-list', root); if (!box) return;
    clear(box);
    const items = list.filter(g => (kind === 'players' || inScope(g)) && (!q || `${g.name} ${g.summary || ''} ${g.contact || ''} ${g.tags || ''}`.toLowerCase().includes(q.toLowerCase())));
    if (!list.length) { box.appendChild(h('.faint.small', { style: { padding: '14px 8px' } }, C.empty)); return; }
    const row = g => h('.gp-row' + (cur && cur.id === g.id ? '.on' : ''), { onclick: () => open(g.id) },
      img(g), h('.grow', { style: { minWidth: 0 } }, h('.nm.ellipsis', g.name),
        h('.meta.ellipsis', kind === 'factions' ? `${g.n} ${fmt.plural(g.n, 'člen', 'členové', 'členů')}`
          : kind === 'places' ? [g.owner_name, g.n_events ? `${g.n_events} ${fmt.plural(g.n_events, 'událost', 'události', 'událostí')}` : ''].filter(Boolean).join(' · ') || (PK.get(g.kind) || PK.get('jine'))[2]
          : [g.discord_name || g.contact, `${g.n} ${fmt.plural(g.n, 'postava', 'postavy', 'postav')}`].filter(Boolean).join(' · '))),
      kind === 'players' ? ptagChips(splitTags(g.tags)) : null);
    if (KINDS[kind]) {
      const def = kind === 'factions' ? 'frakce' : 'jine';
      for (const [k, plural] of KINDS[kind]) {
        const arr = items.filter(g => (g.kind || def) === k);
        if (!arr.length) continue;
        box.appendChild(h('.gp-grp', `${plural} — ${arr.length}`));
        arr.forEach(g => box.appendChild(row(g)));
      }
    } else items.forEach(g => box.appendChild(row(g)));
  }

  async function create() {
    const name = await promptDialog(C.newLabel, 'Název', '', { placeholder: kind === 'factions' ? 'např. páni z Vranova' : 'přezdívka hráče' });
    if (!name) return;
    const id = await API.call(C.create, { name, color: PALETTE[Math.floor(Math.random() * PALETTE.length)] });
    await loadList(); editing = true; open(id);
  }

  async function open(id) {
    if (editor) { editor.flush(); editor = null; }
    App.ui[kind + 'Id'] = id; App.saveUi();
    cur = await API.call(C.get, { id });
    if (!root) return;
    renderRows(); renderDetail();
  }

  function imageMenu(e) {
    const setFrom = async data => {
      const att = await API.call('att.add_data', { owner_type: C.owner, owner_id: cur.id, name: 'obrazek.jpg', data_b64: data });
      await API.call(C.img, { id: cur.id, att_id: att.id }); await refresh();
    };
    menu(e, [
      { label: 'Vybrat obrázek ze souboru…', icon: 'image-up', onClick: async () => { if (await API.call(C.img, { id: cur.id })) refresh(); } },
      { label: 'Vyříznout z přehrávaného videa', icon: 'crop', disabled: !App.player.media_id, onClick: async () => {
        const g = await grabFrame(); if (!g) return;
        const d = await cropDialog(g.data, { ratio: 1, title: 'Vyříznout obrázek', okLabel: 'Použít' }); if (d) setFrom(d);
      } },
      cur[C.imgKey] ? { label: 'Odebrat obrázek', icon: 'image-off', onClick: async () => { await API.call(C.update, { id: cur.id, [C.imgKey + '_id']: null }); refresh(); } } : null,
    ]);
  }

  async function refresh() { await loadList(); await App.loadChars(); if (cur) open(cur.id); }

  function renderDetail() {
    const d = $('.gp-detail', root); clear(d);
    if (!cur) { d.appendChild(h('div', { style: { height: '100%', display: 'grid', placeItems: 'center' } }, emptyState(C.icon, list.length ? 'Vyber vlevo' : 'Zatím nic', C.empty, h('button.btn.primary', { onclick: create }, icon('plus'), C.newLabel)))); return; }
    const g = cur;
    const kindLabel = kind === 'factions' ? (FK.get(g.kind || 'frakce') || [])[2] : kind === 'places' ? (PK.get(g.kind || 'jine') || PK.get('jine'))[2] : 'Hráč';
    Shell.header({ icon: C.icon, title: g.name, topic: kind === 'players' ? (g.discord_name || g.contact || 'hráč') : kindLabel });
    d.style.setProperty('--gc', g.color || '#888');
    const imgEl = img(g, 132, '.gp-img'); imgEl.appendChild(h('.ov', 'Změnit obrázek')); imgEl.onclick = imageMenu;
    const tags = splitTags(g.tags);
    const head = editing ? editForm(g) : h('.grow', { style: { minWidth: 0 } },
      h('.kind', kindLabel),
      h('h1', g.name),
      kind === 'places' ? placeLine(g) : null,
      kind === 'players' && g.discord_name ? h('.small.muted', icon('message-circle'), ' Discord: ', g.discord_name) : null,
      kind === 'players' && g.contact ? h('.small.muted', icon('at-sign'), ' ', g.contact) : null,
      kind === 'players' && tags.length ? h('.row', { style: { marginTop: '6px' } }, ptagChips(tags)) : null,
      g.summary ? h('.sum', g.summary) : null);
    d.appendChild(h('.gp-hero', imgEl, head,
      h('.row', { style: { alignSelf: 'flex-start' } },
        h('button.btn' + (editing ? '.primary' : ''), { onclick: () => { editing = !editing; if (!editing) refresh(); else renderDetail(); } }, icon(editing ? 'check' : 'pencil'), editing ? 'Hotovo' : 'Upravit'),
        h('button.btn.icon', { title: 'Další', onclick: e => menu(e, [{ label: `Smazat (${C.noun})`, icon: 'trash-2', danger: true, onClick: async () => {
          if (!await confirmDialog('Smazat', `Smazat „${g.name}“? Postavy zůstanou.`, { danger: true, okLabel: 'Smazat' })) return;
          await API.call(C.del, { id: g.id }); cur = null; await refresh(); renderSide(); renderDetail();
        } }]) }, icon('ellipsis')))));

    // members
    const ids = C.memberIds(g);
    const mem = ids.map(id => App.charsById.get(id)).filter(Boolean);
    const memBox = h('.gp-mem', mem.map(c => {
      const role = C.roleOf(g, c.id);
      const st = CHAR_STATUS[c.status] || CHAR_STATUS.unknown;
      return h('.gp-m' + (c.status === 'dead' ? '.dead' : ''), {
        onclick: () => App.go('characters', { id: c.id }),
        oncontextmenu: e => menu(e, [
          C.setRole ? { label: 'Změnit roli…', icon: 'pencil', onClick: async () => { const r = await promptDialog('Role', c.name, role || ''); if (r !== null) { await C.setRole(g, c.id, r); refresh(); } } } : null,
          { label: 'Odebrat', icon: 'user-minus', danger: true, onClick: async () => { await C.removeMember(g, c.id); refresh(); } },
        ]),
      }, avatar(c, 34), h('.grow', { style: { minWidth: 0 } }, h('.ellipsis', { style: { fontWeight: 600 } }, c.name),
        role ? h('.r.ellipsis', role) : h('.s.ellipsis', [CHAR_KIND[c.kind]?.label, st.label].filter(Boolean).join(' · '))));
    }));
    const left = h('div');
    if (kind !== 'places') left.append(
      h('.section-title', kind === 'factions' ? `Členové — ${mem.length}` : `Postavy — ${mem.length}`,
        h('button.btn.sm.ghost', { style: { marginLeft: 'auto' }, onclick: async () => {
          const picked = await pickCharacters(ids, { title: kind === 'factions' ? `Členové: ${g.name}` : `Postavy hráče ${g.name}` });
          if (!picked) return;
          const add = picked.filter(x => !ids.includes(x)), rem = ids.filter(x => !picked.includes(x));
          if (add.length && await C.addMembers(g, add) === false) return;
          for (const x of rem) await C.removeMember(g, x);
          refresh();
        } }, icon('user-plus'), 'Upravit')),
      mem.length ? memBox : h('.faint.small', 'Zatím nikdo. Pravým tlačítkem na postavě změníš roli nebo ji odebereš.'));
    if (kind === 'places') left.append(...placeSections(g));
    if ((kind === 'places' || kind === 'factions') && window.mentionsSection)
      left.append(window.mentionsSection(kind === 'places' ? 'place' : 'faction', g.id));
    left.append(h('.section-title', 'Historie a poznámky'));
    editor = RichEditor({ html: g.body_html || '', placeholder: 'Historie, sídlo, cíle, spojenci a nepřátelé… (@ pro postavu)', ownerType: C.owner, ownerId: g.id, minHeight: 180,
      onChange: html => API.call(C.update, { id: g.id, body_html: html }) });
    left.appendChild(editor.el);
    const right = h('div');
    if (kind === 'factions') right.append(...holdingsSection(g));
    if (kind === 'players') right.append(...discordSection(g));
    if (kind === 'factions' && g.events && g.events.length) {
      right.append(h('.section-title', `Události členů — ${g.events.length}`),
        ...g.events.slice(0, 30).map(e => h('.gp-ev', { onclick: () => App.go('events', { id: e.id }) },
          h('span.dot', { style: { background: e.color } }), h('.grow.ellipsis', e.title), avatarStack(e.chars, 20, 4),
          h('span.tiny.faint', e.start_time ? fmt.date(e.start_time) : ''))));
    }
    if (kind === 'players') {
      const dead = mem.filter(c => c.status === 'dead' || c.status === 'missing');
      right.append(h('.section-title', 'Přehled'),
        h('.small.muted', `${mem.length} ${fmt.plural(mem.length, 'postava', 'postavy', 'postav')}` + (dead.length ? ` · ${dead.length} mrtvých nebo zmizelých` : '')));
    }
    d.appendChild(h('.gp-body', left, right));
  }

  function placeLine(g) {
    const parent = g.parent_id && (App.places || []).find(p => p.id === g.parent_id);
    const own = g.owner_name ? h('a', { style: { cursor: 'pointer' }, onclick: () => App.go(g.owner_type === 'faction' ? 'factions' : 'characters', { id: g.owner_id }) }, g.owner_name) : null;
    return h('.small.muted', { style: { marginTop: '4px' } },
      own ? h('span', icon('key-round'), ' Patří: ', own) : null,
      parent ? h('span', { style: { marginLeft: '14px' } }, icon('map'), ' Leží v: ', h('a', { style: { cursor: 'pointer' }, onclick: () => open(parent.id) }, parent.name)) : null,
      g.ingame_location ? h('span', { style: { marginLeft: '14px' } }, icon('compass'), ' ', g.ingame_location) : null);
  }

  function placeSections(g) {
    const ev = g.events || [], kids = g.children || [];
    return [
      h('.section-title', `Co se tu stalo — ${ev.length}`),
      ev.length ? h('div', ev.map(e => h('.gp-ev', { onclick: () => App.go('events', { id: e.id }) }, h('span.dot', { style: { background: e.color } }),
        h('.grow.ellipsis', e.title), h('span.tiny.faint', e.start_time ? fmt.date(e.start_time) : ''))))
        : h('.faint.small', 'Žádná událost. U události vyber místo v poli „Místo“.'),
      h('.section-title', `Místa uvnitř — ${kids.length}`, h('button.btn.sm.ghost', { style: { marginLeft: 'auto' }, onclick: async () => {
        const id = await pickPlace('Přidat místo dovnitř'); if (id && id !== g.id) { await API.call('place.update', { id, parent_id: g.id }); refresh(); }
      } }, icon('plus'), 'Přidat')),
      kids.length ? h('.gp-mem', kids.map(k => h('.gp-m', { onclick: () => open(k.id) }, img(k, 34), h('.grow', h('div', { style: { fontWeight: 600 } }, k.name), h('.s', k.owner_name || (PK.get(k.kind) || PK.get('jine'))[2])))))
        : h('.faint.small', 'Např. krčma ve městě, sklep na hradě.'),
    ];
  }

  function holdingsSection(g) {
    const hs = g.holdings || [];
    return [
      h('.section-title', `Državy — ${hs.length}`, h('button.btn.sm.ghost', { style: { marginLeft: 'auto' }, onclick: async () => {
        const id = await pickPlace(`Nová država: ${g.name}`); if (!id) return;
        await API.call('place.update', { id, owner_type: 'faction', owner_id: g.id }); refresh();
      } }, icon('plus'), 'Přidat')),
      hs.length ? h('div', hs.map(p => h('.gp-ev', { onclick: () => App.go('places', { id: p.id }),
        oncontextmenu: e => menu(e, [{ label: 'Odebrat z držav', icon: 'x', danger: true, onClick: async () => { await API.call('place.update', { id: p.id, owner_type: '', owner_id: null }); refresh(); } }]) },
      icon((PK.get(p.kind) || PK.get('jine'))[3]), h('.grow.ellipsis', p.name), h('span.tiny.faint', (PK.get(p.kind) || PK.get('jine'))[2]))))
        : h('.faint.small', 'Hrady, vesnice, pozemky a jiná místa, která frakci patří.'),
    ];
  }

  function discordSection(g) {
    return [
      h('.section-title', 'Discord'),
      h('.small.muted', g.discord_id ? `Propojeno: ${g.discord_name || g.discord_id}` : 'Nepropojeno.'),
      h('.row.wrap', { style: { marginTop: '8px', gap: '6px' } },
        h('button.btn.sm', { title: 'Vlož Discord ID hráče – bot nemusí být na žádném serveru', onclick: async () => {
          const uid = await promptDialog('Propojit podle Discord ID', 'Discord ID uživatele', g.discord_id || '',
            { placeholder: 'Režim vývojáře → pravý klik na uživatele → Kopírovat ID uživatele' });
          if (!uid) return;
          const m = await API.call('discord.link_by_id', { player_id: g.id, user_id: uid.trim() }).catch(() => null);
          if (m) { toast(`Propojeno: ${m.display}`); refresh(); }
        } }, icon('fingerprint'), g.discord_id ? 'Změnit ID' : 'Propojit podle ID'),
        App.settings.discord_guild ? h('button.btn.sm', { onclick: async () => {
          const ms = await API.call('discord.members').catch(() => null); if (!ms) return;
          const picked = await pickDiscordMember(ms, g.name);
          if (picked) { await API.call('discord.link_player', { player_id: g.id, member: picked }); toast('Propojeno s Discordem'); refresh(); }
        } }, icon('users'), 'Vybrat ze serveru') : null,
        g.discord_id ? h('button.btn.sm', { title: 'Znovu stáhnout jméno a avatar', onclick: async () => {
          const m = await API.call('discord.link_by_id', { player_id: g.id, user_id: g.discord_id }).catch(() => null);
          if (m) { toast('Aktualizováno'); refresh(); }
        } }, icon('refresh-cw')) : null,
        g.discord_id ? h('button.btn.sm.ghost', { onclick: async () => { await API.call('player.update', { id: g.id, discord_id: '', discord_name: '' }); refresh(); } }, 'Zrušit') : null),
    ];
  }

  function ownerPicker(g, save) {
    const label = g.owner_name || 'nikomu';
    return h('.row', h('span.chip' + (g.owner_type ? '.on' : ''), label),
      h('button.btn.sm', { onclick: e => menu(e, [
        { head: 'Frakce a rody' }, ...(App.factions || []).map(f => ({ label: f.name, onClick: () => setOwner('faction', f.id, f.name) })),
        { head: 'Postavy' }, { label: 'Vybrat postavu…', icon: 'user', onClick: async () => { const ids = await pickCharacters([], { title: 'Komu místo patří?', multi: false }); if (ids && ids[0]) setOwner('character', ids[0], App.charsById.get(ids[0])?.name); } },
        { sep: true }, { label: 'Nikomu', onClick: () => setOwner('', null, '') },
      ]) }, 'Změnit'));
    function setOwner(t, id, name) { g.owner_type = t; g.owner_id = id; g.owner_name = name; save({ owner_type: t, owner_id: id }); renderDetail(); }
  }

  function parentPicker(g, save) {
    const parent = g.parent_id && list.find(p => p.id === g.parent_id);
    return h('.row', h('span.chip' + (parent ? '.on' : ''), parent ? parent.name : '—'),
      h('button.btn.sm', { onclick: async () => { const id = await pickPlace('Kde místo leží?'); if (id && id !== g.id) { g.parent_id = id; save({ parent_id: id }); setTimeout(renderDetail, 350); } } }, 'Vybrat'),
      parent ? h('button.btn.sm.ghost.icon', { onclick: () => { g.parent_id = null; save({ parent_id: null }); renderDetail(); } }, icon('x')) : null);
  }

  function editForm(g) {
    const save = debounce(fields => API.call(C.update, { id: g.id, ...fields }).then(loadList).then(renderRows), 300);
    const inp = (key, ph) => h('input.input', { value: g[key] || '', placeholder: ph, onkeydown: e => e.stopPropagation(), oninput: e => { g[key] = e.target.value; save({ [key]: e.target.value }); } });
    const sw = h('.row', { style: { gap: '6px' } }, PALETTE.map(col => h('span', {
      style: { width: '22px', height: '22px', borderRadius: '50%', background: col, cursor: 'pointer', outline: g.color === col ? '2px solid var(--text)' : 'none', outlineOffset: '2px' },
      onclick: () => { g.color = col; save({ color: col }); renderDetail(); },
    })));
    return h('.grow', h('.gp-form',
      h('.k', 'Název'), inp('name', 'Název'),
      KINDS[kind] ? h('.k', 'Typ') : null,
      KINDS[kind] ? h('.seg', { style: { flexWrap: 'wrap' } }, KINDS[kind].map(([k, , one, ic]) => h('button' + ((g.kind || (kind === 'factions' ? 'frakce' : 'jine')) === k ? '.on' : ''), { onclick: () => { g.kind = k; save({ kind: k }); renderDetail(); } }, icon(ic), one))) : null,
      kind === 'places' ? h('.k', 'Patří') : null, kind === 'places' ? ownerPicker(g, save) : null,
      kind === 'places' ? h('.k', 'Leží v') : null, kind === 'places' ? parentPicker(g, save) : null,
      kind === 'places' ? h('.k', 'Poloha') : null, kind === 'places' ? inp('ingame_location', 'např. severně od Ratají, u brodu') : null,
      kind === 'players' ? h('.k', 'Kontakt') : null, kind === 'players' ? inp('contact', 'Discord, Steam…') : null,
      kind === 'players' ? h('.k', 'Štítky') : null, kind === 'players' ? inp('tags', 'např. admin, streamer (oddělené čárkou)') : null,
      kind !== 'players' ? h('.k', 'Server') : null,
      kind !== 'players' ? serverPicker(g.server_id, id => { g.server_id = id; save({ server_id: id }); setTimeout(renderDetail, 350); }, App.scope.game) : null,
      h('.k', 'Barva'), sw,
      h('.k', 'Krátce'), inp('summary', 'jednou větou')));
  }

  return {
    title: C.title, short: { factions: 'Frakce', players: 'Hráči', places: 'Místa' }[kind], icon: C.icon,
    order: { factions: 31, players: 32, places: 33 }[kind], members: false,
    async mount(el, params = {}) {
      root = el; editing = false; cur = null;
      el.appendChild(h('.gp', h('.gp-side'), h('.gp-detail')));
      await loadList();
      renderSide();
      const id = params.id || App.ui[kind + 'Id'] || (list[0] && list[0].id);
      if (id && list.some(g => g.id === id)) open(id); else renderDetail();
      unsub = [App.on('chars', () => { if (cur && !editing) renderDetail(); })];
    },
    unmount() { if (editor) editor.flush(); unsub.forEach(f => f()); unsub = []; root = null; },
  };
}

Views.register('factions', makeView('factions'));
Views.register('players', makeView('players'));
Views.register('places', makeView('places'));

/** Choose a Discord member from the bot's server list. */
window.pickDiscordMember = function (members, hint = '') {
  return new Promise(resolve => {
    let done = false;
    const q = h('input.input', { placeholder: 'Hledat na serveru…', value: hint, autofocus: true });
    const box = h('.picker-list');
    const render = () => {
      clear(box);
      const t = q.value.trim().toLowerCase();
      members.filter(m => !t || `${m.display} ${m.username} ${m.global_name}`.toLowerCase().includes(t)).slice(0, 200).forEach(m => box.appendChild(h('.list-row', {
        onclick: () => { done = true; resolve(m); md.close(); },
      }, h('img', { src: m.avatar, style: { width: '30px', height: '30px', borderRadius: '50%' } }), h('.grow', h('div', m.display), h('.tiny.faint', '@' + m.username)))));
      if (!box.children.length) box.appendChild(h('.faint.small', { style: { padding: '8px' } }, 'Nikdo neodpovídá.'));
    };
    q.addEventListener('input', render); q.addEventListener('keydown', e => e.stopPropagation());
    const md = modal({ title: 'Člen Discord serveru', icon: 'message-circle', body: h('div', q, box), onClose: () => { if (!done) resolve(null); } });
    render();
  });
};
window.FACTION_KINDS = FACTION_KINDS;
})();
