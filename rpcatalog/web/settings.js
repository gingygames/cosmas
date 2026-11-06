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
  entries: tr('Entry'), letters: tr('Letter'), media: tr('Video'), bookmarks: tr('Moment'), attachments: tr('Image') };
const SYNC_KINDS = { both: tr('changed here and on the web'), deleted_remote: tr('deleted on the web, changed here'), deleted_local: tr('deleted here, changed on the web') };

/* Sign in with Discord: the browser opens the web, the user allows Cosmas and the browser comes back to a one-shot
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
        h('.tiny.faint', tr('Cosmas is waiting for the browser to come back (up to 5 minutes).')),
        h('.row.wrap', h('button.btn.sm', { onclick: () => API.call('auth.open', { which: 'browser' }) }, icon('external-link'), tr('Open the page again')), useCode));
      else if (st.state === 'device') body.append(
        st.user_code ? [
          h('div', tr('Open the page, check that it shows this code and click Allow:')),
          h('div', { style: { font: '700 28px ui-monospace, monospace', letterSpacing: '.12em', textAlign: 'center', padding: '8px', borderRadius: '8px', background: 'var(--input)', userSelect: 'all' } }, st.user_code),
          h('.row.wrap', h('button.btn.primary', { onclick: () => API.call('auth.open', { which: 'device' }) }, icon('external-link'), tr('Open page'))),
          h('.tiny.faint', tr('Cosmas finishes signing in by itself a few seconds after you allow it.')),
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
      if (await confirmDialog(tr('Disconnect this device'), tr('Cosmas forgets the sign-in on this computer and the web revokes it. Your records stay linked – after you sign in again, syncing continues where it left off.'), { okLabel: tr('Disconnect') }))
        run('auth.sign_out');
    };
    clear(box).append(
      st.has_token
        ? h('.row.wrap', { style: { gap: '10px', alignItems: 'center' } }, icon('circle-check'),
          h('.grow', st.user ? h('span', { html: tr('Signed in as {name}', { name: '<b>' + escapeHtml(st.user) + '</b>' }) }) : tr('Signed in')),
          h('button.btn.sm.ghost', { disabled: st.running, onclick: signOut }, icon('log-out'), tr('Sign out / disconnect this device')))
        : h('.col', { style: { gap: '6px' } },
          h('div', h('button.btn.primary', { onclick: async () => { if (await webSignIn()) render(); } }, icon('log-in'), tr('Sign in with Discord'))),
          h('.tiny.faint', tr('Opens your browser – sign in with the community Discord and allow Cosmas. Nothing to copy.'))),
      h('.row.wrap', { style: { gap: '18px' } },
        check('letters', tr('Also send pigeon post (private only)')),
        check('auto', tr('Sync after the app starts'))),
      h('.row.wrap',
        h('button.btn' + (st.has_token ? '.primary' : ''), { disabled: st.running || !st.has_token, onclick: () => run('sync.run') }, icon('refresh-cw'), st.running ? tr('Syncing…') : tr('Sync now'))),
      st.running ? h('.small.muted', st.progress || tr('Syncing…')) : null,
      st.error && !st.need_pairing ? h('.small', { style: { color: 'var(--danger)' } }, st.error) : null,
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


/* ---------------- the page: sections with a side navigation ---------------- */
const SECTIONS = [
  ['general', 'settings-2', tr('General')], ['library', 'folder-open', tr('Library')], ['player', 'play', tr('Video player')],
  ['moments', 'bookmark', tr('Moments & events')], ['ai', 'sparkles', tr('AI')], ['web', 'globe', tr('Web & sync')],
  ['data', 'database', tr('Data & backups')], ['privacy', 'shield', tr('Privacy & diagnostics')],
  ['shortcuts', 'keyboard', tr('Keyboard shortcuts')], ['about', 'info', tr('About')],
];

