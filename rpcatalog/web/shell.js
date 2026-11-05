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
    ['Katalog', [['home', 'house', 'přehled'], ['library', 'clapperboard', 'knihovna'], ['moments', 'bookmark', 'momenty'], ['gallery', 'images', 'galerie']]],
    ['Příběh', [['events', 'calendar-range', 'události'], ['timeline', 'chart-gantt', 'časová osa'], ['letters', 'mail', 'holubí pošta']]],
    ['Svět', [['places', 'map', 'místa'], ['factions', 'shield', 'frakce a rody']]],
    ['Postavy', [['characters', 'users', 'databáze postav'], ['players', 'gamepad-2', 'hráči']]],
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
    App.on('media', () => { this.renderGuilds(); });
    App.on('events', () => { this.renderMembers(); });
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
    el.appendChild(item('home', h('span.logo', 'K'), 'Celý katalog – všechny hry', () => { this.setGuild('home'); App.go('home'); }));
    el.appendChild(h('.gsep'));
    for (const g of this.games()) {
      const initials = g.game.split(/\s+/).map(w => w[0]).join('').slice(0, 3);
      el.appendChild(item(g.game, g.thumb ? null : h('span', initials),
        `${g.game}\n${fmt.durHuman(g.dur)} nahráno · ${g.n} videí`,
        () => { this.setGuild(g.game); App.go('library', { game: g.game }); },
        { style: g.thumb ? { backgroundImage: `url("${g.thumb}")` } : { background: gameHue(g.game) },
          menu: e => menu(e, [
            { label: 'Knihovna hry', icon: 'clapperboard', onClick: () => { this.setGuild(g.game); App.go('library', { game: g.game }); } },
            { label: 'Momenty z této hry', icon: 'bookmark', onClick: () => { this.setGuild(g.game); App.go('moments', { game: g.game }); } },
            { label: 'Navrhnout události', icon: 'wand-sparkles', onClick: () => App.go('events', { propose: true }) },
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
    const title = this.guild === 'home' ? 'Kronikář' : (sv ? `${this.guild} · ${sv.name}` : this.guild);
    clear(this.chanHead).append(h('span.ellipsis', title), icon('chevron-down', 'faint'));
    this.chanHead.onclick = e => menu(e, [
      { label: 'Načíst nové záznamy', icon: 'refresh-cw', onClick: () => { API.call('rescan'); toast('Hledám nové záznamy…'); } },
      { label: 'Navrhnout události ze záznamů', icon: 'wand-sparkles', onClick: () => App.go('events', { propose: true }) },
      { label: 'Nová událost', icon: 'calendar-plus', onClick: () => App.go('events', { create: true }) },
      { sep: true },
      { label: 'Vzhled a nastavení', icon: 'settings', onClick: () => App.go('settings') },
      { label: 'Otevřít složku s daty', icon: 'folder-open', onClick: () => API.call('open_data_dir') },
    ]);
  },
  renderChannels() {
    this.renderChanHead();
    const nav = clear(this.nav);
    if (this.guild !== 'home') {
      const game = this.guild;
      const svs = App.servers.filter(s => s.game === game);
      nav.appendChild(h('.cat', h('span', 'Servery'), h('span.grow'),
        h('span.cat-add', { title: 'Přidat server', onclick: e => { e.stopPropagation(); serverDialog({ game }); } }, icon('plus'))));
      const svChan = (id, label, color, extra = {}) => h('.chan' + ((App.scope.server || null) === id ? '.on' : ''), {
        onclick: () => { App.setScope({ server: id }); this.renderChannels(); Views.show(Views.activeName, {}); },
        oncontextmenu: extra.menu,
      }, color ? h('span.dot', { style: { background: color, width: '10px', height: '10px', margin: '0 4px' } }) : icon('layers'), h('span.ellipsis', label),
      extra.n != null ? h('span.chan-n', extra.n) : null);
      nav.appendChild(svChan(null, 'všechny servery', null));
      svs.forEach(sv => nav.appendChild(svChan(sv.id, sv.name, sv.color, { n: sv.n_media || null,
        menu: e => menu(e, [
          { label: 'Upravit server…', icon: 'pencil', onClick: () => serverDialog(sv) },
          { label: 'Smazat server', icon: 'trash-2', danger: true, onClick: async () => {
            if (!await confirmDialog('Smazat server', `Smazat „${sv.name}“? Videa, události a postavy zůstanou, jen bez serveru.`, { danger: true, okLabel: 'Smazat' })) return;
            await API.call('server.delete', { id: sv.id }); await App.loadServers(); if (App.scope.server === sv.id) App.setScope({ server: null });
            await App.refresh('media', 'events', 'chars'); this.renderChannels(); Views.show(Views.activeName, {});
          } },
        ]) })));
      if (!svs.length) nav.appendChild(h('.chan.faint', { onclick: () => serverDialog({ game }) }, icon('plus'), h('span', 'přidat server')));
    }
    for (const [cat, items] of this.CHANNELS) {
      const closed = this.catsClosed.has(cat);
      nav.appendChild(h('.cat' + (closed ? '.closed' : ''), {
        onclick: () => { closed ? this.catsClosed.delete(cat) : this.catsClosed.add(cat); App.ui.catsClosed = [...this.catsClosed]; App.saveUi(); this.renderChannels(); },
      }, icon('chevron-down'), h('span', cat)));
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
      $('.np-state', this.np).textContent = p.playing ? 'Přehrává se' : 'Pozastaveno';
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
          h('.np-state' + (p.playing ? '' : '.paused'), p.playing ? 'Přehrává se' : 'Pozastaveno'),
          h('.np-title.ellipsis', { title: m.name, onclick: () => App.go('library', { select: [m.id] }) }, m.name),
          h('.np-time', `${fmt.clock(p.pos)} / ${fmt.dur(m.duration)}`)),
        h('button.npb', { title: 'Zavřít přehrávač', onclick: () => act('close') }, icon('x'))),
      h('.np-prog', h('i', { style: { width: pct + '%' } })),
      h('.np-ctl',
        h('button.npb', { title: '−10 s', onclick: () => act('-5') }, icon('rotate-ccw')),
        h('button.npb.np-play', { title: 'Pauza (mezerník)', onclick: () => act('pause') }, icon(p.playing ? 'pause' : 'play')),
        h('button.npb', { title: '+10 s', onclick: () => act('+5') }, icon('rotate-cw')),
        h('button.npb', { title: 'Záložka (B)', onclick: () => act('bm') }, icon('bookmark-plus')),
        h('button.npb', { title: 'Označit postavu v tomto momentu (O)', onclick: () => act('tagchar') }, icon('user-round-plus')),
        h('button.npb', { title: 'Snímek (S)', onclick: () => act('snap') }, icon('camera')),
        h('button.npb.np-pop' + (p.popout ? '.on' : ''), { title: 'Vyskakovací okno', onclick: () => act('popout') }, icon('picture-in-picture-2'))));
  },

  renderUser() {
    clear(this.user).append(
      h('.ub-avatar', 'K'),
      h('.grow', { style: { minWidth: 0 } }, h('.ub-name.ellipsis', 'Kronikář'), h('.ub-sub.ellipsis', `${App.media.length} videí · ${App.events.length} událostí`)),
      h('button.npb', { title: 'Načíst nové záznamy (F5)', onclick: () => { API.call('rescan'); toast('Hledám nové záznamy…'); } }, icon('refresh-cw')),
      h('button.npb', { title: 'Nastavení', onclick: () => App.go('settings') }, icon('settings')));
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
        title: 'Seznam postav', onclick: () => { App.ui.members = !this.membersOn(); App.saveUi(); this.applyMembers(); this.header(this._hdr); },
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
      el.appendChild(h('.mem-empty', icon('users'), h('div', 'Zatím žádné postavy'),
        h('button.btn.sm', { onclick: () => App.go('characters') }, icon('user-plus'), 'Založit postavu')));
      return;
    }
    const row = c => {
      const st = CHAR_STATUS[c.status] || CHAR_STATUS.alive || { color: 'var(--ok)' };
      const gone = c.status === 'dead' || c.status === 'gone';
      return h('.mem' + (gone ? '.gone' : ''), { onclick: e => this.charPopout(c, e.currentTarget) },
        h('.mav', avatar(c, 32), h('span.st', { style: { background: st.color || 'var(--ok)' }, title: st.label || '' })),
        h('.grow', { style: { minWidth: 0 } },
          h('.mn.ellipsis', { style: { color: c.color || null } }, c.name),
          c.faction || c.player ? h('.ms.ellipsis', [c.faction, c.player && 'hraje ' + c.player].filter(Boolean).join(' · ')) : null),
        ptagChips(c.player_tags));
    };
    const group = (label, list) => {
      if (!list.length) return;
      el.appendChild(h('.mem-cat', `${label} — ${list.length}`));
      list.forEach(c => el.appendChild(row(c)));
    };
    const ctxIds = this.context && this.context.chars ? new Set(this.context.chars) : null;
    if (ctxIds) group(this.context.label || 'Tady', App.chars.filter(c => ctxIds.has(c.id)));
    const rest = App.chars.filter(c => !ctxIds || !ctxIds.has(c.id)).sort((a, b) => a.name.localeCompare(b.name, 'cs'));
    const alive = c => !(c.status === 'dead' || c.status === 'gone');
    for (const [k, v] of Object.entries(CHAR_KIND)) group(v.plural || v.label, rest.filter(c => c.kind === k && alive(c)));
    group('Mrtví a zmizelí', rest.filter(c => !alive(c)));
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
        c.summary ? h('.cp-sec', h('.cp-h', 'O postavě'), h('div', c.summary)) : null,
        evs.length ? h('.cp-sec', h('.cp-h', `Události — ${evs.length}`),
          evs.slice(0, 4).map(e => h('.cp-ev', { onclick: () => { pop.remove(); App.go('events', { id: e.id }); } },
            h('span.dot', { style: { background: e.color } }), h('span.ellipsis', e.title), h('span.faint', e.start_time ? fmt.date(e.start_time) : '')))) : null,
        h('.row', { style: { marginTop: '12px' } },
          h('button.btn.sm.primary', { onclick: () => { pop.remove(); App.go('characters', { id: c.id }); } }, 'Otevřít profil'),
          h('button.btn.sm', { onclick: () => { pop.remove(); App.go('library'); setTimeout(() => App.go('library', { char: c.id }), 0); } }, 'Videa'))));
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
function serverDialog(sv) {
  const isNew = !sv.id;
  const name = h('input.input', { value: sv.name || '', placeholder: 'např. Kingdoms Connected – CZ/SK', autofocus: true, onkeydown: e => e.stopPropagation() });
  const day = t => t ? fmt.toInput(t).slice(0, 10) : '';
  const from = h('input.input', { type: 'date', value: day(sv.active_from) });
  const to = h('input.input', { type: 'date', value: day(sv.active_to) });
  const notes = h('textarea.input', { rows: 2, placeholder: 'Poznámky (adresa, Discord serveru…)' }, sv.notes || '');
  let color = sv.color || PALETTE[(App.servers.length + 1) % PALETTE.length];
  const sw = h('.row', { style: { gap: '6px' } });
  const renderSw = () => clear(sw).append(...PALETTE.map(c => h('span', { style: { width: '22px', height: '22px', borderRadius: '50%', background: c, cursor: 'pointer',
    outline: c === color ? '2px solid var(--text)' : 'none', outlineOffset: '2px' }, onclick: () => { color = c; renderSw(); } })));
  renderSw();
  const ts = (v, end) => v ? new Date(v + (end ? 'T23:59:59' : 'T00:00:00')).getTime() / 1000 : null;
  modal({ title: isNew ? `Nový server – ${sv.game}` : 'Upravit server', icon: 'server',
    body: h('.col', { style: { gap: '10px' } }, name,
      h('.small.muted', 'Kdy jsi na serveru hrál – videa z tohoto období se k němu přiřadí sama (nech prázdné, pokud má hra jen jeden server).'),
      h('.row', h('label.field', 'Od', from), h('label.field', 'Do', to)), h('.small.muted', 'Barva'), sw, notes),
    actions: [{ label: 'Zrušit' }, { label: isNew ? 'Přidat' : 'Uložit', primary: true, onClick: async () => {
      if (!name.value.trim()) { toast('Zadej název serveru', 'err'); return false; }
      const f = { name: name.value.trim(), color, active_from: ts(from.value), active_to: ts(to.value, true), notes: notes.value };
      if (isNew) { const id = await API.call('server.create', { game: sv.game, ...f }); await App.loadServers(); App.setScope({ server: id }); }
      else { await API.call('server.update', { id: sv.id, ...f }); await App.loadServers(); }
      await App.refresh('media'); Shell.renderChannels(); Views.show(Views.activeName, {});
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
