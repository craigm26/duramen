"""Reading a record: files, lines, statements, clauses (P diagnostics)."""
import re

from jsutil import (WS_CHARS, WS_CLASS, NOT_WS, WS_SPLIT, LINE_SPLIT, TooBig, strip, lstrip,
                    rstrip, split_word, parse_json, parse_jstring, parse_number)

VERSIONS = ('0.1', '0.2')
PLATFORMS = ('any', 'posix', 'windows')
OPEN_STATEMENTS = ('type', 'edge', 'edgedef', 'property', 'evidence')

FIELD_RE = re.compile('^([A-Za-z0-9_-]+)(\\?)?' + WS_CLASS + '+(.+)$', re.S)
JSTR_RE = re.compile(r'"(?:[^"\\]|\\.)*"', re.S)
WORD_RE = re.compile(r'[A-Za-z0-9_-]+')
FROM_RE = re.compile('^(.*)' + WS_CLASS + '+from' + WS_CLASS + '+("(?:[^"\\\\]|\\\\.)*")$', re.S)
SEP_SPLIT = re.compile('(?:,|' + WS_CLASS + ')+')
PATH_END = re.compile('[^' + re.escape(WS_CHARS) + '=≈~]*')
NUM = r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?'
APPROX_RE = re.compile('^(' + NUM + ')' + WS_CLASS + '*(?:±|\\+-)' + WS_CLASS + '*(' + NUM + ')$')
HEADER_PATH_RE = re.compile(r'(?:result|audit|error|id)(?:\..*)?', re.S)
HEADER_FIELD_RE = re.compile(r'[A-Za-z0-9_-]+')


class Stmt:
    def __init__(self, line, kw, rest):
        self.line = line
        self.kw = kw
        self.rest = rest
        self.body = []


class Clause:
    def __init__(self, line, kw, rest):
        self.line = line
        self.kw = kw
        self.rest = rest
        self.lines = []


class Expect:
    def __init__(self, kind, path, line, value=None, tol=None):
        self.kind = kind          # 'eq' | 'approx' | 'oracle'
        self.path = path
        self.line = line
        self.value = value
        self.tol = tol


class Example:
    def __init__(self, file, line):
        self.file = file
        self.line = line
        self.op = None
        self.raw_line = None
        self.input_text = None
        self.input_obj = None
        self.has_input_lines = False
        self.request = {}
        self.omit = set()
        self.expects = []

    @property
    def raw(self):
        return self.raw_line is not None

    @property
    def expects_error(self):
        return any(e.path == 'error' for e in self.expects)


class Op:
    def __init__(self, file, line, name):
        self.file = file
        self.line = line
        self.name = name
        self.fields = []          # (name, optional)
        self.result = None
        self.result_line = line
        self.tolerances = {}
        self.audit = False
        self.request = None


class Req:
    def __init__(self, file, line, rid):
        self.file = file
        self.line = line
        self.id = rid
        self.text = None
        self.text_line = line
        self.decisions = []
        self.platform = 'any'
        self.items = []
        self.static = False


class Decision:
    def __init__(self, file, line, did):
        self.file = file
        self.line = line
        self.id = did
        self.source = None
        self.status = None
        self.text = None
        self.rejected = []


