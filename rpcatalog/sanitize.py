"""Allow-list sanitizer for rich text (body_html) that comes from the web chronicle.

The desktop editor puts body_html into innerHTML of a page that can read local files, so text from the web must
not bring scripts, event handlers, frames or javascript: links along. Same rules as the web's own sanitizer
(kronikar-web/src/sanitize.js): common formatting, http(s) / mailto / relative /kosmas/ links, images from
/kosmas/img/ or https, character mentions. Built on the stdlib html.parser; the output is serialized from the
parsed tokens (text and attribute values escaped), so nothing the parser read as text can turn into markup.
"""
import html
import re
from html.parser import HTMLParser

KEEP = {"p", "br", "b", "strong", "i", "em", "u", "s", "strike", "del", "h1", "h2", "h3", "h4", "ul", "ol", "li",
        "blockquote", "a", "span", "img", "hr", "code", "pre", "div", "figure", "figcaption", "sub", "sup", "mark",
        "table", "thead", "tbody", "tr", "td", "th", "font"}
# removed together with their content
DROP = {"script", "style", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "link",
        "meta", "base", "svg", "math", "template", "noscript", "frame", "frameset", "video", "audio", "source", "xmp",
        "noembed", "noframes", "title", "plaintext", "listing", "head", "param", "applet", "portal", "dialog"}
# elements without an end tag: a dropped one has no content to skip
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
        "frame", "keygen"}
STYLE_OK = re.compile(r"^(color|background-color|text-align|font-weight|font-style|text-decoration|font-size)$")
STYLE_BAD = re.compile(r"url\(|expression|javascript:|@import|\\", re.I)
SAFE_HREF = re.compile(r"^(https?://|mailto:|/kosmas/|/kronika/|#)", re.I)
SAFE_SRC = re.compile(r"^(/(?:kosmas|kronika)/img/[A-Za-z0-9._-]+|https://[^\s\"'<>]+)$")
MAX_LEN = 400_000


def clean_style(v):
    out = []
    for d in str(v or "").split(";"):
        p, _, val = d.strip().partition(":")
        p, val = p.strip().lower(), val.strip()
        if STYLE_OK.match(p) and val and not STYLE_BAD.search(val):
            out.append(f"{p}: {val}")
    return "; ".join(out)


def _attr_ok(tag, n, v):
    """The value to keep for attribute n of tag, or None to drop it."""
    v = "" if v is None else v
    if n.startswith("on"):
        return None
    if n == "style":
        return clean_style(v) or None
    if n == "class":
        return v if re.fullmatch(r"[\w\s-]{0,120}", v) else None
    if n == "data-char-id" or (tag == "img" and n == "data-att"):
        return v if re.fullmatch(r"\d+", v) else None
    if n == "data-ingame":
        return v
    if tag == "a":
        if n == "href":
            return v if SAFE_HREF.match(v.strip()) else None
        if n == "title":
            return v
        if n == "target":
            return v if v == "_blank" else None
    if tag == "img":
        if n == "src":
            return v.strip() if SAFE_SRC.match(v.strip()) else None
        if n in ("alt", "title", "width", "height"):
            return v
    if tag in ("td", "th") and n in ("colspan", "rowspan"):
        return v if re.fullmatch(r"\d{1,2}", v) else None
    if tag == "font" and n == "color":
        return v if re.fullmatch(r"#?\w{3,20}", v) else None
    return None


class _Cleaner(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.skip = None          # [tag, depth] while inside a dropped element

    def _start(self, tag, attrs, closed):
        if self.skip:
            if tag == self.skip[0] and not closed:
                self.skip[1] += 1
            return
        if tag in DROP:
            if tag not in VOID and not closed:
                self.skip = [tag, 1]
            return
        if tag not in KEEP:
            return                # unwrapped: the tag goes, its content stays
        kept = {}
        for n, v in attrs:
            v = _attr_ok(tag, n, v)
            if v is not None and n not in kept:
                kept[n] = v
        if tag == "img" and "src" not in kept:
            return                # an image only from the web's own storage or https
        if tag == "a":
            kept["rel"] = "noopener nofollow ugc"
        if tag == "span" and kept.get("data-char-id"):
            kept["contenteditable"] = "false"
        a = "".join(f' {n}="{html.escape(v, quote=True)}"' for n, v in kept.items())
        self.out.append(f"<{tag}{a}>")

    def handle_starttag(self, tag, attrs):
        self._start(tag, attrs, False)

    def handle_startendtag(self, tag, attrs):
        self._start(tag, attrs, True)

    def handle_endtag(self, tag):
        if self.skip:
            if tag == self.skip[0]:
                self.skip[1] -= 1
                if self.skip[1] <= 0:
                    self.skip = None
            return
        if tag in KEEP and tag not in VOID:
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(html.escape(data, quote=False))

    # comments, <!DOCTYPE>, <?…>, <![CDATA[…]]> are dropped
    def handle_comment(self, data):
        pass

    def handle_decl(self, decl):
        pass

    def handle_pi(self, data):
        pass

    def unknown_decl(self, data):
        pass


def clean_html(text):
    """Sanitized copy of `text` ('' for nothing)."""
    if not text or not isinstance(text, str):
        return ""
    p = _Cleaner()
    p.feed(text[:MAX_LEN])
    p.close()
    return "".join(p.out)
