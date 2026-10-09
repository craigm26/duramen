"""JSONPath (RFC 9535): parser, validator and evaluator."""
import re
from decimal import Decimal, InvalidOperation

import iregexp

MAX_INT = 2 ** 53 - 1
WS = " \t\n\r"
NOTHING = object()

# name -> (parameter types, result type); V=ValueType, L=LogicalType, N=NodesType
FUNCS = {
    "length": ("V", "V"),
    "count": ("N", "V"),
    "match": ("VV", "L"),
    "search": ("VV", "L"),
    "value": ("N", "V"),
}

NUMBER_RE = re.compile(r"-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?")
INT_RE = re.compile(r"-?(?:0|[1-9][0-9]*)")
HEX = "0123456789abcdefABCDEF"


class QueryError(Exception):
    pass


class Parser:
    def __init__(self, text):
        self.s = text
        self.i = 0

    def fail(self, msg="syntax error"):
        raise QueryError("%s at %d" % (msg, self.i))

    def peek(self, k=0):
        j = self.i + k
        return self.s[j] if j < len(self.s) else ""

    def ws(self):
        while self.i < len(self.s) and self.s[self.i] in WS:
            self.i += 1

    def startswith(self, t):
        return self.s.startswith(t, self.i)

    # ---- segments -------------------------------------------------------
    def query(self):
        """jsonpath-query / rel-query: identifier then segments."""
        root = self.peek()
        if root not in ("$", "@"):
            self.fail("query must start with $")
        self.i += 1
        segs = self.segments()
        singular = all(k == "child" and len(sels) == 1 and sels[0][0] in ("name", "index")
                       for k, sels in segs)
        return (root, segs, singular)

    def segments(self):
        segs = []
        while True:
            save = self.i
            self.ws()
            c = self.peek()
            if c == ".":
                if self.peek(1) == ".":
                    self.i += 2
                    segs.append(("desc", self.segment_body(True)))
                else:
                    self.i += 1
                    segs.append(("child", self.segment_body(False)))
            elif c == "[":
                segs.append(("child", self.bracketed()))
            else:
                self.i = save
                return segs

    def segment_body(self, descendant):
        c = self.peek()
        if c == "[":
            return self.bracketed()
        if c == "*":
            self.i += 1
            return [("wild",)]
        return [("name", self.shorthand())]

    def shorthand(self):
        start = self.i
        while self.i < len(self.s):
            c = self.s[self.i]
            ok = (c.isascii() and (c.isalpha() or c == "_")) or (
                ord(c) >= 0x80 and not 0xD800 <= ord(c) <= 0xDFFF)
            if not ok and self.i > start and c.isascii() and c.isdigit():
                ok = True
            if not ok:
                break
            self.i += 1
        if self.i == start:
            self.fail("member name expected")
        return self.s[start:self.i]

    def bracketed(self):
        self.i += 1
        self.ws()
        sels = [self.selector()]
        while True:
            self.ws()
            c = self.peek()
            if c == ",":
                self.i += 1
                self.ws()
                sels.append(self.selector())
            elif c == "]":
                self.i += 1
                return sels
            else:
                self.fail("',' or ']' expected")

    # ---- selectors ------------------------------------------------------
    def integer(self):
        m = INT_RE.match(self.s, self.i)
        if not m:
            return None
        self.i = m.end()
        v = int(m.group())
        if m.group() == "-0":
            self.fail("-0 is not a valid integer")
        if abs(v) > MAX_INT:
            self.fail("integer out of range")
        return v

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
            return ("filter", self.logical_or())
        start = self.integer()
        self.ws()
        if self.peek() != ":":
            if start is None:
                self.fail("selector expected")
            return ("index", start)
        self.i += 1
        self.ws()
        end = self.integer()
        self.ws()
        step = None
        if self.peek() == ":":
            self.i += 1
            self.ws()
            step = self.integer()
        return ("slice", start, end, step)

    def string(self):
        q = self.s[self.i]
        self.i += 1
        out = []
        while True:
            c = self.peek()
            if c == "":
                self.fail("unterminated string")
            self.i += 1
            if c == q:
                return "".join(out)
            if c == "\\":
                out.append(self.escape(q))
            elif ord(c) < 0x20:
                self.fail("control character in string")
            else:
                out.append(c)

    def hex4(self):
        h = self.s[self.i:self.i + 4]
        if len(h) != 4 or any(ch not in HEX for ch in h):
            self.fail("bad \\u escape")
        self.i += 4
        return int(h, 16)

    def escape(self, q):
        c = self.peek()
        self.i += 1
        simple = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t",
                  "/": "/", "\\": "\\"}
        if c in simple and c != "":
            return simple[c]
        if c == q:
            return c
        if c != "u":
            self.fail("bad escape")
        cp = self.hex4()
        if 0xD800 <= cp <= 0xDBFF:
            if not self.startswith("\\u"):
                self.fail("lone high surrogate")
            self.i += 2
            lo = self.hex4()
            if not 0xDC00 <= lo <= 0xDFFF:
                self.fail("bad low surrogate")
            return chr(0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00))
        if 0xDC00 <= cp <= 0xDFFF:
            self.fail("lone low surrogate")
        return chr(cp)

    # ---- filter expressions --------------------------------------------
    def logical_or(self):
        parts = [self.logical_and()]
        while True:
            save = self.i
            self.ws()
            if self.startswith("||"):
                self.i += 2
                self.ws()
                parts.append(self.logical_and())
            else:
                self.i = save
                return parts[0] if len(parts) == 1 else ("or", parts)

    def logical_and(self):
        parts = [self.basic()]
        while True:
            save = self.i
            self.ws()
            if self.startswith("&&"):
                self.i += 2
                self.ws()
                parts.append(self.basic())
            else:
                self.i = save
                return parts[0] if len(parts) == 1 else ("and", parts)

    def paren(self):
        self.i += 1
        self.ws()
        inner = self.logical_or()
        self.ws()
        if self.peek() != ")":
            self.fail("')' expected")
        self.i += 1
        return ("group", inner)

    def basic(self):
        c = self.peek()
        if c == "!":
            self.i += 1
            self.ws()
            if self.peek() == "(":
                return ("not", self.paren())
            op = self.operand()
            return ("not", self.as_test(op))
        if c == "(":
            return self.paren()
        left = self.operand()
        save = self.i
        self.ws()
        cmp_op = None
        for o in ("==", "!=", "<=", ">=", "<", ">"):
            if self.startswith(o):
                cmp_op = o
                break
        if cmp_op is None:
            self.i = save
            return self.as_test(left)
        self.i += len(cmp_op)
        self.ws()
        right = self.operand()
        self.check_comparable(left)
        self.check_comparable(right)
        return ("cmp", cmp_op, left, right)

    def as_test(self, op):
        if op[0] == "q":
            return ("test", op[1])
        if op[0] == "func" and FUNCS[op[1]][1] in "LN":
            return op
        self.fail("not a valid test expression")

    def check_comparable(self, op):
        if op[0] == "lit":
            return
        if op[0] == "q" and op[1][2]:
            return
        if op[0] == "func" and FUNCS[op[1]][1] == "V":
            return
        self.fail("operand not comparable")

    def operand(self):
        c = self.peek()
        if c in ("@", "$"):
            return ("q", self.query())
        if c in ("'", '"'):
            return ("lit", self.string())
        if c == "-" or (c.isascii() and c.isdigit() and c != ""):
            m = NUMBER_RE.match(self.s, self.i)
            if not m:
                self.fail("bad number")
            self.i = m.end()
            if m.group(1) is None and m.group(2) is None:
                return ("lit", int(m.group()))
            try:
                return ("lit", Decimal(m.group()))
            except InvalidOperation:
                self.fail("bad number")
        if c != "" and "a" <= c <= "z":
            start = self.i
            while self.i < len(self.s) and (
                    "a" <= self.s[self.i] <= "z" or self.s[self.i] == "_"
                    or "0" <= self.s[self.i] <= "9"):
                self.i += 1
            name = self.s[start:self.i]
            if self.peek() == "(":
                return self.function(name)
            if name == "true":
                return ("lit", True)
            if name == "false":
                return ("lit", False)
            if name == "null":
                return ("lit", None)
        self.fail("operand expected")

    def function(self, name):
        if name not in FUNCS:
            self.fail("unknown function")
        params = FUNCS[name][0]
        self.i += 1
        self.ws()
        args = []
        if self.peek() != ")":
            args.append(self.argument())
            while True:
                self.ws()
                if self.peek() == ",":
                    self.i += 1
                    self.ws()
                    args.append(self.argument())
                else:
                    break
        self.ws()
        if self.peek() != ")":
            self.fail("')' expected")
        self.i += 1
        if len(args) != len(params):
            self.fail("wrong number of arguments")
        for p, a in zip(params, args):
            self.check_arg(p, a)
        return ("func", name, args)

    def argument(self):
        c = self.peek()
        starts_operand = (c in ("@", "$", "'", '"', "-") or (c != "" and (
            c.isascii() and (c.isdigit() or "a" <= c <= "z"))))
        if starts_operand:
            save = self.i
            op = self.operand()
            self.ws()
            if self.peek() in (",", ")"):
                return op
            self.i = save
        return ("logic", self.logical_or())

    def check_arg(self, ptype, arg):
        kind = arg[0]
        if ptype == "V":
            ok = (kind == "lit" or (kind == "q" and arg[1][2])
                  or (kind == "func" and FUNCS[arg[1]][1] == "V"))
        elif ptype == "N":
            ok = kind == "q" or (kind == "func" and FUNCS[arg[1]][1] == "N")
        else:
            ok = kind in ("q", "logic") or (kind == "func" and FUNCS[arg[1]][1] in "LN")
        if not ok:
            self.fail("ill-typed argument")


