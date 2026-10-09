"""duramen-core: the checker, suite generator and judge (see SPEC.md)."""
import json
import os
import re
import shutil
import subprocess
import tempfile
from decimal import Decimal

# ---------------------------------------------------------------------------
# Text helpers

_WS = r'\t\n\x0b\x0c\r \xa0  -     　﻿'
WSC = ('\t\n\x0b\x0c\r \xa0 ' + ''.join(chr(c) for c in range(0x2000, 0x200B))
       + '    　﻿')
WS_SET = frozenset(WSC)
RE_WORD = re.compile(r'([^%s]+)[%s]*(.*)' % (_WS, _WS), re.S)
RE_WORDS = re.compile(r'[^%s]+' % _WS)
RE_SPLIT_IDS = re.compile(r'[,%s]+' % _WS)
RE_FROM = re.compile(r'[%s]+from[%s]+("(?:[^"\\]|\\.)*")$' % (_WS, _WS), re.S)
RE_QS = re.compile(r'"(?:[^"\\]|\\.)*"', re.S)
RE_NAME = re.compile(r'[A-Za-z0-9_-]+')
RE_FIELD = re.compile(r'([A-Za-z0-9_-]+)(\?)?[%s]+([^%s].*)$' % (_WS, _WS), re.S)
RE_INDEX = re.compile(r'0|[1-9][0-9]*')
INF = float('inf')


def u16(s):
    return s.encode('utf-16-be', 'surrogatepass')


def first_word(s):
    m = RE_WORD.match(s)
    if not m:
        return '', ''
    return m.group(1), m.group(2)


def split_words(s):
    return RE_WORDS.findall(s)


def is_ws_only(s):
    return all(c in WS_SET for c in s)


# ---------------------------------------------------------------------------
# JSON helpers

class _Big(ValueError):
    pass


def _num(s):
    x = float(s)
    if x == INF or x == -INF:
        raise _Big(s)
    return x


def _const(s):
    raise ValueError(s)


def _lenient(s):
    return float(s)


_STRICT = json.JSONDecoder(parse_float=_num, parse_int=_num, parse_constant=_const)
_LENIENT = json.JSONDecoder(parse_float=_lenient, parse_int=_lenient, parse_constant=_const)


def jparse(s):
    """Parse JSON that must be finite; numbers become floats."""
    try:
        return True, _STRICT.decode(s)
    except (ValueError, RecursionError):
        return False, None


def jparse_lenient(s):
    try:
        return True, _LENIENT.decode(s)
    except (ValueError, RecursionError):
        return False, None


def is_num(v):
    return isinstance(v, float) or (isinstance(v, int) and not isinstance(v, bool))


_ESC = {8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r'}


def js_str(s):
    out = ['"']
    for ch in s:
        o = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == '\\':
            out.append('\\\\')
        elif o < 0x20:
            out.append(_ESC.get(o) or '\\u%04x' % o)
        elif 0xD800 <= o <= 0xDFFF:
            out.append('\\u%04x' % o)
        else:
            out.append(ch)
    out.append('"')
    return ''.join(out)


def js_num(x):
    x = float(x)
    if x == 0:
        return '0'
    if x != x or x == INF or x == -INF:
        return 'null'
    sign = '-' if x < 0 else ''
    t = Decimal(repr(abs(x))).as_tuple()
    digs = ''.join(map(str, t.digits))
    exp = t.exponent
    while len(digs) > 1 and digs.endswith('0'):
        digs = digs[:-1]
        exp += 1
    k = len(digs)
    n = k + exp
    if k <= n <= 21:
        body = digs + '0' * (n - k)
    elif 0 < n <= 21:
        body = digs[:n] + '.' + digs[n:]
    elif -6 < n <= 0:
        body = '0.' + '0' * (-n) + digs
    else:
        e = n - 1
        es = ('+' if e >= 0 else '-') + str(abs(e))
        body = digs + 'e' + es if k == 1 else digs[0] + '.' + digs[1:] + 'e' + es
    return sign + body


def _is_index(k):
    return k.isascii() and k.isdigit() and (k == '0' or k[0] != '0') and int(k) < 4294967295


def es_keys(d):
    idx = [k for k in d if _is_index(k)]
    idx.sort(key=int)
    return idx + [k for k in d if not _is_index(k)]


def js_json(v):
    if v is None:
        return 'null'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, str):
        return js_str(v)
    if isinstance(v, (int, float)):
        return js_num(v)
    if isinstance(v, list):
        return '[' + ','.join(js_json(x) for x in v) + ']'
    return '{' + ','.join(js_str(k) + ':' + js_json(v[k]) for k in es_keys(v)) + '}'


