/* ============================================================
   App shell in the familiar chat-app layout:
   [game rail] [channels + now playing] [header + view] [characters]
   ============================================================ */
'use strict';

const Shell = {
  guild: 'home',          // 'home' or a game name
  context: null,          // { label, chars: [ids] } – shown on top of the member list
  catsClosed: new Set(),

  CHANNELS: [
    // [stable key (persisted in App.ui.catsClosed), label, items]
    ['catalog', tr('Catalog'), [['home', 'house', tr('overview')], ['library', 'clapperboard', tr('library')], ['moments', 'bookmark', tr('moments')], ['gallery', 'images', tr('gallery')], ['transcripts', 'captions', tr('transcripts')]]],
    ['story', tr('Story'), [['events', 'calendar-range', tr('events')], ['timeline', 'chart-gantt', tr('timeline')], ['letters', 'mail', tr('pigeon post')]]],
    ['world', tr('World'), [['places', 'map', tr('places')], ['factions', 'shield', tr('factions and houses')]]],
    ['characters', tr('Characters'), [['characters', 'users', tr('character database')], ['players', 'gamepad-2', tr('players')]]],
  ],

  build() {
    this.guild = (App.scope && App.scope.game) || 'home';
    const app = $('#app'); clear(app);
    this.guilds = h('nav#guilds');
    this.chanHead = h('header.chan-head');
    this.nav = h('.chan-nav');
    this.slotEl = h('.chan-slot');
    this.np = h('.np.hidden');
    this.user = h('.userbar');
    this.channels = h('aside#channels', this.chanHead, h('.chan-body', this.nav, this.slotEl), this.np, this.user);
    this.top = h('header#topbar');
    this.members = h('aside#members');
    const view = h('main#view');
    app.append(this.guilds, this.channels, h('section#center', this.top, view), this.members);
    try { (App.ui.catsClosed || []).forEach(c => this.catsClosed.add(c)); } catch (e) { /* ignore */ }
    this.renderGuilds(); this.renderChannels(); this.renderUser(); this.renderMembers(); this.renderNowPlaying();
    App.on('media', () => { this.renderGuilds(); this.renderUser(); });
    App.on('events', () => { this.renderMembers(); this.renderUser(); });
    App.on('chars', () => { this.renderMembers(); });
    App.on('player', () => this.renderNowPlaying());
  },

  /* ---------- left rail: home + one icon per game ---------- */
  games() {
    const by = new Map();
    for (const m of App.media) {
      if (!by.has(m.game)) by.set(m.game, { game: m.game, n: 0, dur: 0, last: 0, thumb: null });
      const g = by.get(m.game);
      g.n++; g.dur += m.duration || 0;
      if ((m.start || 0) > g.last) g.last = m.start || 0;
    }
    // icon = the most detailed (largest jpeg) thumbnail among the 12 newest videos - avoids black first frames
    for (const g of by.values()) {
      const recent = App.media.filter(x => x.game === g.game && x.thumb).sort((a, b) => (b.start || 0) - (a.start || 0)).slice(0, 12);
      const best = recent.sort((a, b) => (b.thumb_size || 0) - (a.thumb_size || 0))[0];
      g.thumb = best && best.thumb;
      const art = (App.gameArt || {})[g.game] || {};
      g.icon = art.icon || null;
      g.banner = art.banner || null;
    }
    return [...by.values()].sort((a, b) => b.last - a.last);
  },
  renderGuilds() {
    const el = clear(this.guilds);
    const item = (key, content, title, onclick, extra = {}) => {
      const on = this.guild === key;
      const g = h('.guild' + (on ? '.on' : ''), { title, onclick, oncontextmenu: extra.menu },
        h('.pill'), h('.gi', { style: extra.style || {} }, content));
      return g;
    };
    el.appendChild(item('home', h('img.logo', { src: 'icon.svg', alt: 'Kosmas', draggable: false }), tr('Whole catalog – all games'), () => { this.setGuild('home'); App.go('home'); }));
    el.appendChild(h('.gsep'));
    for (const g of this.games()) {
      const initials = g.game.split(/\s+/).map(w => w[0]).join('').slice(0, 3);
      const pic = g.icon || g.thumb;
      el.appendChild(item(g.game, pic ? null : h('span', initials),
        `${g.game}\n` + tr('{duration} recorded', { duration: fmt.durHuman(g.dur) }) + ' · ' + trn(g.n, '{n} video', '{n} videos'),
        () => { this.setGuild(g.game); App.go('library', { game: g.game }); },
        { style: pic ? { backgroundImage: `url("${pic}")` } : { background: gameHue(g.game) },
          menu: e => menu(e, [
            { label: tr('Game library'), icon: 'clapperboard', onClick: () => { this.setGuild(g.game); App.go('library', { game: g.game }); } },
            { label: tr('Moments from this game'), icon: 'bookmark', onClick: () => { this.setGuild(g.game); App.go('moments', { game: g.game }); } },
            { label: tr('Suggest events'), icon: 'wand-sparkles', onClick: () => App.go('events', { propose: true }) },
            { sep: true },
            { label: tr('Game icon and banner…'), icon: 'image', onClick: () => gameArtDialog(g.game) },
            { label: tr('Add server…'), icon: 'server', onClick: () => serverDialog({ game: g.game }) },
          ]) }));
    }
  },
  setGuild(key) {
    if (this.guild === key) return;
    this.guild = key;
    App.setScope({ game: key === 'home' ? null : key, server: null });
    this.renderChannels();
    $$('.guild', this.guilds).forEach(x => x.classList.remove('on'));
    this.renderGuilds();
    this.renderChanHead();
  },

  /* ---------- channel column ---------- */
  renderChanHead() {
    const sv = App.scope.server && App.serversById.get(App.scope.server);
    const title = this.guild === 'home' ? 'Kosmas' : (sv ? `${this.guild} · ${sv.name}` : this.guild);
    clear(this.chanHead).append(h('span.ellipsis', title), icon('chevron-down', 'faint'));
    this.chanHead.onclick = e => menu(e, [
      { label: tr('Load new recordings'), icon: 'refresh-cw', onClick: () => { API.call('rescan'); toast(tr('Looking for new recordings…')); } },
      { label: tr('Suggest events from recordings'), icon: 'wand-sparkles', onClick: () => App.go('events', { propose: true }) },
      { label: tr('New event'), icon: 'calendar-plus', onClick: () => App.go('events', { create: true }) },
      { sep: true },
      { label: tr('Appearance and settings'), icon: 'settings', onClick: () => App.go('settings') },
      { label: tr('Open data folder'), icon: 'folder-open', onClick: () => API.call('open_data_dir') },
    ]);
  },
  renderChannels() {
    this.renderChanHead();
    const nav = clear(this.nav);
    if (this.guild !== 'home') {
      const game = this.guild;
      const svs = App.servers.filter(s => s.game === game);
      nav.appendChild(h('.cat', h('span', tr('Servers')), h('span.grow'),
        h('span.cat-add', { title: tr('Add server'), onclick: e => { e.stopPropagation(); serverDialog({ game }); } }, icon('plus'))));
      const svChan = (id, label, color, extra = {}) => h('.chan' + ((App.scope.server || null) === id ? '.on' : ''), {
        onclick: () => { App.setScope({ server: id }); this.renderChannels(); Views.show(Views.activeName, {}); },
        oncontextmenu: extra.menu,
      }, color ? h('span.dot', { style: { background: color, width: '10px', height: '10px', margin: '0 4px' } }) : icon('layers'), h('span.ellipsis', label),
      extra.n != null ? h('span.chan-n', extra.n) : null);
      nav.appendChild(svChan(null, tr('all servers'), null));
      const def = App.defaultServer(game);
      svs.forEach(sv => nav.appendChild(svChan(sv.id, sv.name + (def === sv.id && svs.length > 1 ? ' ★' : ''), sv.color, { n: sv.n_media || null,
        menu: e => menu(e, [
          { label: tr('Edit server…'), icon: 'pencil', onClick: () => serverDialog(sv) },
          def !== sv.id ? { label: tr('Set as default'), icon: 'star', onClick: async () => {
            await API.call('server.default', { id: sv.id }); await App.loadServers(); await App.refresh('media'); this.renderChannels();
            toast(tr('Default server: {name} – videos without a server and new items will go here', { name: sv.name }));
          } } : { head: tr("This game's default server") },
          { label: tr('Delete server'), icon: 'trash-2', danger: true, onClick: async () => {
            if (!await confirmDialog(tr('Delete server'), tr('Delete “{name}”? Videos, events and characters will stay, just without a server.', { name: sv.name }), { danger: true, okLabel: tr('Delete') })) return;
            await API.call('server.delete', { id: sv.id }); await App.loadServers(); if (App.scope.server === sv.id) App.setScope({ server: null });
            await App.refresh('media', 'events', 'chars'); this.renderChannels(); Views.show(Views.activeName, {});
          } },
        ]) })));
      if (!svs.length) nav.appendChild(h('.chan.faint', { onclick: () => serverDialog({ game }) }, icon('plus'), h('span', tr('add server'))));
    }
    for (const [cat, catLabel, items] of this.CHANNELS) {
      const closed = this.catsClosed.has(cat);
      nav.appendChild(h('.cat' + (closed ? '.closed' : ''), {
        onclick: () => { closed ? this.catsClosed.delete(cat) : this.catsClosed.add(cat); App.ui.catsClosed = [...this.catsClosed]; App.saveUi(); this.renderChannels(); },
      }, icon('chevron-down'), h('span', catLabel)));
      for (const [view, ic, label] of items) {
        const on = Views.activeName === view;
        if (closed && !on) continue;
        nav.appendChild(h('.chan' + (on ? '.on' : ''), { 'data-view': view, onclick: () => App.go(view) },
          icon(ic), h('span.ellipsis', label)));
      }
    }
  },
  /** Container in the channel column for view-specific navigation (cleared on every view switch). */
  slot() { return this.slotEl; },

  /* ---------- now playing (bottom of the channel column) ---------- */
  renderNowPlaying() {
    const p = App.player || {};
    const m = p.media_id && App.mediaById.get(p.media_id);
    this.np.classList.toggle('hidden', !m);
    if (!m) return;
    const act = a => API.call('player.action', { act: a });
    const pct = m.duration ? Math.min(100, (p.pos || 0) / m.duration * 100) : 0;
    if (this._npId === m.id && this.np.firstChild) {
      $('.np-state', this.np).textContent = p.playing ? tr('Playing') : tr('Paused');
      $('.np-state', this.np).classList.toggle('paused', !p.playing);
      $('.np-time', this.np).textContent = `${fmt.clock(p.pos)} / ${fmt.dur(m.duration)}`;
      $('.np-prog i', this.np).style.width = pct + '%';
      $('.np-play', this.np).replaceChildren(icon(p.playing ? 'pause' : 'play'));
      $('.np-pop', this.np).classList.toggle('on', !!p.popout);
      return;
    }
    this._npId = m.id;
    clear(this.np).append(
      h('.np-top',
        h('.grow', { style: { minWidth: 0 } },
          h('.np-state' + (p.playing ? '' : '.paused'), p.playing ? tr('Playing') : tr('Paused')),
          h('.np-title.ellipsis', { title: m.name, onclick: () => App.go('library', { select: [m.id] }) }, m.name),
          h('.np-time', `${fmt.clock(p.pos)} / ${fmt.dur(m.duration)}`)),
        h('button.npb', { title: tr('Close player'), onclick: () => act('close') }, icon('x'))),
      h('.np-prog', h('i', { style: { width: pct + '%' } })),
      h('.np-ctl',
        h('button.npb', { title: tr('−10 s'), onclick: () => act('-5') }, icon('rotate-ccw')),
        h('button.npb.np-play', { title: tr('Pause (space)'), onclick: () => act('pause') }, icon(p.playing ? 'pause' : 'play')),
        h('button.npb', { title: tr('+10 s'), onclick: () => act('+5') }, icon('rotate-cw')),
        h('button.npb', { title: tr('Moment (B)'), onclick: () => act('bm') }, icon('bookmark-plus')),
        h('button.npb', { title: tr('Tag the characters present at this moment (C)'), onclick: () => act('tagchar') }, icon('user-round-plus')),
        h('button.npb', { title: tr('Screenshot (S)'), onclick: () => act('snap') }, icon('camera')),
        h('button.npb.np-pop' + (p.popout ? '.on' : ''), { title: tr('Pop-out window'), onclick: () => act('popout') }, icon('picture-in-picture-2'))));
  },

  renderUser() {
    clear(this.user).append(
      h('.ub-avatar', 'K'),
      h('.grow', { style: { minWidth: 0 } }, h('.ub-name.ellipsis', 'Kosmas'), h('.ub-sub.ellipsis', trn(App.media.length, '{n} video', '{n} videos') + ' · ' + trn(App.events.length, '{n} event', '{n} events'))),
      h('button.npb', { title: tr('Load new recordings (F5)'), onclick: () => { API.call('rescan'); toast(tr('Looking for new recordings…')); } }, icon('refresh-cw')),
      h('button.npb', { title: tr('Settings'), onclick: () => App.go('settings') }, icon('settings')));
  },

  /* ---------- top bar of the main column ---------- */
  header({ icon: ic, title, topic, actions } = {}) {
    clear(this.top).append(
      h('.tb-title', ic ? icon(ic) : null, h('span', title || '')),
      topic ? h('.tb-sep') : null,
      topic ? h('.tb-topic.ellipsis', topic) : null,
      h('.grow'),
      ...(actions || []),
      this.membersAllowed ? h('button.tb-btn' + (this.membersOn() ? '.on' : ''), {
        title: tr('Character list'), onclick: () => { App.ui.members = !this.membersOn(); App.saveUi(); this.applyMembers(); this.header(this._hdr); },
      }, icon('users')) : null);
    this._hdr = { icon: ic, title, topic, actions };
  },
  setTopic(topic) { if (this._hdr) { this._hdr.topic = topic; this.header(this._hdr); } },

  /* ---------- right column: characters ---------- */
  membersOn() { return App.ui.members !== false; },
  applyMembers() { this.members.classList.toggle('hidden', !(this.membersAllowed && this.membersOn())); },
  setContext(ctx) { this.context = ctx; this.renderMembers(); },
  renderMembers() {
    const el = clear(this.members);
    if (!App.chars.length) {
      el.appendChild(h('.mem-empty', icon('users'), h('div', tr('No characters yet')),
        h('button.btn.sm', { onclick: () => App.go('characters') }, icon('user-plus'), tr('Create character'))));
      return;
    }
    const row = c => {
      const st = CHAR_STATUS[c.status] || CHAR_STATUS.alive || { color: 'var(--ok)' };
      const gone = c.status === 'dead' || c.status === 'gone';
      return h('.mem' + (gone ? '.gone' : ''), { onclick: e => this.charPopout(c, e.currentTarget) },
        h('.mav', avatar(c, 32), h('span.st', { style: { background: st.color || 'var(--ok)' }, title: st.label || '' })),
        h('.grow', { style: { minWidth: 0 } },
          h('.mn.ellipsis', { style: { color: c.color || null } }, c.name),
          c.faction || c.player ? h('.ms.ellipsis', [c.faction, c.player && tr('played by {player}', { player: c.player })].filter(Boolean).join(' · ')) : null),
        ptagChips(c.player_tags));
    };
    const group = (label, list) => {
      if (!list.length) return;
      el.appendChild(h('.mem-cat', `${label} — ${list.length}`));
      list.forEach(c => el.appendChild(row(c)));
    };
    const ctxIds = this.context && this.context.chars ? new Set(this.context.chars) : null;
    if (ctxIds) group(this.context.label || tr('Here'), App.chars.filter(c => ctxIds.has(c.id)));
    const rest = App.chars.filter(c => !ctxIds || !ctxIds.has(c.id)).sort((a, b) => a.name.localeCompare(b.name, I18N.locale));
    const alive = c => !(c.status === 'dead' || c.status === 'gone');
    for (const [k, v] of Object.entries(CHAR_KIND)) group(v.plural || v.label, rest.filter(c => c.kind === k && alive(c)));
    group(tr('Dead and missing'), rest.filter(c => !alive(c)));
  },
  charPopout(c, anchor) {
    $$('.char-pop').forEach(x => x.remove());
    const r = anchor.getBoundingClientRect();
    const evs = App.events.filter(e => (e.chars || []).includes(c.id)).sort((a, b) => (b.start_time || 0) - (a.start_time || 0));
    const pop = h('.char-pop',
      h('.cp-banner', { style: { background: c.color || 'var(--accent)' } }),
      h('.cp-av', avatar(c, 76)),
      h('.cp-body',
        h('.cp-name', c.name),
        h('.cp-sub', [CHAR_KIND[c.kind]?.label, c.faction, CHAR_STATUS[c.status]?.label].filter(Boolean).join(' · ')),
        c.summary ? h('.cp-sec', h('.cp-h', tr('About the character')), h('div', c.summary)) : null,
        evs.length ? h('.cp-sec', h('.cp-h', tr('Events') + ` — ${evs.length}`),
          evs.slice(0, 4).map(e => h('.cp-ev', { onclick: () => { pop.remove(); App.go('events', { id: e.id }); } },
            h('span.dot', { style: { background: e.color } }), h('span.ellipsis', e.title), h('span.faint', e.start_time ? fmt.date(e.start_time) : '')))) : null,
        h('.row', { style: { marginTop: '12px' } },
          h('button.btn.sm.primary', { onclick: () => { pop.remove(); App.go('characters', { id: c.id }); } }, tr('Open profile')),
          h('button.btn.sm', { onclick: () => { pop.remove(); App.go('library'); setTimeout(() => App.go('library', { char: c.id }), 0); } }, tr('Videos')))));
    document.body.appendChild(pop);
    const pr = pop.getBoundingClientRect();
    pop.style.left = Math.max(8, r.left - pr.width - 12) + 'px';
    pop.style.top = Math.max(8, Math.min(innerHeight - pr.height - 8, r.top - 20)) + 'px';
    setTimeout(() => {
      const off = e => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', off); } };
      document.addEventListener('mousedown', off);
    }, 0);
  },

  /* called by Views.show */
  beforeShow() { clear(this.slotEl); this.context = null; },
  afterShow(name, def) {
    $$('.chan', this.nav).forEach(c => c.classList.toggle('on', c.dataset.view === name));
    if (!$(`.chan[data-view="${name}"]`, this.nav)) this.renderChannels();
    this.membersAllowed = def.members !== false;
    this.applyMembers();

    if (!this._hdrSet) this.header({ icon: def.icon, title: (def.title || '').toLowerCase() });
    this._hdrSet = false;
    this.renderMembers();
    this.renderUser();
  },
};

