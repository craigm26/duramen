"""Reading a record: files, statements, clauses (P codes)."""
import re

from jsonx import parse as jparse, JsonError

WS = ''.join(chr(c) for c in
             [9, 10, 11, 12, 13, 32, 0xA0, 0x1680] + list(range(0x2000, 0x200B)) +
             [0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF])
_W = re.escape(WS)
_HEAD = re.compile('([^' + _W + ']*)[' + _W + ']*(.*)', re.S)
_LINE_SPLIT = re.compile(r'\r\n|\r|\n')
_FIELD = re.compile('^([A-Za-z0-9_-]+)(\\?)?[' + _W + ']+(\\S.*)$', re.S)
_FROM = re.compile('^(.*?)[' + _W + ']+from[' + _W + ']+("(?:[^"\\\\]|\\\\.)*")$', re.S)
_WORD = re.compile(r'[A-Za-z0-9_-]+')
_EXPECT_PATH = re.compile(r'^(result|audit|error|id)(\..*)?$', re.S)
_FIELD_NAME = re.compile(r'^[A-Za-z0-9_-]+$')
_SPLIT_WS = re.compile('[' + _W + ']+')

OPEN_STATEMENTS = ('type', 'edge', 'edgedef', 'property', 'evidence')
CORE_VERSIONS = ('0.1', '0.2')


def split_head(s):
    m = _HEAD.match(s)
    return m.group(1), m.group(2)


def words(s):
    return [w for w in _SPLIT_WS.split(s) if w]


def strip_ws(s):
    return s.strip(WS)


class Ln:
    __slots__ = ('no', 'indent', 's', 'blank')

    def __init__(self, no, indent, s, blank=False):
        self.no, self.indent, self.s, self.blank = no, indent, s, blank


class Statement:
    def __init__(self, no, head):
        self.no = no
        self.kw, self.rest = split_head(head)
        self.body = []


class Clause:
    def __init__(self, no, kw, rest):
        self.no, self.kw, self.rest = no, kw, rest
        self.lines = []


# ------------------------------------------------------------------ model

class Spec:
    def __init__(self, file, line):
        self.file, self.line = file, line
        self.name = self.version = self.title = self.text = self.contract = None
        self.request = None


class Oracle:
    def __init__(self, file, line, command):
        self.file, self.line, self.command = file, line, command


class Op:
    def __init__(self, file, line, name):
        self.file, self.line, self.name = file, line, name
        self.fields = {}
        self.tolerances = {}
        self.audit = False
        self.request = None
        self.result = None


class Expect:
    def __init__(self, line, path, kind, value=None, tol=None):
        self.line, self.path, self.kind, self.value, self.tol = line, path, kind, value, tol


class Example:
    def __init__(self, line):
        self.line = line
        self.raw = False
        self.raw_line = None
        self.op = None
        self.input_text = None
        self.input_obj = None
        self.input_lines = False
        self.request = {}
        self.request_read = False
        self.omit = []
        self.expects = []
        self.table_row = False
        self.cells = []          # table rows: (field, cell text)
        self.valid = True


class Req:
    def __init__(self, file, line, id_):
        self.file, self.line, self.id = file, line, id_
        self.text = None
        self.text_line = None
        self.platform = 'any'
        self.decisions = []
        self.items = []
        self.static = False


class Decision:
    def __init__(self, file, line, id_):
        self.file, self.line, self.id = file, line, id_
        self.source = None
        self.status = None
        self.text = None
        self.rejected = []


class OpenItem:
    def __init__(self, file, line, id_):
        self.file, self.line, self.id = file, line, id_
        self.text = None
        self.test_lines = []


class Plain:
    def __init__(self, file, line):
        self.file, self.line = file, line
        self.text = None


class ErrorsList:
    def __init__(self, file, line):
        self.file, self.line = file, line
        self.items = []     # (code, line, [condition lines])


