/* ============================================================
   Video frame grab + crop (e.g. a character portrait from a recording)
   ============================================================ */
'use strict';

(() => {
document.head.appendChild(h('style', `
.crop-wrap { position: relative; display: inline-block; user-select: none; line-height: 0; border-radius: 10px; overflow: hidden; background: #000; }
.crop-wrap img { max-width: min(860px, 80vw); max-height: 60vh; display: block; }
.crop-shade { position: absolute; inset: 0; pointer-events: none; }
.crop-box { position: absolute; border: 2px solid var(--accent); box-shadow: 0 0 0 9999px rgba(0,0,0,.6); cursor: move; }
.crop-box::before, .crop-box::after { content: ''; position: absolute; inset: 33.3% 0; border-top: 1px solid rgba(255,255,255,.25); border-bottom: 1px solid rgba(255,255,255,.25); pointer-events: none; }
.crop-box::after { inset: 0 33.3%; border: 0; border-left: 1px solid rgba(255,255,255,.25); border-right: 1px solid rgba(255,255,255,.25); }
.crop-box .hd { position: absolute; width: 14px; height: 14px; background: var(--accent); border-radius: 3px; }
.crop-box .hd.br { right: -7px; bottom: -7px; cursor: nwse-resize; }
.crop-box .hd.tl { left: -7px; top: -7px; cursor: nwse-resize; }
.crop-box .hd.tr { right: -7px; top: -7px; cursor: nesw-resize; }
.crop-box .hd.bl { left: -7px; bottom: -7px; cursor: nesw-resize; }
.crop-prev { width: 120px; aspect-ratio: var(--ar, 4/5); border-radius: 12px; background: #000 no-repeat; border: 1px solid var(--border-2); }
.snap-choice { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.snap-choice button { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 10px; border-radius: 12px;
  background: var(--surface-2); border: 1px solid var(--border); color: var(--text); cursor: pointer; font-size: 13px; }
.snap-choice button:hover { border-color: var(--accent); background: var(--surface-3); }
.snap-choice button i { font-size: 22px; color: var(--accent); }
.snap-choice small { color: var(--text-3); font-size: 11.5px; text-align: center; }
`));

const RATIOS = [['4:5', 4 / 5], ['1:1', 1], ['16:9', 16 / 9], ['volně', null]];

/** Crop an image (data URL). Resolves to a JPEG data URL or null. */
function cropDialog(src, { title = 'Vyříznout výřez', ratio = 4 / 5, okLabel = 'Použít výřez' } = {}) {
  return new Promise(resolve => {
    let done = false, ar = ratio;
    const img = h('img', { src, draggable: 'false' });
    const box = h('.crop-box', h('.hd.tl'), h('.hd.tr'), h('.hd.bl'), h('.hd.br'));
    const wrap = h('.crop-wrap', img, box);
    const prev = h('.crop-prev');
    const r = { x: 0, y: 0, w: 0, h: 0 };   // in displayed pixels
    const W = () => img.clientWidth, H = () => img.clientHeight;
    const clamp = () => {
      r.w = Math.max(24, Math.min(r.w, W())); r.h = Math.max(24, Math.min(r.h, H()));
      if (ar) { if (r.w / r.h > ar) r.w = r.h * ar; else r.h = r.w / ar; }
      r.x = Math.max(0, Math.min(r.x, W() - r.w)); r.y = Math.max(0, Math.min(r.y, H() - r.h));
    };
    const draw = () => {
      Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      const sc = 120 / r.w;
      prev.style.setProperty('--ar', `${r.w}/${r.h}`);
      prev.style.backgroundImage = `url("${src}")`;
      prev.style.backgroundSize = `${W() * sc}px ${H() * sc}px`;
      prev.style.backgroundPosition = `${-r.x * sc}px ${-r.y * sc}px`;
    };
    const reset = () => {
      r.h = H() * 0.7; r.w = ar ? r.h * ar : W() * 0.5;
      r.x = (W() - r.w) / 2; r.y = (H() - r.h) / 2; clamp(); draw();
    };
    img.onload = () => setTimeout(reset, 0);

    let drag = null;
    box.addEventListener('mousedown', e => {
      e.preventDefault();
      const handle = e.target.classList.contains('hd') ? [...e.target.classList].find(c => c !== 'hd') : null;
      drag = { handle, sx: e.clientX, sy: e.clientY, r0: { ...r } };
    });
    const onMove = e => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy, o = drag.r0;
      if (!drag.handle) { r.x = o.x + dx; r.y = o.y + dy; r.w = o.w; r.h = o.h; }
      else {
        const left = drag.handle.includes('l'), top = drag.handle.includes('t');
        let w = o.w + (left ? -dx : dx), hh = o.h + (top ? -dy : dy);
        if (ar) { if (Math.abs(dx) > Math.abs(dy)) hh = w / ar; else w = hh * ar; }
        w = Math.max(24, w); hh = Math.max(24, hh);
        r.w = w; r.h = hh;
        r.x = left ? o.x + o.w - w : o.x; r.y = top ? o.y + o.h - hh : o.y;
      }
      clamp(); draw();
    };
    const onUp = () => { drag = null; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.06 : 1 / 1.06, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      r.w *= f; r.h *= f; r.x = cx - r.w / 2; r.y = cy - r.h / 2; clamp(); draw();
    }, { passive: false });

    const seg = h('.seg', RATIOS.map(([label, v]) => h('button' + (v === ar ? '.on' : ''), {
      onclick: e => { ar = v; $$('button', seg).forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); clamp(); draw(); },
    }, label)));

    const finish = () => {
      const sx = img.naturalWidth / W(), sy = img.naturalHeight / H();
      const cw = Math.round(r.w * sx), ch = Math.round(r.h * sy);
      const scale = Math.min(1, 1200 / Math.max(cw, ch));
      const c = document.createElement('canvas');
      c.width = Math.round(cw * scale); c.height = Math.round(ch * scale);
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(img, r.x * sx, r.y * sy, cw, ch, 0, 0, c.width, c.height);
      done = true; resolve(c.toDataURL('image/jpeg', 0.92));
    };
    modal({
      title, icon: 'crop', xwide: true,
      body: h('.row', { style: { alignItems: 'flex-start', gap: '18px' } }, wrap,
        h('.col', { style: { gap: '10px', minWidth: '150px' } }, h('.small.muted', 'Poměr stran'), seg,
          h('.small.muted', { style: { marginTop: '6px' } }, 'Náhled'), prev,
          h('.tiny.faint', 'Táhni rámeček, rohy mění velikost, kolečko myši zvětšuje.'))),
      onClose: () => {
        document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
        if (!done) resolve(null);
      },
      actions: [{ label: 'Zrušit' }, { label: okLabel, primary: true, icon: 'check', onClick: finish }],
    });
  });
}