def parse(text):
    """Parse and validate a query; returns the list of segments."""
    if any(0xD800 <= ord(ch) <= 0xDFFF for ch in text):
        raise QueryError("query is not valid Unicode")
    p = Parser(text)
    try:
        if p.peek() != "$":
            p.fail("query must start with $")
        _, segs, _ = p.query()
        if p.i != len(text):
            p.fail("unexpected trailing characters")
    except RecursionError:
        raise QueryError("query too deeply nested")
    return segs


# ---- evaluation -----------------------------------------------------------

def kind(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, Decimal)):
        return "num"
    if isinstance(v, str):
        return "str"
    return "arr" if isinstance(v, list) else "obj"


def equal(a, b):
    if a is NOTHING or b is NOTHING:
        return a is b
    k = kind(a)
    if k != kind(b):
        return False
    if k in ("null",):
        return True
    if k == "arr":
        return len(a) == len(b) and all(equal(x, y) for x, y in zip(a, b))
    if k == "obj":
        return a.keys() == b.keys() and all(equal(a[n], b[n]) for n in a)
    return a == b


def less(a, b):
    if a is NOTHING or b is NOTHING:
        return False
    ka = kind(a)
    return ka == kind(b) and ka in ("num", "str") and a < b


def compare(op, a, b):
    if op == "==":
        return equal(a, b)
    if op == "!=":
        return not equal(a, b)
    if op == "<":
        return less(a, b)
    if op == ">":
        return less(b, a)
    if op == "<=":
        return less(a, b) or equal(a, b)
    return less(b, a) or equal(a, b)


