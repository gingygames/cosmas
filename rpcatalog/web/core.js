/* ============================================================
   Kronikář – core: API bridge, state, DOM helpers, dialogs
   Conventions for view modules:
     Views.register(name, { title, icon, order, mount(root, params), unmount(), onData(kind) })
     App.go(name, params)  – navigate
     App.on(kind, fn)      – 'media' | 'events' | 'chars' | 'albums' | 'player'
   ============================================================ */
'use strict';

/* ---------------- API ---------------- */
const API = {
  src: Math.random().toString(36).slice(2),   // identifies this page in change notifications
  _bridge: null,
  _listeners: {},
  _ready: null,
  init() {
    this._ready = new Promise(resolve => {
      new QWebChannel(qt.webChannelTransport, ch => {
        this._bridge = ch.objects.api;
        this._bridge.notify.connect((kind, payload) => {
          let data = {};
          try { data = JSON.parse(payload); } catch (e) { /* ignore */ }
          if (kind === 'bg') this._bgDone(data);
          (this._listeners[kind] || []).forEach(fn => fn(data));
        });
        resolve();
      });
    });
    return this._ready;
  },
  call(method, args = {}) {
    return this._ready.then(() => new Promise((resolve, reject) => {
      // new things created while a server is selected belong to that server
      if (/^(event|char|faction|place)\.create$/.test(method) && App.scope && args.server_id === undefined) {
        const sid = App.scope.server || (App.scope.game && App.defaultServer(App.scope.game));
        if (sid) args = { ...args, server_id: sid };
      }
      this._bridge.call(method, JSON.stringify(Object.assign({}, args, { _src: this.src })), res => {
        let r;
        try { r = JSON.parse(res); } catch (e) { reject(String(e)); return; }
        if (r.error) { toast(r.error, 'err'); reject(r.error); }
        else if (r.ok && r.ok._bg) this._bgWait(r.ok._bg, resolve, reject);   // network work in a Python thread
        else resolve(r.ok);
      });
    }));
  },
  /* results of background calls arrive as the "bg" notification {id, ok | error} */
  _bgPending: {}, _bgEarly: {},
  _bgWait(id, resolve, reject) {
    const done = d => { if (d.error) { toast(d.error, 'err'); reject(d.error); } else resolve(d.ok); };
    if (this._bgEarly[id]) { done(this._bgEarly[id]); delete this._bgEarly[id]; return; }
    this._bgPending[id] = done;
  },
  _bgDone(d) {
    const fn = this._bgPending[d.id];
    if (fn) { delete this._bgPending[d.id]; fn(d); } else this._bgEarly[d.id] = d;
  },
  on(kind, fn) { (this._listeners[kind] = this._listeners[kind] || []).push(fn); },
};

/* ---------------- DOM ---------------- */
/* append()/prepend() would turn null into the text "null" – skip empty children everywhere */
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const fn of ['append', 'prepend', 'replaceChildren']) {
    const orig = proto[fn];
    proto[fn] = function (...kids) { return orig.apply(this, kids.flat(Infinity).filter(k => k != null && k !== false)); };
  }
}
function h(tag, attrs, ...children) {
  let id = null;
  const hashAt = tag.indexOf('#');
  if (hashAt >= 0) { id = tag.slice(hashAt + 1); tag = tag.slice(0, hashAt); }
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (id) el.id = id;
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs); attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = c => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}
const icon = (name, cls = '') => h('i', { class: `icon-${name} ${cls}`.trim() });
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
function debounce(fn, ms = 300) {
  let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); }; return d;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- formatting ---------------- */
