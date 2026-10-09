"""I-Regexp (RFC 9485) checker and matcher.

A pattern is parsed strictly per the RFC's ABNF into a small AST and matched by
propagating sets of string positions (no backtracking, so no catastrophic cases).
"""
import unicodedata

CATEGORIES = {
    "L": "lmotu", "M": "cen", "N": "dlo", "P": "cdefiosp", "Z": "lps",
    "S": "ckmo", "C": "cfno",
}
# Punctuation subcategories per the ABNF: c d e f i o s  (Pc Pd Pe Pf Pi Po Ps)
CATEGORIES["P"] = "cdefios"
SINGLE_ESC = set("()*+-.?[\\]^{|}")
ESC_MAP = {"n": "\n", "r": "\r", "t": "\t"}


class RegexError(Exception):
    pass


def _cat_pred(prop, negate):
    if len(prop) == 1:
        def pred(c):
            return unicodedata.category(c)[0] == prop
    else:
        def pred(c):
            return unicodedata.category(c) == prop
    return (lambda c: not pred(c)) if negate else pred


class _Parser:
    def __init__(self, text):
        self.t = text
        self.i = 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else ""

    def parse(self):
        node = self.regexp()
        if self.i != len(self.t):
            raise RegexError("unexpected character")
        return node

    def regexp(self):
        branches = [self.branch()]
        while self.peek() == "|":
            self.i += 1
            branches.append(self.branch())
        return branches[0] if len(branches) == 1 else ("alt", branches)

    def branch(self):
        pieces = []
        while self.i < len(self.t) and self.peek() not in "|)":
            pieces.append(self.piece())
        return ("seq", pieces)

    def piece(self):
        atom = self.atom()
        c = self.peek()
        if c == "*":
            self.i += 1
            return ("rep", atom, 0, None)
        if c == "+":
            self.i += 1
            return ("rep", atom, 1, None)
        if c == "?":
            self.i += 1
            return ("rep", atom, 0, 1)
        if c == "{":
            self.i += 1
            lo = self.number()
            hi = lo
            if self.peek() == ",":
                self.i += 1
                hi = self.number() if self.peek().isascii() and self.peek().isdigit() else None
            if self.peek() != "}":
                raise RegexError("bad quantifier")
            self.i += 1
            if hi is not None and hi < lo:
                raise RegexError("bad quantifier range")
            return ("rep", atom, lo, hi)
        return atom

    def number(self):
        start = self.i
        while self.peek() != "" and self.peek() in "0123456789":
            self.i += 1
        if start == self.i:
            raise RegexError("number expected")
        return int(self.t[start:self.i])

    def atom(self):
        c = self.peek()
        if c == "(":
            self.i += 1
            node = self.regexp()
            if self.peek() != ")":
                raise RegexError("unclosed group")
            self.i += 1
            return ("group", node)
        if c == ".":
            self.i += 1
            return ("set", lambda ch: ch != "\n" and ch != "\r")
        if c == "\\":
            return self.escape_atom()
        if c == "[":
            return self.char_class()
        if c == "" or c in "()*+?[]{|}" or "\ud800" <= c <= "\udfff":
            raise RegexError("unexpected character")
        self.i += 1
        return ("set", lambda ch, c=c: ch == c)

    def single_esc(self):
        # at backslash; returns the character
        self.i += 1
        c = self.peek()
        if c in ESC_MAP:
            self.i += 1
            return ESC_MAP[c]
        if c != "" and c in SINGLE_ESC:
            self.i += 1
            return c
        raise RegexError("bad escape")

    def category_esc(self):
        # at backslash followed by p or P
        negate = self.t[self.i + 1] == "P"
        self.i += 2
        if self.peek() != "{":
            raise RegexError("bad category")
        end = self.t.find("}", self.i)
        if end < 0:
            raise RegexError("bad category")
        prop = self.t[self.i + 1:end]
        self.i = end + 1
        if not prop or prop[0] not in CATEGORIES:
            raise RegexError("bad category")
        if len(prop) > 2 or (len(prop) == 2 and prop[1] not in CATEGORIES[prop[0]]):
            raise RegexError("bad category")
        return _cat_pred(prop, negate)

    def escape_atom(self):
        nxt = self.t[self.i + 1:self.i + 2]
        if nxt in ("p", "P"):
            return ("set", self.category_esc())
        c = self.single_esc()
        return ("set", lambda ch, c=c: ch == c)

    def class_char(self):
        c = self.peek()
        if c == "\\":
            return self.single_esc()
        if c == "" or c in "-[]" or "\ud800" <= c <= "\udfff":
            raise RegexError("bad class character")
        self.i += 1
        return c

    def char_class(self):
        self.i += 1
        negate = False
        if self.peek() == "^":
            negate = True
            self.i += 1
            if self.peek() == "]":
                raise RegexError("[^] not allowed")
        ranges = []
        preds = []
        if self.peek() == "-":
            self.i += 1
            ranges.append(("-", "-"))
        first = not ranges
        while True:
            c = self.peek()
            if c == "":
                raise RegexError("unclosed class")
            if c == "]":
                if first:
                    raise RegexError("empty class")
                self.i += 1
                break
            first = False
            if c == "-":
                if self.t[self.i + 1:self.i + 2] != "]":
                    raise RegexError("misplaced -")
                self.i += 1
                ranges.append(("-", "-"))
                continue
            if c == "\\" and self.t[self.i + 1:self.i + 2] in ("p", "P"):
                preds.append(self.category_esc())
                continue
            lo = self.class_char()
            hi = lo
            if self.peek() == "-" and self.t[self.i + 1:self.i + 2] != "]":
                self.i += 1
                hi = self.class_char()
                if hi < lo:
                    raise RegexError("bad range")
            ranges.append((lo, hi))

        def pred(ch):
            hit = any(lo <= ch <= hi for lo, hi in ranges) or any(p(ch) for p in preds)
            return hit != negate
        return ("set", pred)


def _run(node, s, starts):
    kind = node[0]
    if not starts:
        return starts
    if kind == "set":
        pred, n = node[1], len(s)
        return {i + 1 for i in starts if i < n and pred(s[i])}
    if kind == "seq":
        for sub in node[1]:
            starts = _run(sub, s, starts)
            if not starts:
                break
        return starts
    if kind == "alt":
        out = set()
        for sub in node[1]:
            out |= _run(sub, s, starts)
        return out
    if kind == "group":
        return _run(node[1], s, starts)
    _, sub, lo, hi = node
    cur = starts
    for _ in range(lo):
        nxt = _run(sub, s, cur)
        if nxt == cur or not nxt:
            cur = nxt
            break
        cur = nxt
    acc = set(cur)
    frontier = cur
    count = lo
    while frontier and (hi is None or count < hi):
        frontier = _run(sub, s, frontier) - acc
        acc |= frontier
        count += 1
    return acc


_cache = {}


def compile_regexp(pattern):
    """Return the AST for an I-Regexp, or None if it is not a valid I-Regexp."""
    if pattern in _cache:
        return _cache[pattern]
    try:
        ast = _Parser(pattern).parse()
    except (RegexError, RecursionError):
        ast = None
    _cache[pattern] = ast
    return ast


def matches(pattern, text, whole):
    """True if text matches pattern (whole) or contains a match (not whole).

    Invalid patterns never match.
    """
    ast = compile_regexp(pattern)
    if ast is None:
        return False
    starts = {0} if whole else set(range(len(text) + 1))
    ends = _run(ast, text, starts)
    return len(text) in ends if whole else bool(ends)
