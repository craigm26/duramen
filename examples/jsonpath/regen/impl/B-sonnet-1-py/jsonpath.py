"""JSONPath (RFC 9535) parser and evaluator."""
import re
from decimal import Decimal

from iregexp import i_match, i_search

MAX_INT = 2 ** 53 - 1
BLANK = " \t\n\r"
NOTHING = object()
INT_RE = re.compile(r"-?[0-9]+")
NUM_RE = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")
IDENT_RE = re.compile(r"[a-z][a-z0-9_]*")
HEX = set("0123456789abcdefABCDEF")
SIGS = {
    "length": ("V", "V"),
    "count": ("N", "V"),
    "match": ("VV", "L"),
    "search": ("VV", "L"),
    "value": ("N", "V"),
}


class QueryError(Exception):
    pass


def _fail():
    raise QueryError("invalid query")


class Parser:
    def __init__(self, text):
        self.s = text
        self.i = 0
        self.n = len(text)

    def peek(self):
        return self.s[self.i] if self.i < self.n else ""

    def skip_s(self):
        while self.i < self.n and self.s[self.i] in BLANK:
            self.i += 1

    def expect(self, ch):
        if self.peek() != ch:
            _fail()
        self.i += 1

    # ---- query structure -------------------------------------------------
    def parse_query(self):
        self.expect("$")
        segs = self.parse_segments()
        if self.i != self.n:
            _fail()
        return segs

    def parse_segments(self):
        segs = []
        while True:
            save = self.i
            self.skip_s()
            if self.peek() in ("[", ".") and self.i < self.n:
                segs.append(self.parse_segment())
            else:
                self.i = save
                return segs

    def parse_segment(self):
        """Returns (descendant, selectors, single) where single marks a singular segment."""
        if self.peek() == "[":
            sels, simple = self.parse_bracket()
            return (False, sels, simple)
        self.expect(".")
        if self.peek() == ".":
            self.i += 1
            if self.peek() == "[":
                sels, _ = self.parse_bracket()
                return (True, sels, False)
            if self.peek() == "*":
                self.i += 1
                return (True, [("wild",)], False)
            return (True, [("name", self.parse_shorthand())], False)
        if self.peek() == "*":
            self.i += 1
            return (False, [("wild",)], False)
        return (False, [("name", self.parse_shorthand())], True)

    def parse_shorthand(self):
        j = self.i
        while self.i < self.n:
            c = self.s[self.i]
            if c.isascii():
                if not (c.isalpha() or c == "_" or (c.isdigit() and self.i > j)):
                    break
            self.i += 1
        if j == self.i:
            _fail()
        return self.s[j:self.i]

    def parse_bracket(self):
        self.expect("[")
        start = self.i
        self.skip_s()
        lead = self.i > start
        sels = []
        trail = False
        while True:
            sels.append(self.parse_selector())
            end = self.i
            self.skip_s()
            trail = self.i > end
            if self.peek() == ",":
                self.i += 1
                self.skip_s()
                continue
            self.expect("]")
            break
        simple = len(sels) == 1 and not lead and not trail and sels[0][0] in ("name", "idx")
        return sels, simple

    def parse_selector(self):
        c = self.peek()
        if c in ("'", '"'):
            return ("name", self.parse_string())
        if c == "*":
            self.i += 1
            return ("wild",)
        if c == "?":
            self.i += 1
            self.skip_s()
            return ("filter", self.logical(self.parse_or()))
        if c != "" and c in "-:0123456789":
            return self.parse_index_or_slice()
        _fail()

    def parse_int(self):
        m = INT_RE.match(self.s, self.i)
        if not m:
            return None
        tok = m.group()
        if tok != "0" and not re.fullmatch(r"-?[1-9][0-9]*", tok):
            _fail()
        v = int(tok)
        if abs(v) > MAX_INT:
            _fail()
        self.i = m.end()
        return v

    def parse_index_or_slice(self):
        start = self.parse_int()
        after = self.i
        self.skip_s()
        if self.peek() != ":":
            if start is None:
                _fail()
            self.i = after
            return ("idx", start)
        self.i += 1
        self.skip_s()
        end = self.parse_int()
        self.skip_s()
        step = None
        if self.peek() == ":":
            self.i += 1
            self.skip_s()
            step = self.parse_int()
            self.skip_s()
        return ("slice", start, end, step)

    def parse_string(self):
        q = self.s[self.i]
        self.i += 1
        out = []
        while True:
            if self.i >= self.n:
                _fail()
            c = self.s[self.i]
            self.i += 1
            if c == q:
                return "".join(out)
            if c == "\\":
                out.append(self.parse_escape(q))
            elif ord(c) < 0x20:
                _fail()
            else:
                out.append(c)

    def hex4(self):
        h = self.s[self.i:self.i + 4]
        if len(h) != 4 or any(ch not in HEX for ch in h):
            _fail()
        self.i += 4
        return int(h, 16)

    def parse_escape(self, q):
        c = self.peek()
        self.i += 1
        simple = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "/": "/", "\\": "\\"}
        if c == "" :
            _fail()
        if c in simple:
            return simple[c]
        if c == q:
            return c
        if c == "u":
            cp = self.hex4()
            if 0xD800 <= cp <= 0xDBFF:
                if self.s[self.i:self.i + 2] != "\\u":
                    _fail()
                self.i += 2
                lo = self.hex4()
                if not 0xDC00 <= lo <= 0xDFFF:
                    _fail()
                return chr(0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00))
            if 0xDC00 <= cp <= 0xDFFF:
                _fail()
            return chr(cp)
        _fail()

    # ---- filter expressions ----------------------------------------------
    def peek_op(self, ops):
        save = self.i
        self.skip_s()
        for op in ops:
            if self.s.startswith(op, self.i):
                self.i += len(op)
                return op
        self.i = save
        return None

    def parse_or(self):
        ops = [self.parse_and()]
        while self.peek_op(("||",)):
            self.skip_s()
            ops.append(self.parse_and())
        if len(ops) == 1:
            return ops[0]
        return ("or", [self.logical(o) for o in ops])

    def parse_and(self):
        ops = [self.parse_basic()]
        while self.peek_op(("&&",)):
            self.skip_s()
            ops.append(self.parse_basic())
        if len(ops) == 1:
            return ops[0]
        return ("and", [self.logical(o) for o in ops])

    def logical(self, node):
        """Turn a raw primary into a logical node, or reject it."""
        kind = node[0]
        if kind == "lit":
            _fail()
        if kind == "query":
            return ("test", node)
        if kind == "func":
            if SIGS[node[1]][1] == "V":
                _fail()
            return ("test", node)
        return node

    def parse_paren(self):
        self.expect("(")
        self.skip_s()
        inner = self.logical(self.parse_or())
        self.skip_s()
        self.expect(")")
        return inner

    def parse_basic(self):
        c = self.peek()
        if c == "!":
            self.i += 1
            self.skip_s()
            if self.peek() == "(":
                return ("not", self.parse_paren())
            prim = self.parse_primary()
            if prim[0] not in ("query", "func"):
                _fail()
            return ("not", self.logical(prim))
        if c == "(":
            return self.parse_paren()
        left = self.parse_primary()
        op = self.peek_op(("==", "!=", "<=", ">=", "<", ">"))
        if op is None:
            return left
        self.skip_s()
        right = self.parse_primary()
        for side in (left, right):
            if not self.comparable(side):
                _fail()
        return ("cmp", op, left, right)

    @staticmethod
    def comparable(node):
        if node[0] == "lit":
            return True
        if node[0] == "query":
            return node[3]
        return SIGS[node[1]][1] == "V"

    def parse_primary(self):
        c = self.peek()
        if c in ("@", "$") and c != "":
            self.i += 1
            segs = self.parse_segments()
            singular = all(not d and single for d, _, single in segs)
            return ("query", c, segs, singular)
        if c in ("'", '"'):
            return ("lit", self.parse_string())
        if c == "-" or ("0" <= c <= "9" and c != ""):
            m = NUM_RE.match(self.s, self.i)
            if not m:
                _fail()
            self.i = m.end()
            return ("lit", float(m.group()))
        m = IDENT_RE.match(self.s, self.i)
        if not m:
            _fail()
        word = m.group()
        self.i = m.end()
        if self.peek() == "(":
            return self.parse_function(word)
        if word == "true":
            return ("lit", True)
        if word == "false":
            return ("lit", False)
        if word == "null":
            return ("lit", None)
        _fail()

    def parse_function(self, name):
        if name not in SIGS:
            _fail()
        params, _ = SIGS[name]
        self.expect("(")
        self.skip_s()
        args = []
        if self.peek() != ")":
            while True:
                args.append(self.parse_or())
                self.skip_s()
                if self.peek() == ",":
                    self.i += 1
                    self.skip_s()
                    continue
                break
        self.expect(")")
        if len(args) != len(params):
            _fail()
        for p, a in zip(params, args):
            kind = a[0]
            if p == "V":
                ok = kind == "lit" or (kind == "query" and a[3]) or (
                    kind == "func" and SIGS[a[1]][1] == "V")
            else:
                ok = kind == "query"
            if not ok:
                _fail()
        return ("func", name, args)


