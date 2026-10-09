"""JSONPath (RFC 9535) query parsing and evaluation, with I-Regexp (RFC 9485) matching."""
import re
import unicodedata

MAX_INT = 2**53 - 1
NOTHING = object()
BLANK = " \t\n\r"
DIGITS = frozenset("0123456789")
INTSTART = frozenset("-0123456789")
INT_RE = re.compile(r"-?(?:0|[1-9][0-9]*)")
NUM_RE = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")
SURROGATE_RE = re.compile("[\ud800-\udfff]")
HEX = frozenset("0123456789abcdefABCDEF")
ESCAPES = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "/": "/", "\\": "\\"}
# name -> (parameter types, result type); V = ValueType, N = NodesType, L = LogicalType
FUNCS = {
    "length": ("V", "V"),
    "count": ("N", "V"),
    "match": ("VV", "L"),
    "search": ("VV", "L"),
    "value": ("N", "V"),
}


class QueryError(Exception):
    pass


class Num:
    """A JSON number: original text is kept for output, binary64 value for comparison."""
    __slots__ = ("text", "f")

    def __init__(self, text):
        self.text = text
        self.f = float(text)


def is_name_first(c):
    return c != "" and (c == "_" or "a" <= c <= "z" or "A" <= c <= "Z" or ord(c) >= 0x80)


def is_name_char(c):
    return is_name_first(c) or c in DIGITS


# ---------------------------------------------------------------- query parser

