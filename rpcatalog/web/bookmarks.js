/* ============================================================
   Bookmarks ("moments"): points or ranges (virtual clips) inside a video,
   optionally attached to an event and tagged with characters.
   ============================================================ */
'use strict';

(() => {
const css = `
.bm-row { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 4px; cursor: pointer; transition: background .12s; }
.bm-row:hover { background: var(--hover); }
.bm-row .flag { width: 4px; align-self: stretch; border-radius: 3px; background: var(--bm, var(--accent)); flex: none; }
.bm-row .tc { font: 600 12px var(--font-mono, ui-monospace, monospace); color: var(--text-2); min-width: 62px; }
.bm-row .tc small { display: block; font-weight: 400; color: var(--text-3); font-size: 10.5px; }
.bm-row .ttl { font-weight: 550; }
.bm-row .ttl.untitled { color: var(--text-3); font-style: italic; font-weight: 400; }
.bm-row .note { color: var(--text-3); font-size: 12px; }
.bm-row .acts { display: flex; gap: 2px; opacity: 0; transition: opacity .12s; }
.bm-row:hover .acts { opacity: 1; }
.bm-row .ev { font-size: 11.5px; padding: 1px 8px; border-radius: 99px; background: var(--surface-3); white-space: nowrap; max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.bm-row .ev i { color: var(--evc, var(--accent)); }
.bm-src { font-size: 10.5px; color: var(--text-3); }
.bm-strip { position: relative; height: 22px; border-radius: 7px; background: var(--surface-2); margin: 6px 0 4px; cursor: pointer; overflow: hidden; }
.bm-strip .p { position: absolute; top: 3px; bottom: 3px; width: 3px; margin-left: -1.5px; border-radius: 2px; background: var(--bm, var(--accent)); }
.bm-strip .p.auto { width: 2px; opacity: .45; background: var(--text-3); }
.bm-strip .r { position: absolute; top: 5px; bottom: 5px; border-radius: 4px; background: var(--bm, var(--accent)); opacity: .55; min-width: 4px; }
.bm-strip .p:hover, .bm-strip .r:hover { filter: brightness(1.3); opacity: 1; }
.bm-group { background: var(--surface); border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; }
.bm-group .hd { display: flex; gap: 12px; align-items: center; }
.bm-group .hd .bm-th { position: relative; width: 96px; flex: none; border-radius: 8px; overflow: hidden; }
.bm-group .hd img, .bm-group .hd .noimg { width: 96px; aspect-ratio: 16/9; object-fit: cover; border-radius: 8px; background: var(--surface-3); flex: none; display: grid; place-items: center; color: var(--text-3); }
.bm-ed .kv2 { display: grid; grid-template-columns: 90px 1fr; gap: 10px 12px; align-items: center; }
.bm-ed .k { color: var(--text-3); font-size: 12.5px; }
.bm-ed .tin { width: 110px; font-variant-numeric: tabular-nums; }
.bm-ed .sw { width: 20px; height: 20px; border-radius: 6px; cursor: pointer; border: 2px solid transparent; }
.bm-ed .sw.on { border-color: var(--text); }
.moments .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
`;
document.head.appendChild(h('style', css));

const SRC = { manual: tr('manually'), medal: tr('Medal (hotkey)'), auto: tr('Medal (automatic)') };

/** "1:02:03", "2:03", "75", "1:02.5" -> seconds; null for empty/invalid */
function parseClock(v) {
  v = String(v || '').trim().replace(',', '.');
  if (!v) return null;
  const parts = v.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  return parts.reduce((acc, x) => acc * 60 + x, 0);
}

function bmTitle(b) { return b.title || (b.t_end ? tr('Untitled segment') : tr('Untitled moment')); }
function bmColor(b) { return b.color || b.event_color || (b.source === 'auto' ? 'var(--text-3)' : 'var(--accent)'); }

function playBm(b, popout = false) {
  const pre = b.t_end ? 0 : Number(App.ui.bmPreroll ?? 3);
  return API.call('media.play', { id: b.media_id, offset: Math.max(0, b.t - pre), end: b.t_end || null, popout });
}

async function bmChanged() {
  App.emit('bookmarks');
  await App.refresh('media', 'events');
}

/** Editor modal. Accepts a bookmark object or id. Resolves true when something changed. */
async function bmEditor(bm) {
  const b = typeof bm === 'number' ? await API.call('bm.get', { id: bm }) : bm;
  if (!b) return false;
  return new Promise(resolve => {
    let changed = false;
    const st = { title: b.title || '', note: b.note || '', t: b.t, t_end: b.t_end, color: b.color || '', event_id: b.event_id, chars: [...(b.chars || [])] };
    const playing = () => App.player && App.player.media_id === b.media_id;
    const title = h('input.input', { value: st.title, placeholder: b.t_end ? tr('E.g. Interrogation at the gate') : tr('What happened here?'), autofocus: true });
    const tIn = h('input.input.tin', { value: fmt.clock(st.t) });
    const eIn = h('input.input.tin', { value: st.t_end != null ? fmt.clock(st.t_end) : '', placeholder: tr('end (optional)') });
    const nowBtn = target => h('button.btn.sm.ghost', {
      title: tr('Current player position'), disabled: !playing(),
      onclick: () => { target.value = fmt.clock(App.player.pos); },
    }, icon('locate-fixed'), tr('Now'));
    const note = h('textarea.input', { rows: 5, placeholder: tr('Note – what happened, who said what, context…') }, st.note);
    const evBox = h('.row.wrap');
    const charBox = h('.row.wrap');
    const swBox = h('.row', { style: { gap: '6px' } });
    const renderEv = () => {
      const e = st.event_id && App.eventsById.get(st.event_id);
      clear(evBox).append(
        e ? h('span.chip.on', { onclick: () => App.go('events', { id: e.id }) }, h('span.dot', { style: { background: e.color } }), e.title) : h('span.faint.small', tr('Not assigned')),
        h('button.btn.sm', {
          onclick: async () => {
            const r = await pickEvent({ title: tr('Assign the moment to an event'), moment: b.abs || (b.media && b.media.start ? b.media.start + st.t : null), withNote: false });
            if (r) { st.event_id = r.id; renderEv(); }
          },
        }, icon('link'), e ? tr('Change') : tr('Choose event')),
        e ? h('button.btn.sm.ghost.icon', { title: tr('Remove from event'), onclick: () => { st.event_id = null; renderEv(); } }, icon('x')) : null);
    };
    const renderChars = () => {
      clear(charBox).append(...st.chars.map(id => App.charsById.get(id)).filter(Boolean).map(c =>
        charChip(c, { onRemove: () => { st.chars = st.chars.filter(x => x !== c.id); renderChars(); } })),
      h('button.btn.sm', { onclick: async () => { const ids = await pickCharacters(st.chars, { title: tr('Who is in this moment?') }); if (ids) { st.chars = ids; renderChars(); } } }, icon('user-plus'), tr('Tag characters')));
    };
    const renderSw = () => {
      clear(swBox).append(h('span.sw' + (!st.color ? '.on' : ''), { title: tr('By event'), style: { background: 'repeating-linear-gradient(45deg,#333 0 4px,#555 4px 8px)' }, onclick: () => { st.color = ''; renderSw(); } }),
        ...PALETTE.map(c => h('span.sw' + (st.color === c ? '.on' : ''), { style: { background: c }, onclick: () => { st.color = c; renderSw(); } })));
    };
    renderEv(); renderChars(); renderSw();

    const save = async () => {
      const t = parseClock(tIn.value), te = parseClock(eIn.value);
      if (t == null) { toast(tr('Invalid start time'), 'err'); return false; }
      await API.call('bm.update', { id: b.id, title: title.value.trim(), note: note.value, t, t_end: te,
        color: st.color, event_id: st.event_id || null, chars: st.chars });
      changed = true;
    };
    const m = b.media;
    modal({
      title: b.t_end ? tr('Video segment') : tr('Moment'), icon: 'bookmark', wide: true,
      body: h('.bm-ed.col', { style: { gap: '14px' } },
        m ? h('.row.small.muted', icon('film'), h('span.ellipsis', `${m.name} · ${m.game}`), b.abs ? h('span.faint', '· ' + fmt.dt(b.abs)) : null,
          h('span.bm-src', '· ' + (SRC[b.source] || b.source))) : null,
        title,
        h('.kv2',
          h('.k', tr('Start time')), h('.row', tIn, nowBtn(tIn)),
          h('.k', tr('End time')), h('.row', eIn, nowBtn(eIn), h('span.faint.small', tr('fill it in and the moment becomes a virtual clip'))),
          h('.k', tr('Event')), evBox,
          h('.k', tr('Characters')), charBox,
          h('.k', tr('Color')), swBox),
        note,
        h('.row',
          h('button.btn.sm', { onclick: () => playBm({ ...b, t: parseClock(tIn.value) ?? b.t, t_end: parseClock(eIn.value) }) }, icon('play'), parseClock(eIn.value) ? tr('Play segment') : tr('Play')),
          h('button.btn.sm.ghost', { onclick: () => playBm({ ...b, t: parseClock(tIn.value) ?? b.t, t_end: parseClock(eIn.value) }, true) }, icon('picture-in-picture-2'), tr('In a window')))),
      onClose: () => { if (changed) bmChanged(); resolve(changed); },
      actions: [
        { label: tr('Delete'), danger: true, icon: 'trash-2', onClick: async () => {
          if (!await confirmDialog(tr('Delete the moment?'), b.source === 'manual' ? tr('The moment will be deleted.') : tr('The moment from Medal will be hidden and will not reappear on the next scan.'), { danger: true, okLabel: tr('Delete') })) return false;
          await API.call('bm.delete', { id: b.id }); changed = true;
        } },
        { label: tr('Cancel') },
        { label: tr('Save'), primary: true, icon: 'check', onClick: save },
      ],
    });
    title.addEventListener('keydown', e => { if (e.key === 'Enter') { save().then(r => { if (r !== false) $('.backdrop:last-child .btn.ghost.icon')?.click(); }); } });
  });
}

/** One bookmark row. opts: showMedia, onChange */
function bmRow(b, { showMedia = false, onChange, hideEvent = false } = {}) {
  const ev = b.event_id && App.eventsById.get(b.event_id);
  const edit = async () => { if (await bmEditor(b)) onChange && onChange(); };
  return h('.bm-row', { style: { '--bm': bmColor(b) }, title: tr('Click = play · double-click = edit'), onclick: () => playBm(b), ondblclick: edit },
    h('.flag'),
    h('.tc', fmt.clock(b.t), b.t_end ? h('small', '→ ' + fmt.clock(b.t_end)) : (b.abs ? h('small', fmt.time(b.abs)) : null)),
    h('.grow', { style: { minWidth: 0 } },
      h('.ttl.ellipsis' + (b.title ? '' : '.untitled'), bmTitle(b)),
      showMedia && b.media ? h('.note.ellipsis', `${b.media.name} · ${b.media.game}`) : (b.note ? h('.note.ellipsis', b.note) : null)),
    window.ptagChips ? ptagChips(b.tags) : null,
    b.chars && b.chars.length ? avatarStack(b.chars, 20, 3) : null,
    ev && !hideEvent ? h('span.ev', { style: { '--evc': ev.color }, onclick: e => { e.stopPropagation(); App.go('events', { id: ev.id, tab: 'media' }); } }, icon('calendar-range'), ' ', ev.title) : null,
    h('.acts',
      !ev ? h('button.btn.sm.ghost.icon', { title: tr('Assign to event'), onclick: async e => {
        e.stopPropagation();
        const r = await pickEvent({ title: tr('Assign the moment to an event'), moment: b.abs, withNote: false });
        if (r) { await API.call('bm.update', { id: b.id, event_id: r.id }); toast(tr('Assigned to event')); await bmChanged(); onChange && onChange(); }
      } }, icon('link')) : null,
      window.shareButton ? shareButton('bookmark', b.id, { compact: true }) : null,
      h('button.btn.sm.ghost.icon', { title: tr('Edit'), onclick: e => { e.stopPropagation(); edit(); } }, icon('pencil'))));
}

/** Clickable mini timeline of a video's bookmarks. */
function bmStrip(media, bms, { onChange } = {}) {
  const dur = media.duration || 1;
  const strip = h('.bm-strip', { title: tr('Click = play from this point') });
  strip.addEventListener('click', e => {
    if (e.target !== strip) return;
    const r = strip.getBoundingClientRect();
    API.call('media.play', { id: media.id, offset: (e.clientX - r.left) / r.width * dur });
  });
  for (const b of bms) {
    const left = (b.t / dur * 100) + '%';
    const tip = `${fmt.clock(b.t)}${b.t_end ? '–' + fmt.clock(b.t_end) : ''}  ${bmTitle(b)}`;
    const on = { title: tip, style: { left, '--bm': bmColor(b) }, onclick: e => { e.stopPropagation(); playBm(b); },
      ondblclick: async e => { e.stopPropagation(); if (await bmEditor(b.id)) onChange && onChange(); } };
    if (b.t_end) strip.appendChild(h('.r', { ...on, style: { ...on.style, width: ((b.t_end - b.t) / dur * 100) + '%' } }));
    else strip.appendChild(h('.p' + (b.source === 'auto' && !b.event_id ? '.auto' : ''), on));
  }
  return strip;
}

/** Add a bookmark at the current player position of `media` (or 0). */
async function addBookmarkHere(mediaId, { range = false } = {}) {
  const pos = App.player && App.player.media_id === mediaId ? App.player.pos : 0;
  const id = await API.call('bm.create', { media_id: mediaId, t: pos, t_end: range ? pos + 30 : null });
  await bmChanged();
  return bmEditor(id);
}

Object.assign(window, { parseClock, bmTitle, bmColor, playBm, bmEditor, bmRow, bmStrip, bmChanged, addBookmarkHere });

/* ---------------- "Momenty" view ---------------- */
let root, unsub = [];
const F = { q: '', game: '', state: 'all', auto: false };

async function render() {
  if (!root) return;
  const all = await API.call('bm.list', { include_auto: F.auto });
  const q = F.q.toLowerCase();
  const list = all.filter(b => inScope(App.mediaById.get(b.media_id), 'media') && (!F.game || b.media?.game === F.game)
    && (F.state === 'all' || (F.state === 'free' ? !b.event_id : !!b.event_id))
    && (!q || `${b.title} ${b.note} ${b.event_title || ''} ${b.media?.name || ''}`.toLowerCase().includes(q)));
  const groups = new Map();
  for (const b of list) { if (!groups.has(b.media_id)) groups.set(b.media_id, []); groups.get(b.media_id).push(b); }
  const ordered = [...groups.values()].sort((a, b) => (b[0].media.start || 0) - (a[0].media.start || 0));
  const games = [...new Set(all.map(b => b.media?.game).filter(Boolean))].sort();
  const free = all.filter(b => !b.event_id).length;

  const body = $('.mom-body', root);
  clear(body);
  const tb = $('.toolbar', root);
  clear(tb).append(
    h('input.input', { placeholder: tr('Search moments…'), value: F.q, style: { width: '240px' }, oninput: debounce(e => { F.q = e.target.value; render(); }, 250) }),
    h('.seg', [['all', tr('All')], ['free', tr('Unassigned') + (free ? ' (' + free + ')' : '')], ['linked', tr('In events')]].map(([k, l]) =>
      h('button' + (F.state === k ? '.on' : ''), { onclick: () => { F.state = k; render(); } }, l))),
    h('select.input', { style: { width: 'auto' }, onchange: e => { F.game = e.target.value; render(); } },
      h('option', { value: '' }, tr('All games')), games.map(g => h('option', { value: g, selected: g === F.game }, g))),
    h('label.row.small.muted', { style: { gap: '6px', cursor: 'pointer' } },
      h('input', { type: 'checkbox', checked: F.auto, onchange: e => { F.auto = e.target.checked; render(); } }), tr('include automatic game moments')));

  if (!ordered.length) {
    body.appendChild(emptyState('bookmark', tr('No moments yet'),
      tr('While playing, press B (moment) or Shift+B at the start and end of a segment. Moments you mark in Medal with the hotkey are loaded automatically.')));
    return;
  }
  for (const bms of ordered) {
    const m = bms[0].media;
    const full = App.mediaById.get(m.id);
    body.appendChild(h('.bm-group',
      h('.hd',
        h('.bm-th', { 'data-rmid': m.id }, m.thumb ? h('img', { src: m.thumb, loading: 'lazy' }) : h('.noimg', icon('film')), resumeBar(full || m)),
        h('.grow', { style: { minWidth: 0 } },
          h('.ellipsis', { style: { fontWeight: 600 } }, m.name),
          h('.small.muted', `${m.game} · ${fmt.dt(m.start)} · ${fmt.dur(m.duration)} · ${trn(bms.length, '{n} moment', '{n} moments')}`)),
        h('button.btn.sm', { onclick: () => addBookmarkHere(m.id).then(render) }, icon('bookmark-plus'), tr('Add')),
        h('button.btn.sm.ghost.icon', { title: tr('Show in library'), onclick: () => App.go('library', { select: [m.id] }) }, icon('clapperboard'))),
      bmStrip(full || m, bms, { onChange: render }),
      h('div', bms.map(b => bmRow(b, { onChange: render })))));
  }
}

Views.register('moments', {
  title: tr('Moments'), short: tr('Moments'), icon: 'bookmark', order: 15,
  mount(el, params = {}) {
    root = el;
    F.game = params.game || '';
    el.append(h('.moments.page', { style: { padding: '16px 24px', overflow: 'auto', height: '100%' } },
      h('.toolbar', { style: { padding: 0 } }), h('.mom-body')));
    Shell.header({ icon: 'bookmark', title: tr('moments'), topic: tr('B = moment · Shift+B = segment start and end · double-click = edit') });
    unsub = [App.on('bookmarks', render), App.on('events', render)];
    render();
  },
  unmount() { unsub.forEach(f => f()); unsub = []; root = null; },
});
})();
