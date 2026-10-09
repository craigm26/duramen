"""JSON and white space helpers that follow ECMAScript where the specification does."""
import json
import re

# What ECMAScript's \s matches.
WS_CHARS = ('\t\n\x0b\x0c\r           '
            '       　﻿')
WS_SET = frozenset(WS_CHARS)
WS = '[\t\n\x0b\x0c\r    -     　﻿]'


def rstrip_ws(s):
    n = len(s)
    while n and s[n - 1] in WS_SET:
        n -= 1
    return s[:n]


def lstrip_ws(s):
    i = 0
    n = len(s)
    while i < n and s[i] in WS_SET:
        i += 1
    return s[i:]


def strip_ws(s):
    return lstrip_ws(rstrip_ws(s))


def split_word(s):
    """First word (up to white space) and the rest, stripped."""
    i = 0
    n = len(s)
    while i < n and s[i] not in WS_SET:
        i += 1
    return s[:i], strip_ws(s[i:])


def split_words(s):
    out = []
    cur = []
    for ch in s:
        if ch in WS_SET:
            if cur:
                out.append(''.join(cur))
                cur = []
        else:
            cur.append(ch)
    if cur:
        out.append(''.join(cur))
    return out


def u16(s):
    """Sort key: UTF-16 code unit order."""
    return s.encode('utf-16-be', 'surrogatepass')


def _no_constant(c):
    raise ValueError(c)


def has_inf(v):
    stack = [v]
    while stack:
        x = stack.pop()
        if isinstance(x, float):
            if x != x or x in (float('inf'), float('-inf')):
                return True
        elif isinstance(x, list):
            stack.extend(x)
        elif isinstance(x, dict):
            stack.extend(x.values())
    return False


def parse_json(text):
    """('ok', value) | ('bad', None) | ('big', None).  Every number is a float."""
    try:
        v = json.loads(text, parse_int=float, parse_float=float, parse_constant=_no_constant)
    except (ValueError, RecursionError):
        return 'bad', None
    if has_inf(v):
        return 'big', None
    return 'ok', v


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


_NUM_RE = re.compile(r'(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?')


def js_num(x):
    if x != x or x in (float('inf'), float('-inf')):
        return 'null'
    if x == 0:
        return '0'
    sign = '-' if x < 0 else ''
    m = _NUM_RE.fullmatch(repr(float(abs(x))))
    ip, fp, ex = m.groups()
    fp = fp or ''
    ex = int(ex) if ex else 0
    digits = ip + fp
    n = len(ip) + ex
    stripped = digits.lstrip('0')
    n -= len(digits) - len(stripped)
    digits = stripped.rstrip('0')
    k = len(digits)
    if k <= n <= 21:
        body = digits + '0' * (n - k)
    elif 0 < n <= 21:
        body = digits[:n] + '.' + digits[n:]
    elif -6 < n <= 0:
        body = '0.' + '0' * (-n) + digits
    else:
        e = n - 1
        es = ('+' if e >= 0 else '-') + str(abs(e))
        body = digits + 'e' + es if k == 1 else digits[0] + '.' + digits[1:] + 'e' + es
    return sign + body


_ESC = {'"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t'}


def js_str(s):
    out = ['"']
    for ch in s:
        e = _ESC.get(ch)
        if e is not None:
            out.append(e)
            continue
        o = ord(ch)
        if o < 0x20 or 0xD800 <= o <= 0xDFFF:
            out.append('\\u%04x' % o)
        else:
            out.append(ch)
    out.append('"')
    return ''.join(out)


_INDEX_RE = re.compile(r'0|[1-9][0-9]*')


def js_keys(d):
    """Member names in the order ECMAScript keeps them."""
    idx = []
    other = []
    for k in d:
        if _INDEX_RE.fullmatch(k) and int(k) < 4294967295:
            idx.append(k)
        else:
            other.append(k)
    idx.sort(key=int)
    return idx + other


def js_stringify(v):
    if v is None:
        return 'null'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, str):
        return js_str(v)
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return js_num(v)
    if isinstance(v, list):
        return '[' + ','.join(js_stringify(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(js_str(k) + ':' + js_stringify(v[k]) for k in js_keys(v)) + '}'
    raise TypeError(type(v))


def jeq(a, b):
    """Equality of JSON values: numbers by value, members in any order."""
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if is_num(a) or is_num(b):
        return is_num(a) and is_num(b) and a == b
    if isinstance(a, str) or isinstance(b, str):
        return isinstance(a, str) and isinstance(b, str) and a == b
    if isinstance(a, list):
        return isinstance(b, list) and len(a) == len(b) and all(jeq(x, y) for x, y in zip(a, b))
    if isinstance(a, dict):
        return (isinstance(b, dict) and len(a) == len(b)
                and all(k in b and jeq(a[k], b[k]) for k in a))
    return False