def jeq(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if a is None or b is None:
        return a is None and b is None
    if is_num(a) or is_num(b):
        return is_num(a) and is_num(b) and float(a) == float(b)
    if isinstance(a, str):
        return isinstance(b, str) and a == b
    if isinstance(a, list):
        return isinstance(b, list) and len(a) == len(b) and all(jeq(x, y) for x, y in zip(a, b))
    if isinstance(a, dict):
        return (isinstance(b, dict) and len(a) == len(b)
                and all(k in b and jeq(v, b[k]) for k, v in a.items()))
    return False


def norm(v):
    """Make a value ready for output: integral floats become ints."""
    if isinstance(v, bool) or v is None or isinstance(v, str):
        return v
    if isinstance(v, float):
        if v == int(v) and abs(v) < 1e15:
            return int(v)
        return v
    if isinstance(v, list):
        return [norm(x) for x in v]
    if isinstance(v, dict):
        return {k: norm(x) for k, x in v.items()}
    return v


NONE = object()


def walk(cur, segs):
    for s in segs:
        if isinstance(cur, dict):
            if s in cur:
                cur = cur[s]
            else:
                return NONE
        elif isinstance(cur, list):
            if RE_INDEX.fullmatch(s) and int(s) < len(cur):
                cur = cur[int(s)]
            else:
                return NONE
        else:
            return NONE
    return cur


def read_path(resp, path):
    """The value at a path of a response (REQ-OR-003, REQ-JU-002), or NONE."""
    if not isinstance(resp, dict):
        return NONE
    segs = path.split('.')
    if segs[0] == 'audit' and len(segs) > 1:
        a = resp.get('audit', NONE)
        if not isinstance(a, str):
            return NONE
        ok, v = jparse(a)
        if not ok:
            return NONE
        return walk(v, segs[1:])
    return walk(resp, segs)


# ---------------------------------------------------------------------------
# Reading

STATEMENTS = {'duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open',
              'decision', 'note'}
OTHER_STATEMENTS = {'type', 'edge', 'edgedef', 'property', 'evidence'}
VERSIONS = ('0.1', '0.2')
STATUSES = ('observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected')


class O:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class Line:
    __slots__ = ('no', 'indent', 'text', 'blank')

    def __init__(self, no, indent, text, blank):
        self.no, self.indent, self.text, self.blank = no, indent, text, blank


def split_fields(s):
    parts, cur, depth, inq, i = [], [], 0, False, 0
    while i < len(s):
        ch = s[i]
        if inq:
            cur.append(ch)
            if ch == '\\' and i + 1 < len(s):
                cur.append(s[i + 1])
                i += 2
                continue
            if ch == '"':
                inq = False
        elif ch == '"':
            inq = True
            cur.append(ch)
        elif ch in '([{':
            depth += 1
            cur.append(ch)
        elif ch in ')]}':
            if depth > 0:
                depth -= 1
            cur.append(ch)
        elif ch == ',' and depth == 0:
            parts.append(''.join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    parts.append(''.join(cur))
    return parts


def parse_path(s):
    if s == '':
        return None
    segs, i = [], 0
    while True:
        if i >= len(s):
            return None
        if s[i] == '"':
            m = RE_QS.match(s, i)
            if not m:
                return None
            ok, v = jparse(m.group(0))
            if not ok or not isinstance(v, str):
                return None
            segs.append(v)
        else:
            m = RE_NAME.match(s, i)
            if not m:
                return None
            segs.append(m.group(0))
        i = m.end()
        if i == len(s):
            return segs
        if s[i] != '.':
            return None
        i += 1


def quote_scan_has_obligation(text):
    """True when a line-wise text holds MUST, SHALL or REQUIRED outside quotations."""
    for line in text.split('\n'):
        stripped = RE_QUOTES.sub(' ', line)
        if RE_OBLIGATION.search(stripped):
            return True
    return False


RE_QUOTES = re.compile('"[^"]*"|“[^”]*”|`[^`]*`')
RE_OBLIGATION = re.compile(r'(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])')
PHRASES = ["in this order", "in the order", "first that applies", "first match", "precede",
           "precedes", "preceded", "before", "after", "take precedence", "takes precedence"]
RE_PHRASE = re.compile(
    r'(?a)(?<![A-Za-z0-9_])(?:%s)(?![A-Za-z0-9_])' % '|'.join(
        r'[%s]+' .replace('%s', _WS).join(re.escape(w) for w in p.split(' ')) for p in PHRASES),
    re.I)


class Reader:
    def __init__(self, files, rec_files, rec_folder):
        self.files = files
        self.rec_files = rec_files
        self.rec_folder = rec_folder
        self.diags = []      # (file, line, level, code)
        self.tdiags = []     # checks of a record read without errors
        self.fname = None
        self.spec = None
        self.oracle = None
        self.errors = None
        self.ops = []
        self.reqs = []
        self.opens = []
        self.decisions = []
        self.versions = {}
        self.has_spec = False

    # -- diagnostics
    def d(self, line, code):
        self.diags.append((self.fname, line, 'error', code))

    def t(self, line, code, level='error'):
        self.tdiags.append((self.fname, line, level, code))

    # -- lexing
    def lex(self, text):
        if text.startswith('﻿'):
            text = text[1:]
        lines = []
        for i, raw in enumerate(re.split(r'\r\n|\r|\n', text), 1):
            s = raw.rstrip(WSC)
            if s == '':
                lines.append(Line(i, 0, '', True))
                continue
            k = 0
            while k < len(s) and s[k] in WS_SET:
                k += 1
            if s[:k].strip(' ') != '':
                self.d(i, 'P001')
                continue
            lines.append(Line(i, k, s[k:], False))
        return lines

    def group(self, lines):
        stmts, cur = [], None
        for L in lines:
            if L.blank:
                if cur is not None:
                    cur.body.append(L)
                continue
            if L.indent == 0:
                if L.text.startswith('#'):
                    continue
                kw, rest = first_word(L.text)
                cur = O(kw=kw, line=L.no, rest=rest, body=[], ignored=False)
                stmts.append(cur)
                if kw in OTHER_STATEMENTS:
                    cur.ignored = True
                elif kw not in STATEMENTS:
                    self.d(L.no, 'P002')
                    cur.ignored = True
            elif cur is None:
                self.d(L.no, 'P003')
            elif not cur.ignored:
                cur.body.append(L)
        return stmts

    def clauses(self, st):
        out, cur = [], None
        for L in st.body:
            if L.blank:
                if cur is not None:
                    cur.lines.append(L)
                continue
            if L.indent == 1:
                self.d(L.no, 'P007')
            elif L.indent == 2:
                if L.text.startswith('#'):
                    continue
                kw, rest = first_word(L.text)
                cur = O(kw=kw, rest=rest, line=L.no, lines=[])
                out.append(cur)
            elif cur is None:
                self.d(L.no, 'P006')
            else:
                cur.lines.append(L)
        return out

    # -- clause helpers
    def noline(self, c):
        for L in c.lines:
            if not L.blank and not L.text.startswith('#'):
                self.d(L.no, 'P006')

    def once(self, seen, c):
        if c.kw in seen:
            self.d(c.line, 'P052')
            return False
        seen.add(c.kw)
        return True

    def text_of(self, c):
        if c.rest != '':
            self.d(c.line, 'P008')
        buf = []
        for L in c.lines:
            if L.blank:
                buf.append('')
            elif L.indent == 3:
                self.d(L.no, 'P008')
            else:
                buf.append(' ' * (L.indent - 4) + L.text)
        while buf and buf[-1] == '':
            buf.pop()
        while buf and buf[0] == '':
            buf.pop(0)
        return '\n'.join(buf)

    def quoted(self, s, code='P004'):
        ok, v = jparse(s)
        if ok and isinstance(v, str):
            return v
        self.d(self._cur_line, code)
        return None

    def id_title(self, st):
        rest = st.rest
        if rest == '':
            self.d(st.line, 'P005')
            return '', None
        ident, after = first_word(rest)
        if after == '' or len(after) < 2 or not (after.startswith('"') and after.endswith('"')):
            self.d(st.line, 'P005')
            return ident, None
        ok, v = jparse(after)
        if not ok or not isinstance(v, str):
            self.d(st.line, 'P004')
            return ident, None
        return ident, v

    def request_of(self, c):
        ok, v = jparse(c.rest)
        if not ok or not isinstance(v, dict):
            self.d(c.line, 'P009')
            return None
        if any(k in v for k in ('id', 'op', 'input')):
            self.d(c.line, 'P051')
            return None
        return v

    def scan_must(self, text, line, warn=False):
        if text and quote_scan_has_obligation(text):
            if warn:
                self.t(line, 'T014', 'warning')
            else:
                self.t(line, 'T004')

    # -- files
    def read_all(self):
        for name in self.rec_files:
            self.fname = name
            self.read_file(name, self.files[name])

    def read_file(self, name, text):
        lines = self.lex(text)
        stmts = self.group(lines)
        seen_duramen = False
        version = None
        for st in stmts:
            if st.kw == 'duramen':
                if not seen_duramen:
                    seen_duramen = True
                    if st.rest in VERSIONS:
                        version = st.rest
                    else:
                        self.d(st.line, 'P023')
                else:
                    self.d(st.line, 'P023')
                for c in self.clauses(st):
                    self.d(c.line, 'P015')
            elif st.kw == 'spec':
                self.do_spec(st)
            elif st.kw == 'oracle':
                self.do_oracle(st)
            elif st.kw == 'section':
                self.do_section(st)
            elif st.kw == 'op':
                self.do_op(st)
            elif st.kw == 'errors':
                self.do_errors(st)
            elif st.kw == 'req':
                self.do_req(st)
            elif st.kw == 'open':
                self.do_open(st)
            elif st.kw == 'decision':
                self.do_decision(st)
            elif st.kw == 'note':
                self.do_note(st)
        if not seen_duramen:
            self.d(1, 'P020')
        self.versions[name] = version

    # -- statements
    def do_spec(self, st):
        first = not self.has_spec
        self.has_spec = True
        if not first:
            self.d(st.line, 'P044')
        if len(split_words(st.rest)) != 2:
            self.d(st.line, 'P021')
        info = O(file=self.fname, line=st.line, request={}, text='')
        seen = set()
        for c in self.clauses(st):
            if c.kw in ('title', 'contract', 'request', 'text'):
                if not self.once(seen, c):
                    continue
            if c.kw == 'title':
                self.noline(c)
                self._cur_line = c.line
                self.quoted(c.rest)
            elif c.kw == 'text':
                info.text = self.text_of(c)
            elif c.kw == 'contract':
                self.noline(c)
            elif c.kw == 'request':
                self.noline(c)
                r = self.request_of(c)
                if r is not None:
                    info.request = r
            else:
                self.d(c.line, 'P015')
        if first:
            self.spec = info
            self.scan_must(info.text, st.line)

    def do_oracle(self, st):
        first = self.oracle is None
        if st.rest == '':
            self.d(st.line, 'P028')
        if not first:
            self.d(st.line, 'P044')
        else:
            self.oracle = O(file=self.fname, line=st.line, command=st.rest)
        for c in self.clauses(st):
            if c.kw == 'source':
                self.noline(c)
            else:
                self.d(c.line, 'P015')

    def do_section(self, st):
        self.id_title(st)
        seen = set()
        text = ''
        for c in self.clauses(st):
            if c.kw == 'text':
                if self.once(seen, c):
                    text = self.text_of(c)
            else:
                self.d(c.line, 'P015')
        self.scan_must(text, st.line)

    def do_note(self, st):
        if st.rest != '':
            self.d(st.line, 'P050')
        seen = set()
        text = ''
        for c in self.clauses(st):
            if c.kw == 'text':
                if self.once(seen, c):
                    text = self.text_of(c)
            else:
                self.d(c.line, 'P015')
        self.scan_must(text, st.line)

    def do_op(self, st):
        words = split_words(st.rest)
        if len(words) != 1:
            self.d(st.line, 'P031')
        op = O(name=words[0] if len(words) == 1 else None, file=self.fname, line=st.line,
               fields={}, audit=False, tolerances={}, request=None)
        seen = set()
        result = ''
        for c in self.clauses(st):
            kw = c.kw
            if kw in ('result', 'audit', 'request'):
                if not self.once(seen, c):
                    continue
            if kw == 'input':
                self.noline(c)
                for part in split_fields(c.rest):
                    m = RE_FIELD.fullmatch(part.strip(WSC))
                    if not m:
                        self.d(c.line, 'P017')
                    elif m.group(1) in op.fields:
                        self.d(c.line, 'P052')
                    else:
                        op.fields[m.group(1)] = m.group(2) is not None
            elif kw == 'result':
                self.noline(c)
                result = c.rest
            elif kw == 'tolerance':
                self.noline(c)
                path, num = first_word(c.rest)
                ok, v = jparse(num) if path else (False, None)
                if not path or not ok or not is_num(v) or not v >= 0:
                    self.d(c.line, 'P018')
                elif path in op.tolerances:
                    self.d(c.line, 'P052')
                else:
                    op.tolerances[path] = float(v)
            elif kw == 'audit':
                self.noline(c)
                if c.rest in ('', 'text'):
                    op.audit = True
                else:
                    self.d(c.line, 'P050')
            elif kw == 'request':
                self.noline(c)
                r = self.request_of(c)
                if r is not None:
                    op.request = r
            elif kw == 'returns':
                pass
            else:
                self.d(c.line, 'P015')
        self.ops.append(op)
        self.scan_must(result, st.line)

    def do_errors(self, st):
        first = self.errors is None
        if st.rest != '':
            self.d(st.line, 'P050')
        if not first:
            self.d(st.line, 'P032')
        codes = []
        for c in self.clauses(st):
            w, after = first_word(c.rest)
            cond = None
            if w != 'when' or after == '':
                self.d(c.line, 'P019')
            else:
                cond = after
            parts = [after] if cond is not None else []
            for L in c.lines:
                if L.blank:
                    parts.append('')
                elif L.indent == 3:
                    self.d(L.no, 'P006')
                else:
                    parts.append(' ' * (L.indent - 4) + L.text)
            if first:
                codes.append(O(code=c.kw, line=c.line, cond='\n'.join(parts)))
        if first:
            self.errors = O(codes=codes)
            for e in codes:
                self.scan_must(e.cond, e.line)

    def do_open(self, st):
        self.id_title(st)
        seen = set()
        text = ''
        ident = first_word(st.rest)[0]
        for c in self.clauses(st):
            if c.kw == 'text':
                if self.once(seen, c):
                    text = self.text_of(c)
            elif c.kw in ('example', 'table'):
                self.t(c.line, 'T003')
            else:
                self.d(c.line, 'P015')
        self.opens.append(O(id=ident, line=st.line, file=self.fname))
        self.scan_must(text, st.line, warn=True)

    def do_decision(self, st):
        ident, _title = self.id_title(st)
        dec = O(id=ident, line=st.line, file=self.fname, source=None, status=None,
                has_status=False)
        seen = set()
        texts = []
        for c in self.clauses(st):
            kw = c.kw
            if kw in ('source', 'status', 'text'):
                if not self.once(seen, c):
                    continue
            if kw == 'source':
                self.noline(c)
                dec.source = c.rest
            elif kw == 'status':
                self.noline(c)
                dec.has_status = True
                dec.status = c.rest
            elif kw == 'text':
                texts.append(self.text_of(c))
            elif kw == 'rejected':
                self.noline(c)
                self._cur_line = c.line
                v = self.quoted(c.rest)
                if v is not None:
                    texts.append(v)
            else:
                self.d(c.line, 'P015')
        self.decisions.append(dec)
        for tx in texts:
            self.scan_must(tx, st.line)

    def do_req(self, st):
        ident, _title = self.id_title(st)
        req = O(id=ident, line=st.line, file=self.fname, platform='any', decisions=[],
                examples=[], text=None, text_line=None, static=False)
        seen = set()
        for c in self.clauses(st):
            kw = c.kw
            if kw in ('text', 'on'):
                if not self.once(seen, c):
                    continue
            if kw == 'text':
                req.text = self.text_of(c)
                req.text_line = c.line
            elif kw == 'decision':
                self.noline(c)
                for x in RE_SPLIT_IDS.split(c.rest):
                    if x and x not in req.decisions:
                        req.decisions.append(x)
            elif kw == 'on':
                self.noline(c)
                if c.rest in ('any', 'posix', 'windows'):
                    req.platform = c.rest
                else:
                    self.d(c.line, 'P033')
            elif kw == 'example':
                ex = self.parse_example(c)
                if ex is not None:
                    req.examples.append(ex)
            elif kw == 'table':
                req.examples.extend(self.parse_table(c))
            elif kw == 'static':
                req.static = True
            else:
                self.d(c.line, 'P015')
        self.reqs.append(req)

    # -- examples
    def resolve_from(self, name):
        stack = self.fname.split('/')[:-1]
        for p in name.split('/'):
            if p in ('', '.'):
                continue
            if p == '..':
                if not stack:
                    return None
                stack.pop()
            else:
                stack.append(p)
        return '/'.join(stack)

    def from_ok(self, name):
        res = self.resolve_from(name)
        if res is None or res not in self.files:
            return None
        if self.rec_folder and not res.startswith(self.rec_folder + '/'):
            return None
        return res

    def parse_example(self, c):
        ex = O(line=c.line, raw=False, raw_line=None, op=None, input_text=None, input_obj=None,
               has_input_lines=False, request={}, omit=[], expects=[], row=None, id=None,
               table=None)
        dropped = False
        rest = c.rest
        if rest == '':
            self.d(c.line, 'P012')
            dropped = True
        else:
            w, after = first_word(rest)
            if w == 'raw':
                ex.raw = True
                if after.startswith('"'):
                    ok, v = jparse(after)
                    if ok and isinstance(v, str):
                        if '\r' in v or '\n' in v:
                            self.d(c.line, 'P026')
                            dropped = True
                        else:
                            ex.raw_line = v
                    else:
                        self.d(c.line, 'P004')
                        dropped = True
                elif len(after) >= 2 and after.startswith("'") and after.endswith("'"):
                    ex.raw_line = after[1:-1]
                else:
                    self.d(c.line, 'P004')
                    dropped = True
            else:
                ex.op = w
                if after != '':
                    ok, v = jparse(after)
                    if not ok:
                        self.d(c.line, 'P009')
                        dropped = True
                    elif not isinstance(v, dict):
                        self.d(c.line, 'P012')
                        dropped = True
                    else:
                        ex.input_text = after
                        ex.input_obj = v
        obj = ex.input_obj if not dropped else None
        request_seen = False
        lines = c.lines
        n = len(lines)
        i = 0
        while i < n:
            L = lines[i]
            i += 1
            if L.blank or L.text.startswith('#'):
                continue
            if L.indent != 4:
                self.d(L.no, 'P006')
                continue
            kw, r = first_word(L.text)
            if kw == 'expect':
                e = self.parse_expect(r, L.no)
                if e is not None:
                    ex.expects.append(e)
            elif kw == 'request':
                if ex.raw:
                    self.d(L.no, 'P022')
                elif request_seen:
                    self.d(L.no, 'P052')
                else:
                    ok, v = jparse(r)
                    if not ok or not isinstance(v, dict):
                        self.d(L.no, 'P009')
                    elif any(k in v for k in ('id', 'op', 'input')):
                        self.d(L.no, 'P051')
                    else:
                        request_seen = True
                        ex.request.update(v)
            elif kw == 'omit':
                if ex.raw:
                    self.d(L.no, 'P022')
                else:
                    names = [x for x in RE_SPLIT_IDS.split(r) if x]
                    if not names:
                        self.d(L.no, 'P011')
                    ex.omit.extend(names)
            elif kw == 'input':
                i, obj = self.parse_input(ex, r, L, lines, i, obj, dropped)
            else:
                self.d(L.no, 'P011')
        if dropped:
            return None
        ex.input_obj = obj
        return ex

    def parse_input(self, ex, r, L, lines, i, obj, dropped):
        m = RE_FROM.search(r)
        from_name = None
        path_text = r
        if m:
            ok, v = jparse(m.group(1))
            if ok and isinstance(v, str):
                from_name = v
                path_text = r[:m.start()]
        if ex.raw:
            self.d(L.no, 'P022')
            if from_name is None:
                i = self.skip_input_text(lines, i)
            return i, obj
        segs = parse_path(path_text.strip(WSC))
        if from_name is not None:
            if segs is None:
                self.d(L.no, 'P049')
                return i, obj
            res = self.from_ok(from_name)
            if res is None:
                self.d(L.no, 'P048')
                return i, obj
            value = self.files[res]
        else:
            text, i = self.collect_text(lines, i)
            if segs is None:
                self.d(L.no, 'P049')
                return i, obj
            value = text
        # check the whole path before changing anything
        probe = obj if obj is not None else {}
        for s in segs[:-1]:
            if s in probe:
                if not isinstance(probe[s], dict):
                    self.d(L.no, 'P049')
                    return i, obj
                probe = probe[s]
            else:
                break
        if from_name is None and value is None:
            self.d(L.no, 'P049')
            return i, obj
        if obj is None:
            obj = {}
        cur = obj
        for s in segs[:-1]:
            if s not in cur:
                cur[s] = {}
            cur = cur[s]
        cur[segs[-1]] = value
        if not dropped:
            ex.has_input_lines = True
        return i, obj

    def collect_text(self, lines, i):
        buf = []
        n = len(lines)
        while i < n:
            L = lines[i]
            if L.blank:
                buf.append('')
            elif L.indent >= 6:
                buf.append(' ' * (L.indent - 6) + L.text)
            else:
                break
            i += 1
        while buf and buf[-1] == '':
            buf.pop()
        if not buf:
            return None, i
        return '\n'.join(buf) + '\n', i

    def skip_input_text(self, lines, i):
        n = len(lines)
        while i < n and (lines[i].blank or lines[i].indent >= 6):
            i += 1
        return i

    def parse_expect(self, rest, no):
        m = re.match(r'([^=≈~%s]*)(.*)$' % _WS, rest, re.S)
        path, tail = m.group(1), m.group(2).lstrip(WSC)
        if path == '':
            self.d(no, 'P011')
            return None
        if tail.startswith('='):
            v = tail[1:].strip(WSC)
            if v == '?':
                return O(path=path, kind='oracle', value=None, tol=None, line=no)
            ok, val = jparse(v)
            if not ok:
                self.d(no, 'P009')
                return None
            return O(path=path, kind='eq', value=val, tol=None, line=no)
        if tail[:1] in ('≈', '~') and tail:
            body = tail[1:]
            cands = [x for x in (body.find('±'), body.find('+-')) if x >= 0]
            if not cands:
                self.d(no, 'P010')
                return None
            k = min(cands)
            sep = 1 if body[k] == '±' else 2
            ok1, a = jparse(body[:k].strip(WSC))
            ok2, b = jparse(body[k + sep:].strip(WSC))
            if not (ok1 and ok2 and is_num(a) and is_num(b) and b >= 0):
                self.d(no, 'P010')
                return None
            return O(path=path, kind='approx', value=float(a), tol=float(b), line=no)
        self.d(no, 'P011')
        return None

    # -- tables
    def parse_table(self, c):
        rows = []
        for L in c.lines:
            if L.blank or L.text.startswith('#'):
                continue
            if L.text.startswith('|') and L.indent >= 4:
                s = L.text
                if s.endswith('|') and all(ch in '|-:' or ch in WS_SET for ch in s):
                    continue
                rows.append((L.no, s))
            else:
                self.d(L.no, 'P006')
        words = split_words(c.rest)
        if len(words) != 1 or len(rows) < 2:
            self.d(c.line, 'P013')
            return []
        op = words[0]
        hline, htext = rows[0]
        cols = []
        seen = set()
        for cell in self.cells(htext):
            name = ''
            k = 0
            while k < len(cell) and cell[k] not in WS_SET and not cell.startswith('±', k) \
                    and not cell.startswith('+-', k):
                name += cell[k]
                k += 1
            remainder = cell[k:].strip(WSC)
            tol_text = None
            bad = False
            if remainder == '':
                pass
            elif remainder.startswith('±'):
                tol_text = remainder[1:]
            elif remainder.startswith('+-'):
                tol_text = remainder[2:]
            else:
                bad = True
            roots = ('result', 'audit', 'error', 'id')
            is_exp = any(name == r or name.startswith(r + '.') for r in roots)
            if not name or bad or name in seen or not (is_exp or RE_NAME.fullmatch(name)):
                self.d(hline, 'P013')
                return []
            seen.add(name)
            tol = None
            if tol_text is not None:
                ok, v = jparse(tol_text.strip(WSC))
                if not is_exp or not ok or not is_num(v) or not v >= 0:
                    self.d(hline, 'P010')
                else:
                    tol = float(v)
            cols.append(O(name=name, exp=is_exp, tol=tol))
        out = []
        for no, text in rows[1:]:
            cells = self.cells(text)
            if len(cells) != len(cols):
                self.d(no, 'P014')
                continue
            ex = O(line=no, raw=False, raw_line=None, op=op, input_text=None, input_obj=None,
                   has_input_lines=False, request={}, omit=[], expects=[], row=[], id=None,
                   table=True)
            bad = False
            for col, cell in zip(cols, cells):
                if cell == '':
                    continue
                if col.exp and cell == '?':
                    ex.expects.append(O(path=col.name, kind='oracle', value=None, tol=None,
                                        line=no))
                    continue
                ok, v = jparse(cell)
                if col.tol is not None:
                    if not ok or not is_num(v):
                        self.d(no, 'P010')
                        bad = True
                        continue
                    ex.expects.append(O(path=col.name, kind='approx', value=float(v),
                                        tol=col.tol, line=no))
                elif not ok:
                    self.d(no, 'P009')
                    bad = True
                elif col.exp:
                    ex.expects.append(O(path=col.name, kind='eq', value=v, tol=None, line=no))
                else:
                    ex.row.append((col.name, cell))
            if not bad:
                out.append(ex)
        return out

    @staticmethod
    def cells(row):
        s = row[1:]
        segs, cur, i = [], [], 0
        while i < len(s):
            ch = s[i]
            if ch == '\\' and i + 1 < len(s) and s[i + 1] == '|':
                cur.append('|')
                i += 2
                continue
            if ch == '|':
                segs.append(''.join(cur))
                cur = []
            else:
                cur.append(ch)
            i += 1
        segs.append(''.join(cur))
        if segs[-1] == '':
            segs.pop()
        return [x.strip(WSC) for x in segs]


# ---------------------------------------------------------------------------
# Checking

def valid_name(n):
    if not isinstance(n, str) or n == '':
        return False
    if '\\' in n or '\x00' in n or re.match(r'[A-Za-z]:', n):
        return False
    return all(p not in ('', '.', '..') for p in n.split('/'))


def resolve(files, entry):
    """Return (name, folder, rec_files) or (name, None, None) when missing."""
    if entry is None or entry == '.':
        name, prefix, folder = '.', '', ''
    elif entry in files:
        return entry, entry.rpartition('/')[0], [entry]
    else:
        name, prefix, folder = entry, entry + '/', entry
    out = []
    for n in files:
        if not n.startswith(prefix):
            continue
        rel = n[len(prefix):]
        parts = rel.split('/')
        if not parts[-1].endswith('.duramen'):
            continue
        if any(p.startswith('.') for p in parts):
            continue
        if any(p in ('build', 'node_modules') for p in parts[:-1]):
            continue
        out.append(n)
    if not out:
        return name, None, None
    out.sort(key=lambda n: u16(n[len(prefix):]))
    return name, folder, out


def split_command(s):
    words, cur, i, n = [], None, 0, len(s)
    while i < n:
        ch = s[i]
        if ch in ' \t':
            if cur is not None:
                words.append(cur)
                cur = None
            i += 1
        elif ch == '"' or ch == "'":
            cur = cur or ''
            i += 1
            buf = []
            while True:
                if i >= n:
                    return None
                c = s[i]
                if ch == '"' and c == '\\' and i + 1 < n and s[i + 1] == '"':
                    buf.append('"')
                    i += 2
                elif c == ch:
                    i += 1
                    break
                else:
                    buf.append(c)
                    i += 1
            cur += ''.join(buf)
        else:
            cur = (cur or '') + ch
            i += 1
    if cur is not None:
        words.append(cur)
    return words


ORACLE_TIMEOUT = 20


def run_oracle(root, cwd_rel, command, lines):
    """Run the oracle once. Returns (failed, [stdout lines])."""
    words = split_command(command)
    if not words:
        return True, []
    cwd = os.path.join(root, *[p for p in cwd_rel.split('/') if p]) if cwd_rel else root
    data = ''.join(l + '\n' for l in lines).encode('utf-8', 'surrogatepass')
    try:
        proc = subprocess.Popen(words, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL)
    except (OSError, ValueError):
        return True, []
    failed = False
    try:
        out, _ = proc.communicate(data, timeout=ORACLE_TIMEOUT)
    except subprocess.TimeoutExpired:
        proc.kill()
        out, _ = proc.communicate()
        failed = True
    except OSError:
        proc.kill()
        out, _ = proc.communicate()
        failed = True
    if proc.returncode != 0:
        failed = True
    text = (out or b'').decode('utf-8', 'replace')
    return failed, text.split('\n')


def parse_response_line(line):
    if is_ws_only(line):
        return False, None
    ok, v = jparse(line)
    return True, (v if ok and isinstance(v, dict) else None)


def analyze(files, entry):
    """Check a record. Returns (diagnostics, model or None)."""
    name, folder, rec_files = resolve(files, entry)
    if rec_files is None:
        return [(name, 1, 'error', 'P046')], None
    rd = Reader(files, rec_files, folder)
    rd.read_all()
    vers = {v for v in rd.versions.values() if v}
    if len(vers) > 1:
        rd.fname = name
        rd.d(1, 'P047')
    if not rd.has_spec:
        rd.fname = name
        rd.d(1, 'P021')
    if rd.diags:
        return rd.diags, None
    diags = list(rd.tdiags)
    model = O(reader=rd, reqs=rd.reqs, ops=rd.ops, spec=rd.spec, oracle=rd.oracle,
              files=files, name=name)
    check_record(rd, diags, model)
    return diags, model


def check_record(rd, diags, model):
    def t(file, line, code, level='error'):
        diags.append((file, line, level, code))

    # IDs
    for items in ([r for r in rd.reqs], rd.opens, rd.decisions):
        seen = set()
        for it in items:
            if it.id in seen:
                t(it.file, it.line, 'T007')
            seen.add(it.id)
    seen = set()
    first_op = {}
    for op in rd.ops:
        if op.name in seen:
            t(op.file, op.line, 'T007')
        seen.add(op.name)
        first_op.setdefault(op.name, op)
    model.first_op = first_op

    declared = {}
    for d in rd.decisions:
        declared.setdefault(d.id, d)
    cited = set()
    codes = [e.code for e in rd.errors.codes] if rd.errors else []
    code_set = set(codes)

    for req in rd.reqs:
        cited.update(req.decisions)
        for did in req.decisions:
            dec = declared.get(did)
            if dec is None:
                t(req.file, req.line, 'T008')
                continue
            word = first_word(dec.status)[0] if dec.has_status else 'accepted'
            if word in ('contested', 'superseded', 'rejected'):
                t(req.file, req.line, 'T028')
            elif word in ('observed', 'inferred', 'proposed'):
                t(req.file, req.line, 'T028', 'warning')
        if not req.examples and not req.static:
            t(req.file, req.line, 'T001')
        if req.text is not None and len(code_set) >= 2:
            hit = [c for c in code_set
                   if re.search(r'(?<![A-Za-z0-9_-])%s(?![A-Za-z0-9_-])' % re.escape(c), req.text)]
            if len(hit) >= 2 and RE_PHRASE.search(req.text):
                t(req.file, req.text_line, 'T005')

    for d in rd.decisions:
        if d.id not in cited:
            t(d.file, d.line, 'T012', 'warning')
        if d.source is None or d.source == '':
            t(d.file, d.line, 'T013', 'warning')
        if d.has_status:
            w = first_word(d.status)[0]
            ok = w in STATUSES
            if ok and w == 'superseded':
                m = re.fullmatch(r'superseded by ([^%s]+)' % _WS, d.status)
                ok = bool(m) and m.group(1) in declared
            if not ok:
                t(d.file, d.line, 'T027')

    # examples
    runnable = []
    for req in rd.reqs:
        for n, ex in enumerate(req.examples, 1):
            ex.id = '%s#%d' % (req.id, n)
            ex.req = req
            ex.expects_error = any(e.path == 'error' for e in ex.expects)
            ex.err_any = any(e.path.split('.')[0] == 'error' for e in ex.expects)
            ex.response = None
            for e in ex.expects:
                if e.path == 'error' and e.kind != 'oracle':
                    if not (isinstance(e.value, str) and e.value in code_set) \
                            or e.kind == 'approx':
                        t(req.file, e.line, 'T023')
            if ex.raw:
                runnable.append(ex)
                continue
            op = first_op.get(ex.op)
            if not ex.expects_error:
                if op is None:
                    t(req.file, ex.line, 'T009')
                else:
                    if ex.table:
                        have = [k for k, _ in ex.row]
                    elif isinstance(ex.input_obj, dict):
                        have = list(ex.input_obj.keys())
                    else:
                        have = []
                    for f, optional in op.fields.items():
                        if not optional and f not in have:
                            t(req.file, ex.line, 'T010')
                    for k in have:
                        if k not in op.fields:
                            t(req.file, ex.line, 'T011', 'warning')
            if ex.expects_error or op is not None:
                runnable.append(ex)

    if any(r.examples for r in rd.reqs) and rd.oracle is None:
        t(rd.spec.file, rd.spec.line, 'T019')
        return
    if rd.oracle is None or not runnable:
        return
    for ex in runnable:
        ex.line_text = build_line(ex, model)
        ex.solo = ex.raw or 'id' in ex.omit
    run_examples(rd, model, runnable, diags)


def build_line(ex, model):
    if ex.raw:
        return ex.raw_line
    op = model.first_op.get(ex.op)
    base = op.request if op is not None and op.request is not None else model.spec.request
    members = dict(base)
    members.update(ex.request)
    for k in ex.omit:
        members.pop(k, None)
    parts = []
    if 'id' not in ex.omit:
        parts.append('"id":' + js_str(ex.id))
    if 'op' not in ex.omit:
        parts.append('"op":' + js_str(ex.op))
    for k in es_keys(members):
        parts.append(js_str(k) + ':' + js_json(members[k]))
    if 'input' not in ex.omit:
        if ex.table:
            parts.append('"input":{' + ','.join(js_str(k) + ':' + v for k, v in ex.row) + '}')
        elif ex.has_input_lines:
            parts.append('"input":' + js_json(ex.input_obj))
        elif ex.input_text is not None:
            parts.append('"input":' + ex.input_text)
    return '{' + ','.join(parts) + '}'


def run_examples(rd, model, runnable, diags):
    def t(file, line, code, level='error'):
        diags.append((file, line, level, code))

    oracle = rd.oracle
    root = tempfile.mkdtemp(prefix='duramen-')
    try:
        for fname, text in model.files.items():
            p = os.path.join(root, *fname.split('/'))
            try:
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, 'wb') as fh:
                    fh.write(text.encode('utf-8', 'surrogatepass'))
            except (OSError, ValueError):
                pass
        cwd_rel = oracle.file.rpartition('/')[0]
        batch = [e for e in runnable if not e.solo]
        if batch:
            failed, outl = run_oracle(root, cwd_rel, oracle.command, [e.line_text for e in batch])
            if failed:
                t(oracle.file, oracle.line, 'T020')
            got = {}
            for l in outl:
                seen, v = parse_response_line(l)
                if seen and v is not None and isinstance(v.get('id'), str):
                    got.setdefault(v['id'], v)
            for e in batch:
                e.response = got.get(e.id)
        for e in runnable:
            if not e.solo:
                continue
            failed, outl = run_oracle(root, cwd_rel, oracle.command, [e.line_text])
            if failed:
                t(e.req.file, e.line, 'T020')
            seen = [parse_response_line(l) for l in outl]
            seen = [v for s, v in seen if s]
            e.response = seen[0] if len(seen) == 1 and seen[0] is not None else None
    finally:
        shutil.rmtree(root, ignore_errors=True)

    for e in runnable:
        f = e.req.file
        r = e.response
        if r is None:
            t(f, e.line, 'T021')
            continue
        if 'oracle_error' in r:
            t(f, e.line, 'T022')
            continue
        if 'error' in r and not e.err_any:
            t(f, e.line, 'T024', 'warning')
        for x in e.expects:
            v = read_path(r, x.path)
            if x.kind == 'oracle':
                if v is NONE:
                    t(f, x.line, 'T025')
                else:
                    x.value = v
            elif x.kind == 'eq':
                if v is NONE or not jeq(v, x.value):
                    t(f, x.line, 'T002')
            else:
                if v is NONE or not is_num(v) or isinstance(v, bool) \
                        or not abs(float(v) - x.value) <= x.tol:
                    t(f, x.line, 'T002')


LEVELS = {'error': 0, 'warning': 1, 'info': 2}


def format_diags(diags):
    ds = sorted(diags, key=lambda d: (u16(d[0]), d[1], u16(d[3]), LEVELS[d[2]]))
    return ['%s:%d: %s %s' % (f, ln, lv, code) for f, ln, lv, code in ds]


def count_levels(diags):
    return (sum(1 for d in diags if d[2] == 'error'), sum(1 for d in diags if d[2] == 'warning'))


def build_cases(model):
    cases = []
    for req in model.reqs:
        for ex in req.examples:
            r = ex.response
            checks = []
            for x in ex.expects:
                if x.kind == 'eq':
                    checks.append({'path': x.path, 'kind': 'eq', 'value': norm(x.value)})
                elif x.kind == 'approx':
                    checks.append({'path': x.path, 'kind': 'approx', 'value': norm(x.value),
                                   'tol': norm(x.tol)})
                else:
                    checks.append({'path': x.path, 'kind': 'eq', 'value': norm(x.value),
                                   'from': 'oracle'})
            op = None if ex.raw else model.first_op.get(ex.op)
            full = {'members': sorted(r.keys(), key=u16),
                    'tolerances': {k: norm(v) for k, v in op.tolerances.items()} if op else {}}
            if 'error' in r:
                full['error'] = norm(r['error'])
            if 'result' in r:
                full['result'] = norm(r['result'])
            if op is not None and op.audit and 'audit' in r:
                full['audit'] = norm(r['audit'])
            case = {'id': ex.id, 'kind': 'example', 'reqs': ['REQ-' + req.id],
                    'platform': req.platform, 'line': ex.line_text, 'checks': checks,
                    'full': full}
            if ex.solo:
                case['solo'] = True
            cases.append(case)
    return cases


def do_check(inp):
    diags, _ = analyze(inp['files'], inp.get('entry'))
    e, w = count_levels(diags)
    return {'diagnostics': format_diags(diags), 'errors': e, 'warnings': w}


def do_cases(inp):
    diags, model = analyze(inp['files'], inp.get('entry'))
    e, _ = count_levels(diags)
    if e:
        return {'errors': e, 'cases': []}
    return {'errors': 0, 'cases': build_cases(model)}


# ---------------------------------------------------------------------------
# Judging

def valid_case(case, answer):
    if not isinstance(case, dict):
        return False
    checks = case.get('checks')
    if not isinstance(checks, list):
        return False
    for c in checks:
        if not isinstance(c, dict) or not isinstance(c.get('path'), str) or 'kind' not in c:
            return False
        kind = c['kind']
        if kind == 'eq':
            if 'value' not in c:
                return False
        elif kind == 'approx':
            if not is_num(c.get('value')) or not is_num(c.get('tol')) or not c['tol'] >= 0:
                return False
    if 'full' not in case:
        return False
    full = case['full']
    if full is not None:
        if not isinstance(full, dict):
            return False
        m = full.get('members')
        if not isinstance(m, list) or not all(isinstance(x, str) for x in m):
            return False
        tol = full.get('tolerances')
        if not isinstance(tol, dict) or not all(is_num(v) and v >= 0 for v in tol.values()):
            return False
        if 'audit' in full and not isinstance(full['audit'], str):
            return False
    return answer is None or isinstance(answer, dict)


def result_equal(exp, act, path, tols):
    if path in tols and is_num(exp) and is_num(act):
        return abs(float(act) - float(exp)) <= tols[path]
    if isinstance(exp, dict):
        return (isinstance(act, dict) and set(exp) == set(act)
                and all(result_equal(v, act[k], path + '.' + k, tols) for k, v in exp.items()))
    if isinstance(exp, list):
        return (isinstance(act, list) and len(exp) == len(act)
                and all(result_equal(v, act[i], '%s.%d' % (path, i), tols)
                        for i, v in enumerate(exp)))
    return jeq(exp, act)


def do_judge(inp):
    case, answer = inp['case'], inp['answer']
    if answer is None:
        return {'pass': False, 'failed': ['answer']}
    failed = []
    for n, c in enumerate(case['checks']):
        v = read_path(answer, c['path'])
        if v is NONE:
            ok = False
        elif c['kind'] == 'eq':
            ok = jeq(v, c['value'])
        elif c['kind'] == 'approx':
            ok = is_num(v) and abs(float(v) - float(c['value'])) <= float(c['tol'])
        else:
            ok = False
        if not ok:
            failed.append('checks.%d' % n)
    full = case['full']
    if full is not None:
        if sorted(answer.keys(), key=u16) != full['members']:
            failed.append('members')
        if 'error' in full:
            if 'error' not in answer or not jeq(full['error'], answer['error']):
                failed.append('error')
        else:
            if 'result' in full:
                if 'result' not in answer or not result_equal(
                        full['result'], answer['result'], 'result', full['tolerances']):
                    failed.append('result')
            if 'audit' in full:
                if answer.get('audit', NONE) != full['audit']:
                    failed.append('audit')
    return {'pass': not failed, **({'failed': failed} if failed else {})}


# ---------------------------------------------------------------------------
# Requests

def handle_line(line):
    """Return the response object for a non-blank request line."""
    ok, req = jparse_lenient(line)
    if not ok or not isinstance(req, dict) or not isinstance(req.get('id'), str):
        return {'id': None, 'error': 'bad_request'}
    rid = req['id']
    op = req.get('op')
    if op not in ('check', 'cases', 'judge') or not isinstance(op, str):
        return {'id': rid, 'error': 'unknown_op'}
    inp = req.get('input')
    if not isinstance(inp, dict):
        return {'id': rid, 'error': 'bad_request'}
    if op == 'judge':
        if 'case' not in inp or 'answer' not in inp or not valid_case(inp['case'], inp['answer']):
            return {'id': rid, 'error': 'bad_request'}
        return {'id': rid, 'result': do_judge(inp)}
    files = inp.get('files')
    if not isinstance(files, dict) or not files:
        return {'id': rid, 'error': 'bad_request'}
    for k, v in files.items():
        if not isinstance(v, str) or not valid_name(k):
            return {'id': rid, 'error': 'bad_request'}
    names = list(files)
    for a in names:
        for b in names:
            if b.startswith(a + '/'):
                return {'id': rid, 'error': 'bad_request'}
    if 'entry' in inp:
        e = inp['entry']
        if not (e == '.' or valid_name(e)):
            return {'id': rid, 'error': 'bad_request'}
    try:
        res = do_check(inp) if op == 'check' else do_cases(inp)
    except Exception:
        import traceback
        import sys
        traceback.print_exc(file=sys.stderr)
        return {'id': rid, 'error': 'internal_error'}
    return {'id': rid, 'result': res}
