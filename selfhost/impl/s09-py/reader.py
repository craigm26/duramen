"""Reading a record: lines, statements, clauses, and what they mean (P diagnostics)."""
import json
import re

from jsutil import (WS_SET, WS, rstrip_ws, strip_ws, split_word, split_words, parse_json,
                    is_num, js_str, js_stringify)


class Obj:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class Line:
    __slots__ = ('no', 'indent', 'text', 'blank')

    def __init__(self, no, indent, text, blank):
        self.no = no
        self.indent = indent
        self.text = text
        self.blank = blank


class Clause:
    def __init__(self, line, kw, rest):
        self.line = line
        self.kw = kw
        self.rest = rest
        self.body = []


class Stmt:
    def __init__(self, line, kw, rest):
        self.line = line
        self.kw = kw
        self.rest = rest
        self.clauses = []


CORE = {'duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note'}
REST_OF_LANGUAGE = {'type', 'edge', 'edgedef', 'property', 'evidence'}


class Ctx:
    def __init__(self, files):
        self.files = files
        self.diags = []
        self.record_dir = ''

    def add(self, file, line, code, level='error'):
        self.diags.append((file, line, level, code))


class Rec:
    def __init__(self):
        self.spec = None
        self.oracle = None
        self.errors_seen = False
        self.codes = []
        self.conditions = []
        self.ops = []
        self.reqs = []
        self.opens = []
        self.decisions = []
        self.sections = []
        self.notes = []
        self.versions = []


def split_lines(text):
    if text.startswith('﻿'):
        text = text[1:]
    return re.split(r'\r\n|\r|\n', text)


def lex_file(ctx, name, text):
    stmts = []
    cur = None
    cur_clause = None
    for no, raw in enumerate(split_lines(text), 1):
        s = rstrip_ws(raw)
        if s == '':
            if cur_clause is not None:
                cur_clause.body.append(Line(no, 0, '', True))
            continue
        k = 0
        while k < len(s) and s[k] in WS_SET:
            k += 1
        if any(c != ' ' for c in s[:k]):
            ctx.add(name, no, 'P001')
            continue
        content = s[k:]
        if k == 0:
            if content[0] == '#':
                continue
            kw, rest = split_word(content)
            cur = Stmt(no, kw, rest)
            stmts.append(cur)
            cur_clause = None
        elif cur is None:
            ctx.add(name, no, 'P003')
        elif cur.kw not in CORE:
            continue
        elif k == 1:
            ctx.add(name, no, 'P007')
        elif k == 2:
            if content[0] == '#':
                continue
            kw, rest = split_word(content)
            cur_clause = Clause(no, kw, rest)
            cur.clauses.append(cur_clause)
        else:
            if cur_clause is None:
                ctx.add(name, no, 'P006')
            else:
                cur_clause.body.append(Line(no, k, content, False))
    return stmts


# ---------------------------------------------------------------- small readers

def no_body(ctx, file, cl):
    """Under a clause that takes no lines, anything but blanks and comments is P006."""
    for ln in cl.body:
        if not ln.blank and not ln.text.startswith('#'):
            ctx.add(file, ln.no, 'P006')


def read_text(ctx, file, cl):
    if cl.rest != '':
        ctx.add(file, cl.line, 'P008')
    lines = []
    for ln in cl.body:
        if ln.blank:
            lines.append('')
        elif ln.indent < 4:
            ctx.add(file, ln.no, 'P008')
        else:
            lines.append(' ' * (ln.indent - 4) + ln.text)
    while lines and lines[0] == '':
        lines.pop(0)
    while lines and lines[-1] == '':
        lines.pop()
    return '\n'.join(lines)


def quoted(text):
    st, v = parse_json(text)
    if st == 'ok' and isinstance(v, str):
        return v
    return None


def request_object(rest):
    """('P009'|'P051'|None, dict|None)"""
    st, v = parse_json(rest)
    if st != 'ok' or not isinstance(v, dict):
        return 'P009', None
    if 'id' in v or 'op' in v or 'input' in v:
        return 'P051', None
    return None, v


def id_title(ctx, file, st):
    ident, rest = split_word(st.rest)
    title = None
    if len(rest) < 2 or rest[0] != '"' or rest[-1] != '"':
        ctx.add(file, st.line, 'P005')
    else:
        title = quoted(rest)
        if title is None:
            ctx.add(file, st.line, 'P004')
    return ident, title


