"""JSONPath (RFC 9535): parser, validator and evaluator."""
from decimal import Decimal

from iregexp import i_match

MAX_INT = 2 ** 53 - 1
NOTHING = object()


class QueryError(Exception):
    pass


# ---------------------------------------------------------------- parsing

# function name -> (parameter types, result type); V=ValueType L=LogicalType N=NodesType
FUNCTIONS = {
    "length": ("V", "V"), "count": ("N", "V"), "value": ("N", "V"),
    "match": ("VV", "L"), "search": ("VV", "L"),
}
_WS = " \t\n\r"
_DIGITS = "0123456789"
_ESCAPES = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "/": "/", "\\": "\\"}
_HEX = "0123456789abcdefABCDEF"


def _is_surrogate(ch):
    return 0xD800 <= ord(ch) <= 0xDFFF


class Parser:
    def __init__(self, text):
        self.s = text
        self.i = 0
        self.n = len(text)

    def fail(self, msg="syntax error"):
        raise QueryError("%s at %d" % (msg, self.i))

    def peek(self, k=0):
        j = self.i + k
        return self.s[j] if j < self.n else ""

    def ws(self):
        while self.i < self.n and self.s[self.i] in _WS:
            self.i += 1

    def eat(self, lit):
        if self.s.startswith(lit, self.i):
            self.i += len(lit)
            return True
        return False

    # -- query
    def parse(self):
        if self.peek() != "$":
            self.fail("query must start with $")
        self.i += 1
        segs = self.segments()
        if self.i != self.n:
            self.fail("trailing input")
        return ("$", segs)

    def segments(self):
        segs = []
        while True:
            save = self.i
            self.ws()
            c = self.peek()
            if c == "." or c == "[":
                segs.append(self.segment())
            else:
                self.i = save
                return segs

    def segment(self):
        if self.eat(".."):
            c = self.peek()
            if c == "[":
                return (True, self.bracketed())
            if c == "*":
                self.i += 1
                return (True, [("wild",)])
            return (True, [("name", self.shorthand())])
        self.i += 1  # the dot or bracket
        if self.s[self.i - 1] == "[":
            self.i -= 1
            return (False, self.bracketed())
        if self.peek() == "*":
            self.i += 1
            return (False, [("wild",)])
        return (False, [("name", self.shorthand())])

    def shorthand(self):
        j = self.i
        while self.i < self.n:
            c = self.s[self.i]
            o = ord(c)
            if c.isascii():
                ok = c.isalpha() or c == "_" or (self.i > j and c in _DIGITS)
            else:
                ok = not _is_surrogate(c)
            if not ok:
                break
            self.i += 1
        if j == self.i:
            self.fail("member name expected")
        return self.s[j:self.i]

    def bracketed(self):
        self.i += 1  # [
        self.ws()
        sels = [self.selector()]
        while True:
            self.ws()
            if self.eat(","):
                self.ws()
                sels.append(self.selector())
            elif self.eat("]"):
                return sels
            else:
                self.fail("expected , or ]")

    def selector(self):
        c = self.peek()
        if c in ("'", '"'):
            return ("name", self.string())
        if c == "*":
            self.i += 1
            return ("wild",)
        if c == "?":
            self.i += 1
            self.ws()
            return ("filter", self.as_logical(self.logical_expr()))
        if c == ":" or c == "-" or c in _DIGITS and c != "":
            start = None
            if c != ":":
                start = self.int_token()
                self.ws()
                if self.peek() != ":":
                    return ("idx", start)
            self.i += 1  # first colon
            self.ws()
            end = step = None
            if self.peek() == "-" or (self.peek() != "" and self.peek() in _DIGITS):
                end = self.int_token()
                self.ws()
            if self.peek() == ":":
                self.i += 1
                self.ws()
                if self.peek() == "-" or (self.peek() != "" and self.peek() in _DIGITS):
                    step = self.int_token()
            return ("slice", start, end, step)
        self.fail("selector expected")

    def int_token(self):
        j = self.i
        if self.peek() == "-":
            self.i += 1
        if self.peek() == "0":
            self.i += 1
            if self.s[j] == "-":
                self.fail("-0 is not an integer")
        elif self.peek() != "" and self.peek() in "123456789":
            while self.peek() != "" and self.peek() in _DIGITS:
                self.i += 1
        else:
            self.fail("integer expected")
        v = int(self.s[j:self.i])
        if abs(v) > MAX_INT:
            self.fail("integer out of range")
        return v

    def string(self):
        q = self.s[self.i]
        self.i += 1
        out = []
        while True:
            if self.i >= self.n:
                self.fail("unterminated string")
            c = self.s[self.i]
            self.i += 1
            if c == q:
                return "".join(out)
            if c == "\\":
                e = self.peek()
                self.i += 1
                if e in _ESCAPES:
                    out.append(_ESCAPES[e])
                elif e == q:
                    out.append(q)
                elif e == "u":
                    out.append(self.unicode_escape())
                else:
                    self.fail("bad escape")
            elif ord(c) < 0x20 or _is_surrogate(c):
                self.fail("bad character in string")
            else:
                out.append(c)

    def hex4(self):
        h = self.s[self.i:self.i + 4]
        if len(h) != 4 or any(x not in _HEX for x in h):
            self.fail("bad \\u escape")
        self.i += 4
        return int(h, 16)

    def unicode_escape(self):
        cp = self.hex4()
        if 0xD800 <= cp <= 0xDBFF:
            if not self.eat("\\u"):
                self.fail("lone high surrogate")
            lo = self.hex4()
            if not 0xDC00 <= lo <= 0xDFFF:
                self.fail("bad low surrogate")
            return chr(0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00))
        if 0xDC00 <= cp <= 0xDFFF:
            self.fail("lone low surrogate")
        return chr(cp)

    # -- filter expressions
    # Raw (untyped) operands are ('lit', v), ('qry', q), ('fn', name, args); logical forms are
    # ('or', [..]), ('and', [..]), ('not', e), ('cmp', op, l, r), ('exists', q).
    def logical_expr(self):
        return self.or_expr()

    def or_expr(self):
        items = [self.and_expr()]
        while True:
            save = self.i
            self.ws()
            if self.eat("||"):
                self.ws()
                items.append(self.and_expr())
            else:
                self.i = save
                break
        if len(items) == 1:
            return items[0]
        return ("or", [self.as_logical(x) for x in items])

    def and_expr(self):
        items = [self.basic_expr()]
        while True:
            save = self.i
            self.ws()
            if self.eat("&&"):
                self.ws()
                items.append(self.basic_expr())
            else:
                self.i = save
                break
        if len(items) == 1:
            return items[0]
        return ("and", [self.as_logical(x) for x in items])

    def basic_expr(self):
        c = self.peek()
        if c == "!":
            self.i += 1
            self.ws()
            if self.peek() == "(":
                return ("not", self.paren())
            return ("not", self.as_logical(self.operand_only()))
        if c == "(":
            return self.paren()
        left = self.operand_only()
        save = self.i
        self.ws()
        op = None
        for cand in ("==", "!=", "<=", ">=", "<", ">"):
            if self.eat(cand):
                op = cand
                break
        if op is None:
            self.i = save
            return left
        self.ws()
        right = self.operand_only()
        return ("cmp", op, self.as_comparable(left), self.as_comparable(right))

    def paren(self):
        self.i += 1
        self.ws()
        inner = self.logical_expr()
        self.ws()
        if not self.eat(")"):
            self.fail("expected )")
        return self.as_logical(inner)

    def operand_only(self):
        """A literal, a query or a function expression."""
        c = self.peek()
        if c in ("'", '"'):
            return ("lit", self.string())
        if c == "-" or (c != "" and c in _DIGITS):
            return ("lit", self.number())
        if c == "@" or c == "$":
            self.i += 1
            return ("qry", (c, self.segments()))
        if c != "" and "a" <= c <= "z":
            j = self.i
            while self.i < self.n and (self.s[self.i] in "abcdefghijklmnopqrstuvwxyz_" + _DIGITS):
                self.i += 1
            name = self.s[j:self.i]
            if self.peek() == "(":
                return self.function(name)
            if name == "true":
                return ("lit", True)
            if name == "false":
                return ("lit", False)
            if name == "null":
                return ("lit", None)
        self.fail("expression expected")

    def number(self):
        j = self.i
        if self.peek() == "-":
            self.i += 1
        if self.peek() == "0":
            self.i += 1
        elif self.peek() != "" and self.peek() in "123456789":
            while self.peek() != "" and self.peek() in _DIGITS:
                self.i += 1
        else:
            self.fail("number expected")
        isint = True
        if self.peek() == "." and self.peek(1) != "" and self.peek(1) in _DIGITS:
            isint = False
            self.i += 1
            while self.peek() != "" and self.peek() in _DIGITS:
                self.i += 1
        if self.peek() in ("e", "E"):
            k = 1
            if self.peek(k) in ("+", "-"):
                k += 1
            if self.peek(k) != "" and self.peek(k) in _DIGITS:
                isint = False
                self.i += k
                while self.peek() != "" and self.peek() in _DIGITS:
                    self.i += 1
        text = self.s[j:self.i]
        try:
            return int(text) if isint else Decimal(text)
        except Exception:
            self.fail("bad number")

    def function(self, name):
        if name not in FUNCTIONS:
            self.fail("unknown function")
        self.i += 1  # (
        self.ws()
        args = []
        if self.peek() != ")":
            args.append(self.logical_expr())
            while True:
                self.ws()
                if self.eat(","):
                    self.ws()
                    args.append(self.logical_expr())
                else:
                    break
        if not self.eat(")"):
            self.fail("expected )")
        params, _ = FUNCTIONS[name]
        if len(args) != len(params):
            self.fail("wrong number of arguments")
        for p, a in zip(params, args):
            if not self.arg_ok(p, a):
                self.fail("ill-typed argument")
        return ("fn", name, args)

    # -- typing
    @staticmethod
    def singular(q):
        for desc, sels in q[1]:
            if desc or len(sels) != 1 or sels[0][0] not in ("name", "idx"):
                return False
        return True

    def arg_ok(self, p, a):
        k = a[0]
        if p == "V":
            return k == "lit" or (k == "qry" and self.singular(a[1])) or (
                k == "fn" and FUNCTIONS[a[1]][1] == "V")
        if p == "N":
            return k == "qry"
        # LogicalType
        if k == "lit":
            return False
        if k == "fn":
            return FUNCTIONS[a[1]][1] in ("L", "N")
        return True

    def as_logical(self, x):
        k = x[0]
        if k == "qry":
            return ("exists", x[1])
        if k == "fn" and FUNCTIONS[x[1]][1] == "L":
            return x
        if k in ("lit", "fn"):
            self.fail("not a logical expression")
        return x

    def as_comparable(self, x):
        k = x[0]
        if k == "lit" or (k == "qry" and self.singular(x[1])) or (
                k == "fn" and FUNCTIONS[x[1]][1] == "V"):
            return x
        self.fail("not comparable")


