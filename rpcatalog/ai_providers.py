"""Where the AI runs: locally (Ollama for picture and text, faster-whisper for speech) or at a paid service
(the user signs in or pastes an API key). One call shape for the analysis worker, a price list for the
estimates in the settings, and a usage log so the user sees what the paid services really cost."""
import base64
import json
import mimetypes
import os
import time
import urllib.error
import urllib.request
import uuid

from . import config, keystore
from .i18n import tr

OLLAMA = "http://localhost:11434"
USAGE_LOG = config.DATA_DIR / "analysis" / "usage.jsonl"
USD_CZK = 23.0     # rough, only for the estimates shown in the app

# Prices in USD per 1M tokens (in / out), images in tokens per ~768x432 frame, speech in USD per hour of audio.
# Labels and notes are English; ai_setup.info() translates them with tr().
# Checked 2026-11-06; the settings page says they are estimates and links to each price list.
CATALOG = {
    "ollama": {"label": "On this PC (Ollama)", "kind": "ollama", "local": True},
    "local": {"label": "On this PC (Whisper)", "kind": "whisper", "local": True},
    "anthropic": {
        "label": "Anthropic Claude", "kind": "anthropic", "login": "key",
        "key_url": "https://platform.claude.com/settings/keys", "price_url": "https://platform.claude.com/docs/en/about-claude/pricing",
        "note": "Prepaid credit. Understands Czech very well.",
        "models": {
            "vision": [
                {"id": "claude-opus-5-5", "label": "Claude Opus 5.5 – most capable", "in": 4.0, "out": 20.0, "img": 450, "think": 300, "effort": "low", "fallbacks": True, "default": True},
                {"id": "claude-sonnet-5-5", "label": "Claude Sonnet 5.5 – balanced", "in": 2.0, "out": 10.0, "img": 450, "think": 300, "effort": "low", "fallbacks": True},
                {"id": "claude-haiku-5-5", "label": "Claude Haiku 5.5 – cheapest", "in": 0.10, "out": 0.50, "img": 450, "think": 300, "effort": "low"}],
            "text": [
                {"id": "claude-opus-5-5", "label": "Claude Opus 5.5 – most capable", "in": 4.0, "out": 20.0, "think": 3000, "effort": "medium", "fallbacks": True, "default": True},
                {"id": "claude-sonnet-5-5", "label": "Claude Sonnet 5.5 – balanced", "in": 2.0, "out": 10.0, "think": 3000, "effort": "medium", "fallbacks": True},
                {"id": "claude-haiku-5-5", "label": "Claude Haiku 5.5 – cheapest", "in": 0.10, "out": 0.50, "think": 2000, "effort": "medium"}]}},
    "openai": {
        "label": "OpenAI", "kind": "openai", "base": "https://api.openai.com/v1", "login": "key", "json": "schema", "closed": True,
        "max_param": "max_completion_tokens", "no_temperature": True, "extra_body": {"reasoning_effort": "low"},
        "key_url": "https://platform.openai.com/api-keys", "price_url": "https://developers.openai.com/api/docs/pricing",
        "note": "Prepaid credit. The only one that also offers speech transcription with timestamps (whisper-1).",
        "models": {
            "vision": [
                {"id": "gpt-5.4-mini", "label": "GPT-5.4 mini – better", "in": 0.75, "out": 4.50, "img": 400, "think": 200, "default": True},
                {"id": "gpt-5.4-nano", "label": "GPT-5.4 nano – cheapest", "in": 0.20, "out": 1.25, "img": 400, "think": 200}],
            "text": [
                {"id": "gpt-5.4-mini", "label": "GPT-5.4 mini – better", "in": 0.75, "out": 4.50, "think": 2000, "default": True},
                {"id": "gpt-5.4-nano", "label": "GPT-5.4 nano – cheapest", "in": 0.20, "out": 1.25, "think": 2000}],
            "speech": [
                {"id": "whisper-1", "label": "Whisper (with sentence timestamps)", "hour": 0.36, "default": True}]}},
    "gemini": {
        "label": "Google Gemini", "kind": "openai", "base": "https://generativelanguage.googleapis.com/v1beta/openai", "login": "key",
        "json": "schema", "key_url": "https://aistudio.google.com/apikey", "price_url": "https://aistudio.google.com/docs/pricing",
        "note": "Key from Google AI Studio. It also has a free tier with a daily limit – but Google may use data from it to improve its services.",
        "models": {
            "vision": [
                {"id": "gemini-3.5-flash-lite", "label": "Gemini 3.5 Flash-Lite", "in": 0.30, "out": 2.50, "img": 1120, "default": True},
                {"id": "gemini-3.8-flash", "label": "Gemini 3.8 Flash – better", "in": 0.75, "out": 3.75, "img": 1120}],
            "text": [
                {"id": "gemini-3.5-flash-lite", "label": "Gemini 3.5 Flash-Lite", "in": 0.30, "out": 2.50, "think": 1500, "default": True},
                {"id": "gemini-3.8-flash", "label": "Gemini 3.8 Flash – better", "in": 0.75, "out": 3.75, "think": 2000}]}},
    "openrouter": {
        "label": "OpenRouter", "kind": "openai", "base": "https://openrouter.ai/api/v1", "login": "oauth", "json": "schema",
        "headers": {"HTTP-Referer": "https://github.com/gingygames/kronikar", "X-OpenRouter-Title": "Kosmas"},
        "key_url": "https://openrouter.ai/keys", "price_url": "https://openrouter.ai/models",
        "note": "One account for models from many companies. Just sign in in the browser and the key is set up automatically. Prices are the same as at the original companies.",
        "models": {
            "vision": [
                {"id": "google/gemini-3.5-flash-lite", "label": "Gemini 3.5 Flash-Lite", "in": 0.30, "out": 2.50, "img": 1120, "default": True},
                {"id": "openai/gpt-5.4-mini", "label": "GPT-5.4 mini", "in": 0.75, "out": 4.50, "img": 400, "think": 200, "temperature": False},
                {"id": "openai/gpt-5.4-nano", "label": "GPT-5.4 nano", "in": 0.20, "out": 1.25, "img": 400, "think": 200, "temperature": False}],
            "text": [
                {"id": "google/gemini-3.5-flash-lite", "label": "Gemini 3.5 Flash-Lite", "in": 0.30, "out": 2.50, "think": 1500, "default": True},
                {"id": "openai/gpt-5.4-mini", "label": "GPT-5.4 mini", "in": 0.75, "out": 4.50, "think": 2000, "temperature": False}]}},
    "groq": {
        "label": "Groq", "kind": "openai", "base": "https://api.groq.com/openai/v1", "login": "key", "json": "schema",
        "key_url": "https://console.groq.com/keys", "price_url": "https://groq.com/pricing",
        "note": "Very fast and the cheapest speech transcription (Whisper large-v3). It also has a free tier with limits.",
        "models": {
            "vision": [
                {"id": "qwen/qwen3.8-27b", "label": "Qwen 3.8 27B", "in": 0.80, "out": 4.00, "img": 2048, "extra": {"reasoning_format": "hidden"}, "default": True}],
            "text": [
                {"id": "openai/gpt-oss-120b", "label": "GPT-OSS 120B", "in": 0.15, "out": 0.60, "think": 1500, "default": True},
                {"id": "openai/gpt-oss-20b", "label": "GPT-OSS 20B – cheapest", "in": 0.075, "out": 0.30, "think": 1500}],
            "speech": [
                {"id": "whisper-large-v3", "label": "Whisper large-v3 – most accurate", "hour": 0.111, "default": True},
                {"id": "whisper-large-v3-turbo", "label": "Whisper large-v3 turbo – cheapest", "hour": 0.04}]}},
}
TASKS = ("speech", "vision", "text")


