/* ============================================================
   Web player: HTML5 <video> in a panel docked on the right (the desktop uses libmpv).
   Speaks the same notifications as the desktop host: 'player', 'bookmark', 'pin',
   'snapshot', 'tagchar', 'resumed' – so the shared UI needs no changes.

   Audio: a browser plays only the first audio track of a file. Medal's first track is
   "All Audio" (the full mix), so you hear everything but cannot switch mic / Discord
   off. Where the browser exposes HTMLMediaElement.audioTracks (Chrome with
   "Experimental Web Platform features"), tracks can be switched. Separate audio files
   next to the video (X_Mic.mp4 …) are mixed with synced <audio> elements.
   ============================================================ */
'use strict';

const WebPlayer = (() => {
  let host = null;          // { store, emit(kind, payload), mediaFile(media) }
  let el = null, video = null, bar = null, marksEl = null, timeEl = null, titleEl = null, msgEl = null, trackBtn = null;
  let media = null, url = null, endAt = null, rangeA = null, marks = [], sidecars = [], lastPush = 0, lastResume = 0;

  const fmtT = s => Suggest.fmtClock(s);
  const pos = () => (video ? video.currentTime || 0 : 0);

  function build() {
    video = h('video', { playsinline: true });
    titleEl = h('.wp-title.ellipsis');
    msgEl = h('.wp-msg.hidden');
    marksEl = h('.wp-marks');
    const fill = h('.wp-fill'), rangeEl = h('.wp-range');
    const hover = h('.wp-hover.hidden');
    bar = h('.wp-bar', h('.wp-track', fill, rangeEl), marksEl, hover);
    timeEl = h('.wp-time', '0:00 / 0:00');
    const btn = (ic, title, act) => h('button.npb', { title, onclick: () => handle(act) }, icon(ic));
    const playBtn = h('button.npb', { title: 'Pauza (mezerník)', onclick: () => handle('pause') }, icon('play'));
    const vol = h('input.wp-vol', { type: 'range', min: 0, max: 100, value: 100, title: 'Hlasitost',
      oninput: e => { video.volume = e.target.value / 100; sidecars.forEach(s => { s.el.volume = s.vol * video.volume; }); } });
    const speed = h('select.wp-speed', { title: 'Rychlost', onchange: e => { video.playbackRate = +e.target.value; } },
      [0.5, 1, 1.25, 1.5, 2, 3].map(r => h('option', { value: r, selected: r === 1 }, r + '×')));
    trackBtn = h('button.npb', { title: 'Zvukové stopy', onclick: e => tracksMenu(e) }, icon('audio-lines'));
    const resize = h('.wp-resize', { title: 'Táhni pro změnu šířky' });
    el = h('aside#web-player',
      resize,
      h('.wp-head', icon('play'), titleEl,
        btn('picture-in-picture-2', 'Obraz v obraze', 'popout'), btn('maximize', 'Celá obrazovka (F)', 'fs'), btn('x', 'Zavřít', 'close')),
      h('.wp-video', video, msgEl),
      bar,
      h('.wp-ctl',
        btn('rotate-ccw', '−5 s (←)', '-5'), playBtn, btn('rotate-cw', '+5 s (→)', '+5'), timeEl, h('.grow'),
        btn('bookmark-plus', 'Záložka (B)', 'bm'), btn('brackets', 'Začátek/konec úseku (Shift+B)', 'range'),
        btn('pin', 'Záložka rovnou do události (P)', 'pin'), btn('user-round-plus', 'Kdo je ve videu (C)', 'tagchar'),
        btn('camera', 'Snímek (S)', 'snap'), btn('image', 'Použít snímek jako náhled videa (T)', 'thumb')),
      h('.wp-ctl2', trackBtn, h('span.wp-tracks.small.faint'), h('.grow'), speed, icon('volume-2'), vol));
    document.body.appendChild(el);

    const sync = () => {
      const d = video.duration || (media && media.duration) || 0;
      fill.style.width = d ? Math.min(100, pos() / d * 100) + '%' : '0';
      timeEl.textContent = `${fmtT(pos())} / ${fmtT(d)}`;
      if (rangeA != null && d) { rangeEl.style.left = rangeA / d * 100 + '%'; rangeEl.style.width = Math.max(0, pos() - rangeA) / d * 100 + '%'; }
      rangeEl.classList.toggle('hidden', rangeA == null);
      playBtn.replaceChildren(icon(video.paused ? 'play' : 'pause'));
    };
    video.addEventListener('timeupdate', () => {
      sync();
      if (endAt != null && pos() >= endAt) { video.pause(); endAt = null; }
      const t = Date.now();
      if (t - lastPush > 500) push();
      if (!video.paused && t - lastResume > 5000) { lastResume = t; saveResume(); }
      syncSidecars();
    });
    ['play', 'pause', 'seeked', 'ratechange'].forEach(ev => video.addEventListener(ev, () => { sync(); push(); syncSidecars(true); }));
    video.addEventListener('loadedmetadata', () => { drawMarks(); sync(); });
    video.addEventListener('error', () => {
      const code = video.error && video.error.code;
      showMsg(code === 4
        ? 'Tento prohlížeč neumí přehrát kodek videa (nejspíš HEVC / H.265). Chrome a Edge na Windows ho přehrají jen s hardwarovou podporou GPU (Edge navíc potřebuje „HEVC Video Extensions“). Desktopová verze Kronikáře přehraje vše.'
        : 'Video nejde načíst – soubor chybí nebo k němu prohlížeč nemá přístup.');
    });

    const seekTo = e => {
      const r = bar.getBoundingClientRect();
      const d = video.duration || 0;
      if (d) video.currentTime = Math.max(0, Math.min(d, (e.clientX - r.left) / r.width * d));
    };
    bar.addEventListener('mousedown', e => {
      if (e.target.closest('.wp-mark')) return;
      seekTo(e);
      const mv = ev => seekTo(ev), up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
    });
    bar.addEventListener('mousemove', e => {
      const r = bar.getBoundingClientRect(), d = video.duration || 0;
      if (!d) return;
      hover.classList.remove('hidden');
      hover.style.left = (e.clientX - r.left) + 'px';
      hover.textContent = fmtT((e.clientX - r.left) / r.width * d);
    });
    bar.addEventListener('mouseleave', () => hover.classList.add('hidden'));
    video.addEventListener('click', () => handle('pause'));
    video.addEventListener('dblclick', () => handle('fs'));

    resize.addEventListener('mousedown', e => {
      e.preventDefault();
      const mv = ev => setWidth(innerWidth - ev.clientX);
      const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); try { localStorage.setItem('kronikar.wp', String(el.offsetWidth)); } catch (x) { /* ignore */ } };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
    });
    let w = 560;
    try { w = +localStorage.getItem('kronikar.wp') || w; } catch (e) { /* ignore */ }
    setWidth(w);
  }
  function setWidth(w) {
    w = Math.max(360, Math.min(innerWidth - 420, w));
    document.documentElement.style.setProperty('--wp-w', w + 'px');
  }
  function showMsg(text) { msgEl.textContent = text || ''; msgEl.classList.toggle('hidden', !text); }

  function push() {
    lastPush = Date.now();
    host.emit('player', { media_id: media ? media.id : null, pos: pos(), playing: !!(media && video && !video.paused), popout: !!document.pictureInPictureElement, detail: false });
  }
  function saveResume() {
    if (!media) return;
    const p = pos(), d = video.duration || media.duration || 0;
    host.setResume(media.id, (p < 15 || (d && p > d - 20)) ? null : Math.round(p * 10) / 10);
  }

  /* ---------- seek-bar marks: bookmarks + event references ---------- */
  function setMarks(list) { marks = list || []; drawMarks(); }
  function drawMarks() {
    if (!marksEl) return;
    clear(marksEl);
    const d = (video && video.duration) || (media && media.duration) || 0;
    if (!d) return;
    for (const m of marks) {
      const left = m.t / d * 100;
      const style = { left: left + '%', background: m.color || (m.kind === 'ref' ? '#5aa9e6' : m.kind === 'auto' ? 'var(--text-3, #888)' : 'var(--accent, #e3b341)') };
      if (m.t_end != null) style.width = Math.max(0.4, (m.t_end - m.t) / d * 100) + '%';
      marksEl.appendChild(h('.wp-mark' + (m.t_end != null ? '.span' : ''), { style, title: `${fmtT(m.t)} ${m.label || ''}`, onclick: () => { video.currentTime = m.t; } }));
    }
  }

  /* ---------- audio tracks ---------- */
  function trackInfo() {
    const names = media ? M.tracks(media).map(t => t.name || t.role) : [];
    const at = video && video.audioTracks;
    const lbl = $('.wp-tracks', el);
    if (at && at.length > 1) lbl.textContent = `${[...at].filter(t => t.enabled).length}/${at.length} stop`;
    else if (names.length > 1) lbl.textContent = `hraje: ${names[0]} (1 z ${names.length})`;
    else lbl.textContent = '';
    lbl.textContent += sidecars.length ? ` · +${sidecars.filter(s => !s.el.muted).length} soubory zvuku` : '';
  }
  function tracksMenu(e) {
    const names = media ? M.tracks(media).map(t => t.name || t.role) : [];
    const at = video.audioTracks;
    const items = [];
    if (at && at.length) {
      items.push({ head: 'Stopy ve videu' });
      [...at].forEach((t, i) => items.push({ label: `${t.enabled ? '✓ ' : ''}${names[i] || t.label || 'Stopa ' + (i + 1)}`, onClick: () => {
        // Chrome plays one enabled track at a time
        [...at].forEach((x, j) => { x.enabled = j === i; }); trackInfo();
      } }));
    } else if (names.length) {
      items.push({ head: 'Stopy ve videu (prohlížeč hraje jen první)' });
      names.forEach((n, i) => items.push({ label: `${i === 0 ? '✓ ' : ''}${n}`, disabled: i > 0 }));
      items.push({ head: 'Přepínání: chrome://flags → Experimental Web Platform features' });
    }
    if (sidecars.length) {
      items.push({ sep: true }, { head: 'Samostatné soubory zvuku' });
      sidecars.forEach(s => items.push({ label: `${s.el.muted ? '' : '✓ '}${s.name}`, onClick: () => { s.el.muted = !s.el.muted; trackInfo(); } }));
    }
    if (!items.length) items.push({ head: 'Video má jen jednu zvukovou stopu' });
    menu(e, items);
  }
  async function loadSidecars(m) {
    sidecars.forEach(s => { s.el.pause(); URL.revokeObjectURL(s.url); s.el.remove(); });
    sidecars = [];
    for (const sc of M.sidecars(m)) {
      try {
        const f = await Folders.file(sc.path);
        const u = URL.createObjectURL(f);
        const a = new Audio(u); a.preload = 'auto';
        sidecars.push({ el: a, url: u, name: sc.name || sc.role, vol: 1 });
      } catch (e) { /* no access */ }
    }
  }
  function syncSidecars(hard = false) {
    for (const s of sidecars) {
      if (Math.abs(s.el.currentTime - pos()) > (hard ? 0.05 : 0.3)) s.el.currentTime = pos();
      s.el.playbackRate = video.playbackRate;
      if (video.paused && !s.el.paused) s.el.pause();
      if (!video.paused && s.el.paused) s.el.play().catch(() => {});
    }
  }

  /* ---------- loading ---------- */
  async function load(m, { offset = null, end = null, file }) {
    if (!el) build();
    if (media) saveResume();
    media = m; endAt = end; rangeA = null; showMsg('');
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(file);
    titleEl.textContent = M.title(m);
    titleEl.title = m.path;
    document.documentElement.classList.add('wp-open');
    video.src = url;
    await new Promise(res => { video.addEventListener('loadedmetadata', res, { once: true }); video.addEventListener('error', res, { once: true }); });
    if (offset) video.currentTime = offset;
    await loadSidecars(m);
    trackInfo();
    video.play().catch(() => {});
    push();
  }
  function close() {
    if (!media) return;
    saveResume();
    video.pause(); video.removeAttribute('src'); video.load();
    sidecars.forEach(s => { s.el.pause(); URL.revokeObjectURL(s.url); });
    sidecars = [];
    if (url) URL.revokeObjectURL(url);
    url = null; media = null;
    document.documentElement.classList.remove('wp-open');
    push();
  }

  /** Current frame as a JPEG data URL. */
  function grab(width = 0) {
    if (!media || !video.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = width || video.videoWidth;
    c.height = Math.round(c.width * video.videoHeight / video.videoWidth);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return { data: c.toDataURL('image/jpeg', 0.9), media, pos: pos() };
  }

  function handle(act) {
    if (!el) return;
    const d = video.duration || 0;
    switch (act) {
      case 'pause': if (media) video.paused ? video.play().catch(() => {}) : video.pause(); break;
      case '-5': case '+5': case '-30': case '+30': video.currentTime = Math.max(0, Math.min(d, pos() + Number(act))); break;
      case 'seek0': video.currentTime = 0; break;
      case 'mute': video.muted = !video.muted; break;
      case 'fs': document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen().catch(() => {}); break;
      case 'esc': if (rangeA != null) rangeA = null; else if (document.fullscreenElement) document.exitFullscreen(); break;
      case 'popout': document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture().catch(() => {}); break;
      case 'close': close(); break;
      case 'bm': if (media) host.bookmark(media, pos(), null); break;
      case 'range':
        if (!media) break;
        if (rangeA == null) { rangeA = pos(); toast('Začátek úseku – Shift+B znovu označí konec'); } else {
          const a = rangeA; rangeA = null;
          if (Math.abs(pos() - a) >= 0.5) host.bookmark(media, Math.min(a, pos()), Math.max(a, pos()));
        }
        break;
      case 'pin': if (media) host.emit('pin', { media_id: media.id, offset: pos() }); break;
      case 'tagchar': if (media) host.emit('tagchar', { media_id: media.id, t: pos() }); break;
      case 'snap': if (media) host.emit('snapshot', { media_id: media.id, offset: pos(), moment: (media.start_time || 0) + pos() }); break;
      case 'thumb': if (media) host.thumbFromFrame(media); break;
      case 'clip_in': case 'clip_out':
        toast('Export klipu (ffmpeg) je jen v desktopové verzi – použij úsek (Shift+B).', 'err'); break;
      default:
        if (/^t[1-9]$/.test(act) && video.audioTracks && video.audioTracks.length) {
          const i = +act.slice(1) - 1;
          if (i < video.audioTracks.length) { [...video.audioTracks].forEach((x, j) => { x.enabled = j === i; }); trackInfo(); }
        }
    }
  }

  return {
    init(h_) { host = h_; },
    load, close, handle, setMarks, grab,
    get media() { return media; },
    position: pos,
  };
})();
