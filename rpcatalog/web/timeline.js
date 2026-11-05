/* ============================================================
   Časová osa – 4 přepínatelné pohledy:
     Kronika (vertikální příběh), Osa (zoomovatelný Gantt),
     Kalendář (měsíční mřížka), Postavy (swimlanes podle postav)
   ============================================================ */
'use strict';

const TL_CSS = `
.tl-page { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.tl-filters { display: flex; align-items: center; gap: 8px; padding: 0 24px 14px; flex-wrap: wrap; }
.tl-filters .search { width: 260px; }
.tl-filters select.input { width: auto; min-width: 150px; }
.tl-body { flex: 1; min-height: 0; position: relative; }
.tl-hint { color: var(--text-3); font-size: 12px; margin-left: auto; }

/* ---------- Kronika ---------- */
.tl-chron-wrap { height: 100%; overflow: auto; padding: 4px 24px 60px; }
.tl-chron { position: relative; max-width: 1180px; margin: 0 auto; padding: 10px 0 20px; }
.tl-chron::before { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; transform: translateX(-1px);
  background: linear-gradient(180deg, transparent, rgba(227,179,65,.35) 40px, rgba(227,179,65,.18) calc(100% - 60px), transparent); }
.tl-month { position: relative; z-index: 1; display: flex; justify-content: center; margin: 26px 0 14px; }
.tl-month span { padding: 6px 18px; border-radius: 99px; background: linear-gradient(180deg, #2a2416, #1d1a12);
  border: 1px solid rgba(227,179,65,.35); color: var(--accent-2); font: 600 13px var(--font-display);
  letter-spacing: .06em; text-transform: uppercase; box-shadow: 0 4px 18px rgba(0,0,0,.35); }
.tl-day { position: relative; z-index: 1; display: flex; justify-content: center; margin: 14px 0 8px; }
.tl-day span { padding: 2px 11px; border-radius: 7px; background: var(--surface-2); border: 1px solid var(--border);
  color: var(--text-2); font-size: 11.5px; }
.tl-item { position: relative; display: flex; width: 50%; padding: 6px 30px 6px 0; }
.tl-item.right { margin-left: 50%; padding: 6px 0 6px 30px; }
.tl-item::after { content: ""; position: absolute; top: 22px; right: -7px; width: 12px; height: 12px; border-radius: 50%;
  background: var(--bg); border: 3px solid var(--node, var(--accent)); box-shadow: 0 0 0 4px rgba(13,15,19,.9); z-index: 2; }
.tl-item.right::after { right: auto; left: -7px; }
.tl-item.note::after { width: 8px; height: 8px; top: 16px; right: -5px; border-width: 2px; border-color: var(--text-3); }
.tl-item.note.right::after { left: -5px; }
.tl-card { flex: 1; position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  overflow: hidden; cursor: pointer; transition: transform .18s var(--ease), box-shadow .18s, border-color .18s;
  box-shadow: 0 2px 10px rgba(0,0,0,.25); }
.tl-card:hover { transform: translateY(-2px); border-color: var(--border-2); box-shadow: 0 10px 28px rgba(0,0,0,.45); }
.tl-card .bar { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; }
.tl-card .cover { height: 120px; background-size: cover; background-position: center; position: relative; }
.tl-card .cover::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, var(--surface)); }
.tl-card .inner { padding: 13px 16px 13px 18px; }
.tl-card h3 { margin: 0 0 4px; font: 600 16px/1.3 var(--font-display); letter-spacing: -.2px; }
.tl-card .meta { display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--text-2); font-size: 12px; }
.tl-card .meta span { display: inline-flex; align-items: center; gap: 5px; }
.tl-card .meta i { font-size: 13px; color: var(--text-3); }
.tl-card .meta .ig { color: var(--accent-2); }
.tl-card .ex { margin: 8px 0 0; color: var(--text-2); font-size: 13px; line-height: 1.55;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.tl-card .foot { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.tl-card .counts { display: flex; gap: 10px; color: var(--text-3); font-size: 12px; margin-left: auto; }
.tl-card .counts span { display: inline-flex; align-items: center; gap: 4px; }
.tl-thumbs { display: flex; gap: 6px; margin-top: 10px; }
.tl-thumbs .t { flex: 1; max-width: 25%; aspect-ratio: 16/9; border-radius: 7px; overflow: hidden; background: #000;
  position: relative; border: 1px solid var(--border); }
.tl-thumbs .t img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tl-thumbs .t .more { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.6);
  color: #fff; font-weight: 600; font-size: 13px; }
.tl-subs { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; padding-left: 10px;
  border-left: 2px solid var(--border); }
.tl-sub { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-radius: 9px; background: var(--surface-2);
  border: 1px solid var(--border); cursor: pointer; transition: background .15s; }
.tl-sub:hover { background: var(--surface-3); }
.tl-sub .t { font-weight: 600; font-size: 13px; }
.tl-sub .m { color: var(--text-3); font-size: 11.5px; margin-left: auto; white-space: nowrap; }
.tl-sub-wrap > .tl-subs { margin-left: 14px; margin-top: 6px; }
.tl-note { flex: 1; padding: 9px 13px; border-radius: 11px; background: rgba(255,255,255,.025); border: 1px dashed var(--border-2);
  cursor: pointer; transition: background .15s; }
.tl-note:hover { background: rgba(255,255,255,.05); }
.tl-note .h { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-3); }
.tl-note .h b { color: var(--text-2); font-weight: 600; }
.tl-note .x { margin-top: 4px; font-family: var(--serif); font-style: italic; color: #d9cfb8; font-size: 13px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tl-undated { max-width: 1180px; margin: 30px auto 0; }
.tl-undated .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
@media (max-width: 1050px) {
  .tl-chron::before { left: 14px; }
  .tl-item, .tl-item.right { width: auto; margin-left: 0; padding: 6px 0 6px 38px; }
  .tl-item::after, .tl-item.right::after { left: 8px; right: auto; }
  .tl-item.note::after, .tl-item.note.right::after { left: 10px; }
  .tl-month, .tl-day { justify-content: flex-start; padding-left: 30px; }
}

/* ---------- Gantt (Osa + Postavy) ---------- */
.tl-g { position: absolute; inset: 0 0 0 0; display: flex; flex-direction: column; border-top: 1px solid var(--border);
  background: linear-gradient(180deg, var(--bg-2), var(--bg)); user-select: none; }
.tl-g-top { display: flex; height: 40px; flex: none; border-bottom: 1px solid var(--border); background: var(--bg-2); }
.tl-g-corner { flex: none; border-right: 1px solid var(--border); display: flex; align-items: center; padding: 0 14px;
  color: var(--text-3); font-size: 11.5px; gap: 6px; }
.tl-g-axis { position: relative; flex: 1; overflow: hidden; }
.tl-tick { position: absolute; top: 0; bottom: 0; border-left: 1px solid rgba(255,255,255,.07); padding: 6px 0 0 6px;
  font-size: 11px; color: var(--text-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
.tl-tick.major { border-left-color: rgba(227,179,65,.4); color: var(--accent-2); font-weight: 600; }
.tl-tick .sub { display: block; font-size: 10px; opacity: .7; font-weight: 400; margin-top: 1px; }
.tl-g-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; position: relative; }
.tl-g-labels { flex: none; position: relative; border-right: 1px solid var(--border); background: var(--bg-2); z-index: 3; }
.tl-g-lab { position: absolute; left: 0; right: 0; padding: 10px 12px 0 14px; display: flex; gap: 9px; align-items: flex-start;
  border-bottom: 1px solid var(--border); overflow: hidden; }
.tl-g-lab .ttl { font-weight: 600; font-size: 13px; line-height: 1.25; }
.tl-g-lab .sub { color: var(--text-3); font-size: 11.5px; margin-top: 2px; }
.tl-g-lab i { color: var(--text-3); margin-top: 1px; }
.tl-g-lab.click { cursor: pointer; }
.tl-g-lab.click:hover { background: var(--hover); }
.tl-g-canvas { flex: 1; position: relative; overflow: hidden; cursor: grab; }
.tl-g-canvas.drag { cursor: grabbing; }
.tl-g-lane { position: absolute; left: 0; right: 0; border-bottom: 1px solid var(--border); }
.tl-g-lane:nth-child(even) { background: rgba(255,255,255,.012); }
.tl-g-grid { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(255,255,255,.035); pointer-events: none; }
.tl-g-grid.major { background: rgba(227,179,65,.12); }
.tl-g-now { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--danger); box-shadow: 0 0 10px rgba(239,107,115,.6);
  pointer-events: none; z-index: 4; }
.tl-bar { position: absolute; height: 24px; border-radius: 7px; padding: 0 8px; display: flex; align-items: center;
  font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden; cursor: pointer; z-index: 2;
  transition: filter .12s, box-shadow .12s; box-sizing: border-box; }
.tl-bar:hover { filter: brightness(1.18); box-shadow: 0 0 0 2px rgba(255,255,255,.55), 0 6px 16px rgba(0,0,0,.4); z-index: 5; }
.tl-bar.ev { color: #15120a; box-shadow: inset 0 -2px 0 rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.3); }
.tl-bar.md { color: #e9ebef; border: 1px solid; font-weight: 500; }
.tl-bar.md.clip { height: 18px; margin-top: 3px; }
.tl-bar.narrow { padding: 0; color: transparent !important; }
.tl-bar.ext { background: linear-gradient(90deg, var(--c) 0 var(--rw), var(--cs) var(--rw)) !important; }
.tl-bar.ev.ext { color: var(--text); text-shadow: 0 1px 2px rgba(0,0,0,.6); }
.tl-bar.ev.ext .lbl { padding-left: max(0px, calc(var(--rw) - 4px)); }
.tl-mark.bm { border-radius: 2px 2px 0 0; transform: none; width: 9px; height: 12px; margin-top: -4px; margin-left: 1px;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 70%, 0 100%); border: 0; }
.tl-mark.bm:hover { transform: scale(1.35); }
.tl-mark.bm.rng { height: 5px; margin-top: -3px; clip-path: none; border-radius: 3px; opacity: .85; }
.tl-bar .lbl { overflow: hidden; text-overflow: ellipsis; position: sticky; left: 4px; }
.tl-mark { position: absolute; width: 11px; height: 11px; margin-top: 6.5px; transform: rotate(45deg); background: var(--danger);
  border: 2px solid #111; z-index: 6; cursor: pointer; border-radius: 2px; }
.tl-mark:hover { transform: rotate(45deg) scale(1.3); }
.tl-hover { position: fixed; z-index: 260; pointer-events: none; width: 290px; padding: 11px 13px; border-radius: 12px;
  background: rgba(28,33,41,.97); border: 1px solid var(--border-2); box-shadow: var(--shadow); backdrop-filter: blur(8px);
  font-size: 12.5px; animation: fade .1s; }
.tl-hover .t { font-weight: 600; font-size: 13.5px; margin-bottom: 3px; }
.tl-hover .l { color: var(--text-2); display: flex; gap: 6px; align-items: center; margin-top: 2px; }
.tl-hover .l i { font-size: 13px; color: var(--text-3); }
.tl-hover img { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 8px; margin-bottom: 8px; display: block; }
.tl-hover .x { color: var(--text-2); margin-top: 6px; font-size: 12px; line-height: 1.5; }
.tl-hover .hint { color: var(--text-3); font-size: 11px; margin-top: 7px; }
.tl-g-empty { position: absolute; inset: 40px 0 0; display: grid; place-items: center; pointer-events: none; }

/* ---------- Kalendář ---------- */
.tl-cal { position: absolute; inset: 0; display: flex; gap: 0; border-top: 1px solid var(--border); }
.tl-cal-main { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 12px 18px 18px 24px; }
.tl-cal-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tl-cal-head h2 { margin: 0 8px; font: 600 20px var(--font-display); text-transform: capitalize; min-width: 190px; }
.tl-cal-dow { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-bottom: 6px; }
.tl-cal-dow div { color: var(--text-3); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; padding-left: 8px; }
.tl-cal-weeks { flex: 1; display: flex; flex-direction: column; gap: 6px; min-height: 0; overflow: auto; }
.tl-cal-week { flex: 1; position: relative; display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; min-height: 122px; }
.tl-cal-day { position: relative; border-radius: 11px; background: var(--surface); border: 1px solid var(--border);
  padding: 6px 8px; cursor: pointer; overflow: hidden; transition: border-color .15s, background .15s; }
.tl-cal-day:hover { border-color: var(--border-2); background: var(--surface-2); }
.tl-cal-day.out { opacity: .38; }
.tl-cal-day.today .n { background: var(--accent); color: var(--accent-ink); }
.tl-cal-day.sel { border-color: rgba(227,179,65,.7); box-shadow: 0 0 0 3px rgba(227,179,65,.15); }
.tl-cal-day .n { display: inline-grid; place-items: center; min-width: 24px; height: 24px; border-radius: 7px; font-weight: 600;
  font-size: 12.5px; padding: 0 4px; }
.tl-cal-day .heat { position: absolute; inset: 0; pointer-events: none; background: var(--accent); }
.tl-cal-day .rec { position: absolute; left: 8px; right: 8px; bottom: 6px; display: flex; align-items: center; gap: 6px;
  font-size: 10.5px; color: var(--text-3); }
.tl-cal-day .rec .b { flex: 1; height: 4px; border-radius: 4px; background: rgba(255,255,255,.06); overflow: hidden; }
.tl-cal-day .rec .b i { display: block; height: 100%; background: linear-gradient(90deg, #5aa9e6, #e3b341); border-radius: 4px; }
.tl-cal-ev { position: absolute; height: 20px; border-radius: 6px; padding: 0 7px; font-size: 11.5px; font-weight: 600;
  color: #15120a; display: flex; align-items: center; white-space: nowrap; overflow: hidden; cursor: pointer; z-index: 2;
  box-shadow: 0 2px 6px rgba(0,0,0,.3); }
.tl-cal-ev:hover { filter: brightness(1.15); }
.tl-cal-ev .lbl { overflow: hidden; text-overflow: ellipsis; }
.tl-cal-more { position: absolute; font-size: 11px; color: var(--text-2); z-index: 2; padding-left: 8px; cursor: pointer; }
.tl-cal-side { width: 360px; flex: none; border-left: 1px solid var(--border); background: var(--bg-2); overflow: auto;
  padding: 16px 18px; animation: slidein .2s var(--ease); }
.tl-cal-side h3 { margin: 0; font: 600 16px var(--font-display); text-transform: capitalize; }
.tl-cal-side .evr { display: flex; gap: 10px; padding: 9px 10px; border-radius: 10px; background: var(--surface);
  border: 1px solid var(--border); cursor: pointer; margin-bottom: 6px; align-items: flex-start; }
.tl-cal-side .evr:hover { border-color: var(--border-2); }
.tl-cal-side .evr .c { width: 4px; align-self: stretch; border-radius: 4px; flex: none; }
.tl-cal-side .mgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tl-cal-side .mcap { font-size: 11.5px; color: var(--text-2); margin-top: 3px; }
`;
(() => { const s = document.createElement('style'); s.textContent = TL_CSS; document.head.appendChild(s); })();