def provider(pid):
    return CATALOG.get(pid) or CATALOG["ollama"]


def model_info(pid, task, mid):
    for m in provider(pid).get("models", {}).get(task, []):
        if m["id"] == mid:
            return m
    return None


def default_model(pid, task):
    ms = provider(pid).get("models", {}).get(task, [])
    rec = next((m for m in ms if m.get("default")), None) or (ms[0] if ms else None)
    return rec["id"] if rec else ""


def has_key(pid):
    p = provider(pid)
    return p.get("local") or keystore.has(pid)


# ------------------------------------------------------------------ HTTP helpers
class AIError(RuntimeError):
    def __init__(self, msg, fatal=False):
        super().__init__(msg)
        self.fatal = fatal       # wrong key, no credit, unknown model: stop instead of trying every frame


def _http(url, body=None, headers=None, timeout=600, raw=None, method=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {"Content-Type": "application/json", "User-Agent": "Kronikar/1.0"} if raw is None else {"User-Agent": "Kronikar/1.0"}
    h.update(headers or {})
    req = urllib.request.Request(url, data, h, method=method)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:2000]
            try:      # {"error": {"message": ...}} or {"error": "..."} -> just the message
                err = json.loads(detail).get("error")
                detail = (err.get("message") if isinstance(err, dict) else err) or detail
            except (ValueError, AttributeError):
                pass
            detail = str(detail)[:300]
            if e.code == 400 and "api key" in detail.lower():
                raise AIError(tr("Invalid API key: {detail}", detail=detail), fatal=True) from None
            if e.code in (429, 500, 502, 503, 504, 529) and attempt < 3:
                wait = float(e.headers.get("retry-after") or 0) or 5 * 2 ** attempt
                time.sleep(min(wait, 60))
                continue
            msg = {401: tr("Invalid API key or signed out"), 402: tr("The service account is out of credit"),
                   403: tr("The key does not have permission for this"), 404: tr("The model does not exist (check the model selection)"),
                   429: tr("The service is refusing more requests (limit or credit)")}.get(e.code) or tr("Service error {code}", code=e.code)
            raise AIError(f"{msg}: {detail}", fatal=e.code in (401, 402, 403, 404)) from None
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < 3:
                time.sleep(3 * 2 ** attempt)
                continue
            raise AIError(tr("Service unavailable: {error}", error=e)) from None


