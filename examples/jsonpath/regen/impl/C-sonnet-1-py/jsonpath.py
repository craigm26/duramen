"""JSONPath (RFC 9535): parser, type checker and evaluator."""
import re

import iregexp

MAX_INT = 2 ** 53 - 1
BLANK = " \t\n\r"
HEX = "0123456789abcdefABCDEF"
INT_RE = re.compile(r"0|-?[1-9][0-9]*")
NUM_RE = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")
ESCAPES = {"b": "\b", "t": "\t", "n": "\n", "f": "\f", "r": "\r", "/": "/", "\\": "\\"}
FUNCS = {"length": ("value", 1), "count": ("value", 1), "value": ("value", 1),
         "match": ("logical", 2), "search": ("logical", 2)}
NOTHING = object()


class InvalidQuery(Exception):
    pass


def fail():
    raise InvalidQuery()


def is_name_char(c, first):
    o = ord(c)
    if o == 0x2CB:  # see CHOICES.md C-1
        return False
    if c.isascii():
        return c == "_" or ("a" <= c <= "z") or ("A" <= c <= "Z") or (not first and "0" <= c <= "9")
    return o >= 0x80


class Parser:
    def __init__(self, q):
        self.q = q
        self.n = len(q)

    def peek(self, i):
        return self.q[i] if i < self.n else ""

    def skip(self, i):
        while i < self.n and self.q[i] in BLANK:
            i += 1
        return i

    # -- top level ------------------------------------------------------
    def parse(self):
        if self.peek(0) != "$":
            fail()
        segs, i = self.segments(1)
        if i != self.n:
            fail()
        return ("query", True, segs)

    def segments(self, i):
        segs = []
        while True:
            j = self.skip(i)
            if self.peek(j) in (".", "[") and j < self.n:
                seg, i = self.segment(j)
                segs.append(seg)
            else:
                return segs, i

    def segment(self, i):
        q = self.q
        if q.startswith("..", i):
            i += 2
            c = self.peek(i)
            if c == "[":
                sels, i, _ = self.bracket(i)
                return ("desc", sels, False), i
            if c == "*":
                return ("desc", [("wild",)], False), i + 1
            name, i = self.shorthand(i)
            return ("desc", [("name", name)], False), i
        if q[i] == ".":
            i += 1
            if self.peek(i) == "*":
                return ("child", [("wild",)], False), i + 1
            name, i = self.shorthand(i)
            return ("child", [("name", name)], True), i
        sels, i, tight = self.bracket(i)
        single = len(sels) == 1 and sels[0][0] in ("name", "index")
        return ("child", sels, tight and single), i

    def shorthand(self, i):
        if i >= self.n or not is_name_char(self.q[i], True):
            fail()
        j = i + 1
        while j < self.n and is_name_char(self.q[j], False):
            j += 1
        return self.q[i:j], j

    # -- bracketed selection -------------------------------------------
    def bracket(self, i):
        i += 1
        tight = self.peek(i) not in BLANK or self.peek(i) == ""
        i = self.skip(i)
        sels = []
        while True:
            sel, i = self.selector(i)
            sels.append(sel)
            j = self.skip(i)
            if j != i:
                tight = False
            c = self.peek(j)
            if c == ",":
                tight = False
                i = self.skip(j + 1)
            elif c == "]":
                return sels, j + 1, tight
            else:
                fail()

    def integer(self, i):
        m = INT_RE.match(self.q, i)
        if not m:
            return None, i
        v = int(m.group())
        if abs(v) > MAX_INT:
            fail()
        return v, m.end()

    def selector(self, i):
        c = self.peek(i)
        if c in ("'", '"') and c:
            s, i = self.string(i)
            return ("name", s), i
        if c == "*":
            return ("wild",), i + 1
        if c == "?":
            e, i = self.parse_or(self.skip(i + 1))
            return ("filter", e), i
        start, i = self.integer(i)
        j = self.skip(i)
        if self.peek(j) != ":":
            if start is None:
                fail()
            return ("index", start), i
        parts = [start]
        i = j
        while len(parts) < 3 and self.peek(i) == ":":
            i = self.skip(i + 1)
            v, i = self.integer(i)
            parts.append(v)
            i = self.skip(i)
        while len(parts) < 3:
            parts.append(None)
        return ("slice", parts[0], parts[1], parts[2]), i

    def string(self, i):
        q = self.q
        quote = q[i]
        i += 1
        out = []
        while True:
            if i >= self.n:
                fail()
            c = q[i]
            if c == quote:
                return "".join(out), i + 1
            if ord(c) < 0x20:
                fail()
            if c != "\\":
                out.append(c)
                i += 1
                continue
            e = self.peek(i + 1)
            if e == "":
                fail()
            if e in ESCAPES:
                out.append(ESCAPES[e])
                i += 2
            elif e == quote:
                out.append(e)
                i += 2
            elif e == "u":
                cp, i = self.hex4(i + 2)
                if 0xD800 <= cp <= 0xDBFF:
                    if not (self.peek(i) == "\\" and self.peek(i + 1) == "u"):
                        fail()
                    lo, i = self.hex4(i + 2)
                    if not 0xDC00 <= lo <= 0xDFFF:
                        fail()
                    cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00)
                elif 0xDC00 <= cp <= 0xDFFF:
                    fail()
                out.append(chr(cp))
            else:
                fail()

    def hex4(self, i):
        h = self.q[i:i + 4]
        if len(h) != 4 or any(c not in HEX for c in h):
            fail()
        return int(h, 16), i + 4

    # -- filters --------------------------------------------------------
    def parse_or(self, i):
        parts = []
        e, i = self.parse_and(i)
        parts.append(e)
        while True:
            j = self.skip(i)
            if self.q.startswith("||", j):
                e, i = self.parse_and(self.skip(j + 2))
                parts.append(e)
            else:
                return (parts[0] if len(parts) == 1 else ("or", parts)), i

    def parse_and(self, i):
        parts = []
        e, i = self.parse_basic(i)
        parts.append(e)
        while True:
            j = self.skip(i)
            if self.q.startswith("&&", j):
                e, i = self.parse_basic(self.skip(j + 2))
                parts.append(e)
            else:
                return (parts[0] if len(parts) == 1 else ("and", parts)), i

    def paren(self, i):
        e, j = self.parse_or(self.skip(i + 1))
        j = self.skip(j)
        if self.peek(j) != ")":
            fail()
        return e, j + 1

    def as_test(self, term):
        if term[0] == "query" or (term[0] == "func" and FUNCS[term[1]][0] == "logical"):
            return ("test", term)
        fail()

    def parse_basic(self, i):
        c = self.peek(i)
        if c == "!":
            j = self.skip(i + 1)
            if self.peek(j) == "(":
                e, j = self.paren(j)
                return ("not", e), j
            term, j = self.term(j)
            return ("not", self.as_test(term)), j
        if c == "(":
            return self.paren(i)
        left, i = self.term(i)
        j = self.skip(i)
        op = None
        for cand in ("==", "!=", "<=", ">=", "<", ">"):
            if self.q.startswith(cand, j):
                op = cand
                break
        if op is None:
            return self.as_test(left), i
        right, i = self.term(self.skip(j + len(op)))
        self.check_comparable(left)
        self.check_comparable(right)
        return ("cmp", op, left, right), i

    def check_comparable(self, t):
        if t[0] == "lit":
            return
        if t[0] == "query" and self.singular(t):
            return
        if t[0] == "func" and FUNCS[t[1]][0] == "value":
            return
        fail()

    @staticmethod
    def singular(t):
        return t[0] == "query" and all(s[2] for s in t[2])

    def term(self, i):
        c = self.peek(i)
        if c in ("@", "$") and c:
            segs, i = self.segments(i + 1)
            return ("query", c == "$", segs), i
        if c in ("'", '"') and c:
            s, i = self.string(i)
            return ("lit", s), i
        if c == "-" or (c != "" and c in "0123456789"):
            m = NUM_RE.match(self.q, i)
            if not m:
                fail()
            return ("lit", float(m.group())), m.end()
        if c != "" and "a" <= c <= "z":
            j = i + 1
            while j < self.n and (("a" <= self.q[j] <= "z") or ("0" <= self.q[j] <= "9") or self.q[j] == "_"):
                j += 1
            name = self.q[i:j]
            if self.peek(j) == "(":
                return self.function(name, j + 1)
            if name == "true":
                return ("lit", True), j
            if name == "false":
                return ("lit", False), j
            if name == "null":
                return ("lit", None), j
        fail()

    def function(self, name, i):
        if name not in FUNCS:
            fail()
        args = []
        i = self.skip(i)
        if self.peek(i) != ")":
            while True:
                a, i = self.term(i)
                args.append(a)
                i = self.skip(i)
                if self.peek(i) == ",":
                    i = self.skip(i + 1)
                else:
                    break
        if self.peek(i) != ")":
            fail()
        if len(args) != FUNCS[name][1]:
            fail()
        for k, a in enumerate(args):
            if name in ("count", "value"):
                ok = a[0] == "query"
            else:
                ok = a[0] == "lit" or self.singular(a) or (a[0] == "func" and FUNCS[a[1]][0] == "value")
            if not ok:
                fail()
        return ("func", name, args), i + 1


