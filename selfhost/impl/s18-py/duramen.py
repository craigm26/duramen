"""duramen-core: the checker (check), the suite generator (cases) and the judge (judge)."""
import json
import os
import re
import shutil
import subprocess
import tempfile

# ECMAScript's \s
WS = ('\t\n\x0b\x0c\r   ' + ''.join(chr(c) for c in range(0x2000, 0x200b))
      + '    　﻿')
WSC = '[' + re.escape(WS) + ']'
ORACLE_TIMEOUT = 30

KEYWORDS = {'duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision',
            'note', 'type', 'edge', 'edgedef', 'property', 'evidence'}
LINE_CLAUSES = {'text', 'example', 'table'}
WARNINGS = {'T011', 'T012', 'T013', 'T014', 'T024'}


# ---------------------------------------------------------------- helpers

def u16(s):
    return s.encode('utf-16-be', 'surrogatepass')


def split_word(s):
    s = s.lstrip(WS)
    i = 0
    while i < len(s) and s[i] not in WS:
        i += 1
    return s[:i], s[i:].lstrip(WS)


class TooLarge(Exception):
    pass


def _pnum(s):
    v = float(s)
    if v in (float('inf'), float('-inf')):
        raise TooLarge()
    return v + 0.0


def _pconst(s):
    raise ValueError(s)


def parse_json(text):
    """Returns ('ok', value) | ('bad', None) | ('big', None). Numbers are floats."""
    try:
        v = json.loads(text, parse_float=_pnum, parse_int=_pnum, parse_constant=_pconst)
    except TooLarge:
        return 'big', None
    except (ValueError, RecursionError):
        return 'bad', None
    return 'ok', v


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def jtype(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'bool'
    if isinstance(v, (int, float)):
        return 'num'
    if isinstance(v, str):
        return 'str'
    if isinstance(v, list):
        return 'list'
    return 'dict'


def jeq(a, b):
    ta = jtype(a)
    if ta != jtype(b):
        return False
    if ta == 'dict':
        if set(a) != set(b):
            return False
        return all(jeq(a[k], b[k]) for k in a)
    if ta == 'list':
        return len(a) == len(b) and all(jeq(x, y) for x, y in zip(a, b))
    if ta == 'num':
        return float(a) == float(b)
    return a == b


_INDEX_RE = re.compile(r'(?:0|[1-9][0-9]*)\Z')


def is_index(s):
    return len(s) <= 10 and _INDEX_RE.match(s) is not None and int(s) < 4294967295


def es_keys(d):
    idx = sorted((k for k in d if is_index(k)), key=int)
    return idx + [k for k in d if not is_index(k)]


def js_num(x):
    x = float(x)
    if x != x or x in (float('inf'), float('-inf')):
        return 'null'
    if x == 0:
        return '0'
    r = repr(x)
    neg = r.startswith('-')
    if neg:
        r = r[1:]
    if 'e' in r:
        mant, ex = r.split('e')
        ex = int(ex)
    else:
        mant, ex = r, 0
    if '.' in mant:
        ip, fp = mant.split('.')
    else:
        ip, fp = mant, ''
    digits = ip + fp
    n = len(ip) + ex
    stripped = digits.lstrip('0')
    n -= len(digits) - len(stripped)
    digits = stripped.rstrip('0')
    k = len(digits)
    if k <= n <= 21:
        out = digits + '0' * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + '.' + digits[n:]
    elif -6 < n <= 0:
        out = '0.' + '0' * (-n) + digits
    else:
        e = n - 1
        sign = '+' if e >= 0 else '-'
        if k == 1:
            out = digits + 'e' + sign + str(abs(e))
        else:
            out = digits[0] + '.' + digits[1:] + 'e' + sign + str(abs(e))
    return '-' + out if neg else out


_ESC = {'"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t'}


def js_str(s):
    out = ['"']
    for ch in s:
        if ch in _ESC:
            out.append(_ESC[ch])
        else:
            o = ord(ch)
            if o < 0x20 or 0xD800 <= o <= 0xDFFF:
                out.append('\\u%04x' % o)
            else:
                out.append(ch)
    out.append('"')
    return ''.join(out)


def js_dumps(v):
    if v is None:
        return 'null'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, (int, float)):
        return js_num(v)
    if isinstance(v, str):
        return js_str(v)
    if isinstance(v, list):
        return '[' + ','.join(js_dumps(x) for x in v) + ']'
    return '{' + ','.join(js_str(k) + ':' + js_dumps(v[k]) for k in es_keys(v)) + '}'


def get_path(root, path):
    """The value at a dotted path of a response: (found, value)."""
    segs = path.split('.')
    cur = root
    if segs[0] == 'audit' and len(segs) > 1:
        if not isinstance(root, dict) or not isinstance(root.get('audit'), str):
            return False, None
        st, cur = parse_json(root['audit'])
        if st != 'ok':
            return False, None
        segs = segs[1:]
    for s in segs:
        if isinstance(cur, dict):
            if s not in cur:
                return False, None
            cur = cur[s]
        elif isinstance(cur, list):
            if not is_index(s) or int(s) >= len(cur):
                return False, None
            cur = cur[int(s)]
        else:
            return False, None
    return True, cur


# ---------------------------------------------------------------- diagnostics

class Diags:
    def __init__(self):
        self.items = []

    def add(self, file, line, code, level=None):
        if level is None:
            level = 'warning' if code in WARNINGS else 'error'
        self.items.append((file, line, level, code))

    def sorted(self):
        order = {'error': 0, 'warning': 1, 'info': 2}
        return sorted(self.items, key=lambda d: (u16(d[0]), d[1], u16(d[3]), order[d[2]]))

    def count(self, level):
        return sum(1 for d in self.items if d[2] == level)


# ---------------------------------------------------------------- lexing

class Clause:
    def __init__(self, kw, line, rest):
        self.kw, self.line, self.rest, self.subs = kw, line, rest, []


class Stmt:
    def __init__(self, kw, line, rest, known):
        self.kw, self.line, self.rest, self.known = kw, line, rest, known
        self.clauses = []