Views.register('settings', {
  title: tr('settings'), short: tr('Settings'), icon: 'settings', order: 90, bottom: true, members: false,
  async mount(root, params = {}) {
    const s = await API.call('settings.get');
    const info = await API.call('app.info').catch(() => ({}));
    const stop = e => e.stopPropagation();

    /* every control saves at once; folders, splitting and game names reload the library */
    const set = async (key, value, { rescan = false, quiet = false } = {}) => {
      s[key] = value;
      await API.call('settings.set', { values: { [key]: value, _rescan: rescan } }).catch(() => null);
      if (key in App.settings || ['short_session_seconds', 'event_gap_minutes', 'hide_short_sessions'].includes(key)) App.settings[key] = value;
      if (!quiet) toast(rescan ? tr('Saved – reloading the library') : tr('Saved'));
    };
    const tog = (key, label, hint, opts) => h('.col', { style: { gap: '2px' } },
      h('label.check', h('input', { type: 'checkbox', checked: !!s[key], onchange: e => set(key, e.target.checked, opts) }), label),
      hint ? h('.set-hint', hint) : null);
    const num = (key, label, min, max, opts = {}) => h('label.field', label, h('input.input', {
      type: 'number', min, max, value: s[key], style: { width: '110px' }, onkeydown: stop,
      onchange: e => { const v = Math.max(min, Math.min(max, Math.round(+e.target.value || 0))); e.target.value = v; set(key, v, opts); } }));
    const choice = (key, options, opts) => h('.row.wrap', { style: { gap: '6px' } }, options.map(([k, label]) => h('span.chip' + (s[key] === k ? '.on' : ''), {
      onclick: e => { if (s[key] === k) return; set(key, k, opts); e.currentTarget.parentNode.querySelectorAll('.chip').forEach(c => c.classList.remove('on')); e.currentTarget.classList.add('on'); } }, label)));
    const card = (title, desc, ...body) => h('.card', { style: { padding: '18px 20px', marginBottom: '14px' } },
      title ? h('h3', { style: { margin: '0 0 4px', font: '600 15px var(--font-display)' } }, title) : null,
      desc ? h('.small.faint', { style: { marginBottom: '12px' } }, desc) : null, h('.col', { style: { gap: '12px' } }, ...body));
    const sec = (id, ...cards) => {
      const [, ic, label] = SECTIONS.find(x => x[0] === id);
      return h('section.set-sec', { id: 'set-' + id, 'data-sec': id }, h('h2', icon(ic), label), ...cards);
    };

    /* ---- General ---- */
    const updOpts = () => {
      const box = h('.col', { style: { gap: '10px' } });
      const render = st => {
        if (!st) return;
        clear(box).append(
          h('label.check', h('input', { type: 'checkbox', checked: st.auto_check, onchange: e => API.call('update.options', { auto_check: e.target.checked }) }), tr('Check for updates automatically (after the start and every 12 hours)')),
          h('label.check', h('input', { type: 'checkbox', checked: st.auto_download, disabled: st.dev, onchange: e => API.call('update.options', { auto_download: e.target.checked }) }), tr('Download updates in the background (installing always waits for you)')),
          h('.row', { style: { gap: '10px', alignItems: 'center' } }, h('span.small.muted', tr('Channel')),
            ...[['stable', tr('Stable')], ['beta', tr('Beta (early versions)')]].map(([k, label]) => h('span.chip' + (st.channel === k ? '.on' : ''), { onclick: () => API.call('update.options', { channel: k }) }, label))));
      };
      Updates.on(st => box.isConnected && render(st));
      API.call('update.status').then(render).catch(() => null);
      return box;
    };
    const general = sec('general',
      card(tr('Language'), tr('Automatic follows the system language: Czech on a Czech or Slovak system, English otherwise. In Czech the app is called Kosmas, in English Cosmas.'), langPicker(s)),
      card(tr('Appearance'), tr('Changes immediately, no saving needed.'), appearanceSection()),
      card(tr('Start and window'), null,
        tog('start_minimized', tr('Start minimized'), tr('The window starts minimized (or only in the notification area when the option below is on).')),
        tog('close_to_tray', tr('Closing the window keeps the app running in the notification area'), tr('Background work (transcripts, sync, backups) goes on; quit from the icon’s menu. A playing video is paused.'))),
      card(tr('Updates'), tr('New versions are downloaded from gingygames.com / GitHub and checked against their published SHA-256 before installing.'),
        Updates.panel({ notes: true }), updOpts()));

    /* ---- Library ---- */
    const roots = [...(s.roots || [])];
    const rootsBox = h('.col', { style: { gap: '6px' } });
    const saveRoots = () => set('roots', [...roots], { rescan: true });
    const renderRoots = () => {
      clear(rootsBox);
      roots.forEach((r, i) => rootsBox.appendChild(h('.list-row', { style: { background: 'var(--surface)', border: '1px solid var(--border)' } },
        icon('folder'), h('.grow.ellipsis', r),
        h('button.btn.ghost.sm.icon', { title: tr('Remove'), onclick: () => { roots.splice(i, 1); renderRoots(); saveRoots(); } }, icon('x')))));
      rootsBox.appendChild(h('.row', { style: { gap: '8px' } },
        h('button.btn.sm', { onclick: async () => { const p = await API.call('pick_folder'); if (p && !roots.includes(p)) { roots.push(p); renderRoots(); saveRoots(); } } }, icon('folder-plus'), tr('Add folder')),
        h('button.btn.sm.ghost', { onclick: () => { API.call('rescan'); toast(tr('Looking for new recordings…')); } }, icon('refresh-cw'), tr('Reload library'))));
    };
    renderRoots();
    const aliases = h('textarea.input', { rows: 4, onkeydown: stop, placeholder: 'KCDMP = Kingdoms Connected\nKcdMplauncher = Kingdoms Connected',
      onchange: e => { const al = {}; e.target.value.split('\n').forEach(l => { const [a, b] = l.split('='); if (a && b && a.trim() && b.trim()) al[a.trim()] = b.trim(); }); set('game_aliases', al, { rescan: true }); } },
      Object.entries(s.game_aliases || {}).map(([a, b]) => `${a} = ${b}`).join('\n'));
    const library = sec('library',
      card(tr('Recording folders'), tr('Medal folders (they contain Clips/, Databases/, Thumbnails/…), or any folder with OBS / ShadowPlay recordings. I only read the Medal database, I never write to it.'), rootsBox),
      card(tr('Looking for new recordings'), null,
        tog('scan_on_start', tr('Look for new recordings when the app starts')),
        h('.set-row', num('rescan_minutes', tr('…and then every (min, 0 = never)'), 0, 240)),
        h('.small.faint', tr('F5 looks right away. Clip titles, bookmarks and game names come from Medal’s database when the folder has one.'))),
      card(tr('Splitting recordings'), null,
        h('.set-row', num('clip_max_seconds', tr('Clip is at most (s)'), 10, 3600, { rescan: true }), num('short_session_seconds', tr('Hide full recordings shorter than (s)'), 0, 3600)),
        tog('hide_short_sessions', tr('Hide short full recordings in the library'), tr('Accidental few-second recordings stay in the catalogue, just out of the way.'))),
      card(tr('Renaming and merging games'), tr('One line = original name = new name.'), aliases));

    /* ---- Player ---- */
    const mix = new Set((s.default_mix || []).map(r => r.role));
    const mixRow = h('.row.wrap', ROLES.map(([k, label]) => h('span.chip' + (mix.has(k) ? '.on' : ''), {
      onclick: e => { mix.has(k) ? mix.delete(k) : mix.add(k); e.currentTarget.classList.toggle('on'); set('default_mix', [...mix].map(role => ({ role, volume: 100 })), { quiet: true }); } }, label)));
    const player = sec('player',
      card(tr('Audio tracks'), tr('Which tracks are turned on when a video is opened (when the last choice is not remembered).'), mixRow,
        tog('remember_last_mix', tr('Remember the last selected tracks (by type – game, microphone…)'))),
      card(tr('Playback'), null,
        tog('remember_position', tr('Continue videos where you left off')),
        h('.set-row',
          num('player_seek_small', tr('← / → jumps (s)'), 1, 120),
          num('player_seek_large', tr('Shift + ← / → jumps (s)'), 2, 600),
          num('player_volume_max', tr('Volume up to (%)'), 100, 200)),
        h('.small.faint', tr('Volume above 100 % amplifies quiet recordings (it can distort). Frame by frame: , and . while paused. A new volume limit applies to the next opened player.'))),
      card(tr('Video decoding'), null,
        choice('player_hwdec', [['auto', tr('Hardware (GPU) when possible')], ['no', tr('Software only')]]),
        h('.small.faint', tr('Software decoding helps when videos show green blocks or stutter on some graphics drivers. Applies after restarting the app.'))));

    /* ---- Moments & events ---- */
    const moments = sec('moments',
      card(tr('Event suggestions'), tr('Recordings close together in time are offered as one event (Events → Suggest).'),
        h('.set-row', num('event_gap_minutes', tr('New group after a pause of (min)'), 5, 600))),
      card(tr('Chapters from AI'), null,
        tog('ai_chapter_bookmarks', tr('Also show AI chapters as moments (seek bar, Moments)')),
        tog('ai_autolink', tr('Add characters found in a transcript to the video'))));

    /* ---- AI ---- */
    const provLabel = { local: tr('this PC'), ollama: tr('this PC (Ollama)'), openai: 'OpenAI', anthropic: 'Anthropic', openrouter: 'OpenRouter', groq: 'Groq', gemini: 'Google Gemini', deepgram: 'Deepgram' };
    const pv = (p, model) => (provLabel[p] || p || '–') + (model ? ` · ${model}` : '');
    const ai = sec('ai',
      card(tr('What the AI does'), tr('Optional. Speech in your recordings becomes a searchable transcript (and subtitles); in conversations it can also look at the picture (name tags, faces, clothes); Cosmas AI then writes chapters and suggests events, characters, places and factions. Nothing happens until you start it for a video or turn on processing of new ones.'),
        h('.set-kv',
          h('span', tr('Speech')), h('span', pv(s.ai_speech_provider, s.ai_speech_provider === 'local' ? (s.ai_whisper_model || tr('recommended for this PC')) : s.ai_speech_model)),
          h('span', tr('Picture')), h('span', pv(s.ai_vision_provider, s.ai_vision_model || tr('recommended for this PC'))),
          h('span', tr('Text (chapters, suggestions)')), h('span', pv(s.ai_text_provider, s.ai_text_model || tr('recommended for this PC')))),
        h('.row.wrap', { style: { gap: '8px' } },
          h('button.btn.primary', { onclick: () => App.go('transcripts', { tab: 'ai' }) }, icon('cpu'), tr('Where AI runs and which models')),
          h('button.btn', { onclick: () => App.go('transcripts', { tab: 'settings' }) }, icon('sliders-horizontal'), tr('All transcript settings')))),
      card(tr('Behaviour'), null,
        tog('ai_subtitles', tr('Show the transcript as subtitles in the player (V toggles them)')),
        tog('ai_pause_gaming', tr('Pause AI work while you play a game'), tr('So it never costs you frames. It continues when the game closes.')),
        h('.col', { style: { gap: '6px' } }, h('span.small.muted', tr('Priority of AI work on this PC')),
          choice('ai_priority', [['idle', tr('Only when the PC is idle')], ['below', tr('Below normal')], ['normal', tr('Normal')]]))),
      card(tr('Privacy'), tr('With “this PC” everything stays on your computer. With a paid service only what that step needs is sent to the service you chose – the audio for speech, single frames for the picture, transcript text for chapters – never the whole video or your catalogue. API keys are stored encrypted in Windows Credential Manager.')));

    /* ---- Web & sync ---- */
    const testCard = () => {
      const box = h('div');
      const render = async () => {
        const t = await API.call('test.info');
        const n = Object.values(t.counts || {}).reduce((a, b) => a + b, 0);
        clear(box).append(
          h('label.check', h('input', { type: 'checkbox', checked: !!t.show, onchange: async e => {
            await API.call('test.show', { show: e.target.checked }); App.settings.show_test_data = e.target.checked; location.reload();
          } }), tr('Show test data')),
          h('.small.faint', { style: { margin: '8px 0 10px' } }, n ? trn(n, '{n} test record', '{n} test records') : tr('No test records.')),
          h('button.btn.danger', { disabled: !n, onclick: async () => {
            if (!await confirmDialog(tr('Delete test data'), tr('Delete all test records? A backup of the catalogue is made first. Videos stay in the library (still marked as test) – files on disk are never touched.'), { danger: true, okLabel: tr('Delete') })) return;
            const r = await API.call('test.delete');
            toast(tr('Test data deleted. Backup: {path}', { path: r.backup }));
            await App.refresh('media', 'events', 'chars', 'meta'); App.emit('synced'); render();
          } }, icon('trash-2'), tr('Delete test data')));
      };
      render();
      return box;
    };
    const web = sec('web',
      card(tr('Web chronicle'), tr('Sync with gingygames.com/kosmas: characters, events, entries, factions, places, images and videos uploaded to YouTube. Everything on the web is private until you publish it there yourself. Player contacts are never sent.'),
        webSyncCard()),
      card('Discord', tr('Player names and avatars are fetched via your bot on the server. The token stays on this computer only (in the settings file in the data folder).'), discordCard(s)),
      card(tr('Test data'), tr('Records marked as test (menu ⋯ → Mark as test record) are hidden everywhere unless shown here, and they are never synced or published.'), testCard()));

    /* ---- Data & backups ---- */
    const dataBox = h('.col', { style: { gap: '12px' } });
    const when = t => new Date(t * 1000).toLocaleString(I18N.locale);
    const kindLabel = { auto: tr('automatic'), manual: tr('manual'), safety: tr('before a change') };
    const renderData = async (d) => {
      d = d || await API.call('data.info').catch(() => null);
      if (!d) return;
      const list = d.backup_list || [];
      clear(dataBox).append(
        card(tr('Catalogue data'), tr('Edits, journals, characters and attachments are stored in this folder. The videos themselves stay where they are.'),
          h('.list-row', { style: { background: 'var(--input)' } }, icon('folder'), h('.grow.ellipsis', { style: { userSelect: 'all' } }, d.data_dir)),
          h('.set-kv',
            h('span', tr('Catalogue (catalog.db)')), h('span', fmtBytes(d.db)),
            h('span', tr('Attachments')), h('span', fmtBytes(d.attachments)),
            h('span', tr('Video thumbnails')), h('span', fmtBytes(d.thumbs)),
            h('span', tr('Transcripts and AI results')), h('span', fmtBytes(d.analysis)),
            h('span', tr('Backups')), h('span', fmtBytes(d.backups))),
          h('.row.wrap', { style: { gap: '8px' } },
            h('button.btn', { onclick: () => API.call('open_data_dir') }, icon('folder-open'), tr('Open data folder')),
            h('button.btn', { onclick: async () => { const r = await API.call('data.export_json').catch(() => null); if (r) toast(tr('Exported {n} records to {path}', { n: r.rows, path: r.path })); } }, icon('file-json'), tr('Export as JSON…')))),
        card(tr('Automatic backups'), tr('A copy of the catalogue (catalog.db – events, characters, moments, transcripts…) in the backups folder. Attachments and thumbnails are separate files and are not part of it.'),
          tog('backup_auto', tr('Back up the catalogue automatically')),
          h('.set-row', num('backup_every_hours', tr('Every (hours)'), 1, 336), num('backup_keep', tr('Keep the newest (automatic backups)'), 1, 100)),
          h('.row.wrap', { style: { gap: '8px' } },
            h('button.btn.primary', { onclick: async () => { const n = await API.call('backup.now').catch(() => null); if (n) { toast(tr('Backup saved: {name}', { name: n })); renderData(); } } }, icon('database-backup'), tr('Back up now')),
            h('button.btn', { onclick: () => API.call('backup.open') }, icon('folder-open'), tr('Open backups folder'))),
          list.length ? h('.col', { style: { gap: '4px' } }, h('.small.muted', tr('Restore from a backup')),
            ...list.slice(0, 12).map(b => h('.list-row', { style: { background: 'var(--surface)', border: '1px solid var(--border)' } },
              icon('archive-restore'), h('.grow', h('div', when(b.time)), h('.tiny.faint', `${kindLabel[b.kind] || b.kind} · ${fmtBytes(b.size)} · ${b.name}`)),
              h('button.btn.sm', { onclick: async () => {
                if (!await confirmDialog(tr('Restore from backup'), tr('Replace the current catalogue with the backup from {when}? Everything changed since then is lost – the current catalogue is saved as a backup first, so this can be undone. Cosmas restarts.', { when: when(b.time) }), { danger: true, okLabel: tr('Restore and restart') })) return;
                await API.call('backup.restore', { name: b.name }).catch(() => null);
              } }, tr('Restore…'))))) : h('.small.faint', tr('No backups yet.'))),
        card(tr('Cache'), tr('Seek-bar previews and waveforms are made again when a video is played. Downloaded updates are deleted after they are installed.'),
          h('.row.wrap', { style: { gap: '8px' } },
            h('button.btn', { disabled: !d.previews, onclick: async () => renderData(await API.call('cache.clear', { what: 'previews' })) }, icon('trash-2'), tr('Clear previews ({size})', { size: fmtBytes(d.previews) })),
            h('button.btn', { disabled: !d.updates, onclick: async () => renderData(await API.call('cache.clear', { what: 'updates' })) }, icon('trash-2'), tr('Delete downloaded updates ({size})', { size: fmtBytes(d.updates) })))));
    };
    renderData();
    const data = sec('data', dataBox);

    /* ---- Privacy & diagnostics ---- */
    const privacy = sec('privacy',
      card(tr('Privacy'), null, h('.small.muted', { html: [
        tr('Cosmas is local first: your catalogue is a file on this PC and everything works offline.'),
        tr('Nothing is uploaded unless you sign in to the web chronicle and sync, use a paid AI service, or send a report yourself.'),
        tr('Update checks ask gingygames.com (or GitHub) for the newest version number – nothing about you or your catalogue is sent.'),
      ].map(escapeHtml).join('<br>') })),
      card(tr('Reports and logs'), tr('The log helps find bugs. It stays on this PC unless you attach it to a report; tokens, e-mail addresses and your user folder are removed from it first.'),
        tog('crash_prompt', tr('After an unexpected error, offer to send a report')),
        h('.col', { style: { gap: '6px' } }, h('span.small.muted', tr('Log detail')),
          choice('log_level', [['info', tr('Normal')], ['debug', tr('Detailed (for troubleshooting)')]])),
        h('.row.wrap', { style: { gap: '8px' } },
          h('button.btn.primary', { onclick: () => feedbackDialog() }, icon('message-square-warning'), tr('Send feedback / Report a bug…')),
          h('button.btn', { onclick: () => API.call('diag.open_logs') }, icon('folder-open'), tr('Open the log folder')),
          h('button.btn', { onclick: async () => { const r = await API.call('diag.copy').catch(() => null); if (r) toast(tr('Diagnostics copied to the clipboard')); } }, icon('clipboard-copy'), tr('Copy diagnostics')))));

    /* ---- Shortcuts ---- */
    const shortcuts = sec('shortcuts', card(null, null, h('.small.muted', { html: [
      tr('<b>Player:</b> <span class="kbd">Space</span> pause · <span class="kbd">←</span>/<span class="kbd">→</span> 5 s · <span class="kbd">Shift</span>+arrows 30 s · <span class="kbd">F</span> full screen · <span class="kbd">M</span> mute · <span class="kbd">Ctrl+1…9</span> audio tracks · <span class="kbd">B</span> moment · <span class="kbd">Shift+B</span> segment start/end · <span class="kbd">P</span> moment straight into an event · <span class="kbd">C</span> tag characters · <span class="kbd">I</span>/<span class="kbd">O</span> clip start/end · <span class="kbd">S</span> screenshot (to event / crop / character portrait)'),
      tr('<b>Frame by frame:</b> <span class="kbd">,</span> back · <span class="kbd">.</span> forward (the jump of the arrows is set in Player)'),
      tr('<b>Library:</b> <span class="kbd">Enter</span> play · <span class="kbd">Delete</span> move to Trash · <span class="kbd">Ctrl+A</span> select all · <span class="kbd">Ctrl+F</span> search · dragging videos onto an event/album attaches them'),
      tr('<b>Editor:</b> <span class="kbd">@</span> tag a character · <span class="kbd">Ctrl+V</span> paste a screenshot · <span class="kbd">Ctrl+B/I/U</span>'),
    ].join('<br><br>') })));

    /* ---- About ---- */
    const link = (href, label, ic = 'external-link') => h('a.btn.sm.ghost', { href }, icon(ic), label);
    const about = sec('about',
      card(null, null,
        h('.row', { style: { gap: '14px', alignItems: 'center' } }, h('img', { src: 'icon.svg', style: { width: '48px', height: '48px' } }),
          h('div', h('div', { style: { font: '600 20px var(--font-display)' } }, tr('Cosmas')), h('.small.muted', tr('Version {version}', { version: info.version || '' }) + (info.dev ? ' · ' + tr('source checkout') : '')),
            h('.tiny.faint', tr('Named after Cosmas of Prague, the first Czech chronicler.')))),
        Updates.panel({ notes: false }),
        h('.row.wrap', { style: { gap: '6px' } },
          link(info.site || 'https://cosmas.gingygames.com', tr('Website'), 'globe'), link(info.web || 'https://gingygames.com/kosmas/', tr('Web chronicle')),
          link(info.repo || 'https://github.com/gingygames/cosmas', 'GitHub'), link(info.issues || 'https://github.com/gingygames/cosmas/issues', tr('Issues and ideas')),
          h('button.btn.sm.ghost', { onclick: () => feedbackDialog() }, icon('message-square-warning'), tr('Send feedback'))),
        h('.small.faint', tr('Licence: no licence is granted for the code yet. Bundled components keep their own licences: libmpv (mpv, LGPL/GPL), FFmpeg (GPL build), Qt / PySide6 (LGPL), Lucide icons (ISC).'))));

    const sections = [general, library, player, moments, ai, web, data, privacy, shortcuts, about];
    const nav = h('nav.set-nav', SECTIONS.map(([id, ic, label]) => h('a', { 'data-sec': id, onclick: () => $('#set-' + id).scrollIntoView({ behavior: 'smooth', block: 'start' }) }, icon(ic), label)));
    const scroller = h('.scroll', { style: { flex: 1 } },
      h('.page-head', h('h1', tr('Settings')), h('.grow'), h('.small.faint', tr('Changes are saved right away.'))),
      h('.set-wrap', nav, h('.set-main', sections)));
    root.appendChild(scroller);
    const mark = id => nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.sec === id));
    const io = new IntersectionObserver(es => {
      const vis = es.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) mark(vis.target.dataset.sec);
    }, { root: scroller, rootMargin: '0px 0px -70% 0px' });
    sections.forEach(x => io.observe(x));
    this._io = io;
    mark(params.section || 'general');
    if (params.section) setTimeout(() => { const el = $('#set-' + params.section); el && el.scrollIntoView({ block: 'start' }); }, 60);
  },
  unmount() { if (this._io) this._io.disconnect(); },
});
})();