def gate(ctx, file, st, allowed, once=()):
    """Clauses of a statement that are taken: others get P015, repeated once-only ones P052."""
    seen = set()
    for cl in st.clauses:
        if cl.kw not in allowed:
            ctx.add(file, cl.line, 'P015')
            continue
        if cl.kw in once:
            if cl.kw in seen:
                ctx.add(file, cl.line, 'P052')
                continue
            seen.add(cl.kw)
        yield cl


# ---------------------------------------------------------------- statements

def read_duramen(ctx, file, st, rec, fs):
    if fs.duramen_seen:
        ctx.add(file, st.line, 'P023')
    else:
        fs.duramen_seen = True
        if st.rest in ('0.1', '0.2'):
            fs.version = st.rest
        else:
            ctx.add(file, st.line, 'P023')
    for cl in st.clauses:
        ctx.add(file, cl.line, 'P015')


def read_spec(ctx, file, st, rec, fs):
    if len(split_words(st.rest)) != 2:
        ctx.add(file, st.line, 'P021')
    info = Obj(file=file, line=st.line, request=None, text=None)
    if rec.spec is None:
        rec.spec = info
    else:
        ctx.add(file, st.line, 'P044')
    for cl in gate(ctx, file, st, ('title', 'text', 'contract', 'request'),
                   ('title', 'text', 'contract', 'request')):
        if cl.kw == 'title':
            if quoted(cl.rest) is None:
                ctx.add(file, cl.line, 'P004')
            no_body(ctx, file, cl)
        elif cl.kw == 'contract':
            no_body(ctx, file, cl)
        elif cl.kw == 'request':
            code, obj = request_object(cl.rest)
            if code:
                ctx.add(file, cl.line, code)
            else:
                info.request = obj
            no_body(ctx, file, cl)
        else:
            info.text = read_text(ctx, file, cl)


def read_oracle(ctx, file, st, rec, fs):
    if st.rest == '':
        ctx.add(file, st.line, 'P028')
    if rec.oracle is None:
        rec.oracle = Obj(file=file, line=st.line, command=st.rest)
    else:
        ctx.add(file, st.line, 'P044')
    for cl in gate(ctx, file, st, ('source',)):
        no_body(ctx, file, cl)


def read_section(ctx, file, st, rec, fs):
    ident, title = id_title(ctx, file, st)
    sec = Obj(id=ident, file=file, line=st.line, text=None)
    rec.sections.append(sec)
    for cl in gate(ctx, file, st, ('text',), ('text',)):
        sec.text = read_text(ctx, file, cl)


def read_note(ctx, file, st, rec, fs):
    if st.rest != '':
        ctx.add(file, st.line, 'P050')
    note = Obj(file=file, line=st.line, text=None)
    rec.notes.append(note)
    for cl in gate(ctx, file, st, ('text',), ('text',)):
        note.text = read_text(ctx, file, cl)


def read_open(ctx, file, st, rec, fs):
    ident, title = id_title(ctx, file, st)
    op = Obj(id=ident, file=file, line=st.line, text=None, clauses=[])
    rec.opens.append(op)
    for cl in gate(ctx, file, st, ('text', 'example', 'table'), ('text',)):
        if cl.kw == 'text':
            op.text = read_text(ctx, file, cl)
        else:
            op.clauses.append(cl.line)


def read_decision(ctx, file, st, rec, fs):
    ident, title = id_title(ctx, file, st)
    dec = Obj(id=ident, file=file, line=st.line, source='', status=None, text=None, rejected=[])
    rec.decisions.append(dec)
    for cl in gate(ctx, file, st, ('source', 'status', 'text', 'rejected'),
                   ('source', 'status', 'text')):
        if cl.kw == 'source':
            dec.source = cl.rest
            no_body(ctx, file, cl)
        elif cl.kw == 'status':
            dec.status = cl.rest
            no_body(ctx, file, cl)
        elif cl.kw == 'text':
            dec.text = read_text(ctx, file, cl)
        else:
            alt = quoted(cl.rest)
            if alt is None:
                ctx.add(file, cl.line, 'P004')
            else:
                dec.rejected.append(alt)
            no_body(ctx, file, cl)


