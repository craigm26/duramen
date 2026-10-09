"""Reading a record: lines, statements, clauses and the P diagnostics."""
import re

from jsutil import (WSC, first_word, split_ws, strip_ws, lstrip_ws, rstrip_ws, jparse,
                    jparse_string, stringify)

LINE_SPLIT = re.compile(r'\r\n|\r|\n')
LEAD_RE = re.compile('^[' + WSC + ']*')
NUM = r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?'
NUM_RE = re.compile(NUM)
CORE = {'duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note'}
REST = {'type', 'edge', 'edgedef', 'property', 'evidence'}
FIELD_RE = re.compile('^([A-Za-z0-9_-]+)(\\?)?[' + WSC + ']+([^' + WSC + '].*)$', re.S)
NAME_RE = re.compile(r'^[A-Za-z0-9_-]+$')
HEAD_EXPECT_RE = re.compile('^(?:result|audit|error|id)(?:\\.[^' + WSC + ']*)?$')
EXPECT_PATH_RE = re.compile('^[^' + WSC + '=≈~]*')
APPROX_RE = re.compile('^[' + WSC + ']*(' + NUM + ')[' + WSC + ']*(?:±|\\+-)[' + WSC + ']*(' + NUM + ')$')
FROM_RE = re.compile('^(.+?)[' + WSC + ']+from[' + WSC + ']+(".*")$', re.S)
SPLIT_LIST = re.compile('[,' + WSC + ']+')


class Line:
    __slots__ = ('no', 'indent', 'text', 'blank', 'comment')

    def __init__(self, no, indent, text, blank=False):
        self.no, self.indent, self.text, self.blank = no, indent, text, blank
        self.comment = (not blank) and text.startswith('#')


class Clause:
    def __init__(self, kw, args, line):
        self.kw, self.args, self.line, self.body = kw, args, line, []


class Stmt:
    def __init__(self, kw, args, line):
        self.kw, self.args, self.line = kw, args, line
        self.clauses = []
        self.ignored = False


class Ex:
    """One example or table row."""

    def __init__(self, file, line):
        self.file, self.line = file, line
        self.raw = False
        self.raw_line = None
        self.op = None
        self.input_text = None
        self.input_obj = None
        self.input_lines = False
        self.request = {}
        self.omit = []
        self.expects = []
        self.fields = []
        self.table = False
        self.id = None
        self.resp = None

    @property
    def has_error_exp(self):
        return any(e['path'] == 'error' for e in self.expects)

    @property
    def solo(self):
        return self.raw or 'id' in self.omit

    @property
    def has_input(self):
        return self.input_text is not None or self.input_lines


class Req:
    def __init__(self, id_, file, line):
        self.id, self.file, self.line = id_, file, line
        self.platform = 'any'
        self.text = None
        self.text_line = None
        self.decisions = []
        self.exs = []


class Op:
    def __init__(self, name, file, line):
        self.name, self.file, self.line = name, file, line
        self.fields = {}
        self.tol = {}
        self.audit = False
        self.request = None
        self.result = None


class Decision:
    def __init__(self, id_, file, line):
        self.id, self.file, self.line = id_, file, line
        self.source = None
        self.status = None
        self.text = None
        self.rejected = []


class Model:
    def __init__(self):
        self.spec = None          # dict(file, line, text, request)
        self.oracle = None        # dict(cmd, file, line)
        self.errors = None        # dict(codes, conds)
        self.ops = {}
        self.op_list = []
        self.reqs = []
        self.opens = []           # dict(id, file, line, text, demo)
        self.decisions = []
        self.texts = []           # (kind, text, file, line) obligation-checked texts
        self.has_duramen = {}