def _key(pid):
    k = keystore.get(pid)
    if not k:
        raise AIError(tr("Not signed in to {provider} – sign in under Transcripts → Settings → AI",
                         provider=tr(provider(pid)["label"])), fatal=True)
    return k


def log_usage(pid, model, task, tin=0, tout=0, audio_s=0, images=0):
    if provider(pid).get("local"):
        return
    USAGE_LOG.parent.mkdir(parents=True, exist_ok=True)
    with USAGE_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"time": time.time(), "provider": pid, "model": model, "task": task, "in": tin,
                            "out": tout, "audio_s": round(audio_s, 1), "images": images}) + "\n")


def cost_of(rec):
    m = model_info(rec["provider"], rec["task"], rec["model"])
    if not m:
        return 0.0
    if rec["task"] == "speech":
        return rec.get("audio_s", 0) / 3600 * m.get("hour", 0)
    return rec.get("in", 0) / 1e6 * m.get("in", 0) + rec.get("out", 0) / 1e6 * m.get("out", 0)


def usage_summary(days=30):
    since = time.time() - days * 86400
    out = {}
    try:
        with USAGE_LOG.open(encoding="utf-8") as f:
            for line in f:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if r["time"] < since:
                    continue
                k = r["provider"]
                o = out.setdefault(k, {"usd": 0.0, "calls": 0})
                o["usd"] += cost_of(r)
                o["calls"] += 1
    except OSError:
        pass
    return out


# ------------------------------------------------------------------ JSON schema helpers
def _closed(schema):
    """Strict structured output wants every object closed (additionalProperties: false)."""
    if isinstance(schema, dict):
        s = {k: _closed(v) for k, v in schema.items()}
        if s.get("type") == "object":
            s.setdefault("additionalProperties", False)
        return s
    if isinstance(schema, list):
        return [_closed(x) for x in schema]
    return schema


def _parse_json(text):
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{"):]
    a, z = text.find("{"), text.rfind("}")
    return json.loads(text[a:z + 1] if a >= 0 and z > a else text)


# ------------------------------------------------------------------ structured answers
def ask_json(pid, model, prompt, schema, image=None, max_tokens=4000, ctx=16384, task="text", temperature=0.3):
    """Answer as a dict matching `schema` (image: JPEG bytes or None). Raises AIError / ValueError."""
    p = provider(pid)
    kind = p["kind"]
    if kind == "ollama":
        body = {"model": model, "prompt": prompt, "stream": False, "format": schema,
                "options": {"temperature": temperature, "num_ctx": ctx, "num_predict": max_tokens}}
        if image is not None:
            body["images"] = [base64.b64encode(image).decode()]
        resp = _http(OLLAMA + "/api/generate", body, timeout=1200)
        return _parse_json(resp.get("response")), resp
    if kind == "anthropic":
        return _ask_anthropic(pid, model, prompt, schema, image, max_tokens, task)
    return _ask_openai(pid, p, model, prompt, schema, image, max_tokens, task, temperature)


def _ask_openai(pid, p, model, prompt, schema, image, max_tokens, task, temperature):
    """OpenAI-compatible chat completions: OpenAI, Gemini, OpenRouter, Mistral, Groq."""
    content = [{"type": "text", "text": prompt}]
    if image is not None:
        content.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(image).decode()}})
    body = {"model": model, "messages": [{"role": "user", "content": content if image is not None else prompt}]}
    body[p.get("max_param", "max_tokens")] = max_tokens
    if p.get("json") == "schema":
        body["response_format"] = {"type": "json_schema", "json_schema": {"name": "odpoved", "schema": _closed(schema) if p.get("closed") else schema, "strict": False}}
    else:
        body["response_format"] = {"type": "json_object"}
        body["messages"][0]["content"] = (content if image is not None else prompt)
        hint = "\n\nOdpověz jen JSON objektem podle tohoto schématu: " + json.dumps(schema, ensure_ascii=False)
        if image is not None:
            content[0]["text"] += hint
        else:
            body["messages"][0]["content"] = prompt + hint
    info = model_info(pid, task, model) or {}
    if not p.get("no_temperature") and info.get("temperature", True):
        body["temperature"] = temperature
    body.update(p.get("extra_body", {}))
    body.update(info.get("extra", {}))
    headers = {"Authorization": "Bearer " + _key(pid), **p.get("headers", {})}
    resp = _http(p["base"] + "/chat/completions", body, headers, timeout=600)
    u = resp.get("usage") or {}
    log_usage(pid, model, task, u.get("prompt_tokens", 0), u.get("completion_tokens", 0), images=int(image is not None))
    choice = (resp.get("choices") or [{}])[0]
    text = (choice.get("message") or {}).get("content") or ""
    if isinstance(text, list):
        text = "".join(x.get("text", "") for x in text if isinstance(x, dict))
    return _parse_json(text), resp