/* ============================================================ helpers */
const TL_STEPS = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800];
const TL_ROW = 24, TL_ROW_GAP = 6, TL_LANE_PAD = 10;

function tlPack(items) {
  const ends = [], rows = [];
  items.slice().sort((a, b) => a.start - b.start).forEach(it => {
    let r = ends.findIndex(e => it.start >= e);
    if (r < 0) { r = ends.length; ends.push(0); rows.push([]); }
    ends[r] = Math.max(it.end, it.start);
    rows[r].push(it);
  });
  return rows;
}

function tlMidnight(t) { const d = new Date(t * 1000); d.setHours(0, 0, 0, 0); return d; }
function tlDayKey(d) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

/** Axis ticks for [t0, t1] at the given pixels-per-second. */
function tlTicks(t0, t1, pps) {
  const minPx = 86;
  const out = [];
  const step = TL_STEPS.find(s => s * pps >= minPx);
  if (!step) {
    const monthPx = 30.4 * 86400 * pps;
    const mstep = monthPx >= minPx ? 1 : monthPx * 3 >= minPx ? 3 : monthPx * 6 >= minPx ? 6 : 12;
    const d = new Date(t0 * 1000); d.setDate(1); d.setHours(0, 0, 0, 0);
    d.setMonth(Math.floor(d.getMonth() / mstep) * mstep);
    while (d.getTime() / 1000 <= t1 && out.length < 400) {
      const t = d.getTime() / 1000;
      out.push({ t, major: d.getMonth() === 0,
        label: mstep >= 12 ? String(d.getFullYear()) : MONTHS[d.getMonth()], sub: mstep >= 12 ? '' : String(d.getFullYear()) });
      d.setMonth(d.getMonth() + mstep);
    }
    return out;
  }
  if (step >= 86400) {
    const d = tlMidnight(t0);
    if (step === 604800) { const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); }
    const days = Math.round(step / 86400);
    while (d.getTime() / 1000 <= t1 && out.length < 500) {
      const t = d.getTime() / 1000;
      const major = step === 604800 ? d.getDate() <= 7 : d.getDate() === 1;
      out.push({ t, major,
        label: step === 604800 ? `${d.getDate()}. ${d.getMonth() + 1}.` : `${DAYS_SHORT[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`,
        sub: major ? MONTHS[d.getMonth()] : '' });
      d.setDate(d.getDate() + days);
    }
    return out;
  }
  // sub-day steps, aligned to local midnight of the first visible day
  const day = tlMidnight(t0);
  let base = day.getTime() / 1000;
  let t = base + Math.floor((t0 - base) / step) * step;
  while (t <= t1 && out.length < 600) {
    const d = new Date(t * 1000);
    const isMid = d.getHours() === 0 && d.getMinutes() === 0;
    out.push({ t, major: isMid, label: isMid ? `${d.getDate()}. ${d.getMonth() + 1}.` : `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      sub: isMid ? DAYS[d.getDay()] : '' });
    t += step;
  }
  return out;
}

/* ============================================================ Gantt engine */
class TlGantt {
  /**
   * opts: { labelWidth, corner (Node), onItemClick(item, t, ev), emptyNode }
   * lanes: [{ label: Node, onLabelClick, rows: [[item]] }]
   * item: { start, end, kind: 'bar'|'marker', cls, color, text, hover(): Node, payload }
   */
  constructor(host, opts = {}) {
    this.opts = opts;
    this.labelW = opts.labelWidth || 190;
    this.viewStart = Date.now() / 1000 - 43200;
    this.pps = 0.01;
    this.nodes = [];
    this.raf = 0;
    this.axis = h('.tl-g-axis');
    this.labels = h('.tl-g-labels', { style: { width: this.labelW + 'px' } });
    this.canvas = h('.tl-g-canvas');
    this.gridLayer = h('div', { style: { position: 'absolute', inset: 0, pointerEvents: 'none' } });
    this.nowLine = h('.tl-g-now');
    this.body = h('.tl-g-body', this.labels, this.canvas);
    this.el = h('.tl-g',
      h('.tl-g-top', h('.tl-g-corner', { style: { width: this.labelW + 'px' } }, opts.corner || ''), this.axis),
      this.body);
    host.appendChild(this.el);
    this.hover = h('.tl-hover.hidden');
    overlayRoot().appendChild(this.hover);
    this._wire();
    this.ro = new ResizeObserver(() => this.schedule());
    this.ro.observe(this.canvas);
  }

  destroy() {
    this.ro.disconnect();
    this.hover.remove();
    cancelAnimationFrame(this.raf);
    window.removeEventListener('mousemove', this._mm);
    window.removeEventListener('mouseup', this._mu);
  }

  get width() { return Math.max(100, this.canvas.clientWidth); }

  setLanes(lanes) {
    this.lanes = lanes;
    clear(this.canvas); clear(this.labels);
    this.canvas.appendChild(this.gridLayer);
    this.canvas.appendChild(this.nowLine);
    this.nodes = []; this.rowNodes = [];
    let y = 0, b0 = Infinity, b1 = -Infinity;
    lanes.forEach(lane => {
      const rows = lane.rows.length || 1;
      const hgt = TL_LANE_PAD * 2 + rows * TL_ROW + (rows - 1) * TL_ROW_GAP;
      const laneH = Math.max(hgt, lane.minHeight || 52);
      this.canvas.appendChild(h('.tl-g-lane', { style: { top: y + 'px', height: laneH + 'px' } }));
      const lab = h('.tl-g-lab' + (lane.onLabelClick ? '.click' : ''), { style: { top: y + 'px', height: laneH + 'px' },
        onclick: lane.onLabelClick || null }, lane.label);
      this.labels.appendChild(lab);
      lane.rows.forEach((row, ri) => {
        const ry = y + TL_LANE_PAD + ri * (TL_ROW + TL_ROW_GAP);
        const bars = [];
        this.rowNodes.push(bars);
        row.forEach(it => {
          let el;
          if (it.kind === 'marker') {
            el = h('.tl-mark' + (it.cls ? '.' + it.cls.split(' ').join('.') : ''), { style: { top: ry + 'px', background: it.color || null } });
          } else {
            el = h('.tl-bar' + (it.cls ? '.' + it.cls.split(' ').join('.') : ''), { style: { top: ry + 'px' } },
              h('span.lbl', it.text || ''));
            if (it.color) {
              if ((it.cls || '').includes('md')) {
                el.style.background = it.color + '33';
                el.style.borderColor = it.color + 'aa';
                el.style.setProperty('--c', it.color + '66'); el.style.setProperty('--cs', it.color + '1c');
              } else {
                el.style.background = it.color;
                el.style.setProperty('--c', it.color); el.style.setProperty('--cs', it.color + '40');
              }
            }
          }
          el._item = it;
          this.canvas.appendChild(el);
          this.nodes.push({ el, it });
          if (it.kind !== 'marker') bars.push({ el, it });
          if (it.start < b0) b0 = it.start;
          if (it.end > b1) b1 = it.end;
        });
        bars.sort((a, b) => a.it.start - b.it.start);
      });
      y += laneH;
    });
    const total = Math.max(y, 10);
    this.canvas.style.height = total + 'px';
    this.labels.style.height = total + 'px';
    this.canvas.style.minHeight = total + 'px';
    this.bounds = isFinite(b0) ? [b0, b1] : null;
    if (this.emptyEl) { this.emptyEl.remove(); this.emptyEl = null; }
    if (!this.nodes.length && this.opts.emptyNode) {
      this.emptyEl = h('.tl-g-empty', this.opts.emptyNode);
      this.el.appendChild(this.emptyEl);
    }
    this.schedule();
  }

  fit() {
    if (!this.bounds) return this.today();
    const [a, b] = this.bounds;
    const span = Math.max(3600, b - a);
    this.pps = this.width / (span * 1.08);
    this.viewStart = a - span * 0.04;
    this.schedule(); this._changed();
  }

  today() {
    const now = Date.now() / 1000, span = 86400;
    this.pps = this.width / span;
    this.viewStart = now - span * 0.7;
    this.schedule(); this._changed();
  }

  setView(viewStart, pps) { this.viewStart = viewStart; this.pps = pps; this.schedule(); }

  zoomAt(x, factor) {
    const t = this.viewStart + x / this.pps;
    this.pps = Math.min(4, Math.max(1e-7, this.pps * factor));
    this.viewStart = t - x / this.pps;
    this.schedule(); this._changed();
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  _changed() { this.opts.onView && this.opts.onView(this.viewStart, this.pps); }

  render() {
    const W = this.width, pps = this.pps, t0 = this.viewStart, t1 = t0 + W / pps;
    for (const { el, it } of this.nodes) {
      if (it.kind !== 'marker') continue;
      const x = (it.start - t0) * pps;
      if (x < -20 || x > W + 20) { el.style.display = 'none'; continue; }
      el.style.display = '';
      if (it.end > it.start + 1) {   // range marker
        el.style.left = x + 'px'; el.style.width = Math.max(4, (it.end - it.start) * pps) + 'px';
      } else el.style.left = (x - 5.5) + 'px';
    }
    for (const bars of this.rowNodes) {
      for (let i = 0; i < bars.length; i++) {
        const { el, it } = bars[i];
        const x = (it.start - t0) * pps;
        const real = Math.max(it.minW || 4, (it.end - it.start) * pps);
        const nextX = i + 1 < bars.length ? (bars[i + 1].it.start - t0) * pps : Infinity;
        // short bar with room to its right -> widen to fit its label (and be easy to hit)
        const want = Math.min(280, 30 + (it.text || '').length * 6.8);
        const room = nextX - x - 5;
        const w = real >= want ? real : Math.max(real, Math.min(want, room));
        if (x + w < -40 || x > W + 40) { el.style.display = 'none'; continue; }
        el.style.display = '';
        // clamp to the viewport so labels of long bars stay readable
        const cx = Math.max(-2, x), cw = Math.min(x + w, W + 40) - cx;
        el.style.left = cx + 'px'; el.style.width = Math.max(3, cw) + 'px';
        const ext = w > real + 2;
        el.classList.toggle('ext', ext);
        if (ext) el.style.setProperty('--rw', Math.max(3, real - (cx - x)) + 'px');
        el.classList.toggle('narrow', cw < 34);
      }
    }
    // axis + grid
    clear(this.axis); clear(this.gridLayer);
    for (const tk of tlTicks(t0, t1, pps)) {
      const x = (tk.t - t0) * pps;
      if (x < -200 || x > W + 10) continue;
      this.axis.appendChild(h('.tl-tick' + (tk.major ? '.major' : ''), { style: { left: x + 'px' } },
        tk.label, tk.sub ? h('span.sub', tk.sub) : null));
      this.gridLayer.appendChild(h('.tl-g-grid' + (tk.major ? '.major' : ''), { style: { left: x + 'px' } }));
    }
    const now = Date.now() / 1000;
    if (now >= t0 && now <= t1) { this.nowLine.style.display = ''; this.nowLine.style.left = ((now - t0) * pps) + 'px'; }
    else this.nowLine.style.display = 'none';
    this.opts.onRender && this.opts.onRender(t0, t1);
  }

  _wire() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, start: this.viewStart, moved: false, target: e.target };
      c.classList.add('drag');
    });
    this._mm = e => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 3) drag.moved = true;
      if (drag.moved) { this.viewStart = drag.start - dx / this.pps; this.schedule(); this._hideHover(); }
    };
    this._mu = e => {
      if (!drag) return;
      c.classList.remove('drag');
      const d = drag; drag = null;
      if (d.moved) { this._changed(); return; }
      const node = d.target.closest && d.target.closest('.tl-bar, .tl-mark');
      if (node && node._item && this.opts.onItemClick) {
        const rect = c.getBoundingClientRect();
        const t = this.viewStart + (e.clientX - rect.left) / this.pps;
        this.opts.onItemClick(node._item, t, e);
      }
    };
    window.addEventListener('mousemove', this._mm);
    window.addEventListener('mouseup', this._mu);
    this.body.addEventListener('wheel', e => {
      if (this.labels.contains(e.target) && !e.ctrlKey) return; // native vertical scroll over lane labels
      const rect = c.getBoundingClientRect();
      if (e.ctrlKey) {
        e.preventDefault();
        this.zoomAt(e.clientX - rect.left, e.deltaY < 0 ? 1.18 : 1 / 1.18);
      } else if (e.shiftKey) {
        // native vertical scrolling of lanes
        e.preventDefault();
        this.body.scrollTop += e.deltaY;
      } else {
        e.preventDefault();
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        this.viewStart += d / this.pps;
        this.schedule(); this._changedDebounced();
      }
    }, { passive: false });
    this._changedDebounced = debounce(() => this._changed(), 250);
    // hover card
    c.addEventListener('mousemove', e => {
      if (drag && drag.moved) return;
      const node = e.target.closest && e.target.closest('.tl-bar, .tl-mark');
      if (!node || !node._item || !node._item.hover) { this._hideHover(); return; }
      if (this._hoverItem !== node._item) {
        this._hoverItem = node._item;
        clear(this.hover).appendChild(node._item.hover());
        this.hover.classList.remove('hidden');
      }
      const r = this.hover.getBoundingClientRect();
      let x = e.clientX + 16, y = e.clientY + 16;
      if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 16;
      if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 12;
      this.hover.style.left = x + 'px'; this.hover.style.top = y + 'px';
    });
    c.addEventListener('mouseleave', () => this._hideHover());
  }

  _hideHover() { this._hoverItem = null; this.hover.classList.add('hidden'); }
}

/* ============================================================ hover cards */
function tlEventHover(e) {
  const chars = tlEventChars(e.id);
  return h('div',
    e.cover ? h('img', { src: e.cover }) : null,
    h('.row', h('span.dot', { style: { background: e.color } }), h('.t', e.title)),
    h('.l', icon('calendar'), fmt.range(e.start_time, e.end_time)),
    e.ingame_date ? h('.l', icon('scroll'), e.ingame_date) : null,
    e.location ? h('.l', icon('map-pin'), e.location) : null,
    e.excerpt ? h('.x', e.excerpt) : null,
    chars.length ? h('.row', { style: { marginTop: '8px' } }, avatarStack(chars, 22, 7)) : null,
    h('.hint', 'Klikni pro otevření události'));
}

function tlMediaHover(m) {
  return h('div',
    m.thumb ? h('img', { src: m.thumb }) : null,
    h('.t', m.name),
    h('.l', h('span.badge.' + m.type, KIND[m.type]?.label || m.type), h('span', m.game)),
    h('.l', icon('clock'), fmt.range(m.start, m.end)),
    h('.l', icon('timer'), fmt.dur(m.duration)),
    (m.tags || []).length ? h('.l', h('span.tag', m.tags.map(t => '#' + t).join(' '))) : null,
    h('.hint', 'Klik = přehrát od tohoto místa'));
}

/* ============================================================ state */
const TL = {
  root: null, body: null, data: null, gantt: null, unsubs: [],
  f: { q: '', chars: new Set(), tag: '', rootsOnly: false },
  cal: null, calSel: null,
  evCharMap: new Map(), roleMap: new Map(),
};

function tlEventChars(id) { return TL.evCharMap.get(id) || []; }

function tlIndex() {
  const d = TL.data;
  TL.evCharMap = new Map(); TL.roleMap = new Map();
  for (const e of d.events) TL.evCharMap.set(e.id, [...(e.chars || [])]);
  for (const ec of d.event_chars) {
    const arr = TL.evCharMap.get(ec.event_id) || [];
    if (!arr.includes(ec.char_id)) arr.push(ec.char_id);
    TL.evCharMap.set(ec.event_id, arr);
    if (ec.role) TL.roleMap.set(ec.event_id + ':' + ec.char_id, ec.role);
  }
  TL.linksByEvent = new Map(); TL.linksByMedia = new Map();
  for (const l of d.links) {
    (TL.linksByEvent.get(l.event_id) || TL.linksByEvent.set(l.event_id, []).get(l.event_id)).push(l);
    (TL.linksByMedia.get(l.media_id) || TL.linksByMedia.set(l.media_id, []).get(l.media_id)).push(l);
  }
  TL.evById = new Map(d.events.map(e => [e.id, e]));
  TL.bmByMedia = new Map();
  for (const b of d.bookmarks || []) (TL.bmByMedia.get(b.media_id) || TL.bmByMedia.set(b.media_id, []).get(b.media_id)).push(b);
}

function tlFilteredEvents() {
  const f = TL.f, words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  return TL.data.events.filter(e => {
    if (!inScope(e)) return false;
    if (f.rootsOnly && e.parent_id) return false;
    if (f.tag && !(e.tags || []).includes(f.tag)) return false;
    if (f.chars.size && !tlEventChars(e.id).some(c => f.chars.has(c))) return false;
    if (words.length) {
      const hay = [e.title, e.excerpt, e.location, e.ingame_date, (e.tags || []).map(t => '#' + t).join(' ')].join(' ').toLowerCase();
      if (!words.every(w => hay.includes(w))) return false;
    }
    return true;
  });
}

function tlFilteredMedia(visibleEvents) {
  const f = TL.f, words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const evIds = new Set(visibleEvents.map(e => e.id));
  const linkedToVisible = m => (TL.linksByMedia.get(m.id) || []).some(l => evIds.has(l.event_id));
  const anyFilter = words.length || f.chars.size || f.tag || f.rootsOnly;
  return App.media.filter(m => {
    if (!m.start || !inScope(m, 'media')) return false;
    if (!anyFilter) return true;
    const linked = linkedToVisible(m);
    if (f.tag && !(m.tags || []).includes(f.tag) && !linked) return false;
    if (f.chars.size && !(m.chars || []).some(c => f.chars.has(c)) && !linked) return false;
    if (words.length && !linked) {
      const hay = [m.name, m.game, (m.tags || []).map(t => '#' + t).join(' ')].join(' ').toLowerCase();
      if (!words.every(w => hay.includes(w))) return false;
    }
    return true;
  });
}

/* ============================================================ view */
Views.register('timeline', {
  title: 'Časová osa', short: 'Osa', icon: 'chart-gantt', order: 40,

  mount(root, params = {}) {
    TL.root = root;
    if (params.mode) App.ui.timelineMode = params.mode;
    const mode = App.ui.timelineMode || 'chron';
    TL.mode = mode;

    const seg = h('.seg',
      ...[['chron', 'scroll-text', 'Kronika'], ['gantt', 'chart-gantt', 'Osa'], ['cal', 'calendar-days', 'Kalendář'], ['chars', 'users', 'Postavy']]
        .map(([k, ic, label]) => h('button' + (k === mode ? '.on' : ''), { 'data-mode': k, onclick: () => tlSetMode(k) }, icon(ic), label)));
    TL.sub = h('.sub', '');
    const head = h('.page-head', h('div', h('h1', 'Časová osa'), TL.sub), h('.grow'), seg);

    TL.filterBar = h('.tl-filters');
    TL.body = h('.tl-body');
    root.appendChild(h('.tl-page', head, TL.filterBar, TL.body));

    TL.unsubs = [
      App.on('events', () => tlLoad()),
      App.on('chars', () => tlLoad()),
      App.on('media', () => TL.data && tlRender()),
    ];
    TL.body.appendChild(h('.empty', icon('loader'), h('div', 'Načítám…')));
    tlLoad();
  },

  unmount() {
    TL.unsubs.forEach(u => u && u());
    TL.unsubs = [];
    if (TL.gantt) { TL.gantt.destroy(); TL.gantt = null; }
    TL.root = null;
  },
});

async function tlLoad() {
  const data = await API.call('timeline.data');
  if (!TL.root) return;
  TL.data = data;
  tlIndex();
  tlBuildFilters();
  tlRender();
}

function tlSetMode(mode) {
  TL.mode = mode;
  App.ui.timelineMode = mode; App.saveUi();
  $$('.page-head .seg button', TL.root).forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  tlBuildFilters();
  tlRender();
}

function tlBuildFilters() {
  const bar = clear(TL.filterBar), f = TL.f;
  const q = h('input.input', { placeholder: 'Hledat v událostech a záznamech…', value: f.q });
  q.addEventListener('input', debounce(() => { f.q = q.value; tlRender(); }, 200));
  q.addEventListener('keydown', e => e.stopPropagation());
  bar.appendChild(h('.search', icon('search'), q));

  const charBtn = h('button.btn' + (f.chars.size ? '.active' : ''), {
    onclick: async () => {
      const ids = await pickCharacters([...f.chars], { title: 'Filtrovat podle postav' });
      if (ids) { f.chars = new Set(ids); tlBuildFilters(); tlRender(); }
    },
  }, icon('users'), f.chars.size ? `Postavy (${f.chars.size})` : 'Postavy');
  bar.appendChild(charBtn);
  for (const id of f.chars) {
    const c = App.charsById.get(id);
    if (c) bar.appendChild(charChip(c, { onClick: () => {}, onRemove: () => { f.chars.delete(id); tlBuildFilters(); tlRender(); } }));
  }

  const tags = new Set();
  (TL.data?.events || []).forEach(e => (e.tags || []).forEach(t => tags.add(t)));
  App.media.forEach(m => (m.tags || []).forEach(t => tags.add(t)));
  const sel = h('select.input', { onchange: e => { f.tag = e.target.value; tlRender(); } },
    h('option', { value: '' }, 'Všechny štítky'),
    [...tags].sort().map(t => h('option', { value: t, selected: f.tag === t ? true : null }, '#' + t)));
  bar.appendChild(sel);

  bar.appendChild(h('label.check', h('input', { type: 'checkbox', checked: f.rootsOnly, onchange: e => { f.rootsOnly = e.target.checked; tlRender(); } }),
    'Jen hlavní události'));

  if (f.q || f.chars.size || f.tag || f.rootsOnly) {
    bar.appendChild(h('button.btn.ghost.sm', { onclick: () => { TL.f = { q: '', chars: new Set(), tag: '', rootsOnly: false }; tlBuildFilters(); tlRender(); } },
      icon('x'), 'Zrušit filtry'));
  }

  const hints = {
    gantt: 'Kolečko = posun · Ctrl+kolečko = zoom · Shift+kolečko = svisle · tažení = posun',
    chars: 'Ctrl+kolečko = zoom · tažení = posun',
    cal: 'Klikni na den pro detail',
    chron: '',
  };
  if (hints[TL.mode]) bar.appendChild(h('.tl-hint', hints[TL.mode]));
}

function tlRender() {
  if (!TL.root || !TL.data) return;
  const events = tlFilteredEvents();
  const media = tlFilteredMedia(events);
  const total = TL.data.events.length;
  TL.sub.textContent = total
    ? `${events.length} z ${total} ${fmt.plural(total, 'události', 'událostí', 'událostí')} · ${media.length} záznamů`
    : `Zatím žádné události · ${App.media.length} záznamů`;

  // Gantt instances survive only within the same mode
  const ganttMode = TL.mode === 'gantt' || TL.mode === 'chars';
  if (TL.gantt && (!ganttMode || TL.gantt._mode !== TL.mode)) { TL.gantt.destroy(); TL.gantt = null; clear(TL.body); }
  if (!ganttMode) clear(TL.body);

  if (TL.mode === 'chron') tlRenderChron(events);
  else if (TL.mode === 'gantt') tlRenderGantt(events, media);
  else if (TL.mode === 'cal') tlRenderCal(events, media);
  else if (TL.mode === 'chars') tlRenderChars(events);
}

/* ============================================================ 1) Kronika */
function tlRenderChron(events) {
  const wrap = h('.tl-chron-wrap');
  TL.body.appendChild(wrap);
  if (!TL.data.events.length) {
    wrap.appendChild(emptyState('scroll-text', 'Kronika je zatím prázdná',
      'Vytvoř první událost – ručně, nebo nech aplikaci navrhnout události z tvých záznamů.',
      h('.row', { style: { marginTop: '6px' } },
        h('button.btn.primary', { onclick: () => App.go('events', { create: true }) }, icon('plus'), 'Nová událost'),
        h('button.btn', { onclick: () => App.go('events', { propose: true }) }, icon('sparkles'), 'Navrhnout ze záznamů'))));
    return;
  }
  if (!events.length) {
    wrap.appendChild(emptyState('search-x', 'Nic neodpovídá filtru', 'Zkus upravit hledání nebo zrušit filtry.'));
    return;
  }
  const visible = new Set(events.map(e => e.id));
  const top = events.filter(e => !e.parent_id || !visible.has(e.parent_id));
  const dated = top.filter(e => e.start_time);
  const undated = top.filter(e => !e.start_time);
  const stream = dated.map(e => ({ t: e.start_time, type: 'ev', e }));
  for (const en of TL.data.entries) {
    if (visible.has(en.event_id) && en.time) stream.push({ t: en.time, type: 'entry', en });
  }
  stream.sort((a, b) => a.t - b.t || (a.type === 'ev' ? -1 : 1));

  const chron = h('.tl-chron');
  let lastMonth = null, lastDay = null, side = 0;
  for (const it of stream) {
    const d = new Date(it.t * 1000);
    const mk = d.getFullYear() * 12 + d.getMonth();
    if (mk !== lastMonth) { chron.appendChild(h('.tl-month', h('span', fmt.month(it.t)))); lastMonth = mk; lastDay = null; }
    const dk = tlDayKey(d);
    if (dk !== lastDay) { chron.appendChild(h('.tl-day', h('span', fmt.dateLong(it.t)))); lastDay = dk; }
    const right = side++ % 2 === 1;
    if (it.type === 'ev') {
      const item = h('.tl-item' + (right ? '.right' : ''), tlEventCard(it.e, visible));
      item.style.setProperty('--node', it.e.color || 'var(--accent)');
      chron.appendChild(item);
    } else {
      const ev = TL.evById.get(it.en.event_id);
      chron.appendChild(h('.tl-item.note' + (right ? '.right' : ''),
        h('.tl-note', { onclick: () => App.go('events', { id: it.en.event_id, entry: it.en.id }) },
          h('.h', icon('notebook-pen'), h('span', fmt.time(it.t)), h('b', it.en.title || 'Zápis'),
            ev ? h('span', '· ' + ev.title) : null, it.en.ingame_date ? h('span', { style: { color: 'var(--accent-2)' } }, '· ' + it.en.ingame_date) : null),
          it.en.excerpt ? h('.x', it.en.excerpt) : null)));
    }
  }
  wrap.appendChild(chron);

  if (undated.length) {
    wrap.appendChild(h('.tl-undated',
      h('.section-title', icon('calendar-off'), 'Bez data', h('.line')),
      h('.grid', undated.map(e => tlEventCard(e, visible)))));
  }
}

function tlEventCard(e, visible) {
  const chars = tlEventChars(e.id);
  const links = (TL.linksByEvent.get(e.id) || []);
  const mediaIds = [...new Set(links.map(l => l.media_id))].filter(id => App.mediaById.has(id));
  const thumbs = mediaIds.slice(0, 4).map((id, i) => {
    const m = App.mediaById.get(id);
    return h('.t', { title: m.name, onclick: ev => { ev.stopPropagation(); API.call('media.play', { id }); } },
      m.thumb ? h('img', { src: m.thumb, loading: 'lazy' }) : null,
      i === 3 && mediaIds.length > 4 ? h('.more', '+' + (mediaIds.length - 3)) : null);
  });
  const kids = TL.f.rootsOnly ? [] : (TL.data.events.filter(c => c.parent_id === e.id && visible.has(c.id))
    .sort((a, b) => (a.start_time || 0) - (b.start_time || 0) || a.position - b.position));

  return h('.tl-card', { onclick: () => App.go('events', { id: e.id }) },
    h('.bar', { style: { background: e.color || 'var(--accent)' } }),
    e.cover ? h('.cover', { style: { backgroundImage: `url("${e.cover}")` } }) : null,
    h('.inner',
      h('h3', e.title),
      h('.meta',
        h('span', icon('calendar'), fmt.range(e.start_time, e.end_time)),
        e.ingame_date ? h('span.ig', icon('scroll'), e.ingame_date) : null,
        e.location ? h('span', icon('map-pin'), e.location) : null),
      e.excerpt ? h('p.ex', e.excerpt) : null,
      thumbs.length ? h('.tl-thumbs', thumbs) : null,
      h('.foot',
        chars.length ? avatarStack(chars, 24, 6) : null,
        (e.tags || []).length ? h('span.tag', e.tags.slice(0, 4).map(t => '#' + t).join(' ')) : null,
        h('.counts',
          e.link_count ? h('span', { title: 'Odkazy na záznamy' }, icon('film'), e.link_count) : null,
          e.bm_count ? h('span', { title: 'Momenty (záložky)' }, icon('bookmark'), e.bm_count) : null,
          e.entry_count ? h('span', { title: 'Zápisy' }, icon('notebook-pen'), e.entry_count) : null,
          e.att_count ? h('span', { title: 'Přílohy' }, icon('paperclip'), e.att_count) : null)),
      kids.length ? tlSubList(kids, visible) : null));
}

function tlSubList(kids, visible) {
  return h('.tl-subs', kids.map(k => {
    const grand = TL.data.events.filter(c => c.parent_id === k.id && visible.has(c.id))
      .sort((a, b) => (a.start_time || 0) - (b.start_time || 0));
    const chars = tlEventChars(k.id);
    return h('.tl-sub-wrap',
      h('.tl-sub', { onclick: ev => { ev.stopPropagation(); App.go('events', { id: k.id }); } },
        h('span.dot', { style: { background: k.color } }),
        h('span.t.ellipsis', k.title),
        chars.length ? avatarStack(chars, 18, 4) : null,
        h('span.m', k.start_time ? fmt.range(k.start_time, k.end_time) : (k.ingame_date || 'bez data'))),
      grand.length ? tlSubList(grand, visible) : null);
  }));
}

/* ============================================================ 2) Osa (Gantt) */
function tlLaneLabel(ic, title, sub, color) {
  return h('.row', { style: { alignItems: 'flex-start', gap: '9px', width: '100%' } },
    color ? h('span.dot', { style: { background: color, marginTop: '5px' } }) : icon(ic),
    h('.grow', h('.ttl.ellipsis', title), sub ? h('.sub', sub) : null));
}

function tlEnsureGantt(mode, opts) {
  if (TL.gantt && TL.gantt._mode === mode) return TL.gantt;
  clear(TL.body);
  const g = new TlGantt(TL.body, Object.assign({
    onView: (vs, pps) => { App.ui['tlView_' + mode] = [vs, pps]; App.saveUi(); },
    onRender: (t0, t1) => { if (TL.rangeLbl) TL.rangeLbl.textContent = `${fmt.dt(t0)} – ${fmt.dt(t1)}`; },
  }, opts));
  g._mode = mode;
  TL.gantt = g;
  g._first = true;
  return g;
}

function tlGanttControls(g) {
  // controls live in the filter bar (right side)
  TL.rangeLbl = h('span.faint.small.mono', '');
  const box = h('.row', { style: { marginLeft: 'auto' } },
    TL.rangeLbl,
    h('button.btn.sm', { onclick: () => g.zoomAt(g.width / 2, 1 / 1.5), title: 'Oddálit' }, icon('zoom-out')),
    h('button.btn.sm', { onclick: () => g.zoomAt(g.width / 2, 1.5), title: 'Přiblížit' }, icon('zoom-in')),
    h('button.btn.sm', { onclick: () => g.today() }, icon('locate-fixed'), 'Dnes'),
    h('button.btn.sm', { onclick: () => g.fit() }, icon('maximize-2'), 'Přizpůsobit'));
  const old = $('.tl-gctl', TL.filterBar);
  if (old) old.remove();
  box.classList.add('tl-gctl');
  const hint = $('.tl-hint', TL.filterBar);
  if (hint) hint.style.marginLeft = '12px';
  TL.filterBar.appendChild(box);
}

function tlRenderGantt(events, media) {
  const g = tlEnsureGantt('gantt', {
    labelWidth: 200,
    corner: h('span', icon('layers'), ' Stopy'),
    emptyNode: emptyState('calendar-x', 'Nic k zobrazení', 'Žádné události ani záznamy neodpovídají filtru.'),
    onItemClick: (it, t) => {
      if (it.payload.type === 'event') App.go('events', { id: it.payload.id });
      else if (it.payload.type === 'media') {
        const m = it.payload.m;
        API.call('media.play', { id: m.id, offset: Math.max(0, Math.min(m.duration || 0, t - m.start)) });
      } else if (it.payload.type === 'marker') {
        API.call('media.play', { id: it.payload.media_id, offset: it.payload.offset });
      } else if (it.payload.type === 'bm') {
        playBm(it.payload.b);
      }
    },
  });
  tlGanttControls(g);

  const lanes = [];
  const evItems = events.filter(e => e.start_time).map(e => ({
    start: e.start_time, end: Math.max(e.end_time || e.start_time + 1800, e.start_time + 60),
    color: e.color || '#e3b341', text: e.title, cls: 'ev', minW: 6,
    payload: { type: 'event', id: e.id }, hover: () => tlEventHover(e),
  }));
  if (evItems.length) {
    lanes.push({ label: tlLaneLabel('calendar-range', 'Události', `${evItems.length} ${fmt.plural(evItems.length, 'událost', 'události', 'událostí')}`),
      rows: tlPack(evItems) });
  }

  const byGame = new Map();
  for (const m of media) {
    if (!byGame.has(m.game)) byGame.set(m.game, []);
    byGame.get(m.game).push(m);
  }
  const games = [...byGame.entries()].map(([game, list]) => ({ game, list, total: list.reduce((s, m) => s + (m.duration || 0), 0) }))
    .sort((a, b) => b.total - a.total);
  const evTitles = new Map(TL.data.events.map(e => [e.id, e.title]));
  for (const { game, list, total } of games) {
    const mk = m => ({
      start: m.start, end: Math.max(m.end || m.start, m.start + (m.type === 'clip' ? 40 : 60)),
      color: KIND[m.type]?.color || '#9aa3b2', text: m.name, cls: 'md ' + m.type, minW: 4,
      payload: { type: 'media', m }, hover: () => tlMediaHover(m),
    });
    const sess = tlPack(list.filter(m => m.type !== 'clip').map(mk));
    const clips = tlPack(list.filter(m => m.type === 'clip').map(mk));
    const rows = [...sess, ...clips];
    // reference markers on the row of their media bar
    rows.forEach(row => {
      const extra = [];
      row.forEach(it => {
        const m = it.payload.m;
        for (const l of TL.linksByMedia.get(m.id) || []) {
          if (l.offset == null) continue;
          const t = m.start + l.offset;
          extra.push({ kind: 'marker', start: t, end: t, color: TL.evById.get(l.event_id)?.color,
            payload: { type: 'marker', media_id: m.id, offset: l.offset },
            hover: () => h('div', h('.t', evTitles.get(l.event_id) || 'Odkaz'),
              h('.l', icon('clock'), `${fmt.dt(t)} · ${fmt.dur(l.offset)} ve videu`),
              l.note ? h('.x', l.note) : null, h('.hint', 'Klik = přehrát tento okamžik')) });
        }
        for (const b of TL.bmByMedia.get(m.id) || []) {
          const t = m.start + b.t, te = b.t_end ? m.start + b.t_end : t;
          const ev = b.event_id && TL.evById.get(b.event_id);
          extra.push({ kind: 'marker', cls: 'bm' + (b.t_end ? ' rng' : ''), start: t, end: te,
            color: b.color || (ev && ev.color) || '#f2cd6b', payload: { type: 'bm', b: { ...b, media_id: m.id } },
            hover: () => h('div', h('.t', bmTitle(b)),
              h('.l', icon('clock'), `${fmt.dt(t)} · ${fmt.dur(b.t)}${b.t_end ? '–' + fmt.dur(b.t_end) : ''} ve videu`),
              ev ? h('.l', icon('calendar-range'), ev.title) : null,
              h('.hint', b.t_end ? 'Klik = přehrát úsek' : 'Klik = přehrát od záložky')) });
        }
      });
      row.push(...extra);
    });
    const nClips = list.filter(m => m.type === 'clip').length;
    lanes.push({
      label: tlLaneLabel('gamepad-2', game, `${fmt.durHuman(total)} · ${list.length - nClips} záz. · ${nClips} klipů`),
      rows,
    });
  }
  g.setLanes(lanes);
  if (g._first) {
    g._first = false;
    const saved = App.ui.tlView_gantt;
    if (saved && saved[1] > 0) { g.setView(saved[0], saved[1]); }
    else requestAnimationFrame(() => tlFitRecent(g, events, media));
  }
}

/** Initial view: the last ~2 weeks of activity (fits better than the whole history). */
function tlFitRecent(g, events, media) {
  const times = [...events.filter(e => e.start_time).map(e => e.end_time || e.start_time), ...media.map(m => m.end || m.start)];
  if (!times.length) return g.today();
  const last = Math.max(...times);
  const first = Math.min(...[...events.filter(e => e.start_time).map(e => e.start_time), ...media.map(m => m.start)]);
  const start = Math.max(first, last - 14 * 86400);
  const span = Math.max(3600, last - start);
  g.setView(start - span * 0.03, g.width / (span * 1.06));
  g._changed();
}

/* ============================================================ 4) Postavy (swimlanes) */
function tlRenderChars(events) {
  const evVisible = events.filter(e => e.start_time);
  const byChar = new Map();
  for (const e of evVisible) {
    for (const cid of tlEventChars(e.id)) {
      if (TL.f.chars.size && !TL.f.chars.has(cid)) continue;
      if (!byChar.has(cid)) byChar.set(cid, []);
      byChar.get(cid).push(e);
    }
  }
  const chars = [...byChar.keys()].map(id => App.charsById.get(id)).filter(Boolean)
    .sort((a, b) => (a.kind === 'mine' ? -1 : 0) - (b.kind === 'mine' ? -1 : 0) || a.name.localeCompare(b.name, 'cs'));

  if (!chars.length) {
    if (TL.gantt) { TL.gantt.destroy(); TL.gantt = null; }
    clear(TL.body);
    const old = $('.tl-gctl', TL.filterBar); if (old) old.remove();
    TL.body.appendChild(emptyState('users', 'Žádné postavy v událostech',
      App.chars.length
        ? 'Označ postavy v událostech (nebo je zmiň přes @ v zápisu) a uvidíš tu jejich životní linky.'
        : 'Nejdřív si založ postavy, pak je označuj v událostech.',
      h('button.btn', { onclick: () => App.go('characters') }, icon('users'), 'Databáze postav')));
    return;
  }

  const g = tlEnsureGantt('chars', {
    labelWidth: 220,
    corner: h('span', icon('users'), ' Postavy'),
    onItemClick: it => App.go('events', { id: it.payload.id }),
  });
  tlGanttControls(g);

  const lanes = chars.map(c => {
    const items = byChar.get(c.id).map(e => {
      const role = TL.roleMap.get(e.id + ':' + c.id);
      return {
        start: e.start_time, end: Math.max(e.end_time || e.start_time + 1800, e.start_time + 60),
        color: e.color || c.color || '#e3b341', text: role ? `${e.title} · ${role}` : e.title, cls: 'ev', minW: 6,
        payload: { type: 'event', id: e.id },
        hover: () => h('div', tlEventHover(e), role ? h('.l', icon('drama'), h('b', c.name + ': '), role) : null),
      };
    });
    return {
      minHeight: 56,
      onLabelClick: () => App.go('characters', { id: c.id }),
      label: h('.row', { style: { gap: '10px', width: '100%' } }, avatar(c, 32),
        h('.grow', h('.ttl.ellipsis', c.name),
          h('.sub.ellipsis', [CHAR_KIND[c.kind]?.label, c.faction].filter(Boolean).join(' · ') || `${items.length} událostí`))),
      rows: tlPack(items),
    };
  });
  g.setLanes(lanes);
  if (g._first) {
    g._first = false;
    const saved = App.ui.tlView_chars;
    if (saved && saved[1] > 0) g.setView(saved[0], saved[1]);
    else requestAnimationFrame(() => g.fit());
  }
}

/* ============================================================ 3) Kalendář */
function tlRenderCal(events, media) {
  if (!TL.cal) {
    const times = [...events.filter(e => e.start_time).map(e => e.start_time), ...media.map(m => m.start)];
    const last = times.length ? Math.max(...times) : Date.now() / 1000;
    const d = new Date(last * 1000);
    TL.cal = { y: d.getFullYear(), m: d.getMonth() };
  }
  const { y, m } = TL.cal;
  const first = new Date(y, m, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(y, m, 1 - startOffset);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const weeks = Math.ceil((startOffset + daysInMonth) / 7);
  const todayKey = tlDayKey(new Date());

  // seconds recorded per local day (overlap of each recording with the day)
  const rec = new Map();
  const gridEnd = new Date(y, m, 1 - startOffset + weeks * 7);
  const gs = gridStart.getTime() / 1000, ge = gridEnd.getTime() / 1000;
  for (const md of media) {
    const a = md.start, b = md.end || md.start;
    if (b < gs || a > ge) continue;
    const d = tlMidnight(Math.max(a, gs));
    for (let i = 0; i < 40; i++) {
      const ds = d.getTime() / 1000;
      const nd = new Date(d); nd.setDate(nd.getDate() + 1);
      const de = nd.getTime() / 1000;
      if (ds > b || ds >= ge) break;
      const ov = Math.min(b, de) - Math.max(a, ds);
      if (ov > 0) rec.set(tlDayKey(d), (rec.get(tlDayKey(d)) || 0) + ov);
      d.setDate(d.getDate() + 1);
    }
  }
  const maxRec = Math.max(3600, ...rec.values());

  const main = h('.tl-cal-main');
  const title = `${MONTHS[m]} ${y}`;
  main.appendChild(h('.tl-cal-head',
    h('button.btn.icon', { onclick: () => tlCalShift(-1), title: 'Předchozí měsíc' }, icon('chevron-left')),
    h('h2', title),
    h('button.btn.icon', { onclick: () => tlCalShift(1), title: 'Další měsíc' }, icon('chevron-right')),
    h('button.btn.sm', { onclick: () => { const d = new Date(); TL.cal = { y: d.getFullYear(), m: d.getMonth() }; TL.calSel = todayKey; TL.calSelDate = d; tlRender(); } }, 'Dnes'),
    h('.grow'),
    h('span.faint.small', icon('video'), ' ', fmt.durHuman([...rec.entries()].filter(([k]) => k.startsWith(`${y}-${m}-`)).reduce((s, [, v]) => s + v, 0)), ' nahráno v tomto měsíci')));
  main.appendChild(h('.tl-cal-dow', ['po', 'út', 'st', 'čt', 'pá', 'so', 'ne'].map(d => h('div', d))));

  const weeksEl = h('.tl-cal-weeks');
  const dated = events.filter(e => e.start_time);
  for (let w = 0; w < weeks; w++) {
    const wStart = new Date(gridStart); wStart.setDate(gridStart.getDate() + w * 7);
    const wEnd = new Date(wStart); wEnd.setDate(wStart.getDate() + 7);
    const ws = wStart.getTime() / 1000, we = wEnd.getTime() / 1000;
    const row = h('.tl-cal-week');
    for (let i = 0; i < 7; i++) {
      const d = new Date(wStart); d.setDate(wStart.getDate() + i);
      const key = tlDayKey(d);
      const secs = rec.get(key) || 0;
      const cell = h('.tl-cal-day' + (d.getMonth() !== m ? '.out' : '') + (key === todayKey ? '.today' : '') + (TL.calSel === key ? '.sel' : ''),
        { onclick: () => { TL.calSel = key; TL.calSelDate = new Date(d); tlRender(); } },
        secs ? h('.heat', { style: { opacity: (0.03 + 0.12 * Math.min(1, secs / maxRec)).toFixed(3) } }) : null,
        h('span.n', d.getDate()),
        secs ? h('.rec', { title: `Nahráno ${fmt.durHuman(secs)}` }, icon('video'), h('.b', h('i', { style: { width: Math.min(100, secs / (8 * 3600) * 100) + '%' } })),
          h('span', (secs / 3600).toFixed(1).replace('.', ',') + ' h')) : null);
      row.appendChild(cell);
    }
    // multi-day event bars, packed into lanes per week
    const wEvents = dated.filter(e => e.start_time < we && (e.end_time || e.start_time) >= ws)
      .map(e => {
        const sCol = Math.max(0, Math.floor((tlMidnight(e.start_time).getTime() / 1000 - ws) / 86400 + 0.01));
        const endT = Math.max(e.start_time, (e.end_time || e.start_time) - 1);
        const eCol = Math.min(6, Math.floor((tlMidnight(endT).getTime() / 1000 - ws) / 86400 + 0.01));
        return { e, start: sCol, end: eCol + 1 };
      }).sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const lanes = tlPack(wEvents);
    const MAXL = 3;
    lanes.slice(0, MAXL).forEach((lane, li) => lane.forEach(({ e, start, end }) => {
      row.appendChild(h('.tl-cal-ev', {
        style: { left: `calc(${start} * (100% + 6px) / 7 + 4px)`, width: `calc(${end - start} * (100% + 6px) / 7 - 14px)`,
          top: (34 + li * 23) + 'px', background: e.color || 'var(--accent)' },
        title: `${e.title}\n${fmt.range(e.start_time, e.end_time)}`,
        onclick: ev => { ev.stopPropagation(); App.go('events', { id: e.id }); },
      }, h('span.lbl', e.title)));
    }));
    if (lanes.length > MAXL) {
      const hidden = lanes.slice(MAXL).flat();
      const perCol = new Map();
      hidden.forEach(({ start, end }) => { for (let c = start; c < end; c++) perCol.set(c, (perCol.get(c) || 0) + 1); });
      perCol.forEach((n, c) => row.appendChild(h('.tl-cal-more', {
        style: { left: `calc(${c} * (100% + 6px) / 7)`, top: (34 + MAXL * 23) + 'px' },
      }, `+${n} další`)));
    }
    weeksEl.appendChild(row);
  }
  main.appendChild(weeksEl);

  const cal = h('.tl-cal', main);
  if (TL.calSel && TL.calSelDate) cal.appendChild(tlCalSide(TL.calSelDate, dated, media, rec));
  TL.body.appendChild(cal);
}

function tlCalShift(n) {
  let { y, m } = TL.cal;
  m += n;
  if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
  TL.cal = { y, m };
  tlRender();
}

function tlCalSide(day, events, media, rec) {
  const ds = new Date(day); ds.setHours(0, 0, 0, 0);
  const de = new Date(ds); de.setDate(de.getDate() + 1);
  const a = ds.getTime() / 1000, b = de.getTime() / 1000;
  const evs = events.filter(e => e.start_time < b && (e.end_time || e.start_time) >= a)
    .sort((x, y) => x.start_time - y.start_time);
  const md = media.filter(m => m.start < b && (m.end || m.start) >= a).sort((x, y) => x.start - y.start);
  const secs = rec.get(tlDayKey(ds)) || 0;
  return h('.tl-cal-side',
    h('.row', h('h3.grow', fmt.dateLong(a)),
      h('button.btn.ghost.icon.sm', { onclick: () => { TL.calSel = null; TL.calSelDate = null; tlRender(); }, title: 'Zavřít' }, icon('x'))),
    h('.small.faint', { style: { marginTop: '2px' } }, secs ? `Nahráno ${fmt.durHuman(secs)} · ${md.length} záznamů` : 'Žádné záznamy'),
    h('.section-title', icon('calendar-range'), 'Události', h('.line')),
    evs.length ? evs.map(e => h('.evr', { onclick: () => App.go('events', { id: e.id }) },
      h('.c', { style: { background: e.color } }),
      h('.grow',
        h('div', { style: { fontWeight: 600 } }, e.title),
        h('.tiny.faint', fmt.range(e.start_time, e.end_time)),
        e.excerpt ? h('.small.muted', { style: { marginTop: '4px' } }, e.excerpt.slice(0, 120)) : null),
      tlEventChars(e.id).length ? avatarStack(tlEventChars(e.id), 20, 3) : null))
      : h('.small.faint', 'Tento den nemá žádnou událost.',
        h('div', { style: { marginTop: '8px' } },
          h('button.btn.sm', { onclick: () => App.go('events', { create: true, start: a + 18 * 3600 }) }, icon('plus'), 'Nová událost'))),
    md.length ? h('.section-title', icon('film'), 'Záznamy', h('.line')) : null,
    md.length ? h('.mgrid', md.map(m => h('div', mediaTile(m), h('.mcap.ellipsis', `${fmt.time(m.start)} · ${m.name}`)))) : null);
}
