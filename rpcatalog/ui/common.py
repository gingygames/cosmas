"""Shared UI helpers: formatting, labels, theme."""
import datetime as dt
import re

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QPalette

from ..i18n import tr, lang

# English labels – pass them through tr() where they are shown (the language may change after import)
ROLE_LABEL = {
    "all": "All (mix)",
    "game": "Game",
    "system": "System / other",
    "discord": "Discord",
    "mic": "Microphone",
    "other": "Track",
}
KIND_LABEL = {"clip": "Clip", "session": "Recording", "manual": "Manual recording"}
KIND_LABEL_PLURAL = {"clip": "Clips", "session": "Full recordings", "manual": "Manual recordings"}
KIND_COLOR = {"clip": "#4f9dde", "session": "#c9a227", "manual": "#9b6dd6"}
MEDIA_MIME = "application/x-rpcatalog-media"


_RESERVED_NAMES = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


def safe_name(s):
    """A file or folder name Windows accepts (exported clips): none of \\ / : * ? " < > | or control characters, no
    dots or spaces at the ends (so never "." or ".."), not a reserved device name (CON, NUL, COM1…)."""
    s = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", str(s or ""))
    s = re.sub(r"\s+", " ", s).strip(" .")
    if s.split(".")[0].strip().lower() in _RESERVED_NAMES:
        s = "_" + s
    return s


def fmt_dur(seconds):
    if seconds is None:
        return "?"
    seconds = int(round(seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def fmt_dt(t, with_seconds=False):
    if not t:
        return "—"
    f = "%d.%m.%Y %H:%M:%S" if with_seconds else "%d.%m.%Y %H:%M"
    return dt.datetime.fromtimestamp(t).strftime(f)


def fmt_size(n):
    if not n:
        return "—"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if unit in ("B", "KB") else f"{n:.1f} {unit}".replace(".", "," if lang() == "cs" else ".")
        n /= 1024


def track_label(track, index):
    role = track.get("role") or "other"
    name = track.get("name") or ""
    label = tr(ROLE_LABEL.get(role, "Track"))
    if role == "game" and name and not name.lower().startswith("game"):
        short = name.replace("-Win64-Shipping", "").replace(".exe", "")
        label = tr("Game ({name})", name=short)
    if role == "other":
        label = name or tr("Track {n}", n=index)
    return label


def apply_dark_theme(app):
    app.setStyle("Fusion")
    p = QPalette()
    base = QColor("#1b1d22")
    window = QColor("#23262d")
    text = QColor("#e6e6e6")
    p.setColor(QPalette.Window, window)
    p.setColor(QPalette.WindowText, text)
    p.setColor(QPalette.Base, base)
    p.setColor(QPalette.AlternateBase, QColor("#262a31"))
    p.setColor(QPalette.ToolTipBase, QColor("#30343c"))
    p.setColor(QPalette.ToolTipText, text)
    p.setColor(QPalette.Text, text)
    p.setColor(QPalette.Button, QColor("#2c3038"))
    p.setColor(QPalette.ButtonText, text)
    p.setColor(QPalette.BrightText, Qt.red)
    p.setColor(QPalette.Highlight, QColor("#c9a227"))
    p.setColor(QPalette.HighlightedText, QColor("#111"))
    p.setColor(QPalette.PlaceholderText, QColor("#8a8f99"))
    p.setColor(QPalette.Disabled, QPalette.Text, QColor("#6b6f78"))
    p.setColor(QPalette.Disabled, QPalette.ButtonText, QColor("#6b6f78"))
    app.setPalette(p)
    app.setStyleSheet("""
        QToolTip { border: 1px solid #555; padding: 4px; }
        QTabBar::tab { padding: 6px 14px; }
        QTabBar::tab:selected { color: #e8c547; }
        QGroupBox { border: 1px solid #3a3e47; border-radius: 4px; margin-top: 10px; padding-top: 6px; }
        QGroupBox::title { subcontrol-origin: margin; left: 8px; padding: 0 4px; color: #b9bdc6; }
        QPushButton { padding: 4px 10px; }
        QLineEdit, QPlainTextEdit, QComboBox, QDateTimeEdit, QSpinBox { padding: 3px; }
        QTreeWidget::item, QListWidget::item { padding: 2px; }
        QSplitter::handle { background: #2a2d34; }
    """)
