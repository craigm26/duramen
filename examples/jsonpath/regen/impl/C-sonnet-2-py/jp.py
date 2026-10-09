"""JSONPath (RFC 9535): parser and evaluator."""
import rx

BLANK = " \t\n\r"
MAX_INT = 9007199254740991
NOTHING = object()
LETTERS = "abcdefghijklmnopqrstuvwxyz"
DIGITS = "0123456789"
FUNCS = {  # name: (parameter types, result type)
    "length": (("value",), "value"),
    "count": (("nodes",), "value"),
    "match": (("value", "value"), "logical"),
    "search": (("value", "value"), "logical"),
    "value": (("nodes",), "value"),
}


class QueryError(Exception):
    pass


def _fail(msg="invalid"):
    raise QueryError(msg)


# ---------------------------------------------------------------- parsing

class Parser:
    def __init__(self, text):
        self.s = text
        self.i = 0

    def peek(self, k=0):
        j = self.i + k
        return self.s[j] if j < len(self.s) else ""

    def blanks(self):
        while self.i < len(self.s) and self.s[self.i] in BLANK:
            self.i += 1

    def expect(self, ch):
        if self.peek() != ch:
            _fail()
        self.i += 1

    # -- queries
    def parse_top(self):
        if self.peek() != "$":
            _fail()
        self.i += 1
        segs = self.segments()
        if self.i != len(self.s):
            _fail()
        return ("query", "$", segs)

    def segments(self):
        segs = []
        while True:
            save = self.i
            self.blanks()
            c = self.peek()
            if c == ".":
                segs.append(self.dot_segment())
            elif c == "[":
                segs.append(self.bracket(False))
            else:
                self.i = save
                return segs

    def dot_segment(self):
        self.i += 1
        desc = False
        if self.peek() == ".":
            self.i += 1
            desc = True
            if self.peek() == "[":
                return self.bracket(True)
        c = self.peek()
        if c == "*":
            self.i += 1
            return (desc, [("wild",)], False)
        name = self.shorthand()
        return (desc, [("name", name)], True)

    def shorthand(self):
        j = self.i
        c = self.peek()
        if not self._name_char(c, True):
            _fail()
        while self._name_char(self.peek(), False):
            self.i += 1
            if self.i >= len(self.s):
                break
        return self.s[j:self.i]

    @staticmethod
    def _name_char(c, first):
        if c == "":
            return False
        o = ord(c)
        if c in LETTERS or c in LETTERS.upper() or c == "_":
            return True
        if not first and c in DIGITS:
            return True
        # U+02CB is rejected on purpose: see CHOICES.md (C-1)
        return o >= 0x80 and not (0xD800 <= o <= 0xDFFF) and o != 0x2CB

    def bracket(self, desc):
        """Parses a bracketed selection; returns (desc, selectors, tight)."""
        self.expect("[")
        padded = self.peek() in BLANK and self.peek() != ""
        self.blanks()
        sels = []
        while True:
            sels.append(self.selector())
            before = self.i
            self.blanks()
            if self.peek() != "" and before != self.i and self.peek() == "]":
                padded = True
            c = self.peek()
            if c == ",":
                self.i += 1
                self.blanks()
                continue
            if c == "]":
                self.i += 1
                break
            _fail()
        tight = (not padded and len(sels) == 1 and sels[0][0] in ("name", "index"))
        return (desc, sels, tight)

    def integer(self):
        j = self.i
        if self.peek() == "-":
            self.i += 1
        c = self.peek()
        if c == "0":
            self.i += 1
            if j != self.i - 1:
                _fail()  # -0
        elif c != "" and c in "123456789":
            while self.peek() != "" and self.peek() in DIGITS:
                self.i += 1
        else:
            _fail()
        v = int(self.s[j:self.i])
        if v > MAX_INT or v < -MAX_INT:
            _fail()
        return v

    def optional_int(self):
        c = self.peek()
        if c != "" and (c == "-" or c in DIGITS):
            return self.integer()
        return None

    def selector(self):
        c = self.peek()
        if c in ("'", '"'):
            return ("name", self.string())
        if c == "*":
            self.i += 1
            return ("wild",)
        if c == "?":
            self.i += 1
            self.blanks()
            expr = self.logical_or()
            self.check_logical(expr)
            return ("filter", expr)
        start = self.optional_int()
        save = self.i
        self.blanks()
        if self.peek() == ":":
            self.i += 1
            self.blanks()
            end = self.optional_int()
            self.blanks()
            step = None
            if self.peek() == ":":
                self.i += 1
                self.blanks()
                step = self.optional_int()
            return ("slice", start, end, step)
        self.i = save
        if start is None:
            _fail()
        return ("index", start)

    def string(self):
        q = self.peek()
        self.i += 1
        out = []
        while True:
            c = self.peek()
            if c == "":
                _fail()
            self.i += 1
            if c == q:
                return "".join(out)
            if ord(c) < 0x20:
                _fail()
            if c != "\\":
                out.append(c)
                continue
            e = self.peek()
            self.i += 1
            simple = {"b": "\b", "t": "\t", "n": "\n", "f": "\f", "r": "\r",
                      "/": "/", "\\": "\\"}
            if e in simple and e != "":
                out.append(simple[e])
            elif e == q:
                out.append(q)
            elif e == "u":
                cp = self.hex4()
                if 0xD800 <= cp <= 0xDBFF:
                    if self.peek() == "\\" and self.peek(1) == "u":
                        self.i += 2
                        lo = self.hex4()
                        if not 0xDC00 <= lo <= 0xDFFF:
                            _fail()
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00)
                    else:
                        _fail()
                elif 0xDC00 <= cp <= 0xDFFF:
                    _fail()
                out.append(chr(cp))
            else:
                _fail()

    def hex4(self):
        h = self.s[self.i:self.i + 4]
        if len(h) != 4 or any(ch not in "0123456789abcdefABCDEF" for ch in h):
            _fail()
        self.i += 4
        return int(h, 16)

    # -- filter expressions
    def logical_or(self):
        parts = [self.logical_and()]
        while True:
            save = self.i
            self.blanks()
            if self.s.startswith("||", self.i):
                self.i += 2
                self.blanks()
                parts.append(self.logical_and())
            else:
                self.i = save
                break
        if len(parts) == 1:
            return parts[0]
        for p in parts:
            self.check_logical(p)
        return ("or", parts)

    def logical_and(self):
        parts = [self.basic()]
        while True:
            save = self.i
            self.blanks()
            if self.s.startswith("&&", self.i):
                self.i += 2
                self.blanks()
                parts.append(self.basic())
            else:
                self.i = save
                break
        if len(parts) == 1:
            return parts[0]
        for p in parts:
            self.check_logical(p)
        return ("and", parts)

    def paren(self):
        self.expect("(")
        self.blanks()
        expr = self.logical_or()
        self.check_logical(expr)
        self.blanks()
        self.expect(")")
        return ("paren", expr)

    def basic(self):
        c = self.peek()
        if c == "!":
            self.i += 1
            self.blanks()
            if self.peek() == "(":
                inner = self.paren()
            else:
                inner = self.item()
                if inner[0] not in ("query", "func"):
                    _fail()
            self.check_logical(inner)
            return ("not", inner)
        if c == "(":
            return self.paren()
        left = self.item()
        save = self.i
        self.blanks()
        op = None
        for cand in ("==", "!=", "<=", ">=", "<", ">"):
            if self.s.startswith(cand, self.i):
                op = cand
                break
        if op is None:
            self.i = save
            return left
        self.i += len(op)
        self.blanks()
        right = self.item()
        self.check_comparable(left)
        self.check_comparable(right)
        return ("cmp", op, left, right)

    def item(self):
        """A literal, a query starting with @ or $, or a function expression."""
        c = self.peek()
        if c in ("@", "$"):
            self.i += 1
            segs = self.segments()
            return ("query", c, segs)
        if c in ("'", '"'):
            return ("lit", self.string())
        if c == "-" or (c != "" and c in DIGITS):
            return ("lit", self.number())
        if c != "" and c in LETTERS:
            j = self.i
            while self.peek() != "" and (self.peek() in LETTERS or self.peek() in DIGITS
                                         or self.peek() == "_"):
                self.i += 1
            name = self.s[j:self.i]
            if self.peek() == "(":
                return self.function(name)
            lits = {"true": True, "false": False, "null": None}
            if name in lits:
                return ("lit", lits[name])
        _fail()

    def number(self):
        j = self.i
        if self.peek() == "-":
            self.i += 1
        c = self.peek()
        if c == "0":
            self.i += 1
        elif c != "" and c in "123456789":
            while self.peek() != "" and self.peek() in DIGITS:
                self.i += 1
        else:
            _fail()
        if self.peek() == ".":
            self.i += 1
            if not (self.peek() != "" and self.peek() in DIGITS):
                _fail()
            while self.peek() != "" and self.peek() in DIGITS:
                self.i += 1
        if self.peek() in ("e", "E"):
            self.i += 1
            if self.peek() in ("+", "-"):
                self.i += 1
            if not (self.peek() != "" and self.peek() in DIGITS):
                _fail()
            while self.peek() != "" and self.peek() in DIGITS:
                self.i += 1
        return float(self.s[j:self.i])

    def function(self, name):
        self.expect("(")
        self.blanks()
        args = []
        if self.peek() != ")":
            while True:
                args.append(self.logical_or())
                self.blanks()
                if self.peek() == ",":
                    self.i += 1
                    self.blanks()
                    continue
                break
        self.expect(")")
        if name not in FUNCS:
            _fail()
        ptypes, _ = FUNCS[name]
        if len(args) != len(ptypes):
            _fail()
        for a, t in zip(args, ptypes):
            if t == "value":
                ok = (a[0] == "lit" or (a[0] == "query" and self.singular(a))
                      or (a[0] == "func" and FUNCS[a[1]][1] == "value"))
            else:
                ok = a[0] == "query"
            if not ok:
                _fail()
        return ("func", name, args)

    # -- type checks
    @staticmethod
    def singular(q):
        return all(not d and tight for d, _sels, tight in q[2])

    def check_logical(self, node):
        k = node[0]
        if k in ("or", "and", "not", "paren", "cmp", "query"):
            return
        if k == "func" and FUNCS[node[1]][1] == "logical":
            return
        _fail()

    def check_comparable(self, node):
        k = node[0]
        if k == "lit":
            return
        if k == "query" and self.singular(node):
            return
        if k == "func" and FUNCS[node[1]][1] == "value":
            return
        _fail()


