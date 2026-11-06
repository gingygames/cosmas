"""API keys of paid AI services in the Windows Credential Manager (encrypted for the signed-in user),
never in settings.json. The analysis worker reads them the same way."""
import ctypes
import ctypes.wintypes as wt

from .i18n import tr

PREFIX = "Kronikar/"
CRED_TYPE_GENERIC = 1
CRED_PERSIST_LOCAL_MACHINE = 2


class CREDENTIAL(ctypes.Structure):
    _fields_ = [("Flags", wt.DWORD), ("Type", wt.DWORD), ("TargetName", wt.LPWSTR), ("Comment", wt.LPWSTR),
                ("LastWritten", wt.FILETIME), ("CredentialBlobSize", wt.DWORD),
                ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)), ("Persist", wt.DWORD),
                ("AttributeCount", wt.DWORD), ("Attributes", ctypes.c_void_p), ("TargetAlias", wt.LPWSTR),
                ("UserName", wt.LPWSTR)]


_adv = ctypes.WinDLL("advapi32", use_last_error=True)
_adv.CredReadW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.POINTER(ctypes.POINTER(CREDENTIAL))]
_adv.CredWriteW.argtypes = [ctypes.POINTER(CREDENTIAL), wt.DWORD]
_adv.CredDeleteW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD]
_adv.CredFree.argtypes = [ctypes.c_void_p]


def get(provider):
    p = ctypes.POINTER(CREDENTIAL)()
    if not _adv.CredReadW(PREFIX + provider, CRED_TYPE_GENERIC, 0, ctypes.byref(p)):
        return ""
    try:
        c = p.contents
        return ctypes.string_at(c.CredentialBlob, c.CredentialBlobSize).decode("utf-8")
    finally:
        _adv.CredFree(p)


def set(provider, secret):     # noqa: A001 - mirrors get()
    if not secret:
        _adv.CredDeleteW(PREFIX + provider, CRED_TYPE_GENERIC, 0)
        return
    blob = secret.encode("utf-8")
    buf = (ctypes.c_ubyte * len(blob)).from_buffer_copy(blob)
    c = CREDENTIAL(Type=CRED_TYPE_GENERIC, TargetName=PREFIX + provider, CredentialBlobSize=len(blob),
                   CredentialBlob=ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)), Persist=CRED_PERSIST_LOCAL_MACHINE,
                   UserName="Kronikar", Comment=tr("Kosmas – AI service key"))
    if not _adv.CredWriteW(ctypes.byref(c), 0):
        raise OSError(ctypes.get_last_error(), tr("Could not save the key to the Credential Manager"))


def has(provider):
    return bool(get(provider))