def lex(name, text, diags):
    if text.startswith('﻿'):
        text = text[1:]
    stmts = []
    cur = None
    for ln, raw in enumerate(re.split(r'\r\n|\r|\n', text), 1):
        s = raw.rstrip(WS)
        if s == '':
            if cur is not None and cur.known and cur.clauses:
                cur.clauses[-1].subs.append((ln, -1, ''))
            continue
        indent = len(s) - len(s.lstrip(' '))
        body = s[indent:]
        if body[0] in WS:
            diags.add(name, ln, 'P001')
            continue
        if indent == 0:
            if body[0] == '#':
                continue
            kw, rest = split_word(body)
            known = kw in KEYWORDS
            if not known:
                diags.add(name, ln, 'P002')
            cur = Stmt(kw, ln, rest, known)
            stmts.append(cur)
            continue
        if cur is None:
            diags.add(name, ln, 'P003')
            continue
        if not cur.known:
            continue
        if indent == 1:
            diags.add(name, ln, 'P007')
            continue
        if indent == 2:
            if body[0] == '#':
                continue
            kw, rest = split_word(body)
            cur.clauses.append(Clause(kw, ln, rest))
            continue
        if not cur.clauses:
            diags.add(name, ln, 'P006')
            continue
        cur.clauses[-1].subs.append((ln, indent, body))
    return stmts


# ---------------------------------------------------------------- the model

class E:
    def __init__(self, line, path, kind, value=None, tol=None):
        self.line, self.path, self.kind, self.value, self.tol = line, path, kind, value, tol
        self.oracle_value = None


class Ex:
    def __init__(self, file, line, kind='example'):
        self.file, self.line, self.kind = file, line, kind
        self.raw = False
        self.rawline = None
        self.op = None
        self.input_text = None      # the input as written (JSON text)
        self.obj = None             # the parsed input object
        self.has_input_lines = False
        self.request = None
        self.request_read = False
        self.omit = []
        self.expects = []
        self.req = None
        self.n = 0
        self.resp = None

    @property
    def solo(self):
        return self.raw or 'id' in self.omit

    @property
    def case_id(self):
        return '%s#%d' % (self.req.id, self.n)


class TableRef:
    def __init__(self, clause, file):
        self.clause, self.file = clause, file


class Req:
    def __init__(self, file, line, rid):
        self.file, self.line, self.id = file, line, rid
        self.platform = 'any'
        self.text = None
        self.text_line = None
        self.decisions = []
        self.items = []


class Op:
    def __init__(self, file, line, name):
        self.file, self.line, self.name = file, line, name
        self.fields = {}
        self.tol = {}
        self.audit = False
        self.request = None
        self.result = None


class Decision:
    def __init__(self, file, line, did):
        self.file, self.line, self.id = file, line, did
        self.source = ''
        self.status = None
        self.text = None
        self.rejected = []


class Model:
    def __init__(self):
        self.spec = None
        self.oracle = None
        self.ops = []
        self.errors = None
        self.reqs = []
        self.opens = []
        self.decisions = []
        self.texts = []     # (file, line, kind, lines) for T004: spec, section, note
        self.folder = ''

    def op(self, name):
        for o in self.ops:
            if o.name == name:
                return o
        return None


# ---------------------------------------------------------------- reading

_STR_RE = re.compile(r'"(?:[^"\\]|\\.)*"', re.S)
_WORD_RE = re.compile(r'[A-Za-z0-9_-]+')
_FROM_RE = re.compile(r'(.*)' + WSC + '+from' + WSC + r'+("(?:[^"\\]|\\.)*")\Z', re.S)
_SPLIT_IDS = re.compile('[,' + re.escape(WS) + ']+')


def parse_path(s):
    if s == '':
        return None
    names = []
    i = 0
    while True:
        if i >= len(s):
            return None
        if s[i] == '"':
            m = _STR_RE.match(s, i)
            if not m:
                return None
            st, v = parse_json(m.group())
            if st != 'ok':
                return None
            names.append(v)
        else:
            m = _WORD_RE.match(s, i)
            if not m:
                return None
            names.append(m.group())
        i = m.end()
        if i == len(s):
            return names
        if s[i] != '.':
            return None
        i += 1


def can_set(obj, names):
    cur = obj
    for nm in names[:-1]:
        if nm in cur:
            cur = cur[nm]
            if not isinstance(cur, dict):
                return False
        else:
            return True
    return True


def set_path(obj, names, value):
    cur = obj
    for nm in names[:-1]:
        if nm not in cur:
            cur[nm] = {}
        cur = cur[nm]
    cur[names[-1]] = value