/** Save a cropped frame as a character's portrait. charId optional (asks). */
async function portraitFromGrab(grab, charId = null) {
  if (!charId) {
    const ids = await pickCharacters([], { title: 'Čí je to portrét?', multi: false });
    if (!ids || !ids.length) return false;
    charId = ids[0];
  }
  const data = await cropDialog(grab.data, { title: 'Vyříznout portrét postavy', ratio: 4 / 5, okLabel: 'Nastavit jako portrét' });
  if (!data) return false;
  const att = await API.call('att.add_data', { owner_type: 'character', owner_id: charId, name: 'portret.jpg', data_b64: data,
    taken_at: grab.moment, caption: grab.caption, media_id: grab.media_id, media_offset: grab.pos });
  await API.call('char.portrait', { id: charId, att_id: att.id });
  await App.loadChars();
  const c = App.charsById.get(charId);
  toast(`Portrét nastaven${c ? ': ' + c.name : ''}`, 'ok', { label: 'Otevřít', fn: () => App.go('characters', { id: charId }) });
  return true;
}

async function grabFrame() {
  try { return await API.call('snap.grab'); } catch (e) { toast(String(e.message || e), 'err'); return null; }
}

/** What to do with a frame from the player (S key / Snímek button). */
async function snapshotFlow() {
  const grab = await grabFrame();
  if (!grab) return;
  const choose = what => { m.close(); run(what); };
  const m = modal({
    title: 'Snímek z videa', icon: 'camera', wide: true,
    body: h('div', h('img', { src: grab.data, style: { width: '100%', borderRadius: '10px', marginBottom: '12px', display: 'block' } }),
      h('.snap-choice',
        h('button', { onclick: () => choose('event') }, icon('calendar-range'), 'Do události', h('small', 'celý snímek jako příloha')),
        h('button', { onclick: () => choose('crop-event') }, icon('crop'), 'Výřez do události', h('small', 'vyřízni jen část')),
        h('button', { onclick: () => choose('portrait') }, icon('user-round'), 'Portrét postavy', h('small', 'vyřízni obličej / postavu')))),
  });
  async function run(what) {
    if (what === 'portrait') return portraitFromGrab(grab);
    let data = grab.data;
    if (what === 'crop-event') { data = await cropDialog(grab.data, { ratio: null }); if (!data) return; }
    const r = await pickEvent({ title: 'Uložit snímek do události', moment: grab.moment, withNote: false });
    if (!r) return;
    await API.call('att.add_data', { owner_type: 'event', owner_id: r.id, name: 'snimek.jpg', data_b64: data,
      taken_at: grab.moment, caption: grab.caption, media_id: grab.media_id, media_offset: grab.pos });
    toast('Snímek uložen do události', 'ok', { label: 'Otevřít', fn: () => App.go('events', { id: r.id, tab: 'files' }) });
    App.loadEvents();
  }
}

Object.assign(window, { cropDialog, portraitFromGrab, grabFrame, snapshotFlow });
})();