def read_errors(ctx, file, st, rec, fs):
    if st.rest != '':
        ctx.add(file, st.line, 'P050')
    first = not rec.errors_seen
    if not first:
        ctx.add(file, st.line, 'P032')
    rec.errors_seen = True
    for cl in st.clauses:
        w, cond = split_word(cl.rest)
        if w != 'when' or cond == '':
            ctx.add(file, cl.line, 'P019')
        parts = [cond]
        for ln in cl.body:
            if ln.blank:
                parts.append('')
            elif ln.indent < 4:
                ctx.add(file, ln.no, 'P006')
            else:
                parts.append(ln.text)
        if first:
            rec.codes.append(cl.kw)
            rec.conditions.append((file, cl.line, '\n'.join(parts)))


_FIELD_RE = re.compile(r'([A-Za-z0-9_-]+)(\?)?' + WS + r'+(\S.*)', re.S)


def split_fields(s):
    fields = []
    cur = []
    depth = 0
    instr = False
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if instr:
            cur.append(c)
            if c == '\\' and i + 1 < n:
                cur.append(s[i + 1])
                i += 1
            elif c == '"':
                instr = False
        elif c == '"':
            instr = True
            cur.append(c)
        elif c in '([{':
            depth += 1
            cur.append(c)
        elif c in ')]}':
            depth = max(0, depth - 1)
            cur.append(c)
        elif c == ',' and depth == 0:
            fields.append(''.join(cur))
            cur = []
        else:
            cur.append(c)
        i += 1
    fields.append(''.join(cur))
    return fields


def read_op(ctx, file, st, rec, fs):
    words = split_words(st.rest)
    if len(words) != 1:
        ctx.add(file, st.line, 'P031')
    op = Obj(name=words[0] if len(words) == 1 else None, file=file, line=st.line, fields={}, result=None,
             tolerances={}, audit=False, request=None)
    rec.ops.append(op)
    once_seen = set()
    tol_seen = set()
    for cl in st.clauses:
        kw = cl.kw
        if kw not in ('input', 'result', 'tolerance', 'audit', 'request', 'returns'):
            ctx.add(file, cl.line, 'P015')
            continue
        if kw in ('result', 'audit', 'request'):
            if kw in once_seen:
                ctx.add(file, cl.line, 'P052')
                continue
            once_seen.add(kw)
        if kw == 'input':
            for f in split_fields(cl.rest):
                m = _FIELD_RE.fullmatch(strip_ws(f))
                if not m:
                    ctx.add(file, cl.line, 'P017')
                elif m.group(1) in op.fields:
                    ctx.add(file, cl.line, 'P052')
                else:
                    op.fields[m.group(1)] = bool(m.group(2))
        elif kw == 'result':
            op.result = cl.rest
        elif kw == 'tolerance':
            path, num = split_word(cl.rest)
            if path and path in op.tolerances:
                ctx.add(file, cl.line, 'P052')
                continue
            st2, v = parse_json(num)
            if not path or st2 != 'ok' or not is_num(v) or v < 0:
                ctx.add(file, cl.line, 'P018')
            else:
                op.tolerances[path] = v
        elif kw == 'audit':
            if cl.rest not in ('', 'text'):
                ctx.add(file, cl.line, 'P050')
            else:
                op.audit = True
        elif kw == 'request':
            code, obj = request_object(cl.rest)
            if code:
                ctx.add(file, cl.line, code)
            else:
                op.request = obj
        no_body(ctx, file, cl)


