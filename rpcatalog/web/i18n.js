/* ============================================================
   Kronikář – i18n
   English is the source language: every user-facing string in the code is English and goes through
     tr('Text with {name}', { name })          – translate + fill {placeholders}
     trn(n, '{n} video', '{n} videos', vars)   – plural; {n} is filled automatically
   Translations live in i18n/<lang>.js (window.I18N_CS = { "English": "Czech" }), keyed by the English text.
   A plural entry is keyed by the English singular and holds the Czech forms [one, few (2–4), many].
   Language: ?lang= (the desktop app passes the resolved setting) → kr_lang cookie (web) → browser language.
   ============================================================ */
'use strict';

const I18N = (() => {
  const DICTS = { cs: window.I18N_CS || {} };
  const norm = v => (/^(cs|sk)\b/i.test(v || '') ? 'cs' : /^en\b/i.test(v || '') ? 'en' : null);
  const fromBrowser = () => {
    for (const l of (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language])) {
      const n = norm(l); if (n) return n;
    }
    return 'en';
  };
  const cookie = () => { const m = document.cookie.match(/(?:^|;\s*)kr_lang=([^;]+)/); return m ? norm(decodeURIComponent(m[1])) : null; };
  const params = new URLSearchParams(location.search);
  const lang = norm(params.get('lang')) || cookie() || fromBrowser();
  const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars && vars[k] != null ? vars[k] : m)) : String(s));
  const lookup = s => { const d = DICTS[lang]; return d ? d[s] : undefined; };
  return {
    lang,
    locale: lang === 'cs' ? 'cs-CZ' : 'en-GB',
    browser: fromBrowser,
    norm,
    tr(s, vars) {
      let r = lookup(s);
      if (Array.isArray(r)) r = r[0];
      return fill(typeof r === 'string' ? r : s, vars);
    },
    trn(n, one, other, vars) {
      const v = Object.assign({ n }, vars);
      if (lang === 'cs') {
        const r = lookup(one);
        if (Array.isArray(r)) return fill(n === 1 ? r[0] : (n >= 2 && n <= 4 ? r[1] : r[2]), v);
        if (typeof r === 'string') return fill(r, v);
      }
      return fill(n === 1 ? one : other, v);
    },
    /** Reload the page in another language (keeps the other query parameters, e.g. pane=detail). */
    reload(to) {
      const p = new URLSearchParams(location.search);
      p.set('lang', norm(to) || 'en');
      location.replace(location.pathname + '?' + p.toString() + location.hash);
    },
  };
})();
const tr = I18N.tr, trn = I18N.trn;
document.documentElement.lang = I18N.lang;