class FileInfo:
    def __init__(self, name):
        self.name = name
        self.version = None
        self.has_duramen = False


class Ctx:
    def __init__(self, files, folder):
        self.files = files
        self.folder = folder          # '' or a folder name; the record's folder
        self.diags = []
        self.spec = None
        self.oracle = None
        self.errors = None
        self.reqs = []
        self.ops = []
        self.opens = []
        self.decisions = []
        self.sections = []
        self.notes = []
        self.fileinfos = []

    def d(self, file, line, code, level='error'):
        self.diags.append((file, line, code, level))


# ------------------------------------------------------------------ files

def read_file(ctx, fname, text):
    fi = FileInfo(fname)
    ctx.fileinfos.append(fi)
    if text.startswith('﻿'):
        text = text[1:]
    statements = []
    cur = None
    for no, line in enumerate(_LINE_SPLIT.split(text), 1):
        t = line.rstrip(WS)
        if t == '':
            if cur is not None:
                cur.body.append(Ln(no, 0, '', True))
            continue
        s = t.lstrip(WS)
        lead = t[:len(t) - len(s)]
        if any(ch != ' ' for ch in lead):
            ctx.d(fname, no, 'P001')
            continue
        indent = len(lead)
        if indent == 0:
            if s.startswith('#'):
                continue
            cur = Statement(no, s)
            statements.append(cur)
        else:
            if cur is None:
                ctx.d(fname, no, 'P003')
                continue
            cur.body.append(Ln(no, indent, s))
    for st in statements:
        read_statement(ctx, fi, st)
    if not fi.has_duramen:
        ctx.d(fname, 1, 'P020')


def split_clauses(ctx, fname, st):
    clauses = []
    cur = None
    for ln in st.body:
        if ln.blank:
            if cur is not None:
                cur.lines.append(ln)
            continue
        if ln.indent == 1:
            ctx.d(fname, ln.no, 'P007')
            continue
        if ln.indent == 2:
            if ln.s.startswith('#'):
                continue
            kw, rest = split_head(ln.s)
            cur = Clause(ln.no, kw, rest)
            clauses.append(cur)
        else:
            if cur is None:
                ctx.d(fname, ln.no, 'P006')
                continue
            cur.lines.append(ln)
    return clauses


def walk(ctx, fname, st, table):
    """table maps keyword -> (handler, once)."""
    seen = set()
    for c in split_clauses(ctx, fname, st):
        ent = table.get(c.kw)
        if ent is None:
            ctx.d(fname, c.no, 'P015')
            continue
        handler, once = ent
        if once:
            if c.kw in seen:
                ctx.d(fname, c.no, 'P052')
                continue
            seen.add(c.kw)
        handler(c)


def no_lines(ctx, fname, c):
    for ln in c.lines:
        if not ln.blank and not ln.s.startswith('#'):
            ctx.d(fname, ln.no, 'P006')


def read_text(ctx, fname, c):
    if c.rest != '':
        ctx.d(fname, c.no, 'P008')
    out = []
    for ln in c.lines:
        if ln.blank:
            out.append('')
        elif ln.indent < 4:
            ctx.d(fname, ln.no, 'P008')
        else:
            out.append(' ' * (ln.indent - 4) + ln.s)
    while out and out[0] == '':
        out.pop(0)
    while out and out[-1] == '':
        out.pop()
    return '\n'.join(out)


def quoted(ctx, fname, no, s):
    try:
        v = jparse(s)
        if isinstance(v, str):
            return v
    except JsonError:
        pass
    ctx.d(fname, no, 'P004')
    return None


def parse_id_title(ctx, fname, no, rest):
    """Returns the ID (or None) after reporting problems."""
    if rest == '':
        ctx.d(fname, no, 'P005')
        return None, None
    id_, t = split_head(rest)
    if len(t) < 2 or not t.startswith('"') or not t.endswith('"'):
        ctx.d(fname, no, 'P005')
        return id_, None
    title = quoted(ctx, fname, no, t)
    return id_, title