class Reader:
    """Reads one record, file by file, into a Model, collecting diagnostics."""

    def __init__(self, files, root, model, diags):
        self.files, self.root, self.model, self.diags = files, root, model, diags
        self.file = None
        self.dir = ''

    def d(self, code, line, level='error'):
        self.diags.append((self.file, line, level, code))

    # ------------------------------------------------------------------ lexing
    def lex(self, text):
        if text.startswith('﻿'):
            text = text[1:]
        stmts = []
        cur = None
        for i, raw in enumerate(LINE_SPLIT.split(text)):
            no = i + 1
            s = rstrip_ws(raw)
            if s == '':
                if cur is not None and cur.clauses:
                    cur.clauses[-1].body.append(Line(no, 0, '', True))
                continue
            lead = LEAD_RE.match(s).group(0)
            if lead.strip(' ') != '':
                self.d('P001', no)
                continue
            indent = len(lead)
            content = s[indent:]
            if indent == 0:
                if content.startswith('#'):
                    continue
                kw, args = first_word(content)
                cur = Stmt(kw, args, no)
                if kw not in CORE:
                    cur.ignored = True
                    if kw not in REST:
                        self.d('P002', no)
                stmts.append(cur)
                continue
            if cur is None:
                self.d('P003', no)
                continue
            if cur.ignored:
                continue
            if indent == 1:
                self.d('P007', no)
                continue
            if indent == 2:
                if content.startswith('#'):
                    continue
                kw, args = first_word(content)
                cur.clauses.append(Clause(kw, args, no))
                continue
            if not cur.clauses:
                self.d('P006', no)
                continue
            cur.clauses[-1].body.append(Line(no, indent, content))
        return stmts

    # ----------------------------------------------------------------- helpers
    def clauses(self, st, allowed, once):
        out, seen = [], set()
        for c in st.clauses:
            if c.kw not in allowed:
                self.d('P015', c.line)
                continue
            if c.kw in once:
                if c.kw in seen:
                    self.d('P052', c.line)
                    continue
                seen.add(c.kw)
            out.append(c)
        return out

    def plain(self, c):
        for L in c.body:
            if not L.blank and not L.comment:
                self.d('P006', L.no)

    def text(self, c):
        if c.args:
            self.d('P008', c.line)
        lines = []
        for L in c.body:
            if L.blank:
                lines.append('')
            elif L.indent < 4:
                self.d('P008', L.no)
            else:
                lines.append(' ' * (L.indent - 4) + L.text)
        while lines and lines[0] == '':
            lines.pop(0)
        while lines and lines[-1] == '':
            lines.pop()
        return '\n'.join(lines)

    def quoted(self, args, line):
        v = jparse_string(args)
        if v is None:
            self.d('P004', line)
        return v

    def id_title(self, st):
        """(id, title) of section/req/open/decision, or None after a P004/P005."""
        if st.args == '':
            self.d('P005', st.line)
            return None
        id_, title = first_word(st.args)
        if len(title) >= 2 and title.startswith('"') and title.endswith('"'):
            if jparse_string(title) is None:
                self.d('P004', st.line)
                return None
            return id_, title
        self.d('P005', st.line)
        return None

    def request_obj(self, args, line):
        try:
            v = jparse(args)
        except Exception:
            self.d('P009', line)
            return None
        if not isinstance(v, dict):
            self.d('P009', line)
            return None
        if 'id' in v or 'op' in v or 'input' in v:
            self.d('P051', line)
            return None
        return v

    # -------------------------------------------------------------- statements
    def read_file(self, name, text):
        self.file = name
        self.dir = name.rsplit('/', 1)[0] if '/' in name else ''
        m = self.model
        stmts = self.lex(text)
        seen_duramen = 0
        version = None
        seen_here = {'spec': 0, 'oracle': 0}
        for st in stmts:
            if st.ignored:
                continue
            kw = st.kw
            if kw == 'duramen':
                seen_duramen += 1
                for c in st.clauses:
                    self.d('P015', c.line)
                if seen_duramen > 1:
                    self.d('P023', st.line)
                else:
                    if st.args in ('0.1', '0.2'):
                        version = st.args
                    else:
                        self.d('P023', st.line)
            elif kw == 'spec':
                self.do_spec(st)
            elif kw == 'oracle':
                self.do_oracle(st)
            elif kw == 'section':
                self.id_title(st)
                for c in self.clauses(st, {'text'}, {'text'}):
                    t = self.text(c)
                    m.texts.append(('section', t, name, st.line))
            elif kw == 'note':
                if st.args:
                    self.d('P050', st.line)
                for c in self.clauses(st, {'text'}, {'text'}):
                    m.texts.append(('note', self.text(c), name, st.line))
            elif kw == 'op':
                self.do_op(st)
            elif kw == 'errors':
                self.do_errors(st)
            elif kw == 'req':
                self.do_req(st)
            elif kw == 'open':
                self.do_open(st)
            elif kw == 'decision':
                self.do_decision(st)
        if seen_duramen == 0:
            self.d('P020', 1)
        return version

    def do_spec(self, st):
        m = self.model
        words = split_ws(st.args)
        if len(words) != 2:
            self.d('P021', st.line)
        info = {'file': self.file, 'line': st.line, 'text': None, 'request': None}
        for c in self.clauses(st, {'title', 'text', 'contract', 'request'},
                              {'title', 'text', 'contract', 'request'}):
            if c.kw == 'title':
                self.quoted(c.args, c.line)
                self.plain(c)
            elif c.kw == 'text':
                info['text'] = self.text(c)
            elif c.kw == 'contract':
                self.plain(c)
            else:
                info['request'] = self.request_obj(c.args, c.line)
                self.plain(c)
        if m.spec is None:
            m.spec = info
            if info['text'] is not None:
                m.texts.append(('spec', info['text'], self.file, st.line))
        else:
            self.d('P044', st.line)

    def do_oracle(self, st):
        m = self.model
        if st.args == '':
            self.d('P028', st.line)
        for c in self.clauses(st, {'source'}, set()):
            self.plain(c)
        if m.oracle is None:
            m.oracle = {'cmd': st.args, 'file': self.file, 'line': st.line}
        else:
            self.d('P044', st.line)

    def do_errors(self, st):
        m = self.model
        if st.args:
            self.d('P050', st.line)
        codes, conds = [], []
        for c in st.clauses:
            w, rest = first_word(c.args)
            cond = rest
            if w != 'when' or rest == '':
                self.d('P019', c.line)
            lines = [rest]
            for L in c.body:
                if L.blank:
                    lines.append('')
                elif L.indent < 4:
                    self.d('P006', L.no)
                else:
                    lines.append(' ' * (L.indent - 4) + L.text)
            while lines and lines[-1] == '':
                lines.pop()
            codes.append(c.kw)
            conds.append(('\n'.join(lines), self.file, c.line))
        if m.errors is None:
            m.errors = {'codes': codes, 'conds': conds}
        else:
            self.d('P032', st.line)

    def do_op(self, st):
        m = self.model
        words = split_ws(st.args)
        name = None
        if len(words) != 1:
            self.d('P031', st.line)
        else:
            name = words[0]
        op = Op(name, self.file, st.line)
        for c in self.clauses(st, {'input', 'result', 'tolerance', 'audit', 'request'},
                              {'result', 'audit', 'request'}):
            if c.kw == 'input':
                self.plain(c)
                for part in split_fields(c.args):
                    part = strip_ws(part)
                    mm = FIELD_RE.match(part)
                    if not mm:
                        self.d('P017', c.line)
                        continue
                    if mm.group(1) in op.fields:
                        self.d('P052', c.line)
                        continue
                    op.fields[mm.group(1)] = bool(mm.group(2))
            elif c.kw == 'result':
                self.plain(c)
                op.result = c.args
            elif c.kw == 'tolerance':
                self.plain(c)
                w = split_ws(c.args)
                if len(w) != 2 or not NUM_RE.fullmatch(w[1]) or float(w[1]) < 0:
                    self.d('P018', c.line)
                elif w[0] in op.tol:
                    self.d('P052', c.line)
                else:
                    op.tol[w[0]] = float(w[1])
            elif c.kw == 'audit':
                self.plain(c)
                if c.args not in ('', 'text'):
                    self.d('P050', c.line)
                else:
                    op.audit = True
            else:
                self.plain(c)
                op.request = self.request_obj(c.args, c.line)
        m.op_list.append(op)
        if op.result is not None:
            m.texts.append(('result', op.result, self.file, st.line))

    def do_decision(self, st):
        m = self.model
        it = self.id_title(st)
        dec = Decision(it[0] if it else None, self.file, st.line)
        for c in self.clauses(st, {'source', 'status', 'text', 'rejected'}, {'source', 'status', 'text'}):
            if c.kw == 'source':
                self.plain(c)
                dec.source = c.args
            elif c.kw == 'status':
                self.plain(c)
                dec.status = c.args
            elif c.kw == 'text':
                dec.text = self.text(c)
            else:
                self.plain(c)
                v = self.quoted(c.args, c.line)
                if v is not None:
                    dec.rejected.append(v)
        if dec.text is not None:
            m.texts.append(('decision', dec.text, self.file, st.line))
        for r in dec.rejected:
            m.texts.append(('rejected', r, self.file, st.line))
        if it:
            m.decisions.append(dec)

    def do_open(self, st):
        m = self.model
        it = self.id_title(st)
        info = {'id': it[0] if it else None, 'file': self.file, 'line': st.line, 'text': None, 'demo': []}
        for c in self.clauses(st, {'text', 'example', 'table'}, {'text'}):
            if c.kw == 'text':
                info['text'] = self.text(c)
            else:
                info['demo'].append(c.line)
        if it:
            m.opens.append(info)

    # --------------------------------------------------------------------- req
    def do_req(self, st):
        m = self.model
        it = self.id_title(st)
        req = Req(it[0] if it else None, self.file, st.line)
        for c in self.clauses(st, {'text', 'decision', 'on', 'example', 'table'}, {'text', 'on'}):
            if c.kw == 'text':
                req.text = self.text(c)
                req.text_line = c.line
            elif c.kw == 'decision':
                self.plain(c)
                req.decisions += [x for x in SPLIT_LIST.split(c.args) if x]
            elif c.kw == 'on':
                self.plain(c)
                if c.args in ('any', 'posix', 'windows'):
                    req.platform = c.args
                else:
                    self.d('P033', c.line)
            elif c.kw == 'example':
                ex = self.do_example(c)
                if ex:
                    req.exs.append(ex)
            else:
                req.exs += self.do_table(c)
        if it:
            m.reqs.append(req)

    def do_example(self, c):
        ex = Ex(self.file, c.line)
        args = c.args
        ok = True
        if args == '':
            self.d('P012', c.line)
            ok = False
        else:
            w, rest = first_word(args)
            if w == 'raw':
                ex.raw = True
                if rest.startswith('"'):
                    v = jparse_string(rest)
                    if v is None:
                        self.d('P004', c.line)
                        ok = False
                    elif '\n' in v or '\r' in v:
                        self.d('P026', c.line)
                        ok = False
                    else:
                        ex.raw_line = v
                elif rest.startswith("'") and len(rest) >= 2 and rest.endswith("'"):
                    ex.raw_line = rest[1:-1]
                else:
                    self.d('P004', c.line)
                    ok = False
            else:
                ex.op = w
                if rest != '':
                    try:
                        v = jparse(rest)
                    except Exception:
                        self.d('P009', c.line)
                        ok = False
                    else:
                        if not isinstance(v, dict):
                            self.d('P012', c.line)
                            ok = False
                        else:
                            ex.input_text = rest
                            ex.input_obj = v
        body = c.body
        i = 0
        have_request = False
        scratch = ex.input_obj
        while i < len(body):
            L = body[i]
            i += 1
            if L.blank or L.comment:
                continue
            if L.indent != 4:
                self.d('P006', L.no)
                continue
            kw, rest = first_word(L.text)
            if kw == 'expect':
                self.expect(ex, L, rest)
            elif kw == 'request':
                if ex.raw:
                    self.d('P022', L.no)
                elif have_request:
                    self.d('P052', L.no)
                else:
                    r = self.request_obj(rest, L.no)
                    if r is not None:
                        have_request = True
                        ex.request = r
            elif kw == 'omit':
                if ex.raw:
                    self.d('P022', L.no)
                else:
                    names = [x for x in SPLIT_LIST.split(rest) if x]
                    if not names:
                        self.d('P011', L.no)
                    ex.omit += names
            elif kw == 'input':
                text_lines = None
                fm = FROM_RE.match(rest)
                fname = jparse_string(fm.group(2)) if fm else None
                from_form = fname is not None
                path_text = fm.group(1) if from_form else rest
                if not from_form:
                    tl = []
                    while i < len(body) and (body[i].blank or body[i].indent >= 6):
                        b = body[i]
                        tl.append('' if b.blank else ' ' * (b.indent - 6) + b.text)
                        i += 1
                    while tl and tl[-1] == '':
                        tl.pop()
                    text_lines = tl
                if ex.raw:
                    self.d('P022', L.no)
                    continue
                names = parse_path(path_text)
                if names is None:
                    self.d('P049', L.no)
                    continue
                if from_form:
                    val = self.read_from(fname)
                    if val is None:
                        self.d('P048', L.no)
                        continue
                else:
                    if not text_lines:
                        self.d('P049', L.no)
                        continue
                    val = '\n'.join(text_lines) + '\n'
                if scratch is None:
                    scratch = {}
                if not set_path(scratch, names, val):
                    self.d('P049', L.no)
                    continue
                ex.input_lines = True
            else:
                self.d('P011', L.no)
        if not ok:
            return None
        if ex.input_lines:
            ex.input_obj = scratch
            ex.input_text = stringify(scratch)
        ex.fields = list(ex.input_obj.keys()) if ex.input_obj is not None else []
        if ex.input_lines and ex.input_obj is None:
            ex.input_obj = {}
        return ex

    def read_from(self, fname):
        if fname.startswith('/'):
            return None
        parts = self.dir.split('/') if self.dir else []
        for p in fname.split('/'):
            if p in ('', '.'):
                continue
            if p == '..':
                if not parts:
                    return None
                parts.pop()
            else:
                parts.append(p)
        root = self.root.split('/') if self.root else []
        if parts[:len(root)] != root:
            return None
        key = '/'.join(parts)
        v = self.files.get(key)
        return v if isinstance(v, str) else None

    def expect(self, ex, L, rest):
        m = EXPECT_PATH_RE.match(rest)
        path = m.group(0)
        tail = lstrip_ws(rest[m.end():])
        if path == '':
            self.d('P011', L.no)
        elif tail.startswith('='):
            v = strip_ws(tail[1:])
            if v == '?':
                ex.expects.append({'line': L.no, 'path': path, 'kind': 'oracle'})
                return
            try:
                val = jparse(v)
            except Exception:
                self.d('P009', L.no)
                return
            ex.expects.append({'line': L.no, 'path': path, 'kind': 'eq', 'value': val})
        elif tail[:1] in ('≈', '~') and tail != '':
            am = APPROX_RE.match(tail[1:])
            if not am or float(am.group(2)) < 0:
                self.d('P010', L.no)
                return
            ex.expects.append({'line': L.no, 'path': path, 'kind': 'approx',
                               'value': float(am.group(1)), 'tol': float(am.group(2))})
        else:
            self.d('P011', L.no)

    # ------------------------------------------------------------------- table
    def do_table(self, c):
        rows = []
        for L in c.body:
            if L.blank or L.comment:
                continue
            if L.indent >= 4 and L.text.startswith('|'):
                rows.append(L)
            else:
                self.d('P006', L.no)
        words = split_ws(c.args)
        if len(words) != 1:
            self.d('P013', c.line)
            return []
        data = [r for r in rows if not is_separator(r.text)]
        if len(data) < 2:
            self.d('P013', c.line)
            return []
        op = words[0]
        head = data[0]
        cols = []
        bad = False
        p010 = 0
        for cell in split_cells(head.text):
            cell = strip_ws(cell)
            mm = re.search('±|\\+-', cell)
            has_tol = bool(mm)
            base = strip_ws(cell[:mm.start()]) if mm else cell
            tolt = strip_ws(cell[mm.end():]) if mm else None
            if HEAD_EXPECT_RE.match(base):
                col = {'kind': 'expect', 'path': base, 'tol': None}
                if has_tol:
                    if NUM_RE.fullmatch(tolt) and float(tolt) >= 0:
                        col['tol'] = float(tolt)
                    else:
                        p010 += 1
            elif NAME_RE.match(base):
                col = {'kind': 'input', 'name': base}
                if has_tol:
                    p010 += 1
            else:
                bad = True
                break
            cols.append(col)
        if bad:
            self.d('P013', head.no)
            return []
        for _ in range(p010):
            self.d('P010', head.no)
        out = []
        for r in data[1:]:
            cells = [strip_ws(x) for x in split_cells(r.text)]
            if len(cells) != len(cols):
                self.d('P014', r.no)
                continue
            ex = Ex(self.file, r.no)
            ex.table = True
            ex.op = op
            parts = []
            good = True
            for col, cell in zip(cols, cells):
                if cell == '':
                    continue
                if col['kind'] == 'input':
                    try:
                        jparse(cell)
                    except Exception:
                        self.d('P009', r.no)
                        good = False
                        continue
                    parts.append(stringify(col['name']) + ':' + cell)
                    ex.fields.append(col['name'])
                else:
                    if cell == '?':
                        ex.expects.append({'line': r.no, 'path': col['path'], 'kind': 'oracle'})
                    elif col['tol'] is not None:
                        if NUM_RE.fullmatch(cell):
                            ex.expects.append({'line': r.no, 'path': col['path'], 'kind': 'approx',
                                               'value': float(cell), 'tol': col['tol']})
                        else:
                            self.d('P010', r.no)
                            good = False
                    else:
                        try:
                            val = jparse(cell)
                        except Exception:
                            self.d('P009', r.no)
                            good = False
                            continue
                        ex.expects.append({'line': r.no, 'path': col['path'], 'kind': 'eq', 'value': val})
            if good:
                ex.input_text = '{' + ','.join(parts) + '}'
                out.append(ex)
        return out


