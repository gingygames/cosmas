"""What this PC can run: graphics cards (with real VRAM, not the 4 GB the WMI value is capped at),
memory and processor. Used to recommend local AI models and to pick how speech is transcribed."""
import os
import subprocess

from .i18n import tr

NO_WINDOW = 0x08000000 if os.name == "nt" else 0
GPU_CLASS = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"
VENDORS = {"10de": "nvidia", "1002": "amd", "8086": "intel", "5143": "qualcomm"}
_cache = None


def _gpus_registry():
    import winreg
    out = []
    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, GPU_CLASS) as k:
        i = 0
        while True:
            try:
                sub = winreg.EnumKey(k, i)
            except OSError:
                break
            i += 1
            try:
                with winreg.OpenKey(k, sub) as s:
                    def q(n, d=None):
                        try:
                            return winreg.QueryValueEx(s, n)[0]
                        except OSError:
                            return d
                    name = q("DriverDesc")
                    if not name or "basic display" in name.lower() or "remote" in name.lower():
                        continue
                    mem = q("HardwareInformation.qwMemorySize") or q("HardwareInformation.MemorySize") or 0
                    if isinstance(mem, bytes):
                        mem = int.from_bytes(mem[:8], "little")
                    dev = (q("MatchingDeviceId") or "").lower()
                    vendor = next((v for code, v in VENDORS.items() if f"ven_{code}" in dev), "")
                    out.append({"name": name.strip(), "vram": int(mem), "vendor": vendor})
            except OSError:
                continue
    return out


def _nvidia_smi():
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,driver_version",
                            "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=5,
                           creationflags=NO_WINDOW)
        out = []
        for line in r.stdout.splitlines():
            name, mem, drv = [x.strip() for x in line.split(",")]
            out.append({"name": name, "vram": int(float(mem)) * 2**20, "vendor": "nvidia", "driver": drv})
        return out
    except (OSError, ValueError, subprocess.SubprocessError):
        return []


def _integrated(g):
    n = g["name"].lower()
    if g["vendor"] == "intel":     # dedicated: Arc A380 / A770 / B580…; "Arc(TM) Graphics" is the laptop iGPU
        import re
        return not re.search(r"arc(\(tm\))?\s+(pro\s+)?[ab]\d", n)
    if g["vendor"] == "amd":
        return n.startswith("amd radeon(tm)") or n in ("amd radeon graphics", "amd radeon(tm) graphics") or "vega" in n
    return g["vendor"] == "qualcomm"


def detect(refresh=False):
    """{"gpus": [...], "gpu": best dedicated card or None, "ram": bytes, "cpu": name, "cores": n, "cuda": bool}"""
    global _cache
    if _cache and not refresh:
        return _cache
    gpus = []
    try:
        gpus = _gpus_registry()
    except OSError:
        pass
    smi = _nvidia_smi()
    for s in smi:          # nvidia-smi has the exact VRAM and driver
        same = next((g for g in gpus if g["vendor"] == "nvidia" and g["name"] == s["name"]), None)
        if same:
            same.update(s)
        else:
            gpus.append(s)
    for g in gpus:
        g["integrated"] = _integrated(g)
    dedicated = sorted([g for g in gpus if not g["integrated"]], key=lambda g: -g["vram"])
    ram, cores, cpu = 0, os.cpu_count() or 4, ""
    try:
        import psutil
        ram = psutil.virtual_memory().total
        cores = psutil.cpu_count(False) or cores
    except ImportError:
        pass
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as k:
            cpu = winreg.QueryValueEx(k, "ProcessorNameString")[0].strip()
    except OSError:
        pass
    best = dedicated[0] if dedicated else None
    _cache = {"gpus": gpus, "gpu": best, "ram": ram, "cpu": cpu, "cores": cores,
              "cuda": bool(best and best["vendor"] == "nvidia" and smi)}
    return _cache


def gb(n):
    return n / 2**30