def read_req(ctx, file, st, rec, fs):
    ident, title = id_title(ctx, file, st)
    req = Obj(id=ident, line=st.line, file=file, platform='any', text=None, text_line=None,
              decisions=[], examples=[], static=False)
    rec.reqs.append(req)
    for cl in gate(ctx, file, st, ('text', 'decision', 'on', 'example', 'table', 'static'),
                   ('text', 'on')):
        kw = cl.kw
        if kw == 'text':
            req.text = read_text(ctx, file, cl)
            req.text_line = cl.line
        elif kw == 'decision':
            req.decisions.extend(x for x in re.split('[,\t\n\x0b\x0c\r    - '
                                                     '    　﻿]+',
                                                     cl.rest) if x)
            no_body(ctx, file, cl)
        elif kw == 'on':
            if cl.rest in ('any', 'posix', 'windows'):
                req.platform = cl.rest
            else:
                ctx.add(file, cl.line, 'P033')
            no_body(ctx, file, cl)
        elif kw == 'static':
            req.static = True
            no_body(ctx, file, cl)
        elif kw == 'example':
            ex = read_example(ctx, file, cl)
            if ex is not None:
                req.examples.append(ex)
                ex.id = '%s#%d' % (ident, len(req.examples))
        else:
            for ex in read_table(ctx, file, cl):
                req.examples.append(ex)
                ex.id = '%s#%d' % (ident, len(req.examples))


def read_ignored(ctx, file, st, rec, fs):
    pass


HANDLERS = {
    'duramen': read_duramen, 'spec': read_spec, 'oracle': read_oracle, 'section': read_section,
    'op': read_op, 'errors': read_errors, 'req': read_req, 'open': read_open,
    'decision': read_decision, 'note': read_note,
}


# ---------------------------------------------------------------- examples

_dec = json.JSONDecoder()
_WORD_RE = re.compile(r'[A-Za-z0-9_-]+')
_FROM_RE = re.compile(r'(.*\S)' + WS + r'+from' + WS + r'+("(?:[^"\\]|\\.)*")', re.S)


def parse_path(s):
    segs = []
    i = 0
    n = len(s)
    while True:
        if i >= n:
            return None
        if s[i] == '"':
            try:
                v, j = _dec.raw_decode(s, i)
            except ValueError:
                return None
            if not isinstance(v, str):
                return None
            segs.append(v)
            i = j
        else:
            m = _WORD_RE.match(s, i)
            if not m:
                return None
            segs.append(m.group())
            i = m.end()
        if i == n:
            return segs
        if s[i] != '.':
            return None
        i += 1


def resolve_from(ctx, file, target):
    if target == '' or target.startswith('/'):
        return None
    base = file.rsplit('/', 1)[0].split('/') if '/' in file else []
    parts = list(base)
    for p in target.split('/'):
        if p in ('', '.'):
            continue
        if p == '..':
            if not parts:
                return None
            parts.pop()
        else:
            parts.append(p)
    path = '/'.join(parts)
    if ctx.record_dir and not path.startswith(ctx.record_dir + '/'):
        return None
    if path not in ctx.files:
        return None
    return path


_NUMBER_SEPS = ('±', '+-')


def parse_expect(rest):
    """('P0xx', None) or ('ok', Obj(path, kind, value, tol))."""
    i = 0
    n = len(rest)
    while i < n and rest[i] not in WS_SET and rest[i] not in '=≈~':
        i += 1
    path = rest[:i]
    if not path:
        return 'P011', None
    tail = strip_ws(rest[i:])
    if tail.startswith('='):
        val = strip_ws(tail[1:])
        if val == '?':
            return 'ok', Obj(path=path, kind='oracle', value=None, tol=None)
        st, v = parse_json(val)
        if st != 'ok':
            return 'P009', None
        return 'ok', Obj(path=path, kind='eq', value=v, tol=None)
    if tail.startswith('≈') or tail.startswith('~'):
        body = tail[1:]
        best = None
        for sep in _NUMBER_SEPS:
            j = body.find(sep)
            if j >= 0 and (best is None or j < best[0]):
                best = (j, sep)
        if best is None:
            return 'P010', None
        j, sep = best
        s1, v1 = parse_json(strip_ws(body[:j]))
        s2, v2 = parse_json(strip_ws(body[j + len(sep):]))
        if s1 != 'ok' or s2 != 'ok' or not is_num(v1) or not is_num(v2) or v2 < 0:
            return 'P010', None
        return 'ok', Obj(path=path, kind='approx', value=v1, tol=v2)
    return 'P011', None


def new_example(line, file):
    return Obj(kind='normal', line=line, file=file, op=None, input_text=None, input_obj=None,
               input_lines=False, raw=None, req_members=None, omit=[], expects=[], id=None)