def _ask_anthropic(pid, model, prompt, schema, image, max_tokens, task):
    import anthropic
    client = anthropic.Anthropic(api_key=_key(pid), max_retries=4, timeout=600)
    content = []
    if image is not None:
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                     "data": base64.standard_b64encode(image).decode()}})
    content.append({"type": "text", "text": prompt})
    info = model_info(pid, task, model) or {}
    kw = {"output_config": {"format": {"type": "json_schema", "schema": _closed(schema)},
                            **({"effort": info["effort"]} if info.get("effort") else {})}}
    try:
        if info.get("fallbacks"):
            resp = client.beta.messages.create(model=model, max_tokens=max(max_tokens, 8000),
                                               messages=[{"role": "user", "content": content}],
                                               betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kw)
        else:
            resp = client.messages.create(model=model, max_tokens=max(max_tokens, 8000),
                                          messages=[{"role": "user", "content": content}], **kw)
    except anthropic.AuthenticationError:
        raise AIError(tr("Invalid Anthropic API key"), fatal=True) from None
    except anthropic.PermissionDeniedError as e:
        raise AIError(tr("The Anthropic key does not have permission for this: {message}", message=e.message), fatal=True) from None
    except anthropic.NotFoundError:
        raise AIError(tr("Model {model} does not exist", model=model), fatal=True) from None
    except anthropic.RateLimitError:
        raise AIError(tr("Anthropic is refusing more requests (account limit)")) from None
    except anthropic.APIStatusError as e:
        raise AIError(tr("Anthropic error {code}: {message}", code=e.status_code, message=e.message)) from None
    except anthropic.APIConnectionError:
        raise AIError(tr("Anthropic is unavailable (internet connection?)")) from None
    u = resp.usage
    log_usage(pid, model, task, u.input_tokens + (u.cache_read_input_tokens or 0), u.output_tokens, images=int(image is not None))
    if resp.stop_reason == "refusal":
        raise AIError(tr("The model refused to answer"))
    text = next((b.text for b in resp.content if b.type == "text"), "")
    return _parse_json(text), {"stop_reason": resp.stop_reason}