# Ollama models (one model for picture and text where possible: no reloading between the two) by usable memory.
# (min GB, vision, text, download GB, note - English, translated by recommend()) - tags checked on ollama.com 2026-11-06
GPU_TIERS = [
    (30, "qwen3.8:27b-q8_0", "qwen3.8:27b-q8_0", 30, "Highest quality that still fits in the card's memory."),
    (20, "qwen3.8:27b", "qwen3.8:27b", 18, "Very good Czech and picture reading."),
    (14, "gemma4:12b-it-q8_0", "gemma4:12b-it-q8_0", 13, "Good Czech, fast."),
    (10, "gemma4:12b-it-qat", "gemma4:12b-it-qat", 7.2, "Good Czech, fast."),
    (7, "qwen3.5:9b", "qwen3.5:9b", 6.6, "Decent results; for longer chronicles a paid service is better."),
    (5, "qwen3.5:4b", "qwen3.5:4b", 3.3, "Small model – picture descriptions are passable, the chronicle will be brief."),
    (3, "qwen3.5:2b", "qwen3.5:4b", 2.7, "Only basic picture descriptions; for the chronicle we recommend a paid service."),
]
CPU_TIERS = [
    (32, "qwen3.5:4b", "qwen3.5:9b", 3.3, "Works without a graphics card, but slowly (an hour of video ≈ several hours)."),
    (16, "qwen3.5:2b", "qwen3.5:4b", 2.7, "Without a graphics card very slow and weak – we recommend a paid service."),
]


def recommend(hw=None):
    """What to run locally on this PC, and whether a paid service is the better choice."""
    hw = hw or detect()
    g = hw["gpu"]
    ram = gb(hw["ram"])
    vram = gb(g["vram"]) if g else 0
    # AMD and Intel run Ollama through Vulkan/ROCm; leave a bit more headroom there
    usable = vram - (0.5 if g and g["vendor"] == "nvidia" else 1.5) if g and vram >= 3 else 0
    out = {"gpu": g["name"] if g else "", "vram": round(vram, 1), "ram": round(ram), "cpu": hw["cpu"], "vendor": g["vendor"] if g else ""}
    tier = next((t for t in GPU_TIERS if usable >= t[0]), None) if usable else None
    if tier:
        out.update(where="gpu", vision=tier[1], text=tier[2], download=tier[3], note=tr(tier[4]),
                   level="great" if tier[0] >= 14 else "ok" if tier[0] >= 7 else "weak")
    else:
        ct = next((t for t in CPU_TIERS if ram >= t[0] - 1), None)
        if ct:
            out.update(where="cpu", vision=ct[1], text=ct[2], download=ct[3], note=tr(ct[4]), level="slow")
        else:
            out.update(where="none", vision="", text="", download=0, level="none",
                       note=tr("Local AI won't run reasonably on this PC – use a paid service."))
    # speech: faster-whisper on NVIDIA (CUDA), otherwise the processor
    if g and g["vendor"] == "nvidia" and vram >= 5.5:
        out["whisper"] = {"model": "large-v3", "device": "cuda", "compute": "float16", "batch": 16 if vram >= 10 else 8,
                          "note": tr("On the graphics card: an hour of recording in a few minutes.")}
    elif g and g["vendor"] == "nvidia" and vram >= 2:
        out["whisper"] = {"model": "large-v3-turbo", "device": "cuda", "compute": "int8_float16", "batch": 4,
                          "note": tr("On the graphics card, a smaller fast variant of the model.")}
    elif hw["cores"] >= 8 and ram >= 15:
        out["whisper"] = {"model": "medium", "device": "cpu", "compute": "int8", "batch": 4,
                          "note": tr("On the processor: an hour of recording in roughly 20–40 minutes. A paid transcription is more accurate and faster (Groq ≈ CZK 2.5/h).")}
    else:
        out["whisper"] = {"model": "small", "device": "cpu", "compute": "int8", "batch": 2,
                          "note": tr("On the processor slow and less accurate – we recommend a paid transcription (Groq ≈ CZK 2.5/h).")}
    out["speech_local_ok"] = out["whisper"]["device"] == "cuda" or (hw["cores"] >= 8 and ram >= 15)
    out["llm_local_ok"] = out["level"] in ("great", "ok")
    return out
