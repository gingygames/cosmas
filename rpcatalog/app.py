"""Main window: web UI (QWebEngine) + native mpv player (docked or popped out)."""
import os
import sys
import time
import traceback

from PySide6.QtCore import Qt, QThread, Signal, QTimer, QUrl, QByteArray
from PySide6.QtGui import QColor, QCursor, QIcon
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import (QApplication, QMainWindow, QSplitter, QMessageBox, QWidget, QHBoxLayout,
                               QVBoxLayout, QLabel, QToolButton)

from . import config, scanner
from . import appearance, chronicle, mentions
from .analysis import analysis_dir, load_frames, load_results, _read_json
from .analysis_jobs import AnalysisJobs
from .api import Api
from . import i18n
from .i18n import tr
from .previews import PreviewWorker
from .store import Store

WEB_DIR = config.APP_DIR / "rpcatalog" / "web"
ICON_PATH = config.APP_DIR / "rpcatalog" / "assets" / "kronikar.ico"
APP_ID = "Gingygames.Kronikar"


class ScanThread(QThread):
    done = Signal(dict)
    failed = Signal(str)

    def __init__(self, settings):
        super().__init__()
        self.settings = settings

    def run(self):
        try:
            store = Store(config.DB_PATH)
            res = scanner.scan(store, self.settings)
            store.db.close()
            self.done.emit(res)
        except Exception:
            self.failed.emit(traceback.format_exc())


class Page(QWebEnginePage):
    def javaScriptConsoleMessage(self, level, message, line, source):
        if level != QWebEnginePage.JavaScriptConsoleMessageLevel.InfoMessageLevel or os.environ.get("RPC_DEBUG"):
            print(f"[js] {os.path.basename(source)}:{line} {message}", file=sys.stderr)

    def acceptNavigationRequest(self, url, nav_type, is_main):
        # open external links in the system browser, keep the app on its own page
        if url.scheme() in ("http", "https"):
            import webbrowser
            webbrowser.open(url.toString())
            return False
        return super().acceptNavigationRequest(url, nav_type, is_main)


class TitleBar(QWidget):
    """Own title bar in the app's colours: drag to move (with Windows snapping), double-click to maximise."""

    def __init__(self, win):
        super().__init__(win)
        from .ui.player import glyph, icon_font
        self.win = win
        self.setFixedHeight(32)
        self.setAttribute(Qt.WA_StyledBackground, True)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(12, 0, 0, 0)
        lay.setSpacing(8)
        self.logo = QLabel()
        self.logo.setFixedSize(18, 18)
        self.logo.setPixmap(QIcon(str(ICON_PATH)).pixmap(18, 18))
        self.title = QLabel("Kosmas")
        lay.addWidget(self.logo)
        lay.addWidget(self.title)
        lay.addStretch(1)
        self.btns = []
        for name, tip, fn in (("minus", tr("Minimize"), win.showMinimized), ("square", tr("Maximize"), self.toggle_max),
                              ("x", tr("Close"), win.close)):
            b = QToolButton(self)
            b.setText(glyph(name))
            b.setFont(icon_font(14))
            b.setToolTip(tip)
            b.setFixedSize(46, 32)
            b.setObjectName("tb_close" if name == "x" else "tb_btn")
            b.clicked.connect(fn)
            lay.addWidget(b)
            self.btns.append(b)
        self.set_colors("#101216", "#eceef1", "#e3b341")

    def set_colors(self, bg, fg, accent):
        self.setStyleSheet(f"""
            TitleBar {{ background: {bg}; }}
            QLabel {{ color: {fg}; font: 600 12px 'Segoe UI Variable Text','Segoe UI'; }}
            QToolButton {{ border: 0; background: transparent; color: {fg}; }}
            QToolButton#tb_btn:hover {{ background: rgba(128,128,128,.22); }}
            QToolButton#tb_close:hover {{ background: #e81123; color: white; }}""")
        self.logo.setStyleSheet("background: transparent;")

    def toggle_max(self):
        self.win.showNormal() if self.win.isMaximized() else self.win.showMaximized()

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self.win.windowHandle().startSystemMove()

    def mouseDoubleClickEvent(self, e):
        self.toggle_max()


