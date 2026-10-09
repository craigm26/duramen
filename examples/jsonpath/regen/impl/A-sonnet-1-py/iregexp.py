"""I-Regexp (RFC 9485): validate a pattern and translate it to a Python `re` pattern."""
import re
import sys
import unicodedata
from functools import lru_cache

_MAXCP = 0x10FFFF
_CATEGORIES = {
    "L": ("Ll", "Lm", "Lo", "Lt", "Lu"), "M": ("Mc", "Me", "Mn"), "N": ("Nd", "Nl", "No"),
    "P": ("Pc", "Pd", "Pe", "Pf", "Pi", "Po", "Ps"), "Z": ("Zl", "Zp", "Zs"),
    "S": ("Sc", "Sk", "Sm", "So"), "C": ("Cc", "Cf", "Cn", "Co"),
}
_VALID_PROPS = set(_CATEGORIES)
for _subs in _CATEGORIES.values():
    _VALID_PROPS.update(_subs)

_ranges_by_cat = None


class RegexError(Exception):
    pass


def _load_ranges():
    """Map each two-letter category to its list of (lo, hi) ranges (scalar values only)."""
    global _ranges_by_cat
    if _ranges_by_cat is None:
        out = {}
        cat = unicodedata.category
        cur, start = None, 0
        for cp in range(_MAXCP + 2):
            c = None if cp > _MAXCP or 0xD800 <= cp <= 0xDFFF else cat(chr(cp))
            if c != cur:
                if cur is not None:
                    out.setdefault(cur, []).append((start, cp - 1))
                cur, start = c, cp
        _ranges_by_cat = out
    return _ranges_by_cat


def _prop_ranges(prop, negate):
    table = _load_ranges()
    subs = _CATEGORIES.get(prop, (prop,))
    got = sorted(r for s in subs for r in table.get(s, []))
    if not negate:
        return got
    out, nxt = [], 0
    for lo, hi in got:
        if lo > nxt:
            out.append((nxt, lo - 1))
        nxt = hi + 1
    if nxt <= _MAXCP:
        out.append((nxt, _MAXCP))
    # drop the surrogate block, which is never a scalar value
    res = []
    for lo, hi in out:
        if hi < 0xD800 or lo > 0xDFFF:
            res.append((lo, hi))
        else:
            if lo < 0xD800:
                res.append((lo, 0xD7FF))
            if hi > 0xDFFF:
                res.append((0xE000, hi))
    return res


def _e(cp):
    return "\\U%08x" % cp


def _rng(ranges):
    return "".join(_e(a) if a == b else _e(a) + "-" + _e(b) for a, b in ranges)


_SINGLE_ESC = {"n": 10, "r": 13, "t": 9}
_SINGLE_ESC_LIT = set("()*+-.?[\\]^{|}")


def _is_scalar(ch):
    return not (0xD800 <= ord(ch) <= 0xDFFF)