class Parser:
    def __init__(self, s):
        self.s = s
        self.i = 0
        self.n = len(s)

    def peek(self):
        return self.s[self.i] if self.i < self.n else ""

    def ws(self):
        while self.i < self.n and self.s[self.i] in BLANK:
            self.i += 1

    def eat(self, lit):
        if self.s.startswith(lit, self.i):
            self.i += len(lit)
            return True
        return False

    def expect(self, lit):
        if not self.eat(lit):
            raise QueryError(lit)

    def segments(self):
        segs = []
        singular = True
        while True:
            save = self.i
            self.ws()
            if self.peek() in ("[", "."):
                seg, sing = self.segment()
                segs.append(seg)
                singular = singular and sing
            else:
                self.i = save
                return segs, singular

    def segment(self):
        if self.eat(".."):
            if self.peek() == "[":
                sels, _ = self.bracketed()
            elif self.eat("*"):
                sels = [("wild",)]
            else:
                sels = [("name", self.shorthand())]
            return (True, sels), False
        if self.peek() == "[":
            sels, sing = self.bracketed()
            return (False, sels), sing
        self.expect(".")
        if self.eat("*"):
            return (False, [("wild",)]), False
        return (False, [("name", self.shorthand())]), True

    def shorthand(self):
        if not is_name_first(self.peek()):
            raise QueryError("name")
        start = self.i
        while is_name_char(self.peek()):
            self.i += 1
        return self.s[start:self.i]

    def bracketed(self):
        self.expect("[")
        start = self.i
        self.ws()
        sels = [self.selector()]
        while True:
            self.ws()
            if self.eat(","):
                self.ws()
                sels.append(self.selector())
            else:
                break
        self.expect("]")
        end = self.i - 1
        singular = (len(sels) == 1 and sels[0][0] in ("name", "index")
                    and self.s[start] not in BLANK and self.s[end - 1] not in BLANK)
        return sels, singular

    def selector(self):
        c = self.peek()
        if c == "'" or c == '"':
            return ("name", self.string())
        if c == "*":
            self.i += 1
            return ("wild",)
        if c == "?":
            self.i += 1
            self.ws()
            return ("filter", as_logical(self.parse_or(False)))
        if c == ":" or c in INTSTART:
            return self.index_or_slice()
        raise QueryError("selector")

    def integer(self):
        m = INT_RE.match(self.s, self.i)
        if not m or m.group() == "-0" or len(m.group()) > 25:
            raise QueryError("integer")
        v = int(m.group())
        if abs(v) > MAX_INT:
            raise QueryError("integer range")
        self.i = m.end()
        return v

    def index_or_slice(self):
        start = end = step = None
        if self.peek() in INTSTART:
            start = self.integer()
        save = self.i
        self.ws()
        if self.eat(":"):
            self.ws()
            if self.peek() in INTSTART:
                end = self.integer()
            self.ws()
            if self.eat(":"):
                self.ws()
                if self.peek() in INTSTART:
                    step = self.integer()
            return ("slice", start, end, step)
        self.i = save
        if start is None:
            raise QueryError("selector")
        return ("index", start)

    def string(self):
        q = self.s[self.i]
        self.i += 1
        out = []
        while True:
            if self.i >= self.n:
                raise QueryError("unterminated string")
            c = self.s[self.i]
            self.i += 1
            if c == q:
                return "".join(out)
            if c == "\\":
                e = self.peek()
                self.i += 1
                if e in ESCAPES:
                    out.append(ESCAPES[e])
                elif e == q:
                    out.append(e)
                elif e == "u":
                    cp = self.hex4()
                    if 0xD800 <= cp <= 0xDBFF:
                        if not self.eat("\\u"):
                            raise QueryError("surrogate")
                        lo = self.hex4()
                        if not 0xDC00 <= lo <= 0xDFFF:
                            raise QueryError("surrogate")
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00)
                    elif 0xDC00 <= cp <= 0xDFFF:
                        raise QueryError("surrogate")
                    out.append(chr(cp))
                else:
                    raise QueryError("escape")
            elif ord(c) < 0x20:
                raise QueryError("control character")
            else:
                out.append(c)

    def hex4(self):
        h = self.s[self.i:self.i + 4]
        if len(h) != 4 or any(c not in HEX for c in h):
            raise QueryError("hex")
        self.i += 4
        return int(h, 16)

    # ---- filter expressions

    def parse_or(self, bare):
        ops = [self.parse_and(bare)]
        while True:
            save = self.i
            self.ws()
            if self.eat("||"):
                self.ws()
                ops.append(self.parse_and(False))
            else:
                self.i = save
                break
        if len(ops) == 1:
            return ops[0]
        return ("or", [as_logical(o) for o in ops])

    def parse_and(self, bare):
        ops = [self.parse_basic(bare)]
        while True:
            save = self.i
            self.ws()
            if self.eat("&&"):
                self.ws()
                ops.append(self.parse_basic(False))
            else:
                self.i = save
                break
        if len(ops) == 1:
            return ops[0]
        return ("and", [as_logical(o) for o in ops])

    def paren(self):
        self.expect("(")
        self.ws()
        e = as_logical(self.parse_or(False))
        self.ws()
        self.expect(")")
        return ("paren", e)

    def parse_basic(self, bare):
        c = self.peek()
        if c == "!":
            self.i += 1
            self.ws()
            if self.peek() == "(":
                return ("not", self.paren())
            return ("not", as_logical(self.test_operand()))
        if c == "(":
            return self.paren()
        left = self.primary()
        save = self.i
        self.ws()
        op = None
        for cand in ("==", "!=", "<=", ">=", "<", ">"):
            if self.eat(cand):
                op = cand
                break
        if op is None:
            self.i = save
            if left[0] == "lit" and not bare:
                raise QueryError("bare literal")
            return left
        self.ws()
        right = self.primary()
        if not (comparable(left) and comparable(right)):
            raise QueryError("not comparable")
        return ("cmp", op, left, right)

    def test_operand(self):
        n = self.primary()
        if n[0] == "lit":
            raise QueryError("bare literal")
        return n

    def primary(self):
        c = self.peek()
        if c == "@" or c == "$":
            self.i += 1
            segs, sing = self.segments()
            return ("q", c, segs, sing)
        if c == "'" or c == '"':
            return ("lit", self.string())
        if c == "-" or c in DIGITS:
            m = NUM_RE.match(self.s, self.i)
            if not m:
                raise QueryError("number")
            self.i = m.end()
            return ("lit", Num(m.group()))
        if c != "" and "a" <= c <= "z":
            start = self.i
            while self.peek() != "" and (self.peek() in "abcdefghijklmnopqrstuvwxyz_" or self.peek() in DIGITS):
                self.i += 1
            name = self.s[start:self.i]
            if self.peek() == "(":
                return self.function(name)
            if name in ("true", "false", "null"):
                return ("lit", {"true": True, "false": False, "null": None}[name])
        raise QueryError("operand")

    def function(self, name):
        self.expect("(")
        self.ws()
        args = []
        if not self.eat(")"):
            while True:
                args.append(self.parse_or(True))
                self.ws()
                if self.eat(","):
                    self.ws()
                    continue
                self.expect(")")
                break
        if name not in FUNCS or len(args) != len(FUNCS[name][0]):
            raise QueryError("function")
        for kind, a in zip(FUNCS[name][0], args):
            if kind == "V":
                ok = a[0] == "lit" or (a[0] == "q" and a[3]) or (a[0] == "fn" and FUNCS[a[1]][1] == "V")
            else:
                ok = a[0] == "q"
            if not ok:
                raise QueryError("argument type")
        return ("fn", name, args)