class MainWindow(QMainWindow):
    _clip_done = Signal(int, str, float, float, bool, str)

    def __init__(self):
        super().__init__()
        # The video surface is a native window. Without this Qt makes its siblings (player header,
        # controls) native too, and those stayed on screen after the player was closed.
        QApplication.setAttribute(Qt.AA_DontCreateNativeWidgetSiblings, True)
        from .ui.player import PlayerWidget  # imports mpv (needs locale set)
        self.setWindowTitle("Kosmas")
        self.setWindowFlag(Qt.FramelessWindowHint, True)
        self.resize(1700, 1000)
        self.setStyleSheet("QMainWindow { background: #0d0f13; } QSplitter::handle { background: #1a1e25; }")
        self.settings = config.load_settings()
        self.store = Store(config.DB_PATH)
        self.scan_thread = None
        self.popout = None
        self.fs_temp = False

        # web UI
        self.web = QWebEngineView()
        self.page = Page(self.web)
        self.page.setBackgroundColor(QColor("#0d0f13"))
        self.web.setPage(self.page)
        s = self.page.settings()
        s.setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        s.setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, False)
        s.setAttribute(QWebEngineSettings.JavascriptCanAccessClipboard, True)
        s.setAttribute(QWebEngineSettings.JavascriptCanPaste, True)
        self.api = Api(self.store, self.settings, self)
        self.channel = QWebChannel(self.page)
        self.channel.registerObject("api", self.api)
        self.page.setWebChannel(self.channel)
        lang = i18n.set_lang(self.settings.get("lang", "auto"))
        url = QUrl.fromLocalFile(str(WEB_DIR / "index.html"))
        url.setQuery(f"lang={lang}")
        self.web.load(url)

        # second, small page under the docked player: info + editing of the playing video
        self.detail = QWebEngineView()
        self.dpage = Page(self.detail)
        self.dpage.setBackgroundColor(QColor("#1b1e24"))
        self.detail.setPage(self.dpage)
        ds = self.dpage.settings()
        ds.setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        ds.setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, False)
        ds.setAttribute(QWebEngineSettings.JavascriptCanAccessClipboard, True)
        ds.setAttribute(QWebEngineSettings.JavascriptCanPaste, True)
        self.dchannel = QWebChannel(self.dpage)
        self.dchannel.registerObject("api", self.api)
        self.dpage.setWebChannel(self.dchannel)
        durl = QUrl.fromLocalFile(str(WEB_DIR / "index.html"))
        durl.setQuery(f"pane=detail&lang={lang}")
        self.detail.load(durl)
        self.detail.setMinimumHeight(120)

        # docked player
        self.player = PlayerWidget(self.settings)
        self._wire_player(self.player)
        self.player.close_requested.connect(self.close_player)
        self.player.popout_requested.connect(self.open_popout)
        self.player.fullscreen_requested.connect(lambda: self.open_popout(fullscreen=True))
        self.previews = PreviewWorker()
        self.previews.frames_ready.connect(lambda mid, meta: [p.set_frames(mid, meta) for p in self._players()])
        self.previews.wave_ready.connect(lambda mid, data: [p.set_wave(mid, data) for p in self._players()])
        self.analysis = AnalysisJobs(self.settings, self._world)
        self.analysis.detected_games = self.store.game_processes()
        self.analysis.event.connect(self._on_analysis)    # bound method -> runs in the GUI thread
        self._analysis_imported = {}
        self._games_timer = QTimer(self)
        self._games_timer.timeout.connect(self.analysis.check_games)
        self._games_timer.start(10000)
        self._resume_tick = 0
        self._clip_done.connect(self._on_clip_done)

        self.dock = QSplitter(Qt.Vertical)
        self.dock.setHandleWidth(3)
        self.dock.addWidget(self.player)
        self.dock.addWidget(self.detail)
        self.dock.setStretchFactor(0, 1)
        self.dock.setStretchFactor(1, 0)
        self.dock.setCollapsible(0, False)
        self.dock.setCollapsible(1, False)
        self.dock.setChildrenCollapsible(False)
        self.detail.setVisible(self.settings.get("detail_pane", True))
        self.player.info_requested.connect(self.toggle_detail)
        self.dock.hide()

        self.split = QSplitter(Qt.Horizontal)
        self.split.setHandleWidth(3)
        self.split.addWidget(self.web)
        self.split.addWidget(self.dock)
        self.split.setStretchFactor(0, 1)
        self.split.setChildrenCollapsible(False)
        self.titlebar = TitleBar(self)
        self.frame = QWidget()
        fl = QVBoxLayout(self.frame)
        fl.setContentsMargins(0, 0, 0, 0)
        fl.setSpacing(0)
        fl.addWidget(self.titlebar)
        fl.addWidget(self.split, 1)
        self.setCentralWidget(self.frame)
        self.player.layout_requested.connect(
            lambda: self.apply_layout("stack" if self._layout() == "row" else "row"))
        self.apply_layout()

        geo = self.settings.get("geometry")
        if geo:
            self.restoreGeometry(QByteArray.fromBase64(geo.encode()))
        QTimer.singleShot(400, self.rescan)
        if self.settings.get("sync_auto") and self.settings.get("sync_token"):
            # automatická synchronizace s webovou Kronikou po startu
            QTimer.singleShot(8000, lambda: self.api.m_sync_run(quiet=True))
        self.auto = QTimer(self, interval=5 * 60 * 1000)
        self.auto.timeout.connect(self.rescan)
        self.auto.start()
        self._state_timer = QTimer(self, interval=1000)
        self._state_timer.timeout.connect(self._push_state)
        self._state_timer.start()

    # ---------------------------------------------------------------- player plumbing
    def _wire_player(self, p):
        p.pin_requested.connect(lambda m, pos: self.api.emit("pin", {"media_id": m.id, "offset": pos}))
        p.snapshot_requested.connect(self._snapshot_requested)
        p.bookmark_requested.connect(self._bookmark_requested)
        p.export_requested.connect(self._export_clip)
        p.thumb_requested.connect(self._thumb_from_frame)
        p.tagchar_requested.connect(lambda m, t: (self.api.emit("tagchar", {"media_id": m.id, "t": t,
                                                                         "moment": (m.start_time or 0) + t}),
                                                  self.web.setFocus(), self.activateWindow()))
        p.mix_changed.connect(self._remember_mix)
        p.state_changed.connect(self._push_state)

    def _thumb_from_frame(self, media, t):
        import uuid
        dst = config.THUMB_DIR / "custom" / f"{media.id}-{uuid.uuid4().hex[:6]}.jpg"
        dst.parent.mkdir(parents=True, exist_ok=True)
        if self.active_player().snapshot(str(dst)):
            QTimer.singleShot(600, lambda: (self.api._set_custom_thumb(media.id, dst),
                                            self.api.emit("media-changed", {}),
                                            self.api.emit("toast", {"msg": tr("Video thumbnail set")})))

    def _export_clip(self, media, a, b):
        """Cut [a, b] into a real MP4 with all audio tracks (stream copy - fast, cuts on keyframes)."""
        import re
        import threading
        import subprocess
        from .scanner import make_thumb
        ff = config.find_tool("ffmpeg")
        if not ff:
            self.api.emit("toast", {"msg": tr("ffmpeg is missing"), "type": "err"})
            return
        safe = re.sub(r'[\\/:*?"<>|]+', "", media.display_title)[:60].strip() or "klip"
        out_dir = config.DATA_DIR / "clips" / (media.game or "Ostatní")
        out_dir.mkdir(parents=True, exist_ok=True)
        from .ui.common import fmt_dur
        dst = out_dir / f"{safe} {fmt_dur(a).replace(':', '-')}–{fmt_dur(b).replace(':', '-')}.mp4"
        self.api.emit("toast", {"msg": tr("Exporting clip ({duration})…", duration=fmt_dur(b - a))})

        def run():
            args = [ff, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", media.path]
            for sc in media.sidecar_list():
                if os.path.exists(sc["path"]):
                    args += ["-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", sc["path"]]
            args += ["-map", "0"]
            n_side = sum(1 for sc in media.sidecar_list() if os.path.exists(sc["path"]))
            for k in range(n_side):
                args += ["-map", f"{k + 1}:a"]
            args += ["-c", "copy", "-avoid_negative_ts", "make_zero", str(dst)]
            r = subprocess.run(args, capture_output=True, creationflags=0x08000000 if os.name == "nt" else 0)
            ok = r.returncode == 0 and dst.exists()
            self._clip_done.emit(media.id, str(dst), a, b, ok, r.stderr.decode("utf-8", "ignore")[-300:])
        threading.Thread(target=run, daemon=True).start()

    def _world(self):
        """What the chronicle already knows, for the models: names to recognise and use."""
        chars = [c["name"] + (f" ({c['aliases']})" if c.get("aliases") else "") for c in self.store.characters()]
        places = [p["name"] for p in self.store.places()]
        factions = [f["name"] for f in self.store.factions()]
        names = sorted({c["name"] for c in self.store.characters()} | {p["name"] for p in self.store.players() if p.get("name")})
        return {"characters": chars, "places": places, "factions": factions, "names": names}

    def _on_analysis(self, ev):
        mid, final = ev.get("id"), ev.get("phase") == "done"
        # results go into the searchable transcript table as they come (at most every 8 s while running)
        if mid and (final or (ev.get("partial") and time.time() - self._analysis_imported.get(mid, 0) > 8)):
            self._analysis_imported[mid] = time.time()
            self.import_analysis(mid, final)
            ev = dict(ev, imported=True)
        self.api.emit("analysis", dict(ev, queue=self.analysis.snapshot()))
        if final:
            self.api.emit("media-changed", {})

    def import_analysis(self, media_id, final=True):
        rows, _ = load_results(media_id)
        self.store.transcript_set(media_id, rows)
        chronicle.import_chronicle(self.store, media_id)
        matcher = mentions.Matcher([dict(c) for c in self.store.characters()], [dict(p) for p in self.store.players()])
        frames = load_frames(media_id)
        found = mentions.find(rows, frames, matcher)
        found += appearance.match_media(self.store, media_id, frames, matcher, self.settings)
        found += [{"character_id": x["entity_id"], "t": x["t"], "kind": "ai"}
                  for x in self.store.entity_mentions_of_media(media_id, "character")]
        self.store.set_mentions(media_id, found, autolink=self.settings.get("ai_autolink", True))
        if final:
            chapters = _read_json(analysis_dir(media_id) / "chapters.json", [])
            self.store.set_ai_bookmarks(media_id, chapters if self.settings.get("ai_chapter_bookmarks") else [])

    def _on_clip_done(self, media_id, path, a, b, ok, err):
        if not ok:
            self.api.emit("toast", {"msg": tr("Export failed: {error}", error=err), "type": "err"})
            return
        src = self.store.media(media_id)
        from .scanner import make_thumb
        rec = {"path": path, "game": src.game, "kind": "clip", "kind_override": None,
               "start_time": (src.start_time or 0) + a if src.start_time else None, "duration": b - a,
               "size": os.path.getsize(path), "medal_id": None, "medal_title": None,
               "thumb": make_thumb(path, b - a), "tracks": src["tracks"], "bookmarks": "[]", "sidecars": "[]",
               "parent_path": src.path}
        mid = self.store.upsert_media(rec)
        self.store.commit()
        self.store.update_media(mid, title=tr("{title} – clip", title=src.display_title))
        self.api.emit("media-changed", {})
        self.api.emit("clip-exported", {"id": mid, "path": path})

    def _players(self):
        return [p for p in (self.player, self.popout.player if self.popout else None) if p]

    def _save_resume(self, p, final=True):
        """Remember where a video was left; finished (or barely started) videos start from 0.
        The UI keeps its own copy of the media list, so it is told about every change."""
        if not p or not p.media:
            return
        pos, dur = p.position(), p.media.duration or 0
        if pos < 15 or (dur and pos > dur - 20):
            val = None
        else:
            val = round(pos, 1)
        try:
            self.store.set_resume(p.media.id, val)
        except Exception:
            return
        self.api.emit("resume", {"media_id": p.media.id, "pos": val, "at": time.time(), "final": final})

    def active_player(self):
        return self.popout.player if self.popout else self.player

    def _snapshot_requested(self, media, pos):
        self.api.emit("snapshot", {"media_id": media.id, "offset": pos,
                                   "moment": (media.start_time or 0) + pos})
        self.web.setFocus()
        self.activateWindow()

    def _remember_mix(self, roles):
        if self.settings.get("remember_last_mix", True):
            self.settings["last_mix"] = roles

    def _push_state(self):
        p = self.active_player()
        self._resume_tick += 1
        if p.media and not p.paused() and self._resume_tick % 5 == 0:
            self._save_resume(p, final=False)
        self.api.emit("player", {"media_id": p.media.id if p.media else None,
                                 "pos": p.position() if p.media else 0, "playing": bool(p.media and not p.paused()),
                                 "popout": self.popout is not None,
                                 "detail": bool(p.media and not self.popout and self.dock.isVisible()
                                                and self.detail.isVisible())})

    def _bookmark_requested(self, media, t, t_end):
        bid = self.api.m_bm_create(media.id, t, t_end)
        self.api.emit("bookmark", {"id": bid, "media_id": media.id, "t": t, "t_end": t_end})

    def _marks_for(self, media):
        from .ui.common import fmt_dur
        marks = []
        for b in self.store.bookmarks(media_id=media.id):
            label = b["title"] or (tr("segment") if b["t_end"] else tr("moment"))
            if b["event_title"]:
                label += f" → {b['event_title']}"
            marks.append({"t": b["t"], "t_end": b["t_end"], "label": label,
                          "color": b["color"] or b["event_color"] or "",
                          "kind": "auto" if b["source"] == "auto" and not b["event_id"] else "bm"})
        for l in self.store.links(media_id=media.id):
            if l["offset"] is not None:
                marks.append({"t": l["offset"], "t_end": None, "label": l["event_title"], "color": "", "kind": "ref"})
        return marks

    def refresh_marks(self, media_id):
        for p in (self.player, self.popout.player if self.popout else None):
            if p and p.media and p.media.id == media_id:
                p.set_marks(self._marks_for(p.media))

    # ---- host interface used by Api ----
    @property
    def dialog_parent(self):
        return self

    def play(self, media, offset=None, popout=False, end=None):
        if not os.path.exists(media.path):
            QMessageBox.warning(self, tr("File missing"), tr("The file no longer exists:\n{path}", path=media.path))
            return False
        media = self.store.media(media.id) or media
        if popout and not self.popout:
            self.open_popout(state={"media": media, "pos": offset or 0, "paused": False, "speed": 1.0, "end": end})
            return True
        p = self.active_player()
        self._save_resume(p)
        resumed = None
        rp = media.get("resume_pos")
        if offset is None and end is None and rp and (not media.duration or rp < media.duration - 20):
            offset = resumed = rp
        if p is self.player and not self.dock.isVisible():
            self._show_dock()
            self._restore_split()
        p.load(media, offset=offset or None, end=end)
        p.set_marks(self._marks_for(media))
        self.previews.request(media)
        if resumed:
            self.api.emit("resumed", {"media_id": media.id, "pos": resumed})
        if self.popout:
            self.popout.raise_()
            self.popout.activateWindow()
        return True

    def player_action(self, act):
        self.active_player().handle_action(act)

    def player_snapshot(self, path):
        return self.active_player().snapshot(path)

    def release_media(self, media_id):
        for p in (self.player, self.popout.player if self.popout else None):
            if p and p.media and p.media.id == media_id:
                p.stop()

    def save_settings(self):
        config.save_settings(self.settings)

    def rescan(self):
        if self.scan_thread and self.scan_thread.isRunning():
            return
        self.scan_thread = ScanThread(dict(self.settings))
        self.scan_thread.done.connect(lambda res: (self.store.auto_assign_servers(), self.api.emit("media-changed", res)))
        self.scan_thread.failed.connect(lambda err: print(err, file=sys.stderr))
        self.scan_thread.start()

    # ---------------------------------------------------------------- docking
    # layout: "side" = player right of the content, "top" = player above, content below
    def _layout(self):
        return "row" if self.settings.get("player_layout") == "row" else "stack"

    def _save_split(self):
        if self.dock.isVisible():
            self.settings["split_sizes_" + self._layout()] = self.split.sizes()
            if self.detail.isVisible():
                self.settings["dock_sizes_" + self._layout()] = self.dock.sizes()

    def _restore_split(self):
        sizes = self.settings.get("split_sizes_" + self._layout())
        if sizes and len(sizes) == 2 and sum(sizes) > 0 and sizes[1] >= 420:
            self.split.setSizes(sizes)
            return
        total = max(1000, self.split.width())
        share = .55 if self._layout() == "row" else .4
        self.split.setSizes([int(total * (1 - share)), int(total * share)])

    def apply_layout(self, mode=None):
        """Content always left, player right. mode: 'stack' = info under the video, 'row' = info beside it."""
        if mode is not None:
            self._save_split()
            self.settings["player_layout"] = "row" if mode == "row" else "stack"
        row = self._layout() == "row"
        self.split.setOrientation(Qt.Horizontal)
        self.split.insertWidget(1, self.dock)
        self.dock.setOrientation(Qt.Horizontal if row else Qt.Vertical)
        self._restore_dock()
        self.split.setStretchFactor(0, 1)
        self.split.setStretchFactor(1, 0)
        self.player.set_layout_mode(self._layout())
        if self.dock.isVisible():
            self._restore_split()
        config.save_settings(self.settings)

    def _restore_dock(self):
        sizes = self.settings.get("dock_sizes_" + self._layout())
        if sizes and len(sizes) == 2 and sizes[0] > 100:
            self.dock.setSizes(sizes)
        elif self._layout() == "row":
            self.dock.setSizes([700, 380])
        else:
            self.dock.setSizes([620, 380])

    def toggle_detail(self):
        on = not self.detail.isVisible()
        self.detail.setVisible(on)
        self.settings["detail_pane"] = on
        self.player.set_info_on(on)
        self._push_state()

    def set_window_bg(self, color, fg="#eceef1", accent="#e3b341"):
        self.setStyleSheet(f"QMainWindow {{ background: {color}; }} QSplitter::handle {{ background: {color}; }}")
        self.titlebar.set_colors(color, fg, accent)
        self.page.setBackgroundColor(QColor(color))
        self.dock.setStyleSheet(f"QSplitter::handle {{ background: {color}; }}")

    def set_zoom(self, factor, pane=None):
        view = self.detail if pane == "detail" else self.web
        if abs(view.zoomFactor() - factor) > 0.001:
            view.setZoomFactor(factor)

    def _hide_dock(self):
        self.player.hide()
        self.detail.hide()
        self.dock.hide()
        QTimer.singleShot(0, lambda: (self.split.update(), self.web.update(), self.update(), self.repaint()))

    def _show_dock(self):
        self.player.show()
        self.detail.setVisible(self.settings.get("detail_pane", True))
        self.dock.show()

    def close_player(self):
        self._save_resume(self.player)
        self._save_split()
        self.player.stop()
        self._hide_dock()
        self._push_state()

    def open_popout(self, state=None, fullscreen=False):
        from .ui.player import PlayerWindow
        if self.popout:
            self.popout.raise_()
            return
        st = state or self.player.export_state()
        self._save_split()
        self.player.stop()
        self._hide_dock()
        self.popout = PlayerWindow(self.settings, temporary_fullscreen=fullscreen)
        self._wire_player(self.popout.player)
        self.popout.closed.connect(self._popout_closed)
        if fullscreen:
            self.popout.player.set_chrome_visible(False)
            self.popout.showFullScreen()
        else:
            self.popout.show()
        if st:
            self.popout.player.import_state(st)
            self.popout.player.set_marks(self._marks_for(st["media"]))
            self.previews.request(st["media"])
        self._push_state()

    def _popout_closed(self, st):
        self.popout = None
        if st:
            self._show_dock()
            self._restore_split()
            self.player.import_state(st)
            self.player.set_marks(self._marks_for(st["media"]))
            self.previews.request(st["media"])
        self._push_state()

    def _native_frame(self):
        """Give the frameless window the styles of a normal window again (caption, resize frame,
        min/max) so Windows snapping, Snap Layouts, FancyZones, Win+arrows and the taskbar
        treat it like any other app. The visible frame itself is removed in WM_NCCALCSIZE."""
        if os.name != "nt" or getattr(self, "_hwnd", None):
            return
        import ctypes
        from ctypes import wintypes
        self._hwnd = hwnd = int(self.winId())
        u = ctypes.windll.user32
        u.GetWindowLongPtrW.restype = ctypes.c_ssize_t
        u.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
        u.SetWindowLongPtrW.restype = ctypes.c_ssize_t
        u.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
        WS_POPUP, WS_CAPTION, WS_THICKFRAME, WS_SYSMENU = 0x80000000, 0x00C00000, 0x00040000, 0x00080000
        WS_MINIMIZEBOX, WS_MAXIMIZEBOX = 0x00020000, 0x00010000
        style = u.GetWindowLongPtrW(hwnd, -16) & 0xFFFFFFFF
        style = (style & ~WS_POPUP) | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX
        u.SetWindowLongPtrW(hwnd, -16, ctypes.c_ssize_t(ctypes.c_int32(style).value).value)
        try:
            dwm = ctypes.windll.dwmapi

            class MARGINS(ctypes.Structure):
                _fields_ = [("l", ctypes.c_int), ("r", ctypes.c_int), ("t", ctypes.c_int), ("b", ctypes.c_int)]
            dwm.DwmExtendFrameIntoClientArea(wintypes.HWND(hwnd), ctypes.byref(MARGINS(0, 0, 1, 0)))  # shadow
            pref = ctypes.c_int(2)  # DWMWCP_ROUND – Windows 11 rounded corners
            dwm.DwmSetWindowAttribute(wintypes.HWND(hwnd), 33, ctypes.byref(pref), ctypes.sizeof(pref))
        except Exception:
            pass
        # SWP_FRAMECHANGED | NOMOVE | NOSIZE | NOZORDER | NOACTIVATE
        u.SetWindowPos(wintypes.HWND(hwnd), None, 0, 0, 0, 0, 0x0020 | 0x0002 | 0x0001 | 0x0004 | 0x0010)

    def showEvent(self, e):
        super().showEvent(e)
        self._native_frame()

    def nativeEvent(self, event_type, message):
        if os.name != "nt" or event_type != b"windows_generic_MSG" or not getattr(self, "_hwnd", None):
            return super().nativeEvent(event_type, message)
        import ctypes
        from ctypes import wintypes
        msg = wintypes.MSG.from_address(int(message))
        if msg.hWnd != self._hwnd:
            return super().nativeEvent(event_type, message)
        u = ctypes.windll.user32
        if msg.message == 0x0083 and msg.wParam:   # WM_NCCALCSIZE: whole window is client area
            if u.IsZoomed(wintypes.HWND(self._hwnd)):
                # a maximised window with a resize frame sticks out of the monitor by the frame width
                rect = wintypes.RECT.from_address(msg.lParam)
                try:
                    dpi = u.GetDpiForWindow(wintypes.HWND(self._hwnd))
                    fx = u.GetSystemMetricsForDpi(32, dpi) + u.GetSystemMetricsForDpi(92, dpi)
                    fy = u.GetSystemMetricsForDpi(33, dpi) + u.GetSystemMetricsForDpi(92, dpi)
                except Exception:
                    fx = u.GetSystemMetrics(32) + u.GetSystemMetrics(92)
                    fy = u.GetSystemMetrics(33) + u.GetSystemMetrics(92)
                rect.left += fx
                rect.right -= fx
                rect.top += fy
                rect.bottom -= fy
            return True, 0
        if msg.message == 0x0084:   # WM_NCHITTEST: resize edges + native caption (drag, snap, FancyZones)
            pos = QCursor.pos()
            local = self.mapFromGlobal(pos)
            w, hgt = self.width(), self.height()
            if not u.IsZoomed(wintypes.HWND(self._hwnd)):
                m = 6
                left, right = local.x() < m, local.x() >= w - m
                top, bottom = local.y() < m, local.y() >= hgt - m
                code = {(True, False, True, False): 13, (False, True, True, False): 14, (True, False, False, True): 16,
                        (False, True, False, True): 17}.get((left, right, top, bottom))
                if code is None:
                    code = 10 if left else 11 if right else 12 if top else 15 if bottom else None
                if code:
                    return True, code
            tb = self.titlebar
            tl = tb.mapFrom(self, local)
            if tb.rect().contains(tl) and not isinstance(tb.childAt(tl), QToolButton):
                return True, 2      # HTCAPTION
            return True, 1          # HTCLIENT
        return super().nativeEvent(event_type, message)

    def changeEvent(self, e):
        super().changeEvent(e)
        if hasattr(self, "frame"):
            m = 0 if self.isMaximized() else 4
            self.frame.layout().setContentsMargins(m, 0, m, m)

    def closeEvent(self, e):
        self.settings["geometry"] = bytes(self.saveGeometry().toBase64()).decode()
        for pl in self._players():
            self._save_resume(pl)
        self._save_split()
        if self.popout:
            self.popout.closed.disconnect()
            self.popout.close()
        config.save_settings(self.settings)
        self.player.shutdown()
        self.analysis.cancel()     # resumable: the next run continues where this one stopped
        if self.scan_thread and self.scan_thread.isRunning():
            self.scan_thread.wait(5000)
        self.api.sync_shutdown()
        super().closeEvent(e)


def main():
    if os.name == "nt":
        try:   # own taskbar button with our icon, grouped with the Start-menu shortcut (same AppUserModelID)
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
        except (OSError, AttributeError):
            pass
    config.prepare_data_dir()
    config.ensure_dirs()
    os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS", "--disable-gpu-driver-bug-workarounds")
    app = QApplication(sys.argv)
    app.setApplicationName("Kronikář")          # internal id (Qt storage paths) – product name is Kosmas
    app.setApplicationDisplayName("Kosmas")
    app.setWindowIcon(QIcon(str(ICON_PATH)))
    app.setStyle("Fusion")
    import locale
    locale.setlocale(locale.LC_NUMERIC, "C")  # mpv requires C numeric locale
    w = MainWindow()
    w.show()
    sys.exit(app.exec())