def parse(text):
    return Parser(text).parse_top()


# ------------------------------------------------------------- evaluation

def _children(value):
    if isinstance(value, list):
        return list(enumerate(value))
    if isinstance(value, dict):
        return sorted(value.items())
    return []


def _name_path(name):
    out = []
    for ch in name:
        o = ord(ch)
        if ch == "'":
            out.append("\\'")
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\b":
            out.append("\\b")
        elif ch == "\t":
            out.append("\\t")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\f":
            out.append("\\f")
        elif ch == "\r":
            out.append("\\r")
        elif o < 0x20:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    return "['" + "".join(out) + "']"


def _slice_indexes(start, end, step, n):
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
    if s < 0:
        s += n
    if e < 0:
        e += n
    if step > 0:
        lo = min(max(s, 0), n)
        hi = min(max(e, 0), n)
        return range(lo, hi, step)
    hi = min(max(s, -1), n - 1)
    lo = min(max(e, -1), n - 1)
    return range(hi, lo, step)


def _apply_selector(sel, node, root, out):
    value, path = node
    kind = sel[0]
    if kind == "name":
        if isinstance(value, dict) and sel[1] in value:
            out.append((value[sel[1]], path + _name_path(sel[1])))
    elif kind == "wild":
        _emit_children(value, path, out)
    elif kind == "index":
        if isinstance(value, list):
            i = sel[1]
            if i < 0:
                i += len(value)
            if 0 <= i < len(value):
                out.append((value[i], "%s[%d]" % (path, i)))
    elif kind == "slice":
        if isinstance(value, list):
            for i in _slice_indexes(sel[1], sel[2], sel[3], len(value)):
                out.append((value[i], "%s[%d]" % (path, i)))
    elif kind == "filter":
        for key, child in _children(value):
            cpath = ("%s[%d]" % (path, key)) if isinstance(key, int) else path + _name_path(key)
            if _truth(sel[1], (child, cpath), root):
                out.append((child, cpath))