/* month and day names from Intl in the UI locale (standalone month = Czech nominative "leden") */
const _names = (n, opts, date) => Array.from({ length: n }, (_, i) => new Intl.DateTimeFormat(I18N.locale, opts).format(date(i)));
const MONTHS = _names(12, { month: 'long' }, i => new Date(2000, i, 1));
const DAYS = _names(7, { weekday: 'long' }, i => new Date(2000, 0, 2 + i));          // 2 Jan 2000 = Sunday
const DAYS_SHORT = _names(7, { weekday: 'short' }, i => new Date(2000, 0, 2 + i));
const pad = n => String(n).padStart(2, '0');
const fmt = {
  dur(s) {
    if (s == null) return '?';
    s = Math.round(s); const hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
    return hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
  },
  durHuman(s) {
    if (!s) return '0 min';
    const hh = Math.floor(s / 3600), mm = Math.round(s % 3600 / 60);
    return hh ? `${hh} h ${mm ? mm + ' min' : ''}`.trim() : `${mm} min`;
  },
  clock(s) { return fmt.dur(s || 0); },
  d(t) { return new Date(t * 1000); },
  dt(t) { if (!t) return '—'; return `${fmt.date(t)} ${fmt.time(t)}`; },
  date(t) {
    if (!t) return '—'; const d = fmt.d(t);
    return I18N.lang === 'cs' ? `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`
      : d.toLocaleDateString(I18N.locale, { day: 'numeric', month: 'short', year: 'numeric' });
  },
  dateLong(t) { return fmt.d(t).toLocaleDateString(I18N.locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); },
  time(t) { if (!t) return ''; const d = fmt.d(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; },
  month(t) { const d = fmt.d(t); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; },
  range(a, b) {
    if (!a) return tr('no date');
    if (!b) return fmt.dt(a);
    const da = fmt.d(a), db = fmt.d(b);
    if (da.toDateString() === db.toDateString()) return `${fmt.date(a)} · ${fmt.time(a)}–${fmt.time(b)}`;
    return `${fmt.dt(a)} – ${fmt.dt(b)}`;
  },
  rel(t) {
    const diff = Date.now() / 1000 - t, day = 86400;
    if (diff < 3600) return tr('{n} min ago', { n: Math.max(1, Math.round(diff / 60)) });
    if (diff < day) return tr('{n} h ago', { n: Math.round(diff / 3600) });
    if (diff < 2 * day) return tr('yesterday');
    if (diff < 7 * day) return tr('{n} days ago', { n: Math.round(diff / day) });
    return fmt.date(t);
  },
  size(n) {
    if (!n) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    const dig = i >= 2 ? 1 : 0;
    return `${n.toLocaleString(I18N.locale, { minimumFractionDigits: dig, maximumFractionDigits: dig })} ${u[i]}`;
  },
  toInput(t) { if (!t) return ''; const d = fmt.d(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; },
  fromInput(v) { return v ? new Date(v).getTime() / 1000 : null; },
  /** Czech plural forms (1 / 2–4 / 5+); UI text uses trn() from i18n.js */
  plural(n, one, few, many) { return n === 1 ? one : (n >= 2 && n <= 4 ? few : many); },
};

const KIND = {
  clip: { label: tr('Clip'), plural: tr('Clips'), color: '#5aa9e6', icon: 'scissors' },
  session: { label: tr('Recording'), plural: tr('Full recordings'), color: '#e3b341', icon: 'film' },
  manual: { label: tr('Manual recording'), plural: tr('Manual recordings'), color: '#a77be8', icon: 'video' },
};
const CHAR_KIND = {
  mine: { label: tr('My character'), plural: tr('My characters'), icon: 'crown' },
  player: { label: tr('Character'), plural: tr('Characters'), icon: 'user' },
  npc: { label: 'NPC', plural: 'NPC', icon: 'bot' },
};
const CHAR_STATUS = {
  alive: { label: tr('Alive'), color: '#5cc98a' },
  dead: { label: tr('Dead'), color: '#ef6b73' },
  missing: { label: tr('Missing'), color: '#ef9a4b' },
  unknown: { label: tr('Unknown'), color: '#6d7480' },
};
/* Relation types. A stored relation (a, b, kind) means: b is <b-role> of a, a is <a-role> of b.
   Forms: [masculine, feminine]. Symmetric types have no "a". */
const REL_TYPES = [
  ['Love and family', [
    ['manzel', ['husband', 'wife']], ['snoubenec', ['fiancé', 'fiancée']], ['partner', ['partner', 'partner (f)']],
    ['milenec', ['lover', 'lover (f)']], ['ex', ['ex-partner', 'ex-partner (f)']],
    ['rodic', ['father', 'mother'], ['son', 'daughter']], ['prarodic', ['grandfather', 'grandmother'], ['grandson', 'granddaughter']],
    ['sourozenec', ['brother', 'sister']], ['nevlastni', ['stepbrother', 'stepsister']],
    ['stryc', ['uncle', 'aunt'], ['nephew', 'niece']], ['bratranec', ['cousin', 'cousin (f)']],
    ['tchan', ['father-in-law', 'mother-in-law'], ['son-in-law', 'daughter-in-law']], ['kmotr', ['godfather', 'godmother'], ['godson', 'goddaughter']]]],
  ['Friends and enemies', [
    ['pritel', ['friend', 'friend (f)']], ['kamarad', ['mate', 'mate (f)']], ['spojenec', ['ally', 'ally (f)']],
    ['znamy', ['acquaintance', 'acquaintance (f)']], ['soused', ['neighbour', 'neighbour (f)']], ['rival', ['rival', 'rival (f)']],
    ['nepritel', ['enemy', 'enemy (f)']], ['vrah', ['murderer', 'murderess'], ['victim', 'victim']]]],
  ['Service and lordship', [
    ['lenik', ['liege lord', 'liege lady'], ['vassal', 'vassal (f)']], ['vrchnost', ['overlord', 'overlord'], ['subject', 'subject (f)']],
    ['sluha', ['master', 'mistress'], ['servant', 'maidservant']], ['velitel', ['commander', 'commander (f)'], ['subordinate', 'subordinate (f)']],
    ['mistr', ['master craftsman', 'master craftswoman'], ['apprentice', 'apprentice (f)']], ['ochrance', ['protector', 'protectress'], ['protégé', 'protégée']],
    ['druh', ['brother in arms', 'sister in arms']]]],
  ['Trade and money', [
    ['obchod', ['business partner', 'business partner (f)']], ['dodavatel', ['supplier', 'supplier (f)'], ['customer', 'customer (f)']],
    ['veritel', ['creditor', 'creditor (f)'], ['debtor', 'debtor (f)']], ['zamestnavatel', ['employer', 'employer (f)'], ['employee', 'employee (f)']]]],
];
/* labels above are English source, translated here; " (f)" only tells feminine forms apart in the dictionary */
for (const grp of REL_TYPES) {
  grp[0] = tr(grp[0]);
  for (const t of grp[1]) for (const f of t.slice(1)) for (let i = 0; i < f.length; i++) f[i] = tr(f[i]).replace(/ \(f\)$/, '');
}
const REL_BY_KEY = new Map(REL_TYPES.flatMap(([, list]) => list.map(t => [t[0], t])));
/** Word for `who` in its role ('a' or 'b') of a relation kind, by who's gender. */
function relWord(kind, role, who) {
  const t = REL_BY_KEY.get(kind);
  if (!t) return '';
  const forms = role === 'a' && t[2] ? t[2] : t[1];
  const g = who && who.gender;
  return g === 'f' ? forms[1] : g === 'm' ? forms[0] : (forms[0] === forms[1] ? forms[0] : `${forms[0]} / ${forms[1]}`);
}

const PALETTE = ['#e3b341', '#5aa9e6', '#e5646e', '#5cc98a', '#a77be8', '#ef9a4b', '#40c4c4', '#e06aa8', '#9aa3b2'];

/* ---------------- app state ---------------- */
const App = {
  media: [], mediaById: new Map(),
  events: [], eventsById: new Map(),
  chars: [], charsById: new Map(),
  albums: [], tags: [], games: [], settings: {}, ui: {},
  player: { media_id: null, pos: 0, playing: false },
  _subs: {},
  on(kind, fn) { (this._subs[kind] = this._subs[kind] || []).push(fn); return () => this.off(kind, fn); },
  off(kind, fn) { this._subs[kind] = (this._subs[kind] || []).filter(f => f !== fn); },
  emit(kind, data) { (this._subs[kind] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); },

  async boot() {
    const b = await API.call('bootstrap');
    this.settings = b.settings; this.ui = b.settings.ui || {};
    this.albums = b.albums; this.tags = b.tags; this.games = b.games;
    this.setChars(b.characters);
    this.factions = b.factions || []; this.players = b.players || []; this.places = b.places || [];
    this.setServers(b.servers || []);
    this.gameArt = b.game_art || {};
    this.scope = Object.assign({ game: null, server: null }, this.ui.scope || {});
    await Promise.all([this.loadMedia(false), this.loadEvents(false)]);
  },
  async loadMedia(emit = true) {
    this.media = await API.call('media.list');
    this.mediaById = new Map(this.media.map(m => [m.id, m]));
    if (emit) this.emit('media');
  },
  async loadEvents(emit = true) {
    this.events = await API.call('events.list');
    this.eventsById = new Map(this.events.map(e => [e.id, e]));
    if (emit) this.emit('events');
  },
  servers: [], serversById: new Map(), scope: { game: null, server: null },
  setServers(list) { this.servers = list; this.serversById = new Map(list.map(s => [s.id, s])); },
  /** default server of a game: marked as default, or the only one */
  defaultServer(game) {
    const list = this.servers.filter(s => s.game === game);
    const marked = list.find(s => s.is_default);
    return marked ? marked.id : list.length === 1 ? list[0].id : null;
  },
  async loadServers() { this.setServers(await API.call('servers.list')); },
  setScope(patch) {
    Object.assign(this.scope, patch);
    if (this.scope.server && (this.serversById.get(this.scope.server) || {}).game !== this.scope.game) this.scope.server = null;
    this.ui.scope = { ...this.scope }; this.saveUi();
  },
  setChars(list) {
    this.chars = list; this.charsById = new Map(list.map(c => [c.id, c]));
  },
  async loadChars(emit = true) {
    const [chars, factions, players] = await Promise.all([API.call('chars.list'), API.call('factions.list'), API.call('players.list')]);
    this.setChars(chars); this.factions = factions; this.players = players;
    if (emit) this.emit('chars');
  },
  async loadMeta(emit = true) {
    const b = await API.call('bootstrap');
    this.albums = b.albums; this.tags = b.tags; this.games = b.games;
    if (emit) this.emit('albums');
  },
  /** Reload after a change. what: array of 'media' | 'events' | 'chars' | 'meta' */
  async refresh(...what) {
    const jobs = [];
    if (what.includes('media')) jobs.push(this.loadMedia(false));
    if (what.includes('events')) jobs.push(this.loadEvents(false));
    if (what.includes('chars')) jobs.push(this.loadChars(false));
    if (what.includes('meta') || what.includes('media')) jobs.push(this.loadMeta(false));
    await Promise.all(jobs);
    if (what.includes('media')) this.emit('media');
    if (what.includes('events')) this.emit('events');
    if (what.includes('chars')) this.emit('chars');
    if (what.includes('meta') || what.includes('media')) this.emit('albums');
  },
  saveUi: debounce(() => API.call('ui.save', { ui: App.ui }), 800),

  /* children helpers for the event tree */
  childrenOf(id) {
    return this.events.filter(e => e.parent_id === id).sort((a, b) => a.position - b.position || (a.start_time || 0) - (b.start_time || 0));
  },
  eventPath(id) {
    const out = []; let e = this.eventsById.get(id);
    while (e) { out.unshift(e); e = this.eventsById.get(e.parent_id); }
    return out;
  },

  /* navigation */
  current: null,
  go(view, params = {}) { Views.show(view, params); },
};

/** Is an item visible under the selected game / server? kind: media | other */
function inScope(x, kind = 'other') {
  const sc = App.scope || {};
  if (!x) return false;
  if (kind === 'media') {
    if (sc.game && x.game !== sc.game) return false;
    if (sc.server && x.server_id && x.server_id !== sc.server) return false;
    return true;
  }
  if (sc.server) return !x.server_id || x.server_id === sc.server;
  if (sc.game && x.server_id) { const sv = App.serversById.get(x.server_id); return !sv || sv.game === sc.game; }
  return true;
}

/** Chip + menu to put something on a server. onPick(serverId|null) */
function serverPicker(current, onPick, game = null) {
  const sv = current && App.serversById.get(current);
  const list = App.servers.filter(s => !game || s.game === game);
  const goTo = () => { Shell.setGuild(sv.game); App.setScope({ server: sv.id }); Shell.renderChannels(); App.go('library'); };
  return h('.row', { style: { gap: '6px' } },
    h('span.chip' + (sv ? '.on' : ''), sv ? { title: tr('Go to server {name} ({game})', { name: sv.name, game: sv.game }), onclick: goTo } : null,
      sv ? h('span.dot', { style: { background: sv.color } }) : null, sv ? sv.name : tr('no server'), sv ? h('span.faint', ' · ' + sv.game) : null),
    h('button.btn.sm', { onclick: e => menu(e, [
      ...list.map(s => ({ label: `${s.name}${game ? '' : ' · ' + s.game}${App.defaultServer(s.game) === s.id ? '  (' + tr('default') + ')' : ''}`, onClick: () => onPick(s.id) })),
      list.length ? { sep: true } : null,
      { label: tr('New server…'), icon: 'plus', onClick: () => serverDialog({ game }, { onSaved: id => onPick(id), switchScope: false }) },
      { label: tr('No server'), onClick: () => onPick(null) },
    ]) }, tr('Change')));
}

/* ---------------- views / router ---------------- */
const Views = {
  defs: {}, active: null, activeName: null,
  register(name, def) { this.defs[name] = def; },
  buildRail() {
    const rail = $('#rail'); clear(rail);
    rail.appendChild(h('.logo', 'RP'));
    const defs = Object.entries(this.defs).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
    for (const [name, def] of defs) {
      if (def.bottom) continue;
      rail.appendChild(h('button.nav', { 'data-view': name, title: def.title, onclick: () => App.go(name) },
        icon(def.icon), h('span', def.short || def.title)));
    }
    rail.appendChild(h('.spacer'));
    for (const [name, def] of defs) {
      if (!def.bottom) continue;
      rail.appendChild(h('button.nav', { 'data-view': name, title: def.title, onclick: () => App.go(name) },
        icon(def.icon), h('span', def.short || def.title)));
    }
  },
  show(name, params = {}) {
    const def = this.defs[name];
    if (!def) return;
    if (this.active && this.active.unmount) this.active.unmount();
    const root = clear($('#view'));
    this.active = def; this.activeName = name;
    $$('#rail .nav').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    def.mount(root, params);
    App.ui.view = name; App.saveUi();
  },
};

/* ---------------- overlays ---------------- */
function overlayRoot() { return $('#overlays'); }

function toast(msg, type = 'ok', action) {
  let box = $('#toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.appendChild(box); }
  const t = h('.toast.' + type, icon(type === 'err' ? 'circle-alert' : 'circle-check'), h('span', msg),
    action ? h('span.act', { onclick: () => { action.fn(); t.remove(); } }, action.label) : null);
  box.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = 0; setTimeout(() => t.remove(), 300); },
    type === 'err' ? 6000 : 3200);
}

/** modal({title, body, actions:[{label, primary, danger, onClick}], wide, xwide, onClose}) */
function modal({ title, body, actions = [], wide = false, xwide = false, onClose, icon: ic }) {
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); onClose && onClose(); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const footer = h('footer');
  for (const a of actions) {
    footer.appendChild(h(`button.btn${a.primary ? '.primary' : ''}${a.danger ? '.danger' : ''}`, {
      onclick: async () => { const r = a.onClick ? await a.onClick() : true; if (r !== false) close(); },
    }, a.icon ? icon(a.icon) : null, a.label));
  }
  const box = h(`.modal${wide ? '.wide' : ''}${xwide ? '.xwide' : ''}`,
    h('header', ic ? icon(ic) : null, h('h2', title), h('button.btn.ghost.icon', { onclick: close, title: tr('Close') }, icon('x'))),
    h('.body', body), actions.length ? footer : null);
  const back = h('.backdrop', { onmousedown: e => { if (e.target === back) close(); } }, box);
  overlayRoot().appendChild(back);
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => { const f = box.querySelector('[autofocus], .input'); f && f.focus(); }, 30);
  return { close, box };
}

