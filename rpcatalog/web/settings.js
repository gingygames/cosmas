/* ============================================================
   Settings
   ============================================================ */
'use strict';

(() => {
const ROLES = [['all', 'Vše (mix)'], ['game', 'Hra'], ['mic', 'Mikrofon'], ['discord', 'Discord'], ['system', 'Systém']];

function discordCard(s) {
  const inp = (key, ph, type = 'text') => h('input.input', { type, value: s[key] || '', placeholder: ph, onkeydown: e => e.stopPropagation(),
    onchange: e => { s[key] = e.target.value.trim(); App.settings[key] = s[key]; API.call('settings.set', { values: { [key]: s[key], _rescan: false } }); } });
  const out = h('.small.muted');
  return h('.col', { style: { gap: '10px' } },
    h('.row.wrap', { style: { gap: '14px' } },
      h('label.field', { style: { flex: '1 1 300px' } }, 'Token bota', inp('discord_token', 'z Discord Developer Portalu → Bot → Token', 'password')),
      h('label.field', 'ID serveru (nepovinné)', inp('discord_guild', 'pravý klik na server → Kopírovat ID')),
      h('label.field', 'ID kanálu s dopisy', inp('discord_channel', 'nepovinné')),
      h('label.field', 'Slovo pro dopisy', inp('holub_marker', 'holub'))),
    h('.row',
      h('button.btn', { disabled: !s.discord_guild, title: s.discord_guild ? '' : 'Vyplň ID serveru', onclick: async () => {
        out.textContent = 'Načítám členy serveru…';
        const ms = await API.call('discord.members').catch(() => null);
        if (!ms) { out.textContent = ''; return; }
        out.textContent = `Na serveru je ${ms.length} lidí.`;
        importMembers(ms);
      } }, icon('users'), 'Načíst členy a vytvořit hráče'),
      h('button.btn', { onclick: async () => { const n = await API.call('discord.sync').catch(() => null); if (n != null) toast(`Aktualizováno ${n} hráčů`); } }, icon('refresh-cw'), 'Aktualizovat jména a avatary')),
    out,
    h('.faint.small', 'Bez serveru: bot nemusí být nikde pozvaný – u hráče stačí „Propojit podle ID“ (Discord ID zjistíš po zapnutí Nastavení → Pokročilé → Režim vývojáře, pravý klik na uživatele → Kopírovat ID). ID serveru je potřeba jen pro načtení všech členů najednou a pro přezdívky na serveru.'),
    h('.faint.small', 'Jak na bota: discord.com/developers → New Application → Bot → zkopíruj token a zapni „Server Members Intent“ (a „Message Content Intent“ pro dopisy) → OAuth2 → URL Generator → scope „bot“ → pozvi bota na svůj server.'));
}

const SYNC_TYPES = { servers: 'Server', players: 'Hráč', factions: 'Frakce', characters: 'Postava', places: 'Místo', events: 'Událost',
  entries: 'Zápis', letters: 'Dopis', media: 'Video', bookmarks: 'Záložka', attachments: 'Obrázek' };
const SYNC_KINDS = { both: 'změněno tady i na webu', deleted_remote: 'na webu smazáno, tady změněno', deleted_local: 'tady smazáno, na webu změněno' };

function webSyncCard() {
  const box = h('.col', { style: { gap: '12px' } });
  let timer = null;
  const when = t => t ? new Date(t * 1000).toLocaleString('cs-CZ') : 'zatím nikdy';
  const poll = () => { clearTimeout(timer); timer = setTimeout(() => box.isConnected && render(), 700); };
  const run = async (method, args) => { await API.call(method, args).catch(() => null); render(); };
  async function render() {
    const st = await API.call('sync.status').catch(() => null);
    if (!st) return;
    const stop = e => e.stopPropagation();
    const token = h('input.input', { type: 'password', placeholder: st.has_token ? `uložený: ${st.token} (vlož nový pro změnu)` : 'krt_…', onkeydown: stop,
      onchange: async e => { const v = e.target.value.trim(); if (!v) return; await API.call('sync.set_token', { token: v }).then(() => toast('Token uložen')).catch(() => null); render(); } });
    const url = h('input.input', { value: st.url, onkeydown: stop, onchange: e => run('sync.settings', { url: e.target.value.trim() }) });
    const check = (key, label) => h('label.check', h('input', { type: 'checkbox', checked: !!st[key], onchange: e => run('sync.settings', { [key]: e.target.checked }) }), label);
    const r = st.last_result || {};
    const stats = st.last_sync ? [`odesláno ${r.sent || 0}`, `nahráno obrázků ${r.uploaded || 0}`, `smazáno na webu ${r.deleted_remote || 0}`,
      `přijato ${r.received || 0}`, `nově z webu ${r.created_local || 0}`, `smazáno tady ${r.deleted_local || 0}`].join(' · ') : '';
    clear(box).append(
      h('.row.wrap', { style: { gap: '14px' } },
        h('label.field', { style: { flex: '1 1 300px' } }, 'Osobní API token', token),
        h('label.field', { style: { flex: '1 1 220px' } }, 'Adresa serveru', url)),
      h('.row.wrap', { style: { gap: '18px' } },
        check('letters', 'Posílat i holubí poštu (jen soukromě)'),
        check('auto', 'Synchronizovat po startu aplikace')),
      h('.row.wrap',
        h('button.btn.primary', { disabled: st.running || !st.has_token, onclick: () => run('sync.run') }, icon('refresh-cw'), st.running ? 'Synchronizuji…' : 'Synchronizovat teď'),
        h('a.btn.ghost', { href: st.token_url, title: 'Otevře web v prohlížeči – Nastavení → Synchronizace → Nový token' }, icon('key-round'), 'Získat token'),
        st.has_token ? h('button.btn.ghost', { disabled: st.running, onclick: () => run('sync.set_token', { token: '' }) }, icon('x'), 'Odebrat token') : null),
      st.running ? h('.small.muted', st.progress || 'Synchronizuji…') : null,
      st.error ? h('.small', { style: { color: 'var(--danger)' } }, st.error) : null,
      st.need_pairing ? h('.col', { style: { gap: '8px', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '10px', background: 'var(--surface)' } },
        h('.small', 'Tato databáze se s webem ještě nesynchronizovala. Na webu už jsou záznamy z desktopu – z jiné či obnovené databáze nebo z importu na webu.'),
        h('.tiny.faint', 'Spárovat podle id: stejné záznamy se propojí, kde se obsah liší, vznikne konflikt k vyřešení. Nová kopie: tahle databáze se nahraje vedle stávajících záznamů (nic se nepřepíše, může vzniknout dvojí obsah).'),
        h('.row.wrap',
          h('button.btn.sm.primary', { onclick: () => run('sync.run', { pairing: 'match' }) }, 'Spárovat podle id'),
          h('button.btn.sm', { onclick: () => run('sync.run', { pairing: 'copy' }) }, 'Nahrát jako novou kopii'),
          h('button.btn.sm.ghost', { onclick: () => run('sync.cancel') }, 'Zrušit'))) : null,
      h('.small.muted', `Poslední synchronizace: ${when(st.last_sync)}${st.account ? ' · účet ' + st.account : ''}${st.published ? ` · na webu ${st.published} záznamů` : ''}`),
      stats ? h('.small.faint', stats) : null,
      ...(r.warnings || []).map(w => h('.small', { style: { color: 'var(--danger)' } }, w)),
      st.conflicts.length ? h('.col', { style: { gap: '6px' } },
        h('.small', { style: { color: 'var(--danger)' } }, `Konflikty (${st.conflicts.length}) – záznam se změnil tady i na webu, nic jsem nepřepsal:`),
        ...st.conflicts.map(c => h('.list-row', { style: { background: 'var(--surface)', border: '1px solid var(--border)' } },
          h('.grow', h('div.ellipsis', `${SYNC_TYPES[c.local_type] || c.local_type}: ${c.title || '#' + c.local_id}`),
            h('.tiny.faint', SYNC_KINDS[c.kind] || c.kind)),
          h('button.btn.sm', { disabled: st.running, onclick: () => run('sync.resolve', { items: [{ local_type: c.local_type, local_id: c.local_id, choice: 'mine' }] }) }, 'Ponechat můj (desktop)'),
          h('button.btn.sm.ghost', { disabled: st.running, onclick: () => run('sync.resolve', { items: [{ local_type: c.local_type, local_id: c.local_id, choice: 'web' }] }) }, 'Vzít z webu'))),
        st.conflicts.length > 1 ? h('.row',
          h('button.btn.sm', { disabled: st.running, onclick: () => run('sync.resolve', { items: st.conflicts.map(c => ({ local_type: c.local_type, local_id: c.local_id, choice: 'mine' })) }) }, 'Všude ponechat můj'),
          h('button.btn.sm.ghost', { disabled: st.running, onclick: () => run('sync.resolve', { items: st.conflicts.map(c => ({ local_type: c.local_type, local_id: c.local_id, choice: 'web' })) }) }, 'Všude vzít z webu')) : null) : null);
    if (st.running) poll();
  }
  API.on('web-sync', () => box.isConnected && render());
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
      linked ? h('span.tiny', 'už je hráč') : null);
    return row;
  }));
  modal({ title: 'Vytvořit hráče z Discordu', icon: 'users', body: h('div', h('.small.muted', 'Klikni na lidi, které chceš mít v databázi hráčů (stáhne se i jméno a avatar).'), box),
    actions: [{ label: 'Zrušit' }, { label: 'Vytvořit vybrané', primary: true, onClick: async () => {
      const n = await API.call('discord.import_players', { members: ms.filter(m => sel.has(m.id)) });
      App.players = await API.call('players.list'); toast(`Přidáno ${n} hráčů`);
    } }] });
}

