/* ============================================================
   Holubí pošta – letters between characters (manual or imported from Discord)
   ============================================================ */
'use strict';

(() => {
document.head.appendChild(h('style', `
.lt { display: flex; height: 100%; min-height: 0; }
.lt-side { width: 360px; flex: none; display: flex; flex-direction: column; background: var(--bg-2); min-height: 0; }
.lt-side .top { padding: 14px 12px 8px; display: flex; flex-direction: column; gap: 8px; }
.lt-list { flex: 1; overflow: auto; padding: 0 8px 16px; }
.lt-row { padding: 9px 10px; border-radius: 4px; cursor: pointer; }
.lt-row:hover { background: var(--hover); }
.lt-row.on { background: var(--active); }
.lt-row .who { font-weight: 600; font-size: 13.5px; }
.lt-row .ex { font-size: 12.5px; color: var(--text-3); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.lt-row .d { font-size: 11.5px; color: var(--text-3); }
.lt-detail { flex: 1; min-width: 0; overflow: auto; padding: 24px 32px 40px; }
.lt-paper { max-width: 760px; padding: 26px 30px; border-radius: 8px; background: var(--surface); font: 16px/1.65 var(--serif); white-space: pre-wrap; }
.lt-meta { display: grid; grid-template-columns: 110px 1fr; gap: 10px 12px; align-items: center; max-width: 760px; margin-bottom: 16px; }
.lt-meta .k { color: var(--text-3); font-size: 12.5px; }
`));

let root, list = [], cur = null, q = '', charFilter = null, unsub = [];

const charName = id => (App.charsById.get(id) || {}).name;
function who(l) {
  const from = charName(l.sender_id) || l.author || '?';
  const to = (l.recipient_ids || []).map(charName).filter(Boolean).join(', ') || l.channel || '';
  return `${from} → ${to}`;
}

async function load() { list = await API.call('letters.list'); }

function renderSide() {
  const side = $('.lt-side', root);
  const imp = e => menu(e, [
    { label: tr('Paste from clipboard (messages copied from Discord)'), icon: 'clipboard-paste', onClick: pasteFromClipboard },
    { label: tr('Write a letter manually'), icon: 'pencil', onClick: newLetter },
    { sep: true },
    { label: tr('Import from Discord data export (.zip)…'), icon: 'file-archive', onClick: () => runImport('letters.import_export') },
    { label: tr('Import from an unpacked export folder…'), icon: 'folder-open', onClick: () => runImport('letters.import_folder') },
    { label: tr('Import from a server channel (bot)'), icon: 'message-circle', onClick: () => runImport('letters.import_channel') },
    { sep: true },
    { label: tr('How to import from Discord?'), icon: 'circle-help', onClick: help },
  ]);
  clear(side).append(
    h('.top', h('.row', h('b.grow', tr('Pigeon post')), h('button.btn.sm.primary', { onclick: imp }, icon('plus'), tr('Add'))),
      h('.search', icon('search'), h('input.input', { placeholder: tr('Search letters…'), value: q, onkeydown: e => e.stopPropagation(), oninput: debounce(e => { q = e.target.value; renderRows(); }, 150) })),
      charFilter ? h('.row', h('span.chip.on', charName(charFilter), h('span.x', { onclick: () => { charFilter = null; renderSide(); } }, icon('x')))) : null),
    h('.lt-list'));
  renderRows();
}
function renderRows() {
  const box = $('.lt-list', root); if (!box) return;
  clear(box);
  const t = q.toLowerCase();
  const items = list.filter(l => (!t || `${l.title} ${l.body} ${who(l)}`.toLowerCase().includes(t))
    && (!charFilter || l.sender_id === charFilter || (l.recipient_ids || []).includes(charFilter)));
  if (!items.length) { box.appendChild(h('.faint.small', { style: { padding: '14px 8px' } }, list.length ? tr('Nothing matches.') : tr('No letters yet. Add one manually or import from Discord (messages containing the word “holub”).'))); return; }
  items.forEach(l => box.appendChild(h('.lt-row' + (cur && cur.id === l.id ? '.on' : ''), { onclick: () => open(l.id) },
    h('.row', h('.who.grow.ellipsis', l.title || who(l)), h('span.d', l.ingame_date || (l.sent_at ? fmt.date(l.sent_at) : ''))),
    l.title ? h('.d.ellipsis', who(l)) : null,
    h('.ex', (l.body || '').slice(0, 220)))));
}

function open(id) { cur = list.find(l => l.id === id) || null; App.ui.letterId = id; App.saveUi(); renderRows(); renderDetail(); }

function renderDetail() {
  const d = $('.lt-detail', root); clear(d);
  if (!cur) { d.appendChild(emptyState('mail', tr('Pigeon post'), tr('Letters between characters – manual, or from Discord (messages containing the word “holub”).'))); Shell.header({ icon: 'mail', title: tr('pigeon post') }); return; }
  const l = cur;
  Shell.header({ icon: 'mail', title: l.title || who(l), topic: [l.ingame_date, l.sent_at ? fmt.dt(l.sent_at) : '', l.source !== 'manual' ? tr('from Discord') : ''].filter(Boolean).join(' · ') });
  const save = debounce(f => API.call('letter.update', { id: l.id, ...f }).then(load).then(renderRows), 350);
  const charChips = ids => h('.row.wrap', { style: { gap: '6px' } }, ids.map(id => App.charsById.get(id)).filter(Boolean).map(c => charChip(c)));
  const ev = l.event_id && App.eventsById.get(l.event_id);
  const pl = l.place_id && (App.places || []).find(p => p.id === l.place_id);
  d.append(
    h('.lt-meta',
      h('.k', tr('Title')), h('input.input', { value: l.title || '', placeholder: tr('e.g. Letter about the betrayal'), onkeydown: e => e.stopPropagation(), oninput: e => { l.title = e.target.value; save({ title: l.title }); } }),
      h('.k', tr('From')), h('.row', l.sender_id ? charChips([l.sender_id]) : h('span.faint', l.author || tr('not selected')),
        h('button.btn.sm', { onclick: async () => { const ids = await pickCharacters([], { title: tr('Who sent the letter?'), multi: false }); if (ids && ids[0]) { l.sender_id = ids[0]; await API.call('letter.update', { id: l.id, sender_id: ids[0] }); await load(); open(l.id); } } }, 'Vybrat')),
      h('.k', tr('Addressed to')), h('.row', charChips(l.recipient_ids || []),
        h('button.btn.sm', { onclick: async () => { const ids = await pickCharacters(l.recipient_ids || [], { title: tr('Who is the letter for?') }); if (ids) { await API.call('letter.update', { id: l.id, recipient_ids: ids }); await load(); open(l.id); } } }, 'Vybrat')),
      h('.k', tr('In-game date')), h('input.input', { value: l.ingame_date || '', placeholder: tr('e.g. 3rd day after the harvest'), onkeydown: e => e.stopPropagation(), oninput: e => { l.ingame_date = e.target.value; save({ ingame_date: l.ingame_date }); } }),
      h('.k', tr('Event')), h('.row', ev ? h('span.chip.on', { onclick: () => App.go('events', { id: ev.id }) }, h('span.dot', { style: { background: ev.color } }), ev.title) : h('span.faint', '—'),
        h('button.btn.sm', { onclick: async () => { const r = await pickEvent({ title: tr('Which event does the letter belong to?'), moment: l.sent_at, withNote: false }); if (r) { await API.call('letter.update', { id: l.id, event_id: r.id }); await load(); open(l.id); } } }, 'Vybrat')),
      h('.k', tr('Place')), h('.row', pl ? h('span.chip.on', { onclick: () => App.go('places', { id: pl.id }) }, pl.name) : h('span.faint', '—'),
        h('button.btn.sm', { onclick: async () => { const id = await pickPlace(tr('From where / to where?')); if (id) { await API.call('letter.update', { id: l.id, place_id: id }); App.places = await API.call('places.list'); await load(); open(l.id); } } }, 'Vybrat'))),
    h('textarea.input.lt-paper', { rows: 14, onkeydown: e => e.stopPropagation(), oninput: e => { l.body = e.target.value; save({ body: l.body }); } }, l.body || ''),
    h('.row', { style: { marginTop: '14px' } },
      l.channel ? h('span.small.faint', tr('Source: {source}', { source: l.channel + (l.author ? ' · ' + l.author : '') })) : null, h('.grow'),
      h('button.btn.danger', { onclick: async () => { if (!await confirmDialog(tr('Delete letter'), tr('Really delete this letter?'), { danger: true, okLabel: tr('Delete') })) return; await API.call('letter.delete', { id: l.id }); cur = null; await load(); renderRows(); renderDetail(); } }, icon('trash-2'), tr('Delete'))));
}

/* ---- paste messages copied from Discord ---- */
async function pasteFromClipboard() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch (e) { /* fall back to the dialog's text box */ }
  pasteDialog(text);
}

function guessChar(author) {
  const a = (author || '').trim().toLowerCase();
  if (!a) return null;
  const pl = (App.players || []).find(p => [p.discord_name, p.contact, p.name].some(x => x && x.toLowerCase() === a));
  if (pl) {
    const mine = App.chars.filter(c => c.player_id === pl.id && c.status !== 'dead');
    if (mine.length === 1) return mine[0].id;
  }
  const c = App.chars.find(c => c.name.toLowerCase() === a || (c.aliases || '').toLowerCase().split(',').map(x => x.trim()).includes(a));
  return c ? c.id : null;
}

function hash(str) { let x = 5381; for (let i = 0; i < str.length; i++) x = (x * 33 + str.charCodeAt(i)) >>> 0; return x.toString(36); }

function pasteDialog(text) {
  const marker = (App.settings.holub_marker || 'holub').toLowerCase();
  const ta = h('textarea.input', { rows: 5, placeholder: tr('In Discord, select the messages (drag the mouse over them), press Ctrl+C and paste them here with Ctrl+V.'), onkeydown: e => e.stopPropagation() }, text || '');
  const listBox = h('div'), authorsBox = h('div');
  let msgs = [], sel = new Set(), mode = 'each', recips = [];
  const map = new Map();          // author -> character id
  const recBox = h('.row.wrap', { style: { gap: '6px' } });
  const renderRec = () => clear(recBox).append(
    ...recips.map(id => App.charsById.get(id)).filter(Boolean).map(c => charChip(c, { onRemove: () => { recips = recips.filter(x => x !== c.id); renderRec(); } })),
    h('button.btn.sm', { onclick: async () => { const ids = await pickCharacters(recips, { title: tr('Who are the letters for?') }); if (ids) { recips = ids; renderRec(); } } }, icon('user-plus'), tr('Recipients')));
  const parse = () => {
    msgs = parseDiscordCopy(ta.value);
    const marked = msgs.map((m, i) => (m.body.toLowerCase().includes(marker) || m.body.includes('🕊')) ? i : -1).filter(i => i >= 0);
    sel = new Set(marked.length ? marked : msgs.map((_, i) => i));
    for (const m of msgs) if (m.author && !map.has(m.author)) map.set(m.author, guessChar(m.author));
    render();
  };
  const render = () => {
    clear(listBox);
    if (!msgs.length) { listBox.appendChild(h('.faint.small', tr('Nothing yet – paste the copied messages.'))); clear(authorsBox); return; }
    listBox.appendChild(h('.small.muted', { style: { margin: '6px 0' } }, trn(msgs.length, 'Recognized {n} message – checked ones will be saved (those containing the word “{marker}” are preselected).', 'Recognized {n} messages – checked ones will be saved (those containing the word “{marker}” are preselected).', { marker })));
    listBox.appendChild(h('.picker-list', { style: { maxHeight: '32vh' } }, msgs.map((m, i) => h('.list-row' + (sel.has(i) ? '.sel' : ''), {
      style: { alignItems: 'flex-start' },
      onclick: () => { sel.has(i) ? sel.delete(i) : sel.add(i); render(); },
    }, h('input', { type: 'checkbox', checked: sel.has(i), style: { marginTop: '3px' } }),
    h('.grow', { style: { minWidth: 0 } }, h('.small', h('b', m.author || '?'), h('span.faint', m.sent_at ? '  ' + fmt.dt(m.sent_at) : '')),
      h('.small.muted', { style: { whiteSpace: 'pre-wrap' } }, m.body.length > 280 ? m.body.slice(0, 280) + '…' : m.body))))));
    const authors = [...new Set(msgs.filter((_, i) => sel.has(i)).map(m => m.author).filter(Boolean))];
    clear(authorsBox);
    if (authors.length) {
      authorsBox.appendChild(h('.small.muted', { style: { margin: '10px 0 6px' } }, tr('Who is who (message author → character who wrote the letter):')));
      authors.forEach(a => {
        const selEl = h('select.input', { style: { width: '240px' }, onchange: e => map.set(a, e.target.value ? Number(e.target.value) : null) },
          h('option', { value: '' }, tr('— Discord name only —')),
          App.chars.map(c => h('option', { value: c.id, selected: map.get(a) === c.id }, c.name)));
        authorsBox.appendChild(h('.row', { style: { marginBottom: '4px' } }, h('span', { style: { width: '160px' } }, a), icon('arrow-right', 'faint'), selEl));
      });
    }
  };
  ta.addEventListener('input', debounce(parse, 250));
  const modeSeg = h('.seg', [['each', tr('Each message = a letter')], ['one', tr('All as one letter')]].map(([k, l]) =>
    h('button' + (mode === k ? '.on' : ''), { onclick: e => { mode = k; $$('button', e.currentTarget.parentNode).forEach(b => b.classList.toggle('on', b === e.currentTarget)); } }, l)));
  renderRec(); parse();
  modal({ title: tr('Letters from clipboard'), icon: 'clipboard-paste', wide: true,
    body: h('.col', { style: { gap: '8px' } }, ta, listBox, authorsBox, h('.row.wrap', { style: { gap: '12px', marginTop: '6px' } }, modeSeg, recBox),
      h('.faint.small', tr('Tip: find the “Holub” messages in Discord via search (Ctrl+F → holub), then select them and copy them all at once.'))),
    actions: [{ label: tr('Cancel') }, { label: tr('Save letters'), primary: true, icon: 'check', onClick: async () => {
      const chosen = msgs.filter((_, i) => sel.has(i));
      if (!chosen.length) { toast(tr('Nothing is selected'), 'err'); return false; }
      const items = mode === 'one'
        ? [{ author: [...new Set(chosen.map(m => m.author).filter(Boolean))].join(', '), sent_at: chosen[0].sent_at,
          body: chosen.map(m => chosen.length > 1 && m.author ? `${m.author}:\n${m.body}` : m.body).join('\n\n'), sender: map.get(chosen[0].author) || null }]
        : chosen.map(m => ({ author: m.author, sent_at: m.sent_at, body: m.body, sender: map.get(m.author) || null }));
      let first = null, n = 0;
      for (const it of items) {
        const id = await API.call('letter.create', { author: it.author || '', sent_at: it.sent_at || undefined, body: it.body,
          sender_id: it.sender, recipient_ids: recips, source: 'discord-paste', channel: tr('Discord (clipboard)'),
          source_ref: 'dp:' + hash(`${it.author}|${it.sent_at}|${it.body}`) });
        if (id) { n++; first = first || id; }
      }
      toast(n ? trn(n, 'Saved {n} letter', 'Saved {n} letters') : tr('These letters are already in the post'));
      await load(); renderRows(); if (first) open(first);
    } }] });
}

async function newLetter() {
  const id = await API.call('letter.create', { title: '', body: '' });
  await load(); open(id);
}

async function runImport(method) {
  toast(tr('Loading…'));
  try {
    const r = await API.call(method);
    if (!r) return;
    toast(trn(r.found, 'Found {n} message containing the word “holub”, {new} new', 'Found {n} messages containing the word “holub”, {new} new', { new: r.new }));
    await load(); renderRows();
  } catch (e) { /* toast already shown */ }
}

function help() {
  modal({ title: tr('Letters from Discord'), icon: 'circle-help', wide: true, body: h('.col', { style: { gap: '10px' } },
    h('div', h('b', tr('From a server channel (recommended): ')), tr('if letters are written in a channel on a server where your bot is, fill in the channel ID in Settings → Discord. Messages containing the word “holub” (the word can be changed) are loaded – from all players.')),
    h('div', h('b', tr('From a data export: ')), tr('Discord → User Settings → Data & Privacy → Request data (tick Messages). In a few days you get a link to package.zip – choose it here. The export only contains messages you wrote yourself.')),
    h('div', h('b', tr('From the clipboard (fastest for DMs): ')), tr('in Discord, select messages by dragging the mouse, Ctrl+C, then here Add → Paste from clipboard (or just Ctrl+V in Pigeon post). Author, time and text are recognized.')),
    h('.faint', tr('Discord does not hand out private messages others sent you automatically – bots have no access to them and downloading through a personal account is against Discord rules (risk of a ban). Add such letters manually (Add → Write / paste) – just copy the text.'))) });
}

Views.register('letters', {
  title: tr('pigeon post'), short: tr('Post'), icon: 'mail', order: 45, members: false,
  async mount(el, params = {}) {
    root = el; charFilter = params.char || null;
    el.appendChild(h('.lt', h('.lt-side'), h('.lt-detail')));
    el.addEventListener('paste', e => {
      if (e.target.closest('input, textarea, [contenteditable="true"]') || $('.backdrop')) return;
      const t = e.clipboardData && e.clipboardData.getData('text/plain');
      if (t && t.trim()) { e.preventDefault(); pasteDialog(t); }
    });
    await load();
    renderSide();
    const id = params.id || App.ui.letterId;
    if (id && list.some(l => l.id === id)) open(id); else renderDetail();
    unsub = [App.on('chars', () => renderRows())];
  },
  unmount() { unsub.forEach(f => f()); unsub = []; root = null; },
});
})();
