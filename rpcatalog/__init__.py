"""Cosmas (formerly Kronikář) – catalogue of game recordings for RP."""
__version__ = "1.2.0"


def _optional_libs():
    """Packages downloaded on demand (CUDA libraries etc.) live in the data folder, so they survive app
    updates and the install folder can stay read-only. Applies to the app and the analysis worker alike."""
    import os
    import sys
    from . import config
    d = config.PYLIBS_DIR
    if not d.is_dir():
        return []
    if str(d) not in sys.path:
        sys.path.append(str(d))
    handles = []
    for bin_dir in d.glob("nvidia/*/bin"):       # Windows does not search package folders for DLLs by itself
        try:
            handles.append(os.add_dll_directory(str(bin_dir)))
        except (OSError, AttributeError):
            pass
        os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")
    return handles


_dll_dirs = _optional_libs()