Views.register('settings', {
  title: 'nastavení', short: 'Nastavení', icon: 'settings', order: 90, bottom: true, members: false,
  async mount(root) {
    const s = await API.call('settings.get');
    const roots = [...(s.roots || [])];
    const rootsBox = h('.col', { style: { gap: '6px' } });
    const renderRoots = () => {
      clear(rootsBox);
      roots.forEach((r, i) => rootsBox.appendChild(h('.list-row', { style: { background: 'var(--surface)', border: '1px solid var(--border)' } },
        icon('folder'), h('.grow.ellipsis', r),
        h('button.btn.ghost.sm.icon', { title: 'Odebrat', onclick: () => { roots.splice(i, 1); renderRoots(); } }, icon('x')))));
      rootsBox.appendChild(h('button.btn.sm', { style: { alignSelf: 'flex-start' }, onclick: async () => {
        const p = await API.call('pick_folder'); if (p && !roots.includes(p)) { roots.push(p); renderRoots(); }
      } }, icon('folder-plus'), 'Přidat složku'));
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
      toast('Uloženo – načítám knihovnu znovu');
    };
    root.appendChild(h('.scroll', { style: { flex: 1 } },
      h('.page-head', h('h1', 'Nastavení'), h('.grow'), h('button.btn.primary', { onclick: save }, icon('save'), 'Uložit')),
      h('div', { style: { padding: '0 24px 40px', maxWidth: '820px' } },
        card('Vzhled', 'Mění se hned, bez ukládání.', appearanceSection()),
        card('Discord', 'Jména a avatary hráčů se tahají přes tvého bota na serveru. Token zůstává jen v tomto počítači (data/settings.json).',
          discordCard(s)),
        card('Webová kronika', 'Synchronizace s gingygames.com/kronika: postavy, události, zápisy, frakce, místa, obrázky a videa nahraná na YouTube. Vše je na webu soukromé, dokud to tam sám nezveřejníš. Kontakty hráčů se nikdy neposílají.',
          webSyncCard()),
        card('Složky se záznamy', 'Složky Medalu (obsahují Clips/, Databases/, Thumbnails/…). Databázi Medalu jen čtu, nikdy do ní nezapisuji.', rootsBox),
        card('Rozdělení záznamů', null,
          h('.row', { style: { gap: '30px' } },
            h('label.field', 'Klip je nejvýš (s)', clipMax),
            h('label.field', 'Skrýt celé záznamy kratší než (s)', shortS),
            h('label.field', 'Návrhy událostí: nová skupina po pauze (min)', gap))),
        card('Zvukové stopy', 'Které stopy se zapnou při otevření videa (když se nepamatuje poslední volba).', mixRow,
          h('label.check', { style: { marginTop: '12px' } }, remember, 'Pamatovat si poslední zvolené stopy (podle typu – hra, mikrofon…)')),
        card('Přejmenování a sloučení her', 'Jeden řádek = původní název = nový název.', aliases),
        card('Data katalogu', 'Úpravy, deníky, postavy a přílohy jsou ve složce data/ vedle aplikace. Zálohuj ji.',
          h('.row', h('button.btn', { onclick: () => API.call('open_data_dir') }, icon('folder-open'), 'Otevřít složku s daty'),
            h('button.btn', { onclick: () => { API.call('rescan'); toast('Hledám nové záznamy…'); } }, icon('refresh-cw'), 'Načíst knihovnu znovu'))),
        card('Klávesové zkratky', null, h('.small.muted', { html: `
          <b>Přehrávač:</b> <span class="kbd">Mezerník</span> pauza · <span class="kbd">←</span>/<span class="kbd">→</span> 5 s ·
          <span class="kbd">Shift</span>+šipky 30 s · <span class="kbd">F</span> celá obrazovka · <span class="kbd">M</span> ztlumit ·
          <span class="kbd">Ctrl+1…9</span> zvukové stopy · <span class="kbd">B</span> záložka · <span class="kbd">Shift+B</span> začátek/konec úseku ·
          <span class="kbd">P</span> záložka rovnou do události · <span class="kbd">S</span> snímek (do události / výřez / portrét postavy)<br><br>
          <b>Knihovna:</b> <span class="kbd">Enter</span> přehrát · <span class="kbd">Delete</span> do koše · <span class="kbd">Ctrl+A</span> vybrat vše ·
          <span class="kbd">Ctrl+F</span> hledat · přetažení videí na událost/album je připojí<br><br>
          <b>Editor:</b> <span class="kbd">@</span> označit postavu · <span class="kbd">Ctrl+V</span> vložit screenshot · <span class="kbd">Ctrl+B/I/U</span>` })))));
  },
});
})();