def children(value):
    if isinstance(value, list):
        return list(enumerate(value))
    if isinstance(value, dict):
        return list(value.items())
    return []


def slice_indices(start, end, step, n):
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


def apply_selector(sel, key, value, root):
    """Yield (child key, child value) pairs selected from one node's value."""
    k = sel[0]
    if k == "name":
        if isinstance(value, dict) and sel[1] in value:
            yield sel[1], value[sel[1]]
    elif k == "index":
        if isinstance(value, list):
            i = sel[1] + len(value) if sel[1] < 0 else sel[1]
            if 0 <= i < len(value):
                yield i, value[i]
    elif k == "wild":
        yield from children(value)
    elif k == "slice":
        if isinstance(value, list):
            for i in slice_indices(sel[1], sel[2], sel[3], len(value)):
                yield i, value[i]
    else:
        for ck, cv in children(value):
            if truth(sel[1], cv, root):
                yield ck, cv


def run_segments(nodes, segs, root):
    for kind_, sels in segs:
        out = []
        for path, value in nodes:
            if kind_ == "child":
                visit = [(path, value)]
            else:
                visit = []
                stack = [(path, value)]
                while stack:
                    p, v = stack.pop()
                    visit.append((p, v))
                    stack.extend((p + (ck,), cv) for ck, cv in reversed(children(v)))
            for p, v in visit:
                for sel in sels:
                    for ck, cv in apply_selector(sel, None, v, root):
                        out.append((p + (ck,), cv))
        nodes = out
    return nodes