def split_fields(rest):
    """Split at commas outside double quotes and outside brackets (counted together)."""
    out = []
    cur = []
    depth = 0
    inq = False
    i = 0
    n = len(rest)
    while i < n:
        ch = rest[i]
        if inq:
            cur.append(ch)
            if ch == '\\' and i + 1 < n:
                cur.append(rest[i + 1])
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
            out.append(''.join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    out.append(''.join(cur))
    return out


def parse_path(s):
    segs = []
    i = 0
    n = len(s)
    if n == 0:
        return None
    while True:
        if i >= n:
            return None
        if s[i] == '"':
            m = JSTR_RE.match(s, i)
            if not m:
                return None
            v = parse_jstring(m.group(0))
            if v is None:
                return None
            segs.append(v)
            i = m.end()
        else:
            m = WORD_RE.match(s, i)
            if not m:
                return None
            segs.append(m.group(0))
            i = m.end()
        if i == n:
            return segs
        if s[i] != '.':
            return None
        i += 1


def set_path(obj, segs, value, dry=False):
    """Put value at the path; False when the path goes through a value that is no object."""
    cur = obj
    for s in segs[:-1]:
        if s in cur:
            if not isinstance(cur[s], dict):
                return False
            cur = cur[s]
        else:
            if dry:
                return True
            cur[s] = {}
            cur = cur[s]
    if not dry:
        cur[segs[-1]] = value
    return True


def resolve_file(example_file, name):
    """Path of a `from` file relative to the example's file folder, or None if it leaves everything."""
    stack = example_file.split('/')[:-1]
    for part in name.split('/'):
        if part == '' or part == '.':
            continue
        if part == '..':
            if not stack:
                return None
            stack.pop()
        else:
            stack.append(part)
    return '/'.join(stack)


class Reader:
    def __init__(self, files, label, folder):
        self.files = files
        self.label = label
        self.folder = folder          # '' or 'a/b' (no trailing slash)
        self.diags = []
        self.file = None
        self.spec = None
        self.spec_seen = False
        self.oracle = None
        self.oracle_seen = False
        self.errors_seen = False
        self.error_codes = []
        self.error_conds = []         # (file, line, [lines])
        self.ops = []
        self.reqs = []
        self.opens = []
        self.decisions = []
        self.sections = []
        self.notes = []
        self.versions = []

    # -- diagnostics ------------------------------------------------------
    def d(self, line, code, level='error'):
        self.diags.append((self.file, line, level, code))

    def d_at(self, file, line, code, level='error'):
        self.diags.append((file, line, level, code))

    # -- whole record -----------------------------------------------------
    def read(self, names):
        for name in names:
            self.read_file(name, self.files[name])
        if not self.spec_seen:
            self.d_at(self.label, 1, 'P021')
        if len(set(self.versions)) > 1:
            self.d_at(self.label, 1, 'P047')

    # -- lines ------------------------------------------------------------
    def read_file(self, name, text):
        self.file = name
        if text.startswith('﻿'):
            text = text[1:]
        lines = []
        for i, raw in enumerate(LINE_SPLIT.split(text), 1):
            s = rstrip(raw)
            if s == '':
                lines.append((i, 0, ''))
                continue
            k = len(s) - len(lstrip(s))
            if s[:k].strip(' ') != '':
                self.d(i, 'P001')
                continue
            lines.append((i, k, s[k:]))
        stmts = []
        cur = None
        for ln, ind, c in lines:
            if c == '':
                if cur is not None:
                    cur.body.append((ln, 0, ''))
                continue
            if ind == 0:
                if c.startswith('#'):
                    continue
                kw, rest = split_word(c)
                cur = Stmt(ln, kw, rest)
                stmts.append(cur)
            else:
                if cur is None:
                    self.d(ln, 'P003')
                else:
                    cur.body.append((ln, ind, c))
        self.seen_duramen = False
        self.f_version = None
        for st in stmts:
            self.statement(st)
        if not self.seen_duramen:
            self.d(1, 'P020')
        if self.f_version is not None:
            self.versions.append(self.f_version)

    def group_clauses(self, st):
        out = []
        cur = None
        for ln, ind, c in st.body:
            if c == '':
                if cur is not None:
                    cur.lines.append((ln, 0, ''))
                continue
            if ind == 1:
                self.d(ln, 'P007')
                continue
            if ind == 2:
                if c.startswith('#'):
                    continue
                kw, rest = split_word(c)
                cur = Clause(ln, kw, rest)
                out.append(cur)
                continue
            if cur is None:
                self.d(ln, 'P006')
                continue
            cur.lines.append((ln, ind, c))
        return out

    def no_lines(self, c):
        for ln, ind, t in c.lines:
            if t != '' and not t.startswith('#'):
                self.d(ln, 'P006')

    def run_clauses(self, st, table):
        seen = set()
        for c in self.group_clauses(st):
            ent = table.get(c.kw)
            if ent is None:
                self.d(c.line, 'P015')
                continue
            fn, once = ent
            if once:
                if c.kw in seen:
                    self.d(c.line, 'P052')
                    continue
                seen.add(c.kw)
            fn(c)

    def read_text(self, c):
        if c.rest != '':
            self.d(c.line, 'P008')
        out = []
        for ln, ind, t in c.lines:
            if t == '':
                out.append('')
            elif ind < 4:
                self.d(ln, 'P008')
            else:
                out.append(' ' * (ind - 4) + t)
        while out and out[0] == '':
            out.pop(0)
        while out and out[-1] == '':
            out.pop()
        return out

    def read_request(self, text, line):
        try:
            v = parse_json(text)
        except ValueError:
            self.d(line, 'P009')
            return None
        if not isinstance(v, dict):
            self.d(line, 'P009')
            return None
        if 'id' in v or 'op' in v or 'input' in v:
            self.d(line, 'P051')
            return None
        return v

    def id_title(self, st):
        w, rest = split_word(st.rest)
        if len(rest) >= 2 and rest[0] == '"' and rest[-1] == '"':
            if parse_jstring(rest) is None:
                self.d(st.line, 'P004')
        else:
            self.d(st.line, 'P005')
        return w

    # -- statements -------------------------------------------------------
    def statement(self, st):
        kw = st.kw
        fn = {
            'duramen': self.s_duramen, 'spec': self.s_spec, 'oracle': self.s_oracle,
            'section': self.s_section, 'op': self.s_op, 'errors': self.s_errors,
            'req': self.s_req, 'open': self.s_open, 'decision': self.s_decision,
            'note': self.s_note,
        }.get(kw)
        if fn is not None:
            fn(st)
        elif kw in OPEN_STATEMENTS:
            return
        else:
            self.d(st.line, 'P002')

    def s_duramen(self, st):
        if self.seen_duramen:
            self.d(st.line, 'P023')
        else:
            self.seen_duramen = True
            if st.rest in VERSIONS:
                self.f_version = st.rest
            else:
                self.d(st.line, 'P023')
        self.run_clauses(st, {})

    def s_spec(self, st):
        first = not self.spec_seen
        if first:
            self.spec_seen = True
        else:
            self.d(st.line, 'P044')
        words = [w for w in WS_SPLIT.split(st.rest) if w]
        if len(words) != 2:
            self.d(st.line, 'P021')
        sp = {'file': self.file, 'line': st.line, 'text': None, 'request': None}
        if first:
            self.spec = sp

        def title(c):
            if parse_jstring(c.rest) is None:
                self.d(c.line, 'P004')
            self.no_lines(c)

        def text(c):
            sp['text'] = self.read_text(c)

        def contract(c):
            self.no_lines(c)

        def request(c):
            sp['request'] = self.read_request(c.rest, c.line)
            self.no_lines(c)

        self.run_clauses(st, {'title': (title, True), 'text': (text, True),
                              'contract': (contract, True), 'request': (request, True)})

    def s_oracle(self, st):
        first = not self.oracle_seen
        if first:
            self.oracle_seen = True
            self.oracle = {'file': self.file, 'line': st.line, 'command': st.rest}
        else:
            self.d(st.line, 'P044')
        if st.rest == '':
            self.d(st.line, 'P028')
        self.run_clauses(st, {'source': (self.no_lines, False)})

    def s_section(self, st):
        self.id_title(st)
        sec = {'file': self.file, 'line': st.line, 'text': None}
        self.sections.append(sec)

        def text(c):
            sec['text'] = self.read_text(c)

        self.run_clauses(st, {'text': (text, True)})

    def s_note(self, st):
        if st.rest != '':
            self.d(st.line, 'P050')
        note = {'file': self.file, 'line': st.line, 'text': None}
        self.notes.append(note)

        def text(c):
            note['text'] = self.read_text(c)

        self.run_clauses(st, {'text': (text, True)})

    def s_op(self, st):
        ok = st.rest != '' and not WS_SPLIT.search(st.rest)
        if not ok:
            self.d(st.line, 'P031')
        op = Op(self.file, st.line, st.rest if ok else None)
        if ok:
            self.ops.append(op)

        def inp(c):
            for f in split_fields(c.rest):
                f = strip(f)
                m = FIELD_RE.match(f)
                if not m:
                    self.d(c.line, 'P017')
                    continue
                name = m.group(1)
                if any(n == name for n, _ in op.fields):
                    self.d(c.line, 'P052')
                else:
                    op.fields.append((name, m.group(2) == '?'))
            self.no_lines(c)

        def result(c):
            op.result = c.rest
            op.result_line = c.line
            self.no_lines(c)

        def tolerance(c):
            path, num = split_word(c.rest)
            if path == '':
                self.d(c.line, 'P018')
            else:
                status, v = parse_number(num)
                if status != 'ok' or v < 0:
                    self.d(c.line, 'P018')
                elif path in op.tolerances:
                    self.d(c.line, 'P052')
                else:
                    op.tolerances[path] = abs(v)
            self.no_lines(c)

        def audit(c):
            if c.rest in ('', 'text'):
                op.audit = True
            else:
                self.d(c.line, 'P050')
            self.no_lines(c)

        def request(c):
            op.request = self.read_request(c.rest, c.line)
            self.no_lines(c)

        self.run_clauses(st, {'input': (inp, False), 'result': (result, True),
                              'tolerance': (tolerance, False), 'audit': (audit, True),
                              'request': (request, True), 'returns': (lambda c: None, False)})

    def s_errors(self, st):
        first = not self.errors_seen
        if first:
            self.errors_seen = True
        else:
            self.d(st.line, 'P032')
        if st.rest != '':
            self.d(st.line, 'P050')
        for c in self.group_clauses(st):
            w, r = split_word(c.rest)
            cond = None
            if w != 'when' or r == '':
                self.d(c.line, 'P019')
            else:
                cond = [r]
            for ln, ind, t in c.lines:
                if t == '':
                    continue
                if ind < 4:
                    self.d(ln, 'P006')
                elif cond is not None:
                    cond.append(t)
            if cond is not None and first:
                self.error_codes.append(c.kw)
                self.error_conds.append((self.file, c.line, cond))

    def s_open(self, st):
        self.id_title(st)
        ob = {'file': self.file, 'line': st.line, 'text': None, 'tests': []}
        self.opens.append(ob)

        def text(c):
            ob['text'] = self.read_text(c)

        def test(c):
            ob['tests'].append(c.line)

        self.run_clauses(st, {'text': (text, True), 'example': (test, False),
                              'table': (test, False)})
        ob['id'] = split_word(st.rest)[0]

    def s_decision(self, st):
        did = self.id_title(st)
        dec = Decision(self.file, st.line, did)
        self.decisions.append(dec)

        def source(c):
            dec.source = c.rest
            self.no_lines(c)

        def status(c):
            dec.status = c.rest
            self.no_lines(c)

        def text(c):
            dec.text = self.read_text(c)

        def rejected(c):
            v = parse_jstring(c.rest)
            if v is None:
                self.d(c.line, 'P004')
            else:
                dec.rejected.append(v)
            self.no_lines(c)

        self.run_clauses(st, {'source': (source, True), 'status': (status, True),
                              'text': (text, True), 'rejected': (rejected, False)})

    def s_req(self, st):
        rid = self.id_title(st)
        req = Req(self.file, st.line, rid)
        self.reqs.append(req)

        def text(c):
            req.text = self.read_text(c)
            req.text_line = c.line

        def decision(c):
            req.decisions.extend(x for x in SEP_SPLIT.split(c.rest) if x)
            self.no_lines(c)

        def on(c):
            if c.rest in PLATFORMS:
                req.platform = c.rest
            else:
                self.d(c.line, 'P033')
            self.no_lines(c)

        def static(c):
            req.static = True

        self.run_clauses(st, {'text': (text, True), 'decision': (decision, False),
                              'on': (on, True), 'example': (lambda c: self.read_example(c, req), False),
                              'table': (lambda c: self.read_table(c, req), False),
                              'static': (static, False)})

    # -- expectations -----------------------------------------------------
    def parse_expect(self, rest, line):
        m = PATH_END.match(rest)
        path = m.group(0)
        after = lstrip(rest[len(path):])
        if path == '':
            self.d(line, 'P011')
            return None
        if after.startswith('='):
            v = strip(after[1:])
            if v == '?':
                return Expect('oracle', path, line)
            try:
                return Expect('eq', path, line, value=parse_json(v))
            except ValueError:
                self.d(line, 'P009')
                return None
        if after.startswith('≈') or after.startswith('~'):
            m2 = APPROX_RE.match(strip(after[1:]))
            if m2:
                s1, v1 = parse_number(m2.group(1))
                s2, v2 = parse_number(m2.group(2))
                if s1 == 'ok' and s2 == 'ok' and v2 >= 0:
                    return Expect('approx', path, line, value=v1, tol=v2)
            self.d(line, 'P010')
            return None
        self.d(line, 'P011')
        return None

    # -- examples ---------------------------------------------------------
    def read_example(self, c, req):
        ex = Example(self.file, c.line)
        ok = True
        is_raw = False
        rest = c.rest
        if rest == '':
            self.d(c.line, 'P012')
            ok = False
        else:
            w, r = split_word(rest)
            if w == 'raw':
                is_raw = True
                line = None
                if r.startswith('"'):
                    line = parse_jstring(r)
                elif len(r) >= 2 and r[0] == "'" and r[-1] == "'":
                    line = r[1:-1]
                if line is None:
                    self.d(c.line, 'P004')
                    ok = False
                elif '\r' in line or '\n' in line:
                    self.d(c.line, 'P026')
                    ok = False
                else:
                    ex.raw_line = line
            else:
                ex.op = w
                if r != '':
                    try:
                        v = parse_json(r)
                    except ValueError:
                        self.d(c.line, 'P009')
                        ok = False
                    else:
                        if isinstance(v, dict):
                            ex.input_text = r
                            ex.input_obj = v
                        else:
                            self.d(c.line, 'P012')
                            ok = False
        raw = is_raw
        cur_input = dict(ex.input_obj) if ex.input_obj is not None else None
        have_request = False
        lines = c.lines
        n = len(lines)
        i = 0
        while i < n:
            ln, ind, t = lines[i]
            i += 1
            if t == '' or t.startswith('#'):
                continue
            if ind != 4:
                self.d(ln, 'P006')
                continue
            kw, r = split_word(t)
            if kw == 'expect':
                e = self.parse_expect(r, ln)
                if e is not None:
                    ex.expects.append(e)
            elif kw == 'request':
                if raw:
                    self.d(ln, 'P022')
                elif have_request:
                    self.d(ln, 'P052')
                else:
                    v = self.read_request(r, ln)
                    if v is not None:
                        have_request = True
                        ex.request = v
            elif kw == 'omit':
                if raw:
                    self.d(ln, 'P022')
                else:
                    names = [x for x in SEP_SPLIT.split(r) if x]
                    if not names:
                        self.d(ln, 'P011')
                    ex.omit.update(names)
            elif kw == 'input':
                m = FROM_RE.match(r)
                fname = parse_jstring(m.group(2)) if m else None
                is_from = fname is not None
                text = None
                if not is_from:
                    buf = []
                    while i < n:
                        ln2, ind2, t2 = lines[i]
                        if t2 == '':
                            buf.append('')
                        elif ind2 >= 6:
                            buf.append(' ' * (ind2 - 6) + t2)
                        else:
                            break
                        i += 1
                    while buf and buf[-1] == '':
                        buf.pop()
                    if buf:
                        text = ''.join(x + '\n' for x in buf)
                if raw:
                    self.d(ln, 'P022')
                    continue
                path = parse_path(m.group(1) if is_from else r)
                if path is None:
                    self.d(ln, 'P049')
                    continue
                if cur_input is None:
                    cur_input = {}
                ex.has_input_lines = True
                if is_from:
                    target = resolve_file(self.file, fname)
                    if (target is None or target not in self.files
                            or not (self.folder == '' or target.startswith(self.folder + '/'))):
                        self.d(ln, 'P048')
                        continue
                    value = self.files[target]
                else:
                    value = text
                if not set_path(cur_input, path, None, dry=True):
                    self.d(ln, 'P049')
                    continue
                if value is None:
                    self.d(ln, 'P049')
                    continue
                set_path(cur_input, path, value)
            else:
                self.d(ln, 'P011')
        if ex.has_input_lines or cur_input is not None:
            ex.input_obj = cur_input
        if ok:
            req.items.append(ex)

    # -- tables -----------------------------------------------------------
    @staticmethod
    def split_cells(content):
        body = content[1:]
        cells = []
        cur = []
        i = 0
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
        if last != '':
            cells.append(last)
        return [strip(x) for x in cells]

    @staticmethod
    def is_separator(content):
        if not (content.startswith('|') and content.endswith('|')):
            return False
        return all(ch in '|-: ' or ch in WS_CHARS for ch in content)

    def read_table(self, c, req):
        rows = []
        for ln, ind, t in c.lines:
            if t == '' or t.startswith('#'):
                continue
            if t.startswith('|') and ind >= 4:
                if not self.is_separator(t):
                    rows.append((ln, self.split_cells(t)))
            else:
                self.d(ln, 'P006')
        words = [w for w in WS_SPLIT.split(c.rest) if w]
        if len(words) != 1 or len(rows) < 2:
            self.d(c.line, 'P013')
            return
        op = words[0]
        hline, hcells = rows[0]
        cols = []
        seen = set()
        for cell in hcells:
            i = 0
            while i < len(cell) and cell[i] not in WS_CHARS and cell[i] != '±' \
                    and not cell.startswith('+-', i):
                i += 1
            name = cell[:i]
            rest = lstrip(cell[i:])
            tolpart = None
            form = True
            if rest == '':
                pass
            elif rest.startswith('±'):
                tolpart = strip(rest[1:])
            elif rest.startswith('+-'):
                tolpart = strip(rest[2:])
            else:
                form = False
            if HEADER_PATH_RE.fullmatch(name):
                kind = 'expect'
            elif HEADER_FIELD_RE.fullmatch(name):
                kind = 'input'
            else:
                kind = None
            if not form or kind is None or name in seen:
                self.d(hline, 'P013')
                return
            seen.add(name)
            tol = None
            if tolpart is not None:
                status, v = parse_number(tolpart)
                if kind == 'input' or status != 'ok' or v < 0:
                    self.d(hline, 'P010')
                else:
                    tol = v
            cols.append((name, kind, tol))
        for ln, cells in rows[1:]:
            if len(cells) != len(cols):
                self.d(ln, 'P014')
                continue
            ex = Example(self.file, ln)
            ex.op = op
            parts = []
            for (name, kind, tol), cell in zip(cols, cells):
                if cell == '':
                    continue
                if kind == 'input':
                    try:
                        parse_json(cell)
                    except ValueError:
                        self.d(ln, 'P009')
                        continue
                    parts.append('"%s":%s' % (name, cell))
                elif cell == '?':
                    ex.expects.append(Expect('oracle', name, ln))
                elif tol is not None:
                    status, v = parse_number(cell)
                    if status != 'ok':
                        self.d(ln, 'P010')
                    else:
                        ex.expects.append(Expect('approx', name, ln, value=v, tol=tol))
                else:
                    try:
                        ex.expects.append(Expect('eq', name, ln, value=parse_json(cell)))
                    except ValueError:
                        self.d(ln, 'P009')
            ex.input_text = '{' + ','.join(parts) + '}'
            try:
                ex.input_obj = parse_json(ex.input_text)
            except ValueError:
                ex.input_obj = {}
            ex.table = True
            req.items.append(ex)
