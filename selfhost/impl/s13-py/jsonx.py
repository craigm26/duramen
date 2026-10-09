"""Strict JSON reading and ECMAScript-style JSON writing.

Numbers are read as binary64 floats.  A number too large to be finite is an
error unless the caller allows it (the driver does, for `judge`).
"""
import math
import sys

sys.setrecursionlimit(20000)


class JsonError(Exception):
    pass


_ESC = {'"': '"', '\\': '\\', '/': '/', 'b': '\b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t'}
_JWS = ' \t\n\r'


class _Parser:
    def __init__(self, text, allow_big):
        self.s = text
        self.i = 0
        self.n = len(text)
        self.allow_big = allow_big

    def ws(self):
        s, n, i = self.s, self.n, self.i
        while i < n and s[i] in _JWS:
            i += 1
        self.i = i

    def value(self):
        self.ws()
        if self.i >= self.n:
            raise JsonError('eof')
        c = self.s[self.i]
        if c == '{':
            return self.obj()
        if c == '[':
            return self.arr()
        if c == '"':
            return self.string()
        if c == 't' and self.s.startswith('true', self.i):
            self.i += 4
            return True
        if c == 'f' and self.s.startswith('false', self.i):
            self.i += 5
            return False
        if c == 'n' and self.s.startswith('null', self.i):
            self.i += 4
            return None
        return self.number()

    def number(self):
        s, n, i = self.s, self.n, self.i
        j = i
        if j < n and s[j] == '-':
            j += 1
        if j >= n:
            raise JsonError('number')
        if s[j] == '0':
            j += 1
        elif '1' <= s[j] <= '9':
            while j < n and '0' <= s[j] <= '9':
                j += 1
        else:
            raise JsonError('number')
        if j < n and s[j] == '.':
            j += 1
            k = j
            while j < n and '0' <= s[j] <= '9':
                j += 1
            if j == k:
                raise JsonError('number')
        if j < n and s[j] in 'eE':
            j += 1
            if j < n and s[j] in '+-':
                j += 1
            k = j
            while j < n and '0' <= s[j] <= '9':
                j += 1
            if j == k:
                raise JsonError('number')
        v = float(s[i:j])
        if math.isinf(v) and not self.allow_big:
            raise JsonError('too large')
        self.i = j
        return v

    def string(self):
        s, n = self.s, self.n
        i = self.i + 1
        out = []
        while True:
            if i >= n:
                raise JsonError('string')
            c = s[i]
            if c == '"':
                i += 1
                break
            if c == '\\':
                i += 1
                if i >= n:
                    raise JsonError('string')
                e = s[i]
                if e == 'u':
                    h = s[i + 1:i + 5]
                    if len(h) != 4 or any(x not in '0123456789abcdefABCDEF' for x in h):
                        raise JsonError('escape')
                    out.append(chr(int(h, 16)))
                    i += 5
                elif e in _ESC:
                    out.append(_ESC[e])
                    i += 1
                else:
                    raise JsonError('escape')
            elif c < ' ':
                raise JsonError('control')
            else:
                out.append(c)
                i += 1
        self.i = i
        return _join_surrogates(''.join(out))

    def arr(self):
        self.i += 1
        res = []
        self.ws()
        if self.i < self.n and self.s[self.i] == ']':
            self.i += 1
            return res
        while True:
            res.append(self.value())
            self.ws()
            if self.i >= self.n:
                raise JsonError('array')
            c = self.s[self.i]
            self.i += 1
            if c == ',':
                continue
            if c == ']':
                return res
            raise JsonError('array')

    def obj(self):
        self.i += 1
        res = {}
        self.ws()
        if self.i < self.n and self.s[self.i] == '}':
            self.i += 1
            return res
        while True:
            self.ws()
            if self.i >= self.n or self.s[self.i] != '"':
                raise JsonError('key')
            k = self.string()
            self.ws()
            if self.i >= self.n or self.s[self.i] != ':':
                raise JsonError('colon')
            self.i += 1
            res[k] = self.value()
            self.ws()
            if self.i >= self.n:
                raise JsonError('object')
            c = self.s[self.i]
            self.i += 1
            if c == ',':
                continue
            if c == '}':
                return res
            raise JsonError('object')


