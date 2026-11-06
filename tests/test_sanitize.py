"""Rich text from the web goes through an allow-list before the editor puts it into innerHTML (sanitize.py,
same rules as the web's sanitize.js)."""
import shutil
import tempfile
import unittest
from pathlib import Path

from rpcatalog.sanitize import clean_html, clean_style


class SanitizeTest(unittest.TestCase):
    def test_scripts_and_handlers_go(self):
        self.assertEqual(clean_html('<p onclick="x()">Hi<script>alert(1)</script></p>'), "<p>Hi</p>")
        self.assertEqual(clean_html("<style>p{}</style><b>b</b>"), "<b>b</b>")
        self.assertEqual(clean_html('<img src="x" onerror="alert(1)">'), "")
        self.assertEqual(clean_html('<svg><g onload="alert(1)"><text>t</text></g></svg>ok'), "ok")
        self.assertEqual(clean_html('<iframe src="https://evil"></iframe><object data="x">o</object>!'), "!")

    def test_text_like_elements_are_dropped_with_their_content(self):
        # the parser reads the content of these as text: unwrapping them would turn it into live HTML in the browser
        for tag in ("textarea", "title", "xmp", "noscript", "noembed", "template"):
            self.assertEqual(clean_html(f'<{tag}><img src=x onerror=alert(1)></{tag}>after'), "after", tag)

    def test_void_dropped_tags_keep_the_rest(self):
        self.assertEqual(clean_html('<input value="x"><p>after</p>'), "<p>after</p>")
        self.assertEqual(clean_html('<meta http-equiv="refresh" content="0;url=file:///c:/"><b>x</b>'), "<b>x</b>")

    def test_links(self):
        self.assertEqual(clean_html('<a href="javascript:alert(1)">x</a>'), '<a rel="noopener nofollow ugc">x</a>')
        self.assertEqual(clean_html('<a href="file:///C:/Windows">x</a>'), '<a rel="noopener nofollow ugc">x</a>')
        self.assertEqual(clean_html('<a href="https://gingygames.com/kosmas/" target="_blank" title="t">x</a>'),
                         '<a href="https://gingygames.com/kosmas/" target="_blank" title="t" rel="noopener nofollow ugc">x</a>')
        self.assertIn('href="/kosmas/app/#c=1"', clean_html('<a href="/kosmas/app/#c=1" target="_top">x</a>'))
        self.assertNotIn("target", clean_html('<a href="#x" target="_top">x</a>'))

    def test_images(self):
        self.assertEqual(clean_html('<img src="/kosmas/img/ab_c-1.webp" data-att="12" alt="a" width="40">'),
                         '<img src="/kosmas/img/ab_c-1.webp" data-att="12" alt="a" width="40">')
        self.assertEqual(clean_html('<img src="https://cdn.example/x.png">'), '<img src="https://cdn.example/x.png">')
        for bad in ("file:///C:/secret.png", "data:image/png;base64,AAAA", "http://x/y.png", "/kosmas/img/../x"):
            self.assertEqual(clean_html(f'<img src="{bad}">'), "", bad)
        self.assertNotIn("data-att", clean_html('<img src="/kosmas/img/a.png" data-att="1 OR 1">'))

    def test_styles_and_attributes(self):
        self.assertEqual(clean_style("color: red; position: fixed; background-color: url(x); font-weight: bold"),
                         "color: red; font-weight: bold")
        self.assertEqual(clean_style("color: expression(alert(1))"), "")
        self.assertEqual(clean_html('<span style="color:#f00;top:0" class="hl x" id="i">t</span>'),
                         '<span style="color: #f00" class="hl x">t</span>')
        self.assertEqual(clean_html('<span data-char-id="7" contenteditable="true">@Hans</span>'),
                         '<span data-char-id="7" contenteditable="false">@Hans</span>')
        self.assertEqual(clean_html('<span data-char-id="x">t</span>'), "<span>t</span>")
        self.assertEqual(clean_html('<td colspan="2" rowspan="999" onclick="x">c</td>'), '<td colspan="2">c</td>')
        self.assertEqual(clean_html('<font color="#a0b0c0" face="x">f</font>'), '<font color="#a0b0c0">f</font>')
        self.assertEqual(clean_html('<p data-ingame="1">ic</p>'), '<p data-ingame="1">ic</p>')

    def test_unknown_tags_are_unwrapped_and_text_stays_text(self):
        self.assertEqual(clean_html("<article><custom>text</custom></article>"), "text")
        self.assertEqual(clean_html("a &lt;script&gt; b &amp; c"), "a &lt;script&gt; b &amp; c")
        self.assertEqual(clean_html('<p title="&quot;><script>">x</p>'), "<p>x</p>")
        self.assertEqual(clean_html("<!-- c --><!DOCTYPE html><p>x</p>"), "<p>x</p>")
        self.assertEqual(clean_html("<h2>T</h2><ul><li>a<br>b</li></ul><hr/>"), "<h2>T</h2><ul><li>a<br>b</li></ul><hr>")
        self.assertEqual(clean_html(None), "")
        self.assertEqual(clean_html(""), "")


class SyncBodyTest(unittest.TestCase):
    """body_html pulled from the web is sanitized before character ids and images are mapped back."""

    class Client:
        token = "krt_test"

        def request(self, *a, **k):
            raise AssertionError("no network expected")

    def test_body_in(self):
        from rpcatalog import sync
        from rpcatalog.store import Store
        tmp = Path(tempfile.mkdtemp(prefix="cosmas-body-"))
        self.addCleanup(lambda: shutil.rmtree(tmp, ignore_errors=True))
        st = Store(tmp / "catalog.db")
        cid = st.create_character("Hans")
        st.db.commit()
        st.db.close()
        s = sync.Syncer(tmp / "catalog.db", {"sync_token": "krt_test"}, tmp / "att", client=self.Client())
        self.addCleanup(s.close)
        s.set_pub("characters", cid, remote_id=900)
        out = s._body_in('<p onmouseover="steal()">Hi <span data-char-id="900">@Hans</span>'
                         '<a href="javascript:x">l</a><script>evil()</script></p>')
        self.assertEqual(out, f'<p>Hi <span data-char-id="{cid}" contenteditable="false">@Hans</span>'
                              '<a rel="noopener nofollow ugc">l</a></p>')


if __name__ == "__main__":
    unittest.main()
