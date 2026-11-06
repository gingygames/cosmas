"""Recognising characters by how they look: clothing, hair and face, not only by a name tag.

Every person the vision model marks on a frame gets two fingerprints:
  body - DINOv2 (small) on the crop of the whole figure: clothing, colours, hair, headwear
  face - SFace on the face inside that crop, when one is visible
Crops whose name tag (or the user) says who it is become references for that character. Other crops
are compared with the references; references from the same evening count fully, older ones less,
because clothes change from time to time.
"""
import base64
import math

import numpy as np

from . import config

MODELS = config.DATA_DIR / "models"
DINO = MODELS / "dinov2_small.onnx"
DINO_URL = "https://huggingface.co/onnx-community/dinov2-small/resolve/main/onnx/model.onnx"
SFACE = MODELS / "face_recognition_sface_2021dec.onnx"
SFACE_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def pack(v):
    return base64.b64encode(np.asarray(v, np.float16).tobytes()).decode() if v is not None else None


def unpack(s):
    return np.frombuffer(base64.b64decode(s), np.float16).astype(np.float32) if s else None


def _download(path, url):
    if not path.exists():
        import urllib.request
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(url, tmp)
        tmp.replace(path)


class Embedder:
    """Fingerprints of crops (runs on the CPU: a few ms per crop, the GPU stays free)."""

    def __init__(self):
        self._dino = None
        self._sface = None

    def body(self, crop):
        """BGR crop of one figure -> unit vector (384)."""
        import cv2
        if self._dino is None:
            import onnxruntime as ort
            _download(DINO, DINO_URL)
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 4
            self._dino = ort.InferenceSession(str(DINO), opts, providers=["CPUExecutionProvider"])
        h, w = crop.shape[:2]
        s = 224 / max(h, w)                        # keep proportions, pad to a square
        img = cv2.resize(crop, (max(14, int(w * s)), max(14, int(h * s))), interpolation=cv2.INTER_AREA)
        pad = np.full((224, 224, 3), 124, np.uint8)
        y, x = (224 - img.shape[0]) // 2, (224 - img.shape[1]) // 2
        pad[y:y + img.shape[0], x:x + img.shape[1]] = img
        rgb = (cv2.cvtColor(pad, cv2.COLOR_BGR2RGB).astype(np.float32) / 255 - MEAN) / STD
        out = self._dino.run(None, {"pixel_values": rgb.transpose(2, 0, 1)[None]})[0][0]
        v = np.concatenate([out[0], out[1:].mean(0)])        # CLS token + average of the patches
        return v / (np.linalg.norm(v) + 1e-9)

    def face(self, img, face_row):
        """Full frame + one YuNet detection row -> unit vector (128)."""
        import cv2
        if self._sface is None:
            _download(SFACE, SFACE_URL)
            self._sface = cv2.FaceRecognizerSF.create(str(SFACE), "")
        aligned = self._sface.alignCrop(img, face_row)
        v = self._sface.feature(aligned).flatten()
        return v / (np.linalg.norm(v) + 1e-9)


class Gallery:
    """References per character; match() says who an unknown crop most likely is."""

    def __init__(self, refs, half_life_days=30.0):
        """refs: dicts character_id, media_id, abs_time, body (vector or None), face (vector or None)."""
        self.half = max(1.0, float(half_life_days)) * 86400
        self.refs = refs
        self.body = [(r, r["body"]) for r in refs if r.get("body") is not None]
        self.face = [(r, r["face"]) for r in refs if r.get("face") is not None]

    def _weight(self, r, media_id, abs_time):
        if r["media_id"] == media_id:
            return 1.0
        if not abs_time or not r.get("abs_time"):
            return 0.9
        return 0.75 + 0.25 * math.pow(0.5, abs(abs_time - r["abs_time"]) / self.half)

    def match(self, body, face, media_id, abs_time):
        """[(character_id, score)] best first, each similarity weighted by how recent the reference is.
        Measured on a real 8 h recording: faces separate characters far better (same ~0.70, different ~0.19)
        than clothing (same ~0.78, different ~0.61 - medieval clothes look alike), so a visible face decides
        70 % of the score; without a face the clothing score is discounted."""
        best = {}
        for kind, vec, pool in (("body", body, self.body), ("face", face, self.face)):
            if vec is None:
                continue
            for r, rv in pool:
                if len(rv) != len(vec):
                    continue
                s = float(np.dot(vec, rv)) * self._weight(r, media_id, abs_time)
                key = (r["character_id"], kind)
                if s > best.get(key, -1):
                    best[key] = s
        out = []
        for cid in {c for c, _ in best}:
            b, f = best.get((cid, "body"), 0.0), best.get((cid, "face"))
            out.append((cid, 0.7 * f + 0.3 * b if f is not None else 0.9 * b - 0.05))
        return sorted(out, key=lambda x: -x[1])