def parse(q):
    return Parser(q).parse()


# -- evaluation ---------------------------------------------------------
def kind(v):
    if v is None:
        return "null"
    if v is True or v is False:
        return "bool"
    if isinstance(v, (int, float)):
        return "num"
    if isinstance(v, str):
        return "str"
    return "list" if isinstance(v, list) else "dict"


def fnum(v):
    try:
        return float(v)
    except OverflowError:
        return float("inf") if v > 0 else float("-inf")


def deep_eq(a, b):
    ka = kind(a)
    if ka != kind(b):
        return False
    if ka == "num":
        return fnum(a) == fnum(b)
    if ka == "list":
        return len(a) == len(b) and all(deep_eq(x, y) for x, y in zip(a, b))
    if ka == "dict":
        return a.keys() == b.keys() and all(deep_eq(a[k], b[k]) for k in a)
    return a == b


def less(a, b):
    ka = kind(a)
    if ka != kind(b) or ka not in ("num", "str"):
        return False
    return fnum(a) < fnum(b) if ka == "num" else a < b


def compare(op, a, b):
    if a is NOTHING or b is NOTHING:
        eq = a is b
        lt = False
    else:
        eq = deep_eq(a, b)
        lt = less(a, b)
    if op == "==":
        return eq
    if op == "!=":
        return not eq
    if op == "<":
        return lt
    if op == "<=":
        return lt or eq
    gt = False if (a is NOTHING or b is NOTHING) else less(b, a)
    return gt if op == ">" else (gt or eq)