def comparable(n):
    return n[0] == "lit" or (n[0] == "q" and n[3]) or (n[0] == "fn" and FUNCS[n[1]][1] == "V")


def as_logical(n):
    if n[0] == "lit":
        raise QueryError("literal is not logical")
    if n[0] == "q":
        return ("exists", n)
    if n[0] == "fn" and FUNCS[n[1]][1] != "L":
        raise QueryError("function is not logical")
    return n


def parse_query(query):
    if SURROGATE_RE.search(query):
        raise QueryError("surrogate")
    p = Parser(query)
    p.expect("$")
    segs, _ = p.segments()
    if p.i != p.n:
        raise QueryError("trailing text")
    return segs


# ------------------------------------------------------------------ evaluation

def children(node):
    v, p = node
    if type(v) is list:
        return [(x, (p, i)) for i, x in enumerate(v)]
    if type(v) is dict:
        return [(x, (p, k)) for k, x in v.items()]
    return []


def slice_range(start, end, step, n):
    step = 1 if step is None else step
    if step == 0:
        return range(0)

    def norm(i):
        return i if i >= 0 else n + i

    if step > 0:
        s = 0 if start is None else start
        e = n if end is None else end
        return range(min(max(norm(s), 0), n), min(max(norm(e), 0), n), step)
    s = n - 1 if start is None else start
    e = -n - 1 if end is None else end
    return range(min(max(norm(s), -1), n - 1), min(max(norm(e), -1), n - 1), step)


def select(sel, node, root):
    k = sel[0]
    v, p = node
    if k == "name":
        if type(v) is dict and sel[1] in v:
            return [(v[sel[1]], (p, sel[1]))]
        return []
    if k == "wild":
        return children(node)
    if k == "index":
        if type(v) is list:
            i = sel[1] + len(v) if sel[1] < 0 else sel[1]
            if 0 <= i < len(v):
                return [(v[i], (p, i))]
        return []
    if k == "slice":
        if type(v) is list:
            return [(v[i], (p, i)) for i in slice_range(sel[1], sel[2], sel[3], len(v))]
        return []
    return [c for c in children(node) if truth(sel[1], c[0], root)]


def apply_segments(nodes, segs, root):
    for desc, sels in segs:
        out = []
        for node in nodes:
            if desc:
                stack = [node]
                while stack:
                    n = stack.pop()
                    for sel in sels:
                        out.extend(select(sel, n, root))
                    stack.extend(reversed(children(n)))
            else:
                for sel in sels:
                    out.extend(select(sel, node, root))
        nodes = out
        if not nodes:
            break
    return nodes


def run_node_query(q, cur, root):
    return apply_segments([(cur if q[1] == "@" else root, None)], q[2], root)


def eq(a, b):
    if a is NOTHING or b is NOTHING:
        return a is b
    if isinstance(a, Num):
        return isinstance(b, Num) and a.f == b.f
    if a is None or type(a) is bool:
        return a is b
    if type(a) is not type(b):
        return False
    if type(a) is str:
        return a == b
    if type(a) is list:
        return len(a) == len(b) and all(eq(x, y) for x, y in zip(a, b))
    return a.keys() == b.keys() and all(eq(a[k], b[k]) for k in a)


def lt(a, b):
    if isinstance(a, Num) and isinstance(b, Num):
        return a.f < b.f
    return type(a) is str and type(b) is str and a < b