function confirmDialog(title, text, { danger = false, okLabel = tr('Continue') } = {}) {
  return new Promise(resolve => {
    let done = false;
    modal({
      title, body: h('p.muted', { style: { margin: '4px 0 6px', whiteSpace: 'pre-line' } }, text),
      onClose: () => { if (!done) resolve(false); },
      actions: [
        { label: tr('Cancel'), onClick: () => { done = true; resolve(false); } },
        { label: okLabel, primary: !danger, danger, onClick: () => { done = true; resolve(true); } },
      ],
    });
  });
}

function promptDialog(title, label, value = '', { placeholder = '', multiline = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    const inp = multiline
      ? h('textarea.input', { rows: 4, placeholder, autofocus: true }, value)
      : h('input.input', { value, placeholder, autofocus: true });
    const submit = () => { done = true; resolve(inp.value.trim() || null); };
    if (!multiline) inp.addEventListener('keydown', e => { if (e.key === 'Enter') { submit(); m.close(); } });
    const m = modal({
      title, body: h('label.field', label, inp),
      onClose: () => { if (!done) resolve(null); },
      actions: [{ label: tr('Cancel'), onClick: () => { done = true; resolve(null); } },
        { label: 'OK', primary: true, onClick: submit }],
    });
    setTimeout(() => inp.select && inp.select(), 40);
  });
}

