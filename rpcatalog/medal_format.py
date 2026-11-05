"""Decoder for the binary metadata blobs in Medal's local database.

Each value starts with one header byte:
  low nibble  = type  (0 null, 1 true, 2 false, 3 int-as-text, 5 float-as-text,
                       7 string, 8 escaped string, 11 array, 12 object)
  high nibble = length in bytes of the payload; 0..11 inline,
                12/13/14/15 = length follows as 1/2/4/8 byte big-endian int.
Objects are a flat sequence of key, value pairs; arrays a sequence of values.
"""

import json

_EXTRA = {12: 1, 13: 2, 14: 4, 15: 8}


class MedalFormatError(ValueError):
    pass


def _read(buf, pos):
    if pos >= len(buf):
        raise MedalFormatError("unexpected end of data")
    head = buf[pos]
    typ, size = head & 0x0F, head >> 4
    pos += 1
    if size in _EXTRA:
        n = _EXTRA[size]
        size = int.from_bytes(buf[pos:pos + n], "big")
        pos += n
    end = pos + size
    if end > len(buf):
        raise MedalFormatError("length past end of data")
    body = buf[pos:end]
    if typ == 0:
        return None, end
    if typ == 1:
        return True, end
    if typ == 2:
        return False, end
    if typ == 3:
        return int(body), end
    if typ == 5:
        return float(body), end
    if typ == 7:
        return body.decode("utf-8", "replace"), end
    if typ == 8:  # string stored with JSON-style escapes (e.g. Windows paths)
        text = body.decode("utf-8", "replace")
        try:
            return json.loads('"' + text + '"'), end
        except ValueError:
            return text, end
    if typ == 11:
        items, p = [], pos
        while p < end:
            v, p = _read(buf, p)
            items.append(v)
        return items, end
    if typ == 12:
        obj, p = {}, pos
        while p < end:
            k, p = _read(buf, p)
            v, p = _read(buf, p)
            obj[str(k)] = v
        return obj, end
    raise MedalFormatError(f"unknown type {typ} at byte {pos - 1}")


def decode(blob: bytes):
    value, end = _read(bytes(blob), 0)
    return value