def run_query(q, cur, root):
    start = root if q[0] == "$" else cur
    return run_segments([((), start)], q[1], root)


def operand_value(op, cur, root):
    k = op[0]
    if k == "lit":
        return op[1]
    if k == "q":
        nodes = run_query(op[1], cur, root)
        return nodes[0][1] if len(nodes) == 1 else NOTHING
    return call(op[1], op[2], cur, root)


def call(name, args, cur, root):
    ptypes = FUNCS[name][0]
    vals = []
    for p, a in zip(ptypes, args):
        if p == "N":
            vals.append(run_query(a[1], cur, root))
        elif p == "V":
            vals.append(operand_value(a, cur, root))
        elif a[0] == "logic":
            vals.append(truth(a[1], cur, root))
        elif a[0] == "q":
            vals.append(bool(run_query(a[1], cur, root)))
        else:
            vals.append(bool(call(a[1], a[2], cur, root)))
    if name == "length":
        v = vals[0]
        return len(v) if isinstance(v, (str, list, dict)) else NOTHING
    if name == "count":
        return len(vals[0])
    if name == "value":
        return vals[0][0][1] if len(vals[0]) == 1 else NOTHING
    a, b = vals
    if not isinstance(a, str) or not isinstance(b, str):
        return False
    return iregexp.matches(b, a, name == "match")


def truth(e, cur, root):
    k = e[0]
    if k == "or":
        return any(truth(x, cur, root) for x in e[1])
    if k == "and":
        return all(truth(x, cur, root) for x in e[1])
    if k == "not":
        return not truth(e[1], cur, root)
    if k == "group":
        return truth(e[1], cur, root)
    if k == "cmp":
        return compare(e[1], operand_value(e[2], cur, root), operand_value(e[3], cur, root))
    if k == "test":
        return bool(run_query(e[1], cur, root))
    return bool(call(e[1], e[2], cur, root))


def normalize(path):
    out = ["$"]
    for key in path:
        if isinstance(key, int):
            out.append("[%d]" % key)
            continue
        esc = []
        for ch in key:
            o = ord(ch)
            if ch == "'":
                esc.append("\\'")
            elif ch == "\\":
                esc.append("\\\\")
            elif ch in "\b\f\n\r\t":
                esc.append({"\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r",
                            "\t": "\\t"}[ch])
            elif o < 0x20:
                esc.append("\\u%04x" % o)
            else:
                esc.append(ch)
        out.append("['%s']" % "".join(esc))
    return "".join(out)


def evaluate(segs, document):
    nodes = run_segments([((), document)], segs, document)
    return [v for _, v in nodes], [normalize(p) for p, _ in nodes]