/** menu(event|{x,y}, items) – items: {label, icon, onClick, danger, disabled, submenu, sep, head} */
let _menuEl = null;
function closeMenu() { if (_menuEl) { _menuEl.remove(); _menuEl = null; } }
function menu(ev, items, parentRect) {
  if (!parentRect) closeMenu();
  if (ev && ev.preventDefault) { ev.preventDefault(); ev.stopPropagation(); }
  const m = h('.menu');
  for (const it of items.filter(Boolean)) {
    if (it.sep) { m.appendChild(h('.msep')); continue; }
    if (it.head) { m.appendChild(h('.mhead', it.head)); continue; }
    const row = h(`.mi${it.danger ? '.danger' : ''}${it.disabled ? '.disabled' : ''}`,
      it.icon ? icon(it.icon) : h('span', { style: { width: '16px' } }), h('span', it.label),
      it.submenu ? icon('chevron-right', 'arrow') : null);
    if (it.submenu) {
      row.addEventListener('mouseenter', () => {
        $$('.menu.sub', overlayRoot()).forEach(x => x.remove());
        const r = row.getBoundingClientRect();
        const sub = menu({ x: r.right + 2, y: r.top - 5 }, it.submenu, r);
        sub.classList.add('sub');
      });
    } else {
      row.addEventListener('mouseenter', () => $$('.menu.sub', overlayRoot()).forEach(x => x !== m && !m.contains(x) && x.remove()));
      row.addEventListener('click', () => { closeMenu(); $$('.menu.sub').forEach(x => x.remove()); it.onClick && it.onClick(); });
    }
    m.appendChild(row);
  }
  overlayRoot().appendChild(m);
  const x = ev.clientX ?? ev.x, y = ev.clientY ?? ev.y;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  if (!parentRect) _menuEl = m;
  else { const prev = _menuEl; _menuEl = { remove() { m.remove(); prev && prev.remove(); } }; }
  return m;
}
document.addEventListener('mousedown', e => { if (!e.target.closest('.menu')) { closeMenu(); $$('.menu').forEach(x => x.remove()); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); $$('.menu').forEach(x => x.remove()); } });