def compare(op, a, b):
    if op == "==":
        return eq(a, b)
    if op == "!=":
        return not eq(a, b)
    if op == "<":
        return lt(a, b)
    if op == ">":
        return lt(b, a)
    if op == "<=":
        return lt(a, b) or eq(a, b)
    return lt(b, a) or eq(a, b)


def truth(e, cur, root):
    k = e[0]
    if k == "and":
        return all(truth(x, cur, root) for x in e[1])
    if k == "or":
        return any(truth(x, cur, root) for x in e[1])
    if k == "not":
        return not truth(e[1], cur, root)
    if k == "paren":
        return truth(e[1], cur, root)
    if k == "exists":
        return bool(run_node_query(e[1], cur, root))
    if k == "cmp":
        return compare(e[1], value(e[2], cur, root), value(e[3], cur, root))
    return call(e, cur, root)  # match / search


def value(e, cur, root):
    k = e[0]
    if k == "lit":
        return e[1]
    if k == "q":
        nodes = run_node_query(e, cur, root)
        return nodes[0][0] if nodes else NOTHING
    return call(e, cur, root)


def call(e, cur, root):
    name, args = e[1], e[2]
    if name == "count":
        return Num(str(len(run_node_query(args[0], cur, root))))
    if name == "value":
        nodes = run_node_query(args[0], cur, root)
        return nodes[0][0] if len(nodes) == 1 else NOTHING
    a = value(args[0], cur, root)
    if name == "length":
        if type(a) in (str, list, dict):
            return Num(str(len(a)))
        return NOTHING
    r = value(args[1], cur, root)
    if type(a) is not str or type(r) is not str:
        return False
    ast = compile_regex(r)
    if ast is None:
        return False
    if name == "match":
        return len(a) in rm(ast, a, 0)
    return any(rm(ast, a, i) for i in range(len(a) + 1))


def path_string(p):
    steps = []
    while p is not None:
        steps.append(p[1])
        p = p[0]
    out = ["$"]
    for st in reversed(steps):
        out.append("[%d]" % st if type(st) is int else "['%s']" % escape_name(st))
    return "".join(out)


