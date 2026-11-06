/* ============================================================
   Kde běží AI – this PC (Ollama, Whisper) or a paid service, with sign-in,
   price estimates and model recommendations for the user's hardware
   ============================================================ */
'use strict';

const AISetup = (() => {
document.head.appendChild(h('style', `
.ais { display: flex; flex-direction: column; gap: 14px; }
.ais-hw { display: flex; gap: 14px; align-items: center; padding: 14px 18px; }
.ais-hw > i { font-size: 26px; color: var(--accent-2); }
.ais-hw b { font-size: 14px; }
.ais-verdict { margin-left: auto; padding: 5px 10px; border-radius: 4px; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
.ais-verdict.great, .ais-verdict.ok { background: color-mix(in srgb, var(--ok) 18%, transparent); color: var(--ok); }
.ais-verdict.weak, .ais-verdict.slow { background: var(--accent-soft); color: var(--accent-2); }
.ais-verdict.none { background: color-mix(in srgb, var(--danger) 18%, transparent); color: var(--danger); }
.ais-quick { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ais-choice { text-align: left; padding: 14px 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; color: var(--text); font: inherit; }
.ais-choice:hover { border-color: var(--border-2); background: var(--surface-2); }
.ais-choice.rec { border-color: var(--accent); }
.ais-choice b { display: flex; gap: 8px; align-items: center; font-size: 14px; }
.ais-choice .tag { margin-left: auto; font-size: 11px; color: var(--accent-2); font-weight: 600; }
.ais-task { display: grid; grid-template-columns: 150px minmax(170px, 230px) minmax(200px, 1fr) 120px; gap: 10px 14px; align-items: center; padding: 10px 0; border-top: 1px solid var(--border); }
.ais-task:first-of-type { border-top: 0; }
.ais-task .nm { display: flex; gap: 8px; align-items: center; font-weight: 600; }
.ais-task .st { grid-column: 2 / -1; font-size: 12px; color: var(--text-3); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: -4px; }
.ais-task .st.warn { color: var(--accent-2); }
.ais-task .price { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.ais-task .price small { display: block; font-weight: 400; color: var(--text-3); font-size: 11px; }
.ais-total { display: flex; gap: 18px; align-items: baseline; padding-top: 10px; border-top: 1px solid var(--border); font-size: 13px; flex-wrap: wrap; }
.ais-total b { font-size: 16px; }
.ais-accts { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; margin-top: 10px; }
.ais-acct { border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.ais-acct .hd { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.ais-acct .ok { color: var(--ok); font-size: 12px; margin-left: auto; display: flex; gap: 4px; align-items: center; }
.ais-acct .no { color: var(--text-3); font-size: 12px; margin-left: auto; }
.ais-acct .links { display: flex; gap: 12px; font-size: 12px; }
.ais-acct .links a { color: var(--accent-2); cursor: pointer; }
.ais-prog { font-size: 12px; color: var(--text-2); display: flex; flex-direction: column; gap: 4px; min-width: 200px; }
@media (max-width: 900px) { .ais-task { grid-template-columns: 1fr 1fr; } .ais-task .price { text-align: left; } .ais-quick { grid-template-columns: 1fr; } }
`));

const TASKS = [
  ['speech', 'audio-lines', 'Řeč', 'Přepis toho, co zaznělo'],
  ['vision', 'scan-eye', 'Obraz', 'Popis snímků, jmenovky, postavy'],
  ['text', 'sparkles', 'Kronikář AI', 'Kapitoly, události, shrnutí'],
];
const WHISPER = [['large-v3', 'Whisper large-v3 – nejpřesnější'], ['large-v3-turbo', 'Whisper large-v3 turbo – rychlejší'],
  ['medium', 'Whisper medium – pro procesor'], ['small', 'Whisper small – slabší PC']];
const LEVEL = { great: 'Lokální AI poběží výborně', ok: 'Lokální AI poběží slušně', weak: 'Lokálně jen malé modely',
  slow: 'Lokálně jen pomalu', none: 'Lokální AI tu nepoběží' };
let info = null, progress = {};
const czk = v => v < 0.05 ? 'pod 5 haléřů' : v < 10 ? `${v.toFixed(1).replace('.', ',')} Kč` : `${Math.round(v)} Kč`;
const gbs = n => (n / 2 ** 30).toFixed(n < 10 * 2 ** 30 ? 1 : 0).replace('.', ',') + ' GB';

API.on('ai', ev => {
  progress[ev.task] = ev;
  if (ev.state === 'done' || ev.state === 'error') {
    toast(ev.msg, ev.state === 'error' ? 'err' : 'ok');
    delete progress[ev.task];
    refreshAll();
  } else {
    document.querySelectorAll(`[data-ai-task="${CSS.escape(ev.task)}"]`).forEach(el => paintProgress(el, ev));
  }
});

function paintProgress(el, ev) {
  clear(el).append(h('span', ev.msg || 'Pracuji…'),
    ev.p != null ? h('.trs-bar', h('i', { style: { width: Math.round(ev.p * 100) + '%' } })) : null);
}
function progEl(task) {
  const el = h('.ais-prog', { 'data-ai-task': task });
  if (progress[task]) paintProgress(el, progress[task]);
  return progress[task] || (info && info.busy.includes(task)) ? el : null;
}

const mounted = new Set();
function refreshAll() { for (const fn of mounted) fn(); }

async function save(values) {
  Object.assign(App.settings, values);
  await API.call('settings.set', { values: { ...values, _rescan: false } });
}

function providerFor(task, pid) {
  return info.providers.find(p => p.id === pid);
}

function localModel(task) {
  const s = App.settings, rec = info.hw;
  if (task === 'speech') return s.ai_whisper_model || rec.whisper.model;
  return (s[`ai_${task}_provider`] || 'ollama') === 'ollama' && s[`ai_${task}_model`] ? s[`ai_${task}_model`] : rec[task];
}

async function setProvider(task, pid) {
  const v = { [`ai_${task}_provider`]: pid, ai_setup_done: true };
  const p = providerFor(task, pid);
  if (task === 'speech') { if (p) v.ai_speech_model = (p.models.speech.find(m => m.default) || p.models.speech[0]).id; }
  else v[`ai_${task}_model`] = p ? (p.models[task].find(m => m.default) || p.models[task][0]).id : '';
  await save(v);
  refreshAll();
}

function taskRow(task, ic, label, sub) {
  const s = App.settings, eff = info.effective[task];
  const local = task === 'speech' ? 'local' : 'ollama';
  const pid = eff.provider, isLocal = pid === local;
  const opts = [[local, 'Tento počítač – zdarma'], ...info.providers.filter(p => p.models[task]).map(p => [p.id, p.label])];
  const provSel = h('select.input', { onchange: e => setProvider(task, e.target.value) },
    opts.map(([v, l]) => h('option', { value: v, selected: v === pid ? 'selected' : null }, l)));
  let modelSel, price = 0, status = [], warn = false;
  if (isLocal && task === 'speech') {
    const cur = localModel('speech');
    modelSel = h('select.input', { onchange: e => save({ ai_whisper_model: e.target.value }).then(refreshAll) },
      WHISPER.map(([v, l]) => h('option', { value: v, selected: v === cur ? 'selected' : null }, l + (v === info.hw.whisper.model ? ' ★' : ''))));
    if (info.cuda.nvidia && !info.cuda.libs) {
      warn = true;
      status.push('Zatím běží na procesoru (pomaleji).', h('button.btn.sm', { onclick: () => API.call('ai.install_cuda').then(refreshAll) }, icon('zap'), 'Zrychlit na grafické kartě (stáhne ~1,5 GB)'), progEl('cuda'));
    } else status.push(info.hw.whisper.note);
    if (!info.hw.speech_local_ok) warn = true;
  } else if (isLocal) {
    const cur = localModel(task), have = new Set(info.ollama.models.map(m => m.name));
    const names = [...new Set([cur, info.hw[task], ...info.ollama.models.map(m => m.name)].filter(Boolean))];
    modelSel = h('select.input', { onchange: e => save({ [`ai_${task}_model`]: e.target.value, [`ai_${task}_provider`]: 'ollama' }).then(refreshAll) },
      names.map(n => h('option', { value: n, selected: n === cur ? 'selected' : null },
        n + (n === info.hw[task] ? ' ★ doporučeno' : '') + (have.has(n) ? '' : ' (nestažený)'))));
    if (!info.ollama.installed) {
      warn = true;
      status.push('Potřebuje aplikaci Ollama (zdarma).', h('button.btn.sm.primary', { onclick: () => API.call('ai.install_ollama').then(refreshAll) }, icon('download'), 'Nainstalovat Ollamu'), progEl('ollama'));
    } else if (!info.ollama.running) {
      warn = true;
      status.push('Ollama neběží.', h('button.btn.sm', { onclick: () => API.call('ai.install_ollama').then(refreshAll) }, icon('play'), 'Spustit Ollamu'), progEl('ollama'));
    } else if (!have.has(cur) && !have.has(cur + ':latest')) {
      warn = true;
      status.push(`Model ${cur} není stažený${cur === info.hw[task] ? ` (~${info.hw.download} GB)` : ''}.`,
        h('button.btn.sm.primary', { onclick: () => API.call('ai.pull', { model: cur }).then(refreshAll) }, icon('download'), 'Stáhnout'), progEl('pull:' + cur));
    } else status.push(info.hw.note);
  } else {
    const p = providerFor(task, pid);
    const cur = task === 'speech' ? eff.model : eff.model;
    modelSel = h('select.input', { onchange: e => save(task === 'speech' ? { ai_speech_model: e.target.value } : { [`ai_${task}_model`]: e.target.value }).then(refreshAll) },
      p.models[task].map(m => h('option', { value: m.id, selected: m.id === cur ? 'selected' : null }, `${m.label} · ${czk(m.czk_hour)}/h`)));
    price = (p.models[task].find(m => m.id === cur) || p.models[task][0]).czk_hour;
    if (!p.has_key) {
      warn = true;
      status.push(h('a', { style: { cursor: 'pointer', textDecoration: 'underline' }, onclick: () => {
        const el = document.querySelector(`.ais-acct[data-pid="${p.id}"]`);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = el.querySelector('input, .btn.primary'); i && i.focus(); }
      } }, `Přihlas se k ${p.label}`), h('span', '(níže v části Účty)'));
    }
    else status.push(h('span', icon('check'), ` Přihlášeno k ${p.label}`));
  }
  return [
    h('.ais-task',
      h('.nm', icon(ic), h('div', label, h('.tiny.faint', { style: { fontWeight: 400 } }, sub))),
      provSel, modelSel,
      h('.price', isLocal ? 'zdarma' : '≈ ' + czk(price), h('small', isLocal ? 'běží na tvém PC' : 'za hodinu záznamu')),
      h('.st' + (warn ? '.warn' : ''), ...status.map(x => typeof x === 'string' ? h('span', x) : x).filter(Boolean))),
    price,
  ];
}

function accountCard(p) {
  const key = h('input.input', { type: 'password', placeholder: 'Vlož API klíč', autocomplete: 'off', onkeydown: e => e.stopPropagation() });
  const saveKey = async () => {
    const btn = key.nextSibling; btn.disabled = true;
    try { await API.call('ai.set_key', { provider: p.id, key: key.value }); toast(`Přihlášeno k ${p.label}`); refreshAll(); }
    catch (e) { toast(String(e.message || e).replace(/^\w+Error: /, ''), 'err'); btn.disabled = false; }
  };
  return h('.ais-acct', { 'data-pid': p.id },
    h('.hd', p.label, p.has_key ? h('span.ok', icon('circle-check'), 'Přihlášeno') : h('span.no', 'Nepřihlášeno')),
    h('.small.faint', p.note),
    p.has_key
      ? h('.row', h('button.btn.sm.ghost', { onclick: async () => { if (await confirmDialog(`Odhlásit ${p.label}?`, 'Klíč se smaže z tohoto počítače.')) { await API.call('ai.set_key', { provider: p.id, key: '' }); refreshAll(); } } }, icon('log-out'), 'Odhlásit'))
      : p.login === 'oauth'
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
            h('button.btn.primary', { onclick: () => API.call('ai.login', { provider: p.id }).then(refreshAll) }, icon('log-in'), 'Přihlásit se v prohlížeči'),
            progEl('login'))
        : h('.row', { style: { gap: '6px' } }, key, h('button.btn', { onclick: saveKey }, 'Uložit')),
    h('.links',
      !p.has_key && p.login !== 'oauth' ? h('a', { onclick: () => API.call('ai.open', { url: p.key_url }) }, icon('key-round'), ' Získat klíč') : null,
      h('a', { onclick: () => API.call('ai.open', { url: p.price_url }) }, icon('receipt'), ' Ceník')));
}