def children(value, path):
    if isinstance(value, list):
        return [(v, path + (i,)) for i, v in enumerate(value)]
    if isinstance(value, dict):
        return [(value[k], path + (k,)) for k in sorted(value)]
    return []


def select(sel, node, root):
    value, path = node
    k = sel[0]
    if k == "name":
        if isinstance(value, dict) and sel[1] in value:
            return [(value[sel[1]], path + (sel[1],))]
        return []
    if k == "wild":
        return children(value, path)
    if k == "index":
        if isinstance(value, list):
            i = sel[1] + len(value) if sel[1] < 0 else sel[1]
            if 0 <= i < len(value):
                return [(value[i], path + (i,))]
        return []
    if k == "slice":
        if not isinstance(value, list):
            return []
        return [(value[i], path + (i,)) for i in slice_indices(sel[1], sel[2], sel[3], len(value))]
    return [c for c in children(value, path) if truth(sel[1], c, root)]


def slice_indices(start, end, step, n):
    step = 1 if step is None else step
    if step == 0:
        return []
    if step > 0:
        s = 0 if start is None else start
        e = n if end is None else end
        s = s + n if s < 0 else s
        e = e + n if e < 0 else e
        lo, hi = min(max(s, 0), n), min(max(e, 0), n)
        return range(lo, hi, step)
    s = n - 1 if start is None else start
    e = -n - 1 if end is None else end
    s = s + n if s < 0 else s
    e = e + n if e < 0 else e
    up, lo = min(max(s, -1), n - 1), min(max(e, -1), n - 1)
    return range(up, lo, step)


def descend(node):
    yield node
    for c in children(*node):
        yield from descend(c)


def apply_segment(seg, nodes, root):
    out = []
    for node in nodes:
        targets = descend(node) if seg[0] == "desc" else (node,)
        for t in targets:
            for sel in seg[1]:
                out.extend(select(sel, t, root))
    return out


def run_query(q, cur, root):
    nodes = [root if q[1] else cur]
    for seg in q[2]:
        if not nodes:
            break
        nodes = apply_segment(seg, nodes, root)
    return nodes


def call(name, args, cur, root):
    if name in ("count", "value"):
        nodes = run_query(args[0], cur, root)
        if name == "count":
            return len(nodes)
        return nodes[0][0] if len(nodes) == 1 else NOTHING
    vals = [operand(a, cur, root) for a in args]
    if name == "length":
        v = vals[0]
        if isinstance(v, (str, list, dict)):
            return len(v)
        return NOTHING
    a, b = vals
    if not (isinstance(a, str) and isinstance(b, str)):
        return False
    return iregexp.match(a, b) if name == "match" else iregexp.search(a, b)


def operand(t, cur, root):
    if t[0] == "lit":
        return t[1]
    if t[0] == "query":
        nodes = run_query(t, cur, root)
        return nodes[0][0] if nodes else NOTHING
    return call(t[1], t[2], cur, root)


def truth(e, cur, root):
    k = e[0]
    if k == "or":
        return any(truth(p, cur, root) for p in e[1])
    if k == "and":
        return all(truth(p, cur, root) for p in e[1])
    if k == "not":
        return not truth(e[1], cur, root)
    if k == "cmp":
        return compare(e[1], operand(e[2], cur, root), operand(e[3], cur, root))
    t = e[1]
    if t[0] == "query":
        return bool(run_query(t, cur, root))
    return call(t[1], t[2], cur, root)


def quote_name(name):
    out = []
    for c in name:
        o = ord(c)
        if c == "'":
            out.append("\\'")
        elif c == "\\":
            out.append("\\\\")
        elif c in "\b\t\n\f\r":
            out.append({"\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r"}[c])
        elif o < 0x20:
            out.append("\\u%04x" % o)
        else:
            out.append(c)
    return "'" + "".join(out) + "'"


def render_path(path):
    return "$" + "".join("[%d]" % p if isinstance(p, int) else "[" + quote_name(p) + "]" for p in path)


def query(q, document):
    """Return (values, paths). Raises InvalidQuery."""
    ast = parse(q)
    root = (document, ())
    nodes = run_query(ast, root, root)
    return [n[0] for n in nodes], [render_path(n[1]) for n in nodes]