def split_fields(s):
    fields, cur, depth, inq, i = [], [], 0, False, 0
    while i < len(s):
        ch = s[i]
        if inq:
            cur.append(ch)
            if ch == '\\' and i + 1 < len(s):
                cur.append(s[i + 1])
                i += 1
            elif ch == '"':
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
            fields.append(''.join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    fields.append(''.join(cur))
    return fields


def split_cells(body):
    cells, cur, i = [], [], 1
    while i < len(body):
        ch = body[i]
        if ch == '\\' and i + 1 < len(body) and body[i + 1] == '|':
            cur.append('|')
            i += 2
            continue
        if ch == '|':
            cells.append(''.join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    last = ''.join(cur)
    if last.strip(WS) != '':
        cells.append(last)
    return [c.strip(WS) for c in cells]


def is_separator(body):
    return body.startswith('|') and body.endswith('|') and all(ch in '|-:' or ch in WS for ch in body)


class Col:
    def __init__(self, name, kind, tol):
        self.name, self.kind, self.tol = name, kind, tol


class Reader:
    def __init__(self, files, folder, diags):
        self.files, self.folder, self.diags = files, folder, diags
        self.model = Model()
        self.model.folder = folder
        self.fname = ''
        self.versions = set()
        self.spec_seen = self.oracle_seen = self.errors_seen = False

    def d(self, line, code):
        self.diags.add(self.fname, line, code)

    # -- the record
    def read(self, names, recname):
        for fname in names:
            self.fname = fname
            stmts = lex(fname, self.files[fname], self.diags)
            duramen_seen = False
            for st in stmts:
                if st.known:
                    duramen_seen = self.read_stmt(st, duramen_seen) or duramen_seen
            if not duramen_seen:
                self.d(1, 'P020')
        if not self.spec_seen:
            self.diags.add(recname, 1, 'P021')
        if len(self.versions) > 1:
            self.diags.add(recname, 1, 'P047')
        self.expand_tables()
        return self.model

    def read_stmt(self, st, duramen_seen):
        kw = st.kw
        if kw == 'duramen':
            if duramen_seen:
                self.d(st.line, 'P023')
            elif st.rest in ('0.1', '0.2'):
                self.versions.add(st.rest)
            else:
                self.d(st.line, 'P023')
            for c in self.iter_clauses(st, set(), set()):
                pass
            return True
        if kw == 'spec':
            self.read_spec(st)
        elif kw == 'oracle':
            self.read_oracle(st)
        elif kw == 'section':
            self.header(st)
            tl = self.read_simple_text(st)
            if tl is not None:
                self.model.texts.append((self.fname, st.line, 'section', tl))
        elif kw == 'note':
            if st.rest:
                self.d(st.line, 'P050')
            tl = self.read_simple_text(st)
            if tl is not None:
                self.model.texts.append((self.fname, st.line, 'note', tl))
        elif kw == 'op':
            self.read_op(st)
        elif kw == 'errors':
            self.read_errors(st)
        elif kw == 'req':
            self.read_req(st)
        elif kw == 'open':
            self.read_open(st)
        elif kw == 'decision':
            self.read_decision(st)
        return False

    def iter_clauses(self, st, allowed, once, silent=()):
        seen = set()
        for c in st.clauses:
            if c.kw not in allowed:
                self.d(c.line, 'P015')
                continue
            if c.kw in once:
                if c.kw in seen:
                    self.d(c.line, 'P052')
                    continue
                seen.add(c.kw)
            if c.kw in silent:
                yield c
                continue
            if c.kw not in LINE_CLAUSES:
                for ln, ind, body in c.subs:
                    if ind != -1 and not body.startswith('#'):
                        self.d(ln, 'P006')
            yield c

    def header(self, st):
        idw, t = split_word(st.rest)
        if idw == '' or len(t) < 2 or t[0] != '"' or t[-1] != '"':
            self.d(st.line, 'P005')
            return idw, None
        stt, v = parse_json(t)
        if stt != 'ok' or not isinstance(v, str):
            self.d(st.line, 'P004')
            return idw, None
        return idw, v

    def read_text(self, c):
        if c.rest:
            self.d(c.line, 'P008')
        lines = []
        for ln, ind, body in c.subs:
            if ind == -1:
                lines.append('')
            elif ind == 3:
                self.d(ln, 'P008')
            else:
                lines.append(' ' * (ind - 4) + body)
        while lines and lines[0] == '':
            lines.pop(0)
        while lines and lines[-1] == '':
            lines.pop()
        return lines

    def read_simple_text(self, st):
        tl = None
        for c in self.iter_clauses(st, {'text'}, {'text'}):
            tl = self.read_text(c)
        return tl

    def parse_request(self, rest, line):
        st, v = parse_json(rest)
        if st != 'ok' or not isinstance(v, dict):
            self.d(line, 'P009')
            return None
        if 'id' in v or 'op' in v or 'input' in v:
            self.d(line, 'P051')
            return None
        return v

    # -- statements
    def read_spec(self, st):
        words = [w for w in re.split(WSC + '+', st.rest.strip(WS)) if w]
        if len(words) != 2:
            self.d(st.line, 'P021')
        first = not self.spec_seen
        self.spec_seen = True
        if not first:
            self.d(st.line, 'P044')
        data = {'file': self.fname, 'line': st.line, 'request': {}, 'text': None}
        for c in self.iter_clauses(st, {'title', 'text', 'contract', 'request'},
                                   {'title', 'text', 'contract', 'request'}):
            if c.kw == 'title':
                stt, v = parse_json(c.rest)
                if stt != 'ok' or not isinstance(v, str):
                    self.d(c.line, 'P004')
            elif c.kw == 'text':
                data['text'] = self.read_text(c)
            elif c.kw == 'request':
                r = self.parse_request(c.rest, c.line)
                if r is not None:
                    data['request'] = r
        if first:
            self.model.spec = data
            if data['text'] is not None:
                self.model.texts.append((self.fname, st.line, 'spec', data['text']))

    def read_oracle(self, st):
        first = not self.oracle_seen
        self.oracle_seen = True
        if not first:
            self.d(st.line, 'P044')
        if st.rest == '':
            self.d(st.line, 'P028')
        for c in self.iter_clauses(st, {'source'}, set()):
            pass
        if first:
            self.model.oracle = {'file': self.fname, 'line': st.line, 'command': st.rest}

    def read_op(self, st):
        words = [w for w in re.split(WSC + '+', st.rest.strip(WS)) if w]
        if len(words) != 1:
            self.d(st.line, 'P031')
        op = Op(self.fname, st.line, words[0] if len(words) == 1 else None)
        for c in self.iter_clauses(st, {'input', 'result', 'tolerance', 'audit', 'request', 'returns'},
                                   {'result', 'audit', 'request'}, silent={'returns'}):
            if c.kw == 'input':
                for f in split_fields(c.rest):
                    f = f.strip(WS)
                    m = _WORD_RE.match(f)
                    ok = False
                    if m:
                        opt = f[m.end():m.end() + 1] == '?'
                        tail = f[m.end() + (1 if opt else 0):]
                        ok = tail != '' and tail[0] in WS and tail.strip(WS) != ''
                    if not ok:
                        self.d(c.line, 'P017')
                    elif m.group() in op.fields:
                        self.d(c.line, 'P052')
                    else:
                        op.fields[m.group()] = opt
            elif c.kw == 'result':
                op.result = c.rest
            elif c.kw == 'tolerance':
                path, num = split_word(c.rest)
                stt, v = parse_json(num)
                if path == '' or stt != 'ok' or not is_num(v) or v < 0:
                    self.d(c.line, 'P018')
                elif path in op.tol:
                    self.d(c.line, 'P052')
                else:
                    op.tol[path] = v
            elif c.kw == 'audit':
                if c.rest in ('', 'text'):
                    op.audit = True
                else:
                    self.d(c.line, 'P050')
            elif c.kw == 'request':
                r = self.parse_request(c.rest, c.line)
                if r is not None:
                    op.request = r
        self.model.ops.append(op)

    def read_errors(self, st):
        first = not self.errors_seen
        self.errors_seen = True
        if not first:
            self.d(st.line, 'P032')
        if st.rest:
            self.d(st.line, 'P050')
        codes, conds = [], []
        for c in st.clauses:
            w, cond = split_word(c.rest)
            ok = w == 'when' and cond != ''
            if not ok:
                self.d(c.line, 'P019')
            lines = [cond] if ok else []
            for ln, ind, body in c.subs:
                if ind == -1:
                    continue
                if ind == 3:
                    self.d(ln, 'P006')
                else:
                    lines.append(body)
            if ok:
                codes.append(c.kw)
                conds.append((self.fname, c.line, lines))
        if first:
            self.model.errors = {'codes': codes, 'conds': conds}

    def read_open(self, st):
        oid, _ = self.header(st)
        o = {'file': self.fname, 'line': st.line, 'id': oid, 'text': None, 'reports': []}
        for c in self.iter_clauses(st, {'text', 'example', 'table'}, {'text'}, silent={'example', 'table'}):
            if c.kw == 'text':
                o['text'] = self.read_text(c)
            else:
                o['reports'].append(c.line)
        self.model.opens.append(o)

    def read_decision(self, st):
        did, _ = self.header(st)
        d = Decision(self.fname, st.line, did)
        for c in self.iter_clauses(st, {'source', 'status', 'text', 'rejected'}, {'source', 'status', 'text'}):
            if c.kw == 'source':
                d.source = c.rest
            elif c.kw == 'status':
                d.status = c.rest
            elif c.kw == 'text':
                d.text = self.read_text(c)
            elif c.kw == 'rejected':
                stt, v = parse_json(c.rest)
                if stt != 'ok' or not isinstance(v, str):
                    self.d(c.line, 'P004')
                else:
                    d.rejected.append(v)
        self.model.decisions.append(d)

    def read_req(self, st):
        rid, _ = self.header(st)
        req = Req(self.fname, st.line, rid)
        for c in self.iter_clauses(st, {'text', 'decision', 'on', 'example', 'table', 'static'},
                                   {'text', 'on'}, silent={'static'}):
            if c.kw == 'text':
                req.text = self.read_text(c)
                req.text_line = c.line
            elif c.kw == 'decision':
                req.decisions.extend(x for x in _SPLIT_IDS.split(c.rest) if x)
            elif c.kw == 'on':
                if c.rest in ('any', 'posix', 'windows'):
                    req.platform = c.rest
                else:
                    self.d(c.line, 'P033')
            elif c.kw == 'example':
                req.items.append(self.read_example(c))
            elif c.kw == 'table':
                req.items.append(TableRef(c, self.fname))
        self.model.reqs.append(req)

    # -- examples
    def read_example(self, c):
        ex = Ex(self.fname, c.line)
        op, rem = split_word(c.rest)
        if op == '':
            self.d(c.line, 'P012')
        elif op == 'raw':
            ex.raw = True
            line = None
            if rem.startswith('"'):
                stt, v = parse_json(rem)
                if stt == 'ok' and isinstance(v, str):
                    line = v
            elif len(rem) >= 2 and rem[0] == "'" and rem[-1] == "'":
                line = rem[1:-1]
            if line is None:
                self.d(c.line, 'P004')
            elif '\r' in line or '\n' in line:
                self.d(c.line, 'P026')
            else:
                ex.rawline = line
        else:
            ex.op = op
            if rem != '':
                stt, v = parse_json(rem)
                if stt != 'ok':
                    self.d(c.line, 'P009')
                elif not isinstance(v, dict):
                    self.d(c.line, 'P012')
                else:
                    ex.input_text = rem
                    ex.obj = v
        subs = c.subs
        n = len(subs)
        i = 0
        while i < n:
            ln, ind, body = subs[i]
            i += 1
            if ind == -1 or body.startswith('#'):
                continue
            if ind != 4:
                self.d(ln, 'P006')
                continue
            w, r = split_word(body)
            if w == 'expect':
                self.read_expect(ex, ln, r)
            elif w == 'request':
                if ex.raw:
                    self.d(ln, 'P022')
                elif ex.request_read:
                    self.d(ln, 'P052')
                else:
                    v = self.parse_request(r, ln)
                    if v is not None:
                        ex.request, ex.request_read = v, True
            elif w == 'omit':
                if ex.raw:
                    self.d(ln, 'P022')
                else:
                    names = [x for x in _SPLIT_IDS.split(r) if x]
                    if not names:
                        self.d(ln, 'P011')
                    ex.omit.extend(names)
            elif w == 'input':
                i = self.read_input(ex, subs, i, ln, r)
            else:
                self.d(ln, 'P011')
        return ex

    def read_input(self, ex, subs, i, ln, r):
        fm = _FROM_RE.match(r)
        fname = None
        if fm:
            stt, v = parse_json(fm.group(2))
            if stt == 'ok' and isinstance(v, str):
                fname = v
                pathtext = fm.group(1).strip(WS)
        if fname is None:
            pathtext = r
        if ex.raw:
            if fname is not None:
                self.d(ln, 'P022')
                return i
            self.d(ln, 'P022')
            while i < len(subs) and (subs[i][1] == -1 or subs[i][1] >= 6):
                i += 1
            return i
        # the text under a plain input line
        text = None
        if fname is None:
            lines = []
            while i < len(subs) and (subs[i][1] == -1 or subs[i][1] >= 6):
                lines.append('' if subs[i][1] == -1 else ' ' * (subs[i][1] - 6) + subs[i][2])
                i += 1
            while lines and lines[-1] == '':
                lines.pop()
            if lines:
                text = '\n'.join(lines) + '\n'
        names = parse_path(pathtext)
        ex.has_input_lines = True
        if ex.obj is None:
            ex.obj = {}
        if names is None:
            self.d(ln, 'P049')
            return i
        if fname is not None:
            target = self.resolve_from(fname)
            if target is None:
                self.d(ln, 'P048')
                return i
            text = self.files[target]
        if not can_set(ex.obj, names) or text is None:
            self.d(ln, 'P049')
            return i
        set_path(ex.obj, names, text)
        return i

    def resolve_from(self, name):
        parts = self.fname.split('/')[:-1]
        for p in name.split('/'):
            if p in ('', '.'):
                continue
            if p == '..':
                if not parts:
                    return None
                parts.pop()
            else:
                parts.append(p)
        path = '/'.join(parts)
        if path not in self.files:
            return None
        if self.folder and not path.startswith(self.folder + '/'):
            return None
        return path

    def read_expect(self, ex, ln, r):
        j = 0
        while j < len(r) and r[j] not in WS and r[j] not in '=≈~':
            j += 1
        path = r[:j]
        k = j
        while k < len(r) and r[k] in WS:
            k += 1
        if path == '' or k >= len(r):
            self.d(ln, 'P011')
            return
        ch, val = r[k], r[k + 1:]
        if ch == '=':
            v = val.strip(WS)
            if v == '?':
                ex.expects.append(E(ln, path, 'oracle'))
                return
            stt, x = parse_json(v)
            if stt != 'ok':
                self.d(ln, 'P009')
            else:
                ex.expects.append(E(ln, path, 'eq', x))
        elif ch in '≈~':
            idx = [i for i in (val.find('±'), val.find('+-')) if i >= 0]
            if not idx:
                self.d(ln, 'P010')
                return
            i = min(idx)
            sep = 1 if val[i] == '±' else 2
            s1, v1 = parse_json(val[:i].strip(WS))
            s2, v2 = parse_json(val[i + sep:].strip(WS))
            if s1 != 'ok' or s2 != 'ok' or not is_num(v1) or not is_num(v2) or v2 < 0:
                self.d(ln, 'P010')
            else:
                ex.expects.append(E(ln, path, 'approx', v1, v2))
        else:
            self.d(ln, 'P011')

    # -- tables
    def expand_tables(self):
        for req in self.model.reqs:
            items = []
            for it in req.items:
                if isinstance(it, TableRef):
                    self.fname = it.file
                    items.extend(self.read_table(it.clause))
                else:
                    items.append(it)
            req.items = items
            for n, ex in enumerate(items, 1):
                ex.req, ex.n = req, n

    def read_table(self, c):
        rows = []
        for ln, ind, body in c.subs:
            if ind == -1 or body.startswith('#'):
                continue
            if ind >= 4 and body.startswith('|'):
                if not is_separator(body):
                    rows.append((ln, body))
            else:
                self.d(ln, 'P006')
        words = [w for w in re.split(WSC + '+', c.rest.strip(WS)) if w]
        if len(words) != 1 or len(rows) < 2:
            self.d(c.line, 'P013')
            return []
        opname = words[0]
        op = self.model.op(opname)
        fields = op.fields if op else {}
        hline, hbody = rows[0]
        cols = []
        names = set()
        for cell in split_cells(hbody):
            p = self.parse_hcell(cell)
            kind = None
            if p is not None:
                name, tol = p
                if name in fields:
                    kind = 'input'
                elif re.match(r'(?:result|audit|error|id)(?:\..*)?\Z', name, re.S):
                    kind = 'expect'
                elif re.match(r'[A-Za-z0-9_-]+\Z', name):
                    kind = 'input'
            if kind is None or name in names:
                self.diags.add(self.fname, hline, 'P013')
                return []
            names.add(name)
            tv = None
            if tol is not None:
                stt, v = parse_json(tol)
                if kind == 'input' or stt != 'ok' or not is_num(v) or v < 0:
                    self.diags.add(self.fname, hline, 'P010')
                else:
                    tv = v
            cols.append(Col(name, kind, tv))
        out = []
        for ln, body in rows[1:]:
            cells = split_cells(body)
            if len(cells) != len(cols):
                self.d(ln, 'P014')
                continue
            ex = Ex(self.fname, ln, 'row')
            ex.op = opname
            ex.obj = {}
            parts = []
            for col, cell in zip(cols, cells):
                if cell == '':
                    continue
                if col.kind == 'input':
                    stt, v = parse_json(cell)
                    if stt != 'ok':
                        self.d(ln, 'P009')
                    else:
                        parts.append(js_str(col.name) + ':' + cell)
                        ex.obj[col.name] = v
                elif cell == '?':
                    ex.expects.append(E(ln, col.name, 'oracle'))
                elif col.tol is not None:
                    stt, v = parse_json(cell)
                    if stt != 'ok' or not is_num(v):
                        self.d(ln, 'P010')
                    else:
                        ex.expects.append(E(ln, col.name, 'approx', v, col.tol))
                else:
                    stt, v = parse_json(cell)
                    if stt != 'ok':
                        self.d(ln, 'P009')
                    else:
                        ex.expects.append(E(ln, col.name, 'eq', v))
            ex.input_text = '{' + ','.join(parts) + '}'
            out.append(ex)
        return out

    @staticmethod
    def parse_hcell(cell):
        i = 0
        while i < len(cell) and cell[i] not in WS and cell[i] != '±' and not cell.startswith('+-', i):
            i += 1
        name, rest = cell[:i], cell[i:].strip(WS)
        if name == '':
            return None
        if rest == '':
            return name, None
        if rest.startswith('±'):
            return name, rest[1:].strip(WS)
        if rest.startswith('+-'):
            return name, rest[2:].strip(WS)
        return None


# ---------------------------------------------------------------- the record's files

def select_record(files, entry):
    """Returns (name, selected file names, folder)."""
    name = '.' if entry in (None, '.') else entry
    if name != '.' and name in files:
        return name, [name], name.rsplit('/', 1)[0] if '/' in name else ''
    prefix = '' if name == '.' else name + '/'
    sel = []
    for f in files:
        if not f.startswith(prefix):
            continue
        rel = f[len(prefix):]
        parts = rel.split('/')
        if not f.endswith('.duramen'):
            continue
        if any(p.startswith('.') for p in parts):
            continue
        if any(p in ('build', 'node_modules') for p in parts[:-1]):
            continue
        sel.append((rel, f))
    sel.sort(key=lambda t: u16(t[0]))
    return name, [f for _, f in sel], ('' if name == '.' else name)


# ---------------------------------------------------------------- checking

OBL = re.compile(r'(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])')
_PHRASES = ['in this order', 'in the order', 'first that applies', 'first match', 'precede',
            'precedes', 'preceded', 'before', 'after', 'take precedence', 'takes precedence']
PHRASE_RE = re.compile('(?<![A-Za-z0-9_])(?:' + '|'.join(
    (WSC + '+').join(re.escape(w) for w in p.split(' ')) for p in _PHRASES)
    + ')(?![A-Za-z0-9_])', re.I | re.A)
_QUOTES = {'"': '"', '“': '”', '`': '`'}


def unquote(line):
    out, i = [], 0
    while i < len(line):
        ch = line[i]
        close = _QUOTES.get(ch)
        if close:
            j = line.find(close, i + 1)
            if j != -1:
                out.append(' ')
                i = j + 1
                continue
        out.append(ch)
        i += 1
    return ''.join(out)


def has_obligation(lines):
    return any(OBL.search(unquote(l)) for l in lines)


def split_command(cmd):
    words, cur, i = [], None, 0
    while i < len(cmd):
        ch = cmd[i]
        if ch in ' \t':
            if cur is not None:
                words.append(cur)
                cur = None
            i += 1
        elif ch == '"':
            cur = cur or ''
            i += 1
            while True:
                if i >= len(cmd):
                    return None
                if cmd[i] == '\\' and i + 1 < len(cmd) and cmd[i + 1] == '"':
                    cur += '"'
                    i += 2
                elif cmd[i] == '"':
                    i += 1
                    break
                else:
                    cur += cmd[i]
                    i += 1
        elif ch == "'":
            cur = cur or ''
            j = cmd.find("'", i + 1)
            if j == -1:
                return None
            cur += cmd[i + 1:j]
            i = j + 1
        else:
            cur = (cur or '') + ch
            i += 1
    if cur is not None:
        words.append(cur)
    return words


def build_line(model, ex):
    if ex.raw:
        return ex.rawline
    op = model.op(ex.op)
    base = op.request if (op is not None and op.request is not None) else model.spec['request']
    members = dict(base)
    if ex.request:
        members.update(ex.request)
    for nm in ex.omit:
        members.pop(nm, None)
    parts = []
    if 'id' not in ex.omit:
        parts.append('"id":' + js_str(ex.case_id))
    if 'op' not in ex.omit:
        parts.append('"op":' + js_str(ex.op))
    for k in es_keys(members):
        parts.append(js_str(k) + ':' + js_dumps(members[k]))
    if 'input' not in ex.omit:
        if ex.has_input_lines:
            parts.append('"input":' + js_dumps(ex.obj))
        elif ex.input_text is not None:
            parts.append('"input":' + ex.input_text)
    return '{' + ','.join(parts) + '}'


def parse_response_line(line):
    st, v = parse_json(line)
    if st == 'ok' and isinstance(v, dict):
        return v
    return None


def exec_oracle(words, cwd, lines):
    """Returns (output lines, failed)."""
    if words is None:
        return [], True
    data = ''.join(re.sub('[\ud800-\udfff]', '�', l) + '\n' for l in lines).encode('utf-8')
    out = b''
    failed = False
    try:
        p = subprocess.run(words, input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                           cwd=cwd, timeout=ORACLE_TIMEOUT)
        out = p.stdout
        failed = p.returncode != 0
    except subprocess.TimeoutExpired as e:
        out = e.stdout or b''
        failed = True
    except (OSError, ValueError):
        failed = True
    text = out.decode('utf-8', errors='replace')
    return [l for l in text.split('\n') if l.strip(WS) != ''], failed


def run_checks(model, diags, files):
    errs = model.errors['codes'] if model.errors else []
    reqs = model.reqs
    # T001, T008, T028 ...
    first_dec = {}
    for d in model.decisions:
        first_dec.setdefault(d.id, d)
    cited = set()
    for r in reqs:
        cited.update(r.decisions)
    seen_ids = set()
    for r in reqs:
        if not r.items:
            diags.add(r.file, r.line, 'T001')
        if ('req', r.id) in seen_ids:
            diags.add(r.file, r.line, 'T007')
        seen_ids.add(('req', r.id))
        done = set()
        for did in r.decisions:
            if did in done:
                continue
            done.add(did)
            d = first_dec.get(did)
            if d is None:
                diags.add(r.file, r.line, 'T008')
                continue
            w = split_word(d.status or '')[0]
            if w in ('contested', 'superseded', 'rejected'):
                diags.add(r.file, r.line, 'T028', 'error')
            elif w in ('observed', 'inferred', 'proposed'):
                diags.add(r.file, r.line, 'T028', 'warning')
    seen = set()
    for o in model.opens:
        if o['id'] in seen:
            diags.add(o['file'], o['line'], 'T007')
        seen.add(o['id'])
    seen = set()
    for d in model.decisions:
        if d.id in seen:
            diags.add(d.file, d.line, 'T007')
        seen.add(d.id)
        if d.id not in cited:
            diags.add(d.file, d.line, 'T012')
        if d.source.strip(WS) == '':
            diags.add(d.file, d.line, 'T013')
        if d.status is not None:
            w = split_word(d.status)[0]
            ok = w in ('observed', 'inferred', 'proposed', 'accepted', 'contested', 'rejected')
            if w == 'superseded':
                m = re.match(r'superseded by (\S+)\Z', d.status)
                ok = m is not None and not re.search(WSC, m.group(1)) and m.group(1) in first_dec
            if not ok:
                diags.add(d.file, d.line, 'T027')
    seen = set()
    for o in model.ops:
        if o.name in seen:
            diags.add(o.file, o.line, 'T007')
        seen.add(o.name)
    # examples
    examples = [ex for r in reqs for ex in r.items]
    for ex in examples:
        err_exp = any(e.path == 'error' for e in ex.expects)
        if not ex.raw and not err_exp:
            op = model.op(ex.op)
            if op is None:
                diags.add(ex.file, ex.line, 'T009')
            else:
                keys = ex.obj if ex.obj is not None else {}
                for name, opt in op.fields.items():
                    if not opt and name not in keys:
                        diags.add(ex.file, ex.line, 'T010')
                for k in keys:
                    if k not in op.fields:
                        diags.add(ex.file, ex.line, 'T011')
        for e in ex.expects:
            if e.path == 'error' and e.kind != 'oracle':
                if not (e.kind == 'eq' and isinstance(e.value, str) and e.value in errs):
                    diags.add(ex.file, e.line, 'T023')
    # T004 / T014
    for f, line, kind, lines in model.texts:
        if has_obligation(lines):
            diags.add(f, line, 'T004')
    for o in model.ops:
        if o.result is not None and has_obligation([o.result]):
            diags.add(o.file, o.line, 'T004')
    for d in model.decisions:
        if d.text is not None and has_obligation(d.text):
            diags.add(d.file, d.line, 'T004')
        for alt in d.rejected:
            if has_obligation(re.split(r'\r\n|\r|\n', alt)):
                diags.add(d.file, d.line, 'T004')
    if model.errors:
        for f, line, lines in model.errors['conds']:
            if has_obligation(lines):
                diags.add(f, line, 'T004')
    for o in model.opens:
        if o['text'] is not None and has_obligation(o['text']):
            diags.add(o['file'], o['line'], 'T014')
        for ln in o['reports']:
            diags.add(o['file'], ln, 'T003')
    # T005
    distinct = []
    for c in errs:
        if c not in distinct:
            distinct.append(c)
    if len(distinct) >= 2:
        for r in reqs:
            if r.text is None:
                continue
            txt = '\n'.join(r.text)
            named = [c for c in distinct
                     if re.search('(?<![A-Za-z0-9_-])' + re.escape(c) + '(?![A-Za-z0-9_-])', txt)]
            if len(named) >= 2 and PHRASE_RE.search(txt):
                diags.add(r.file, r.text_line, 'T005')
    # the oracle
    if examples:
        if model.oracle is None:
            diags.add(model.spec['file'], model.spec['line'], 'T019')
        else:
            run_oracle(model, diags, files, examples)


def run_oracle(model, diags, files, examples):
    runnable = []
    for ex in examples:
        err_exp = any(e.path == 'error' for e in ex.expects)
        if ex.raw or err_exp or model.op(ex.op) is not None:
            runnable.append(ex)
    orc = model.oracle
    words = split_command(orc['command'])
    tmp = tempfile.mkdtemp(prefix='duramen-')
    try:
        for name, text in files.items():
            try:
                p = os.path.join(tmp, *name.split('/'))
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, 'wb') as fh:
                    fh.write(text.encode('utf-8', 'replace'))
            except (OSError, ValueError):
                pass
        parts = orc['file'].split('/')[:-1]
        cwd = os.path.join(tmp, *parts)
        lines = {id(ex): build_line(model, ex) for ex in runnable}
        batch = [ex for ex in runnable if not ex.solo]
        if batch:
            out, failed = exec_oracle(words, cwd, [lines[id(ex)] for ex in batch])
            if failed:
                diags.add(orc['file'], orc['line'], 'T020')
            byid = {}
            for l in out:
                r = parse_response_line(l)
                if r is not None and isinstance(r.get('id'), str) and r['id'] not in byid:
                    byid[r['id']] = r
            for ex in batch:
                ex.resp = byid.get(ex.case_id)
        for ex in runnable:
            if not ex.solo:
                continue
            out, failed = exec_oracle(words, cwd, [lines[id(ex)]])
            if failed:
                diags.add(ex.file, ex.line, 'T020')
            if len(out) == 1:
                ex.resp = parse_response_line(out[0])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    for ex in runnable:
        evaluate(ex, diags)


def evaluate(ex, diags):
    resp = ex.resp
    if resp is None:
        diags.add(ex.file, ex.line, 'T021')
        return
    if 'oracle_error' in resp:
        diags.add(ex.file, ex.line, 'T022')
        ex.resp = None
        return
    if 'error' in resp and not ex.expects:
        diags.add(ex.file, ex.line, 'T024')
    for e in ex.expects:
        found, v = get_path(resp, e.path)
        if e.kind == 'oracle':
            if not found:
                diags.add(ex.file, e.line, 'T025')
            e.oracle_value = v
        elif e.kind == 'eq':
            if not found or not jeq(v, e.value):
                diags.add(ex.file, e.line, 'T002')
        else:
            if not found or not is_num(v) or abs(v - e.value) > e.tol:
                diags.add(ex.file, e.line, 'T002')


# ---------------------------------------------------------------- the suite

def build_cases(model):
    cases = []
    for r in model.reqs:
        for ex in r.items:
            checks = []
            for e in ex.expects:
                if e.kind == 'eq':
                    checks.append({'path': e.path, 'kind': 'eq', 'value': e.value})
                elif e.kind == 'approx':
                    checks.append({'path': e.path, 'kind': 'approx', 'value': e.value, 'tol': e.tol})
                else:
                    checks.append({'path': e.path, 'kind': 'eq', 'value': e.oracle_value, 'from': 'oracle'})
            resp = ex.resp
            op = None if ex.raw else model.op(ex.op)
            full = {'members': sorted(resp, key=u16), 'tolerances': dict(op.tol) if op else {}}
            if 'error' in resp:
                full['error'] = resp['error']
            if 'result' in resp:
                full['result'] = resp['result']
            if op is not None and op.audit and isinstance(resp.get('audit'), str):
                full['audit'] = resp['audit']
            case = {'id': ex.case_id, 'kind': 'example', 'reqs': ['REQ-' + r.id],
                    'platform': r.platform, 'line': build_line(model, ex), 'checks': checks,
                    'full': full}
            if ex.solo:
                case['solo'] = True
            cases.append(case)
    return cases


def analyze(files, entry):
    """Returns (sorted diagnostics, errors, warnings, cases-or-None)."""
    diags = Diags()
    name, sel, folder = select_record(files, entry)
    if not sel:
        diags.add(name, 1, 'P046')
        return diags, None
    model = Reader(files, folder, diags).read(sel, name)
    if diags.items:
        return diags, None
    run_checks(model, diags, files)
    return diags, model


def op_check(inp):
    diags, _ = analyze(inp['files'], inp.get('entry'))
    return {'diagnostics': ['%s:%d: %s %s' % (f, l, lv, c) for f, l, lv, c in diags.sorted()],
            'errors': diags.count('error'), 'warnings': diags.count('warning')}


def op_cases(inp):
    diags, model = analyze(inp['files'], inp.get('entry'))
    errors = diags.count('error')
    cases = build_cases(model) if errors == 0 and model is not None else []
    return {'errors': errors, 'cases': cases}


# ---------------------------------------------------------------- judge

def _valid_check(c):
    if not isinstance(c, dict) or not isinstance(c.get('path'), str) or not isinstance(c.get('kind'), str):
        return False
    if c['kind'] == 'eq':
        return 'value' in c
    if c['kind'] == 'approx':
        return is_num(c.get('value')) and is_num(c.get('tol')) and c['tol'] >= 0
    return True


def valid_case(case):
    if not isinstance(case, dict):
        return False
    checks = case.get('checks')
    if not isinstance(checks, list) or not all(_valid_check(c) for c in checks):
        return False
    if 'full' not in case:
        return False
    full = case['full']
    if full is None:
        return True
    if not isinstance(full, dict):
        return False
    m = full.get('members')
    if not isinstance(m, list) or not all(isinstance(x, str) for x in m):
        return False
    t = full.get('tolerances')
    if not isinstance(t, dict) or not all(is_num(v) and v >= 0 for v in t.values()):
        return False
    if 'audit' in full and not isinstance(full['audit'], str):
        return False
    return True


def _result_eq(exp, act, path, tols):
    if path in tols and is_num(exp) and is_num(act):
        return abs(act - exp) <= tols[path]
    t = jtype(exp)
    if t != jtype(act):
        return False
    if t == 'dict':
        if set(exp) != set(act):
            return False
        return all(_result_eq(exp[k], act[k], path + '.' + k, tols) for k in exp)
    if t == 'list':
        return len(exp) == len(act) and all(
            _result_eq(x, y, path + '.' + str(i), tols) for i, (x, y) in enumerate(zip(exp, act)))
    return jeq(exp, act)


def op_judge(inp):
    case, answer = inp['case'], inp['answer']
    if answer is None:
        return {'pass': False, 'failed': ['answer']}
    failed = []
    for i, c in enumerate(case['checks']):
        found, v = get_path(answer, c['path'])
        if c['kind'] == 'eq':
            ok = found and jeq(v, c['value'])
        elif c['kind'] == 'approx':
            ok = found and is_num(v) and abs(v - c['value']) <= c['tol']
        else:
            ok = False
        if not ok:
            failed.append('checks.%d' % i)
    full = case['full']
    if full is not None:
        if sorted(answer, key=u16) != full['members']:
            failed.append('members')
        if 'error' in full:
            if 'error' not in answer or not jeq(answer['error'], full['error']):
                failed.append('error')
        else:
            if 'result' in full:
                if 'result' not in answer or not _result_eq(full['result'], answer['result'], 'result',
                                                            full['tolerances']):
                    failed.append('result')
            if 'audit' in full:
                if not isinstance(answer.get('audit'), str) or answer['audit'] != full['audit']:
                    failed.append('audit')
    if failed:
        return {'pass': False, 'failed': failed}
    return {'pass': True}


# ---------------------------------------------------------------- requests

def valid_name(name):
    if not isinstance(name, str) or name == '' or '\\' in name or '\0' in name:
        return False
    if re.match(r'[A-Za-z]:', name):
        return False
    return all(p not in ('', '.', '..') for p in name.split('/'))


def handle(req):
    """req: a parsed request object (dict). Returns the response dict."""
    rid = req['id']
    op = req.get('op')
    if op not in ('check', 'cases', 'judge'):
        return {'id': rid, 'error': 'unknown_op'}
    inp = req.get('input')
    if not isinstance(inp, dict):
        return {'id': rid, 'error': 'bad_request'}
    if op == 'judge':
        if 'case' not in inp or 'answer' not in inp or not valid_case(inp['case']) \
                or not (inp['answer'] is None or isinstance(inp['answer'], dict)):
            return {'id': rid, 'error': 'bad_request'}
        return {'id': rid, 'result': op_judge(inp)}
    files = inp.get('files')
    if not isinstance(files, dict) or not files or not all(isinstance(v, str) for v in files.values()) \
            or not all(valid_name(n) for n in files):
        return {'id': rid, 'error': 'bad_request'}
    prefixes = set()
    for n in files:
        parts = n.split('/')
        for i in range(1, len(parts)):
            prefixes.add('/'.join(parts[:i]))
    if any(p in files for p in prefixes):
        return {'id': rid, 'error': 'bad_request'}
    if 'entry' in inp:
        e = inp['entry']
        if not isinstance(e, str) or (e != '.' and not valid_name(e)):
            return {'id': rid, 'error': 'bad_request'}
    result = op_check(inp) if op == 'check' else op_cases(inp)
    return {'id': rid, 'result': result}