/* ---------------- shared widgets ---------------- */
function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}
function avatar(c, size = 28) {
  const el = h('.avatar', { title: c ? c.name : '', style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * .38) + 'px' } });
  if (!c) return el;
  if (c.portrait) el.style.backgroundImage = `url("${c.portrait}")`;
  else { el.style.background = c.color || '#e3b341'; el.textContent = initials(c.name); }
  if (c.status === 'dead') el.style.filter = 'grayscale(1) brightness(.7)';
  return el;
}
function avatarStack(ids, size = 24, max = 5) {
  const list = ids.map(id => App.charsById.get(id)).filter(Boolean);
  return h('.avatars', list.slice(0, max).map(c => avatar(c, size)),
    list.length > max ? h('.avatar', { style: { width: size + 'px', height: size + 'px', fontSize: '10px', background: 'var(--surface-3)', color: 'var(--text-2)' } }, '+' + (list.length - max)) : null);
}
function charChip(c, { role, onClick, onRemove } = {}) {
  return h('.char-chip', { onclick: onClick || (() => App.go('characters', { id: c.id })), title: c.summary || c.name },
    avatar(c, 22), h('span', c.name), role ? h('span.role', role) : null,
    onRemove ? h('span.x', { onclick: e => { e.stopPropagation(); onRemove(); } }, icon('x')) : null);
}
/** red "where you left off" bar on a thumbnail */
function resumeBar(m) {
  return m.resume && m.duration ? h('.resume', { title: tr('You stopped at {time}', { time: fmt.clock(m.resume) }) },
    h('i', { style: { width: Math.min(100, m.resume / m.duration * 100) + '%' } })) : null;
}
/** saved position changed: update the cached media and every thumbnail of it on screen */
function applyResume(d) {
  const m = App.mediaById.get(d.media_id);
  if (!m) return;
  const had = !!m.resume;
  m.resume = d.pos || null;
  if (d.pos) m.watched_at = d.at;
  document.querySelectorAll(`[data-rmid="${d.media_id}"]`).forEach(host => {
    const old = host.querySelector(':scope > .resume');
    const bar = resumeBar(m);
    if (old) old.replaceWith(...(bar ? [bar] : []));
    else if (bar) host.insertBefore(bar, host.querySelector(':scope > .pl, :scope > .play, :scope > .more'));
  });
  if (had !== !!m.resume || d.final) App.emit('resume');
}
function mediaTile(m, { onClick, showBadge = true } = {}) {
  const t = h('.mtile' + (m.thumb ? '' : '.noimg'), {
    'data-mid': m.id, 'data-rmid': m.id,
    title: `${m.name}\n${m.game} · ${fmt.dt(m.start)} · ${fmt.dur(m.duration)}`,
    onclick: onClick || (() => API.call('media.play', { id: m.id })),
  },
  m.thumb ? h('img', { src: m.thumb, loading: 'lazy' }) : icon('film'),
  showBadge ? h('span.badge.' + m.type, KIND[m.type]?.label || m.type) : null,
  h('span.dur', fmt.dur(m.duration)),
  resumeBar(m),
  h('.play', icon('play')));
  return t;
}
function emptyState(ic, title, text, action) {
  return h('.empty', icon(ic), h('h3', title), text ? h('div', text) : null, action || null);
}