def read_example(ctx, file, cl):
    ex = new_example(cl.line, file)
    ok = True
    is_raw = False
    rest = cl.rest
    if rest == '':
        ctx.add(file, cl.line, 'P012')
        ok = False
    else:
        word, tail = split_word(rest)
        if word == 'raw':
            is_raw = True
            ex.kind = 'raw'
            line = None
            if tail.startswith('"'):
                line = quoted(tail)
            elif len(tail) >= 2 and tail[0] == "'" and tail[-1] == "'":
                line = tail[1:-1]
            if line is None:
                ctx.add(file, cl.line, 'P004')
                ok = False
            elif '\n' in line or '\r' in line:
                ctx.add(file, cl.line, 'P026')
                ok = False
            else:
                ex.raw = line
        else:
            ex.op = word
            if tail != '':
                st, v = parse_json(tail)
                if st != 'ok':
                    ctx.add(file, cl.line, 'P009')
                    ok = False
                elif not isinstance(v, dict):
                    ctx.add(file, cl.line, 'P012')
                    ok = False
                else:
                    ex.input_text = tail
                    ex.input_obj = v
    scratch = ex.input_obj if ex.input_obj is not None else {}
    got_request = False
    lines = cl.body
    i = 0
    n = len(lines)
    while i < n:
        ln = lines[i]
        i += 1
        if ln.blank or ln.text.startswith('#'):
            continue
        if ln.indent != 4:
            ctx.add(file, ln.no, 'P006')
            continue
        kw, rest = split_word(ln.text)
        if kw == 'expect':
            code, e = parse_expect(rest)
            if code != 'ok':
                ctx.add(file, ln.no, code)
            else:
                e.line = ln.no
                ex.expects.append(e)
        elif kw == 'request':
            if is_raw:
                ctx.add(file, ln.no, 'P022')
            elif got_request:
                ctx.add(file, ln.no, 'P052')
            else:
                code, obj = request_object(rest)
                if code:
                    ctx.add(file, ln.no, code)
                else:
                    got_request = True
                    ex.req_members = obj
        elif kw == 'omit':
            if is_raw:
                ctx.add(file, ln.no, 'P022')
            else:
                names = [x for x in re.split('[,\t\n\x0b\x0c\r    - '
                                             '    　﻿]+', rest) if x]
                if not names:
                    ctx.add(file, ln.no, 'P011')
                ex.omit.extend(names)
        elif kw == 'input':
            m = _FROM_RE.fullmatch(rest)
            target = quoted(m.group(2)) if m else None
            from_form = m is not None and target is not None
            text = None
            if not from_form:
                j = i
                while j < n and (lines[j].blank or lines[j].indent >= 6):
                    j += 1
                block = lines[i:j]
                i = j
                tl = [('' if b.blank else ' ' * (b.indent - 6) + b.text) for b in block]
                while tl and tl[-1] == '':
                    tl.pop()
                if tl:
                    text = '\n'.join(tl) + '\n'
            if is_raw:
                ctx.add(file, ln.no, 'P022')
                continue
            path = parse_path(m.group(1) if from_form else rest)
            if path is None:
                ctx.add(file, ln.no, 'P049')
                continue
            if from_form:
                src = resolve_from(ctx, file, target)
                if src is None:
                    ctx.add(file, ln.no, 'P048')
                    continue
                text = ctx.files[src]
            elif text is None:
                ctx.add(file, ln.no, 'P049')
                continue
            cur = scratch
            bad = False
            for seg in path[:-1]:
                if seg not in cur:
                    cur[seg] = {}
                elif not isinstance(cur[seg], dict):
                    bad = True
                    break
                cur = cur[seg]
            if bad:
                ctx.add(file, ln.no, 'P049')
                continue
            cur[path[-1]] = text
            ex.input_lines = True
        else:
            ctx.add(file, ln.no, 'P011')
    if not ok:
        return None
    if ex.kind != 'raw' and ex.input_lines:
        ex.input_obj = scratch
        ex.input_text = js_stringify(scratch)
    return ex


# ---------------------------------------------------------------- tables

def split_cells(row):
    row = row[1:]
    cells = []
    cur = []
    i = 0
    n = len(row)
    while i < n:
        c = row[i]
        if c == '\\' and i + 1 < n and row[i + 1] == '|':
            cur.append('|')
            i += 2
            continue
        if c == '|':
            cells.append(''.join(cur))
            cur = []
        else:
            cur.append(c)
        i += 1
    if cur or not cells:
        cells.append(''.join(cur))
    return [strip_ws(c) for c in cells]


