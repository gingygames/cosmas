/* ============================================================
   Settings
   ============================================================ */
'use strict';

(() => {
const ROLES = [['all', tr('All (mix)')], ['game', tr('Game')], ['mic', tr('Microphone')], ['discord', 'Discord'], ['system', tr('System')]];

function discordCard(s) {
  const inp = (key, ph, type = 'text') => h('input.input', { type, value: s[key] || '', placeholder: ph, onkeydown: e => e.stopPropagation(),
    onchange: e => { s[key] = e.target.value.trim(); App.settings[key] = s[key]; API.call('settings.set', { values: { [key]: s[key], _rescan: false } }); } });
  const out = h('.small.muted');
  return h('.col', { style: { gap: '10px' } },
    h('.row.wrap', { style: { gap: '14px' } },
      h('label.field', { style: { flex: '1 1 300px' } }, tr('Bot token'), inp('discord_token', tr('from the Discord Developer Portal → Bot → Token'), 'password')),
      h('label.field', tr('Server ID (optional)'), inp('discord_guild', tr('right-click the server → Copy ID'))),
      h('label.field', tr('Letters channel ID'), inp('discord_channel', tr('optional'))),
      h('label.field', tr('Word for letters'), inp('holub_marker', 'holub'))),
    h('.row',
      h('button.btn', { disabled: !s.discord_guild, title: s.discord_guild ? '' : tr('Fill in the server ID'), onclick: async () => {
        out.textContent = tr('Loading server members…');
        const ms = await API.call('discord.members').catch(() => null);
        if (!ms) { out.textContent = ''; return; }
        out.textContent = trn(ms.length, 'There is {n} person on the server.', 'There are {n} people on the server.');
        importMembers(ms);
      } }, icon('users'), tr('Load members and create players')),
      h('button.btn', { onclick: async () => { const n = await API.call('discord.sync').catch(() => null); if (n != null) toast(trn(n, 'Updated {n} player', 'Updated {n} players')); } }, icon('refresh-cw'), tr('Update names and avatars'))),
    out,
    h('.faint.small', tr('Without a server: the bot does not have to be invited anywhere – for a player, “Link by ID” is enough (you can find the Discord ID after enabling Settings → Advanced → Developer Mode, right-click the user → Copy ID). The server ID is only needed to load all members at once and for server nicknames.')),
    h('.faint.small', tr('How to set up the bot: discord.com/developers → New Application → Bot → copy the token and enable “Server Members Intent” (and “Message Content Intent” for letters) → OAuth2 → URL Generator → scope “bot” → invite the bot to your server.')));
}

const SYNC_TYPES = { servers: tr('Server'), players: tr('Player'), factions: tr('Faction'), characters: tr('Character'), places: tr('Place'), events: tr('Event'),
  entries: tr('Entry'), letters: tr('Letter'), media: tr('Video'), bookmarks: tr('Bookmark'), attachments: tr('Image') };
const SYNC_KINDS = { both: tr('changed here and on the web'), deleted_remote: tr('deleted on the web, changed here'), deleted_local: tr('deleted here, changed on the web') };

/* Sign in with Discord: the browser opens the web, the user allows Kosmas and the browser comes back to a one-shot
   local address (loopback + PKCE). When that can't work, a short code is shown instead. Resolves true once signed in. */
function webSignIn() {
  return new Promise(resolve => {
    let done = false, st = null;
    const body = h('.col', { style: { gap: '12px', minWidth: 'min(400px, 100%)' } });
    const finish = ok => { if (done) return; done = true; m.close(); resolve(ok); };
    const start = mode => API.call('auth.start', { mode }).then(s => { st = s; render(); }).catch(() => null);
    const render = () => {
      if (done || !st) return;
      if (st.state === 'done') { finish(true); return; }
      const useCode = h('button.btn.sm.ghost', { onclick: () => start('device') }, icon('hash'), tr('Use a code instead'));
      clear(body);
      if (st.state === 'browser') body.append(
        h('.row', { style: { gap: '10px', alignItems: 'center' } }, icon('loader'), h('div', tr('Finish signing in in your browser: sign in with Discord and click Allow.'))),
        h('.tiny.faint', tr('Kosmas is waiting for the browser to come back (up to 5 minutes).')),
        h('.row.wrap', h('button.btn.sm', { onclick: () => API.call('auth.open', { which: 'browser' }) }, icon('external-link'), tr('Open the page again')), useCode));
      else if (st.state === 'device') body.append(
        st.user_code ? [
          h('div', tr('Open the page, check that it shows this code and click Allow:')),
          h('div', { style: { font: '700 28px ui-monospace, monospace', letterSpacing: '.12em', textAlign: 'center', padding: '8px', borderRadius: '8px', background: 'var(--input)', userSelect: 'all' } }, st.user_code),
          h('.row.wrap', h('button.btn.primary', { onclick: () => API.call('auth.open', { which: 'device' }) }, icon('external-link'), tr('Open page'))),
          h('.tiny.faint', tr('Kosmas finishes signing in by itself a few seconds after you allow it.')),
        ] : h('.row', { style: { gap: '10px' } }, icon('loader'), tr('Getting a code…')));
      else if (st.state === 'error') body.append(
        h('.small', { style: { color: 'var(--danger)' } }, st.error || tr('Sign-in failed.')),
        h('.row.wrap', h('button.btn.sm.primary', { onclick: () => start('browser') }, icon('log-in'), tr('Try again')), useCode));
      else finish(false);
    };
    API.on('web-auth', s => { st = s; render(); });
    const m = modal({ title: tr('Sign in with Discord'), icon: 'log-in', body, onClose: () => { if (!done) { done = true; API.call('auth.cancel').catch(() => null); resolve(false); } } });
    start('browser');
  });
}
window.webSignIn = webSignIn;

function webSyncCard() {
  const box = h('.col', { style: { gap: '12px' } });
  let timer = null, advOpen = false;
  const when = t => t ? new Date(t * 1000).toLocaleString(I18N.locale) : tr('never yet');
  const poll = () => { clearTimeout(timer); timer = setTimeout(() => box.isConnected && render(), 700); };
  const run = async (method, args) => { await API.call(method, args).catch(() => null); render(); };
  async function render() {
    const st = await API.call('sync.status').catch(() => null);
    if (!st) return;
    const stop = e => e.stopPropagation();
    const token = h('input.input', { type: 'password', placeholder: st.has_token ? tr('saved: {token} (paste a new one to change it)', { token: st.token }) : 'krt_…', onkeydown: stop, autocomplete: 'off',
      onchange: async e => { const v = e.target.value.trim(); if (!v) return; await API.call('sync.set_token', { token: v }).then(() => toast(tr('Token saved'))).catch(() => null); render(); } });
    const url = h('input.input', { value: st.url, onkeydown: stop, onchange: e => run('sync.settings', { url: e.target.value.trim() }) });
    const check = (key, label) => h('label.check', h('input', { type: 'checkbox', checked: !!st[key], onchange: e => run('sync.settings', { [key]: e.target.checked }) }), label);
    const r = st.last_result || {};
    const stats = st.last_sync ? [tr('sent {n}', { n: r.sent || 0 }), tr('images uploaded {n}', { n: r.uploaded || 0 }), tr('deleted on the web {n}', { n: r.deleted_remote || 0 }),
      tr('received {n}', { n: r.received || 0 }), tr('new from the web {n}', { n: r.created_local || 0 }), tr('deleted here {n}', { n: r.deleted_local || 0 })].join(' · ') : '';
    const signOut = async () => {
      if (await confirmDialog(tr('Disconnect this device'), tr('Kosmas forgets the sign-in on this computer and the web revokes it. Your records stay linked – after you sign in again, syncing continues where it left off.'), { okLabel: tr('Disconnect') }))
        run('auth.sign_out');
    };
    clear(box).append(
      st.has_token
        ? h('.row.wrap', { style: { gap: '10px', alignItems: 'center' } }, icon('circle-check'),
          h('.grow', st.user ? h('span', { html: tr('Signed in as {name}', { name: '<b>' + escapeHtml(st.user) + '</b>' }) }) : tr('Signed in')),
          h('button.btn.sm.ghost', { disabled: st.running, onclick: signOut }, icon('log-out'), tr('Sign out / disconnect this device')))
        : h('.col', { style: { gap: '6px' } },
          h('div', h('button.btn.primary', { onclick: async () => { if (await webSignIn()) render(); } }, icon('log-in'), tr('Sign in with Discord'))),
          h('.tiny.faint', tr('Opens your browser – sign in with the community Discord and allow Kosmas. Nothing to copy.'))),
      h('.row.wrap', { style: { gap: '18px' } },
        check('letters', tr('Also send pigeon post (private only)')),
        check('auto', tr('Sync after the app starts'))),
      h('.row.wrap',
        h('button.btn' + (st.has_token ? '.primary' : ''), { disabled: st.running || !st.has_token, onclick: () => run('sync.run') }, icon('refresh-cw'), st.running ? tr('Syncing…') : tr('Sync now'))),
      st.running ? h('.small.muted', st.progress || tr('Syncing…')) : null,
      st.error ? h('.small', { style: { color: 'var(--danger)' } }, st.error) : null,
      st.need_pairing ? h('.col', { style: { gap: '8px', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '10px', background: 'var(--surface)' } },
        h('.small', tr('This database has not been synced with the web yet. The web already has records from a desktop – from another or a restored database, or from an import on the web.')),
        h('.tiny.faint', tr('Pair by id: identical records get linked; where the content differs, a conflict to resolve is created. New copy: this database is uploaded next to the existing records (nothing is overwritten, content may end up duplicated).')),
        h('.row.wrap',
          h('button.btn.sm.primary', { onclick: () => run('sync.run', { pairing: 'match' }) }, tr('Pair by id')),
          h('button.btn.sm', { onclick: () => run('sync.run', { pairing: 'copy' }) }, tr('Upload as a new copy')),
          h('button.btn.sm.ghost', { onclick: () => run('sync.cancel') }, tr('Cancel')))) : null,
      h('.small.muted', tr('Last sync: {when}', { when: when(st.last_sync) }) + (st.account ? ' · ' + tr('account {account}', { account: st.account }) : '') + (st.published ? ' · ' + trn(st.published, '{n} record on the web', '{n} records on the web') : '')),
      stats ? h('.small.faint', stats) : null,
      ...(r.warnings || []).map(w => h('.small', { style: { color: 'var(--danger)' } }, w)),
      st.conflicts.length ? h('.col', { style: { gap: '6px' } },
        h('.small', { style: { color: 'var(--danger)' } }, tr('Conflicts ({n}) – the record changed both here and on the web, I did not overwrite anything:', { n: st.conflicts.length })),
        ...st.conflicts.map(c => h('.list-row', { style: { background: 'var(--surface)', border: '1px solid var(--border)' } },
          h('.grow', h('div.ellipsis', `${SYNC_TYPES[c.local_type] || c.local_type}: ${c.title || '#' + c.local_id}`),
            h('.tiny.faint', SYNC_KINDS[c.kind] || c.kind)),
          h('button.btn.sm', { disabled: st.running, onclick: () => run('sync.resolve', { items: [{ local_type: c.local_type, local_id: c.local_id, choice: 'mine' }] }) }, tr('Keep mine (desktop)')),
          h('button.btn.sm.ghost', { disabled: st.running, onclick: () => run('sync.resolve', { items: [{ local_type: c.local_type, local_id: c.local_id, choice: 'web' }] }) }, tr('Take from the web')))),
        st.conflicts.length > 1 ? h('.row',
          h('button.btn.sm', { disabled: st.running, onclick: () => run('sync.resolve', { items: st.conflicts.map(c => ({ local_type: c.local_type, local_id: c.local_id, choice: 'mine' })) }) }, tr('Keep mine everywhere')),
          h('button.btn.sm.ghost', { disabled: st.running, onclick: () => run('sync.resolve', { items: st.conflicts.map(c => ({ local_type: c.local_type, local_id: c.local_id, choice: 'web' })) }) }, tr('Take from the web everywhere'))) : null) : null);
    box.append(h('details', { open: advOpen, ontoggle: e => { advOpen = e.target.open; } },
      h('summary.small.muted', { style: { cursor: 'pointer' } }, tr('Advanced')),
      h('.col', { style: { gap: '10px', marginTop: '10px' } },
        h('.row.wrap', { style: { gap: '14px' } },
          h('label.field', { style: { flex: '1 1 220px' } }, tr('Server address'), url),
          h('label.field', { style: { flex: '1 1 300px' } }, tr('Paste a personal API token instead'), token)),
        h('.row.wrap',
          h('a.btn.sm.ghost', { href: st.token_url, title: tr('Opens the website in the browser – Settings → Sync → New token') }, icon('key-round'), tr('Get token')),
          st.has_token ? h('button.btn.sm.ghost', { disabled: st.running, onclick: () => run('sync.set_token', { token: '' }) }, icon('x'), tr('Forget the token without revoking it')) : null))));
    if (st.running) poll();
  }
  API.on('web-sync', () => box.isConnected && render());
  API.on('web-auth', s => { if (box.isConnected && (s.state === 'done' || s.state === 'idle')) render(); });
  render();
  return box;
}

function importMembers(ms) {
  const have = new Set((App.players || []).map(p => p.discord_id).filter(Boolean));
  const sel = new Set();
  const box = h('.picker-list', ms.map(m => {
    const linked = have.has(m.id);
    const row = h('.list-row' + (linked ? '.faint' : ''), { onclick: () => { if (linked) return; sel.has(m.id) ? sel.delete(m.id) : sel.add(m.id); row.classList.toggle('sel'); } },
      h('img', { src: m.avatar, style: { width: '30px', height: '30px', borderRadius: '50%' } }), h('.grow', h('div', m.display), h('.tiny.faint', '@' + m.username)),
      linked ? h('span.tiny', tr('already a player')) : null);
    return row;
  }));
  modal({ title: tr('Create players from Discord'), icon: 'users', body: h('div', h('.small.muted', tr('Click the people you want in the player database (their name and avatar are downloaded too).')), box),
    actions: [{ label: tr('Cancel') }, { label: tr('Create selected'), primary: true, onClick: async () => {
      const n = await API.call('discord.import_players', { members: ms.filter(m => sel.has(m.id)) });
      App.players = await API.call('players.list'); toast(trn(n, 'Added {n} player', 'Added {n} players'));
    } }] });
}

/* UI language: auto (system language – Czech/Slovak → Czech, otherwise English) | en | cs. The page reloads in the new language. */
function langPicker(s) {
  const cur = s.lang || 'auto';
  const opts = [['auto', tr('Automatic (system language)')], ['en', 'English'], ['cs', 'Čeština']];
  return h('.row.wrap', { style: { gap: '8px' } }, opts.map(([k, label]) => h('span.chip' + (cur === k ? '.on' : ''), {
    onclick: async () => { if (k !== cur) await API.call('lang.set', { lang: k }).catch(() => null); } }, label)));
}

Views.register('settings', {
  title: tr('settings'), short: tr('Settings'), icon: 'settings', order: 90, bottom: true, members: false,
  async mount(root) {
    const s = await API.call('settings.get');
    const roots = [...(s.roots || [])];
    const rootsBox = h('.col', { style: { gap: '6px' } });
    const renderRoots = () => {
      clear(rootsBox);
      roots.forEach((r, i) => rootsBox.appendChild(h('.list-row', { style: { background: 'var(--surface)', border: '1px solid var(--border)' } },
        icon('folder'), h('.grow.ellipsis', r),
        h('button.btn.ghost.sm.icon', { title: tr('Remove'), onclick: () => { roots.splice(i, 1); renderRoots(); } }, icon('x')))));
      rootsBox.appendChild(h('button.btn.sm', { style: { alignSelf: 'flex-start' }, onclick: async () => {
        const p = await API.call('pick_folder'); if (p && !roots.includes(p)) { roots.push(p); renderRoots(); }
      } }, icon('folder-plus'), tr('Add folder')));
    };
    renderRoots();
    const num = (v, min, max) => h('input.input', { type: 'number', min, max, value: v, style: { width: '110px' } });
    const clipMax = num(s.clip_max_seconds, 10, 3600);
    const shortS = num(s.short_session_seconds, 0, 3600);
    const gap = num(s.event_gap_minutes, 5, 600);
    const remember = h('input', { type: 'checkbox', checked: s.remember_last_mix !== false });
    const mix = new Set((s.default_mix || []).map(r => r.role));
    const mixRow = h('.row.wrap', ROLES.map(([k, label]) => h('span.chip' + (mix.has(k) ? '.on' : ''), {
      onclick: e => { mix.has(k) ? mix.delete(k) : mix.add(k); e.currentTarget.classList.toggle('on'); } }, label)));
    const aliases = h('textarea.input', { rows: 4, placeholder: 'KCDMP = Kingdoms Connected\nKcdMplauncher = Kingdoms Connected' },
      Object.entries(s.game_aliases || {}).map(([a, b]) => `${a} = ${b}`).join('\n'));
    const card = (title, desc, ...body) => h('.card', { style: { padding: '18px 20px', marginBottom: '14px' } },
      h('h3', { style: { margin: '0 0 4px', font: '600 15px var(--font-display)' } }, title), desc ? h('.small.faint', { style: { marginBottom: '12px' } }, desc) : null, ...body);
    const save = async () => {
      const al = {};
      aliases.value.split('\n').forEach(l => { const [a, b] = l.split('='); if (a && b && a.trim() && b.trim()) al[a.trim()] = b.trim(); });
      await API.call('settings.set', { values: {
        roots, clip_max_seconds: +clipMax.value, short_session_seconds: +shortS.value, event_gap_minutes: +gap.value,
        remember_last_mix: remember.checked, default_mix: [...mix].map(role => ({ role, volume: 100 })), game_aliases: al,
      } });
      App.settings.short_session_seconds = +shortS.value; App.settings.event_gap_minutes = +gap.value;
      toast(tr('Saved – reloading the library'));
    };
    root.appendChild(h('.scroll', { style: { flex: 1 } },
      h('.page-head', h('h1', tr('Settings')), h('.grow'), h('button.btn.primary', { onclick: save }, icon('save'), tr('Save'))),
      h('div', { style: { padding: '0 24px 40px', maxWidth: '820px' } },
        card(tr('Language'), tr('Automatic follows the system language: Czech on a Czech or Slovak system, English otherwise.'), langPicker(s)),
        card(tr('Appearance'), tr('Changes immediately, no saving needed.'), appearanceSection()),
        card('Discord', tr('Player names and avatars are fetched via your bot on the server. The token stays on this computer only (data/settings.json).'),
          discordCard(s)),
        card(tr('Web chronicle'), tr('Sync with gingygames.com/kosmas: characters, events, entries, factions, places, images and videos uploaded to YouTube. Everything on the web is private until you publish it there yourself. Player contacts are never sent.'),
          webSyncCard()),
        card(tr('Recording folders'), tr('Medal folders (they contain Clips/, Databases/, Thumbnails/…). I only read the Medal database, I never write to it.'), rootsBox),
        card(tr('Splitting recordings'), null,
          h('.row', { style: { gap: '30px' } },
            h('label.field', tr('Clip is at most (s)'), clipMax),
            h('label.field', tr('Hide full recordings shorter than (s)'), shortS),
            h('label.field', tr('Event suggestions: new group after a pause of (min)'), gap))),
        card(tr('Audio tracks'), tr('Which tracks are turned on when a video is opened (when the last choice is not remembered).'), mixRow,
          h('label.check', { style: { marginTop: '12px' } }, remember, tr('Remember the last selected tracks (by type – game, microphone…)'))),
        card(tr('Renaming and merging games'), tr('One line = original name = new name.'), aliases),
        card(tr('Catalog data'), tr('Edits, journals, characters and attachments are in the data/ folder next to the app. Back it up.'),
          h('.row', h('button.btn', { onclick: () => API.call('open_data_dir') }, icon('folder-open'), tr('Open data folder')),
            h('button.btn', { onclick: () => { API.call('rescan'); toast(tr('Looking for new recordings…')); } }, icon('refresh-cw'), tr('Reload library')))),
        card(tr('Keyboard shortcuts'), null, h('.small.muted', { html: [
          tr('<b>Player:</b> <span class="kbd">Space</span> pause · <span class="kbd">←</span>/<span class="kbd">→</span> 5 s · <span class="kbd">Shift</span>+arrows 30 s · <span class="kbd">F</span> full screen · <span class="kbd">M</span> mute · <span class="kbd">Ctrl+1…9</span> audio tracks · <span class="kbd">B</span> bookmark · <span class="kbd">Shift+B</span> segment start/end · <span class="kbd">P</span> bookmark straight into an event · <span class="kbd">S</span> screenshot (to event / crop / character portrait)'),
          tr('<b>Library:</b> <span class="kbd">Enter</span> play · <span class="kbd">Delete</span> move to Trash · <span class="kbd">Ctrl+A</span> select all · <span class="kbd">Ctrl+F</span> search · dragging videos onto an event/album attaches them'),
          tr('<b>Editor:</b> <span class="kbd">@</span> tag a character · <span class="kbd">Ctrl+V</span> paste a screenshot · <span class="kbd">Ctrl+B/I/U</span>'),
        ].join('<br><br>') })))));
  },
});
})();
