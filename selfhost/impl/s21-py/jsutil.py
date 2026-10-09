"""JSON and white space helpers that follow ECMAScript where the spec says so."""
import json
import math
import re

WS_CHARS = ('\t\n\x0b\x0c\r \xa0 ' + ''.join(chr(c) for c in range(0x2000, 0x200b))
            + '    　﻿')
WS_CLASS = '[' + re.escape(WS_CHARS) + ']'
NOT_WS = '[^' + re.escape(WS_CHARS) + ']'
WS_SPLIT = re.compile(WS_CLASS + '+')
_WORD_RE = re.compile('^(' + NOT_WS + '*)' + WS_CLASS + '*(.*)$', re.S)
LINE_SPLIT = re.compile(r'\r\n|\n|\r')
NUM_RE = re.compile(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?')
INDEX_RE = re.compile(r'0|[1-9][0-9]*')


def strip(s):
    return s.strip(WS_CHARS)


def lstrip(s):
    return s.lstrip(WS_CHARS)


def rstrip(s):
    return s.rstrip(WS_CHARS)


def split_word(s):
    """First word and the rest after the white space that follows it."""
    m = _WORD_RE.match(s)
    return m.group(1), m.group(2)


def u16(s):
    return s.encode('utf-16-be', 'surrogatepass')


class TooBig(ValueError):
    pass


def _big(s):
    f = float(s)
    if math.isinf(f):
        raise TooBig()
    return f


def _bad_constant(s):
    raise ValueError(s)


def parse_json(text):
    """Strict parse: numbers become floats, a number too large for binary64 raises TooBig."""
    try:
        return json.loads(text, parse_float=_big, parse_int=_big, parse_constant=_bad_constant)
    except RecursionError:
        raise ValueError('too deep')


def parse_json_lenient(text):
    """Parse of a request line: numbers become floats (inf when too large)."""
    try:
        return json.loads(text, parse_float=float, parse_int=float, parse_constant=_bad_constant)
    except RecursionError:
        raise ValueError('too deep')


def parse_jstring(text):
    """The string a JSON string text holds, or None."""
    try:
        v = parse_json(text)
    except ValueError:
        return None
    return v if isinstance(v, str) else None


def parse_number(text):
    """('ok', float) | ('big', None) | ('bad', None) for a JSON number text."""
    if not NUM_RE.fullmatch(text):
        return 'bad', None
    f = float(text)
    if math.isinf(f):
        return 'big', None
    return 'ok', f


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def js_num(x):
    x = float(x)
    if x != x or x in (math.inf, -math.inf):
        return 'null'
    if x == 0:
        return '0'
    sign = '-' if x < 0 else ''
    r = repr(abs(x))
    mant, _, exp = r.partition('e')
    exp = int(exp) if exp else 0
    ip, _, fp = mant.partition('.')
    digits = ip + fp
    point = len(ip) + exp
    stripped = digits.lstrip('0')
    point -= len(digits) - len(stripped)
    digits = stripped.rstrip('0')
    k = len(digits)
    n = point
    if k <= n <= 21:
        out = digits + '0' * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + '.' + digits[n:]
    elif -6 < n <= 0:
        out = '0.' + '0' * (-n) + digits
    else:
        e = n - 1
        es = ('+' if e >= 0 else '-') + str(abs(e))
        out = digits[0] + ('.' + digits[1:] if k > 1 else '') + 'e' + es
    return sign + out


_ESC = {'"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t'}


def js_str(s):
    out = ['"']
    for ch in s:
        if ch in _ESC:
            out.append(_ESC[ch])
        else:
            o = ord(ch)
            if o < 0x20 or 0xD800 <= o <= 0xDFFF:
                out.append('\\u%04x' % o)
            else:
                out.append(ch)
    out.append('"')
    return ''.join(out)


def js_keys(d):
    ints = []
    others = []
    for k in d:
        if INDEX_RE.fullmatch(k) and int(k) <= 4294967294:
            ints.append(k)
        else:
            others.append(k)
    ints.sort(key=int)
    return ints + others


def js_dumps(v):
    """JSON.stringify, compact, with ECMAScript's member order."""
    if v is None:
        return 'null'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, str):
        return js_str(v)
    if isinstance(v, (int, float)):
        return js_num(v)
    if isinstance(v, list):
        return '[' + ','.join(js_dumps(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(js_str(k) + ':' + js_dumps(v[k]) for k in js_keys(v)) + '}'
    raise TypeError(type(v))


def jeq(a, b):
    """Equal as JSON values; numbers as binary64 values."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if is_num(a) or is_num(b):
        return is_num(a) and is_num(b) and _f(a) == _f(b)
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, str) or isinstance(b, str):
        return isinstance(a, str) and isinstance(b, str) and a == b
    if isinstance(a, list) or isinstance(b, list):
        return (isinstance(a, list) and isinstance(b, list) and len(a) == len(b)
                and all(jeq(x, y) for x, y in zip(a, b)))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(jeq(a[k], b[k]) for k in a)
    return False


def _f(x):
    try:
        return float(x)
    except OverflowError:
        return math.inf if x > 0 else -math.inf


def dist(a, b):
    return abs(_f(a) - _f(b))


NOT_FOUND = (False, None)


def lookup(resp, path):
    """(True, value) for the value at a dotted path of a response, else (False, None)."""
    segs = path.split('.')
    if not isinstance(resp, dict) or segs[0] not in resp:
        return NOT_FOUND
    cur = resp[segs[0]]
    rest = segs[1:]
    if segs[0] == 'audit' and rest:
        if not isinstance(cur, str):
            return NOT_FOUND
        try:
            cur = parse_json(cur)
        except ValueError:
            return NOT_FOUND
    for s in rest:
        if isinstance(cur, dict):
            if s not in cur:
                return NOT_FOUND
            cur = cur[s]
        elif isinstance(cur, list):
            if not INDEX_RE.fullmatch(s):
                return NOT_FOUND
            k = int(s)
            if k >= len(cur):
                return NOT_FOUND
            cur = cur[k]
        else:
            return NOT_FOUND
    return True, cur
