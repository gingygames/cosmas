"""Build the Windows installer: build/Cosmas-Setup-<version>.exe (+ .sha256)

One command (from the repository root):

    .venv\\Scripts\\python.exe installer\\build.py

What it does:
  1. downloads the official embeddable Python (same version as .venv) and an FFmpeg build into build/cache
  2. build/dist/python   – that Python + the packages from installer/requirements-dist.txt (pip --target)
     build/dist/app      – rpcatalog, extras, vendor (libmpv, ffmpeg, ffprobe)
     build/dist/Kronikar.exe – small launcher (C#, compiled with the .NET Framework that every Windows has)
  3. compiles installer/kronikar.iss with Inno Setup 6 (installed for the current user via winget if missing)

Options:  --skip-pip  reuse build/dist/python as it is (faster when only the app code changed)
          --no-setup  stop after build/dist (no Inno Setup)
          --test      separate test app (own AppId and folder, no shortcuts): build/Cosmas-Setup-<ver>-test.exe,
                      for trying the updater without touching a real install
          --version X build as version X (the bundled app reports it too), e.g. an older test build
The installer is followed by <installer>.sha256 ("<hex>  <file name>", the sha256sum format) – upload both to the
GitHub release (installer/release.py prints the command).
The result needs nothing on the target PC: no Python, no admin rights, Windows 10 1809+ / 11, x64.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERE = ROOT / "installer"
BUILD = ROOT / "build"
CACHE = BUILD / "cache"
DIST = BUILD / "dist"
PY_VER = "3.12.10"
PY_URL = f"https://www.python.org/ftp/python/{PY_VER}/python-{PY_VER}-embed-amd64.zip"
FFMPEG_URL = ("https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/"
              "ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip")
CSC = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Microsoft.NET" / "Framework64" / "v4.0.30319" / "csc.exe"

# Parts of PySide6 the app never loads (it uses QtCore/Gui/Widgets/WebEngine*/WebChannel only).
# Qt6Quick/Qml/Pdf/Positioning/Network/OpenGL stay: QtWebEngine links against them.
QT_DROP_MODULES = ["3DAnimation", "3DCore", "3DExtras", "3DInput", "3DLogic", "3DRender", "Bluetooth", "Charts",
                   "ChartsQml", "DataVisualization", "DataVisualizationQml", "Designer", "DesignerComponents",
                   "Graphs", "GraphsWidgets", "Help", "HttpServer", "Location", "Multimedia", "MultimediaQuick",
                   "MultimediaWidgets", "Nfc", "Quick3D", "Quick3DAssetImport", "Quick3DAssetUtils",
                   "Quick3DEffects", "Quick3DHelpers", "Quick3DHelpersImpl", "Quick3DIblBaker", "Quick3DParticles",
                   "Quick3DPhysics", "Quick3DPhysicsHelpers", "Quick3DRuntimeRender", "Quick3DUtils",
                   "Quick3DXr", "RemoteObjects", "RemoteObjectsQml", "Scxml", "ScxmlQml", "Sensors", "SensorsQuick",
                   "SerialBus", "SerialPort", "SpatialAudio", "StateMachine", "StateMachineQml", "Test",
                   "TextToSpeech", "UiTools", "VirtualKeyboard", "VirtualKeyboardQml", "WebSockets", "WebView",
                   "WebViewQuick", "Lottie", "LottieVectorImageGenerator"]
# QML controls and Qt's own FFmpeg (for QtMultimedia) – WebEngine uses neither
QT_DROP_GLOBS = ["Qt6QuickControls2*.dll", "QtQuickControls2.pyd", "Qt6QuickDialogs2*.dll", "Qt6QuickTemplates2.dll",
                 "Qt6Labs*.dll", "Qt6QmlCompiler.dll", "Qt6QuickTest.dll", "QtQuickTest.pyd", "Qt6QuickParticles.dll",
                 "Qt6QuickTimeline*.dll", "Qt6QuickEffects.dll", "Qt6QuickVectorImage*.dll", "Qt6QuickLayouts.dll",
                 "avcodec-*.dll", "avformat-*.dll", "avutil-*.dll", "swresample-*.dll", "swscale-*.dll"]
PYSIDE_DROP_DIRS = ["examples", "include", "typesystems", "glue", "doc", "scripts", "qml", "metatypes", "lib/cmake"]
PYSIDE_KEEP_EXE = {"qtwebengineprocess.exe"}


def log(*a):
    print("[build]", *a, flush=True)


def download(url, dst):
    if dst.exists():
        return dst
    dst.parent.mkdir(parents=True, exist_ok=True)
    log("downloading", url)
    tmp = dst.with_suffix(dst.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "kronikar-build"})
    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    tmp.replace(dst)
    return dst


def version():
    m = re.search(r'__version__\s*=\s*"([^"]+)"', (ROOT / "rpcatalog" / "__init__.py").read_text("utf-8"))
    return m.group(1) if m else "1.0.0"


def build_python(skip_pip):
    pydir = DIST / "python"
    site = pydir / "Lib" / "site-packages"
    if skip_pip and (pydir / "python.exe").exists():
        log("reusing", pydir)
        return pydir
    shutil.rmtree(pydir, ignore_errors=True)
    with zipfile.ZipFile(download(PY_URL, CACHE / Path(PY_URL).name)) as z:
        z.extractall(pydir)
    # site-packages + the app folder on the path and nothing else: no PYTHONPATH, no user site-packages
    # (no "import site" line – the bundled packages need no .pth processing)
    (pydir / "python312._pth").write_text("python312.zip\n.\nLib\\site-packages\n..\\app\n", "ascii")
    site.mkdir(parents=True, exist_ok=True)
    log("installing packages into", site)
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-warn-script-location",
                           "--only-binary=:all:", "--target", str(site), "-r", str(HERE / "requirements-dist.txt")])
    trim_pyside(site)
    # model conversion tools, unused at runtime; their very long file names break installs into deep folders
    shutil.rmtree(site / "onnxruntime" / "tools", ignore_errors=True)
    for junk in site.glob("*/__pycache__"):
        shutil.rmtree(junk, ignore_errors=True)
    shutil.rmtree(site / "bin", ignore_errors=True)        # console scripts with absolute paths of this PC
    return pydir


def trim_pyside(site):
    before = dir_size(site)
    ps = site / "PySide6"
    for d in PYSIDE_DROP_DIRS:
        shutil.rmtree(ps / d, ignore_errors=True)
    for exe in ps.glob("*.exe"):
        if exe.name.lower() not in PYSIDE_KEEP_EXE:
            exe.unlink()
    for pat in ("*.lib", "*.pyi"):
        for f in ps.rglob(pat):
            f.unlink()
    for m in QT_DROP_MODULES:
        for f in list(ps.glob(f"Qt6{m}.dll")) + list(ps.glob(f"Qt{m}.pyd")):
            f.unlink()
    for g in QT_DROP_GLOBS:
        for f in ps.glob(g):
            f.unlink()
    plugins = ps / "plugins"
    for d in ("designer", "qmltooling", "sceneparsers", "geometryloaders", "renderers", "sensors", "position",
              "texttospeech", "multimedia", "sqldrivers", "canbus", "assetimporters", "webview", "qmlls",
              "renderplugins", "help"):
        shutil.rmtree(plugins / d, ignore_errors=True)
    tr = ps / "translations"
    if tr.is_dir():
        for f in tr.glob("*.qm"):
            if not re.match(r"qt(base|webengine)?_(cs|en)\.qm$", f.name):
                f.unlink()
    log(f"PySide6 trimmed: {before / 2**20:.0f} MB -> {dir_size(site) / 2**20:.0f} MB (site-packages)")


def dir_size(p):
    return sum(f.stat().st_size for f in Path(p).rglob("*") if f.is_file())


def build_app(ver=None):
    app = DIST / "app"
    shutil.rmtree(app, ignore_errors=True)
    shutil.copytree(ROOT / "rpcatalog", app / "rpcatalog", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    if ver and ver != version():           # --version: the bundled app reports the version it was built as
        init = app / "rpcatalog" / "__init__.py"
        init.write_text(re.sub(r'__version__\s*=\s*"[^"]+"', f'__version__ = "{ver}"', init.read_text("utf-8"), count=1), "utf-8")
    if (ROOT / "extras").is_dir():
        shutil.copytree(ROOT / "extras", app / "extras")
    vendor = app / "vendor"
    vendor.mkdir(parents=True)
    shutil.copy2(ROOT / "vendor" / "libmpv-2.dll", vendor)
    zpath = download(FFMPEG_URL, CACHE / Path(FFMPEG_URL).name)
    with zipfile.ZipFile(zpath) as z:
        for n in z.namelist():
            name = Path(n).name
            if "/bin/" in n and name and name.lower() != "ffplay.exe":
                (vendor / name).write_bytes(z.read(n))
            elif name == "LICENSE.txt":
                (vendor / "FFmpeg-LICENSE.txt").write_bytes(z.read(n))
    (vendor / "README.txt").write_text(
        "ffmpeg/ffprobe: FFmpeg (https://ffmpeg.org), GPL build from https://github.com/BtbN/FFmpeg-Builds\n"
        "libmpv-2.dll: mpv (https://mpv.io)\n", "utf-8")
    return app


def build_launcher(ver):
    if not CSC.exists():
        raise SystemExit(f"C# compiler not found: {CSC}")
    src = BUILD / "launcher.cs"
    src.write_text((HERE / "launcher.cs").read_text("utf-8-sig").replace("@VERSION@", num_version(ver)), "utf-8-sig")
    out = DIST / "Kronikar.exe"
    subprocess.check_call([str(CSC), "/nologo", "/target:winexe", "/optimize+", "/platform:anycpu",
                           f"/win32icon:{ROOT / 'rpcatalog' / 'assets' / 'kronikar.ico'}",
                           "/r:System.Windows.Forms.dll", f"/out:{out}", str(src)])
    return out


def precompile(pydir):
    log("precompiling .pyc")
    # anthropic/types/beta/... is deep enough that its .pyc paths approach Windows' 260-char limit: skip it
    subprocess.call([str(pydir / "python.exe"), "-m", "compileall", "-q", "-j", "0", "-x", r"anthropic[\\/]types",
                     str(DIST / "app" / "rpcatalog"), str(pydir / "Lib" / "site-packages")], stdout=subprocess.DEVNULL)
    for d in (pydir / "Lib" / "site-packages" / "anthropic" / "types").rglob("__pycache__"):
        shutil.rmtree(d, ignore_errors=True)
    longest = max(len(str(f.relative_to(DIST))) for f in DIST.rglob("*"))
    log(f"longest path inside the install folder: {longest} chars")


def find_iscc():
    for base in (os.environ.get("LOCALAPPDATA", ""), os.environ.get("ProgramFiles(x86)", ""), os.environ.get("ProgramFiles", "")):
        p = Path(base) / ("Programs" if base == os.environ.get("LOCALAPPDATA") else "") / "Inno Setup 6" / "ISCC.exe"
        if p.exists():
            return p
    p = BUILD / "tools" / "inno" / "ISCC.exe"
    return p if p.exists() else None


def ensure_iscc():
    iscc = find_iscc()
    if iscc:
        return iscc
    log("installing Inno Setup 6 (winget, current user)")
    subprocess.call(["winget", "install", "--id", "JRSoftware.InnoSetup", "-e", "--scope", "user",
                     "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"])
    iscc = find_iscc()
    if not iscc:
        raise SystemExit("Inno Setup 6 not found – install it from https://jrsoftware.org/isdl.php")
    return iscc


def num_version(ver):
    """1.2.0-beta.1 -> 1.2.0 (Windows file versions are numbers only)"""
    m = re.match(r"\d+(\.\d+){0,2}", ver)
    return m.group(0) if m else "0.0.0"


def sha256_of(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_sha256(path):
    """<installer>.sha256 next to the installer, in the format of sha256sum: "<hex>  <file name>"."""
    digest = sha256_of(path)
    out = Path(str(path) + ".sha256")
    out.write_text(f"{digest}  {Path(path).name}
", "ascii")
    return digest, out


def installer_path(ver, test=False):
    return BUILD / f"Cosmas-Setup-{ver}{'-test' if test else ''}.exe"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-pip", action="store_true")
    ap.add_argument("--no-setup", action="store_true")
    ap.add_argument("--test", action="store_true", help="separate test app (own AppId/folder, no shortcuts)")
    ap.add_argument("--version", help="build as this version (default: rpcatalog/__init__.py)")
    args = ap.parse_args()
    ver = args.version or version()
    DIST.mkdir(parents=True, exist_ok=True)
    pydir = build_python(args.skip_pip)
    build_app(ver)
    build_launcher(ver)
    precompile(pydir)
    log(f"dist ready: {dir_size(DIST) / 2**20:.0f} MB")
    if args.no_setup:
        return
    iscc = ensure_iscc()
    defines = [f"/DAppVer={ver}", f"/DAppNumVer={num_version(ver)}"] + (["/DTestBuild=1"] if args.test else [])
    subprocess.check_call([str(iscc), "/Q", *defines, str(HERE / "kronikar.iss")])
    out = installer_path(ver, args.test)
    digest, sha_file = write_sha256(out)
    log(f"installer: {out} ({out.stat().st_size / 2**20:.0f} MB)")
    log(f"sha256:    {digest}  ({sha_file.name})")


if __name__ == "__main__":
    main()
