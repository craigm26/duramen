"""Reading a record: files, statements, clauses (P diagnostics)."""
import re

from jsutil import (WS, WS_SET, NWS, first_word_rest, is_num, jdump, jparse,
                    lstrip_ws, rstrip_ws, strip_ws, u16, words)

KNOWN = {'duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open',
         'decision', 'note'}
UNSPECIFIED = {'type', 'edge', 'edgedef', 'property', 'evidence'}
VERSIONS = ('0.1', '0.2')
DROPPED = object()


class Obj:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class Clause:
    def __init__(self, kw, line, rest):
        self.kw, self.line, self.rest, self.lines = kw, line, rest, []


def split_fields(s):
    parts, cur, depth, instr, i = [], [], 0, False, 0
    while i < len(s):
        c = s[i]
        if instr:
            cur.append(c)
            if c == '\\' and i + 1 < len(s):
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
            parts.append(''.join(cur))
            cur = []
        else:
            cur.append(c)
        i += 1
    parts.append(''.join(cur))
    return parts


FIELD = re.compile(r'([A-Za-z0-9_-]+)(\?)?' + WS + r'+(\S.*)\Z', re.S)
PATH_WORD = re.compile(r'[A-Za-z0-9_-]+')
APPROX_SEP = re.compile(r'±|\+-')


def parse_input_path(s):
    """Parse 'a.b."c d"' from the start of s -> (segments, position) or None."""
    segs, i, n = [], 0, len(s)
    while True:
        if i < n and s[i] == '"':
            j = i + 1
            while j < n and s[j] != '"':
                j += 2 if s[j] == '\\' else 1
            if j >= n:
                return None
            ok, v = jparse(s[i:j + 1])
            if not ok or not isinstance(v, str):
                return None
            segs.append(v)
            i = j + 1
        else:
            m = PATH_WORD.match(s, i)
            if not m:
                return None
            segs.append(m.group())
            i = m.end()
        if i < n and s[i] == '.':
            i += 1
            continue
        return segs, i


def split_row(s):
    """Cells of a table row that starts with '|'."""
    cells, cur, i, n = [], [], 1, len(s)
    ended = False
    while i < n:
        c = s[i]
        if c == '\\' and i + 1 < n and s[i + 1] == '|':
            cur.append('|')
            i += 2
            continue
        if c == '|':
            cells.append(''.join(cur))
            cur = []
            ended = True
        else:
            cur.append(c)
            ended = False
        i += 1
    if not ended or strip_ws(''.join(cur)) != '':
        cells.append(''.join(cur))
    return [strip_ws(c) for c in cells]


def is_separator(s):
    return s[0] == '|' and s[-1] == '|' and all(c in '|-: ' for c in s)