# ------------------------------------------------------------------ utilities
def split_fields(s):
    parts, cur, depth, instr, i = [], [], 0, False, 0
    while i < len(s):
        ch = s[i]
        if instr:
            cur.append(ch)
            if ch == '\\' and i + 1 < len(s):
                cur.append(s[i + 1])
                i += 1
            elif ch == '"':
                instr = False
        elif ch == '"':
            instr = True
            cur.append(ch)
        elif ch in '[{(':
            depth += 1
            cur.append(ch)
        elif ch in ']})':
            depth = max(0, depth - 1)
            cur.append(ch)
        elif ch == ',' and depth == 0:
            parts.append(''.join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    parts.append(''.join(cur))
    return parts


def is_separator(t):
    return t[0] == '|' and t[-1] == '|' and set(t) <= set('|-: ')


def split_cells(t):
    t = t[1:]
    cells, cur, i = [], [], 0
    while i < len(t):
        ch = t[i]
        if ch == '\\' and i + 1 < len(t) and t[i + 1] == '|':
            cur.append('|')
            i += 2
            continue
        if ch == '|':
            cells.append(''.join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    rest = ''.join(cur)
    if strip_ws(rest) != '':
        cells.append(rest)
    return cells


def parse_path(s):
    """Names of an input path, or None. Names are words or JSON strings, joined by dots."""
    names = []
    i, n = 0, len(s)
    if n == 0:
        return None
    while True:
        if i >= n:
            return None
        if s[i] == '"':
            m = re.compile(r'"(?:[^"\\]|\\.)*"').match(s, i)
            if not m:
                return None
            v = jparse_string(m.group(0))
            if v is None:
                return None
            names.append(v)
            i = m.end()
        else:
            m = re.compile(r'[A-Za-z0-9_-]+').match(s, i)
            if not m:
                return None
            names.append(m.group(0))
            i = m.end()
        if i == n:
            return names
        if s[i] != '.':
            return None
        i += 1


def set_path(obj, names, val):
    cur = obj
    for nm in names[:-1]:
        if nm not in cur:
            cur[nm] = {}
        elif not isinstance(cur[nm], dict):
            return False
        cur = cur[nm]
    cur[names[-1]] = val
    return True