function gameHue(g) {
  let x = 0; for (const ch of g || '') x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[x % PALETTE.length];
}

/** Create / edit a server (name, colour, period it was played). */
function serverDialog(sv, { onSaved = null, switchScope = true } = {}) {
  const isNew = !sv.id;
  const games = [...new Set([...Shell.games().map(g => g.game), ...App.servers.map(x => x.game)])].sort((a, b) => a.localeCompare(b, I18N.locale));
  const gameSel = h('select.input', games.map(g => h('option', { value: g, selected: g === sv.game }, g)));
  const name = h('input.input', { value: sv.name || '', placeholder: tr('e.g. Kingdoms Connected – CZ/SK'), autofocus: true, onkeydown: e => e.stopPropagation() });
  const day = t => t ? fmt.toInput(t).slice(0, 10) : '';
  const from = h('input.input', { type: 'date', value: day(sv.active_from) });
  const to = h('input.input', { type: 'date', value: day(sv.active_to) });
  const notes = h('textarea.input', { rows: 2, placeholder: tr("Notes (address, the server's Discord…)") }, sv.notes || '');
  let color = sv.color || PALETTE[(App.servers.length + 1) % PALETTE.length];
  const sw = h('.row', { style: { gap: '6px' } });
  const renderSw = () => clear(sw).append(...PALETTE.map(c => h('span', { style: { width: '22px', height: '22px', borderRadius: '50%', background: c, cursor: 'pointer',
    outline: c === color ? '2px solid var(--text)' : 'none', outlineOffset: '2px' }, onclick: () => { color = c; renderSw(); } })));
  renderSw();
  const ts = (v, end) => v ? new Date(v + (end ? 'T23:59:59' : 'T00:00:00')).getTime() / 1000 : null;
  modal({ title: isNew ? (sv.game ? tr('New server – {game}', { game: sv.game }) : tr('New server')) : tr('Edit server'), icon: 'server',
    body: h('.col', { style: { gap: '10px' } }, !sv.game ? h('label.field', tr('Game'), gameSel) : null, name,
      h('.small.muted', tr('When you played on the server – videos from this period will be assigned to it automatically (leave empty if the game has only one server).')),
      h('.row', h('label.field', tr('From'), from), h('label.field', tr('To'), to)), h('.small.muted', tr('Colour')), sw, notes),
    actions: [{ label: tr('Cancel') }, { label: isNew ? tr('Add') : tr('Save'), primary: true, onClick: async () => {
      if (!name.value.trim()) { toast(tr('Enter the server name'), 'err'); return false; }
      const f = { name: name.value.trim(), color, active_from: ts(from.value), active_to: ts(to.value, true), notes: notes.value };
      let id = sv.id;
      if (isNew) { id = await API.call('server.create', { game: sv.game || gameSel.value, ...f }); await App.loadServers(); if (switchScope) App.setScope({ server: id }); }
      else { await API.call('server.update', { id: sv.id, ...f }); await App.loadServers(); }
      await App.refresh('media'); Shell.renderChannels();
      if (onSaved) onSaved(id); else Views.show(Views.activeName, {});
    } }] });
}
window.serverDialog = serverDialog;

/* hook the router */
Views.buildRail = () => Shell.build();
(() => {
  const show = Views.show.bind(Views);
  Views.show = function (name, params = {}) {
    const def = this.defs[name];
    if (!def) return;
    Shell.beforeShow();
    // let the view set its own header during mount; otherwise a default one is used
    const origHeader = Shell.header.bind(Shell);
    Shell.header = opts => { Shell._hdrSet = true; origHeader(opts); };
    Shell.membersAllowed = def.members !== false;
    show(name, params);
    Shell.header = origHeader;
    Shell.afterShow(name, def);
  };
})();
