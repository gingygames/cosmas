"""Embedded mpv player: modern controls, live multi-track audio mixer, pop-out window."""
import os
import re

from PySide6.QtCore import Qt, QTimer, Signal, QRectF, QPointF, QPoint
from PySide6.QtGui import (QPainter, QColor, QFont, QFontDatabase, QPolygonF,
                           QCursor)
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QSlider, QToolButton, QMenu, QWidgetAction,
    QSizePolicy, QFrame, QPushButton, QToolTip,
)

from .. import config
from ..i18n import tr

os.environ["PATH"] = str(config.VENDOR_DIR) + os.pathsep + os.environ.get("PATH", "")
import mpv  # noqa: E402

from .common import fmt_dur  # noqa: E402

# ---------------------------------------------------------------- icons (Lucide font)
_ICON_FAMILY = None
_ICON_CODES = {}


def _load_icons():
    global _ICON_FAMILY
    if _ICON_FAMILY is not None:
        return
    web = config.APP_DIR / "rpcatalog" / "web" / "vendor"
    fid = QFontDatabase.addApplicationFont(str(web / "lucide.ttf"))
    fams = QFontDatabase.applicationFontFamilies(fid) if fid >= 0 else []
    _ICON_FAMILY = fams[0] if fams else ""
    try:
        css = (web / "lucide.css").read_text("utf-8")
        for name, code in re.findall(r'\.icon-([\w-]+):before\s*\{\s*content:\s*"\\([0-9a-fA-F]+)"', css):
            _ICON_CODES[name] = chr(int(code, 16))
    except OSError:
        pass


def glyph(name):
    _load_icons()
    return _ICON_CODES.get(name, "?")


def icon_font(px=18):
    _load_icons()
    f = QFont(_ICON_FAMILY)
    f.setPixelSize(px)
    return f


ROLE_INFO = {    # (English label – shown through tr(), colour)
    "all": ("All", "#9aa3b2"),
    "game": ("Game", "#e3b341"),
    "mic": ("Microphone", "#5cc98a"),
    "discord": ("Discord", "#7c8cf5"),
    "system": ("System", "#40c4c4"),
    "other": ("Track", "#a77be8"),
}

STYLE = """
QWidget#player { background: #0b0d11; }
QLabel#ptitle { color: #f1f2f5; font-size: 15px; font-weight: 600; }
QLabel#psub { color: #7d8490; font-size: 12px; }
QLabel#ptime { color: #c9ced6; font-size: 12px; font-family: 'Segoe UI'; }
QToolButton.ib, QToolButton[ib="true"] { background: transparent; border: none; border-radius: 9px; color: #c9ced6;
  min-width: 34px; min-height: 34px; }
QToolButton[ib="true"]:hover { background: rgba(255,255,255,.07); color: #ffffff; }
QToolButton[ib="true"]:checked { color: #e3b341; }
QToolButton#playbtn { background: #e3b341; color: #1a1405; border-radius: 19px; min-width: 38px; min-height: 38px; }
QToolButton#playbtn:hover { background: #f2cd6b; }
QPushButton[pill="true"] { border-radius: 13px; padding: 0 12px; height: 26px; font-size: 12px; color: #a7adb8;
  background: #161a20; border: 1px solid rgba(255,255,255,.08); }
QPushButton[pill="true"]:hover { border-color: rgba(255,255,255,.2); color: #e9ebef; }
QPushButton[pill="true"]:checked { color: #111; font-weight: 600; }
QPushButton#actbtn { border-radius: 9px; padding: 0 12px; height: 30px; font-size: 12px; color: #e9ebef;
  background: #1c2129; border: 1px solid rgba(255,255,255,.1); }
QPushButton#actbtn:hover { background: #242a34; }
QFrame#clipbar { background: rgba(92,201,138,.10); border-top: 1px solid rgba(92,201,138,.35); }
QLabel#cliplbl { color: #8fe0b0; font-weight: 600; }
QPushButton#actbtn[armed="true"] { background: #3a2f12; color: #f2cd6b; border-color: #e3b341; }
QSlider::groove:horizontal { height: 4px; background: #2a303a; border-radius: 2px; }
QSlider::sub-page:horizontal { background: #e3b341; border-radius: 2px; }
QSlider::handle:horizontal { width: 12px; height: 12px; margin: -4px 0; border-radius: 6px; background: #f1f2f5; }
QLabel#warn { color: #ef9a4b; font-size: 11px; }
QMenu { background: #1c2129; border: 1px solid rgba(255,255,255,.12); border-radius: 10px; padding: 5px; color: #e9ebef; }
QMenu::item { padding: 6px 14px; border-radius: 6px; }
QMenu::item:selected { background: rgba(255,255,255,.07); }
"""


def glyph_icon(name, color="#e9ebef", px=16):
    from PySide6.QtGui import QPixmap, QIcon
    pm = QPixmap(px * 2, px * 2)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    p.setFont(icon_font(px * 2 - 4))
    p.setPen(QColor(color))
    p.drawText(pm.rect(), Qt.AlignCenter, glyph(name))
    p.end()
    pm.setDevicePixelRatio(2)
    return QIcon(pm)


def ibutton(name, tip, px=18, checkable=False):
    b = QToolButton()
    b.setProperty("ib", True)
    b.setText(glyph(name))
    b.setFont(icon_font(px))
    b.setToolTip(tip)
    b.setCursor(Qt.PointingHandCursor)
    b.setCheckable(checkable)
    return b


class VideoSurface(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WA_DontCreateNativeAncestors)
        self.setAttribute(Qt.WA_NativeWindow)
        self.setStyleSheet("background: black;")
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.setMinimumHeight(160)


