"""I-Regexp (RFC 9485) parser and matcher working on sets of positions."""
import unicodedata

CATEGORIES = {
    "L", "Lu", "Ll", "Lt", "Lm", "Lo", "M", "Mn", "Mc", "Me", "N", "Nd", "Nl", "No",
    "P", "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po", "Z", "Zs", "Zl", "Zp",
    "S", "Sm", "Sc", "Sk", "So", "C", "Cc", "Cf", "Co", "Cn",
}
NOT_NORMAL = set("()*+.?[\\]{|}")
SINGLE_ESC = {"n": "\n", "r": "\r", "t": "\t"}
for _c in "()*+-.?[\\]^{|}":
    SINGLE_ESC[_c] = _c


class RegexError(Exception):
    pass


def _is_surrogate(c):
    return 0xD800 <= ord(c) <= 0xDFFF


class _Parser:
    def __init__(self, s):
        self.s = s
        self.i = 0

    def peek(self):
        return self.s[self.i] if self.i < len(self.s) else ""

    def parse(self):
        node = self.alt()
        if self.i != len(self.s):
            raise RegexError("trailing")
        return node

    def alt(self):
        branches = [self.branch()]
        while self.peek() == "|":
            self.i += 1
            branches.append(self.branch())
        return ("alt", branches)

    def branch(self):
        pieces = []
        while self.i < len(self.s) and self.peek() not in "|)":
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
            return self.range_quant(atom)
        return atom

    def digits(self):
        j = self.i
        while self.i < len(self.s) and self.s[self.i] in "0123456789":
            self.i += 1
        if j == self.i:
            raise RegexError("digits")
        return int(self.s[j:self.i])

    def range_quant(self, atom):
        self.i += 1
        lo = self.digits()
        hi = lo
        if self.peek() == ",":
            self.i += 1
            hi = None if self.peek() == "}" else self.digits()
        if self.peek() != "}":
            raise RegexError("quantifier")
        self.i += 1
        if hi is not None and lo > hi:
            raise RegexError("bounds")
        return ("rep", atom, lo, hi)

    def atom(self):
        c = self.peek()
        if c == "":
            raise RegexError("eof")
        if c == "(":
            self.i += 1
            node = self.alt()
            if self.peek() != ")":
                raise RegexError("paren")
            self.i += 1
            return node
        if c == ".":
            self.i += 1
            return ("any",)
        if c == "[":
            return self.char_class()
        if c == "\\":
            esc = self.escape()
            if esc[0] == "cat":
                return ("set", [], [esc[1:]], False)
            return ("char", esc[1])
        if c in NOT_NORMAL or _is_surrogate(c):
            raise RegexError("char")
        self.i += 1
        return ("char", c)

    def escape(self):
        """At a backslash: returns ('char', c) or ('cat', name, negated)."""
        self.i += 1
        c = self.peek()
        if c in ("p", "P"):
            self.i += 1
            if self.peek() != "{":
                raise RegexError("prop")
            j = self.s.find("}", self.i)
            if j < 0:
                raise RegexError("prop")
            name = self.s[self.i + 1:j]
            if name not in CATEGORIES:
                raise RegexError("category")
            self.i = j + 1
            return ("cat", name, c == "P")
        if c != "" and c in SINGLE_ESC:
            self.i += 1
            return ("char", SINGLE_ESC[c])
        raise RegexError("escape")

    def cc_char(self):
        c = self.peek()
        if c == "":
            raise RegexError("eof")
        if c == "\\":
            esc = self.escape()
            if esc[0] != "char":
                raise RegexError("range endpoint")
            return esc[1]
        if c in "-[]" or _is_surrogate(c):
            raise RegexError("ccchar")
        self.i += 1
        return c

    def char_class(self):
        self.i += 1
        negated = False
        if self.peek() == "^":
            negated = True
            self.i += 1
        ranges = []
        cats = []
        first = True
        while True:
            c = self.peek()
            if c == "":
                raise RegexError("unterminated")
            if c == "]":
                if first:
                    raise RegexError("empty class")
                self.i += 1
                break
            if c == "-":
                nxt = self.s[self.i + 1] if self.i + 1 < len(self.s) else ""
                if first or nxt == "]":
                    ranges.append(("-", "-"))
                    self.i += 1
                    first = False
                    continue
                raise RegexError("dash")
            first = False
            if c == "\\" and self.s[self.i + 1:self.i + 2] in ("p", "P"):
                esc = self.escape()
                cats.append(esc[1:])
                continue
            lo = self.cc_char()
            if self.peek() == "-" and self.s[self.i + 1:self.i + 2] != "]":
                self.i += 1
                hi = self.cc_char()
                if lo > hi:
                    raise RegexError("range order")
                ranges.append((lo, hi))
            else:
                ranges.append((lo, lo))
        return ("set", ranges, cats, negated)


def _in_cat(ch, name):
    cat = unicodedata.category(ch)
    return cat == name or (len(name) == 1 and cat[0] == name)


def _set_matches(node, ch):
    _, ranges, cats, negated = node
    hit = any(lo <= ch <= hi for lo, hi in ranges)
    if not hit:
        for name, neg in cats:
            if _in_cat(ch, name) != neg:
                hit = True
                break
    return hit != negated


def _run(node, text, positions):
    kind = node[0]
    n = len(text)
    if kind == "char":
        c = node[1]
        return {p + 1 for p in positions if p < n and text[p] == c}
    if kind == "any":
        return {p + 1 for p in positions if p < n and text[p] not in "\n\r"}
    if kind == "set":
        return {p + 1 for p in positions if p < n and _set_matches(node, text[p])}
    if kind == "seq":
        cur = positions
        for sub in node[1]:
            if not cur:
                break
            cur = _run(sub, text, cur)
        return cur
    if kind == "alt":
        out = set()
        for sub in node[1]:
            out |= _run(sub, text, positions)
        return out
    if kind == "rep":
        _, sub, lo, hi = node
        cur = positions
        for _ in range(lo):
            nxt = _run(sub, text, cur)
            if nxt == cur or not nxt:
                cur = nxt
                break
            cur = nxt
        result = set(cur)
        frontier = cur
        count = lo
        while frontier and (hi is None or count < hi):
            nxt = _run(sub, text, frontier) - result
            result |= nxt
            frontier = nxt
            count += 1
        return result
    raise RegexError("node")


_cache = {}


def compile_regex(pattern):
    """Returns the parsed pattern, or None when it is not an I-Regexp."""
    if pattern in _cache:
        return _cache[pattern]
    try:
        tree = _Parser(pattern).parse()
    except (RegexError, RecursionError):
        tree = None
    _cache[pattern] = tree
    return tree


def match(pattern, text):
    tree = compile_regex(pattern)
    if tree is None:
        return False
    return len(text) in _run(tree, text, {0})


def search(pattern, text):
    tree = compile_regex(pattern)
    if tree is None:
        return False
    return bool(_run(tree, text, set(range(len(text) + 1))))
