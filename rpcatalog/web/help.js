/* ============================================================
   Help: updates (notice + download + install), feedback / bug reports, "something went wrong" prompt
   Python side: update_ctl.py (notification "update"), feedback.py; the title bar's "?" menu and update badge
   send "feedback-open" / "update-open".
   ============================================================ */
'use strict';

/* Release notes are Markdown from the server: rendered from escaped text, so no HTML from it ever reaches the page.
   Headings, lists, **bold**, *italic*, `code` and https links. */
function mdSafe(md) {
  const inline = s => escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)"'<>]+)\)/g, (m, t, u) => `<a href="${u}">${t}</a>`)
    .replace(/(^|\s)(https:\/\/[^\s<>"']+)/g, (m, sp, u) => `${sp}<a href="${u}">${u}</a>`);
  const out = []; let list = null;
  const endList = () => { if (list) { out.push('<ul>' + list.join('') + '</ul>'); list = null; } };
  for (const raw of String(md || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { endList(); continue; }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) { (list = list || []).push('<li>' + inline(m[1]) + '</li>'); continue; }
    endList();
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) out.push(`<h4 class="md-h">${inline(m[2])}</h4>`);
    else out.push('<p>' + inline(line) + '</p>');
  }
  endList();
  return out.join('');
}
window.mdSafe = mdSafe;

const fmtBytes = n => {
  if (n == null) return '';
  const num = (v, d) => v.toLocaleString(I18N.locale, { minimumFractionDigits: d, maximumFractionDigits: d });   // 1,5 GB in Czech
  return n === 0 ? '0 kB' : n >= 2 ** 30 ? num(n / 2 ** 30, 1) + ' GB' : n >= 2 ** 20 ? num(n / 2 ** 20, 0) + ' MB' : num(Math.max(1, Math.round(n / 1024)), 0) + ' kB';
};
window.fmtBytes = fmtBytes;

/* ---------------- updates ---------------- */
const Updates = {
  st: null,
  subs: new Set(),
  toasted: null,
  init() {
    API.on('update', st => { this.st = st; this.subs.forEach(fn => fn(st)); this.maybeToast(st); });
    API.on('update-open', () => this.open());
    API.call('update.status').then(st => { this.st = st; this.subs.forEach(fn => fn(st)); }).catch(() => null);
  },
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  maybeToast(st) {
    if (st.state !== 'available' || !st.info || this.toasted === st.info.version || $('.backdrop')) return;
    this.toasted = st.info.version;
    toast(tr('{app} {version} is available', { app: tr('Cosmas'), version: st.info.version }), 'ok', { label: tr('Details'), fn: () => this.open() });
  },
  /* the status block (used in the notice and in Settings → General) */
  panel(opts = {}) {
    const box = h('.col.upd', { style: { gap: '10px' } });
    const when = t => t ? new Date(t * 1000).toLocaleString(I18N.locale) : tr('never yet');
    const render = st => {
      if (!box.isConnected && box.dataset.mounted) { off(); return; }
      box.dataset.mounted = '1';
      if (!st) { clear(box).append(h('.small.muted', tr('Loading…'))); return; }
      const info = st.info || {}, dec = st.decision || {};
      const avail = dec.available && ['available', 'downloading', 'ready', 'error'].includes(st.state) && info.version;
      const rows = [];
      rows.push(h('.row.wrap', { style: { gap: '10px', alignItems: 'center' } },
        icon(avail ? 'circle-arrow-down' : st.state === 'checking' ? 'loader' : 'circle-check'),
        h('.grow', avail ? h('b', tr('{app} {version} is available', { app: tr('Cosmas'), version: info.version }))
          : st.state === 'checking' ? tr('Checking for updates…')
          : st.state === 'error' && !avail ? h('span', { style: { color: 'var(--danger)' } }, st.error || tr('Update check failed'))
          : tr('You have the latest version ({version}).', { version: st.current })),
        h('.tiny.faint', tr('Installed: {version}', { version: st.current }))));
      if (avail) {
        const meta = [info.published_at ? new Date(info.published_at).toLocaleDateString(I18N.locale) : null, info.size ? fmtBytes(info.size) : null,
          info.sha256 ? tr('SHA-256 published') : tr('no SHA-256 published')].filter(Boolean).join(' · ');
        rows.push(h('.tiny.faint', meta));
        if (info.notes_md && opts.notes !== false) rows.push(h('.md-notes', { html: mdSafe(info.notes_md) }));
        if (info.notes_url) rows.push(h('a.small', { href: info.notes_url }, tr('Release notes on the web')));
        if (st.dev) rows.push(h('.small.muted', tr('This is a source checkout – update it with git. The installer is only for installed copies.')));
        if (st.state === 'downloading') {
          const [done, total] = st.progress || [0, null];
          const pct = total ? Math.min(100, Math.round(done * 100 / total)) : null;
          rows.push(h('.col', { style: { gap: '4px' } },
            h('.upd-bar', h('div', { style: { width: (pct == null ? 30 : pct) + '%' } })),
            h('.tiny.faint', pct == null ? fmtBytes(done) : `${pct} % · ${fmtBytes(done)} / ${fmtBytes(total)}`)));
        }
        if (st.state === 'error' && st.error) rows.push(h('.small', { style: { color: 'var(--danger)' } }, st.error));
        if (st.state === 'ready') rows.push(h('.small', icon(st.verified ? 'shield-check' : 'shield-alert'), ' ',
          st.verified ? tr('Downloaded and verified (SHA-256 matches).') : tr('Downloaded. No SHA-256 was published for this version, so it could not be verified.')));
        const btns = [];
        if (st.can_install && (st.state === 'available' || st.state === 'error'))
          btns.push(h('button.btn.primary', { onclick: () => API.call('update.download') }, icon('download'), tr('Update now')));
        if (st.state === 'downloading') btns.push(h('button.btn', { onclick: () => API.call('update.cancel') }, icon('x'), tr('Cancel download')));
        if (st.state === 'ready') btns.push(h('button.btn.primary', { onclick: () => this.install() }, icon('refresh-cw'), tr('Restart and install')));
        if (!st.can_install) btns.push(h('a.btn', { href: info.notes_url || st.releases_url }, icon('external-link'), tr('Open the download page')));
        if (st.state !== 'downloading' && st.state !== 'ready')
          btns.push(h('button.btn.ghost', { onclick: () => API.call('update.skip', { version: info.version }) }, tr('Skip this version')));
        rows.push(h('.row.wrap', { style: { gap: '8px' } }, btns));
      } else if (opts.checkButton !== false) {
        rows.push(h('.row.wrap', { style: { gap: '8px', alignItems: 'center' } },
          h('button.btn', { disabled: st.state === 'checking', onclick: () => API.call('update.check') }, icon('refresh-cw'), tr('Check now')),
          h('.tiny.faint', tr('Last check: {when}', { when: when(st.last_check) })),
          st.skip ? h('button.btn.sm.ghost', { onclick: () => API.call('update.skip', { version: '' }) }, tr('Stop skipping {version}', { version: st.skip })) : null));
      }
      // optional support link from the update server – shown only for a real https address
      if (opts.support !== false && typeof st.support_url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(st.support_url.trim()))
        rows.push(h('.row', h('a.btn.sm', { href: st.support_url.trim(), title: tr('Opens in your browser') }, icon('heart'), tr('Support Cosmas'))));
      clear(box).append(rows);
    };
    const off = this.on(render);
    render(this.st);
    if (!this.st) API.call('update.status').then(st => { this.st = st; render(st); }).catch(() => null);
    return box;
  },
  async install() {
    let r = await API.call('update.install').catch(() => null);
    if (r && r.need_confirm) {
      if (!await confirmDialog(tr('Install without verification?'), tr('No SHA-256 checksum was published for this version, so Cosmas cannot check that the downloaded installer is the original. Install it anyway?'), { okLabel: tr('Install anyway') })) return;
      r = await API.call('update.install', { accept_unverified: true }).catch(() => null);
    }
    if (r && r.state === 'ready') toast(tr('Closing and installing the update…'));
  },
  open() {
    modal({ title: tr('Updates'), icon: 'circle-arrow-down', wide: true, body: this.panel(), actions: [{ label: tr('Close') }] });
    if (!this.st || !['available', 'downloading', 'ready'].includes(this.st.state)) API.call('update.check').catch(() => null);
  },
};
window.Updates = Updates;

/* ---------------- feedback / bug report ---------------- */
async function feedbackDialog({ kind = 'bug', message = '', traceback = null } = {}) {
  const shot = await API.call('feedback.snap').catch(() => null);      // before the dialog covers the window
  const kinds = [['bug', 'bug', tr('Bug')], ['idea', 'lightbulb', tr('Idea')], ['question', 'circle-help', tr('Question')], ['other', 'message-square', tr('Other')]];
  let cur = kind;
  const stop = e => e.stopPropagation();
  const kindRow = h('.row.wrap', { style: { gap: '6px' } });
  const renderKinds = () => clear(kindRow).append(kinds.map(([k, ic, label]) => h('span.chip' + (cur === k ? '.on' : ''), { role: 'button', tabindex: '0', 'aria-pressed': String(cur === k),
    onclick: () => { cur = k; renderKinds(); refreshPreview(); }, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } } }, icon(ic), label)));
  // an open preview follows every change of the options and the text
  let preview = null;
  const refreshPreview = debounce(async () => {
    if (!preview || preview.style.display === 'none') return;
    const p = await API.call('feedback.preview', args()).catch(() => null);
    if (p && preview.style.display !== 'none') preview.textContent = p.json;
  }, 300);
  renderKinds();
  const msg = h('textarea.input', { rows: 6, onkeydown: stop, oninput: () => refreshPreview(), placeholder: tr('What happened, what did you expect, how can it be reproduced? Or your idea…') }, message);
  const email = h('input.input', { type: 'email', onkeydown: stop, oninput: () => refreshPreview(), placeholder: tr('optional – only if you want an answer') });
  const chk = (label, on, extra) => { const i = h('input', { type: 'checkbox', checked: on }); return [i, h('label.check', i, label, extra || null)]; };
  // the log is opt-in: it can contain names and paths of recordings
  const [logC, logL] = chk(tr('Attach the log (last 2000 lines). It can contain file names and paths of your recordings; tokens, e-mails and your user folder are removed.'), false);
  const [shotC, shotL] = chk(tr('Attach a screenshot of the app window'), false,
    shot && shot.data ? h('img', { src: shot.data, style: { height: '38px', borderRadius: '4px', marginLeft: '6px', border: '1px solid var(--border)' } }) : null);
  const [sysC, sysL] = chk(tr('Include system info (Windows version, app version, GPU, RAM)'), true);
  if (!shot || !shot.data) { shotC.disabled = true; }
  [logC, shotC, sysC].forEach(c => c.addEventListener('change', () => refreshPreview()));
  preview = h('pre.fb-preview', { style: { display: 'none' } });
  const args = () => ({ kind: cur, message: msg.value, email: email.value.trim(), attach_log: logC.checked, attach_screenshot: shotC.checked,
    include_system: sysC.checked, view: Views.activeName || null, traceback_text: traceback });
  const status = h('.small.muted');
  const body = h('.col', { style: { gap: '12px' } },
    kindRow,
    traceback ? h('.small.faint', icon('bug'), ' ', tr('The error details (traceback, redacted) are attached.')) : null,
    h('label.field', tr('Message'), msg),
    h('label.field', tr('E-mail for an answer'), email),
    h('.col', { style: { gap: '6px' } }, logL, shotL, sysL),
    h('.row', h('button.btn.sm.ghost', { onclick: async () => {
      if (preview.style.display !== 'none') { preview.style.display = 'none'; return; }
      const p = await API.call('feedback.preview', args()).catch(() => null);
      if (p) { preview.textContent = p.json; preview.style.display = ''; }
    } }, icon('eye'), tr('Preview what will be sent'))),
    preview,
    h('.tiny.faint', tr('Sent to gingygames.com. When you are signed in to the web chronicle, the report is linked to your account. Nothing else from your catalogue is sent.')),
    status);
  const m = modal({ title: tr('Send feedback / Report a bug'), icon: 'message-square-warning', wide: true, body, actions: [
    { label: tr('Cancel') },
    { label: tr('Send'), primary: true, onClick: async () => {
      if (!msg.value.trim() && !traceback) { toast(tr('Write a message first.'), 'err'); msg.focus(); return false; }
      status.textContent = tr('Sending…');
      const r = await API.call('feedback.send', args()).catch(() => null);
      status.textContent = '';
      if (!r) return false;
      if (r.status === 'sent') {
        modal({ title: tr('Thank you!'), icon: 'circle-check', body: h('.col', { style: { gap: '8px' } },
          h('div', tr('Your report was sent.')),
          r.id ? h('div', tr('Reference: {id}', { id: '' }), h('b', { style: { userSelect: 'all' } }, r.id)) : null),
          actions: [{ label: tr('Close'), primary: true }] });
      } else toast(tr('You seem to be offline – the report will be sent automatically later.'));
      return true;
    } }] });
  setTimeout(() => msg.focus(), 40);
  return m;
}
window.feedbackDialog = feedbackDialog;