def parse_members(ctx, fname, no, rest):
    try:
        v = jparse(rest)
    except JsonError:
        ctx.d(fname, no, 'P009')
        return None
    if not isinstance(v, dict):
        ctx.d(fname, no, 'P009')
        return None
    if 'id' in v or 'op' in v or 'input' in v:
        ctx.d(fname, no, 'P051')
        return None
    return v


def read_statement(ctx, fi, st):
    fname = fi.name
    kw = st.kw
    if kw == 'duramen':
        read_duramen(ctx, fi, st)
    elif kw == 'spec':
        read_spec(ctx, fi, st)
    elif kw == 'oracle':
        read_oracle(ctx, fi, st)
    elif kw == 'section':
        read_section(ctx, fi, st)
    elif kw == 'op':
        read_op(ctx, fi, st)
    elif kw == 'errors':
        read_errors(ctx, fi, st)
    elif kw == 'req':
        read_req(ctx, fi, st)
    elif kw == 'open':
        read_open(ctx, fi, st)
    elif kw == 'decision':
        read_decision(ctx, fi, st)
    elif kw == 'note':
        read_note(ctx, fi, st)
    elif kw in OPEN_STATEMENTS:
        pass
    else:
        ctx.d(fname, st.no, 'P002')


def read_duramen(ctx, fi, st):
    fname = fi.name
    if fi.has_duramen:
        ctx.d(fname, st.no, 'P023')
    else:
        fi.has_duramen = True
        if st.rest in CORE_VERSIONS:
            fi.version = st.rest
        else:
            ctx.d(fname, st.no, 'P023')
    walk(ctx, fname, st, {})


def read_spec(ctx, fi, st):
    fname = fi.name
    sp = Spec(fname, st.no)
    ws = words(st.rest)
    if len(ws) != 2:
        ctx.d(fname, st.no, 'P021')
    else:
        sp.name, sp.version = ws
    if ctx.spec is None:
        ctx.spec = sp
    else:
        ctx.d(fname, st.no, 'P044')

    def title(c):
        sp.title = quoted(ctx, fname, c.no, c.rest)
        no_lines(ctx, fname, c)

    def text(c):
        sp.text = read_text(ctx, fname, c)

    def contract(c):
        sp.contract = c.rest or None
        no_lines(ctx, fname, c)

    def request(c):
        sp.request = parse_members(ctx, fname, c.no, c.rest)
        no_lines(ctx, fname, c)

    walk(ctx, fname, st, {'title': (title, True), 'text': (text, True),
                          'contract': (contract, True), 'request': (request, True)})


def read_oracle(ctx, fi, st):
    fname = fi.name
    if st.rest == '':
        ctx.d(fname, st.no, 'P028')
    if ctx.oracle is None:
        ctx.oracle = Oracle(fname, st.no, st.rest)
    else:
        ctx.d(fname, st.no, 'P044')

    def source(c):
        no_lines(ctx, fname, c)

    walk(ctx, fname, st, {'source': (source, False)})


def read_section(ctx, fi, st):
    fname = fi.name
    id_, _ = parse_id_title(ctx, fname, st.no, st.rest)
    sec = Plain(fname, st.no)
    ctx.sections.append(sec)

    def text(c):
        sec.text = read_text(ctx, fname, c)

    walk(ctx, fname, st, {'text': (text, True)})


def read_note(ctx, fi, st):
    fname = fi.name
    if st.rest != '':
        ctx.d(fname, st.no, 'P050')
    note = Plain(fname, st.no)
    ctx.notes.append(note)

    def text(c):
        note.text = read_text(ctx, fname, c)

    walk(ctx, fname, st, {'text': (text, True)})


