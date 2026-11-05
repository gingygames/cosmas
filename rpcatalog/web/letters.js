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
    { label: 'Napsat / vložit dopis ručně', icon: 'pencil', onClick: newLetter },
    { sep: true },
    { label: 'Import z exportu dat Discordu (.zip)…', icon: 'file-archive', onClick: () => runImport('letters.import_export') },
    { label: 'Import z rozbalené složky exportu…', icon: 'folder-open', onClick: () => runImport('letters.import_folder') },
    { label: 'Import z kanálu na serveru (bot)', icon: 'message-circle', onClick: () => runImport('letters.import_channel') },
    { sep: true },
    { label: 'Jak na import z Discordu?', icon: 'circle-help', onClick: help },
  ]);
  clear(side).append(
    h('.top', h('.row', h('b.grow', 'Holubí pošta'), h('button.btn.sm.primary', { onclick: imp }, icon('plus'), 'Přidat')),
      h('.search', icon('search'), h('input.input', { placeholder: 'Hledat v dopisech…', value: q, onkeydown: e => e.stopPropagation(), oninput: debounce(e => { q = e.target.value; renderRows(); }, 150) })),
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
  if (!items.length) { box.appendChild(h('.faint.small', { style: { padding: '14px 8px' } }, list.length ? 'Nic neodpovídá.' : 'Zatím žádné dopisy. Přidej ručně nebo importuj z Discordu (zprávy se slovem „holub“).')); return; }
  items.forEach(l => box.appendChild(h('.lt-row' + (cur && cur.id === l.id ? '.on' : ''), { onclick: () => open(l.id) },
    h('.row', h('.who.grow.ellipsis', l.title || who(l)), h('span.d', l.ingame_date || (l.sent_at ? fmt.date(l.sent_at) : ''))),
    l.title ? h('.d.ellipsis', who(l)) : null,
    h('.ex', (l.body || '').slice(0, 220)))));
}

function open(id) { cur = list.find(l => l.id === id) || null; App.ui.letterId = id; App.saveUi(); renderRows(); renderDetail(); }

function renderDetail() {
  const d = $('.lt-detail', root); clear(d);
  if (!cur) { d.appendChild(emptyState('mail', 'Holubí pošta', 'Dopisy mezi postavami – ručně, nebo z Discordu (zprávy se slovem „holub“).')); Shell.header({ icon: 'mail', title: 'holubí pošta' }); return; }
  const l = cur;
  Shell.header({ icon: 'mail', title: l.title || who(l), topic: [l.ingame_date, l.sent_at ? fmt.dt(l.sent_at) : '', l.source !== 'manual' ? 'z Discordu' : ''].filter(Boolean).join(' · ') });
  const save = debounce(f => API.call('letter.update', { id: l.id, ...f }).then(load).then(renderRows), 350);
  const charChips = ids => h('.row.wrap', { style: { gap: '6px' } }, ids.map(id => App.charsById.get(id)).filter(Boolean).map(c => charChip(c)));
  const ev = l.event_id && App.eventsById.get(l.event_id);
  const pl = l.place_id && (App.places || []).find(p => p.id === l.place_id);
  d.append(
    h('.lt-meta',
      h('.k', 'Název'), h('input.input', { value: l.title || '', placeholder: 'např. Dopis o zradě', onkeydown: e => e.stopPropagation(), oninput: e => { l.title = e.target.value; save({ title: l.title }); } }),
      h('.k', 'Od'), h('.row', l.sender_id ? charChips([l.sender_id]) : h('span.faint', l.author || 'nevybráno'),
        h('button.btn.sm', { onclick: async () => { const ids = await pickCharacters([], { title: 'Kdo dopis poslal?', multi: false }); if (ids && ids[0]) { l.sender_id = ids[0]; await API.call('letter.update', { id: l.id, sender_id: ids[0] }); await load(); open(l.id); } } }, 'Vybrat')),
      h('.k', 'Komu'), h('.row', charChips(l.recipient_ids || []),
        h('button.btn.sm', { onclick: async () => { const ids = await pickCharacters(l.recipient_ids || [], { title: 'Komu dopis patří?' }); if (ids) { await API.call('letter.update', { id: l.id, recipient_ids: ids }); await load(); open(l.id); } } }, 'Vybrat')),
      h('.k', 'Datum ve hře'), h('input.input', { value: l.ingame_date || '', placeholder: 'např. 3. den po žních', onkeydown: e => e.stopPropagation(), oninput: e => { l.ingame_date = e.target.value; save({ ingame_date: l.ingame_date }); } }),
      h('.k', 'Událost'), h('.row', ev ? h('span.chip.on', { onclick: () => App.go('events', { id: ev.id }) }, h('span.dot', { style: { background: ev.color } }), ev.title) : h('span.faint', '—'),
        h('button.btn.sm', { onclick: async () => { const r = await pickEvent({ title: 'K jaké události dopis patří?', moment: l.sent_at, withNote: false }); if (r) { await API.call('letter.update', { id: l.id, event_id: r.id }); await load(); open(l.id); } } }, 'Vybrat')),
      h('.k', 'Místo'), h('.row', pl ? h('span.chip.on', { onclick: () => App.go('places', { id: pl.id }) }, pl.name) : h('span.faint', '—'),
        h('button.btn.sm', { onclick: async () => { const id = await pickPlace('Odkud / kam?'); if (id) { await API.call('letter.update', { id: l.id, place_id: id }); App.places = await API.call('places.list'); await load(); open(l.id); } } }, 'Vybrat'))),
    h('textarea.input.lt-paper', { rows: 14, onkeydown: e => e.stopPropagation(), oninput: e => { l.body = e.target.value; save({ body: l.body }); } }, l.body || ''),
    h('.row', { style: { marginTop: '14px' } },
      l.channel ? h('span.small.faint', `Zdroj: ${l.channel}${l.author ? ' · ' + l.author : ''}`) : null, h('.grow'),
      h('button.btn.danger', { onclick: async () => { if (!await confirmDialog('Smazat dopis', 'Opravdu smazat tento dopis?', { danger: true, okLabel: 'Smazat' })) return; await API.call('letter.delete', { id: l.id }); cur = null; await load(); renderRows(); renderDetail(); } }, icon('trash-2'), 'Smazat')));
}

async function newLetter() {
  const id = await API.call('letter.create', { title: '', body: '' });
  await load(); open(id);
}

async function runImport(method) {
  toast('Načítám…');
  try {
    const r = await API.call(method);
    if (!r) return;
    toast(`Nalezeno ${r.found} zpráv se slovem „holub“, nových ${r.new}`);
    await load(); renderRows();
  } catch (e) { /* toast already shown */ }
}

function help() {
  modal({ title: 'Dopisy z Discordu', icon: 'circle-help', wide: true, body: h('.col', { style: { gap: '10px' } },
    h('div', h('b', 'Z kanálu na serveru (doporučeno): '), 'pokud se dopisy píšou do kanálu na serveru, kde je tvůj bot, vyplň v Nastavení → Discord ID kanálu. Načtou se zprávy obsahující slovo „holub“ (slovo jde změnit) – od všech hráčů.'),
    h('div', h('b', 'Z exportu dat: '), 'Discord → Uživatelská nastavení → Data a soukromí → Požádat o data (zaškrtni Zprávy). Za pár dní přijde odkaz na package.zip – ten tady vyber. Export obsahuje jen zprávy, které jsi napsal ty.'),
    h('.faint', 'Soukromé zprávy, které ti poslali ostatní, Discord nikomu automaticky nevydá – boti k nim nemají přístup a stahování přes osobní účet je proti pravidlům Discordu (hrozí ban). Takové dopisy přidej ručně (Přidat → Napsat / vložit) – stačí zkopírovat text.')) });
}

Views.register('letters', {
  title: 'holubí pošta', short: 'Pošta', icon: 'mail', order: 45, members: false,
  async mount(el, params = {}) {
    root = el; charFilter = params.char || null;
    el.appendChild(h('.lt', h('.lt-side'), h('.lt-detail')));
    await load();
    renderSide();
    const id = params.id || App.ui.letterId;
    if (id && list.some(l => l.id === id)) open(id); else renderDetail();
    unsub = [App.on('chars', () => renderRows())];
  },
  unmount() { unsub.forEach(f => f()); unsub = []; root = null; },
});
})();
