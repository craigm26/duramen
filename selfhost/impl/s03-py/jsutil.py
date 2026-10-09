"""JSON helpers that behave like ECMAScript's JSON.parse / JSON.stringify."""
import json
import re

_WSL = (['\t', '\n', '\x0b', '\x0c', '\r', ' ', ' ', ' ']
        + [chr(c) for c in range(0x2000, 0x200b)]
        + [' ', ' ', ' ', ' ', '　', '﻿'])
WS_SET = frozenset(_WSL)
WS = '[' + re.escape(''.join(_WSL)) + ']'
NWS = '[^' + re.escape(''.join(_WSL)) + ']'
_LS = re.compile('^' + WS + '+')
_RS = re.compile(WS + r'+\Z')
_WORD = re.compile(NWS + '+')


def lstrip_ws(s):
    return _LS.sub('', s)


def rstrip_ws(s):
    return _RS.sub('', s)


def strip_ws(s):
    return rstrip_ws(lstrip_ws(s))


def words(s):
    return _WORD.findall(s)


def first_word_rest(s):
    """Split off the first word; the rest has its leading white space removed."""
    s = lstrip_ws(s)
    m = _WORD.match(s)
    if not m:
        return '', ''
    return m.group(), lstrip_ws(s[m.end():])


def u16(s):
    return s.encode('utf-16-be', 'surrogatepass')


def _bad_const(c):
    raise ValueError(c)


def jparse(text):
    """(ok, value); every number is a float, as in ECMAScript."""
    try:
        return True, json.loads(text, parse_int=float, parse_constant=_bad_const)
    except Exception:
        return False, None


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def jstr(s):
    out = ['"']
    for ch in s:
        o = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == '\\':
            out.append('\\\\')
        elif ch == '\b':
            out.append('\\b')
        elif ch == '\f':
            out.append('\\f')
        elif ch == '\n':
            out.append('\\n')
        elif ch == '\r':
            out.append('\\r')
        elif ch == '\t':
            out.append('\\t')
        elif o < 0x20 or 0xd800 <= o <= 0xdfff:
            out.append('\\u%04x' % o)
        else:
            out.append(ch)
    out.append('"')
    return ''.join(out)


_NUM = re.compile(r'(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$')


def jnum(x):
    if isinstance(x, int):
        return str(x)
    if x != x or x in (float('inf'), float('-inf')):
        return 'null'
    if x == 0:
        return '0'
    sign = '-' if x < 0 else ''
    m = _NUM.match(repr(abs(x)))
    ip, fp, ex = m.group(1), m.group(2) or '', int(m.group(3) or 0)
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


def js_keys(d):
    idx, other = [], []
    for k in d:
        if k.isascii() and k.isdigit() and (k == '0' or k[0] != '0') and int(k) < 2 ** 32 - 1:
            idx.append(k)
        else:
            other.append(k)
    idx.sort(key=int)
    return idx + other


def jdump(v):
    if v is None:
        return 'null'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, str):
        return jstr(v)
    if isinstance(v, (int, float)):
        return jnum(v)
    if isinstance(v, (list, tuple)):
        return '[' + ','.join(jdump(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(jstr(k) + ':' + jdump(v[k]) for k in js_keys(v)) + '}'
    raise TypeError(type(v))


def jeq(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)):
        return isinstance(b, (int, float)) and a == b
    if a is None:
        return b is None
    if isinstance(a, str):
        return isinstance(b, str) and a == b
    if isinstance(a, list):
        return isinstance(b, list) and len(a) == len(b) and all(jeq(x, y) for x, y in zip(a, b))
    if isinstance(a, dict):
        return (isinstance(b, dict) and set(a) == set(b)
                and all(jeq(a[k], b[k]) for k in a))
    return False