function hwCard() {
  const hw = info.hw;
  const gpu = hw.gpu ? `${hw.gpu} (${String(hw.vram).replace('.', ',')} GB)` : 'bez samostatné grafické karty';
  return h('.card.ais-hw', icon('cpu'),
    h('div', h('b', 'Tvoje PC: ', gpu), h('.small.faint', `${hw.ram} GB paměti · ${hw.cpu}`)),
    h('span.ais-verdict.' + hw.level, LEVEL[hw.level]));
}

async function applyPreset(kind) {
  const hw = info.hw;
  let v = { ai_setup_done: true };
  if (kind === 'local') {
    v = { ...v, ai_speech_provider: 'local', ai_whisper_model: hw.whisper.model, ai_vision_provider: 'ollama', ai_vision_model: hw.vision,
      ai_text_provider: 'ollama', ai_text_model: hw.text };
  } else {
    const has = id => (info.providers.find(p => p.id === id) || {}).has_key;
    const llm = ['anthropic', 'openai', 'gemini', 'openrouter', 'groq'].find(has) || 'anthropic';
    const sp = has('groq') ? 'groq' : has('openai') ? 'openai' : hw.speech_local_ok ? 'local' : 'groq';
    const P = id => info.providers.find(p => p.id === id);
    const def = (id, t) => (P(id).models[t].find(m => m.default) || P(id).models[t][0]).id;
    v = { ...v, ai_vision_provider: llm, ai_vision_model: def(llm, 'vision'), ai_text_provider: llm, ai_text_model: def(llm, 'text'),
      ai_speech_provider: sp, ...(sp === 'local' ? { ai_whisper_model: hw.whisper.model } : { ai_speech_model: def(sp, 'speech') }) };
  }
  await save(v);
  refreshAll();
}