# ------------------------------------------------------------------ speech
def _multipart(fields, file_field, filename, data):
    b = uuid.uuid4().hex
    parts = []
    for k, v in fields:
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
                 f'Content-Type: {ctype}\r\n\r\n'.encode() + data + b"\r\n")
    parts.append(f"--{b}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={b}"


def transcribe(pid, model, audio_path, language, prompt="", duration=0):
    """[{start, end, text}] for one audio file (ogg/opus, up to 15 min) at a paid service."""
    p = provider(pid)
    with open(audio_path, "rb") as f:
        data = f.read()
    fields = [("model", model), ("response_format", "verbose_json"), ("timestamp_granularities[]", "segment"),
              ("temperature", "0")]
    if language:
        fields.append(("language", language))
    if prompt:
        fields.append(("prompt", prompt[:800]))
    raw, ctype = _multipart(fields, "file", os.path.basename(audio_path), data)
    resp = _http(p["base"] + "/audio/transcriptions", headers={"Authorization": "Bearer " + _key(pid), "Content-Type": ctype},
                 raw=raw, timeout=900)
    segs = [{"start": s.get("start", 0), "end": s.get("end", 0), "text": s.get("text", ""),
             "no_speech": s.get("no_speech_prob", 0), "logprob": s.get("avg_logprob", 0)} for s in resp.get("segments") or []]
    if not segs and (resp.get("text") or "").strip():
        segs = [{"start": 0, "end": duration, "text": resp["text"]}]
    log_usage(pid, model, "speech", audio_s=duration)
    return segs


# ------------------------------------------------------------------ key check
def check_key(pid, key):
    """Quick test that the key works (lists models; costs nothing)."""
    p = provider(pid)
    if p["kind"] == "anthropic":
        import anthropic
        try:
            anthropic.Anthropic(api_key=key, max_retries=1, timeout=20).models.list(limit=1)
        except anthropic.AuthenticationError:
            raise AIError(tr("Invalid Anthropic API key")) from None
        except anthropic.APIError as e:
            raise AIError(f"Anthropic: {e}") from None
    elif pid == "openrouter":
        _http("https://openrouter.ai/api/v1/key", headers={"Authorization": "Bearer " + key}, method="GET", timeout=20)
    else:
        _http(p["base"] + "/models", headers={"Authorization": "Bearer " + key}, method="GET", timeout=20)
    return True


# ------------------------------------------------------------------ estimates
def per_hour(settings):
    """How much work one hour of recording means with the current settings (for the price estimates)."""
    g = lambda k: settings.get(k, config.DEFAULTS.get(k))   # noqa: E731
    conv = 0.5          # share of a typical RP evening spent in conversations
    frames = 0.0
    if g("ai_vision_dialog") and g("ai_dialog_every"):
        frames += conv * 3600 * (0.5 / max(2, g("ai_dialog_every")) + 0.5 / max(10, g("ai_static_every")))
    if g("ai_base_every"):
        frames += (1 - conv) * 3600 / max(30, g("ai_base_every"))
    tracks = max(1, len(g("ai_tracks") or []) - 1)       # "Zvuk" only exists without separate tracks
    return {"frames": round(frames), "speech_h": tracks, "text_in": 40000, "text_out": 9000,
            "frame_in": 700, "frame_out": 300}


def estimate(pid, task, mid, settings):
    """USD for one hour of recording."""
    m = model_info(pid, task, mid)
    if not m or provider(pid).get("local"):
        return 0.0
    w = per_hour(settings)
    if task == "speech":
        return w["speech_h"] * m.get("hour", 0)
    if task == "vision":
        tin = w["frames"] * (w["frame_in"] + m.get("img", 800))
        tout = w["frames"] * (w["frame_out"] + m.get("think", 0))
        return tin / 1e6 * m["in"] + tout / 1e6 * m["out"]
    return w["text_in"] / 1e6 * m["in"] + (w["text_out"] + 4 * m.get("think", 0)) / 1e6 * m["out"]


# ------------------------------------------------------------------ what actually runs
def effective(settings):
    """The provider and model for each part, with empty models filled from the hardware recommendation."""
    from . import hardware
    g = lambda k: settings.get(k, config.DEFAULTS.get(k))   # noqa: E731
    rec = hardware.recommend()
    out = {}
    for task, local in (("speech", "local"), ("vision", "ollama"), ("text", "ollama")):
        pid = g(f"ai_{task}_provider") or local
        if pid not in CATALOG or (not CATALOG[pid].get("local") and task not in CATALOG[pid].get("models", {})):
            pid = local
        if task == "speech":
            mid = g("ai_whisper_model") or rec["whisper"]["model"] if pid == "local" else g("ai_speech_model")
        else:
            mid = g(f"ai_{task}_model") if pid == g(f"ai_{task}_provider") else ""
            if not mid:
                mid = rec[task] if pid == "ollama" else ""
        if not provider(pid).get("local") and not model_info(pid, task, mid):
            mid = default_model(pid, task)      # e.g. still the Ollama tag from before the switch
        out[task] = {"provider": pid, "model": mid}
    w = rec["whisper"]
    cpu = g("ai_whisper_device") == "cpu" or w["device"] == "cpu"
    out["whisper"] = {"device": "cpu" if cpu else "auto", "compute": "int8" if cpu else w["compute"],
                      "batch": min(int(g("ai_batch_size") or 8), w["batch"] if cpu else 32)}
    return out
