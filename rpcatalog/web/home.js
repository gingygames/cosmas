/* ============================================================
   Přehled – store-front style home: latest recording, games shelf,
   recent events, unassigned moments, newest videos
   ============================================================ */
'use strict';

(() => {
document.head.appendChild(h('style', `
.home { overflow-y: auto; height: 100%; }
.home-in { padding: 20px 24px 40px; max-width: 1500px; }
.home h3 { margin: 26px 0 10px; font-size: 13px; font-weight: 650; text-transform: uppercase; letter-spacing: .03em; color: var(--text-2);
  display: flex; align-items: center; gap: 10px; }
.home h3 .more { margin-left: auto; text-transform: none; letter-spacing: 0; font-weight: 500; color: var(--text-3); cursor: pointer; font-size: 12.5px; }
.home h3 .more:hover { color: var(--text); }
.feat { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(260px, 1fr); border-radius: 8px; overflow: hidden; background: var(--surface); }
.feat .img { aspect-ratio: 16/9; background: #000 center / cover no-repeat; position: relative; cursor: pointer; }
.feat .img .pl { position: absolute; inset: 0; display: grid; place-items: center; opacity: 0; transition: opacity .15s; background: rgba(0,0,0,.25); }
.feat .img:hover .pl { opacity: 1; }
.feat .img .pl span { width: 64px; height: 64px; border-radius: 50%; background: var(--accent); color: var(--accent-ink); display: grid; place-items: center; }
.feat .img .pl i { font-size: 28px; margin-left: 3px; }
.feat .info { padding: 20px 22px; display: flex; flex-direction: column; gap: 6px; }
.feat .kicker { font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; color: var(--accent); }
.feat .ttl { font-size: 22px; font-weight: 700; line-height: 1.2; }
.feat .meta { color: var(--text-2); font-size: 13px; }
.feat .thumbs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: auto; }
.feat .thumbs > div { position: relative; overflow: hidden; aspect-ratio: 16/9; border-radius: 4px; background: #000 center / cover; cursor: pointer; opacity: .8; }
.feat .thumbs > div:hover { opacity: 1; }
.shelf { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.cap { border-radius: 6px; overflow: hidden; background: var(--surface); cursor: pointer; transition: background .12s; }
.cap:hover { background: var(--surface-2); }
.cap .im { aspect-ratio: 16/9; background: #000 center / cover no-repeat; display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 26px; }
.cap .nm { padding: 9px 11px 1px; font-weight: 600; font-size: 13.5px; }
.cap .sb { padding: 0 11px 10px; font-size: 12px; color: var(--text-3); }
.evrow { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.evc { border-radius: 6px; background: var(--surface); padding: 12px 14px; cursor: pointer; border-left: 4px solid var(--c, var(--accent)); }
.evc:hover { background: var(--surface-2); }
.evc .t { font-weight: 600; }
.evc .d { font-size: 12px; color: var(--text-3); margin-top: 2px; }
.evc .x { font-size: 12.5px; color: var(--text-2); margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.home .twocol { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; }
.home .mom { background: var(--surface); border-radius: 6px; padding: 6px; }
`));

let root, unsub = [];

async function render() {
  if (!root) return;
  const media = App.media.filter(m => inScope(m, 'media')).sort((a, b) => (b.start || 0) - (a.start || 0));
  const sessions = media.filter(m => m.type !== 'clip' && (m.duration || 0) >= (App.settings.short_session_seconds || 60));
  const latest = sessions[0] || media[0];
  const box = h('.home-in');
  Shell.header({ icon: 'house', title: tr('overview'), topic: [trn(App.media.length, '{n} video', '{n} videos'), trn(App.events.length, '{n} event', '{n} events'), trn(App.chars.length, '{n} character', '{n} characters')].join(' · ') });

  if (latest) {
    const sameDay = media.filter(m => m.id !== latest.id && m.start && latest.start && Math.abs(m.start - latest.start) < 6 * 3600).slice(0, 4);
    box.appendChild(h('h3', tr('Recently recorded')));
    box.appendChild(h('.feat',
      h('.img', { 'data-rmid': latest.id, style: latest.thumb ? { backgroundImage: `url("${latest.thumb}")` } : {}, onclick: () => API.call('media.play', { id: latest.id }) },
        resumeBar(latest), h('.pl', h('span', icon('play')))),
      h('.info',
        h('.kicker', latest.game),
        h('.ttl', latest.name),
        h('.meta', `${fmt.dateLong(latest.start)} · ${fmt.time(latest.start)} · ${fmt.durHuman(latest.duration)}`),
        latest.linked ? h('.meta', icon('link'), ' ' + tr('In an event')) : h('.meta.faint', tr('Not in any event yet')),
        h('.row', { style: { marginTop: '10px' } },
          h('button.btn.primary', { onclick: () => API.call('media.play', { id: latest.id }) }, icon('play'), tr('Play')),
          h('button.btn', { onclick: () => App.go('library', { select: [latest.id] }) }, tr('Detail')),
          !latest.linked ? h('button.btn', { onclick: () => App.go('events', { propose: true }) }, icon('wand-sparkles'), tr('Suggest event')) : null),
        sameDay.length ? h('.small.faint', { style: { marginTop: '14px' } }, tr('From the same evening')) : null,
        sameDay.length ? h('.thumbs', sameDay.map(m => h('div', { 'data-rmid': m.id, title: m.name, style: m.thumb ? { backgroundImage: `url("${m.thumb}")` } : {},
          onclick: () => API.call('media.play', { id: m.id }) }, resumeBar(m)))) : null)));
  }

  const cont = App.media.filter(m => m.resume).sort((a, b) => (b.watched_at || 0) - (a.watched_at || 0)).slice(0, 6);
  if (cont.length) {
    box.appendChild(h('h3', tr('Continue watching')));
    box.appendChild(h('.shelf', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' } }, cont.map(m => h('div',
      mediaTile(m), h('.small.ellipsis', { style: { marginTop: '6px', fontWeight: 600 } }, m.name),
      h('.tiny.faint', `${m.game} · ` + tr('{duration} left', { duration: fmt.durHuman((m.duration || 0) - m.resume) }))))));
  }

  const games = Shell.games();
  if (games.length) {
    box.appendChild(h('h3', tr('Games'), h('span.more', { onclick: () => App.go('library') }, tr('Whole library'))));
    box.appendChild(h('.shelf', games.map(g => h('.cap', { onclick: () => { Shell.setGuild(g.game); App.go('library', { game: g.game }); } },
      h('.im', { style: (g.banner || g.thumb) ? { backgroundImage: `url("${g.banner || g.thumb}")` } : { background: gameHue(g.game) } }, (g.banner || g.thumb) ? null : g.game.slice(0, 2)),
      h('.nm.ellipsis', g.game),
      h('.sb', tr('{duration} recorded', { duration: fmt.durHuman(g.dur) }) + ` · ${g.last ? fmt.rel(g.last) : ''}`)))));
  }

  const evs = [...App.events].filter(e => e.start_time && inScope(e)).sort((a, b) => b.start_time - a.start_time).slice(0, 6);
  const left = h('div'), right = h('div');
  left.appendChild(h('h3', tr('Recent events'), h('span.more', { onclick: () => App.go('events') }, tr('See all'))));
  if (evs.length) {
    left.appendChild(h('.evrow', { style: { gridTemplateColumns: '1fr' } }, evs.map(e => h('.evc', { style: { '--c': e.color }, onclick: () => App.go('events', { id: e.id }) },
      h('.row', h('.t.grow.ellipsis', e.title), e.chars && e.chars.length ? avatarStack(e.chars, 20, 4) : null),
      h('.d', [fmt.range(e.start_time, e.end_time), e.ingame_date].filter(Boolean).join(' · ')),
      e.excerpt ? h('.x', e.excerpt) : null))));
  } else {
    left.appendChild(h('.evc', { onclick: () => App.go('events', { propose: true }) }, h('.t', tr('No events yet')),
      h('.x', tr('Click to get events suggested from the game nights in your library.'))));
  }
  right.appendChild(h('h3', tr('Unassigned moments'), h('span.more', { onclick: () => App.go('moments') }, tr('See all'))));
  const momBox = h('.mom', h('.faint.small', { style: { padding: '8px' } }, tr('Loading…')));
  right.appendChild(momBox);
  box.appendChild(h('.twocol', left, right));

  box.appendChild(h('h3', tr('New in the library'), h('span.more', { onclick: () => App.go('library') }, tr('Library'))));
  box.appendChild(h('.shelf', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' } }, media.slice(0, 12).map(m => mediaTile(m))));

  clear(root).appendChild(h('.home', box));

  const bms = (await API.call('bm.list', { include_auto: false })).filter(b => !b.event_id).sort((a, b) => (b.abs || 0) - (a.abs || 0)).slice(0, 7);
  clear(momBox);
  if (!bms.length) momBox.appendChild(h('.faint.small', { style: { padding: '8px' } }, tr('All bookmarks are assigned. Press B while playing.')));
  else bms.forEach(b => momBox.appendChild(bmRow(b, { showMedia: true, onChange: render })));
}

Views.register('home', {
  title: tr('Overview'), short: tr('Overview'), icon: 'house', order: 5,
  mount(el) {
    root = el;
    Shell.setGuild('home');
    unsub = [App.on('media', render), App.on('resume', render),App.on('events', render), App.on('bookmarks', render)];
    render();
  },
  unmount() { unsub.forEach(f => f()); unsub = []; root = null; },
});
})();
