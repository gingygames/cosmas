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

/* ---- sanitizer: stored and pasted rich text (it can come from the web) never reaches the page unfiltered.
   Same rules as the web server (kronikar-web src/sanitize.js) plus the desktop's file: attachment images. ---- */
const RICH_KEEP = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li',
  'blockquote', 'a', 'span', 'img', 'hr', 'code', 'pre', 'div', 'figure', 'figcaption', 'sub', 'sup', 'mark',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'font']);
// removed together with their content (the parser reads some of them as plain text – unwrapping would make it live HTML)
const RICH_DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select',
  'link', 'meta', 'base', 'svg', 'math', 'template', 'noscript', 'frame', 'frameset', 'video', 'audio', 'source',
  'xmp', 'noembed', 'noframes', 'title', 'plaintext', 'listing', 'head', 'param', 'applet', 'portal', 'dialog']);
const RICH_STYLE_OK = /^(color|background-color|text-align|font-weight|font-style|text-decoration|font-size)$/;
const richStyle = v => String(v || '').split(';').map(d => d.trim()).filter(d => {
  const [p, ...rest] = d.split(':');
  const val = rest.join(':').toLowerCase();
  return RICH_STYLE_OK.test((p || '').trim().toLowerCase()) && val && !/url\(|expression|javascript:|@import|\\/.test(val);
}).join('; ');
const richHref = v => /^(https?:\/\/|mailto:|\/kosmas\/|\/kronika\/|#)/i.test(String(v || '').trim());
// images: the web's /kosmas/img/<key>, https, and attachments of the desktop app (file:///…, see api.file_url)
const richSrc = v => /^(\/(?:kosmas|kronika)\/img\/[A-Za-z0-9._-]+|https:\/\/[^\s"'<>]+|file:\/\/\/[^"<>]+)$/i.test(String(v || '').trim());

function sanitizeRich(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString('<!doctype html><html><head></head><body>' + String(html) + '</body></html>', 'text/html');
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const clean = parent => {
    for (const n of [...parent.childNodes]) {
      if (n.nodeType === Node.TEXT_NODE) continue;
      if (n.nodeType !== Node.ELEMENT_NODE) { n.remove(); continue; }          // comments, processing instructions
      const tag = n.localName;
      if (n.namespaceURI !== XHTML || RICH_DROP.has(tag)) { n.remove(); continue; }
      clean(n);
      if (!RICH_KEEP.has(tag)) { n.replaceWith(...n.childNodes); continue; }  // unknown tag: keep its (clean) content
      for (const { name, value } of [...n.attributes]) {
        const a = name.toLowerCase();
        let keep = false;
        if (a === 'style') { const s = richStyle(value); if (s) { n.setAttribute('style', s); keep = true; } }
        else if (a === 'class') keep = /^[\w\s-]{0,120}$/.test(value);
        else if (a === 'data-char-id' || (tag === 'img' && a === 'data-att')) keep = /^\d+$/.test(value);
        else if (a === 'data-ingame') keep = true;
        else if (a === 'contenteditable') keep = tag === 'span' && value === 'false';
        else if (tag === 'a') keep = (a === 'href' && richHref(value)) || a === 'title' || (a === 'target' && value === '_blank');
        else if (tag === 'img') keep = (a === 'src' && richSrc(value)) || a === 'alt' || a === 'title' || ((a === 'width' || a === 'height') && /^\d{1,4}%?$/.test(value));
        else if (tag === 'td' || tag === 'th') keep = (a === 'colspan' || a === 'rowspan') && /^\d{1,2}$/.test(value);
        else if (tag === 'font') keep = a === 'color' && /^#?\w{3,20}$/.test(value);
        if (!keep) n.removeAttribute(name);
      }
      if (tag === 'img' && !n.hasAttribute('src')) n.remove();
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}
window.sanitizeRich = sanitizeRich;

/* editors with a change still waiting for the debounce; flushEditors() saves them now (before switching records) */
const _dirtyEditors = new Set();
function flushEditors() { [..._dirtyEditors].forEach(f => f()); }
window.flushEditors = flushEditors;

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
  const el = h('.prose', { html: sanitizeRich(html) });
  el.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
  wireRich(el);
  return el;
}

function RichEditor({ html = '', placeholder = tr('Write…'), ownerType = null, ownerId = null, onChange, minHeight = 160, autofocus = false } = {}) {
  const area = h('.area.prose', { contenteditable: 'true', 'data-ph': placeholder, spellcheck: 'true', style: { minHeight: minHeight + 'px' } });
  area.innerHTML = sanitizeRich(html);
  // onChange only gets HTML that differs from the last saved value; the record it belongs to is fixed by the
  // caller's closure, so a late (debounced or blur) save can never land in another record
  let lastSaved = null;
  const fire = () => {
    _dirtyEditors.delete(flushNow);
    const v = getHTML();
    if (v === lastSaved) return;
    lastSaved = v;
    onChange && onChange(v);
  };
  const pending = debounce(fire, 700);
  const flushNow = () => pending.flush();
  const changed = () => { _dirtyEditors.add(flushNow); pending(); };
  changed.flush = flushNow;
  const exec = (cmd, val = null) => { area.focus(); document.execCommand(cmd, false, val); changed(); };
  const block = tag => exec('formatBlock', tag);

  const tb = h('.tb',
    btn('bold', tr('Bold (Ctrl+B)'), () => exec('bold')),
    btn('italic', tr('Italic (Ctrl+I)'), () => exec('italic')),
    btn('underline', tr('Underline (Ctrl+U)'), () => exec('underline')),
    btn('strikethrough', tr('Strikethrough'), () => exec('strikeThrough')),
    h('.sp'),
    btn('heading-2', tr('Heading'), () => block('h2')),
    btn('heading-3', tr('Subheading'), () => block('h3')),
    btn('pilcrow', tr('Paragraph'), () => block('p')),
    btn('quote', tr('Quote / speech'), () => block('blockquote')),
    btn('list', tr('Bullet list'), () => exec('insertUnorderedList')),
    btn('list-ordered', tr('Numbered list'), () => exec('insertOrderedList')),
    btn('minus', tr('Divider'), () => exec('insertHTML', '<hr><p><br></p>')),
    h('.sp'),
    btn('at-sign', tr('Tag a character (@)'), () => openMentions(true), tr('Character')),
    btn('calendar-clock', tr('Insert date and time'), () => insertStamp(), tr('Date')),
    btn('link', tr('Link'), async () => {
      const sel = saveSel();
      const url = await promptDialog(tr('Link'), tr('Address (https://…)'), 'https://');
      restoreSel(sel); if (url) exec('createLink', url);
    }),
    ownerType ? btn('image-plus', tr('Insert image from file'), async () => {
      const sel = saveSel();
      const atts = await API.call('att.pick', { owner_type: ownerType, owner_id: ownerId, images_only: true });
      restoreSel(sel); atts.forEach(insertImage);
    }) : null,
    ownerType ? btn('camera', tr('Screenshot from the player'), async () => {
      const sel = saveSel();
      const a = await API.call('att.snapshot', { owner_type: ownerType, owner_id: ownerId });
      restoreSel(sel); insertImage(a);
    }) : null,
    h('.grow'),
    btn('eraser', tr('Clear formatting'), () => exec('removeFormat')),
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
    const day = I18N.lang === 'cs' ? `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}` : d.toLocaleDateString(I18N.locale, { day: 'numeric', month: 'short', year: 'numeric' });
    const txt = `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
      icon('user-plus'), h('span', { html: tr('New character “{name}”', { name: '<b>' + escapeHtml(createItem.create) + '</b>' }) })));
    if (!pop.children.length) pop.appendChild(h('.tiny.faint', { style: { padding: '8px' } }, tr('Type a character name…')));
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
  area.addEventListener('blur', () => setTimeout(() => { if (!area.contains(document.activeElement)) closePop(); changed.flush(); }, 150));

  /* paste / drop images */
  async function handleFiles(files, e) {
    const imgs = [...files].filter(f => f.type.startsWith('image/'));
    if (!imgs.length || !ownerType) return false;
    e.preventDefault();
    for (const a of await uploadFiles(ownerType, ownerId, imgs)) insertImage(a);
    toast(trn(imgs.length, 'Inserted {n} image', 'Inserted {n} images'));
    return true;
  }
  area.addEventListener('paste', async e => {
    if (e.clipboardData.files.length && await handleFiles(e.clipboardData.files, e)) return;
    const html = e.clipboardData.getData('text/html');
    // rich text copied from an editor (with character mentions) keeps its formatting – filtered first
    if (html && html.includes('data-char-id')) {
      e.preventDefault();
      document.execCommand('insertHTML', false, sanitizeRich(html));
      wireRich(area); changed();
      return;
    }
    // anything else is pasted as plain text to keep styling consistent
    const text = e.clipboardData.getData('text/plain');
    if (text) { e.preventDefault(); document.execCommand('insertText', false, text); }
    else if (html) { e.preventDefault(); document.execCommand('insertHTML', false, sanitizeRich(html)); wireRich(area); changed(); }
  });
  // text dragged in from outside (another page or app) goes through the same filter; moving text inside stays native
  let dragInside = false;
  area.addEventListener('dragstart', () => { dragInside = true; });
  area.addEventListener('dragend', () => { dragInside = false; });
  area.addEventListener('drop', e => {
    if (e.dataTransfer.files.length) { handleFiles(e.dataTransfer.files, e); return; }
    if (dragInside) return;
    const html = e.dataTransfer.getData('text/html'), text = e.dataTransfer.getData('text/plain');
    if (!html && !text) return;
    e.preventDefault();
    const r = document.caretRangeFromPoint && document.caretRangeFromPoint(e.clientX, e.clientY);
    area.focus();
    if (r && area.contains(r.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    if (html && html.includes('data-char-id')) document.execCommand('insertHTML', false, sanitizeRich(html));
    else if (text) document.execCommand('insertText', false, text);
    wireRich(area); changed();
  });

  wireRich(area);
  lastSaved = getHTML();
  const el = h('.rte', tb, area);
  if (autofocus) setTimeout(() => area.focus(), 50);
  function getHTML() {
    const out = sanitizeRich(area.innerHTML).replace(/<p><br><\/p>$/, '').trim();
    return out === '<br>' ? '' : out;
  }
  return {
    el, area,
    getHTML,
    setHTML(v) { flushNow(); area.innerHTML = sanitizeRich(v); wireRich(area); lastSaved = getHTML(); },
    focus() { area.focus(); },
    flush() { flushNow(); },
  };
}