/** Pick characters. Returns Promise<array of ids | null>. Allows creating new ones. */
function pickCharacters(selected = [], { title = tr('Characters'), multi = true } = {}) {
  return new Promise(resolve => {
    const sel = new Set(selected); let done = false;
    const q = h('input.input', { placeholder: tr('Search or type a new character’s name…'), autofocus: true });
    const list = h('.picker-list');
    const render = () => {
      clear(list);
      const term = q.value.trim().toLowerCase();
      const items = App.chars.filter(c => !term || (c.name + ' ' + c.aliases + ' ' + c.faction).toLowerCase().includes(term));
      for (const c of items) {
        list.appendChild(h('.list-row' + (sel.has(c.id) ? '.sel' : ''), {
          onclick: () => {
            if (!multi) { done = true; resolve([c.id]); m.close(); return; }
            sel.has(c.id) ? sel.delete(c.id) : sel.add(c.id); render();
          },
        }, avatar(c, 30), h('.grow', h('div', c.name), h('.tiny.faint', [CHAR_KIND[c.kind]?.label, c.faction].filter(Boolean).join(' · '))),
        sel.has(c.id) ? icon('check', 'check-mark') : null));
      }
      if (term && !App.chars.some(c => c.name.toLowerCase() === term)) {
        list.appendChild(h('.list-row', {
          onclick: async () => {
            const id = await API.call('char.create', { name: q.value.trim() });
            await App.loadChars();
            if (!multi) { done = true; resolve([id]); m.close(); return; }
            sel.add(id); q.value = ''; render();
          },
        }, h('.avatar', { style: { width: '30px', height: '30px', background: 'var(--accent-soft)', color: 'var(--accent)' } }, icon('plus')),
        h('div', tr('Create character') + ' ', h('b', tr('“{name}”', { name: q.value.trim() })))));
      }
      if (!list.children.length) list.appendChild(h('.faint.small', { style: { padding: '10px' } }, tr('No characters yet – type a name and create the first one.')));
    };
    q.addEventListener('input', render);
    q.addEventListener('keydown', e => { if (e.key === 'Enter' && list.firstChild) list.firstChild.click(); });
    const m = modal({
      title, icon: 'users', body: h('div', q, list),
      onClose: () => { if (!done) resolve(null); },
      actions: multi ? [{ label: tr('Cancel'), onClick: () => { done = true; resolve(null); } },
        { label: tr('Done'), primary: true, onClick: () => { done = true; resolve([...sel]); } }] : [],
    });
    render();
  });
}