class Reader:
    def __init__(self, name, folder_parts, files):
        self.name = name
        self.folder_parts = folder_parts
        self.files = files
        self.diags = []
        self.items = []
        self.spec = self.oracle = self.errors = None
        self.versions = {}
        self.reqs = []
        self.file = None

    # ---------------------------------------------------------------- utils
    def err(self, f, line, code, level='error'):
        self.diags.append((f, line, level, code))

    def split_clauses(self, f, body, allowed, once):
        clauses, latest, seen = [], None, set()
        for (ln, ind, s) in body:
            if ind < 0:
                if isinstance(latest, Clause):
                    latest.lines.append((ln, -1, ''))
                continue
            if ind == 1:
                self.err(f, ln, 'P007')
                continue
            if ind == 2:
                content = s[2:]
                if content.startswith('#'):
                    continue
                kw, rest = first_word_rest(content)
                if allowed is not None and kw not in allowed:
                    self.err(f, ln, 'P015')
                    latest = DROPPED
                    continue
                if kw in once and kw in seen:
                    self.err(f, ln, 'P052')
                    latest = DROPPED
                    continue
                seen.add(kw)
                latest = Clause(kw, ln, rest)
                clauses.append(latest)
            else:
                if latest is None:
                    self.err(f, ln, 'P006')
                elif latest is not DROPPED:
                    latest.lines.append((ln, ind, s))
        return clauses

    def no_body(self, f, c):
        for (ln, ind, s) in c.lines:
            if ind >= 0 and not s[ind:].startswith('#'):
                self.err(f, ln, 'P006')

    def read_text(self, f, c):
        if c.rest != '':
            self.err(f, c.line, 'P008')
        out = []
        for (ln, ind, s) in c.lines:
            if ind < 0:
                out.append('')
            elif ind == 3:
                self.err(f, ln, 'P008')
            else:
                out.append(s[4:])
        while out and out[0] == '':
            out.pop(0)
        while out and out[-1] == '':
            out.pop()
        return '\n'.join(out)

    def read_title(self, f, c):
        self.no_body(f, c)
        ok, v = jparse(c.rest)
        if ok and isinstance(v, str):
            return v
        self.err(f, c.line, 'P004')
        return None

    def read_request(self, f, c):
        self.no_body(f, c)
        ok, v = jparse(c.rest)
        if not ok or not isinstance(v, dict):
            self.err(f, c.line, 'P009')
            return None
        if any(k in v for k in ('id', 'op', 'input')):
            self.err(f, c.line, 'P051')
            return None
        return v

    def header(self, f, st):
        rest = st.rest
        if rest == '':
            self.err(f, st.line, 'P005')
            return '', None
        idw, tail = first_word_rest(rest)
        if len(tail) >= 2 and tail[0] == '"' and tail[-1] == '"':
            ok, v = jparse(tail)
            if ok and isinstance(v, str):
                return idw, v
            self.err(f, st.line, 'P004')
        else:
            self.err(f, st.line, 'P005')
        return idw, None

    # ---------------------------------------------------------------- files
    def read_file(self, f, text):
        self.file = f
        if text.startswith('﻿'):
            text = text[1:]
        stmts, cur = [], None
        for i, raw in enumerate(re.split(r'\r\n|\r|\n', text), 1):
            s = rstrip_ws(raw)
            if s == '':
                if cur is not None:
                    cur.body.append((i, -1, ''))
                continue
            j = 0
            while j < len(s) and s[j] == ' ':
                j += 1
            if s[j] in WS_SET:
                self.err(f, i, 'P001')
                continue
            if j == 0:
                if s[0] == '#':
                    continue
                kw, rest = first_word_rest(s)
                cur = Obj(kw=kw, line=i, rest=rest, body=[])
                stmts.append(cur)
            elif cur is None:
                self.err(f, i, 'P003')
            else:
                cur.body.append((i, j, s))
        seen_duramen = False
        for st in stmts:
            kw = st.kw
            if kw == 'duramen':
                if seen_duramen:
                    self.err(f, st.line, 'P023')
                    continue
                seen_duramen = True
                if st.rest in VERSIONS:
                    self.versions[f] = st.rest
                else:
                    self.err(f, st.line, 'P023')
                self.split_clauses(f, st.body, set(), set())
            elif kw in KNOWN:
                getattr(self, 'h_' + kw)(f, st)
            elif kw in UNSPECIFIED:
                pass
            else:
                self.err(f, st.line, 'P002')
        if not seen_duramen:
            self.err(f, 1, 'P020')

    # ----------------------------------------------------------- statements
    def h_spec(self, f, st):
        dup = self.spec is not None
        spec = Obj(file=f, line=st.line, name=None, title=None, text=None, contract=None, request=None)
        if dup:
            self.err(f, st.line, 'P044')
        else:
            self.spec = spec
            w = words(st.rest)
            if len(w) != 2:
                self.err(f, st.line, 'P021')
            else:
                spec.name = w[0]
        for c in self.split_clauses(f, st.body, {'title', 'text', 'contract', 'request'},
                                    {'title', 'text', 'contract', 'request'}):
            if c.kw == 'title':
                spec.title = self.read_title(f, c)
            elif c.kw == 'text':
                spec.text = self.read_text(f, c)
            elif c.kw == 'contract':
                self.no_body(f, c)
                spec.contract = c.rest
            else:
                spec.request = self.read_request(f, c)
        if not dup:
            self.items.append(('spec', spec))

    def h_oracle(self, f, st):
        dup = self.oracle is not None
        o = Obj(file=f, line=st.line, command=st.rest)
        if dup:
            self.err(f, st.line, 'P044')
        else:
            self.oracle = o
            if st.rest == '':
                self.err(f, st.line, 'P028')
        for c in self.split_clauses(f, st.body, {'source'}, set()):
            self.no_body(f, c)

    def h_section(self, f, st):
        sid, title = self.header(f, st)
        obj = Obj(file=f, line=st.line, id=sid, text=None)
        for c in self.split_clauses(f, st.body, {'text'}, {'text'}):
            obj.text = self.read_text(f, c)
        self.items.append(('section', obj))

    def h_note(self, f, st):
        if st.rest != '':
            self.err(f, st.line, 'P050')
        obj = Obj(file=f, line=st.line, text=None)
        for c in self.split_clauses(f, st.body, {'text'}, {'text'}):
            obj.text = self.read_text(f, c)
        self.items.append(('note', obj))

    def h_open(self, f, st):
        oid, title = self.header(f, st)
        obj = Obj(file=f, line=st.line, id=oid, text=None, exlines=[])
        for c in self.split_clauses(f, st.body, {'text', 'example', 'table'}, {'text'}):
            if c.kw == 'text':
                obj.text = self.read_text(f, c)
            else:
                obj.exlines.append(c.line)
        self.items.append(('open', obj))

    def h_decision(self, f, st):
        did, title = self.header(f, st)
        obj = Obj(file=f, line=st.line, id=did, source=None, status=None, text=None, rejected=[])
        for c in self.split_clauses(f, st.body, {'source', 'status', 'text', 'rejected'},
                                    {'source', 'status', 'text'}):
            if c.kw == 'source':
                self.no_body(f, c)
                obj.source = c.rest
            elif c.kw == 'status':
                self.no_body(f, c)
                obj.status = c.rest
            elif c.kw == 'text':
                obj.text = self.read_text(f, c)
            else:
                v = self.read_title(f, c)
                if v is not None:
                    obj.rejected.append(v)
        self.items.append(('decision', obj))

    def h_errors(self, f, st):
        dup = self.errors is not None
        obj = Obj(file=f, line=st.line, codes=[])
        if dup:
            self.err(f, st.line, 'P032')
        else:
            self.errors = obj
        if st.rest != '':
            self.err(f, st.line, 'P050')
        for c in self.split_clauses(f, st.body, None, set()):
            kw2, after = first_word_rest(c.rest)
            ok = kw2 == 'when' and after != ''
            if not ok:
                self.err(f, c.line, 'P019')
            cond = [after]
            for (ln, ind, s) in c.lines:
                if ind < 0:
                    continue
                if ind == 3:
                    self.err(f, ln, 'P006')
                else:
                    cond.append(strip_ws(s))
            if ok:
                obj.codes.append((c.kw, c.line, '\n'.join(cond)))
        if not dup:
            self.items.append(('errors', obj))

    def h_op(self, f, st):
        w = words(st.rest)
        if len(w) != 1:
            self.err(f, st.line, 'P031')
        obj = Obj(file=f, line=st.line, name=w[0] if len(w) == 1 else None, fields={},
                  result=None, tolerances={}, audit=False, request=None)
        for c in self.split_clauses(f, st.body,
                                    {'input', 'result', 'tolerance', 'audit', 'request'},
                                    {'result', 'audit', 'request'}):
            self.no_body(f, c)
            if c.kw == 'input':
                for part in split_fields(c.rest):
                    m = FIELD.match(strip_ws(part))
                    if not m:
                        self.err(f, c.line, 'P017')
                    elif m.group(1) in obj.fields:
                        self.err(f, c.line, 'P052')
                    else:
                        obj.fields[m.group(1)] = m.group(2) == '?'
            elif c.kw == 'result':
                obj.result = c.rest
            elif c.kw == 'tolerance':
                w2 = words(c.rest)
                ok, v = jparse(w2[1]) if len(w2) == 2 else (False, None)
                if not (len(w2) == 2 and ok and is_num(v) and v >= 0):
                    self.err(f, c.line, 'P018')
                elif w2[0] in obj.tolerances:
                    self.err(f, c.line, 'P052')
                else:
                    obj.tolerances[w2[0]] = v
            elif c.kw == 'audit':
                if c.rest not in ('', 'text'):
                    self.err(f, c.line, 'P050')
                else:
                    obj.audit = True
            else:
                obj.request = self.read_request(f, c)
        self.items.append(('op', obj))

    def h_req(self, f, st):
        rid, title = self.header(f, st)
        req = Obj(file=f, line=st.line, id=rid, text=None, text_line=None, decisions=[],
                  on='any', examples=[], has_exlines=False)
        for c in self.split_clauses(f, st.body, {'text', 'decision', 'on', 'example', 'table'},
                                    {'text', 'on'}):
            if c.kw == 'text':
                req.text, req.text_line = self.read_text(f, c), c.line
            elif c.kw == 'decision':
                self.no_body(f, c)
                req.decisions += [d for d in re.split(r'(?:,|' + WS + r')+', c.rest) if d]
            elif c.kw == 'on':
                self.no_body(f, c)
                if c.rest in ('any', 'posix', 'windows'):
                    req.on = c.rest
                else:
                    self.err(f, c.line, 'P033')
            elif c.kw == 'example':
                self.read_example(f, c, req)
            else:
                self.read_table(f, c, req)
        for i, ex in enumerate(req.examples, 1):
            ex.cid = '%s#%d' % (rid, i)
        self.items.append(('req', req))
        self.reqs.append(req)

    # ------------------------------------------------------------- examples
    def read_example(self, f, c, req):
        ex = Obj(file=f, line=c.line, req=req, op=None, raw=None, has_input=False,
                 input_text=None, input_obj=None, request=None, omit=[], exps=[], cid=None,
                 resp=None)
        ok = True
        rest = c.rest
        base = {}
        if rest == '':
            self.err(f, c.line, 'P012')
            ok = False
        else:
            w, tail = first_word_rest(rest)
            if w == 'raw':
                ex.raw = None
                if tail.startswith('"'):
                    good, v = jparse(tail)
                    if good and isinstance(v, str):
                        ex.raw = v
                elif len(tail) >= 2 and tail[0] == "'" and tail[-1] == "'":
                    ex.raw = tail[1:-1]
                if ex.raw is None:
                    self.err(f, c.line, 'P004')
                    ok = False
                    ex.raw = ''
                    israw = True
                elif '\n' in ex.raw or '\r' in ex.raw:
                    self.err(f, c.line, 'P026')
                    ok = False
                israw = True
            else:
                israw = False
                ex.op = w
                if tail != '':
                    good, v = jparse(tail)
                    if not good:
                        self.err(f, c.line, 'P009')
                        ok = False
                    elif not isinstance(v, dict):
                        self.err(f, c.line, 'P012')
                        ok = False
                    else:
                        ex.has_input, ex.input_text, base = True, tail, v
        israw = ex.raw is not None
        inputs = []     # [line, segs|None, from_file|None, text lines, plain]
        cur = None
        seen_request = False
        for (ln, ind, s) in c.lines:
            if ind < 0:
                if cur is not None and cur[4]:
                    cur[3].append('')
                continue
            if cur is not None and cur[4] and ind >= 6:
                cur[3].append(s[6:])
                continue
            if s[ind:].startswith('#'):
                continue
            if cur is not None and cur[5] and ind >= 6:
                self.err(f, ln, 'P006')
                continue
            if ind != 4:
                self.err(f, ln, 'P006')
                continue
            cur = None
            kw, rest = first_word_rest(s[4:])
            if kw == 'expect':
                e = self.parse_expect(f, ln, rest)
                if e is not None:
                    ex.exps.append(e)
            elif kw == 'request':
                if israw:
                    self.err(f, ln, 'P022')
                    continue
                if seen_request:
                    self.err(f, ln, 'P052')
                    continue
                good, v = jparse(rest)
                if not good or not isinstance(v, dict):
                    self.err(f, ln, 'P009')
                elif any(k in v for k in ('id', 'op', 'input')):
                    self.err(f, ln, 'P051')
                else:
                    ex.request = v
                    seen_request = True
            elif kw == 'omit':
                if israw:
                    self.err(f, ln, 'P022')
                    continue
                names = [n for n in re.split(r'(?:,|' + WS + r')+', rest) if n]
                if not names:
                    self.err(f, ln, 'P011')
                ex.omit += names
            elif kw == 'input':
                if israw:
                    self.err(f, ln, 'P022')
                    cur = [ln, None, None, [], True, False]
                    continue
                parsed = parse_input_path(rest)
                entry = [ln, None, None, [], False, False]
                if parsed is None:
                    self.err(f, ln, 'P049')
                    entry[4] = True     # still swallow its text lines
                    cur = entry
                    continue
                segs, pos = parsed
                tail = rest[pos:]
                if strip_ws(tail) == '':
                    entry[1], entry[4] = segs, True
                else:
                    m = re.match(WS + r'+from' + WS + r'+("(?:[^"\\]|\\.)*")\Z', tail, re.S)
                    good, v = jparse(m.group(1)) if m else (False, None)
                    if good and isinstance(v, str):
                        entry[1], entry[2], entry[5] = segs, v, True
                    else:
                        self.err(f, ln, 'P049')
                        entry[4] = True
                        cur = entry
                        continue
                inputs.append(entry)
                cur = entry
            else:
                self.err(f, ln, 'P011')
        if not israw:
            obj = base if isinstance(base, dict) else {}
            used = bool(inputs)
            for (ln, segs, ffile, tlines, plain, isfrom) in inputs:
                cur_o = obj
                bad = False
                for seg in segs[:-1]:
                    if seg not in cur_o:
                        cur_o[seg] = {}
                    elif not isinstance(cur_o[seg], dict):
                        bad = True
                        break
                    cur_o = cur_o[seg]
                if bad:
                    self.err(f, ln, 'P049')
                    continue
                if isfrom:
                    val = self.read_from(f, ffile)
                    if val is None:
                        self.err(f, ln, 'P048')
                        continue
                else:
                    while tlines and tlines[-1] == '':
                        tlines.pop()
                    if not any(t != '' for t in tlines):
                        self.err(f, ln, 'P049')
                        continue
                    val = ''.join(t + '\n' for t in tlines)
                cur_o[segs[-1]] = val
            if used:
                ex.has_input = True
                ex.input_text = jdump(obj)
            ex.input_obj = obj if ex.has_input else {}
        if ok:
            req.examples.append(ex)

    def read_from(self, f, path):
        if path == '' or path.startswith('/'):
            return None
        stack = list(f.split('/')[:-1])
        rf = self.folder_parts
        for seg in path.split('/'):
            if seg in ('', '.'):
                continue
            if seg == '..':
                if len(stack) <= len(rf):
                    return None
                stack.pop()
            else:
                stack.append(seg)
        if stack[:len(rf)] != rf or len(stack) <= len(rf):
            return None
        v = self.files.get('/'.join(stack))
        return v if isinstance(v, str) else None

    def parse_expect(self, f, ln, rest):
        m = re.match('[^=≈~' + re.escape(''.join(WS_SET)) + ']*', rest)
        path = m.group()
        after = lstrip_ws(rest[m.end():])
        if path == '' or after == '':
            self.err(f, ln, 'P011')
            return None
        if after[0] == '=':
            val = strip_ws(after[1:])
            if val == '?':
                return Obj(path=path, kind='oracle', value=None, tol=None, line=ln)
            good, v = jparse(val)
            if not good:
                self.err(f, ln, 'P009')
                return None
            return Obj(path=path, kind='eq', value=v, tol=None, line=ln)
        if after[0] in '≈~':
            r = after[1:]
            sm = APPROX_SEP.search(r)
            if sm:
                g1, n = jparse(strip_ws(r[:sm.start()]))
                g2, t = jparse(strip_ws(r[sm.end():]))
                if g1 and g2 and is_num(n) and is_num(t) and t >= 0:
                    return Obj(path=path, kind='approx', value=n, tol=t, line=ln)
            self.err(f, ln, 'P010')
            return None
        self.err(f, ln, 'P011')
        return None

    # --------------------------------------------------------------- tables
    def read_table(self, f, c, req):
        rows = []
        for (ln, ind, s) in c.lines:
            if ind < 0:
                continue
            st = s[ind:]
            if st.startswith('#'):
                continue
            if ind >= 4 and st.startswith('|'):
                if not is_separator(st):
                    rows.append((ln, st))
            else:
                self.err(f, ln, 'P006')
        w = words(c.rest)
        if len(w) != 1 or len(rows) < 2:
            self.err(f, c.line, 'P013')
            return
        hln, hrow = rows[0]
        cols = []
        for cell in split_row(hrow):
            m = APPROX_SEP.search(cell)
            left = strip_ws(cell[:m.start()] if m else cell)
            tol = strip_ws(cell[m.end():]) if m else None
            if re.fullmatch(r'(result|audit|error|id)(\.\S+)?', left):
                kind = 'expect'
            elif re.fullmatch(r'[A-Za-z0-9_-]+', left):
                kind = 'input'
            else:
                self.err(f, hln, 'P013')
                return
            cols.append([kind, left, tol])
        for col in cols:
            tol = col[2]
            if tol is None:
                continue
            good, v = jparse(tol)
            if col[0] == 'input' or not (good and is_num(v) and v >= 0):
                self.err(f, hln, 'P010')
                col[2] = None
            else:
                col[2] = v
        for (ln, row) in rows[1:]:
            cells = split_row(row)
            if len(cells) != len(cols):
                self.err(f, ln, 'P014')
                continue
            ex = Obj(file=f, line=ln, req=req, op=w[0], raw=None, has_input=True,
                     input_text=None, input_obj={}, request=None, omit=[], exps=[], cid=None,
                     resp=None)
            parts = []
            good_row = True
            for col, cell in zip(cols, cells):
                if cell == '':
                    continue
                kind, name, tol = col
                if kind == 'input':
                    g, v = jparse(cell)
                    if not g:
                        self.err(f, ln, 'P009')
                        good_row = False
                        continue
                    ex.input_obj[name] = v
                    parts.append('"%s":%s' % (name, cell))
                elif cell == '?':
                    ex.exps.append(Obj(path=name, kind='oracle', value=None, tol=None, line=ln))
                elif tol is not None:
                    g, v = jparse(cell)
                    if not (g and is_num(v)):
                        self.err(f, ln, 'P010')
                        good_row = False
                        continue
                    ex.exps.append(Obj(path=name, kind='approx', value=v, tol=tol, line=ln))
                else:
                    g, v = jparse(cell)
                    if not g:
                        self.err(f, ln, 'P009')
                        good_row = False
                        continue
                    ex.exps.append(Obj(path=name, kind='eq', value=v, tol=None, line=ln))
            ex.input_text = '{' + ','.join(parts) + '}'
            if good_row:
                req.examples.append(ex)