def split_fields(s):
    out = []
    cur = []
    depth = 0
    inq = False
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if inq:
            cur.append(c)
            if c == '\\' and i + 1 < n:
                cur.append(s[i + 1])
                i += 2
                continue
            if c == '"':
                inq = False
        elif c == '"':
            inq = True
            cur.append(c)
        elif c in '[{(':
            depth += 1
            cur.append(c)
        elif c in ']})':
            if depth > 0:
                depth -= 1
            cur.append(c)
        elif c == ',' and depth == 0:
            out.append(''.join(cur))
            cur = []
        else:
            cur.append(c)
        i += 1
    out.append(''.join(cur))
    return out


def read_op(ctx, fi, st):
    fname = fi.name
    ws = words(st.rest)
    if len(ws) != 1:
        ctx.d(fname, st.no, 'P031')
    op = Op(fname, st.no, ws[0] if ws else '')
    ctx.ops.append(op)

    def inp(c):
        no_lines(ctx, fname, c)
        for f in split_fields(c.rest):
            m = _FIELD.match(strip_ws(f))
            if not m:
                ctx.d(fname, c.no, 'P017')
            elif m.group(1) in op.fields:
                ctx.d(fname, c.no, 'P052')
            else:
                op.fields[m.group(1)] = m.group(2) == '?'

    def result(c):
        op.result = c.rest
        no_lines(ctx, fname, c)

    def tolerance(c):
        no_lines(ctx, fname, c)
        path, num = split_head(c.rest)
        v = None
        if path != '':
            try:
                v = jparse(num)
            except JsonError:
                v = None
        if not isinstance(v, float) or v < 0:
            ctx.d(fname, c.no, 'P018')
        elif path in op.tolerances:
            ctx.d(fname, c.no, 'P052')
        else:
            op.tolerances[path] = v

    def audit(c):
        if c.rest not in ('', 'text'):
            ctx.d(fname, c.no, 'P050')
        op.audit = True
        no_lines(ctx, fname, c)

    def request(c):
        op.request = parse_members(ctx, fname, c.no, c.rest)
        no_lines(ctx, fname, c)

    def returns(c):
        pass

    walk(ctx, fname, st, {'input': (inp, False), 'result': (result, True),
                          'tolerance': (tolerance, False), 'audit': (audit, True),
                          'request': (request, True), 'returns': (returns, False)})


def read_errors(ctx, fi, st):
    fname = fi.name
    if st.rest != '':
        ctx.d(fname, st.no, 'P050')
    el = ErrorsList(fname, st.no)
    if ctx.errors is None:
        ctx.errors = el
    else:
        ctx.d(fname, st.no, 'P032')
    for c in split_clauses(ctx, fname, st):
        w, cond = split_head(c.rest)
        conds = []
        if w != 'when' or cond == '':
            ctx.d(fname, c.no, 'P019')
        else:
            conds.append(cond)
        for ln in c.lines:
            if ln.blank:
                continue
            if ln.indent < 4:
                ctx.d(fname, ln.no, 'P006')
            else:
                conds.append(ln.s)
        el.items.append((c.kw, c.no, conds))


def read_open(ctx, fi, st):
    fname = fi.name
    id_, _ = parse_id_title(ctx, fname, st.no, st.rest)
    item = OpenItem(fname, st.no, id_)
    ctx.opens.append(item)

    def text(c):
        item.text = read_text(ctx, fname, c)

    def testy(c):
        item.test_lines.append(c.no)

    walk(ctx, fname, st, {'text': (text, True), 'example': (testy, False),
                          'table': (testy, False)})


def read_decision(ctx, fi, st):
    fname = fi.name
    id_, _ = parse_id_title(ctx, fname, st.no, st.rest)
    dec = Decision(fname, st.no, id_)
    ctx.decisions.append(dec)

    def source(c):
        dec.source = c.rest
        no_lines(ctx, fname, c)

    def status(c):
        dec.status = c.rest
        no_lines(ctx, fname, c)

    def text(c):
        dec.text = read_text(ctx, fname, c)

    def rejected(c):
        v = quoted(ctx, fname, c.no, c.rest)
        if v is not None:
            dec.rejected.append(v)
        no_lines(ctx, fname, c)

    walk(ctx, fname, st, {'source': (source, True), 'status': (status, True),
                          'text': (text, True), 'rejected': (rejected, False)})