def parse(text):
    """Parse a query; raises QueryError when it is not well formed and valid."""
    if any(0xD800 <= ord(c) <= 0xDFFF for c in text):
        _fail()
    return Parser(text).parse_query()


# ---- evaluation ----------------------------------------------------------

def children(node):
    value, path = node
    if isinstance(value, list):
        return [(v, (path, i)) for i, v in enumerate(value)]
    if isinstance(value, dict):
        return [(v, (path, k)) for k, v in value.items()]
    return []


def kind(v):
    if v is None:
        return "z"
    if isinstance(v, bool):
        return "b"
    if isinstance(v, (int, float, Decimal)):
        return "n"
    if isinstance(v, str):
        return "s"
    if isinstance(v, list):
        return "a"
    return "o"


def tofloat(x):
    try:
        return float(x)
    except OverflowError:
        return float("inf") if x > 0 else float("-inf")


def equal(a, b):
    if a is NOTHING or b is NOTHING:
        return a is b
    k = kind(a)
    if k != kind(b):
        return False
    if k == "n":
        return tofloat(a) == tofloat(b)
    if k == "z":
        return True
    if k == "a":
        return len(a) == len(b) and all(equal(x, y) for x, y in zip(a, b))
    if k == "o":
        return a.keys() == b.keys() and all(equal(v, b[key]) for key, v in a.items())
    return a == b