def parse_query(text):
    return Parser(text).parse()


# ------------------------------------------------------------- evaluation

def _norm_name(name):
    out = []
    for ch in name:
        o = ord(ch)
        if ch == "'":
            out.append("\\'")
        elif ch == "\\":
            out.append("\\\\")
        elif ch in "\b\f\n\r\t":
            out.append({"\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}[ch])
        elif o < 0x20:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    return "['" + "".join(out) + "']"


def _is_num(v):
    t = type(v)
    return t is int or t is Decimal


def deep_eq(a, b):
    if a is NOTHING or b is NOTHING:
        return a is b
    ta, tb = type(a), type(b)
    if _is_num(a) or _is_num(b):
        return _is_num(a) and _is_num(b) and a == b
    if ta is not tb:
        return False
    if ta is list:
        return len(a) == len(b) and all(deep_eq(x, y) for x, y in zip(a, b))
    if ta is dict:
        return len(a) == len(b) and all(k in b and deep_eq(v, b[k]) for k, v in a.items())
    return a == b


def _less(a, b):
    if a is NOTHING or b is NOTHING:
        return False
    if _is_num(a) and _is_num(b):
        return a < b
    if type(a) is str and type(b) is str:
        return a < b
    return False


def _compare(op, a, b):
    if op == "==":
        return deep_eq(a, b)
    if op == "!=":
        return not deep_eq(a, b)
    if op == "<":
        return _less(a, b)
    if op == "<=":
        return _less(a, b) or deep_eq(a, b)
    if op == ">":
        return _less(b, a)
    return _less(b, a) or deep_eq(a, b)


def children(node):
    v, p = node
    if type(v) is list:
        return [(x, "%s[%d]" % (p, i)) for i, x in enumerate(v)]
    if type(v) is dict:
        return [(x, p + _norm_name(k)) for k, x in v.items()]
    return []


def _descend(node):
    stack = [node]
    while stack:
        n = stack.pop()
        yield n
        kids = children(n)
        kids.reverse()
        stack.extend(kids)


def _slice_indices(start, end, step, n):
    if step is None:
        step = 1
    if step == 0:
        return []
    if step > 0:
        s = 0 if start is None else start
        e = n if end is None else end
    else:
        s = n - 1 if start is None else start
        e = -n - 1 if end is None else end
    ns = s if s >= 0 else n + s
    ne = e if e >= 0 else n + e
    if step > 0:
        lower, upper = min(max(ns, 0), n), min(max(ne, 0), n)
        return range(lower, upper, step)
    upper, lower = min(max(ns, -1), n - 1), min(max(ne, -1), n - 1)
    return range(upper, lower, step)


class Evaluator:
    def __init__(self, root_value):
        self.root = (root_value, "$")

    def run(self, q, current):
        nodes = [self.root if q[0] == "$" else current]
        for desc, sels in q[1]:
            out = []
            for n in nodes:
                if desc:
                    for d in _descend(n):
                        self.apply(sels, d, out)
                else:
                    self.apply(sels, n, out)
            nodes = out
        return nodes

    def apply(self, sels, node, out):
        v, p = node
        for sel in sels:
            k = sel[0]
            if k == "name":
                if type(v) is dict and sel[1] in v:
                    out.append((v[sel[1]], p + _norm_name(sel[1])))
            elif k == "idx":
                if type(v) is list:
                    i = sel[1] if sel[1] >= 0 else len(v) + sel[1]
                    if 0 <= i < len(v):
                        out.append((v[i], "%s[%d]" % (p, i)))
            elif k == "wild":
                out.extend(children(node))
            elif k == "slice":
                if type(v) is list:
                    for i in _slice_indices(sel[1], sel[2], sel[3], len(v)):
                        out.append((v[i], "%s[%d]" % (p, i)))
            else:
                for child in children(node):
                    if self.logical(sel[1], child):
                        out.append(child)

    def logical(self, e, cur):
        k = e[0]
        if k == "or":
            return any(self.logical(x, cur) for x in e[1])
        if k == "and":
            return all(self.logical(x, cur) for x in e[1])
        if k == "not":
            return not self.logical(e[1], cur)
        if k == "exists":
            return bool(self.run(e[1], cur))
        if k == "cmp":
            return _compare(e[1], self.value(e[2], cur), self.value(e[3], cur))
        return bool(self.call(e, cur))  # logical function

    def value(self, e, cur):
        k = e[0]
        if k == "lit":
            return e[1]
        if k == "qry":
            nodes = self.run(e[1], cur)
            return nodes[0][0] if len(nodes) == 1 else NOTHING
        return self.call(e, cur)

    def call(self, e, cur):
        name, args = e[1], e[2]
        params = FUNCTIONS[name][0]
        vals = []
        for p, a in zip(params, args):
            if p == "V":
                vals.append(self.value(a, cur))
            elif p == "N":
                vals.append(self.run(a[1], cur))
            else:
                vals.append(self.logical(a, cur))
        if name == "length":
            v = vals[0]
            return len(v) if type(v) in (str, list, dict) else NOTHING
        if name == "count":
            return len(vals[0])
        if name == "value":
            return vals[0][0][0] if len(vals[0]) == 1 else NOTHING
        s, pat = vals
        if type(s) is not str or type(pat) is not str:
            return False
        return i_match(pat, s, name == "match")


def query(text, document):
    """Return (values, paths) for a query text; raises QueryError if it is invalid."""
    q = parse_query(text)
    nodes = Evaluator(document).run(q, None)
    return [n[0] for n in nodes], [n[1] for n in nodes]