function quickChoice() {
  const hw = info.hw, localRec = hw.llm_local_ok;
  return h('.ais-quick',
    h('button.ais-choice' + (localRec ? '.rec' : ''), { onclick: () => applyPreset('local') },
      h('b', icon('house'), 'Vše na tomto PC', localRec ? h('span.tag', 'DOPORUČENO') : null),
      h('.small.faint', 'Zdarma a soukromě, nic neopouští počítač. ' + (localRec ? `Stáhne se model ${hw.vision} (~${hw.download} GB).` : 'Na tomto PC ale bude pomalé.'))),
    h('button.ais-choice' + (!localRec ? '.rec' : ''), { onclick: () => applyPreset('cloud') },
      h('b', icon('cloud'), 'Placená služba', !localRec ? h('span.tag', 'DOPORUČENO') : null),
      h('.small.faint', 'Rychlé i na slabém PC. Přihlásíš se nebo vložíš API klíč a platíš jen to, co spotřebuješ – podle modelu od ~2 Kč za hodinu záznamu.')));
}

/** The whole setup (settings tab or the first-run dialog). */
function render(box, { intro = false } = {}) {
  const draw = async () => {
    if (!box.isConnected && mounted.has(draw)) { mounted.delete(draw); return; }
    info = await API.call('ai.info');
    const rows = TASKS.map(t => taskRow(...t));
    const perHour = rows.reduce((a, r) => a + r[1], 0);
    const accts = info.providers;
    const usage = info.usage_czk ? h('span.faint', `Za posledních 30 dní utraceno ≈ ${czk(info.usage_czk)}`) : null;
    clear(box).append(h('.ais',
      hwCard(),
      intro || !info.setup_done ? h('div', h('.small', { style: { margin: '0 0 8px', fontWeight: 600 } }, 'Kde má AI běžet? Vyber jednu možnost, později jde cokoli změnit.'), quickChoice()) : null,
      h('.card.trp-set',
        h('h3', icon('route'), 'Co kde běží'),
        h('.small.faint', 'Každou část můžeš pustit jinde – třeba řeč na tomto PC a kroniku přes placenou službu. ★ = doporučeno pro tvé PC.'),
        h('div', { style: { marginTop: '8px' } }, rows.map(r => r[0])),
        h('.ais-total',
          h('span', 'Celkem ', h('b', perHour ? '≈ ' + czk(perHour) : 'zdarma'), perHour ? ' za hodinu záznamu' : ''),
          perHour && info.todo_hours ? h('span.faint', `nepřepsaných ${String(info.todo_hours).replace('.', ',')} h v knihovně ≈ ${czk(perHour * info.todo_hours)}`) : null,
          usage),
        h('.tiny.faint', { style: { marginTop: '6px' } }, `Odhad podle aktuálních ceníků (listopad 2026, kurz ${info.usd_czk} Kč/$) a tvého nastavení: zhruba ${info.per_hour.frames} snímků a ${info.per_hour.speech_h} zvukové stopy na hodinu. Skutečná cena se může lišit.`)),
      h('.card.trp-set',
        h('h3', icon('key-round'), 'Účty placených služeb'),
        h('.small.faint', 'Klíče se ukládají šifrovaně do Správce přihlašovacích údajů Windows, jen pro tvůj účet. Kronikář je posílá jen dané službě.'),
        h('.ais-accts', accts.map(accountCard)))));
  };
  mounted.add(draw);
  draw();
  return draw;
}

/** Before the first transcription: make the user choose where the AI runs. */
async function ensure() {
  if (App.settings.ai_setup_done) return true;
  return new Promise(resolve => {
    const box = h('div');
    let done = false;
    const m = modal({
      title: 'Nejdřív vyber, kde poběží AI', icon: 'cpu', xwide: true, body: box,
      onClose: () => { mounted.clear(); resolve(done); },
      actions: [{ label: 'Zrušit' }, { label: 'Pokračovat', primary: true, onClick: () => {
        if (!App.settings.ai_setup_done) { toast('Vyber jednu z možností nahoře', 'err'); return false; }
        done = true; return true;
      } }],
    });
    render(box, { intro: true });
    return m;
  });
}

return { render, ensure, refresh: refreshAll };
})();