class PreviewPopup(QLabel):
    """Frameless top-level window above the seek bar: video frame + time (shows over the video too)."""

    def __init__(self):
        super().__init__(None, Qt.ToolTip | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setStyleSheet("background:#0b0d11; border:1px solid rgba(255,255,255,.18); border-radius:6px;")
        self.cache = {}

    def show_at(self, global_pt, path, text):
        from PySide6.QtGui import QPixmap
        pm = self.cache.get(path)
        if pm is None and path and os.path.exists(path):
            pm = QPixmap(path)
            if len(self.cache) > 400:
                self.cache.clear()
            self.cache[path] = pm
        w = 256
        if pm is not None and not pm.isNull():
            h = int(pm.height() * w / max(1, pm.width()))
            canvas = pm.scaled(w, h, Qt.KeepAspectRatio, Qt.SmoothTransformation).copy()
        else:
            from PySide6.QtGui import QPixmap as _P
            canvas = _P(w, 36)
            canvas.fill(QColor("#0b0d11"))
        p = QPainter(canvas)
        p.setRenderHint(QPainter.Antialiasing)
        f = QFont(self.font())
        f.setPointSizeF(9.5)
        f.setBold(True)
        p.setFont(f)
        tw = p.fontMetrics().horizontalAdvance(text) + 14
        r = QRectF((canvas.width() - tw) / 2, canvas.height() - 26, tw, 20)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(0, 0, 0, 190))
        p.drawRoundedRect(r, 5, 5)
        p.setPen(QColor("#ffffff"))
        p.drawText(r, Qt.AlignCenter, text)
        p.end()
        self.setPixmap(canvas)
        self.resize(canvas.size())
        self.move(global_pt.x() - canvas.width() // 2, global_pt.y() - canvas.height() - 12)
        if not self.isVisible():
            self.show()


class WaveStrip(QWidget):
    """Loudness of each audio track over the whole video (one thin row per track); click = seek."""
    seek = Signal(float)

    def __init__(self):
        super().__init__()
        self.data = None          # {"bin": s, "tracks": [[0..1]]} in aid order
        self.tracks = []          # [{"aid", "role", "label"}]
        self.enabled = {}         # aid -> bool
        self.duration = 0.0
        self.pos_ = 0.0
        self.setCursor(Qt.PointingHandCursor)
        self.setMouseTracking(True)
        self._refit()

    def _rows(self):
        if not self.data:
            return []
        return [t for t in self.tracks if 0 <= t["aid"] - 1 < len(self.data["tracks"]) and self.data["tracks"][t["aid"] - 1]]

    def _refit(self):
        n = len(self._rows())
        self.setFixedHeight(n * 9 + 4 if n else 0)
        self.setVisible(bool(n))

    def set_data(self, data, tracks, enabled):
        self.data, self.tracks, self.enabled = data, tracks, enabled
        self._refit()
        self.update()

    def mousePressEvent(self, e):
        if self.duration and e.button() == Qt.LeftButton:
            w = max(1, self.width() - 16)
            self.seek.emit(max(0.0, min(1.0, (e.position().x() - 8) / w)) * self.duration)

    def mouseMoveEvent(self, e):
        rows = self._rows()
        i = int((e.position().y() - 2) // 9)
        if 0 <= i < len(rows):
            QToolTip.showText(e.globalPosition().toPoint(), tr("{track} – volume over time", track=rows[i]['label']), self)

    def paintEvent(self, e):
        rows = self._rows()
        if not rows or not self.duration:
            return
        p = QPainter(self)
        W = self.width() - 16
        for r, t in enumerate(rows):
            vals = self.data["tracks"][t["aid"] - 1]
            col = QColor(ROLE_INFO.get(t["role"], ROLE_INFO["other"])[1])
            if not self.enabled.get(t["aid"], False):
                col.setAlpha(70)
            y0, hh = 2 + r * 9, 7
            p.fillRect(QRectF(8, y0, W, hh), QColor(255, 255, 255, 10))
            n = len(vals)
            step = max(1, int(n / max(1, W)))       # pixels <-> bins
            for x in range(int(W)):
                a = int(x / W * n)
                b = min(n, a + step)
                v = max(vals[a:b]) if b > a else 0
                if v <= 0.02:
                    continue
                bh = max(1.0, v * hh)
                p.fillRect(QRectF(8 + x, y0 + (hh - bh) / 2, 1, bh), col)
        px = 8 + W * (self.pos_ / self.duration)
        p.fillRect(QRectF(px - 0.5, 0, 1.5, self.height()), QColor(255, 255, 255, 200))
        p.end()


class SeekBar(QWidget):
    """Rounded seek bar with hover preview time, Medal bookmarks and event reference markers."""
    seek = Signal(float)
    clip_changed = Signal()

    def __init__(self):
        super().__init__()
        self.setMinimumHeight(30)
        self.setMouseTracking(True)
        self.setCursor(Qt.PointingHandCursor)
        self.duration = 0.0
        self.pos_ = 0.0
        self.hover = None
        self.dragging = False
        self.marks = []       # dicts: t, t_end, label, color, kind (bm | auto | ref)
        self.frames = None    # {"interval", "count", "dir"} -> thumbnail while hovering
        self.popup = PreviewPopup()
        self.range_a = None   # pending range start while marking a virtual clip
        self.clip = None      # [a, b] selection for clipping (b may be None while only "in" is set)
        self.clip_drag = None

    def set_pos(self, p):
        if not self.dragging:
            self.pos_ = p
            self.update()

    def _t(self, x):
        w = max(1, self.width() - 16)
        return max(0.0, min(1.0, (x - 8) / w)) * self.duration

    def _x(self, t):
        return 8 + (self.width() - 16) * (t / self.duration if self.duration else 0)

    def _near_clip_edge(self, x):
        if not self.clip or not self.duration:
            return None
        for i, t in enumerate(self.clip):
            if t is not None and abs(self._x(t) - x) <= 7:
                return i
        return None

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton and self.duration:
            edge = self._near_clip_edge(e.position().x())
            if edge is not None:
                self.clip_drag = edge
                return
            self.dragging = True
            self.pos_ = self._t(e.position().x())
            self.update()

    def mouseMoveEvent(self, e):
        self.hover = e.position().x()
        if self.clip_drag is not None:
            t = self._t(self.hover)
            self.clip[self.clip_drag] = t
            if self.clip[1] is not None and self.clip[0] > self.clip[1]:
                self.clip.reverse()
                self.clip_drag = 1 - self.clip_drag
            self.clip_changed.emit()
            self.update()
            return
        self.setCursor(Qt.SizeHorCursor if self._near_clip_edge(self.hover) is not None else Qt.PointingHandCursor)
        if self.dragging:
            self.pos_ = self._t(self.hover)
        if self.duration:
            t = self._t(self.hover)
            tip = fmt_dur(t)
            tol = self.duration * 0.012
            near = [m["label"] for m in self.marks if m["label"] and (
                abs(m["t"] - t) < tol or (m.get("t_end") and m["t"] <= t <= m["t_end"]))]
            if near:
                tip += "  ·  " + ", ".join(near[:3])
            if self.frames:
                i = max(0, min(self.frames["count"] - 1, int(t / self.frames["interval"])))
                path = os.path.join(self.frames["dir"], f"{i:04d}.jpg")
                if not self.frames.get("done") and not os.path.exists(path):
                    for d in range(1, 33):      # nearest frame generated so far
                        for j in (i - d, i + d):
                            q = os.path.join(self.frames["dir"], f"{j:04d}.jpg")
                            if 0 <= j < self.frames["count"] and os.path.exists(q):
                                path = q
                                break
                        else:
                            continue
                        break
                top = self.mapToGlobal(QPoint(int(self.hover), 0))
                self.popup.show_at(top, path, tip if len(tip) < 46 else tip[:44] + "…")
            else:
                QToolTip.showText(e.globalPosition().toPoint() + QPointF(0, -38).toPoint(), tip, self)
        self.update()

    def leaveEvent(self, e):
        self.hover = None
        self.popup.hide()
        self.update()

    def hideEvent(self, e):
        self.popup.hide()
        super().hideEvent(e)

    def mouseReleaseEvent(self, e):
        if self.clip_drag is not None:
            self.clip_drag = None
            self.clip_changed.emit()
            return
        if self.dragging:
            self.dragging = False
            self.seek.emit(self.pos_)

    def paintEvent(self, e):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        h = self.height()
        cy = h / 2
        thick = 6 if (self.hover is not None or self.dragging) else 4
        track = QRectF(8, cy - thick / 2, self.width() - 16, thick)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor("#2a303a"))
        p.drawRoundedRect(track, thick / 2, thick / 2)
        if self.duration:
            if self.hover is not None:
                hx = max(8, min(self.width() - 8, self.hover))
                p.setBrush(QColor(255, 255, 255, 40))
                p.drawRoundedRect(QRectF(8, track.y(), hx - 8, thick), thick / 2, thick / 2)
            px = self._x(self.pos_)
            p.setBrush(QColor("#e3b341"))
            p.drawRoundedRect(QRectF(8, track.y(), max(0, px - 8), thick), thick / 2, thick / 2)
            top = cy - thick / 2
            for m in self.marks:
                if m.get("t_end"):
                    c = QColor(m.get("color") or "#f2cd6b")
                    x0, x1 = self._x(m["t"]), self._x(m["t_end"])
                    c.setAlpha(150)
                    p.setBrush(c)
                    p.drawRoundedRect(QRectF(x0, top - 6, max(3, x1 - x0), 3), 1.5, 1.5)
            for m in self.marks:
                x = self._x(m["t"])
                if m["kind"] == "ref":
                    p.setBrush(QColor(m.get("color") or "#ef6b73"))
                    p.drawPolygon(QPolygonF([QPointF(x, cy + thick / 2 + 1), QPointF(x + 4, cy + thick / 2 + 6),
                                             QPointF(x, cy + thick / 2 + 11), QPointF(x - 4, cy + thick / 2 + 6)]))
                elif m["kind"] == "auto":
                    p.setBrush(QColor(255, 255, 255, 90))
                    p.drawEllipse(QPointF(x, top - 4), 1.6, 1.6)
                else:
                    p.setBrush(QColor(m.get("color") or "#f2cd6b"))
                    p.drawPolygon(QPolygonF([QPointF(x - 3.5, top - 9), QPointF(x + 3.5, top - 9),
                                             QPointF(x + 3.5, top - 3), QPointF(x, top - 5), QPointF(x - 3.5, top - 3)]))
            if self.clip:
                a_, b_ = self.clip[0], self.clip[1] if self.clip[1] is not None else max(self.clip[0], self.pos_)
                xa, xb = self._x(a_), self._x(b_)
                p.setBrush(QColor(92, 201, 138, 60))
                p.drawRoundedRect(QRectF(xa, 1, max(2, xb - xa), h - 2), 3, 3)
                p.setBrush(QColor("#5cc98a"))
                for x in ((xa, xb) if self.clip[1] is not None else (xa,)):
                    p.drawRoundedRect(QRectF(x - 2.5, 0, 5, h), 2, 2)
            if self.range_a is not None:
                xa, xb = self._x(self.range_a), self._x(max(self.range_a, self.pos_))
                p.setBrush(QColor(227, 179, 65, 70))
                p.drawRect(QRectF(xa, 2, max(2, xb - xa), h - 4))
                p.setBrush(QColor("#e3b341"))
                p.drawRect(QRectF(xa - 1, 2, 2, h - 4))
            r = 7 if (self.hover is not None or self.dragging) else 5
            p.setBrush(QColor("#ffffff"))
            p.drawEllipse(QPointF(px, cy), r, r)
        p.end()


class TrackPill(QPushButton):
    """Toggle for one audio track; mouse wheel changes its volume, right-click opens a slider."""
    changed = Signal()

    def __init__(self, aid, role, label):
        super().__init__()
        self.aid, self.role, self.label = aid, role, label
        self.volume = 100
        self.setProperty("pill", True)
        self.setCheckable(True)
        self.setCursor(Qt.PointingHandCursor)
        self.toggled.connect(lambda *_: (self._refresh(), self.changed.emit()))
        self.setContextMenuPolicy(Qt.CustomContextMenu)
        self.customContextMenuRequested.connect(self._menu)
        self._refresh()

    def set_volume(self, v, emit=True):
        self.volume = max(0, min(200, int(v)))
        self._refresh()
        if emit:
            self.changed.emit()

    def _refresh(self):
        color = ROLE_INFO.get(self.role, ROLE_INFO["other"])[1]
        vol = "" if self.volume == 100 else f"  {self.volume}%"
        self.setText(f"{self.aid}  {self.label}{vol}")
        self.setToolTip(tr("Ctrl+{n} toggles · wheel = volume · right-click = settings", n=self.aid))
        if self.isChecked():
            self.setStyleSheet(f"QPushButton {{ background: {color}; border-color: {color}; }}")
        else:
            c = QColor(color)
            self.setStyleSheet(f"QPushButton {{ border-color: rgba({c.red()},{c.green()},{c.blue()},90); }}")

    def wheelEvent(self, e):
        step = 10 if e.angleDelta().y() > 0 else -10
        if not self.isChecked():
            self.setChecked(True)
        self.set_volume(self.volume + step)

    def _menu(self, pos):
        m = QMenu(self)
        box = QWidget()
        lay = QHBoxLayout(box)
        lay.setContentsMargins(12, 6, 12, 6)
        s = QSlider(Qt.Horizontal)
        s.setRange(0, 200)
        s.setValue(self.volume)
        s.setFixedWidth(160)
        lbl = QLabel(f"{self.volume} %")
        lbl.setStyleSheet("color:#c9ced6; min-width: 42px;")
        s.valueChanged.connect(lambda v: (lbl.setText(f"{v} %"), self.set_volume(v)))
        lay.addWidget(s)
        lay.addWidget(lbl)
        wa = QWidgetAction(m)
        wa.setDefaultWidget(box)
        m.addAction(wa)
        m.addSeparator()
        m.addAction(tr("Volume 100%"), lambda: self.set_volume(100))
        m.addAction(tr("Only this track"), lambda: self.parent().solo(self.aid) if hasattr(self.parent(), "solo") else None)
        m.exec(self.mapToGlobal(pos))


class TrackBar(QWidget):
    changed = Signal()

    def __init__(self):
        super().__init__()
        self.lay = QHBoxLayout(self)
        self.lay.setContentsMargins(0, 0, 0, 0)
        self.lay.setSpacing(6)
        self.pills = []

    def set_tracks(self, tracks, state=None):
        for p in self.pills:
            p.deleteLater()
        while self.lay.count():
            it = self.lay.takeAt(0)
            if it.widget():
                it.widget().deleteLater()
        self.pills = []
        lbl = QLabel(glyph("audio-lines"))
        lbl.setFont(icon_font(16))
        lbl.setStyleSheet("color:#7d8490;")
        lbl.setToolTip(tr("Audio tracks – click to toggle, you can have several on at once"))
        self.lay.addWidget(lbl)
        for t in tracks:
            p = TrackPill(t["aid"], t["role"], t["label"])
            if state and t["aid"] in state:
                on, vol = state[t["aid"]]
                p.blockSignals(True)
                p.setChecked(on)
                p.set_volume(vol, emit=False)
                p.blockSignals(False)
                p._refresh()
            p.changed.connect(self.changed.emit)
            self.lay.addWidget(p)
            self.pills.append(p)
        self.lay.addStretch(1)

    def solo(self, aid):
        for p in self.pills:
            p.blockSignals(True)
            p.setChecked(p.aid == aid)
            p.blockSignals(False)
            p._refresh()
        self.changed.emit()

    def state(self):
        return {p.aid: (p.isChecked(), p.volume) for p in self.pills}


DEFAULT_PRESETS = [     # names are translated when the presets are first saved to the settings
    {"name": "All (Medal mix)", "roles": [{"role": "all", "volume": 100}]},
    {"name": "Game + microphone", "roles": [{"role": "game", "volume": 100}, {"role": "mic", "volume": 100}]},
    {"name": "Game + Discord", "roles": [{"role": "game", "volume": 100}, {"role": "discord", "volume": 100}]},
    {"name": "Game + microphone + Discord", "roles": [{"role": "game", "volume": 100}, {"role": "mic", "volume": 100},
                                                      {"role": "discord", "volume": 100}]},
    {"name": "Voices only (microphone + Discord)", "roles": [{"role": "mic", "volume": 100}, {"role": "discord", "volume": 100}]},
]


class PlayerWidget(QWidget):
    pin_requested = Signal(object, float)        # media, position
    bookmark_requested = Signal(object, float, object)  # media, t, t_end | None
    tagchar_requested = Signal(object, float)           # media, t
    export_requested = Signal(object, float, float)     # media, a, b -> real MP4 file
    thumb_requested = Signal(object, float)             # media, t -> use this frame as thumbnail
    snapshot_requested = Signal(object, float)   # media, position
    popout_requested = Signal()
    layout_requested = Signal()
    info_requested = Signal()
    fullscreen_requested = Signal()
    close_requested = Signal()
    state_changed = Signal()                     # media / pause changed
    mix_changed = Signal(list)
    _mpv_tracks = Signal()
    _mpv_key = Signal(str)
    _mpv_loaded = Signal()

    def __init__(self, settings, parent=None, popout=False):
        super().__init__(parent)
        _load_icons()
        self.setObjectName("player")
        self.setAttribute(Qt.WA_StyledBackground, True)
        self.setStyleSheet(STYLE)
        self.settings = settings
        self.is_popout = popout
        self.media = None
        self.pending_seek = None
        self.pending_state = None
        self.stop_at = None
        self.tracks = []
        self._applying = False
        self._last_paused = None
        self._mix_timer = QTimer(self, singleShot=True, interval=120)
        self._mix_timer.timeout.connect(self._apply_mix)

        # header
        self.title = QLabel("")
        self.title.setObjectName("ptitle")
        self.sub = QLabel("")
        self.sub.setObjectName("psub")
        tbox = QVBoxLayout()
        tbox.setSpacing(0)
        tbox.addWidget(self.title)
        tbox.addWidget(self.sub)
        self.snap_btn = QPushButton(" " + tr("Screenshot"))
        self.pin_btn = QPushButton(" " + tr("Pin"))
        self.bm_btn = QPushButton(" " + tr("Moment"))
        self.tag_btn = QPushButton(" " + tr("Character"))
        self.clip_btn = QPushButton(" " + tr("Clip"))
        for b, ic, tip in ((self.snap_btn, "camera", tr("Save the current frame to the event (S)")),
                           (self.bm_btn, "bookmark-plus",
                            tr("Moment at this point (B)\nShift+B = start / end of a segment (virtual clip)\n"
                               "Right-click = segment")),
                           (self.tag_btn, "user-round-plus", tr("Tag the characters present at this moment (C)")),
                           (self.clip_btn, "scissors", tr("Clip: I = start, O = end\nRight-click = more options")),
                           (self.pin_btn, "map-pin", tr("Moment assigned straight to an event (P)"))):
            b.setObjectName("actbtn")
            b.setIcon(glyph_icon(ic))
            b.setToolTip(tip)
            b.setCursor(Qt.PointingHandCursor)
        self.snap_btn.clicked.connect(lambda: self.media and self.snapshot_requested.emit(self.media, self.position()))
        self.pin_btn.clicked.connect(lambda: self.media and self.pin_requested.emit(self.media, self.position()))
        self.bm_btn.clicked.connect(lambda: self.handle_action("bm"))
        self.tag_btn.clicked.connect(lambda: self.handle_action("tagchar"))
        self.clip_btn.clicked.connect(lambda: self.handle_action("clip_out" if self.seekbar.clip else "clip_in"))
        self.clip_btn.setContextMenuPolicy(Qt.CustomContextMenu)
        self.clip_btn.customContextMenuRequested.connect(self._more_menu)
        self.bm_btn.setContextMenuPolicy(Qt.CustomContextMenu)
        self.bm_btn.customContextMenuRequested.connect(lambda *_: self.handle_action("range"))
        self.pop_btn = ibutton("picture-in-picture-2" if not popout else "panel-right",
                               tr("Pop-out window") if not popout else tr("Return to the main window"))
        self.pop_btn.clicked.connect(self.popout_requested.emit)
        self.info_btn = ibutton("notebook-pen", tr("Video info below the player (I)"), checkable=True)
        self.info_btn.setChecked(bool(settings.get("detail_pane", True)))
        self.info_btn.clicked.connect(lambda *_: self.info_requested.emit())
        self.layout_btn = ibutton("columns-2", tr("Info next to the video"))
        self.layout_btn.clicked.connect(self.layout_requested.emit)
        self.close_btn = ibutton("x", tr("Close player"))
        self.close_btn.clicked.connect(self.close_requested.emit)
        head = QHBoxLayout()
        head.setContentsMargins(14, 10, 8, 8)
        head.addLayout(tbox, 1)
        head.addWidget(self.snap_btn)
        head.addWidget(self.bm_btn)
        head.addWidget(self.tag_btn)
        head.addWidget(self.clip_btn)
        head.addWidget(self.pin_btn)
        if not popout:
            head.addWidget(self.info_btn)
            head.addWidget(self.layout_btn)
        head.addWidget(self.pop_btn)
        if not popout:
            head.addWidget(self.close_btn)
        else:
            self.layout_btn.hide()
            self.info_btn.hide()
        self.header = QWidget()
        self.header.setLayout(head)

        self.surface = VideoSurface(self)

        # controls
        self.seekbar = SeekBar()
        self.seekbar.seek.connect(self.seek_to)
        self.seekbar.clip_changed.connect(self._refresh_clipbar)
        self.play_btn = QToolButton()
        self.play_btn.setObjectName("playbtn")
        self.play_btn.setFont(icon_font(18))
        self.play_btn.setText(glyph("play"))
        self.play_btn.setCursor(Qt.PointingHandCursor)
        self.play_btn.clicked.connect(self.toggle_pause)
        back = ibutton("rotate-ccw", "−10 s (←)")
        back.clicked.connect(lambda: self.seek_relative(-10))
        fwd = ibutton("rotate-cw", "+30 s (→)")
        fwd.clicked.connect(lambda: self.seek_relative(30))
        self.time = QLabel("0:00 / 0:00")
        self.time.setObjectName("ptime")
        self.speed_btn = QToolButton()
        self.speed_btn.setProperty("ib", True)
        self.speed_btn.setText("1×")
        self.speed_btn.setToolTip(tr("Playback speed"))
        self.speed_btn.setCursor(Qt.PointingHandCursor)
        self.speed_btn.clicked.connect(self._speed_menu)
        self.mute_btn = ibutton("volume-2", tr("Mute (M)"), checkable=True)
        self.mute_btn.toggled.connect(self._set_mute)
        self.vol = QSlider(Qt.Horizontal)
        self.vol.setRange(0, 130)
        self.vol.setFixedWidth(90)
        self.vol.setValue(int(settings.get("volume", 100)))
        self.vol.valueChanged.connect(self._set_volume)
        self.fs_btn = ibutton("maximize", tr("Full screen (F)"))
        self.fs_btn.clicked.connect(self.fullscreen_requested.emit)
        ctl = QHBoxLayout()
        ctl.setContentsMargins(10, 0, 10, 0)
        ctl.setSpacing(4)
        ctl.addWidget(self.play_btn)
        ctl.addWidget(back)
        ctl.addWidget(fwd)
        ctl.addSpacing(6)
        ctl.addWidget(self.time)
        ctl.addStretch(1)
        ctl.addWidget(self.speed_btn)
        ctl.addWidget(self.mute_btn)
        ctl.addWidget(self.vol)
        ctl.addWidget(self.fs_btn)

        # clip bar (shown while a clip selection exists)
        self.clipbar = QFrame()
        self.clipbar.setObjectName("clipbar")
        cbl = QHBoxLayout(self.clipbar)
        cbl.setContentsMargins(14, 6, 14, 6)
        cbl.setSpacing(6)
        self.clip_lbl = QLabel("")
        self.clip_lbl.setObjectName("cliplbl")
        cbl.addWidget(self.clip_lbl, 1)
        for text, ic, tip, act in ((" " + tr("Play selection"), "play", tr("Play only the selected segment"), "clip_play"),
                                   (" " + tr("Save clip"), "bookmark-plus", tr("Save as a segment (virtual clip) to the catalogue"), "clip_save"),
                                   (" Export MP4", "download", tr("Create a real file with all audio tracks"), "clip_export"),
                                   ("", "x", tr("Cancel selection (Esc)"), "clip_clear")):
            b = QPushButton(text)
            b.setObjectName("actbtn")
            b.setIcon(glyph_icon(ic))
            b.setToolTip(tip)
            b.setCursor(Qt.PointingHandCursor)
            b.clicked.connect(lambda *_, a=act: self.handle_action(a))
            cbl.addWidget(b)
        self.clipbar.hide()

        self.trackbar = TrackBar()
        self.trackbar.changed.connect(self._schedule_mix)
        self.preset_btn = ibutton("sliders-horizontal", tr("Audio track presets"))
        self.wave_btn = ibutton("audio-waveform", tr("Track volume over time below the timeline"), checkable=True)
        self.wave_btn.setChecked(bool(settings.get("show_waves", True)))
        self.wave_btn.toggled.connect(self._toggle_waves)
        self.waves = WaveStrip()
        self.waves.seek.connect(self.seek_to)
        self.wave_data = None
        self.preset_btn.clicked.connect(self._preset_menu)
        self.warn = QLabel("")
        self.warn.setObjectName("warn")
        trk = QHBoxLayout()
        trk.setContentsMargins(14, 0, 14, 10)
        trk.addWidget(self.trackbar, 1)
        trk.addWidget(self.warn)
        trk.addWidget(self.wave_btn)
        trk.addWidget(self.preset_btn)

        self.controls = QFrame()
        cl = QVBoxLayout(self.controls)
        cl.setContentsMargins(0, 4, 0, 0)
        cl.setSpacing(4)
        sb = QHBoxLayout()
        sb.setContentsMargins(6, 0, 6, 0)
        sb.addWidget(self.seekbar)
        cl.addLayout(sb)
        wl = QHBoxLayout()
        wl.setContentsMargins(6, 0, 6, 0)
        wl.addWidget(self.waves)
        cl.addLayout(wl)
        cl.addLayout(ctl)
        cl.addLayout(trk)
        cl.addWidget(self.clipbar)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        lay.addWidget(self.header)
        lay.addWidget(self.surface, 1)
        lay.addWidget(self.controls)

        self.player = mpv.MPV(
            wid=str(int(self.surface.winId())),
            vo="gpu-next", hwdec="auto-safe", keep_open="yes", idle="yes",
            osc=False, osd_level=1, osd_font_size=28, osd_bar=False,
            input_default_bindings=False, input_vo_keyboard=True, cursor_autohide=1200,
            volume=self.vol.value(), screenshot_format="jpg", screenshot_jpeg_quality=92,
            background_color="#000000", log_handler=None, loglevel="error",
        )
        self.player.observe_property("track-list", lambda *_: self._mpv_tracks.emit())
        self.player.register_event_callback(self._on_mpv_event)
        self._mpv_tracks.connect(self._rebuild_tracks)
        self._mpv_loaded.connect(self._on_loaded)
        self._mpv_key.connect(self.handle_action)
        keymap = {"SPACE": "pause", "MBTN_LEFT": "pause", "MBTN_LEFT_DBL": "fs", "f": "fs", "ESC": "esc",
                  "LEFT": "-5", "RIGHT": "+5", "Shift+LEFT": "-30", "Shift+RIGHT": "+30", "m": "mute",
                  "p": "pin", "s": "snap", "b": "bm", "B": "range", "c": "tagchar", "i": "clip_in", "o": "clip_out", "t": "thumb", "WHEEL_UP": "vol+", "WHEEL_DOWN": "vol-"}
        for i in range(1, 10):
            keymap[f"Ctrl+{i}"] = f"t{i}"
            keymap[f"Ctrl+Shift+{i}"] = f"preset{i}"
        for key, action in keymap.items():
            self.player.register_key_binding(
                key, lambda state, *_a, act=action: state[:1] in ("d", "p") and self._mpv_key.emit(act))

        self.timer = QTimer(self, interval=200)
        self.timer.timeout.connect(self._poll)
        self.timer.start()
        self.setFocusPolicy(Qt.StrongFocus)

    # ---------------------------------------------------------------- mpv events
    def _on_mpv_event(self, event):
        try:
            name = str(event.event_id).lower().replace("_", "-")
        except Exception:
            return
        if "file-loaded" in name:
            self._mpv_loaded.emit()

    def handle_action(self, act):
        if act == "pause":
            self.toggle_pause()
        elif act == "subs":
            try:
                self.player["sub-visibility"] = not self.player["sub-visibility"]
            except Exception:   # no subtitles loaded
                pass
        elif act == "fs":
            self.fullscreen_requested.emit()
        elif act == "esc":
            if self.seekbar.clip:
                self.seekbar.clip = None
                self._refresh_clipbar()
            elif self.seekbar.range_a is not None:
                self._clear_range()
            elif self.window().isFullScreen():
                self.fullscreen_requested.emit()
        elif act in ("-5", "+5", "-30", "+30"):
            self.seek_relative(float(act))
        elif act == "mute":
            self.mute_btn.toggle()
        elif act == "pin" and self.media:
            self.pin_requested.emit(self.media, self.position())
        elif act == "popout":
            self.popout_requested.emit()
        elif act == "close":
            if self.is_popout:
                self.stop()
                self.window().close()
            else:
                self.close_requested.emit()
        elif act == "bm" and self.media:
            self.bookmark_requested.emit(self.media, self.position(), None)
        elif act == "range" and self.media:
            pos = self.position()
            if self.seekbar.range_a is None:
                self.seekbar.range_a = pos
                self.bm_btn.setText(" " + tr("Segment end"))
                self.bm_btn.setProperty("armed", True)
            else:
                a = self.seekbar.range_a
                self._clear_range()
                if abs(pos - a) >= 0.5:
                    self.bookmark_requested.emit(self.media, min(a, pos), max(a, pos))
            self.bm_btn.style().unpolish(self.bm_btn)
            self.bm_btn.style().polish(self.bm_btn)
            self.seekbar.update()
        elif act == "clip_in" and self.media:
            pos = self.position()
            b = self.seekbar.clip[1] if self.seekbar.clip else None
            self.seekbar.clip = [pos, b if b is not None and b > pos else None]
            self._refresh_clipbar()
        elif act == "clip_out" and self.media:
            pos = self.position()
            a = self.seekbar.clip[0] if self.seekbar.clip else max(0.0, pos - 30)
            self.seekbar.clip = [min(a, pos), max(a, pos)]
            self._refresh_clipbar()
        elif act == "clip_clear":
            self.seekbar.clip = None
            self._refresh_clipbar()
        elif act in ("clip_play", "clip_save", "clip_export") and self.media and self.seekbar.clip:
            a, b = self.seekbar.clip
            if b is None:
                b = self.position()
                if b <= a:
                    self.warn.setText(tr("Set the clip end (O)"))
                    return
                self.seekbar.clip = [a, b]
            if act == "clip_play":
                self.seek_to(a)
                self.stop_at = b
                self.player.pause = False
            elif act == "clip_save":
                self.bookmark_requested.emit(self.media, a, b)
                self.seekbar.clip = None
            else:
                self.export_requested.emit(self.media, a, b)
            self._refresh_clipbar()
        elif act == "thumb" and self.media:
            self.thumb_requested.emit(self.media, self.position())
        elif act == "seek0" and self.media:
            self.seek_to(0)
        elif act == "tagchar" and self.media:
            self.tagchar_requested.emit(self.media, self.position())
        elif act == "waves":
            self.wave_btn.toggle()
        elif act == "snap" and self.media:
            self.snapshot_requested.emit(self.media, self.position())
        elif act == "vol+":
            self.vol.setValue(self.vol.value() + 5)
        elif act == "vol-":
            self.vol.setValue(self.vol.value() - 5)
        elif act.startswith("preset") and act[6:].isdigit():
            i = int(act[6:]) - 1
            if 0 <= i < len(self.presets()):
                self.apply_preset(self.presets()[i]["roles"])
                self.warn.setText(self.presets()[i]["name"])
        elif act.startswith("t") and act[1:].isdigit():
            for p in self.trackbar.pills:
                if p.aid == int(act[1:]):
                    p.toggle()

    def _clear_range(self):
        self.seekbar.range_a = None
        self.bm_btn.setText(" " + tr("Moment"))
        self.bm_btn.setProperty("armed", False)
        self.bm_btn.style().unpolish(self.bm_btn)
        self.bm_btn.style().polish(self.bm_btn)
        self.seekbar.update()

    def keyPressEvent(self, e):
        k, mods = e.key(), e.modifiers()
        acts = {Qt.Key_Space: "pause", Qt.Key_F: "fs", Qt.Key_M: "mute", Qt.Key_P: "pin", Qt.Key_S: "snap", Qt.Key_C: "tagchar", Qt.Key_I: "clip_in", Qt.Key_O: "clip_out", Qt.Key_T: "thumb",
                Qt.Key_V: "subs", Qt.Key_Escape: "esc"}
        if k in (Qt.Key_Left, Qt.Key_Right):
            n = 30 if mods & Qt.ShiftModifier else 5
            self.handle_action(f"{'-' if k == Qt.Key_Left else '+'}{n}")
        elif k == Qt.Key_B:
            self.handle_action("range" if mods & Qt.ShiftModifier else "bm")
        elif mods & Qt.ControlModifier and mods & Qt.ShiftModifier and e.nativeVirtualKey() in range(0x31, 0x3A):
            self.handle_action(f"preset{e.nativeVirtualKey() - 0x30}")
        elif mods & Qt.ControlModifier and Qt.Key_1 <= k <= Qt.Key_9:
            self.handle_action(f"t{k - Qt.Key_0}")
        elif k in acts:
            self.handle_action(acts[k])
        else:
            super().keyPressEvent(e)

    # ---------------------------------------------------------------- loading
    def load(self, media, offset=None, state=None, autoplay=True, end=None):
        if not media or not os.path.exists(media.path):
            return False
        self.media = media
        self.stop_at = end
        self._clear_range()
        self.pending_seek = offset
        self.pending_state = state
        self.title.setText(media.display_title)
        kind = {"session": tr("Recording"), "manual": tr("Manual recording")}.get(media.effective_kind, tr("Clip"))
        from .common import fmt_dt
        self.sub.setText(f"{media.game}  ·  {fmt_dt(media.start_time)}  ·  {kind}")
        self.seekbar.duration = media.duration or 0
        self.seekbar.marks = []
        self.seekbar.clip = None
        self.clipbar.hide()
        self.seekbar.update()
        self.seekbar.frames = None
        self.wave_data = None
        self.waves.set_data(None, [], {})
        self.tracks = []
        self.player["lavfi-complex"] = ""
        self.player["aid"] = "auto"
        self.player["audio-files"] = [s["path"] for s in media.sidecar_list() if os.path.exists(s["path"])]
        # transcript as subtitles (V toggles them)
        from ..analysis import analysis_dir
        srt = analysis_dir(media.id) / "transcript.srt"
        self.player["sub-files"] = [str(srt)] if self.settings.get("ai_subtitles", True) and srt.exists() else []
        if state:
            self.player.speed = state.get("speed", 1.0)
            self.speed_btn.setText(f"{state.get('speed', 1.0):g}×")
        self.player.pause = not autoplay if not state else state.get("paused", False)
        self.player.loadfile(media.path, "replace")
        self.state_changed.emit()
        return True

    def _refresh_clipbar(self):
        c = self.seekbar.clip
        self.clipbar.setVisible(bool(c))
        if c:
            if c[1] is None:
                self.clip_lbl.setText("✂  " + tr("Clip from {start} – now set the end (O)", start=fmt_dur(c[0])))
            else:
                self.clip_lbl.setText("✂  " + tr("Clip {start} – {end}   ({duration})   · drag the edges on the timeline",
                                                 start=fmt_dur(c[0]), end=fmt_dur(c[1]), duration=fmt_dur(c[1] - c[0])))
        self.seekbar.update()

    def set_frames(self, media_id, meta):
        if self.media and self.media.id == media_id and meta:
            self.seekbar.frames = meta

    def set_wave(self, media_id, data):
        if self.media and self.media.id == media_id and data:
            self.wave_data = data
            self._refresh_waves()

    def _refresh_waves(self):
        st = self.trackbar.state()
        on = self.wave_btn.isChecked()
        self.waves.duration = self.seekbar.duration
        self.waves.set_data(self.wave_data if on else None, self.tracks, {a: v[0] for a, v in st.items()})

    def _toggle_waves(self, on):
        self.settings["show_waves"] = bool(on)
        self._refresh_waves()

    def set_marks(self, marks):
        self.seekbar.marks = list(marks or [])
        self.seekbar.update()

    def stop(self):
        try:
            self.player.command("stop")
        except Exception:
            pass
        self.media = None
        self.title.setText("")
        self.sub.setText("")
        self.seekbar.duration = 0
        self.seekbar.marks = []
        self.stop_at = None
        self.trackbar.set_tracks([])
        self.state_changed.emit()

    def export_state(self):
        if not self.media:
            return None
        try:
            paused = bool(self.player.pause)
            speed = float(self.player.speed or 1.0)
        except Exception:
            paused, speed = False, 1.0
        return {"media": self.media, "pos": self.position(), "paused": paused, "speed": speed, "end": self.stop_at,
                "mix": self.trackbar.state(), "marks": list(self.seekbar.marks)}

    def import_state(self, st):
        if not st:
            return
        self.load(st["media"], offset=st["pos"], state=st, end=st.get("end"))
        self.set_marks(st.get("marks", []))

    def _on_loaded(self):
        if self.pending_seek:
            try:
                self.player.seek(self.pending_seek, "absolute+exact")
            except Exception:
                pass
            self.pending_seek = None
        self._rebuild_tracks(force=True)
        if self.pending_state and self.pending_state.get("mix"):
            self._apply_mix()
        else:
            self._apply_default_mix()
        self.pending_state = None

    # ---------------------------------------------------------------- tracks
    def _rebuild_tracks(self, force=False):
        try:
            tl = self.player.track_list or []
        except Exception:
            tl = []
        names = self.media.track_names() if self.media else []
        sidecars = self.media.sidecar_list() if self.media else []
        tracks, ext_i = [], 0
        for t in tl:
            if t.get("type") != "audio":
                continue
            aid = t["id"]
            if t.get("external"):
                sc = sidecars[ext_i] if ext_i < len(sidecars) else {"role": "other", "name": tr("External")}
                ext_i += 1
                role, name = sc.get("role", "other"), sc.get("name", "")
            elif aid - 1 < len(names):
                role, name = names[aid - 1]["role"], names[aid - 1]["name"]
            else:
                role, name = ("all" if aid == 1 else "other"), (t.get("title") or "")
            label = tr(ROLE_INFO.get(role, ROLE_INFO["other"])[0])
            if role == "other" and name:
                label = name
            tracks.append({"aid": aid, "role": role, "label": label})
        if not force and [(t["aid"], t["label"]) for t in tracks] == [(t["aid"], t["label"]) for t in self.tracks]:
            return
        self.tracks = tracks
        if self.pending_state and self.pending_state.get("mix"):
            state = self.pending_state["mix"]
        else:
            cur = self._current_aid()
            state = {t["aid"]: (t["aid"] == cur, 100) for t in tracks}
        self.trackbar.set_tracks(tracks, state)
        self._update_warn()
        self._refresh_waves()

    def _current_aid(self):
        try:
            aid = self.player.aid
            return int(aid) if aid not in (None, False, "no", "auto") else 1
        except Exception:
            return 1

    # ---------------------------------------------------------------- presets
    def presets(self):
        if "mix_presets" not in self.settings:
            self.settings["mix_presets"] = [dict(p, name=tr(p["name"])) for p in DEFAULT_PRESETS]
        return self.settings["mix_presets"]

    def _current_roles(self):
        st = self.trackbar.state()
        return [{"role": t["role"], "volume": st[t["aid"]][1]} for t in self.tracks if st.get(t["aid"], (False,))[0]]

    @staticmethod
    def _same_roles(a, b):
        key = lambda rs: sorted((r["role"], int(r.get("volume", 100))) for r in rs)
        return key(a) == key(b)

    def _save_settings(self):
        try:
            from .. import config
            config.save_settings(self.settings)
        except Exception:
            pass

    def apply_preset(self, roles, remember=True):
        if not self._apply_roles(roles):
            self.warn.setText(tr("This video doesn't have those tracks"))
            return
        if remember:
            self.mix_changed.emit(self._current_roles())

    def _more_menu(self, *_):
        m = QMenu(self)
        for label, act in ((tr("Clip start here (I)"), "clip_in"), (tr("Clip end here (O)"), "clip_out"),
                           (tr("Cancel selection"), "clip_clear"), (None, None),
                           (tr("Set this frame as the video thumbnail (T)"), "thumb")):
            if label is None:
                m.addSeparator()
                continue
            a = m.addAction(label)
            a.triggered.connect(lambda *_, x=act: self.handle_action(x))
        m.exec(QCursor.pos())

    def _preset_menu(self):
        m = QMenu(self)
        cur = self._current_roles()
        head = m.addAction(tr("Audio track presets"))
        head.setEnabled(False)
        for i, pr in enumerate(self.presets()):
            a = m.addAction(("✓  " if self._same_roles(pr["roles"], cur) else "     ") + pr["name"]
                            + (f"\tCtrl+Shift+{i + 1}" if i < 9 else ""))
            a.triggered.connect(lambda *_, r=pr["roles"]: self.apply_preset(r))
        m.addSeparator()
        save = m.addAction(tr("Save current tracks as a preset…"))
        save.triggered.connect(self._save_preset)
        game = self.media.game if self.media else None
        if game:
            gm = self.settings.setdefault("game_mix", {})
            a = m.addAction(tr("Always start with these tracks for the game “{game}”", game=game))
            a.triggered.connect(lambda *_: (gm.__setitem__(game, cur), self._save_settings(),
                                            self.warn.setText(tr("Default tracks for {game} saved", game=game))))
            if game in gm:
                a2 = m.addAction(tr("Remove default tracks for “{game}”", game=game))
                a2.triggered.connect(lambda *_: (gm.pop(game, None), self._save_settings()))
        if self.presets():
            dm = m.addMenu(tr("Delete preset"))
            for pr in list(self.presets()):
                a = dm.addAction(pr["name"])
                a.triggered.connect(lambda *_, p=pr: (self.presets().remove(p), self._save_settings()))
        m.exec(self.preset_btn.mapToGlobal(self.preset_btn.rect().topLeft()) - QPoint(0, m.sizeHint().height()))

    def _save_preset(self):
        from PySide6.QtWidgets import QInputDialog
        cur = self._current_roles()
        if not cur:
            return
        labels = " + ".join(tr(ROLE_INFO.get(r["role"], ROLE_INFO["other"])[0]) for r in cur)
        name, ok = QInputDialog.getText(self, tr("New preset"), tr("Preset name:"), text=labels)
        if ok and name.strip():
            self.presets().append({"name": name.strip(), "roles": cur})
            self._save_settings()

    def _apply_roles(self, roles):
        if not roles or not self.trackbar.pills:
            return False
        wanted = {r["role"]: r.get("volume", 100) for r in roles if isinstance(r, dict)}
        if not any(t["role"] in wanted for t in self.tracks):
            return False
        used = set()
        state = {}
        for t in self.tracks:
            on = t["role"] in wanted and t["role"] not in used
            if on:
                used.add(t["role"])
            state[t["aid"]] = (on, int(wanted.get(t["role"], 100)) if on else 100)
        self._applying = True
        self.trackbar.set_tracks(self.tracks, state)
        self._applying = False
        self._apply_mix(remember=False)
        return True

    def _apply_default_mix(self):
        game = self.media.game if self.media else None
        candidates = [(self.settings.get("game_mix") or {}).get(game)]
        if self.settings.get("remember_last_mix", True):
            candidates.append(self.settings.get("last_mix"))
        candidates.append(self.settings.get("default_mix"))
        for roles in candidates:
            if roles and self._apply_roles(roles):
                return

    def _schedule_mix(self):
        self._mix_timer.start()

    def _apply_mix(self, remember=True):
        sel = [(aid, vol) for aid, (on, vol) in self.trackbar.state().items() if on]
        try:
            if not sel:
                self.player["lavfi-complex"] = ""
                self.player["aid"] = "no"
            elif len(sel) == 1 and sel[0][1] == 100:
                self.player["lavfi-complex"] = ""
                self.player["aid"] = str(sel[0][0])
            elif len(sel) == 1:
                self.player["lavfi-complex"] = f"[aid{sel[0][0]}]volume={sel[0][1] / 100:.2f}[ao]"
            else:
                parts = [f"[aid{a}]volume={v / 100:.2f}[a{a}]" for a, v in sel]
                labels = "".join(f"[a{a}]" for a, _ in sel)
                self.player["lavfi-complex"] = ";".join(parts) + f";{labels}amix=inputs={len(sel)}:normalize=0:dropout_transition=0[ao]"
        except Exception as e:
            self.warn.setText(tr("Mix failed: {error}", error=e))
            return
        self._update_warn()
        self._refresh_waves()
        if remember and not self._applying:
            roles = [{"role": t["role"], "volume": self.trackbar.state()[t["aid"]][1]}
                     for t in self.tracks if self.trackbar.state().get(t["aid"], (False,))[0]]
            self.mix_changed.emit(roles)

    def _update_warn(self):
        st = self.trackbar.state()
        on = [t for t in self.tracks if st.get(t["aid"], (False,))[0]]
        if any(t["role"] == "all" for t in on) and len(on) > 1:
            self.warn.setText(tr("“All” already contains the other tracks – the sound will be doubled"))
        else:
            self.warn.setText("")

    # ---------------------------------------------------------------- transport
    def toggle_pause(self):
        if self.media:
            self.player.pause = not self.player.pause

    def seek_relative(self, s):
        if self.media:
            try:
                self.player.seek(s, "relative")
            except Exception:
                pass

    def seek_to(self, t):
        if self.media:
            try:
                self.player.seek(max(0.0, t), "absolute")
            except Exception:
                pass

    def position(self):
        try:
            return float(self.player.time_pos or 0)
        except (TypeError, ValueError):
            return 0.0

    def paused(self):
        try:
            return bool(self.player.pause)
        except Exception:
            return True

    def snapshot(self, path):
        if not self.media:
            return None
        self.player.command("screenshot-to-file", path, "video")
        return self.media, self.position()

    def _speed_menu(self):
        m = QMenu(self)
        for s in (0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0):
            a = m.addAction(f"{s:g}×")
            a.triggered.connect(lambda _=False, s=s: (setattr(self.player, "speed", s), self.speed_btn.setText(f"{s:g}×")))
        m.exec(QCursor.pos())

    def _set_volume(self, v):
        self.player.volume = v
        self.settings["volume"] = v

    def _set_mute(self, on):
        self.player.mute = on
        self.mute_btn.setText(glyph("volume-x" if on else "volume-2"))

    def _poll(self):
        if not self.media:
            return
        try:
            pos = self.player.time_pos
            dur = self.player.duration
            paused = bool(self.player.pause)
        except Exception:
            return
        if dur:
            self.seekbar.duration = dur
        if pos is not None:
            self.seekbar.set_pos(pos)
            if self.waves.isVisible():
                self.waves.pos_ = pos
                self.waves.duration = self.seekbar.duration
                self.waves.update()
            if self.stop_at is not None:
                if pos > self.stop_at + 3:      # user jumped past the clip end
                    self.stop_at = None
                elif pos >= self.stop_at:       # end of a virtual clip
                    self.player.pause = True
                    self.stop_at = None
            if self.seekbar.range_a is not None:
                self.seekbar.update()
        self.time.setText(f"{fmt_dur(pos or 0)} / {fmt_dur(self.seekbar.duration)}")
        self.play_btn.setText(glyph("play" if paused else "pause"))
        if paused != self._last_paused:
            self._last_paused = paused
            self.state_changed.emit()

    def set_info_on(self, on):
        self.info_btn.setChecked(on)

    def set_layout_mode(self, mode):
        row = mode == "row"
        self.layout_btn.setText(glyph("panel-bottom" if row else "columns-2"))
        self.layout_btn.setToolTip(tr("Info below the video") if row else tr("Info next to the video"))

    def set_chrome_visible(self, on):
        self.header.setVisible(on)

    def shutdown(self):
        self.seekbar.popup.hide()
        self.timer.stop()
        self._mix_timer.stop()
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            for sig in (self._mpv_tracks, self._mpv_loaded, self._mpv_key):
                try:
                    sig.disconnect()
                except (RuntimeError, TypeError):
                    pass
        self.media = None
        try:
            self.player.terminate()
        except Exception:
            pass


class PlayerWindow(QWidget):
    """Separate (pop-out) player window."""
    closed = Signal(object)   # exported state

    def __init__(self, settings, temporary_fullscreen=False):
        super().__init__(None, Qt.Window)
        self.setWindowTitle(tr("Kosmas – player"))
        self.setStyleSheet("background:#0b0d11;")
        self.resize(1280, 800)
        self.temporary = temporary_fullscreen
        self.player = PlayerWidget(settings, self, popout=True)
        self.player.fullscreen_requested.connect(self.toggle_fullscreen)
        self.player.popout_requested.connect(self.close)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addWidget(self.player)
        geo = settings.get("popout_geometry")
        if geo:
            from PySide6.QtCore import QByteArray
            self.restoreGeometry(QByteArray.fromBase64(geo.encode()))
        self.settings = settings

    def toggle_fullscreen(self):
        if self.isFullScreen():
            if self.temporary:
                self.close()
                return
            self.showNormal()
            self.player.set_chrome_visible(True)
        else:
            self.player.set_chrome_visible(False)
            self.showFullScreen()

    def closeEvent(self, e):
        if not self.isFullScreen():
            self.settings["popout_geometry"] = bytes(self.saveGeometry().toBase64()).decode()
        st = self.player.export_state()
        self.player.shutdown()
        self.closed.emit(st)
        super().closeEvent(e)
