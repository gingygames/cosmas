/* ============================================================
   Appearance: themes + user customization (stored in App.ui.look)
   ============================================================ */
'use strict';

/* layers: rail, sidebars, main, surface, surface-2, surface-3, input · text: primary, secondary, muted */
function T(label, desc, accent, L, X, extra = {}) {
  const k = ['--bg-0', '--bg-2', '--bg', '--surface', '--surface-2', '--surface-3', '--input'];
  const vars = {};
  L.forEach((c, i) => { vars[k[i]] = c; });
  if (X) { vars['--text'] = X[0]; vars['--text-2'] = X[1]; vars['--text-3'] = X[2]; }
  return { label, desc, accent, vars: Object.assign(vars, extra.vars || {}), light: !!extra.light };
}
const THEMES = {
  noc: T(tr('Night'), tr('graphite with gold'), '#e3b341', ['#101216', '#15181d', '#1b1e24', '#20242b', '#262a32', '#2e333c', '#121418']),
  grafit: T(tr('Graphite'), tr('neutral grey'), '#5aa9e6', ['#111111', '#171717', '#1d1d1e', '#232324', '#29292b', '#323234', '#121212'],
    ['#ededed', '#b3b3b5', '#7e7e82']),
  pulnoc: T(tr('Midnight'), tr('deep blue'), '#8f7cf0', ['#0c0e1a', '#111425', '#161a2e', '#1c2138', '#222842', '#2b324f', '#0d1020'],
    ['#e6e8f4', '#a9aecb', '#717898']),
  les: T(tr('Greenwood'), tr('dark green'), '#7cc47f', ['#0c110e', '#111814', '#161e19', '#1b251f', '#212c25', '#29362e', '#0d130f'],
    ['#e5ece6', '#a8b8ac', '#728276']),
  krev: T(tr('Blood'), tr('dark with crimson'), '#d9534f', ['#110c0c', '#171111', '#1d1616', '#241b1b', '#2b2121', '#352828', '#120d0d'],
    ['#efe6e4', '#bba9a6', '#85726f']),
  oled: T('OLED', tr('pure black'), '#e3b341', ['#000000', '#000000', '#0a0a0b', '#111113', '#18181b', '#222226', '#000000']),
  pergamen: T(tr('Parchment'), tr('light chronicle'), '#9a6a14', ['#d9cfbd', '#e9e1d2', '#f5f0e6', '#fbf8f2', '#efe8db', '#e4dac8', '#e6ddcc'],
    ['#2b2216', '#5b4e3d', '#8a7b66'], { light: true, vars: {
      '--hover': 'rgba(80,55,15,.07)', '--active': 'rgba(80,55,15,.12)', '--border': 'rgba(80,55,15,.12)', '--border-2': 'rgba(80,55,15,.2)',
      '--shadow': '0 8px 24px rgba(60,40,10,.18)', '--shadow-sm': '0 1px 3px rgba(60,40,10,.14)' } }),
};
const LOOK_DEFAULT = { theme: 'noc', accent: '', zoom: 100, radius: 'normal', font: 'sans', motion: true, preroll: 3 };

