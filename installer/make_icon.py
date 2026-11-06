"""Render rpcatalog/web/icon.svg into rpcatalog/assets/kronikar.ico (all Windows sizes) and kronikar.png (512 px).

Run:  .venv\\Scripts\\python.exe installer\\make_icon.py
"""
import struct
import sys
from pathlib import Path

from PySide6.QtCore import QBuffer, QByteArray, QIODevice, Qt
from PySide6.QtGui import QGuiApplication, QImage, QPainter
from PySide6.QtSvg import QSvgRenderer

ROOT = Path(__file__).resolve().parent.parent
SVG = ROOT / "rpcatalog" / "web" / "icon.svg"
OUT = ROOT / "rpcatalog" / "assets"
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def render(renderer, size):
    img = QImage(size, size, QImage.Format_ARGB32)
    img.fill(Qt.transparent)
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing)
    p.setRenderHint(QPainter.SmoothPixmapTransform)
    renderer.render(p)
    p.end()
    return img


def png_bytes(img):
    ba = QByteArray()
    buf = QBuffer(ba)
    buf.open(QIODevice.WriteOnly)
    img.save(buf, "PNG")
    return bytes(ba)


def main():
    QGuiApplication(sys.argv[:1])
    r = QSvgRenderer(str(SVG))
    if not r.isValid():
        raise SystemExit("icon.svg is not valid")
    OUT.mkdir(parents=True, exist_ok=True)
    render(r, 512).save(str(OUT / "kronikar.png"))
    images = [png_bytes(render(r, s)) for s in SIZES]
    # ICO = ICONDIR + ICONDIRENTRY per image + PNG payloads (PNG entries work on Vista and later)
    head = struct.pack("<HHH", 0, 1, len(images))
    offset = len(head) + 16 * len(images)
    entries, data = b"", b""
    for s, png in zip(SIZES, images):
        dim = 0 if s >= 256 else s
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(png), offset + len(data))
        data += png
    (OUT / "kronikar.ico").write_bytes(head + entries + data)
    print("written", OUT / "kronikar.ico", OUT / "kronikar.png")


if __name__ == "__main__":
    main()