/** Pick an event. opts.moment (unix s) ranks matching events first. Returns Promise<{id, note}|null>. */
function pickEvent({ title = tr('Link to event'), moment = null, withNote = true } = {}) {
  return new Promise(async resolve => {
    let done = false, chosen = null;
    const best = moment ? await API.call('events.at', { t: moment }) : [];
    const q = h('input.input', { placeholder: tr('Search events…'), autofocus: true });
    const note = h('input.input', { placeholder: tr('Note for the link (optional)') });
    const list = h('.picker-list');
    const row = (e, depth = 0) => h('.list-row' + (chosen === e.id ? '.sel' : ''), {
      style: { paddingLeft: 10 + depth * 18 + 'px' },
      onclick: () => { chosen = e.id; render(); },
      ondblclick: () => { chosen = e.id; finish(); m.close(); },
    }, h('span.dot', { style: { background: e.color } }), h('.grow.ellipsis', e.title),
    h('.tiny.faint', e.start_time ? fmt.date(e.start_time) : ''));
    const render = () => {
      clear(list);
      const term = q.value.trim().toLowerCase();
      if (!term && best.length) {
        list.appendChild(h('.section-title', { style: { margin: '4px 6px' } }, icon('sparkles'), tr('Matches the time'), h('.line')));
        best.forEach(id => App.eventsById.get(id) && list.appendChild(row(App.eventsById.get(id))));
        list.appendChild(h('.section-title', { style: { margin: '10px 6px 4px' } }, tr('All events'), h('.line')));
      }
      if (term) {
        App.events.filter(e => e.title.toLowerCase().includes(term)).forEach(e => list.appendChild(row(e)));
      } else {
        const walk = (pid, d) => App.childrenOf(pid).forEach(e => { list.appendChild(row(e, d)); walk(e.id, d + 1); });
        walk(null, 0);
      }
      list.appendChild(h('.list-row', {
        onclick: async () => {
          const name = await promptDialog(tr('New event'), tr('Event title'), q.value.trim());
          if (!name) return;
          const id = await API.call('event.create', { title: name, start: moment ? moment - 1800 : null, end: moment ? moment + 1800 : null });
          await App.loadEvents(); chosen = id; q.value = ''; render();
        },
      }, icon('plus'), h('span', tr('New event…'))));
    };
    const finish = () => { done = true; resolve(chosen ? { id: chosen, note: note.value.trim() } : null); };
    q.addEventListener('input', render);
    if (best.length) chosen = best[0];
    const m = modal({
      title, icon: 'link', wide: false,
      body: h('div', moment ? h('.small.muted', { style: { marginBottom: '8px' } }, icon('clock'), ' ' + tr('In-game moment:') + ' ', h('b', fmt.dt(moment))) : null,
        q, list, withNote ? h('div', { style: { marginTop: '10px' } }, note) : null),
      onClose: () => { if (!done) resolve(null); },
      actions: [{ label: tr('Cancel'), onClick: () => { done = true; resolve(null); } },
        { label: tr('Attach'), primary: true, icon: 'link', onClick: () => { if (!chosen) return false; finish(); } }],
    });
    render();
  });
}

