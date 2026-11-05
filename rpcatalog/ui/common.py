"""Shared UI helpers: formatting, labels, theme."""
import datetime as dt

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QPalette

ROLE_LABEL = {
    "all": "Vše (mix)",
    "game": "Hra",
    "system": "Systém / ostatní",
    "discord": "Discord",
    "mic": "Mikrofon",
    "other": "Stopa",
}
KIND_LABEL = {"clip": "Klip", "session": "Záznam", "manual": "Nahrávka"}
KIND_LABEL_PLURAL = {"clip": "Klipy", "session": "Celé záznamy", "manual": "Ruční nahrávky"}
KIND_COLOR = {"clip": "#4f9dde", "session": "#c9a227", "manual": "#9b6dd6"}
MEDIA_MIME = "application/x-rpcatalog-media"


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
            return f"{n:.0f} {unit}" if unit in ("B", "KB") else f"{n:.1f} {unit}".replace(".", ",")
        n /= 1024


def track_label(track, index):
    role = track.get("role") or "other"
    name = track.get("name") or ""
    label = ROLE_LABEL.get(role, "Stopa")
    if role == "game" and name and not name.lower().startswith("game"):
        short = name.replace("-Win64-Shipping", "").replace(".exe", "")
        label = f"Hra ({short})"
    if role == "other":
        label = name or f"Stopa {index}"
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