function hexToRgb(hex) {
  const v = hex.replace('#', ''); const n = parseInt(v.length === 3 ? v.split('').map(c => c + c).join('') : v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(hex, to, p) {
  const a = hexToRgb(hex), b = hexToRgb(to);
  return '#' + a.map((x, i) => Math.round(x + (b[i] - x) * p).toString(16).padStart(2, '0')).join('');
}

function lookGet() { return Object.assign({}, LOOK_DEFAULT, App.ui.look || {}); }

function applyAppearance(look = lookGet()) {
  const th = THEMES[look.theme] || THEMES.noc;
  const root = document.documentElement;
  // reset previous theme overrides
  for (const t of Object.values(THEMES)) for (const k of Object.keys(t.vars)) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(th.vars)) root.style.setProperty(k, v);
  const acc = look.accent || th.accent;
  const [r, g, b] = hexToRgb(acc);
  root.style.setProperty('--accent', acc);
  root.style.setProperty('--accent-2', th.light ? mix(acc, '#000000', .2) : mix(acc, '#ffffff', .3));
  root.style.setProperty('--accent-soft', `rgba(${r},${g},${b},${th.light ? .16 : .14})`);
  root.style.setProperty('--accent-ink', (r * .299 + g * .587 + b * .114) > 150 ? '#1a1405' : '#ffffff');
  const rad = { sharp: [3, 2], normal: [8, 6], round: [14, 10] }[look.radius] || [8, 6];
  root.style.setProperty('--radius', rad[0] + 'px'); root.style.setProperty('--radius-sm', rad[1] + 'px');
  if (look.font === 'serif') {
    root.style.setProperty('--font-display', 'Georgia, "Cambria", "Times New Roman", serif');
  } else root.style.removeProperty('--font-display');
  root.dataset.theme = look.theme; root.dataset.light = th.light ? '1' : '';
  root.dataset.motion = look.motion ? '' : 'off';
  root.dataset.radius = look.radius;
  App.ui.bmPreroll = look.preroll;
  const bg = th.vars['--bg-0'] || '#101216';
  if (window.PANE) API.call('window.zoom', { factor: (look.zoom || 100) / 100, pane: window.PANE });
  else { API.call('window.bg', { color: bg, fg: th.vars['--text'] || '#eceef1', accent: acc }); API.call('window.zoom', { factor: (look.zoom || 100) / 100 }); }
}

function lookSet(patch) {
  App.ui.look = Object.assign(lookGet(), patch);
  applyAppearance(App.ui.look);
  App.saveUi();
}

document.head.appendChild(h('style', `
[data-motion="off"] *, [data-motion="off"] *::before, [data-motion="off"] *::after { transition: none !important; animation: none !important; }
[data-radius="sharp"] .card, [data-radius="sharp"] .btn, [data-radius="sharp"] .input, [data-radius="sharp"] .modal,
[data-radius="sharp"] .mcard, [data-radius="sharp"] .list-row, [data-radius="sharp"] .chip { border-radius: 4px !important; }
[data-radius="round"] .card, [data-radius="round"] .mcard, [data-radius="round"] .modal { border-radius: 20px !important; }
[data-radius="round"] .btn, [data-radius="round"] .input { border-radius: 12px !important; }
[data-light="1"] ::-webkit-scrollbar-thumb { background: rgba(80,55,15,.25); }
[data-light="1"] .mcard .th, [data-light="1"] .mtile { background: #d9ceb8; }
[data-light="1"] .tl-hover { background: rgba(248,243,233,.98); }
[data-light="1"] .badge { filter: saturate(1.2) brightness(.85); }
.look-themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.look-theme { border-radius: 12px; border: 2px solid var(--border); cursor: pointer; overflow: hidden; background: var(--surface); }
.look-theme.on { border-color: var(--accent); }
.look-theme .pv { height: 70px; display: flex; gap: 6px; padding: 10px; }
.look-theme .pv .rail { width: 14px; border-radius: 5px; }
.look-theme .pv .main { flex: 1; border-radius: 6px; padding: 7px; display: flex; flex-direction: column; gap: 5px; }
.look-theme .pv .ln { height: 5px; border-radius: 3px; }
.look-theme .nm { padding: 7px 10px; font-size: 12.5px; }
.look-theme .nm small { color: var(--text-3); display: block; font-size: 11px; }
.look-sw { width: 26px; height: 26px; border-radius: 50%; cursor: pointer; border: 3px solid transparent; box-shadow: 0 0 0 1px var(--border-2); }
.look-sw.on { border-color: var(--text); }
.look-layout { display: flex; gap: 12px; }
.look-layout .opt { width: 150px; border: 2px solid var(--border); border-radius: 12px; padding: 10px; cursor: pointer; background: var(--surface); font-size: 12.5px; }
.look-layout .opt.on { border-color: var(--accent); }
.look-layout .sk { height: 64px; display: flex; gap: 4px; margin-bottom: 7px; }
.look-layout .sk.top { flex-direction: column; }
.look-layout .sk .v { background: #000; border-radius: 4px; flex: 0 0 42%; display: grid; place-items: center; color: #666; }
.look-layout .sk .c { background: var(--surface-3); border-radius: 4px; flex: 1; }
`));

/** Settings card content for appearance (used by settings.js). */
function appearanceSection() {
  const box = h('.col', { style: { gap: '18px' } });
  const render = () => {
    const look = lookGet();
    const th = THEMES[look.theme] || THEMES.noc;
    const lab = t => h('.small.muted', { style: { marginBottom: '7px' } }, t);
    const themes = h('.look-themes', Object.entries(THEMES).map(([k, t]) => {
      const v = t.vars;
      return h('.look-theme' + (look.theme === k ? '.on' : ''), { onclick: () => { lookSet({ theme: k, accent: '' }); render(); } },
        h('.pv', { style: { background: v['--bg'] } }, h('.rail', { style: { background: v['--bg-0'] } }), h('.rail', { style: { background: v['--bg-2'], width: '26px' } }),
          h('.main', { style: { background: v['--surface'] } }, h('.ln', { style: { background: t.accent, width: '45%' } }),
            h('.ln', { style: { background: v['--surface-3'], width: '80%' } }), h('.ln', { style: { background: v['--surface-3'], width: '60%' } }))),
        h('.nm', t.label, h('small', t.desc)));
    }));
    const accents = ['', '#e3b341', '#ef9a4b', '#d9534f', '#e06aa8', '#a77be8', '#5aa9e6', '#40c4c4', '#5cc98a', '#9aa3b2'];
    const accRow = h('.row', { style: { gap: '8px', alignItems: 'center' } },
      accents.map(c => h('span.look-sw' + ((look.accent || '') === c ? '.on' : ''), {
        title: c ? c : tr('From the theme'), style: { background: c || th.accent, backgroundImage: c ? null : 'linear-gradient(135deg, transparent 45%, var(--surface) 45% 55%, transparent 55%)' },
        onclick: () => { lookSet({ accent: c }); render(); } })),
      h('input', { type: 'color', value: look.accent || th.accent, title: tr('Custom colour'), style: { width: '34px', height: '28px', border: 0, background: 'none', cursor: 'pointer' },
        onchange: e => { lookSet({ accent: e.target.value }); render(); } }));
    const seg = (key, opts) => h('.seg', opts.map(([v, l]) => h('button' + (look[key] === v ? '.on' : ''), { onclick: () => { lookSet({ [key]: v }); render(); } }, l)));
    const zoom = h('input', { type: 'range', min: 80, max: 130, step: 5, value: look.zoom, style: { width: '220px' } });
    const zoomLbl = h('b', look.zoom + ' %');
    zoom.oninput = () => { zoomLbl.textContent = zoom.value + ' %'; };
    zoom.onchange = () => lookSet({ zoom: +zoom.value });
    const layout = App.settings.player_layout === 'row' ? 'row' : 'stack';
    const layoutOpt = (k, label) => h('.opt' + (layout === k ? '.on' : ''), {
      onclick: async () => { await API.call('layout.set', { mode: k }); App.settings.player_layout = k; render(); },
    }, h('.sk', h('.c'), k === 'row' ? [h('.v', { style: { flex: '0 0 30%' } }, icon('play')), h('.v', { style: { flex: '0 0 18%', background: 'var(--surface-3)' } })]
      : h('.col', { style: { flex: '0 0 40%', gap: '4px' } }, h('.v', { style: { flex: 1 } }, icon('play')), h('.v', { style: { flex: '0 0 30%', background: 'var(--surface-3)' } }))), label);
    const pre = h('input.input', { type: 'number', min: 0, max: 30, value: look.preroll, style: { width: '80px' }, onchange: e => lookSet({ preroll: Math.max(0, +e.target.value || 0) }) });

    clear(box).append(
      h('div', lab(tr('Theme')), themes),
      h('div', lab(tr('Accent colour')), accRow),
      h('.row.wrap', { style: { gap: '34px', alignItems: 'flex-start' } },
        h('div', lab(tr('Interface size')), h('.row', zoom, zoomLbl)),
        h('div', lab(tr('Corner rounding')), seg('radius', [['sharp', tr('Sharp')], ['normal', tr('Standard')], ['round', tr('Round')]])),
        h('div', lab(tr('Heading font')), seg('font', [['sans', tr('Modern')], ['serif', tr('Chronicle')]])),
        h('div', lab(tr('Animations')), seg('motion', [[true, tr('On')], [false, tr('Off')]]))),
      h('div', lab(tr('Player on the right – video information (you can also switch it with the button in the player header)')),
        h('.look-layout', layoutOpt('stack', tr('Below the video')), layoutOpt('row', tr('Next to the video')))),
      h('div', lab(tr('Bookmarks')), h('label.row', { style: { gap: '8px' } }, tr('Play bookmarks'), pre, tr('seconds early (ranges play exactly)'))),
      h('div', h('button.btn.sm.ghost', { onclick: () => { App.ui.look = {}; applyAppearance(); App.saveUi(); render(); } }, icon('rotate-ccw'), tr('Restore default appearance'))));
  };
  render();
  return box;
}

Object.assign(window, { THEMES, applyAppearance, appearanceSection, lookSet, lookGet });
