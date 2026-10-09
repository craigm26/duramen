"""JSON helpers that behave like ECMAScript's JSON.parse / JSON.stringify where the spec needs it."""
import json
import re
from decimal import Decimal

WSC = '\t\n\x0b\x0c\r    -     　﻿'
WS_RE = re.compile('[' + WSC + ']+')
_LEAD_RE = re.compile('^[' + WSC + ']+')
_TRAIL_RE = re.compile('[' + WSC + ']+$')


def rstrip_ws(s):
    return _TRAIL_RE.sub('', s)


def lstrip_ws(s):
    return _LEAD_RE.sub('', s)


def strip_ws(s):
    return lstrip_ws(rstrip_ws(s))


def split_ws(s):
    return [w for w in WS_RE.split(s) if w]


def first_word(s):
    """(first word, rest after the white space that follows it, stripped)."""
    s = strip_ws(s)
    m = WS_RE.search(s)
    if not m:
        return s, ''
    return s[:m.start()], s[m.end():]


def _no_const(x):
    raise ValueError(x)


def jparse(text):
    """Parse JSON; every number becomes a float (binary64, as ECMAScript reads it)."""
    return json.loads(text, parse_float=float, parse_int=float, parse_constant=_no_const)


def jparse_string(text):
    """The value of text if it is a JSON string literal, else None."""
    if not text.startswith('"'):
        return None
    try:
        v = json.loads(text, parse_constant=_no_const)
    except Exception:
        return None
    return v if isinstance(v, str) else None


def jtype(v):
    if v is None:
        return 'null'
    if v is True or v is False:
        return 'bool'
    if isinstance(v, (int, float)):
        return 'num'
    if isinstance(v, str):
        return 'str'
    if isinstance(v, list):
        return 'arr'
    return 'obj'


def jeq(a, b):
    ta, tb = jtype(a), jtype(b)
    if ta != tb:
        return False
    if ta == 'arr':
        return len(a) == len(b) and all(jeq(x, y) for x, y in zip(a, b))
    if ta == 'obj':
        return set(a) == set(b) and all(jeq(a[k], b[k]) for k in a)
    if ta == 'num':
        return float(a) == float(b)
    return a == b


def is_index(k):
    return k.isascii() and k.isdigit() and (k == '0' or k[0] != '0') and int(k) < 4294967295


def es_keys(d):
    idx = sorted((k for k in d if is_index(k)), key=int)
    return idx + [k for k in d if not is_index(k)]


def js_num(x):
    if isinstance(x, int):
        return str(x)
    if x != x or x in (float('inf'), float('-inf')):
        return 'null'
    if x == 0:
        return '0'
    sign = '-' if x < 0 else ''
    d = Decimal(repr(abs(x)))
    _, digs, exp = d.as_tuple()
    ds = ''.join(map(str, digs)).rstrip('0') or '0'
    # value = int(all digits) * 10**exp ; digits stripped of trailing zeros
    total = ''.join(map(str, digs))
    stripped = total.rstrip('0')
    k = len(stripped)
    n = len(total) + exp  # position of decimal point relative to start of digits
    ds = stripped
    if k <= n <= 21:
        out = ds + '0' * (n - k)
    elif 0 < n <= 21:
        out = ds[:n] + '.' + ds[n:]
    elif -6 < n <= 0:
        out = '0.' + '0' * (-n) + ds
    else:
        e = n - 1
        es = ('+' if e >= 0 else '-') + str(abs(e))
        out = (ds if k == 1 else ds[0] + '.' + ds[1:]) + 'e' + es
    return sign + out


_ESC = {'"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t'}


def js_str(s):
    out = ['"']
    for ch in s:
        o = ord(ch)
        if ch in _ESC:
            out.append(_ESC[ch])
        elif o < 0x20 or 0xD800 <= o <= 0xDFFF:
            out.append('\\u%04x' % o)
        else:
            out.append(ch)
    out.append('"')
    return ''.join(out)


def stringify(v):
    if v is None:
        return 'null'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, (int, float)):
        return js_num(v)
    if isinstance(v, str):
        return js_str(v)
    if isinstance(v, list):
        return '[' + ','.join(stringify(x) for x in v) + ']'
    return '{' + ','.join(js_str(k) + ':' + stringify(v[k]) for k in es_keys(v)) + '}'


def ascii_escape(s):
    def rep(m):
        o = ord(m.group(0))
        if o > 0xFFFF:
            o -= 0x10000
            return '\\u%04x\\u%04x' % (0xD800 + (o >> 10), 0xDC00 + (o & 0x3FF))
        return '\\u%04x' % o
    return re.sub('[^\x00-\x7f]', rep, s)