class _Parser:
    def __init__(self, s):
        self.s = s
        self.i = 0

    def peek(self):
        return self.s[self.i] if self.i < len(self.s) else ""

    def regexp(self, depth=0):
        branches = [self.branch(depth)]
        while self.peek() == "|":
            self.i += 1
            branches.append(self.branch(depth))
        return "|".join(branches)

    def branch(self, depth):
        out = []
        while self.i < len(self.s) and self.peek() not in ("|", ")" if depth else "|"):
            out.append(self.piece(depth))
        return "".join(out)

    def piece(self, depth):
        atom = self.atom(depth)
        c = self.peek()
        if c in ("*", "+", "?"):
            self.i += 1
            return atom + c
        if c == "{":
            self.i += 1
            lo = self.digits()
            hi = lo
            if self.peek() == ",":
                self.i += 1
                hi = self.digits(optional=True)
            if self.peek() != "}":
                raise RegexError("bad quantifier")
            self.i += 1
            if hi != "" and int(hi) < int(lo):
                raise RegexError("bad range")
            if lo == hi:
                return atom + "{%d}" % int(lo)
            return atom + "{%d,%s}" % (int(lo), "" if hi == "" else int(hi))
        return atom

    def digits(self, optional=False):
        j = self.i
        while self.i < len(self.s) and "0" <= self.s[self.i] <= "9":
            self.i += 1
        if j == self.i and not optional:
            raise RegexError("digits expected")
        return self.s[j:self.i]

    def atom(self, depth):
        c = self.peek()
        if c == "(":
            self.i += 1
            inner = self.regexp(depth + 1)
            if self.peek() != ")":
                raise RegexError("unclosed group")
            self.i += 1
            return "(?:" + inner + ")"
        if c == ".":
            self.i += 1
            return "[^\\n\\r]"
        if c == "[":
            return self.char_class()
        if c == "\\":
            return self.escape_atom()
        if c == "" or not self.normal_char(c):
            raise RegexError("unexpected character")
        self.i += 1
        return _e(ord(c))

    @staticmethod
    def normal_char(c):
        return _is_scalar(c) and c not in "()*+.?[\\]{|}"

    def single_esc(self):
        """At a backslash; return code point of a SingleCharEsc, or None if it is not one."""
        n = self.s[self.i + 1:self.i + 2]
        if n in _SINGLE_ESC:
            self.i += 2
            return _SINGLE_ESC[n]
        if n and n in _SINGLE_ESC_LIT:
            self.i += 2
            return ord(n)
        return None

    def prop_esc(self):
        """At backslash followed by p or P; return ranges."""
        neg = self.s[self.i + 1] == "P"
        if self.s[self.i + 2:self.i + 3] != "{":
            raise RegexError("bad property escape")
        end = self.s.find("}", self.i + 3)
        if end < 0:
            raise RegexError("bad property escape")
        prop = self.s[self.i + 3:end]
        if prop not in _VALID_PROPS:
            raise RegexError("unknown property")
        self.i = end + 1
        return _prop_ranges(prop, neg)

    def escape_atom(self):
        n = self.s[self.i + 1:self.i + 2]
        if n in ("p", "P"):
            return "[" + _rng(self.prop_esc()) + "]"
        cp = self.single_esc()
        if cp is None:
            raise RegexError("bad escape")
        return _e(cp)

    def cc_char(self):
        c = self.peek()
        if c == "\\":
            cp = self.single_esc()
            if cp is None:
                raise RegexError("bad escape")
            return cp
        if c == "" or c in "-[]" or not _is_scalar(c):
            return None
        self.i += 1
        return ord(c)

    def char_class(self):
        self.i += 1
        neg = False
        if self.peek() == "^":
            if self.s[self.i + 1:self.i + 2] == "]":
                raise RegexError("[^] not allowed")
            neg = True
            self.i += 1
        parts = []
        if self.peek() == "-":
            self.i += 1
            parts.append(_e(45))
        while True:
            c = self.peek()
            if c == "]":
                break
            if c == "":
                raise RegexError("unclosed class")
            if c == "-":
                if self.s[self.i + 1:self.i + 2] == "]":
                    self.i += 1
                    parts.append(_e(45))
                    continue
                raise RegexError("misplaced dash")
            if c == "\\" and self.s[self.i + 1:self.i + 2] in ("p", "P"):
                parts.append(_rng(self.prop_esc()))
                continue
            lo = self.cc_char()
            if lo is None:
                raise RegexError("bad class char")
            if self.peek() == "-" and self.s[self.i + 1:self.i + 2] != "]":
                self.i += 1
                hi = self.cc_char()
                if hi is None or hi < lo:
                    raise RegexError("bad range")
                parts.append(_e(lo) + "-" + _e(hi))
            else:
                parts.append(_e(lo))
        self.i += 1
        if not parts:
            raise RegexError("empty class")
        return "[" + ("^" if neg else "") + "".join(parts) + "]"


@lru_cache(maxsize=512)
def compile_iregexp(pattern):
    """Return a compiled Python regex for the I-Regexp, or None if it is not valid."""
    try:
        p = _Parser(pattern)
        body = p.regexp()
        if p.i != len(pattern):
            return None
        return re.compile("(?:" + body + ")")
    except (RegexError, re.error, OverflowError, RecursionError, MemoryError):
        return None
    except Exception:
        return None


def i_match(pattern, text, full):
    rx = compile_iregexp(pattern)
    if rx is None:
        return False
    return (rx.fullmatch(text) if full else rx.search(text)) is not None
