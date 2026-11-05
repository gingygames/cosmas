/* ============================================================
   Game artwork: icon (left rail) + banner (library hero)
   Sources: Steam on this PC, Steam store, Medal icons, file / URL / clipboard / video frame
   ============================================================ */
'use strict';

(() => {
document.head.appendChild(h('style', `
.ga-now { display: flex; gap: 16px; align-items: center; margin-bottom: 6px; }
.ga-icon { width: 72px; height: 72px; border-radius: 18px; background: var(--surface-2) center / cover; flex: none; display: grid; place-items: center; font-weight: 800; color: var(--text-3); }
.ga-banner { flex: 1; height: 72px; border-radius: 8px; background: var(--surface-2) center / cover; display: grid; place-items: center; color: var(--text-3); font-size: 12px; }
.ga-sec { margin-top: 14px; }
.ga-sec h4 { margin: 0 0 6px; font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: .03em; color: var(--text-3); }
.ga-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.ga-img { height: 96px; border-radius: 6px; cursor: pointer; background: #000; position: relative; overflow: hidden; outline: 2px solid transparent; }
.ga-img img { height: 100%; display: block; }
.ga-img:hover { outline-color: var(--accent); }
.ga-img span { position: absolute; left: 4px; bottom: 4px; font-size: 10.5px; padding: 1px 5px; border-radius: 3px; background: rgba(0,0,0,.7); color: #fff; }
`));

async function useImage(game, img, appid, onDone) {
  const data = img.data || await API.call('game.image_data', img.path ? { path: img.path } : { url: img.url }).catch(() => null);
  if (!data) return toast('Obrázek nejde načíst', 'err');
  menu({ x: innerWidth / 2 - 100, y: innerHeight / 2 - 40 }, [
    { label: 'Použít jako ikonu (vlevo)…', icon: 'square', onClick: async () => {
      const c = await cropDialog(data, { ratio: 1, title: `Ikona – ${game}`, okLabel: 'Nastavit ikonu' });
      if (c) { App.gameArt = await API.call('game.art_set', { game, kind: 'icon', data_b64: c, appid }); onDone(); }
    } },
    { label: 'Použít jako banner (knihovna)…', icon: 'rectangle-horizontal', onClick: async () => {
      const c = await cropDialog(data, { ratio: 3.1, title: `Banner – ${game}`, okLabel: 'Nastavit banner' });
      if (c) { App.gameArt = await API.call('game.art_set', { game, kind: 'banner', data_b64: c, appid }); onDone(); }
    } },
  ]);
}

function grid(game, images, appid, onDone) {
  return h('.ga-grid', images.map(i => h('.ga-img', { title: 'Klik = použít', onclick: () => useImage(game, i, appid, onDone) },
    h('img', { src: i.src || i.url, loading: 'lazy', onerror: e => e.target.closest('.ga-img').remove() }), h('span', i.kind))));
}

async function gameArtDialog(game) {
  const now = h('.ga-now'), body = h('div');
  const refresh = () => {
    const a = (App.gameArt || {})[game] || {};
    clear(now).append(
      h('.ga-icon', { style: a.icon ? { backgroundImage: `url("${a.icon}")` } : {} }, a.icon ? null : game.slice(0, 2)),
      h('.ga-banner', { style: a.banner ? { backgroundImage: `url("${a.banner}")` } : {} }, a.banner ? null : 'bez banneru'),
      h('.col', { style: { gap: '4px' } },
        a.icon ? h('button.btn.sm.ghost', { onclick: async () => { App.gameArt = await API.call('game.art_reset', { game, kind: 'icon' }); refresh(); } }, 'Zrušit ikonu') : null,
        a.banner ? h('button.btn.sm.ghost', { onclick: async () => { App.gameArt = await API.call('game.art_reset', { game, kind: 'banner' }); refresh(); } }, 'Zrušit banner') : null));
    Shell.renderGuilds();
    App.emit('gameart');
  };
  refresh();
  const src = await API.call('game.art_sources', { game });
  const onDone = () => refresh();

  const instBox = h('div');
  const renderInstalled = list => {
    clear(instBox);
    if (!list.length) instBox.appendChild(h('.faint.small', 'Hra se stejným názvem ve Steamu na tomto PC není – vyber ji ze seznamu nebo hledej v obchodě.'));
    list.forEach(g => instBox.append(h('.small', { style: { margin: '6px 0 4px' } }, g.name), grid(game, g.images, g.appid, onDone)));
  };
  renderInstalled(src.installed);
  const instSel = h('select.input', { style: { width: '320px' }, onchange: async e => {
    if (!e.target.value) return;
    const g = await API.call('game.art_installed', { name: e.target.value });
    if (g) renderInstalled([g]);
  } }, h('option', { value: '' }, 'Jiná hra ze Steamu na tomto PC…'), src.all_installed.map(n => h('option', { value: n }, n)));

  const term = h('input.input', { value: game, style: { width: '320px' }, onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter') search(); } });
  const results = h('div');
  async function search() {
    clear(results).appendChild(h('.faint.small', 'Hledám v obchodě Steamu…'));
    const r = await API.call('game.art_search', { term: term.value.trim() }).catch(() => null);
    clear(results);
    if (!r || !r.length) { results.appendChild(h('.faint.small', 'Nic nenalezeno.')); return; }
    r.slice(0, 5).forEach(g => results.append(h('.small', { style: { margin: '6px 0 4px' } }, g.name), grid(game, g.images, g.appid, onDone)));
  }

  const own = h('.row.wrap', { style: { gap: '6px' } },
    h('button.btn.sm', { onclick: async () => { const d = await API.call('game.art_pick_file'); if (d) useImage(game, { data: d }, null, onDone); } }, icon('image-up'), 'Ze souboru…'),
    h('button.btn.sm', { onclick: async () => {
      try {
        const items = await navigator.clipboard.read();
        for (const it of items) { const t = it.types.find(x => x.startsWith('image/')); if (t) { useImage(game, { data: await readAsDataURL(await it.getType(t)) }, null, onDone); return; } }
        toast('Ve schránce není obrázek', 'err');
      } catch (e) { toast('Schránku nejde přečíst', 'err'); }
    } }, icon('clipboard-paste'), 'Ze schránky'),
    h('button.btn.sm', { onclick: async () => { const u = await promptDialog('Obrázek z webu', 'Adresa obrázku (URL)', '', { placeholder: 'https://…' }); if (u) useImage(game, { url: u.trim() }, null, onDone); } }, icon('link'), 'Z URL…'),
    h('button.btn.sm', { disabled: !App.player.media_id, onclick: async () => { const g = await grabFrame(); if (g) useImage(game, { data: g.data }, null, onDone); } }, icon('camera'), 'Snímek z videa'));

  body.append(now,
    h('.row', { style: { marginTop: '8px' } }, h('button.btn.sm.primary', { onclick: async () => {
      const r = await API.call('game.art_auto', { games: [game], overwrite: true });
      App.gameArt = r.art; refresh(); toast(r.done.length ? 'Nastaveno ze Steamu' : 'Ve Steamu na tomto PC jsem hru nenašel', r.done.length ? 'ok' : 'err');
    } }, icon('wand-sparkles'), 'Automaticky ze Steamu'), h('span.faint.small', 'Klikni na libovolný obrázek níže – vybereš, jestli je to ikona nebo banner, a ořízneš ho.')),
    h('.ga-sec', h('h4', 'Steam na tomto PC'), instSel, instBox),
    h('.ga-sec', h('h4', 'Obchod Steam'), h('.row', term, h('button.btn.sm', { onclick: search }, icon('search'), 'Hledat')), results),
    src.medal.length ? h('.ga-sec', h('h4', 'Ikony z Medalu'), grid(game, src.medal, null, onDone)) : null,
    h('.ga-sec', h('h4', 'Vlastní obrázek'), own));
  modal({ title: `Obrázky hry – ${game}`, icon: 'image', xwide: true, body });
}

window.gameArtDialog = gameArtDialog;
})();