/* ---------------- unexpected errors ---------------- */
let crashBar = null;
function crashPrompt(tb) {
  if (crashBar && crashBar.isConnected) return;
  crashBar = h('.crash-bar', icon('message-square-warning'),
    h('.grow', h('b', tr('Something went wrong.')), ' ', tr('Send a report? It helps fix it.')),
    h('button.btn.sm.primary', { onclick: () => { crashBar.remove(); feedbackDialog({ kind: 'bug', traceback: tb }); } }, tr('Send a report')),
    h('button.btn.sm.ghost', { onclick: () => crashBar.remove() }, tr('Dismiss')));
  document.body.appendChild(crashBar);
  setTimeout(() => crashBar && crashBar.remove(), 60000);
}

/* wired by main.js (main window only, after API.init) */
function initHelp() {
  API.on('feedback-open', () => feedbackDialog());
  API.on('crash', d => crashPrompt(d.traceback));
  /* JS errors of this page go the same way (once per message) */
  const seen = new Set();
  window.addEventListener('error', e => {
    const key = String(e.message || '');
    if (!key || seen.has(key) || /ResizeObserver/.test(key)) return;
    seen.add(key);
    crashPrompt(`${e.message}\n  at ${String(e.filename || '').split('/').pop()}:${e.lineno}:${e.colno}\n${(e.error && e.error.stack) || ''}`);
  });
  Updates.init();
}
window.initHelp = initHelp;
