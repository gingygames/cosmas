/* ============================================================
   Rich text editor (contenteditable) with @mentions and pasted images
   RichEditor({ html, placeholder, ownerType, ownerId, onChange(html), minHeight, autofocus })
     -> { el, getHTML(), setHTML(html), focus() }
   renderRich(html) -> read-only node with clickable mentions
   ============================================================ */
'use strict';

const EDITOR_CSS = `
.rte { border: 1px solid var(--border); border-radius: 12px; background: var(--bg-2); transition: border-color .15s; }
.rte:focus-within { border-color: rgba(227,179,65,.45); }
.rte .tb { display: flex; flex-wrap: wrap; gap: 2px; padding: 5px; border-bottom: 1px solid var(--border);
  position: sticky; top: 0; background: var(--bg-2); border-radius: 12px 12px 0 0; z-index: 2; }
.rte .tb button { height: 28px; min-width: 28px; padding: 0 6px; border: 0; border-radius: 7px; background: none;
  color: var(--text-2); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; font-size: 12px; }
.rte .tb button:hover { background: var(--hover); color: var(--text); }
.rte .tb .sp { width: 1px; background: var(--border); margin: 4px 3px; }
.rte .area { padding: 14px 18px; outline: none; min-height: 120px; }
.rte .area:empty::before { content: attr(data-ph); color: var(--text-3); pointer-events: none; }
.prose { font-size: 14.5px; line-height: 1.65; color: var(--text); word-wrap: break-word; }
.prose h2 { font: 600 19px/1.3 var(--font-display); margin: 18px 0 6px; }
.prose h3 { font: 600 16px/1.3 var(--font-display); margin: 14px 0 4px; color: var(--accent-2); }
.prose p { margin: 0 0 8px; }
.prose ul, .prose ol { margin: 4px 0 10px; padding-left: 24px; }
.prose blockquote { margin: 10px 0; padding: 6px 14px; border-left: 3px solid var(--accent); background: var(--accent-soft);
  border-radius: 0 8px 8px 0; font-family: var(--serif); font-style: italic; color: #efe3c4; }
.prose hr { border: 0; border-top: 1px dashed var(--border-2); margin: 16px 0; }
.prose img { max-width: 100%; border-radius: 10px; margin: 6px 0; display: block; cursor: zoom-in; box-shadow: var(--shadow-sm); }
.prose a { color: var(--accent); }
.prose .mention { display: inline-flex; align-items: center; gap: 4px; padding: 0 7px 0 6px; border-radius: 99px;
  background: rgba(90,169,230,.16); color: #9dd0f5; font-weight: 600; font-size: .93em; cursor: pointer; white-space: nowrap; }
.prose .mention::before { content: '@'; opacity: .55; }
.prose .stamp { display: inline-block; padding: 0 7px; border-radius: 6px; background: var(--surface-3); color: var(--text-2);
  font-size: .85em; font-variant-numeric: tabular-nums; }
.prose .callout { padding: 10px 14px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); margin: 10px 0; }
.mention-pop { position: fixed; z-index: 250; width: 260px; max-height: 280px; overflow: auto; padding: 5px;
  background: var(--surface-2); border: 1px solid var(--border-2); border-radius: 11px; box-shadow: var(--shadow); }
.mention-pop .list-row { padding: 6px 8px; }
.mention-pop .list-row.on { background: var(--accent-soft); }
`;
(() => { const s = document.createElement('style'); s.textContent = EDITOR_CSS; document.head.appendChild(s); })();

function mentionHTML(c) {
  return `<span class="mention" contenteditable="false" data-char-id="${c.id}">${escapeHtml(c.name)}</span>&nbsp;`;
}

function wireRich(root) {
  root.querySelectorAll('.mention[data-char-id]').forEach(m => {
    const c = App.charsById.get(Number(m.dataset.charId));
    if (c) { m.textContent = c.name; m.title = c.summary || c.name; }
    m.onclick = e => { e.preventDefault(); e.stopPropagation(); App.go('characters', { id: Number(m.dataset.charId) }); };
  });
  const imgs = [...root.querySelectorAll('img')];
  imgs.forEach((img, i) => {
    img.ondblclick = img.onclick = e => {
      if (root.isContentEditable && e.type === 'click') return;
      lightbox(imgs.map(x => ({ id: Number(x.dataset.att) || 0, url: x.src, caption: x.alt })), i);
    };
  });
}

function renderRich(html) {
  const el = h('.prose', { html: html || '' });
  el.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
  wireRich(el);
  return el;
}

