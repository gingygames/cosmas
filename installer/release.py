"""Prepare a GitHub release of the built installer (prints the command; runs it only with --run).

    python installer/release.py                 # version from rpcatalog/__init__.py, prints the gh command
    python installer/release.py --draft         # as a draft release
    python installer/release.py --notes NOTES.md --prerelease
    python installer/release.py --run           # really create it (needs gh, signed in to gingygames/kosmas)

Uploads build/Cosmas-Setup-<ver>.exe and its .sha256 (made by installer/build.py). Release notes: --notes FILE, or
build/release-notes-<ver>.md is written from the template below for you to edit first. The web's update endpoint
(gingygames.com/kosmas/api/app/latest) and the app's GitHub fallback both read the published release; the app checks
the installer against the .sha256 (or GitHub's asset digest) before running it.
"""
import argparse
import hashlib
import shlex
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from build import BUILD, installer_path, version  # noqa: E402

REPO = "gingygames/kosmas"
TEMPLATE = """## Cosmas {ver}

### New
-

### Fixed
-

**Download:** `Cosmas-Setup-{ver}.exe` below (Windows 10 1809+ / 11, 64-bit). Installed copies update themselves
(Settings → General → Updates). SHA-256: `{sha}`
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", help="default: rpcatalog/__init__.py")
    ap.add_argument("--notes", help="Markdown file with the release notes")
    ap.add_argument("--draft", action="store_true")
    ap.add_argument("--prerelease", action="store_true")
    ap.add_argument("--run", action="store_true", help="run gh instead of only printing the command")
    a = ap.parse_args()
    ver = a.version or version()
    exe = installer_path(ver)
    sha_file = Path(str(exe) + ".sha256")
    if not exe.exists():
        raise SystemExit(f"{exe} is missing – build it first: python installer/build.py")
    h = hashlib.sha256()
    with open(exe, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    digest = h.hexdigest()
    if not sha_file.exists() or sha_file.read_text("ascii").split()[0].lower() != digest:
        sha_file.write_text(f"{digest}  {exe.name}\n", "ascii")
        print(f"(re)wrote {sha_file.name}")
    notes = Path(a.notes) if a.notes else BUILD / f"release-notes-{ver}.md"
    if not notes.exists():
        notes.write_text(TEMPLATE.format(ver=ver, sha=digest), "utf-8")
        print(f"wrote a notes template: {notes} – edit it before publishing")
    cmd = ["gh", "release", "create", f"v{ver}", str(exe), str(sha_file), "--repo", REPO,
           "--title", f"Cosmas {ver}", "--notes-file", str(notes)]
    if a.draft:
        cmd.append("--draft")
    if a.prerelease or "-" in ver:
        cmd.append("--prerelease")
    print(f"installer: {exe.name}  {exe.stat().st_size / 2**20:.1f} MB  sha256 {digest}")
    print(" ".join(shlex.quote(c) for c in cmd))
    if a.run:
        subprocess.check_call(cmd)


if __name__ == "__main__":
    main()