# ------------------------------------------------------------------ requirements

def read_req(ctx, fi, st):
    fname = fi.name
    id_, _ = parse_id_title(ctx, fname, st.no, st.rest)
    req = Req(fname, st.no, id_)
    ctx.reqs.append(req)

    def text(c):
        req.text = read_text(ctx, fname, c)
        req.text_line = c.no

    def decision(c):
        req.decisions.extend(w for w in re.split('[,' + _W + ']+', c.rest) if w)
        no_lines(ctx, fname, c)

    def on(c):
        if c.rest in ('any', 'posix', 'windows'):
            req.platform = c.rest
        else:
            ctx.d(fname, c.no, 'P033')
        no_lines(ctx, fname, c)

    def example(c):
        read_example(ctx, fi, req, c)

    def table(c):
        read_table(ctx, fi, req, c)

    def static(c):
        req.static = True

    walk(ctx, fname, st, {'text': (text, True), 'decision': (decision, False),
                          'on': (on, True), 'example': (example, False),
                          'table': (table, False), 'static': (static, False)})


def parse_input_path(s):
    segs = []
    i = 0
    n = len(s)
    if n == 0:
        return None
    while True:
        if i >= n:
            return None
        if s[i] == '"':
            j = i + 1
            while j < n and s[j] != '"':
                j += 2 if s[j] == '\\' else 1
            if j >= n:
                return None
            try:
                v = jparse(s[i:j + 1])
            except JsonError:
                return None
            if not isinstance(v, str):
                return None
            segs.append(v)
            i = j + 1
        else:
            m = _WORD.match(s, i)
            if not m:
                return None
            segs.append(m.group())
            i = m.end()
        if i >= n:
            return segs
        if s[i] != '.':
            return None
        i += 1


def set_path(obj, segs, value):
    cur = obj
    for seg in segs[:-1]:
        if seg in cur:
            if not isinstance(cur[seg], dict):
                return False
            cur = cur[seg]
        else:
            cur[seg] = {}
            cur = cur[seg]
    cur[segs[-1]] = value
    return True


def resolve_from(fname, name):
    parts = fname.split('/')[:-1]
    for p in name.split('/'):
        if p in ('', '.'):
            continue
        if p == '..':
            if not parts:
                return None
            parts.pop()
        else:
            parts.append(p)
    return '/'.join(parts)


def inside_folder(ctx, path):
    return ctx.folder == '' or path.startswith(ctx.folder + '/')


def parse_number(s, nonneg=False):
    try:
        v = jparse(s)
    except JsonError:
        return None
    if not isinstance(v, float):
        return None
    if nonneg and v < 0:
        return None
    return v


_APPROX_SPLIT = re.compile('±|\\+-')


def read_expect(ctx, fname, ex, ln):
    rest = ln.s[len('expect'):].lstrip(WS)
    m = re.match('[^=≈~' + _W + ']*', rest)
    path = m.group()
    after = rest[len(path):].lstrip(WS)
    if path == '' or after == '':
        ctx.d(fname, ln.no, 'P011')
        return
    c = after[0]
    if c == '=':
        val = strip_ws(after[1:])
        if val == '?':
            ex.expects.append(Expect(ln.no, path, 'oracle'))
            return
        try:
            v = jparse(val)
        except JsonError:
            ctx.d(fname, ln.no, 'P009')
            return
        ex.expects.append(Expect(ln.no, path, 'eq', v))
    elif c in '≈~':
        body = after[1:]
        m2 = _APPROX_SPLIT.search(body)
        if not m2:
            ctx.d(fname, ln.no, 'P010')
            return
        num = parse_number(strip_ws(body[:m2.start()]))
        tol = parse_number(strip_ws(body[m2.end():]), True)
        if num is None or tol is None:
            ctx.d(fname, ln.no, 'P010')
            return
        ex.expects.append(Expect(ln.no, path, 'approx', num, tol))
    else:
        ctx.d(fname, ln.no, 'P011')