function RichEditor({ html = '', placeholder = 'Piš…', ownerType = null, ownerId = null, onChange, minHeight = 160, autofocus = false } = {}) {
  const area = h('.area.prose', { contenteditable: 'true', 'data-ph': placeholder, spellcheck: 'true', style: { minHeight: minHeight + 'px' } });
  area.innerHTML = html || '';
  const changed = debounce(() => onChange && onChange(getHTML()), 700);
  const exec = (cmd, val = null) => { area.focus(); document.execCommand(cmd, false, val); changed(); };
  const block = tag => exec('formatBlock', tag);

  const tb = h('.tb',
    btn('bold', 'Tučně (Ctrl+B)', () => exec('bold')),
    btn('italic', 'Kurzíva (Ctrl+I)', () => exec('italic')),
    btn('underline', 'Podtržení (Ctrl+U)', () => exec('underline')),
    btn('strikethrough', 'Přeškrtnutí', () => exec('strikeThrough')),
    h('.sp'),
    btn('heading-2', 'Nadpis', () => block('h2')),
    btn('heading-3', 'Podnadpis', () => block('h3')),
    btn('pilcrow', 'Odstavec', () => block('p')),
    btn('quote', 'Citace / promluva', () => block('blockquote')),
    btn('list', 'Odrážky', () => exec('insertUnorderedList')),
    btn('list-ordered', 'Číslovaný seznam', () => exec('insertOrderedList')),
    btn('minus', 'Oddělovač', () => exec('insertHTML', '<hr><p><br></p>')),
    h('.sp'),
    btn('at-sign', 'Označit postavu (@)', () => openMentions(true), 'Postava'),
    btn('calendar-clock', 'Vložit datum a čas', () => insertStamp(), 'Datum'),
    btn('link', 'Odkaz', async () => {
      const sel = saveSel();
      const url = await promptDialog('Odkaz', 'Adresa (https://…)', 'https://');
      restoreSel(sel); if (url) exec('createLink', url);
    }),
    ownerType ? btn('image-plus', 'Vložit obrázek ze souboru', async () => {
      const sel = saveSel();
      const atts = await API.call('att.pick', { owner_type: ownerType, owner_id: ownerId, images_only: true });
      restoreSel(sel); atts.forEach(insertImage);
    }) : null,
    ownerType ? btn('camera', 'Snímek z přehrávače', async () => {
      const sel = saveSel();
      const a = await API.call('att.snapshot', { owner_type: ownerType, owner_id: ownerId });
      restoreSel(sel); insertImage(a);
    }) : null,
    h('.grow'),
    btn('eraser', 'Vymazat formátování', () => exec('removeFormat')),
  );
  function btn(ic, title, fn, label) {
    return h('button', { title, onmousedown: e => e.preventDefault(), onclick: fn, type: 'button' }, icon(ic), label ? h('span', label) : null);
  }

  function insertImage(a) {
    if (!a) return;
    exec('insertHTML', `<img src="${a.url}" data-att="${a.id}" alt="${escapeHtml(a.caption || a.orig_name || '')}"><p><br></p>`);
    wireRich(area);
  }
  function insertStamp() {
    const d = new Date();
    const txt = `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    exec('insertHTML', `<span class="stamp" contenteditable="false">${txt}</span>&nbsp;`);
  }
  let savedRange = null;
  function saveSel() { const s = getSelection(); return s.rangeCount ? s.getRangeAt(0).cloneRange() : null; }
  function restoreSel(r) { if (!r) { area.focus(); return; } area.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }

  /* ---- @mentions ---- */
  let pop = null, popIdx = 0, popItems = [], mentionStart = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } mentionStart = null; }
  function openMentions(fromButton) {
    area.focus();
    if (fromButton) { document.execCommand('insertText', false, '@'); }
    const s = getSelection(); if (!s.rangeCount) return;
    const r = s.getRangeAt(0);
    mentionStart = { node: r.startContainer, offset: r.startOffset - 1 };
    showPop('');
  }
  function currentQuery() {
    if (!mentionStart) return null;
    const s = getSelection(); if (!s.rangeCount) return null;
    const r = s.getRangeAt(0);
    if (r.startContainer !== mentionStart.node) return null;
    const text = r.startContainer.textContent.slice(mentionStart.offset, r.startOffset);
    if (!text.startsWith('@') || /\s{2}|\n/.test(text) || text.length > 40) return null;
    return text.slice(1);
  }
  function showPop(q) {
    const term = q.toLowerCase();
    popItems = App.chars.filter(c => !term || (c.name + ' ' + (c.aliases || '')).toLowerCase().includes(term)).slice(0, 8);
    const createItem = q.trim() ? { create: q.trim() } : null;
    if (!pop) { pop = h('.mention-pop'); overlayRoot().appendChild(pop); }
    clear(pop); popIdx = Math.min(popIdx, popItems.length + (createItem ? 1 : 0) - 1); if (popIdx < 0) popIdx = 0;
    popItems.forEach((c, i) => pop.appendChild(h('.list-row' + (i === popIdx ? '.on' : ''), { onmousedown: e => { e.preventDefault(); choose(c); } },
      avatar(c, 24), h('.grow.ellipsis', c.name), h('.tiny.faint', c.faction || ''))));
    if (createItem) pop.appendChild(h('.list-row' + (popIdx === popItems.length ? '.on' : ''), { onmousedown: e => { e.preventDefault(); choose(createItem); } },
      icon('user-plus'), h('span', 'Nová postava „', h('b', createItem.create), '“')));
    if (!pop.children.length) pop.appendChild(h('.tiny.faint', { style: { padding: '8px' } }, 'Napiš jméno postavy…'));
    const s = getSelection();
    if (s.rangeCount) {
      const rect = s.getRangeAt(0).getBoundingClientRect();
      pop.style.left = Math.min(rect.left, innerWidth - 270) + 'px';
      pop.style.top = (rect.bottom + 6 + 290 > innerHeight ? rect.top - 290 : rect.bottom + 6) + 'px';
    }
  }
  async function choose(item) {
    let c = item;
    if (item.create) {
      const id = await API.call('char.create', { name: item.create });
      await App.loadChars();
      c = App.charsById.get(id);
    }
    const s = getSelection();
    if (mentionStart && s.rangeCount) {
      const r = s.getRangeAt(0);
      const del = document.createRange();
      del.setStart(mentionStart.node, mentionStart.offset); del.setEnd(r.startContainer, r.startOffset);
      s.removeAllRanges(); s.addRange(del);
    }
    closePop();
    document.execCommand('insertHTML', false, mentionHTML(c));
    wireRich(area); changed();
  }

  area.addEventListener('keydown', e => {
    if (pop) {
      const n = popItems.length + (currentQuery() ? 1 : 0);
      if (e.key === 'ArrowDown') { e.preventDefault(); popIdx = (popIdx + 1) % Math.max(1, n); showPop(currentQuery() || ''); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); popIdx = (popIdx - 1 + n) % Math.max(1, n); showPop(currentQuery() || ''); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const q = currentQuery() || '';
        if (popIdx < popItems.length) choose(popItems[popIdx]); else if (q.trim()) choose({ create: q.trim() });
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); return; }
    }
    if (e.key === '@') setTimeout(() => openMentions(false), 0);
    e.stopPropagation(); // keep global shortcuts (space = pause) away while typing
  });
  area.addEventListener('input', () => {
    if (mentionStart) { const q = currentQuery(); if (q === null) closePop(); else showPop(q); }
    changed();
  });
  area.addEventListener('blur', () => setTimeout(() => { if (!area.contains(document.activeElement)) closePop(); changed.flush && changed.flush(); }, 150));

  /* paste / drop images */
  async function handleFiles(files, e) {
    const imgs = [...files].filter(f => f.type.startsWith('image/'));
    if (!imgs.length || !ownerType) return false;
    e.preventDefault();
    for (const a of await uploadFiles(ownerType, ownerId, imgs)) insertImage(a);
    toast(`Vloženo ${imgs.length} ${fmt.plural(imgs.length, 'obrázek', 'obrázky', 'obrázků')}`);
    return true;
  }
  area.addEventListener('paste', async e => {
    if (e.clipboardData.files.length && await handleFiles(e.clipboardData.files, e)) return;
    // paste plain text to keep styling consistent
    const text = e.clipboardData.getData('text/plain');
    if (text && !e.clipboardData.getData('text/html').includes('data-char-id')) {
      e.preventDefault();
      document.execCommand('insertText', false, text);
    }
  });
  area.addEventListener('drop', e => { if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files, e); });

  wireRich(area);
  const el = h('.rte', tb, area);
  if (autofocus) setTimeout(() => area.focus(), 50);
  function getHTML() {
    const clone = area.cloneNode(true);
    const out = clone.innerHTML.replace(/<p><br><\/p>$/, '').trim();
    return out === '<br>' ? '' : out;
  }
  return {
    el, area,
    getHTML,
    setHTML(v) { area.innerHTML = v || ''; wireRich(area); },
    focus() { area.focus(); },
    flush() { changed.flush && changed.flush(); },
  };
}