/** Read a File/Blob as base64 data URL. */
function readAsDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
async function uploadFiles(ownerType, ownerId, files) {
  const out = [];
  for (const f of files) {
    const data = await readAsDataURL(f);
    out.push(await API.call('att.add_data', { owner_type: ownerType, owner_id: ownerId, name: f.name || 'vlozeny.png', data_b64: data, taken_at: f.lastModified ? f.lastModified / 1000 : null }));
  }
  return out;
}

/** Simple image lightbox over a list of attachments. */
function lightbox(items, index = 0) {
  let i = index;
  const img = h('img', { style: { maxWidth: '92vw', maxHeight: '80vh', borderRadius: '10px', boxShadow: 'var(--shadow)' } });
  const cap = h('.muted.small', { style: { textAlign: 'center', marginTop: '10px' } });
  const srcBtn = h('button.btn', { onclick: () => { API.call('att.play_source', { id: items[i].id }); close(); } });
  const show = () => {
    const a = items[i]; img.src = a.url;
    cap.textContent = [a.caption || a.orig_name, a.taken_at ? fmt.dt(a.taken_at) : ''].filter(Boolean).join(' · ');
    srcBtn.classList.toggle('hidden', !a.media_id);
    srcBtn.replaceChildren(icon('play'), a.media_offset != null ? tr('Play video from {time}', { time: fmt.clock(a.media_offset) }) : tr('Play source video'));
  };
  const back = h('.backdrop', { style: { flexDirection: 'column' }, onclick: e => { if (e.target === back) close(); } },
    h('div', img, cap),
    h('.row', { style: { position: 'fixed', top: '16px', right: '16px' } },
      srcBtn,
      h('button.btn.icon', { title: tr('Open in image viewer'), onclick: () => API.call('att.open', { id: items[i].id }) }, icon('external-link')),
      h('button.btn.icon', { onclick: () => close() }, icon('x'))),
    items.length > 1 ? h('button.btn.icon', { style: { position: 'fixed', left: '16px', top: '50%' }, onclick: () => { i = (i - 1 + items.length) % items.length; show(); } }, icon('chevron-left')) : null,
    items.length > 1 ? h('button.btn.icon', { style: { position: 'fixed', right: '16px', top: '50%' }, onclick: () => { i = (i + 1) % items.length; show(); } }, icon('chevron-right')) : null);
  const onKey = e => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft' && items.length > 1) { i = (i - 1 + items.length) % items.length; show(); }
    if (e.key === 'ArrowRight' && items.length > 1) { i = (i + 1) % items.length; show(); }
    e.stopPropagation();
  };
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  document.addEventListener('keydown', onKey, true);
  overlayRoot().appendChild(back); show();
}