def _emit_children(value, path, out):
    for key, child in _children(value):
        cpath = ("%s[%d]" % (path, key)) if isinstance(key, int) else path + _name_path(key)
        out.append((child, cpath))


def _descend(node, out):
    out.append(node)
    value, path = node
    for key, child in _children(value):
        cpath = ("%s[%d]" % (path, key)) if isinstance(key, int) else path + _name_path(key)
        _descend((child, cpath), out)


def run_segments(segs, nodes, root):
    for desc, sels, _tight in segs:
        nxt = []
        for node in nodes:
            targets = []
            if desc:
                _descend(node, targets)
            else:
                targets = [node]
            for t in targets:
                for sel in sels:
                    _apply_selector(sel, t, root, nxt)
        nodes = nxt
        if not nodes:
            break
    return nodes


def eval_query(q, current, root):
    start = root if q[1] == "$" else current
    return run_segments(q[2], [start], root)


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def json_eq(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if _is_num(a):
        return _is_num(b) and a == b
    if isinstance(a, str):
        return isinstance(b, str) and a == b
    if a is None:
        return b is None
    if isinstance(a, list):
        return (isinstance(b, list) and len(a) == len(b)
                and all(json_eq(x, y) for x, y in zip(a, b)))
    if isinstance(a, dict):
        return (isinstance(b, dict) and len(a) == len(b)
                and all(k in b and json_eq(v, b[k]) for k, v in a.items()))
    return False


def _eq(a, b):
    if a is NOTHING or b is NOTHING:
        return a is b
    return json_eq(a, b)


def _lt(a, b):
    if a is NOTHING or b is NOTHING:
        return False
    if _is_num(a) and _is_num(b):
        return a < b
    if isinstance(a, str) and isinstance(b, str):
        return a < b
    return False


def _compare(op, a, b):
    if op == "==":
        return _eq(a, b)
    if op == "!=":
        return not _eq(a, b)
    if op == "<":
        return _lt(a, b)
    if op == "<=":
        return _lt(a, b) or _eq(a, b)
    if op == ">":
        return _lt(b, a)
    return _lt(b, a) or _eq(a, b)


def _value_of(node, cur, root):
    k = node[0]
    if k == "lit":
        return node[1]
    if k == "query":
        res = eval_query(node, cur, root)
        return res[0][0] if len(res) == 1 else NOTHING
    return _call(node, cur, root)


def _call(node, cur, root):
    name, args = node[1], node[2]
    if name == "count":
        return len(eval_query(args[0], cur, root))
    if name == "value":
        res = eval_query(args[0], cur, root)
        return res[0][0] if len(res) == 1 else NOTHING
    vals = [_value_of(a, cur, root) for a in args]
    if name == "length":
        v = vals[0]
        if isinstance(v, (str, list, dict)):
            return len(v)
        return NOTHING
    a, b = vals
    if not isinstance(a, str) or not isinstance(b, str):
        return False
    return rx.match(b, a) if name == "match" else rx.search(b, a)


def _truth(expr, cur, root):
    k = expr[0]
    if k == "or":
        return any(_truth(p, cur, root) for p in expr[1])
    if k == "and":
        return all(_truth(p, cur, root) for p in expr[1])
    if k == "not":
        return not _truth(expr[1], cur, root)
    if k == "paren":
        return _truth(expr[1], cur, root)
    if k == "cmp":
        return _compare(expr[1], _value_of(expr[2], cur, root),
                        _value_of(expr[3], cur, root))
    if k == "query":
        return bool(eval_query(expr, cur, root))
    return _call(expr, cur, root)


def query(text, document):
    tree = parse(text)
    nodes = run_segments(tree[2], [(document, "$")], (document, "$"))
    return [n[0] for n in nodes], [n[1] for n in nodes]