def less(a, b):
    if a is NOTHING or b is NOTHING:
        return False
    ka = kind(a)
    if ka != kind(b):
        return False
    if ka == "n":
        return tofloat(a) < tofloat(b)
    if ka == "s":
        return a < b
    return False


def compare(op, a, b):
    if op == "==":
        return equal(a, b)
    if op == "!=":
        return not equal(a, b)
    if op == "<":
        return less(a, b)
    if op == "<=":
        return less(a, b) or equal(a, b)
    if op == ">":
        return less(b, a)
    return less(b, a) or equal(a, b)


def select_slice(length, start, end, step):
    if step is None:
        step = 1
    if step == 0:
        return []
    if step > 0:
        s = 0 if start is None else start
        e = length if end is None else end
        lower = min(max(s if s >= 0 else length + s, 0), length)
        upper = min(max(e if e >= 0 else length + e, 0), length)
        return list(range(lower, upper, step))
    s = length - 1 if start is None else start
    e = -length - 1 if end is None else end
    upper = min(max(s if s >= 0 else length + s, -1), length - 1)
    lower = min(max(e if e >= 0 else length + e, -1), length - 1)
    return list(range(upper, lower, step))


class Evaluator:
    def __init__(self, root_value):
        self.root = (root_value, None)

    def run(self, segs):
        return self.segments(segs, [self.root])

    def segments(self, segs, nodes):
        for desc, sels, _ in segs:
            out = []
            for node in nodes:
                if desc:
                    for d in self.descendants(node):
                        for sel in sels:
                            out.extend(self.select(sel, d))
                else:
                    for sel in sels:
                        out.extend(self.select(sel, node))
            nodes = out
        return nodes

    @staticmethod
    def descendants(node):
        out = []
        stack = [node]
        while stack:
            cur = stack.pop()
            out.append(cur)
            stack.extend(reversed(children(cur)))
        return out

    def select(self, sel, node):
        value, path = node
        k = sel[0]
        if k == "name":
            if isinstance(value, dict) and sel[1] in value:
                return [(value[sel[1]], (path, sel[1]))]
            return []
        if k == "wild":
            return children(node)
        if k == "idx":
            if isinstance(value, list):
                i = sel[1]
                if i < 0:
                    i += len(value)
                if 0 <= i < len(value):
                    return [(value[i], (path, i))]
            return []
        if k == "slice":
            if isinstance(value, list):
                return [(value[i], (path, i)) for i in select_slice(len(value), *sel[1:])]
            return []
        return [c for c in children(node) if self.truth(sel[1], c)]

    def query_nodes(self, q, current):
        return self.segments(q[2], [current if q[1] == "@" else self.root])

    def truth(self, e, cur):
        k = e[0]
        if k == "or":
            return any(self.truth(x, cur) for x in e[1])
        if k == "and":
            return all(self.truth(x, cur) for x in e[1])
        if k == "not":
            return not self.truth(e[1], cur)
        if k == "test":
            t = e[1]
            if t[0] == "query":
                return bool(self.query_nodes(t, cur))
            return self.call(t, cur)
        return compare(e[1], self.value(e[2], cur), self.value(e[3], cur))

    def value(self, e, cur):
        k = e[0]
        if k == "lit":
            return e[1]
        if k == "query":
            nodes = self.query_nodes(e, cur)
            return nodes[0][0] if len(nodes) == 1 else NOTHING
        return self.call(e, cur)

    def call(self, e, cur):
        name, args = e[1], e[2]
        if name in ("count", "value"):
            nodes = self.query_nodes(args[0], cur)
            if name == "count":
                return len(nodes)
            return nodes[0][0] if len(nodes) == 1 else NOTHING
        vals = [self.value(a, cur) for a in args]
        if name == "length":
            v = vals[0]
            if isinstance(v, (str, list, dict)):
                return len(v)
            return NOTHING
        s, r = vals
        if not isinstance(s, str) or not isinstance(r, str):
            return False
        return i_match(s, r) if name == "match" else i_search(s, r)


def path_string(path):
    steps = []
    while path is not None:
        path, step = path
        steps.append(step)
    out = ["$"]
    for step in reversed(steps):
        if isinstance(step, int):
            out.append("[%d]" % step)
        else:
            out.append("['" + "".join(_esc_char(c) for c in step) + "']")
    return "".join(out)


_ESC = {"\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "'": "\\'", "\\": "\\\\"}


def _esc_char(c):
    if c in _ESC:
        return _ESC[c]
    if ord(c) < 0x20:
        return "\\u%04x" % ord(c)
    return c


def query(text, document):
    """Returns (values, paths) for a query string; raises QueryError if invalid."""
    segs = parse(text)
    nodes = Evaluator(document).run(segs)
    return [n[0] for n in nodes], [path_string(n[1]) for n in nodes]
