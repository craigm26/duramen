"""I-Regexp (RFC 9485) validation and translation to Python `re`."""
import re
import sys
import unicodedata

_MAX = 0x10FFFF
_PROPS = {
    "L": "Lu Ll Lt Lm Lo", "M": "Mn Mc Me", "N": "Nd Nl No",
    "P": "Pc Pd Ps Pe Pi Pf Po", "Z": "Zs Zl Zp", "S": "Sm Sc Sk So",
    "C": "Cc Cf Cs Co Cn",
}
_VALID_PROPS = set(_PROPS)
for _k, _v in list(_PROPS.items()):
    _VALID_PROPS.update(_v.split())
_SINGLE_ESC = {c: c for c in "()*+-.?[\\]^{|}"}
_SINGLE_ESC.update({"n": "\n", "r": "\r", "t": "\t"})

_cat_ranges = None


def _load_categories():
    global _cat_ranges
    if _cat_ranges is not None:
        return _cat_ranges
    cats = {}
    cat = unicodedata.category
    cur = None
    start = 0
    for cp in range(_MAX + 1):
        if 0xD800 <= cp <= 0xDFFF:
            c = None
        else:
            c = cat(chr(cp))
        if c != cur:
            if cur is not None:
                cats.setdefault(cur, []).append((start, cp - 1))
            cur = c
            start = cp
    if cur is not None:
        cats.setdefault(cur, []).append((start, _MAX))
    _cat_ranges = cats
    return cats


def _merge(ranges):
    out = []
    for lo, hi in sorted(ranges):
        if out and lo <= out[-1][1] + 1:
            if hi > out[-1][1]:
                out[-1] = (out[-1][0], hi)
        else:
            out.append((lo, hi))
    return out


def _complement(ranges):
    out = []
    nxt = 0
    for lo, hi in _merge(ranges):
        if lo > nxt:
            out.append((nxt, lo - 1))
        nxt = hi + 1
    if nxt <= _MAX:
        out.append((nxt, _MAX))
    return out


def _prop_ranges(name):
    cats = _load_categories()
    names = _PROPS[name].split() if name in _PROPS else [name]
    out = []
    for n in names:
        out.extend(cats.get(n, []))
    return _merge(out)


def _esc(cp):
    return "\\U%08x" % cp


def _class(ranges, negated):
    if not ranges:
        return "(?s:.)" if negated else "(?!)"
    body = "".join(_esc(lo) if lo == hi else _esc(lo) + "-" + _esc(hi) for lo, hi in ranges)
    return "[" + ("^" if negated else "") + body + "]"


class _Invalid(Exception):
    pass


class _Parser:
    def __init__(self, s):
        self.s = s
        self.i = 0
        self.n = len(s)

    def peek(self):
        return self.s[self.i] if self.i < self.n else ""

    def alt(self, in_group):
        branches = [self.branch()]
        while self.peek() == "|":
            self.i += 1
            branches.append(self.branch())
        if in_group:
            if self.peek() != ")":
                raise _Invalid
        elif self.i != self.n:
            raise _Invalid
        return "|".join(branches)

    def branch(self):
        parts = []
        while self.i < self.n and self.s[self.i] not in "|)":
            parts.append(self.piece())
        return "".join(parts)

    def piece(self):
        atom = self.atom()
        c = self.peek()
        if c in ("*", "+", "?") and c != "":
            self.i += 1
            return atom + c
        if c == "{":
            self.i += 1
            n = self.digits()
            m = n
            comma = False
            if self.peek() == ",":
                comma = True
                self.i += 1
                m = self.digits(optional=True)
            if self.peek() != "}":
                raise _Invalid
            self.i += 1
            if m is not None and n > m:
                raise _Invalid
            if not comma:
                return "%s{%d}" % (atom, n)
            return "%s{%d,%s}" % (atom, n, "" if m is None else m)
        return atom

    def digits(self, optional=False):
        j = self.i
        while self.i < self.n and "0" <= self.s[self.i] <= "9":
            self.i += 1
        if j == self.i:
            if optional:
                return None
            raise _Invalid
        return int(self.s[j:self.i])

    def atom(self):
        c = self.s[self.i]
        if c == "(":
            self.i += 1
            inner = self.alt(True)
            self.i += 1
            return "(?:" + inner + ")"
        if c == ".":
            self.i += 1
            return "[^\\n\\r]"
        if c == "\\":
            r = self.escape()
            if isinstance(r, str):
                return _esc(ord(r))
            return _class(*r)
        if c == "[":
            return self.charclass()
        if c in ".\\?*+{}()[]|":
            raise _Invalid
        self.i += 1
        return _esc(ord(c))

    def escape(self):
        """At a backslash: returns a char (SingleCharEsc) or (ranges, negated) for \\p / \\P."""
        self.i += 1
        c = self.peek()
        if c == "":
            raise _Invalid
        if c in _SINGLE_ESC:
            self.i += 1
            return _SINGLE_ESC[c]
        if c in "pP":
            self.i += 1
            if self.peek() != "{":
                raise _Invalid
            j = self.s.find("}", self.i)
            if j < 0:
                raise _Invalid
            name = self.s[self.i + 1:j]
            if name not in _VALID_PROPS:
                raise _Invalid
            self.i = j + 1
            return (_prop_ranges(name), c == "P")
        raise _Invalid

    def cchar(self):
        c = self.peek()
        if c == "":
            raise _Invalid
        if c == "\\":
            r = self.escape()
            if not isinstance(r, str):
                raise _Invalid
            return ord(r)
        if c in "-[]":
            raise _Invalid
        self.i += 1
        return ord(c)

    def charclass(self):
        self.i += 1
        negated = False
        if self.peek() == "^":
            negated = True
            self.i += 1
        ranges = []
        count = 0
        if self.peek() == "-":
            self.i += 1
            ranges.append((45, 45))
            count += 1
        while True:
            c = self.peek()
            if c == "":
                raise _Invalid
            if c == "]":
                self.i += 1
                break
            if c == "-":
                self.i += 1
                if self.peek() != "]":
                    raise _Invalid
                ranges.append((45, 45))
                count += 1
                continue
            if c == "\\" and self.s[self.i + 1:self.i + 2] in ("p", "P"):
                r, neg = self.escape()
                ranges.extend(_complement(r) if neg else r)
                count += 1
                continue
            lo = self.cchar()
            count += 1
            if self.peek() == "-" and self.s[self.i + 1:self.i + 2] not in ("]", ""):
                self.i += 1
                hi = self.cchar()
                if lo > hi:
                    raise _Invalid
                ranges.append((lo, hi))
            else:
                ranges.append((lo, lo))
        if count == 0:
            raise _Invalid
        return _class(_merge(ranges), negated)


_cache = {}


def compile_iregexp(pattern):
    """Return a compiled `re` pattern, or None when the I-Regexp is invalid."""
    if pattern in _cache:
        return _cache[pattern]
    try:
        translated = _Parser(pattern).alt(False)
        result = re.compile(translated)
    except (_Invalid, re.error, OverflowError, RecursionError, MemoryError):
        result = None
    _cache[pattern] = result
    return result


def i_match(s, pattern):
    rx = compile_iregexp(pattern)
    return rx is not None and rx.fullmatch(s) is not None


def i_search(s, pattern):
    rx = compile_iregexp(pattern)
    return rx is not None and rx.search(s) is not None