def match_media(store, media_id, frames, matcher, settings):
    """Who is who on this video's frames. Updates references and hits in the store and returns
    mentions [{character_id, t, kind}] ('seen' = name tag or confirmed, 'look' = recognised by appearance)."""
    m = store.media(media_id)
    start = m.start_time if m else None
    labels = store.appearance_labels(media_id)
    persons = [(f, p) for f in frames for p in f.get("persons") or []]
    refs, hits, unknown = [], [], []
    for f, p in persons:
        key = (round(f["t"], 1), p["idx"])
        lab = labels.get(key, {"yes": None, "no": set()})
        cid, source = lab["yes"], "user"
        if cid is None and p.get("name"):
            ids = matcher.name_tag(p["name"]) - lab["no"]
            if len(ids) == 1:
                cid, source = next(iter(ids)), "tag"
        if cid is not None:
            refs.append({"character_id": cid, "t": f["t"], "idx": p["idx"], "file": p.get("file"), "look": p.get("look", ""),
                         "body": p.get("emb"), "face": p.get("face_emb"), "source": source,
                         "abs_time": start + f["t"] if start else None})
            hits.append({"t": f["t"], "idx": p["idx"], "character_id": cid, "score": 1.0, "source": source})
        else:
            unknown.append((f, p, lab["no"]))
    store.set_appearance_refs(media_id, refs)
    if unknown and settings.get("ai_appearance", True):
        gallery = Gallery([dict(r, body=unpack(r["body"]), face=unpack(r["face"])) for r in store.appearance_refs()],
                          settings.get("ai_look_half_life", 30))
        thr, margin = float(settings.get("ai_look_threshold", 0.60)), float(settings.get("ai_look_margin", 0.04))
        for f, p, no in unknown:
            ranked = [x for x in gallery.match(unpack(p.get("emb")), unpack(p.get("face_emb")), media_id,
                                               start + f["t"] if start else None) if x[0] not in no]
            if ranked and ranked[0][1] >= thr and (len(ranked) == 1 or ranked[0][1] - ranked[1][1] >= margin):
                hits.append({"t": f["t"], "idx": p["idx"], "character_id": ranked[0][0], "score": round(ranked[0][1], 3),
                             "source": "look"})
    store.set_appearance_hits(media_id, hits)
    out, seen = [], set()
    for h in hits:
        kind = "look" if h["source"] == "look" else "seen"
        key = (h["character_id"], int(h["t"] // 60), kind)
        if key not in seen:
            seen.add(key)
            out.append({"character_id": h["character_id"], "t": h["t"], "kind": kind})
    return out


def similarity(b1, f1, b2, f2):
    """Same weighting as Gallery.match: the face decides when both crops show one."""
    b = float(np.dot(b1, b2)) if b1 is not None and b2 is not None else 0.0
    if f1 is not None and f2 is not None:
        return 0.7 * float(np.dot(f1, f2)) + 0.3 * b
    return 0.9 * b - 0.05


def unknown_groups(frames, hits, threshold=0.66, min_size=2):
    """People on this video's frames nobody has recognised yet, grouped by similar face / clothing / hair,
    so one answer ("this is X") labels the whole group. Biggest groups first."""
    items = []
    for f in frames:
        for p in f.get("persons") or []:
            if (round(f["t"], 1), p["idx"]) in hits or not p.get("emb"):
                continue
            items.append({"t": f["t"], "idx": p["idx"], "file": p.get("file"), "name": p.get("name", ""),
                          "b": unpack(p["emb"]), "f": unpack(p.get("face_emb"))})
    groups = []
    for it in sorted(items, key=lambda x: x["t"]):
        best, score = None, threshold
        for g in groups:
            # average similarity to the group, so one look-alike does not chain two people together
            sims = [similarity(it["b"], it["f"], m["b"], m["f"]) for m in g]
            s = sum(sims) / len(sims)
            if s >= score:
                best, score = g, s
        if best is None:
            groups.append([it])
        else:
            best.append(it)
    out = []
    for g in groups:
        if len(g) < min_size:
            continue
        names = {}
        for m in g:
            if m["name"]:
                names[m["name"]] = names.get(m["name"], 0) + 1
        out.append({"members": [[m["t"], m["idx"]] for m in g], "files": [m["file"] for m in g],
                    "names": sorted(names.items(), key=lambda x: -x[1])})
    return sorted(out, key=lambda g: -len(g["members"]))