def read_example(ctx, fi, req, c):
    fname = fi.name
    ex = Example(c.no)
    req.items.append(ex)
    rest = c.rest
    if rest == '':
        ctx.d(fname, c.no, 'P012')
        ex.valid = False
    else:
        w, r = split_head(rest)
        if w == 'raw':
            ex.raw = True
            line = None
            if r.startswith('"'):
                try:
                    v = jparse(r)
                    if isinstance(v, str):
                        line = v
                except JsonError:
                    pass
            elif len(r) >= 2 and r.startswith("'") and r.endswith("'"):
                line = r[1:-1]
            if line is None:
                ctx.d(fname, c.no, 'P004')
                ex.valid = False
            elif '\r' in line or '\n' in line:
                ctx.d(fname, c.no, 'P026')
                ex.valid = False
            else:
                ex.raw_line = line
        else:
            ex.op = w
            if r != '':
                try:
                    v = jparse(r)
                except JsonError:
                    ctx.d(fname, c.no, 'P009')
                    ex.valid = False
                else:
                    if not isinstance(v, dict):
                        ctx.d(fname, c.no, 'P012')
                        ex.valid = False
                    else:
                        ex.input_text = r
                        ex.input_obj = v
    lines = c.lines
    i = 0
    n = len(lines)
    while i < n:
        ln = lines[i]
        i += 1
        if ln.blank or ln.s.startswith('#'):
            continue
        if ln.indent != 4:
            ctx.d(fname, ln.no, 'P006')
            continue
        kw, rest = split_head(ln.s)
        if kw == 'expect':
            read_expect(ctx, fname, ex, ln)
        elif kw == 'request':
            if ex.raw:
                ctx.d(fname, ln.no, 'P022')
            elif ex.request_read:
                ctx.d(fname, ln.no, 'P052')
            else:
                v = parse_members(ctx, fname, ln.no, rest)
                if v is not None:
                    ex.request = v
                    ex.request_read = True
        elif kw == 'omit':
            if ex.raw:
                ctx.d(fname, ln.no, 'P022')
            else:
                names = [x for x in re.split('[,' + _W + ']+', rest) if x]
                if not names:
                    ctx.d(fname, ln.no, 'P011')
                ex.omit.extend(names)
        elif kw == 'input':
            m = _FROM.match(rest)
            frm = None
            path_text = rest
            if m:
                try:
                    fv = jparse(m.group(2))
                    if isinstance(fv, str):
                        frm = fv
                        path_text = m.group(1)
                except JsonError:
                    pass
            text_lines = None
            if frm is None:
                # collect the text lines under this input line
                text_lines = []
                while i < n:
                    t = lines[i]
                    if t.blank:
                        text_lines.append('')
                    elif t.indent >= 6:
                        text_lines.append(' ' * (t.indent - 6) + t.s)
                    else:
                        break
                    i += 1
                while text_lines and text_lines[-1] == '':
                    text_lines.pop()
            if ex.raw:
                ctx.d(fname, ln.no, 'P022')
                continue
            segs = parse_input_path(path_text)
            if segs is None:
                ctx.d(fname, ln.no, 'P049')
                continue
            if frm is not None:
                target = resolve_from(fname, frm)
                if target is None or target not in ctx.files or not inside_folder(ctx, target):
                    ctx.d(fname, ln.no, 'P048')
                    continue
                value = ctx.files[target]
            else:
                value = None
            if not ex.input_lines:
                ex.input_lines = True
                if ex.input_obj is None:
                    ex.input_obj = {}
            if frm is None:
                if not text_lines:
                    ctx.d(fname, ln.no, 'P049')
                    continue
                value = ''.join(t + '\n' for t in text_lines)
            if not set_path(ex.input_obj, segs, value):
                ctx.d(fname, ln.no, 'P049')
        else:
            ctx.d(fname, ln.no, 'P011')


