"""Translations for messages produced in Python (errors, tray/dialog texts).

English is the source language. The Czech dictionary is shared with the web UI: rpcatalog/web/i18n/cs.js
(a JSON object wrapped in `window.I18N_CS = {...};`), keyed by the English text.

    tr("Folder {path} does not exist", path=p)
    trn(n, "{n} video", "{n} videos")          # Czech entry: [one, few, many]

The language is the `lang` setting (auto | en | cs); auto = Czech when the system locale is Czech or Slovak.
"""
import json
import locale
from pathlib import Path

CS_PATH = Path(__file__).resolve().parent / "web" / "i18n" / "cs.js"
LANGS = ("en", "cs")
_dicts = {}
_lang = None


def _load(lang):
    if lang not in _dicts:
        d = {}
        if lang == "cs":
            try:
                txt = CS_PATH.read_text("utf-8")
                d = json.loads(txt[txt.index("{"):txt.rindex("}") + 1])
            except Exception:
                d = {}
        _dicts[lang] = d
    return _dicts[lang]


def _norm(v):
    v = (v or "").lower().replace("_", "-")
    if v.startswith(("cs", "sk")):
        return "cs"
    if v.startswith("en"):
        return "en"
    return None


def system_lang():
    """'cs' when the OS (or Qt) locale is Czech/Slovak, otherwise 'en'."""
    try:
        from PySide6.QtCore import QLocale
        for name in [QLocale.system().name(), *QLocale.system().uiLanguages()]:
            n = _norm(name)
            if n:
                return n
    except Exception:
        pass
    try:
        n = _norm(locale.getlocale()[0] or "")
        if n:
            return n
    except Exception:
        pass
    return "en"


def resolve(pref):
    """Setting value (auto | en | cs) → the language actually used."""
    return _norm(pref) or system_lang()


def set_lang(pref):
    global _lang
    _lang = resolve(pref)
    return _lang


def lang():
    global _lang
    if _lang is None:
        try:
            from . import config
            _lang = resolve(config.load_settings().get("lang", "auto"))
        except Exception:
            _lang = system_lang()
    return _lang


def _fill(s, kw):
    if not kw:
        return s
    try:
        return s.format(**kw)
    except (KeyError, IndexError, ValueError):
        return s


def tr(text, **kw):
    r = _load(lang()).get(text) if lang() != "en" else None
    if isinstance(r, list):
        r = r[0]
    return _fill(r if isinstance(r, str) else text, kw)


def trn(n, one, other, **kw):
    kw = {"n": n, **kw}
    if lang() == "cs":
        r = _load("cs").get(one)
        if isinstance(r, list):
            return _fill(r[0] if n == 1 else r[1] if 2 <= n <= 4 else r[2], kw)
        if isinstance(r, str):
            return _fill(r, kw)
    return _fill(one if n == 1 else other, kw)
