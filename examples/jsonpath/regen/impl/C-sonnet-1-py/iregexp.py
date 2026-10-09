"""I-Regexp (RFC 9485): parser and backtracking matcher over code points."""
import sys
import unicodedata

sys.setrecursionlimit(20000)

CATEGORIES = {
    "L", "Lu", "Ll", "Lt", "Lm", "Lo", "M", "Mn", "Mc", "Me", "N", "Nd", "Nl", "No",
    "P", "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po", "Z", "Zs", "Zl", "Zp",
    "S", "Sm", "Sc", "Sk", "So", "C", "Cc", "Cf", "Co", "Cn",
}
SINGLE_ESC = set("()*+-.?[\\]^{|}") | {"n", "r", "t"}
ESC_VALUE = {"n": "\n", "r": "\r", "t": "\t"}
NORMAL_EXCLUDED = set("()*+.?[\\]{|}")
DIGITS = "0123456789"


class Invalid(Exception):
    pass


def _surrogate(c):
    return 0xD800 <= ord(c) <= 0xDFFF


def _normal_char(c):
    return c not in NORMAL_EXCLUDED and not _surrogate(c)


def _cc_char(c):
    return c not in "-[\\]" and not _surrogate(c)


class _Parser:
    def __init__(self, s):
        self.s = s
        self.i = 0

    def peek(self, off=0):
        j = self.i + off
        return self.s[j] if j < len(self.s) else ""

    def regexp(self):
        branches = [self.branch()]
        while self.peek() == "|":
            self.i += 1
            branches.append(self.branch())
        return ("alt", branches)

    def branch(self):
        pieces = []
        while self.peek() not in ("", "|", ")"):
            pieces.append(self.piece())
        return ("seq", pieces)

    def piece(self):
        atom = self.atom()
        c = self.peek()
        if c == "*":
            lo, hi = 0, None
            self.i += 1
        elif c == "+":
            lo, hi = 1, None
            self.i += 1
        elif c == "?":
            lo, hi = 0, 1
            self.i += 1
        elif c == "{":
            lo, hi = self.range_quant()
        else:
            return atom
        return ("rep", atom, lo, hi)

    def digits(self):
        j = self.i
        while self.peek() != "" and self.peek() in DIGITS:
            self.i += 1
        if j == self.i:
            raise Invalid
        return int(self.s[j:self.i])

    def range_quant(self):
        self.i += 1
        lo = self.digits()
        hi = lo
        if self.peek() == ",":
            self.i += 1
            hi = None if self.peek() == "}" else self.digits()
        if self.peek() != "}":
            raise Invalid
        self.i += 1
        if hi is not None and hi < lo:
            raise Invalid
        return lo, hi

    def prop(self):
        # positioned on p or P, just after the backslash
        neg = self.s[self.i] == "P"
        self.i += 1
        if self.peek() != "{":
            raise Invalid
        end = self.s.find("}", self.i)
        if end < 0:
            raise Invalid
        name = self.s[self.i + 1:end]
        if name not in CATEGORIES:
            raise Invalid
        self.i = end + 1
        return (neg, name)

    def atom(self):
        c = self.peek()
        if c == "(":
            self.i += 1
            inner = self.regexp()
            if self.peek() != ")":
                raise Invalid
            self.i += 1
            return inner
        if c == ".":
            self.i += 1
            return ("set", [], [], False, True)
        if c == "[":
            return self.char_class()
        if c == "\\":
            self.i += 1
            e = self.peek()
            if e in ("p", "P"):
                return ("set", [], [self.prop()], False, False)
            if e == "" or e not in SINGLE_ESC:
                raise Invalid
            self.i += 1
            ch = ESC_VALUE.get(e, e)
            return ("set", [(ch, ch)], [], False, False)
        if c == "" or not _normal_char(c):
            raise Invalid
        self.i += 1
        return ("set", [(c, c)], [], False, False)

    def cc_char(self):
        c = self.peek()
        if c == "\\":
            self.i += 1
            e = self.peek()
            if e == "" or e not in SINGLE_ESC:
                raise Invalid
            self.i += 1
            return ESC_VALUE.get(e, e)
        if c == "" or not _cc_char(c):
            raise Invalid
        self.i += 1
        return c

    def char_class(self):
        self.i += 1
        neg = False
        if self.peek() == "^":
            neg = True
            self.i += 1
        ranges, props = [], []
        count = 0
        if self.peek() == "-":
            self.i += 1
            ranges.append(("-", "-"))
            count += 1
        while True:
            c = self.peek()
            if c == "]":
                break
            if c == "-":
                # only a trailing "-" is allowed here
                if self.peek(1) == "]":
                    self.i += 1
                    ranges.append(("-", "-"))
                    count += 1
                    break
                raise Invalid
            if c == "\\" and self.peek(1) in ("p", "P") and self.peek(1) != "":
                self.i += 1
                props.append(self.prop())
                count += 1
                continue
            a = self.cc_char()
            if self.peek() == "-" and self.peek(1) != "]":
                self.i += 1
                b = self.cc_char()
                if b < a:
                    raise Invalid
                ranges.append((a, b))
            else:
                ranges.append((a, a))
            count += 1
        if self.peek() != "]" or count == 0:
            raise Invalid
        self.i += 1
        return ("set", ranges, props, neg, False)


def _in_set(node, ch):
    _, ranges, props, neg, dot = node
    if dot:
        return ch != "\n" and ch != "\r"
    hit = False
    for a, b in ranges:
        if a <= ch <= b:
            hit = True
            break
    if not hit and props:
        cat = unicodedata.category(ch)
        for pneg, name in props:
            if cat.startswith(name) != pneg:
                hit = True
                break
    return hit != neg


def _compile(node):
    kind = node[0]
    if kind == "set":
        def m(s, i, k):
            return i < len(s) and _in_set(node, s[i]) and k(i + 1)
        return m
    if kind == "seq":
        parts = [_compile(p) for p in node[1]]

        def m(s, i, k):
            def go(n, j):
                if n == len(parts):
                    return k(j)
                return parts[n](s, j, lambda j2: go(n + 1, j2))
            return go(0, i)
        return m
    if kind == "alt":
        branches = [_compile(b) for b in node[1]]

        def m(s, i, k):
            return any(b(s, i, k) for b in branches)
        return m
    _, atom, lo, hi = node
    inner = _compile(atom)

    def m(s, i, k):
        def rep(j, count):
            if hi is None or count < hi:
                if inner(s, j, lambda j2: (j2 > j or count < lo) and rep(j2, count + 1)):
                    return True
            return count >= lo and k(j)
        return rep(i, 0)
    return m


_cache = {}


def compile_regexp(pattern):
    """Return a matcher m(s, i, k), or None if pattern is not an I-Regexp."""
    if pattern in _cache:
        return _cache[pattern]
    p = _Parser(pattern)
    try:
        tree = p.regexp()
        if p.i != len(pattern):
            raise Invalid
        result = _compile(tree)
    except Invalid:
        result = None
    _cache[pattern] = result
    return result


def match(s, pattern):
    m = compile_regexp(pattern)
    if m is None:
        return False
    try:
        return bool(m(s, 0, lambda j: j == len(s)))
    except RecursionError:
        return False


def search(s, pattern):
    m = compile_regexp(pattern)
    if m is None:
        return False
    try:
        return any(m(s, st, lambda j: True) for st in range(len(s) + 1))
    except RecursionError:
        return False