def _join_surrogates(s):
    if not any('\ud800' <= c <= '\udfff' for c in s):
        return s
    out = []
    i = 0
    while i < len(s):
        c = s[i]
        if '\ud800' <= c <= '\udbff' and i + 1 < len(s) and '\udc00' <= s[i + 1] <= '\udfff':
            out.append(chr(0x10000 + ((ord(c) - 0xD800) << 10) + (ord(s[i + 1]) - 0xDC00)))
            i += 2
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def parse(text, allow_big=False):
    """Parse a complete JSON text; raises JsonError."""
    try:
        p = _Parser(text, allow_big)
        v = p.value()
        p.ws()
        if p.i != p.n:
            raise JsonError('trailing')
        return v
    except RecursionError:
        raise JsonError('deep')


def has_big(v):
    if isinstance(v, float):
        return math.isinf(v)
    if isinstance(v, list):
        return any(has_big(x) for x in v)
    if isinstance(v, dict):
        return any(has_big(x) for x in v.values())
    return False


# ---------------------------------------------------------------- writing

def js_num(x):
    if x != x or math.isinf(x):
        return 'null'
    if x == 0:
        return '0'
    if x < 0:
        return '-' + js_num(-x)
    r = repr(float(x))
    if 'e' in r:
        m, e = r.split('e')
        e = int(e)
    else:
        m, e = r, 0
    if '.' in m:
        ip, fp = m.split('.')
    else:
        ip, fp = m, ''
    digits = ip + fp
    point = len(ip) + e
    stripped = digits.lstrip('0')
    point -= len(digits) - len(stripped)
    digits = stripped.rstrip('0')
    k = len(digits)
    n = point
    if k <= n <= 21:
        return digits + '0' * (n - k)
    if 0 < n <= 21:
        return digits[:n] + '.' + digits[n:]
    if -6 < n <= 0:
        return '0.' + '0' * (-n) + digits
    ex = n - 1
    sign = '+' if ex >= 0 else '-'
    if k == 1:
        return digits + 'e' + sign + str(abs(ex))
    return digits[0] + '.' + digits[1:] + 'e' + sign + str(abs(ex))


def js_str(s):
    out = ['"']
    for c in s:
        o = ord(c)
        if c == '"':
            out.append('\\"')
        elif c == '\\':
            out.append('\\\\')
        elif c == '\b':
            out.append('\\b')
        elif c == '\f':
            out.append('\\f')
        elif c == '\n':
            out.append('\\n')
        elif c == '\r':
            out.append('\\r')
        elif c == '\t':
            out.append('\\t')
        elif o < 0x20 or 0xD800 <= o <= 0xDFFF:
            out.append('\\u%04x' % o)
        else:
            out.append(c)
    out.append('"')
    return ''.join(out)


def _is_index(k):
    if not k or not k.isascii() or not k.isdigit():
        return False
    if k != '0' and k[0] == '0':
        return False
    return int(k) < 4294967295


def js_key_order(keys):
    keys = list(keys)
    idx = sorted((k for k in keys if _is_index(k)), key=int)
    return idx + [k for k in keys if not _is_index(k)]


def stringify(v):
    """JSON.stringify without spaces."""
    if v is None:
        return 'null'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, (int, float)):
        return js_num(float(v))
    if isinstance(v, str):
        return js_str(v)
    if isinstance(v, list):
        return '[' + ','.join(stringify(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(js_str(k) + ':' + stringify(v[k]) for k in js_key_order(v)) + '}'
    raise TypeError(type(v))


def dumps(v):
    """Compact, ASCII-only JSON for the driver's output."""
    if v is None:
        return 'null'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, (int, float)):
        return js_num(float(v))
    if isinstance(v, str):
        out = ['"']
        for c in v:
            o = ord(c)
            if c == '"':
                out.append('\\"')
            elif c == '\\':
                out.append('\\\\')
            elif c == '\n':
                out.append('\\n')
            elif c == '\r':
                out.append('\\r')
            elif c == '\t':
                out.append('\\t')
            elif o < 0x20 or o > 0x7e:
                if o > 0xFFFF:
                    o -= 0x10000
                    out.append('\\u%04x\\u%04x' % (0xD800 + (o >> 10), 0xDC00 + (o & 0x3FF)))
                else:
                    out.append('\\u%04x' % o)
            else:
                out.append(c)
        out.append('"')
        return ''.join(out)
    if isinstance(v, list):
        return '[' + ','.join(dumps(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(dumps(k) + ':' + dumps(x) for k, x in v.items()) + '}'
    raise TypeError(type(v))


# ---------------------------------------------------------------- comparing

def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def jeq(a, b):
    if is_num(a) and is_num(b):
        return float(a) == float(b)
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, str) and isinstance(b, str):
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(jeq(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(jeq(a[k], b[k]) for k in a)
    return False


def u16key(s):
    return s.encode('utf-16-be', 'surrogatepass')