def is_separator(s):
    return len(s) >= 1 and s[0] == '|' and s[-1] == '|' and all(c in '|-: ' for c in s)


_NAME_RE = re.compile(r'[A-Za-z0-9_-]+')
_PATH_RE = re.compile(r'(?:result|audit|error|id)(?:\..*)?', re.S)


def read_table(ctx, file, cl):
    rows = []
    for ln in cl.body:
        if ln.blank or ln.text.startswith('#'):
            continue
        if ln.indent >= 4 and ln.text.startswith('|'):
            if not is_separator(ln.text):
                rows.append(ln)
        else:
            ctx.add(file, ln.no, 'P006')
    ops = split_words(cl.rest)
    if len(ops) != 1 or len(rows) < 2:
        ctx.add(file, cl.line, 'P013')
        return []
    op = ops[0]
    header = rows[0]
    cols = []
    names = set()
    bad_header = False
    for cell in split_cells(header.text):
        i = 0
        while i < len(cell) and cell[i] not in WS_SET and cell[i] != '±' and not cell.startswith('+-', i):
            i += 1
        name = cell[:i]
        tail = strip_ws(cell[i:])
        if _NAME_RE.fullmatch(name) and name not in ('result', 'audit', 'error', 'id'):
            kind = 'field'
        elif _PATH_RE.fullmatch(name):
            kind = 'path'
        else:
            kind = None
        sep = '±' if tail.startswith('±') else '+-' if tail.startswith('+-') else None
        if kind is None or name in names or (tail and sep is None):
            ctx.add(file, header.no, 'P013')
            bad_header = True
            break
        names.add(name)
        tol = None
        if sep:
            st, v = parse_json(strip_ws(tail[len(sep):]))
            if st != 'ok' or not is_num(v) or v < 0 or kind == 'field':
                ctx.add(file, header.no, 'P010')
            else:
                tol = v
        cols.append(Obj(name=name, kind=kind, tol=tol))
    if bad_header:
        return []
    out = []
    for row in rows[1:]:
        cells = split_cells(row.text)
        if len(cells) != len(cols):
            ctx.add(file, row.no, 'P014')
            continue
        ex = new_example(row.no, file)
        ex.kind = 'row'
        ex.op = op
        fields = []
        good = True
        for col, cell in zip(cols, cells):
            if cell == '':
                continue
            if col.kind == 'field':
                st, v = parse_json(cell)
                if st != 'ok':
                    ctx.add(file, row.no, 'P009')
                    good = False
                else:
                    fields.append((col.name, cell, v))
            elif cell == '?':
                ex.expects.append(Obj(path=col.name, kind='oracle', value=None, tol=None,
                                      line=row.no))
            elif col.tol is not None:
                st, v = parse_json(cell)
                if st != 'ok' or not is_num(v):
                    ctx.add(file, row.no, 'P010')
                    good = False
                else:
                    ex.expects.append(Obj(path=col.name, kind='approx', value=v, tol=col.tol,
                                          line=row.no))
            else:
                st, v = parse_json(cell)
                if st != 'ok':
                    ctx.add(file, row.no, 'P009')
                    good = False
                else:
                    ex.expects.append(Obj(path=col.name, kind='eq', value=v, tol=None,
                                          line=row.no))
        if not good:
            continue
        ex.input_text = '{' + ','.join('"%s":%s' % (f[0], f[1]) for f in fields) + '}'
        ex.input_obj = {f[0]: f[2] for f in fields}
        out.append(ex)
    return out


# ---------------------------------------------------------------- files and records

def read_file(ctx, name, text, rec):
    fs = Obj(duramen_seen=False, version=None)
    stmts = lex_file(ctx, name, text)
    for st in stmts:
        if st.kw in HANDLERS:
            HANDLERS[st.kw](ctx, name, st, rec, fs)
        elif st.kw in REST_OF_LANGUAGE:
            pass
        else:
            ctx.add(name, st.line, 'P002')
    if not fs.duramen_seen:
        ctx.add(name, 1, 'P020')
    if fs.version:
        rec.versions.append(fs.version)