# ------------------------------------------------------------------ tables

def is_separator(s):
    return (s.startswith('|') and s.endswith('|') and
            all(ch in '|-:' or ch in WS for ch in s))


def split_cells(s):
    body = s[1:]
    cells = []
    cur = []
    i = 0
    n = len(body)
    while i < n:
        ch = body[i]
        if ch == '\\' and i + 1 < n and body[i + 1] == '|':
            cur.append('|')
            i += 2
        elif ch == '|':
            cells.append(strip_ws(''.join(cur)))
            cur = []
            i += 1
        else:
            cur.append(ch)
            i += 1
    if cur:
        cells.append(strip_ws(''.join(cur)))
    return cells


def parse_header_cell(cell):
    """Returns (name, tol_text or None) or None when the cell is of no form."""
    i = 0
    n = len(cell)
    while i < n and cell[i] not in WS and cell[i] != '±' and not cell.startswith('+-', i):
        i += 1
    name = cell[:i]
    rem = cell[i:].lstrip(WS)
    tol = None
    if rem == '':
        pass
    elif rem.startswith('±'):
        tol = strip_ws(rem[1:])
    elif rem.startswith('+-'):
        tol = strip_ws(rem[2:])
    else:
        return None
    if name == '' or not (_EXPECT_PATH.match(name) or _FIELD_NAME.match(name)):
        return None
    return name, tol


def read_table(ctx, fi, req, c):
    fname = fi.name
    rows = []
    for ln in c.lines:
        if ln.blank:
            continue
        if ln.indent >= 4 and ln.s.startswith('|'):
            if is_separator(ln.s):
                continue
            rows.append((ln.no, split_cells(ln.s)))
        elif ln.s.startswith('#'):
            continue
        else:
            ctx.d(fname, ln.no, 'P006')
    ws = words(c.rest)
    if len(ws) != 1 or len(rows) < 2:
        ctx.d(fname, c.no, 'P013')
        return
    op = ws[0]
    hline, hcells = rows[0]
    cols = []
    seen = set()
    for cell in hcells:
        parsed = parse_header_cell(cell)
        if parsed is None or parsed[0] in seen:
            ctx.d(fname, hline, 'P013')
            return
        name, tol_text = parsed
        seen.add(name)
        is_exp = bool(_EXPECT_PATH.match(name))
        tol = None
        if tol_text is not None:
            t = parse_number(tol_text, True)
            if t is None or not is_exp:
                ctx.d(fname, hline, 'P010')
            else:
                tol = t
        cols.append((name, is_exp, tol))
    for rline, cells in rows[1:]:
        ex = Example(rline)
        ex.op = op
        ex.table_row = True
        req.items.append(ex)
        if len(cells) != len(cols):
            ctx.d(fname, rline, 'P014')
            ex.valid = False
            continue
        for (name, is_exp, tol), cell in zip(cols, cells):
            if cell == '':
                continue
            if is_exp:
                if cell == '?':
                    ex.expects.append(Expect(rline, name, 'oracle'))
                elif tol is not None:
                    v = parse_number(cell)
                    if v is None:
                        ctx.d(fname, rline, 'P010')
                    else:
                        ex.expects.append(Expect(rline, name, 'approx', v, tol))
                else:
                    try:
                        v = jparse(cell)
                    except JsonError:
                        ctx.d(fname, rline, 'P009')
                    else:
                        ex.expects.append(Expect(rline, name, 'eq', v))
            else:
                try:
                    jparse(cell)
                except JsonError:
                    ctx.d(fname, rline, 'P009')
                else:
                    ex.cells.append((name, cell))