ESC_MAP = {"\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "'": "\\'", "\\": "\\\\"}


def escape_name(name):
    out = []
    for c in name:
        if c in ESC_MAP:
            out.append(ESC_MAP[c])
        elif ord(c) < 0x20:
            out.append("\\u%04x" % ord(c))
        else:
            out.append(c)
    return "".join(out)


def evaluate(segs, doc):
    nodes = apply_segments([(doc, None)], segs, doc)
    return [n[0] for n in nodes], [path_string(n[1]) for n in nodes]


# --------------------------------------------------------------------- I-Regexp

PROPS = frozenset(
    "L Ll Lm Lo Lt Lu M Mc Me Mn N Nd Nl No P Pc Pd Pe Pf Pi Po Ps "
    "Z Zl Zp Zs S Sc Sk Sm So C Cc Cf Cn Co".split())
SINGLE_ESC = frozenset("()*+-.?[\\]^{|}")
ESC_CHARS = {"n": "\n", "r": "\r", "t": "\t"}
BIG = 10**30


class RegexParser:
    def __init__(self, t):
        self.t = t
        self.i = 0

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else ""

    def alt(self):
        branches = [self.branch()]
        while self.peek() == "|":
            self.i += 1
            branches.append(self.branch())
        return branches[0] if len(branches) == 1 else ("alt", branches)

    def branch(self):
        pieces = []
        while self.peek() not in ("", "|", ")"):
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
            n = self.number()
            m = n
            if self.peek() == ",":
                self.i += 1
                m = self.number() if self.peek() in DIGITS else None
            if self.peek() != "}":
                raise QueryError("quantifier")
            self.i += 1
            if m is not None and n > m:
                raise QueryError("quantifier order")
            return ("rep", atom, n, m)
        return atom

    def number(self):
        start = self.i
        while self.peek() != "" and self.peek() in DIGITS:
            self.i += 1
        if start == self.i:
            raise QueryError("quantifier")
        d = self.t[start:self.i]
        return int(d) if len(d) <= 30 else BIG

    def atom(self):
        c = self.peek()
        if c == "(":
            self.i += 1
            inner = self.alt()
            if self.peek() != ")":
                raise QueryError("group")
            self.i += 1
            return inner
        if c == "[":
            return self.char_class()
        if c == ".":
            self.i += 1
            return ("any",)
        if c == "\\":
            e = self.escape()
            return ("char", e[1]) if e[0] == "char" else ("cls", False, [], [e[1:]])
        if c in ("?", "*", "+", "{", "}", ")", "]", "|"):
            raise QueryError("atom")
        self.i += 1
        return ("char", c)

    def escape(self):
        self.i += 1
        c = self.peek()
        self.i += 1
        if c in ESC_CHARS:
            return ("char", ESC_CHARS[c])
        if c != "" and c in SINGLE_ESC:
            return ("char", c)
        if c in ("p", "P"):
            end = self.t.find("}", self.i)
            if self.peek() != "{" or end < 0:
                raise QueryError("property")
            name = self.t[self.i + 1:end]
            if name not in PROPS:
                raise QueryError("property")
            self.i = end + 1
            return ("prop", c == "P", name)
        raise QueryError("escape")

    def cc_char(self):
        c = self.peek()
        if c == "\\":
            e = self.escape()
            if e[0] != "char":
                raise QueryError("class range")
            return ord(e[1])
        if c in ("", "-", "[", "]"):
            raise QueryError("class char")
        self.i += 1
        return ord(c)

    def char_class(self):
        self.i += 1
        neg = self.peek() == "^"
        if neg:
            self.i += 1
        ranges, props = [], []
        first = True
        while True:
            c = self.peek()
            if c == "":
                raise QueryError("class")
            if c == "]":
                if first:
                    raise QueryError("empty class")
                self.i += 1
                break
            if c == "-":
                if not first and self.t[self.i + 1:self.i + 2] != "]":
                    raise QueryError("class dash")
                ranges.append((45, 45))
                self.i += 1
                first = False
                continue
            first = False
            if c == "\\" and self.t[self.i + 1:self.i + 2] in ("p", "P"):
                e = self.escape()
                props.append(e[1:])
                continue
            lo = self.cc_char()
            hi = lo
            if self.peek() == "-" and self.t[self.i + 1:self.i + 2] != "]":
                self.i += 1
                hi = self.cc_char()
                if lo > hi:
                    raise QueryError("class range order")
            ranges.append((lo, hi))
        return ("cls", neg, ranges, props)


_regex_cache = {}


def compile_regex(r):
    if r in _regex_cache:
        return _regex_cache[r]
    try:
        p = RegexParser(r)
        ast = p.alt()
        if p.i != len(r):
            raise QueryError("trailing")
    except QueryError:
        ast = None
    _regex_cache[r] = ast
    return ast


def prop_match(c, name):
    cat = unicodedata.category(c)
    return cat == name if len(name) == 2 else cat[0] == name


def rm(node, s, i):
    """Set of end positions of matches of node in s starting at i."""
    k = node[0]
    if k == "seq":
        cur = {i}
        for x in node[1]:
            nxt = set()
            for p in cur:
                nxt |= rm(x, s, p)
            cur = nxt
            if not cur:
                break
        return cur
    if k == "alt":
        res = set()
        for b in node[1]:
            res |= rm(b, s, i)
        return res
    if k == "rep":
        sub, n, m = node[1], node[2], node[3]
        cur = {i}
        res = set(cur) if n == 0 else set()
        step = 0
        while (m is None or step < m) and cur:
            nxt = set()
            for p in cur:
                nxt |= rm(sub, s, p)
            step += 1
            if step >= n:
                res |= nxt
            if nxt == cur:
                if step < n:
                    res |= nxt
                break
            cur = nxt
        return res
    if i >= len(s):
        return set()
    c = s[i]
    if k == "char":
        ok = c == node[1]
    elif k == "any":
        ok = c != "\n" and c != "\r"
    else:
        cp = ord(c)
        hit = any(lo <= cp <= hi for lo, hi in node[2]) or any(
            prop_match(c, name) != negated for negated, name in node[3])
        ok = hit != node[1]
    return {i + 1} if ok else set()
