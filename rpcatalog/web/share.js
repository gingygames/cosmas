/* ============================================================
   Share – one button on a character, faction, place, event or moment.
   The same file runs in the desktop app and in the web workspace (kronikar-web/public/kosmas/app/share.js – keep identical).
   Backend (API.call):
     share.get    {kind, id}              → info
     share.set    {kind, id, visibility}  → info   (desktop: publishes the record first when it isn't on the web yet)
     share.rotate {kind, id}              → info   (new link, the old /kosmas/k/… stops working)
   info: {kind, id, title, via, desktop, signed_in, published, visibility: private|link|public, share_url, discord_use?}
   kind: character | faction | place | event | bookmark (a moment is shared together with its video, via = {type, title})
   ============================================================ */
'use strict';

(() => {
document.head.appendChild(h('style', `
.share-panel { display: flex; flex-direction: column; gap: 12px; min-width: min(420px, 100%); }
.share-panel .seg { display: flex; flex-wrap: wrap; }
.share-panel .seg button { flex: 1 1 auto; height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.share-panel .seg button[disabled] { opacity: .55; cursor: default; }
.share-panel .what { font-weight: 600; font-size: 14px; }
.share-panel .url { display: flex; gap: 6px; }
.share-panel .url .input { flex: 1; min-width: 0; font: 12.5px ui-monospace, monospace; }
.share-panel .acts { display: flex; flex-wrap: wrap; gap: 6px; }
.share-panel .busy { display: flex; align-items: center; gap: 8px; }
.share-panel .busy i { animation: share-spin 1s linear infinite; }
@keyframes share-spin { to { transform: rotate(360deg); } }
.share-panel .err { color: var(--danger); }
.share-panel .note { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); }
.share-panel .note > i { margin-top: 2px; flex: none; }
`));

const VIS = [['private', 'lock', tr('Only me')], ['link', 'link-2', tr('Anyone with the link')], ['public', 'globe', tr('Public')]];
const VIS_HINT = {
  private: tr('Only you can see it.'),
  link: tr('Anyone who has the link can open it. It is not listed in the public chronicle.'),
  public: tr('Listed in the public chronicle – anyone can find it.'),
};

/** Copies text; falls back to a hidden textarea where the Clipboard API is not allowed (desktop app). */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fallback below */ }
  const ta = h('textarea', { style: { position: 'fixed', opacity: '0', top: '0', left: '0' } }, text);
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

/* A character with "Use on Discord" shared via link or public gets a card (with the link) in the community Discord. */
function usesDiscord(kind, id, info) {
  if (kind !== 'character') return false;
  if (info && info.discord_use != null) return !!info.discord_use;
  const c = typeof App !== 'undefined' && App.charsById && App.charsById.get(Number(id));
  return !!(c && c.discord_use);
}

function openShare(kind, id) {
  const body = h('.share-panel');
  let info = null, busy = '', progress = '', err = '', timer = null, closed = false;
  modal({ title: tr('Share'), icon: 'share-2', body, onClose: () => { closed = true; clearTimeout(timer); } });

  const load = async () => {
    err = '';
    try { info = await API.call('share.get', { kind, id }); } catch (e) { err = String(e); }
    render();
  };
  // desktop: while a sync publishes the record, show its progress
  const poll = async () => {
    clearTimeout(timer);
    if (closed || !busy || !info || !info.desktop) return;
    const st = await API.call('sync.status').catch(() => null);
    if (st && busy) { progress = st.progress || ''; render(); }
    timer = setTimeout(poll, 700);
  };
  const run = async (label, method, args) => {
    if (busy) return;
    busy = label; progress = ''; err = ''; render(); poll();
    try { info = await API.call(method, { kind, id, ...args }); document.dispatchEvent(new CustomEvent('kosmas-share', { detail: info })); }
    catch (e) { err = String(e); }
    busy = ''; progress = ''; clearTimeout(timer);
    if (!closed) render();
  };
  const setVis = v => {
    if (!info || v === info.visibility) return;
    run(!info.published && v !== 'private' ? tr('Publishing to the web…') : tr('Saving…'), 'share.set', { visibility: v });
  };
  const copy = async (msg = tr('Link copied')) => {
    if (await copyText(info.share_url)) toast(msg);
    else promptDialog(tr('Copy the link'), tr('Link'), info.share_url);
  };

  function render() {
    if (closed) return;
    clear(body);
    if (!info) { body.append(err ? h('.small.err', err) : h('.small.muted.busy', icon('loader'), tr('Loading…'))); return; }
    const what = h('.what.ellipsis', info.title || tr('Untitled'));
    if (!info.signed_in) {
      body.append(what,
        h('.small.muted', tr('Sharing works through the web chronicle. Sign in with Discord – sharing then syncs your whole catalogue to your private web chronicle, and only what you share is visible to others.')),
        h('div', h('button.btn.primary', { onclick: async () => { if (window.webSignIn && await window.webSignIn()) load(); } }, icon('log-in'), tr('Sign in with Discord'))));
      return;
    }
    const vis = info.visibility || 'private';
    const discord = usesDiscord(kind, id, info);
    body.append(what,
      info.via ? h('.small.muted', tr('A moment is shared together with its video “{title}”.', { title: info.via.title || tr('Video') })) : null,
      h('.seg', VIS.map(([k, ic, label]) => h('button' + (vis === k ? '.on' : ''), { disabled: !!busy, 'aria-pressed': String(vis === k), onclick: () => setVis(k) }, icon(ic), label))),
      h('.small.faint', VIS_HINT[vis]),
      // the first upload sends the whole catalogue (privately) – say so before it happens
      !info.published && vis === 'private' && info.desktop ? h('.small.muted.note', icon('info'),
        h('span', tr('The record is not on the web yet. Choosing a link or Public first syncs your whole catalogue to your private web chronicle: characters, factions, places, events, journal entries, moments (including AI chapters), video details (names and file names, not the videos) and attached images. Only this record becomes visible to others – everything else stays private.'))) : null,
      discord ? h('.small.muted.note', icon('message-circle'),
        h('span', vis === 'private'
          ? tr('This character is used on Discord: with a link or Public, its card with the link is posted in the community Discord channel 🧙│postavy.')
          : tr('This character is used on Discord, so its card with the link is posted in the community Discord channel 🧙│postavy.'))) : null,
      kind === 'event' ? h('.small.muted.note', icon('film'),
        h('span', tr('Videos and their moments show up on the shared event only when you publish the video too (a video shared by link shows up when the event is opened through its link).'))) : null,
      busy ? h('.small.muted.busy', icon('loader'), busy + (progress ? ' ' + progress : '')) : null,
      err ? h('.small.err', err) : null,
      info.share_url && vis !== 'private' ? [
        h('.url', h('input.input', { readonly: true, value: info.share_url, onfocus: e => e.target.select(), onkeydown: e => e.stopPropagation() }),
          h('button.btn.primary', { onclick: () => copy() }, icon('copy'), tr('Copy link'))),
        h('.acts',
          navigator.share ? h('button.btn.sm', { onclick: () => navigator.share({ title: info.title || tr('Cosmas'), url: info.share_url }).catch(() => null) }, icon('share'), tr('Share…')) : null,
          h('button.btn.sm', { title: tr('Copies the link – paste it into Discord, it shows a preview card'), onclick: () => copy(tr('Link copied – paste it into Discord, it shows a preview card.')) }, icon('message-circle'), tr('Share to Discord')),
          vis === 'link' ? h('button.btn.sm.ghost', { disabled: !!busy, title: tr('The old link will stop working'), onclick: async () => {
            if (await confirmDialog(tr('Revoke link'), tr('Create a new link? The old one will stop working.'), { okLabel: tr('Revoke') })) {
              await run(tr('Saving…'), 'share.rotate', {});
              if (!err) toast(tr('New link created – the old one no longer works'));
            }
          } }, icon('refresh-cw'), tr('Revoke link')) : null),
      ] : null);
  }
  render();
  load();
}

/** Share button. opts.compact = icon only (rows, toolbars). */
function shareButton(kind, id, { compact = false, cls = 'button.btn.sm' } = {}) {
  return h(cls + (compact && cls.startsWith('button.btn') ? '.ghost.icon' : ''), { title: tr('Share'), onclick: e => { e.stopPropagation(); openShare(kind, id); } },
    icon('share-2'), compact ? null : tr('Share'));
}

window.openShare = openShare;
window.shareButton = shareButton;
})();
