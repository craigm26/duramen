"""duramen-core: the checker and suite generator (check and cases)."""
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from decimal import Decimal

# ---------------------------------------------------------------- text helpers

WS_CHARS = ('\t\n\x0b\x0c\r           '
            '       　﻿')
WS_SET = frozenset(WS_CHARS)
WSC = '[' + WS_CHARS + ']'
SPLIT_WS = re.compile(WSC + '+')
ORACLE_TIMEOUT = 30


def split_word(s):
    s = s.strip(WS_CHARS)
    m = SPLIT_WS.search(s)
    if not m:
        return s, ''
    return s[:m.start()], s[m.end():]


def words(s):
    return [w for w in SPLIT_WS.split(s.strip(WS_CHARS)) if w]


def utf16key(s):
    return s.encode('utf-16-be', 'surrogatepass')


class O:
    def __init__(self, **kw):
        self.__dict__.update(kw)


# ---------------------------------------------------------------- JSON helpers

def normnum(f):
    if math.isfinite(f) and f == int(f) and abs(f) < 9007199254740992:
        return int(f)
    return f


def _reject(c):
    raise ValueError(c)


_DEC = json.JSONDecoder(parse_int=lambda s: normnum(float(s)),
                        parse_float=lambda s: normnum(float(s)),
                        parse_constant=_reject)


def parse_json(text):
    try:
        return True, _DEC.decode(text)
    except (ValueError, RecursionError):
        return False, None


def parse_jstring(text):
    ok, v = parse_json(text)
    if ok and isinstance(v, str):
        return True, v
    return False, None


NUM_SRC = r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?'
NUM_RE = re.compile(NUM_SRC)
APPROX_RE = re.compile(WSC + '*(' + NUM_SRC + ')' + WSC + '*(?:±|\\+-)' + WSC + '*(' + NUM_SRC + ')' + WSC + '*')


def num_value(text):
    return normnum(float(text))


def es_number(x):
    if isinstance(x, int):
        return str(x)
    if not math.isfinite(x):
        return 'null'
    if x == 0:
        return '0'
    sign = '-' if x < 0 else ''
    _, digs, exp = Decimal(repr(abs(x))).as_tuple()
    d = ''.join(str(i) for i in digs)
    while len(d) > 1 and d.endswith('0'):
        d = d[:-1]
        exp += 1
    k = len(d)
    n = k + exp
    if k <= n <= 21:
        r = d + '0' * (n - k)
    elif 0 < n <= 21:
        r = d[:n] + '.' + d[n:]
    elif -6 < n <= 0:
        r = '0.' + '0' * (-n) + d
    else:
        e = n - 1
        es = ('+' if e >= 0 else '-') + str(abs(e))
        r = d[0] + 'e' + es if k == 1 else d[0] + '.' + d[1:] + 'e' + es
    return sign + r


def js_quote(s):
    out = ['"']
    for ch in s:
        o = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == '\\':
            out.append('\\\\')
        elif ch == '\b':
            out.append('\\b')
        elif ch == '\f':
            out.append('\\f')
        elif ch == '\n':
            out.append('\\n')
        elif ch == '\r':
            out.append('\\r')
        elif ch == '\t':
            out.append('\\t')
        elif o < 0x20 or 0xD800 <= o <= 0xDFFF:
            out.append('\\u%04x' % o)
        else:
            out.append(ch)
    out.append('"')
    return ''.join(out)


_INDEX_RE = re.compile(r'0|[1-9][0-9]*')


def is_index(k):
    return _INDEX_RE.fullmatch(k) is not None and int(k) < 4294967295


def es_keys(d):
    idx = sorted((k for k in d if is_index(k)), key=int)
    return idx + [k for k in d if not is_index(k)]


def js_stringify(v):
    if v is None:
        return 'null'
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, (int, float)):
        return es_number(v)
    if isinstance(v, str):
        return js_quote(v)
    if isinstance(v, list):
        return '[' + ','.join(js_stringify(i) for i in v) + ']'
    return '{' + ','.join(js_quote(k) + ':' + js_stringify(v[k]) for k in es_keys(v)) + '}'


def jeq(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return float(a) == float(b)
    if isinstance(a, str) and isinstance(b, str):
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(jeq(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return len(a) == len(b) and all(k in b and jeq(a[k], b[k]) for k in a)
    return False


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def get_path(resp, path):
    names = path.split('.')
    cur = resp
    for i, nm in enumerate(names):
        if i == 1 and names[0] == 'audit' and isinstance(cur, str):
            ok, cur = parse_json(cur)
            if not ok:
                return False, None
        if isinstance(cur, dict):
            if nm in cur:
                cur = cur[nm]
            else:
                return False, None
        elif isinstance(cur, list):
            if _INDEX_RE.fullmatch(nm) and int(nm) < len(cur):
                cur = cur[int(nm)]
            else:
                return False, None
        else:
            return False, None
    return True, cur


# ---------------------------------------------------------------- diagnostics

LEVEL_RANK = {'error': 0, 'warning': 1, 'info': 2}


class Diags:
    def __init__(self):
        self.items = []

    def add(self, file, line, code, level='error'):
        self.items.append((file, line, code, level))

    def has_p_error(self):
        return any(c.startswith('P') and lv == 'error' for _, _, c, lv in self.items)

    def sorted(self):
        return sorted(self.items, key=lambda d: (utf16key(d[0]), d[1], utf16key(d[2]), LEVEL_RANK[d[3]]))

    def lines(self):
        return ['%s:%d: %s %s' % (f, ln, lv, c) for f, ln, c, lv in self.sorted()]

    def count(self, level):
        return sum(1 for d in self.items if d[3] == level)


# ---------------------------------------------------------------- tokenizing

KNOWN = {'duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note'}
OPEN_LANG = {'type', 'edge', 'edgedef', 'property', 'evidence'}
LINE_SPLIT = re.compile('\r\n|\r|\n')


class Stmt:
    def __init__(self, kw, line, rest, known):
        self.kw = kw
        self.line = line
        self.rest = rest
        self.known = known
        self.body = []


def tokenize(name, text, d):
    if text.startswith('﻿'):
        text = text[1:]
    stmts = []
    cur = None
    for ln, raw in enumerate(LINE_SPLIT.split(text), 1):
        s = raw.rstrip(WS_CHARS)
        if not s:
            if cur is not None:
                cur.body.append((ln, 0, '', True))
            continue
        content = s.lstrip(' ')
        lead = len(s) - len(content)
        if content[0] in WS_SET:
            d.add(name, ln, 'P001')
            continue
        if lead == 0:
            if content.startswith('#'):
                continue
            kw, rest = split_word(content)
            known = kw in KNOWN
            if not known and kw not in OPEN_LANG:
                d.add(name, ln, 'P002')
            cur = Stmt(kw, ln, rest, known)
            stmts.append(cur)
        else:
            if cur is None:
                d.add(name, ln, 'P003')
            else:
                cur.body.append((ln, lead, content, False))
    return stmts


def collect_clauses(st, name, d, allowed, once):
    clauses = []
    cur = None
    seen = set()
    for ln, ind, content, blank in st.body:
        if blank:
            if cur is not None and not cur.ignored:
                cur.subs.append((ln, 0, '', True))
            continue
        if ind == 1:
            d.add(name, ln, 'P007')
            continue
        if ind == 2:
            if content.startswith('#'):
                continue
            kw, rest = split_word(content)
            c = O(kw=kw, line=ln, rest=rest, subs=[], ignored=False)
            if allowed is not None and kw not in allowed:
                d.add(name, ln, 'P015')
                c.ignored = True
            elif kw in once and kw in seen:
                d.add(name, ln, 'P052')
                c.ignored = True
            else:
                seen.add(kw)
                clauses.append(c)
            cur = c
            continue
        if cur is None:
            d.add(name, ln, 'P006')
            continue
        if cur.ignored:
            continue
        cur.subs.append((ln, ind, content, False))
    return clauses


def no_lines(c, name, d):
    for ln, ind, content, blank in c.subs:
        if blank or content.startswith('#'):
            continue
        d.add(name, ln, 'P006')


def read_text(c, name, d):
    if c.rest:
        d.add(name, c.line, 'P008')
    lines = []
    for ln, ind, content, blank in c.subs:
        if blank:
            lines.append('')
        elif ind >= 4:
            lines.append(' ' * (ind - 4) + content)
        else:
            d.add(name, ln, 'P008')
    while lines and lines[0] == '':
        lines.pop(0)
    while lines and lines[-1] == '':
        lines.pop()
    return lines


def read_request(c, name, d):
    no_lines(c, name, d)
    ok, v = parse_json(c.rest)
    if not ok or not isinstance(v, dict):
        d.add(name, c.line, 'P009')
        return None
    if any(k in v for k in ('id', 'op', 'input')):
        d.add(name, c.line, 'P051')
        return None
    return v


def read_header(st, name, d):
    idw, rest = split_word(st.rest)
    if idw == '' or len(rest) < 2 or not (rest[0] == '"' and rest[-1] == '"'):
        d.add(name, st.line, 'P005')
        return idw, None
    ok, v = parse_jstring(rest)
    if not ok:
        d.add(name, st.line, 'P004')
        return idw, None
    return idw, v


# ---------------------------------------------------------------- examples

def parse_expect_line(r, ln, name, d):
    m = re.match('[^' + WS_CHARS + '=≈~]*', r)
    path = m.group(0)
    after = r[len(path):].lstrip(WS_CHARS)
    if path == '':
        d.add(name, ln, 'P011')
        return None
    if after.startswith('='):
        v = after[1:].strip(WS_CHARS)
        if v == '?':
            return O(line=ln, path=path, kind='oracle', value=None, tol=None)
        ok, val = parse_json(v)
        if not ok:
            d.add(name, ln, 'P009')
            return None
        return O(line=ln, path=path, kind='eq', value=val, tol=None)
    if after[:1] in ('≈', '~') and after:
        m2 = APPROX_RE.fullmatch(after[1:])
        if not m2 or float(m2.group(2)) < 0:
            d.add(name, ln, 'P010')
            return None
        return O(line=ln, path=path, kind='approx', value=num_value(m2.group(1)),
                 tol=num_value(m2.group(2)))
    d.add(name, ln, 'P011')
    return None


def resolve_from(ctx, fname):
    if fname == '' or fname.startswith('/'):
        return None
    parts = list(ctx.dir)
    for p in fname.split('/'):
        if p in ('', '.'):
            continue
        if p == '..':
            if not parts:
                return None
            parts.pop()
        else:
            parts.append(p)
    f = ctx.folder
    if len(parts) <= len(f) or parts[:len(f)] != f:
        return None
    key = '/'.join(parts)
    v = ctx.files.get(key)
    return v if isinstance(v, str) else None


PATH_WORD = re.compile(r'[A-Za-z0-9_-]+')


def parse_input_path(s):
    """Returns a list of names or None."""
    if s == '':
        return None
    names = []
    i = 0
    n = len(s)
    while True:
        if i >= n:
            return None
        if s[i] == '"':
            try:
                v, end = json.JSONDecoder().raw_decode(s, i)
            except ValueError:
                return None
            if not isinstance(v, str):
                return None
            names.append(v)
            i = end
        else:
            m = PATH_WORD.match(s, i)
            if not m:
                return None
            names.append(m.group(0))
            i = m.end()
        if i == n:
            return names
        if s[i] != '.':
            return None
        i += 1


FROM_RE = re.compile(WSC + '+from' + WSC + '+')


def split_from(rest):
    for m in FROM_RE.finditer(rest):
        ok, v = parse_jstring(rest[m.end():])
        if ok:
            return rest[:m.start()], v
    return rest, None


def set_input(obj, names, value):
    cur = obj
    for nm in names[:-1]:
        if nm not in cur:
            cur[nm] = {}
        elif not isinstance(cur[nm], dict):
            return False
        cur = cur[nm]
    cur[names[-1]] = value
    return True


def parse_example(c, ctx, d):
    name = ctx.file
    ex = O(line=c.line, op=None, raw=False, rawline=None, input_text=None, obj=None,
           input_lines=False, request=None, omit=[], expects=[], dropped=False, row=False)
    rest = c.rest
    if rest == '':
        d.add(name, c.line, 'P012')
        ex.dropped = True
    else:
        w, r = split_word(rest)
        if w == 'raw':
            ex.raw = True
            ok = False
            line = None
            if r.startswith('"'):
                ok, line = parse_jstring(r)
            elif len(r) >= 2 and r.startswith("'") and r.endswith("'"):
                ok, line = True, r[1:-1]
            if not ok:
                d.add(name, c.line, 'P004')
                ex.dropped = True
            elif '\n' in line or '\r' in line:
                d.add(name, c.line, 'P026')
                ex.dropped = True
            else:
                ex.rawline = line
        else:
            ex.op = w
            if r:
                ok, v = parse_json(r)
                if not ok:
                    d.add(name, c.line, 'P009')
                    ex.dropped = True
                elif not isinstance(v, dict):
                    d.add(name, c.line, 'P012')
                    ex.dropped = True
                else:
                    ex.input_text = r
                    ex.obj = v
    subs = c.subs
    i = 0
    n = len(subs)
    seen_request = False
    scratch = {}
    while i < n:
        ln, ind, content, blank = subs[i]
        i += 1
        if blank or content.startswith('#'):
            continue
        if ind != 4:
            d.add(name, ln, 'P006')
            continue
        w, r = split_word(content)
        if w == 'expect':
            e = parse_expect_line(r, ln, name, d)
            if e:
                ex.expects.append(e)
        elif w == 'request':
            if ex.raw:
                d.add(name, ln, 'P022')
                continue
            ok, v = parse_json(r)
            if not ok or not isinstance(v, dict):
                d.add(name, ln, 'P009')
            elif any(k in v for k in ('id', 'op', 'input')):
                d.add(name, ln, 'P051')
            elif seen_request:
                d.add(name, ln, 'P052')
            else:
                seen_request = True
                ex.request = v
        elif w == 'omit':
            if ex.raw:
                d.add(name, ln, 'P022')
                continue
            names = [t for t in re.split('[,' + WS_CHARS + ']+', r) if t]
            if not names:
                d.add(name, ln, 'P011')
            ex.omit.extend(names)
        elif w == 'input':
            pathtext, fname = split_from(r)
            text_lines = []
            if fname is None:
                while i < n:
                    l2, i2, c2, b2 = subs[i]
                    if b2:
                        text_lines.append('')
                    elif i2 >= 6:
                        text_lines.append(' ' * (i2 - 6) + c2)
                    else:
                        break
                    i += 1
                while text_lines and text_lines[-1] == '':
                    text_lines.pop()
            if ex.raw:
                d.add(name, ln, 'P022')
                continue
            names = parse_input_path(pathtext.strip(WS_CHARS))
            if names is None:
                d.add(name, ln, 'P049')
                continue
            if fname is None:
                if not text_lines:
                    d.add(name, ln, 'P049')
                    continue
                value = ''.join(t + '\n' for t in text_lines)
            else:
                value = resolve_from(ctx, fname)
                if value is None:
                    d.add(name, ln, 'P048')
                    continue
            if ex.obj is None and not scratch.get('base'):
                scratch['base'] = {}
            base = ex.obj if ex.obj is not None else scratch['base']
            if not set_input(base, names, value):
                d.add(name, ln, 'P049')
                continue
            ex.input_lines = True
            if ex.obj is None:
                ex.obj = base
        else:
            d.add(name, ln, 'P011')
    return ex


# ---------------------------------------------------------------- tables

def split_cells(content):
    cells = []
    cur = []
    i = 1
    n = len(content)
    while i < n:
        ch = content[i]
        if ch == '\\' and i + 1 < n and content[i + 1] == '|':
            cur.append('|')
            i += 2
            continue
        if ch == '|':
            cells.append(''.join(cur))
            cur = []
        else:
            cur.append(ch)
        i += 1
    if ''.join(cur).strip(WS_CHARS) != '':
        cells.append(''.join(cur))
    return [x.strip(WS_CHARS) for x in cells]


SEP_CHARS = frozenset('|-: ')
FIELD_RE = re.compile(r'[A-Za-z0-9_-]+')
HPATH_RE = re.compile('(?:result|audit|error|id)(?:\\.[^' + WS_CHARS + ']*)?')


def parse_table(c, ctx, d):
    name = ctx.file
    rows = []
    for ln, ind, content, blank in c.subs:
        if blank or content.startswith('#'):
            continue
        if content.startswith('|'):
            if ind < 4:
                d.add(name, ln, 'P006')
                continue
            if content.endswith('|') and all(ch in SEP_CHARS for ch in content):
                continue
            rows.append((ln, split_cells(content)))
        else:
            d.add(name, ln, 'P006')
    if len(words(c.rest)) != 1 or len(rows) < 2:
        d.add(name, c.line, 'P013')
        return []
    op = c.rest.strip(WS_CHARS)
    hline, hcells = rows[0]
    cols = []
    seen = set()
    bad = False
    for cell in hcells:
        m = re.search('±|\\+-', cell)
        if m:
            left = cell[:m.start()].strip(WS_CHARS)
            tol_text = cell[m.end():].strip(WS_CHARS)
        else:
            left = cell
            tol_text = None
        if HPATH_RE.fullmatch(left):
            kind = 'path'
        elif FIELD_RE.fullmatch(left):
            kind = 'field'
        else:
            bad = True
            break
        if left in seen:
            bad = True
            break
        seen.add(left)
        tol = None
        if tol_text is not None:
            if kind == 'field' or not NUM_RE.fullmatch(tol_text) or float(tol_text) < 0:
                d.add(name, hline, 'P010')
            else:
                tol = num_value(tol_text)
        cols.append(O(name=left, kind=kind, tol=tol))
    if bad:
        d.add(name, hline, 'P013')
        return []
    out = []
    for ln, cells in rows[1:]:
        if len(cells) != len(cols):
            d.add(name, ln, 'P014')
            continue
        ex = O(line=ln, op=op, raw=False, rawline=None, input_text=None, obj={}, input_lines=False,
               request=None, omit=[], expects=[], dropped=False, row=True)
        parts = []
        for col, cell in zip(cols, cells):
            if cell == '':
                continue
            if col.kind == 'field':
                ok, v = parse_json(cell)
                if not ok:
                    d.add(name, ln, 'P009')
                    continue
                parts.append(js_quote(col.name) + ':' + cell)
                ex.obj[col.name] = v
            elif cell == '?':
                ex.expects.append(O(line=ln, path=col.name, kind='oracle', value=None, tol=None))
            elif col.tol is not None:
                if not NUM_RE.fullmatch(cell):
                    d.add(name, ln, 'P010')
                else:
                    ex.expects.append(O(line=ln, path=col.name, kind='approx', value=num_value(cell),
                                        tol=col.tol))
            else:
                ok, v = parse_json(cell)
                if not ok:
                    d.add(name, ln, 'P009')
                else:
                    ex.expects.append(O(line=ln, path=col.name, kind='eq', value=v, tol=None))
        ex.input_text = '{' + ','.join(parts) + '}'
        out.append(ex)
    return out


# ---------------------------------------------------------------- statements

FIELD_FULL = re.compile('([A-Za-z0-9_-]+)(\\?)?' + WSC + '+(.+)', re.S)


def split_top_commas(s):
    parts = []
    cur = []
    depth = 0
    inq = False
    esc = False
    for ch in s:
        if inq:
            cur.append(ch)
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                inq = False
            continue
        if ch == '"':
            inq = True
            cur.append(ch)
        elif ch in '([{':
            depth += 1
            cur.append(ch)
        elif ch in ')]}':
            depth = max(0, depth - 1)
            cur.append(ch)
        elif ch == ',' and depth == 0:
            parts.append(''.join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append(''.join(cur))
    return parts


class Record:
    def __init__(self):
        self.specs = []
        self.oracles = []
        self.errors = []
        self.ops = []
        self.reqs = []
        self.opens = []
        self.decisions = []
        self.sections = []
        self.notes = []
        self.versions = []


def read_stmts(rec, name, stmts, ctx, d):
    n_dur = 0
    file_version = None
    for st in stmts:
        kw = st.kw
        if not st.known:
            continue
        if kw == 'duramen':
            n_dur += 1
            if n_dur == 1 and st.rest in ('0.1', '0.2'):
                file_version = st.rest
            else:
                d.add(name, st.line, 'P023')
            collect_clauses(st, name, d, (), ())
        elif kw == 'spec':
            sp = O(line=st.line, file=name, title=None, contract=None, request=None, text=None)
            if len(words(st.rest)) != 2:
                d.add(name, st.line, 'P021')
            if rec.specs:
                d.add(name, st.line, 'P044')
            rec.specs.append(sp)
            once = {'title', 'contract', 'request', 'text'}
            for c in collect_clauses(st, name, d, once, once):
                if c.kw == 'title':
                    no_lines(c, name, d)
                    ok, v = parse_jstring(c.rest)
                    if ok:
                        sp.title = v
                    else:
                        d.add(name, c.line, 'P004')
                elif c.kw == 'contract':
                    no_lines(c, name, d)
                    sp.contract = c.rest
                elif c.kw == 'request':
                    sp.request = read_request(c, name, d)
                else:
                    sp.text = read_text(c, name, d)
        elif kw == 'oracle':
            orc = O(line=st.line, file=name, command=st.rest)
            if not st.rest:
                d.add(name, st.line, 'P028')
            if rec.oracles:
                d.add(name, st.line, 'P044')
            rec.oracles.append(orc)
            for c in collect_clauses(st, name, d, {'source'}, ()):
                no_lines(c, name, d)
        elif kw == 'errors':
            if st.rest:
                d.add(name, st.line, 'P050')
            ent = O(line=st.line, file=name, entries=[])
            if rec.errors:
                d.add(name, st.line, 'P032')
            rec.errors.append(ent)
            for c in collect_clauses(st, name, d, None, ()):
                w, first = split_word(c.rest)
                if w != 'when' or first == '':
                    d.add(name, c.line, 'P019')
                cond = [first]
                for ln, ind, content, blank in c.subs:
                    if blank:
                        cond.append('')
                    elif ind >= 4:
                        cond.append(' ' * (ind - 4) + content)
                    else:
                        d.add(name, ln, 'P006')
                ent.entries.append(O(code=c.kw, line=c.line, cond=cond))
        elif kw == 'note':
            if st.rest:
                d.add(name, st.line, 'P050')
            nt = O(line=st.line, file=name, text=None)
            for c in collect_clauses(st, name, d, {'text'}, {'text'}):
                nt.text = read_text(c, name, d)
            rec.notes.append(nt)
        elif kw == 'section':
            sid, title = read_header(st, name, d)
            sc = O(line=st.line, file=name, id=sid, text=None)
            for c in collect_clauses(st, name, d, {'text'}, {'text'}):
                sc.text = read_text(c, name, d)
            rec.sections.append(sc)
        elif kw == 'op':
            read_op(rec, st, name, d)
        elif kw == 'req':
            read_req(rec, st, ctx, d)
        elif kw == 'open':
            oid, title = read_header(st, name, d)
            op = O(line=st.line, file=name, id=oid, text=None, tests=[])
            allowed = {'text', 'example', 'table'}
            for c in collect_clauses(st, name, d, allowed, {'text'}):
                if c.kw == 'text':
                    op.text = read_text(c, name, d)
                else:
                    op.tests.append(c.line)
            rec.opens.append(op)
        elif kw == 'decision':
            read_decision(rec, st, name, d)
    if n_dur == 0:
        d.add(name, 1, 'P020')
    if file_version:
        rec.versions.append(file_version)


def read_op(rec, st, name, d):
    nm = st.rest
    op = O(line=st.line, file=name, name=None, fields={}, result=None, audit=False, request=None, tolerances={})
    if len(words(nm)) != 1:
        d.add(name, st.line, 'P031')
    else:
        op.name = nm.strip(WS_CHARS)
    once = {'result', 'audit', 'request'}
    allowed = {'input', 'result', 'audit', 'tolerance', 'request'}
    for c in collect_clauses(st, name, d, allowed, once):
        if c.kw == 'input':
            no_lines(c, name, d)
            for part in split_top_commas(c.rest):
                m = FIELD_FULL.fullmatch(part.strip(WS_CHARS))
                if not m:
                    d.add(name, c.line, 'P017')
                elif m.group(1) in op.fields:
                    d.add(name, c.line, 'P052')
                else:
                    op.fields[m.group(1)] = bool(m.group(2))
        elif c.kw == 'result':
            no_lines(c, name, d)
            op.result = c.rest
        elif c.kw == 'audit':
            no_lines(c, name, d)
            if c.rest in ('', 'text'):
                op.audit = True
            else:
                d.add(name, c.line, 'P050')
        elif c.kw == 'request':
            op.request = read_request(c, name, d)
        else:
            ws = words(c.rest)
            if len(ws) != 2 or not NUM_RE.fullmatch(ws[1]) or float(ws[1]) < 0:
                d.add(name, c.line, 'P018')
                no_lines(c, name, d)
            elif ws[0] in op.tolerances:
                d.add(name, c.line, 'P052')
            else:
                no_lines(c, name, d)
                op.tolerances[ws[0]] = num_value(ws[1])
    rec.ops.append(op)


def read_req(rec, st, ctx, d):
    name = ctx.file
    rid, title = read_header(st, name, d)
    rq = O(line=st.line, file=name, id=rid, text=None, text_line=None, decisions=[], platform='any', examples=[])
    allowed = {'text', 'decision', 'on', 'example', 'table'}
    for c in collect_clauses(st, name, d, allowed, {'text', 'on'}):
        if c.kw == 'text':
            rq.text = read_text(c, name, d)
            rq.text_line = c.line
        elif c.kw == 'decision':
            no_lines(c, name, d)
            rq.decisions.extend(t for t in re.split('[,' + WS_CHARS + ']+', c.rest) if t)
        elif c.kw == 'on':
            no_lines(c, name, d)
            if c.rest in ('any', 'posix', 'windows'):
                rq.platform = c.rest
            else:
                d.add(name, c.line, 'P033')
        elif c.kw == 'example':
            rq.examples.append(parse_example(c, ctx, d))
        else:
            rq.examples.extend(parse_table(c, ctx, d))
    rec.reqs.append(rq)


def read_decision(rec, st, name, d):
    did, title = read_header(st, name, d)
    dc = O(line=st.line, file=name, id=did, source=None, status=None, text=None, rejected=[])
    allowed = {'source', 'status', 'text', 'rejected'}
    for c in collect_clauses(st, name, d, allowed, {'source', 'status', 'text'}):
        if c.kw == 'text':
            dc.text = read_text(c, name, d)
            continue
        no_lines(c, name, d)
        if c.kw == 'source':
            dc.source = c.rest
        elif c.kw == 'status':
            dc.status = c.rest
        else:
            ok, v = parse_jstring(c.rest)
            if ok:
                dc.rejected.append(v)
            else:
                d.add(name, c.line, 'P004')
    rec.decisions.append(dc)


# ---------------------------------------------------------------- the record

def eligible(parts):
    if not parts[-1].endswith('.duramen'):
        return False
    if any(p.startswith('.') for p in parts):
        return False
    return not any(p in ('build', 'node_modules') for p in parts[:-1])


def read_record(files, entry, d):
    given = '.' if entry in (None, '.') else entry
    if entry in (None, '.'):
        selected = [n for n in files if eligible(n.split('/'))]
        folder = []
        recname = '.'
    elif entry in files:
        selected = [entry]
        folder = entry.split('/')[:-1]
        recname = entry
    else:
        prefix = entry + '/'
        selected = [n for n in files if n.startswith(prefix) and eligible(n[len(prefix):].split('/'))]
        folder = entry.split('/')
        recname = entry
    if not selected:
        d.add(given, 1, 'P046')
        return None
    selected.sort(key=utf16key)
    rec = Record()
    rec.folder = folder
    rec.files = files
    for name in selected:
        stmts = tokenize(name, files[name], d)
        ctx = O(file=name, files=files, folder=folder, dir=name.split('/')[:-1])
        read_stmts(rec, name, stmts, ctx, d)
    if not rec.specs:
        d.add(recname, 1, 'P021')
    if len(set(rec.versions)) > 1:
        d.add(recname, 1, 'P047')
    return rec


# ---------------------------------------------------------------- checks

OBL = re.compile('(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])')
CLOSERS = {'"': '"', '“': '”', '`': '`'}


def strip_quotes(line):
    out = []
    i = 0
    n = len(line)
    while i < n:
        ch = line[i]
        if ch in CLOSERS:
            j = line.find(CLOSERS[ch], i + 1)
            if j != -1:
                out.append(' ')
                i = j + 1
                continue
        out.append(ch)
        i += 1
    return ''.join(out)


def has_obligation(lines):
    return any(OBL.search(strip_quotes(ln)) for ln in lines)


PHRASES = ['in this order', 'in the order', 'first that applies', 'first match', 'precede', 'precedes',
           'preceded', 'before', 'after', 'take precedence', 'takes precedence']
PHRASE_RE = re.compile('(?<![A-Za-z0-9_])(?:' + '|'.join(
    (WSC + '+').join(re.escape(w) for w in p.split())
    for p in PHRASES) + ')(?![A-Za-z0-9_])', re.I)

STATUS_WORDS = ('observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected')


def split_command(cmd):
    out = []
    cur = []
    inword = False
    i = 0
    n = len(cmd)
    while i < n:
        c = cmd[i]
        if c in ' \t':
            if inword:
                out.append(''.join(cur))
                cur = []
                inword = False
            i += 1
        elif c == '"':
            inword = True
            i += 1
            closed = False
            while i < n:
                if cmd[i] == '\\' and i + 1 < n and cmd[i + 1] == '"':
                    cur.append('"')
                    i += 2
                elif cmd[i] == '"':
                    closed = True
                    i += 1
                    break
                else:
                    cur.append(cmd[i])
                    i += 1
            if not closed:
                return None
        elif c == "'":
            inword = True
            i += 1
            j = cmd.find("'", i)
            if j == -1:
                return None
            cur.append(cmd[i:j])
            i = j + 1
        else:
            inword = True
            cur.append(c)
            i += 1
    if inword:
        out.append(''.join(cur))
    return out


def has_error_expect(ex):
    return any(e.path == 'error' for e in ex.expects)


def build_line(ex, case_id, spec, op):
    if ex.raw:
        return ex.rawline
    if op is not None and op.request is not None:
        members = dict(op.request)
    elif spec is not None and spec.request is not None:
        members = dict(spec.request)
    else:
        members = {}
    if ex.request:
        members.update(ex.request)
    omit = set(ex.omit)
    parts = []
    if 'id' not in omit:
        parts.append('"id":' + js_quote(case_id))
    if 'op' not in omit:
        parts.append('"op":' + js_quote(ex.op))
    for k in es_keys(members):
        if k not in omit:
            parts.append(js_quote(k) + ':' + js_stringify(members[k]))
    if 'input' not in omit:
        if ex.input_lines:
            parts.append('"input":' + js_stringify(ex.obj))
        elif ex.input_text is not None:
            parts.append('"input":' + ex.input_text)
    return '{' + ','.join(parts) + '}'


def is_solo(ex):
    return ex.raw or 'id' in ex.omit


def run_process(words_, cwd, lines):
    """Returns (started, ok, out_lines)."""
    try:
        p = subprocess.Popen(words_, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, cwd=cwd)
    except (OSError, ValueError):
        return False, False, []
    data = ''.join(l + '\n' for l in lines).encode('utf-8', 'surrogatepass')
    timed_out = False
    try:
        out, _ = p.communicate(data, timeout=ORACLE_TIMEOUT)
    except subprocess.TimeoutExpired:
        timed_out = True
        p.kill()
        out, _ = p.communicate()
    except OSError:
        out = b''
        p.kill()
        p.wait()
    ok = (not timed_out) and p.returncode == 0
    text = (out or b'').decode('utf-8', 'replace')
    return True, ok, [l for l in text.split('\n') if l.strip(' \t\r') != '']


def parse_response(line):
    ok, v = parse_json(line)
    if ok and isinstance(v, dict):
        return v
    return None


def write_files(files):
    tmp = tempfile.mkdtemp(prefix='duramen-')
    for n, t in files.items():
        try:
            p = os.path.join(tmp, *n.split('/'))
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'w', encoding='utf-8', newline='', errors='surrogatepass') as f:
                f.write(t)
        except (OSError, ValueError):
            pass
    return tmp


def check_record(rec, d, entry_name):
    """Runs the T checks and the oracle. Returns (items, responses)."""
    spec = rec.specs[0]
    errs = rec.errors[0] if rec.errors else None
    codes = [e.code for e in errs.entries] if errs else []
    # file of each statement is needed for diagnostics: stored on objects below
    seen = set()
    for r in rec.reqs:
        if r.id in seen:
            d.add(r.file, r.line, 'T007')
        seen.add(r.id)
    seen = set()
    for o in rec.opens:
        if o.id in seen:
            d.add(o.file, o.line, 'T007')
        seen.add(o.id)
    seen = set()
    for dc in rec.decisions:
        if dc.id in seen:
            d.add(dc.file, dc.line, 'T007')
        seen.add(dc.id)
    ops = {}
    for o in rec.ops:
        if o.name is None:
            continue
        if o.name in ops:
            d.add(o.file, o.line, 'T007')
        else:
            ops[o.name] = o
    decls = {}
    for dc in rec.decisions:
        decls.setdefault(dc.id, dc)
    cited = set()
    for r in rec.reqs:
        cited.update(r.decisions)

    for r in rec.reqs:
        if not r.examples:
            d.add(r.file, r.line, 'T001')
        flagged = set()
        for did in r.decisions:
            if did in flagged:
                continue
            flagged.add(did)
            dc = decls.get(did)
            if dc is None:
                d.add(r.file, r.line, 'T008')
                continue
            w = split_word(dc.status)[0] if dc.status is not None else 'accepted'
            if w in ('contested', 'superseded', 'rejected'):
                d.add(r.file, r.line, 'T028')
            elif w in ('observed', 'inferred', 'proposed'):
                d.add(r.file, r.line, 'T028', 'warning')
        if errs and r.text is not None:
            joined = '\n'.join(r.text)
            found = [c for c in dict.fromkeys(codes)
                     if re.search('(?<![A-Za-z0-9_-])' + re.escape(c) + '(?![A-Za-z0-9_-])', joined)]
            if len(found) >= 2 and PHRASE_RE.search(joined):
                d.add(r.file, r.text_line, 'T005')
        for ex in r.examples:
            if has_error_expect(ex) or ex.raw:
                pass
            else:
                op = ops.get(ex.op)
                if op is None:
                    d.add(r.file, ex.line, 'T009')
                else:
                    given = ex.obj if ex.obj is not None else {}
                    for f, opt in op.fields.items():
                        if not opt and f not in given:
                            d.add(r.file, ex.line, 'T010')
                    for k in given:
                        if k not in op.fields:
                            d.add(r.file, ex.line, 'T011', 'warning')
            for e in ex.expects:
                if e.path == 'error' and e.kind == 'eq':
                    if not (isinstance(e.value, str) and e.value in codes):
                        d.add(r.file, e.line, 'T023')
    for o in rec.opens:
        for ln in o.tests:
            d.add(o.file, ln, 'T003')
        if o.text is not None and has_obligation(o.text):
            d.add(o.file, o.line, 'T014', 'warning')
    # obligations outside requirements
    for sp in rec.specs:
        if sp.text and has_obligation(sp.text):
            d.add(sp.file, sp.line, 'T004')
    for sc in rec.sections:
        if sc.text and has_obligation(sc.text):
            d.add(sc.file, sc.line, 'T004')
    for nt in rec.notes:
        if nt.text and has_obligation(nt.text):
            d.add(nt.file, nt.line, 'T004')
    for dc in rec.decisions:
        if dc.text and has_obligation(dc.text):
            d.add(dc.file, dc.line, 'T004')
        for alt in dc.rejected:
            if has_obligation([alt]):
                d.add(dc.file, dc.line, 'T004')
        if not dc.id in cited:
            d.add(dc.file, dc.line, 'T012', 'warning')
        if dc.source is None or dc.source == '':
            d.add(dc.file, dc.line, 'T013', 'warning')
        if dc.status is not None:
            st = dc.status
            w = split_word(st)[0]
            bad = w not in STATUS_WORDS
            if not bad and w == 'superseded':
                m = re.fullmatch('superseded by ([^' + WS_CHARS + ']+)', st)
                bad = not (m and m.group(1) in decls)
            if bad:
                d.add(dc.file, dc.line, 'T027')
    for o in rec.ops:
        if o.result is not None and has_obligation([o.result]):
            d.add(o.file, o.line, 'T004')
    for e in rec.errors:
        for en in e.entries:
            if has_obligation(en.cond):
                d.add(e.file, en.line, 'T004')

    # the oracle
    items = []
    for r in rec.reqs:
        for n, ex in enumerate(r.examples, 1):
            items.append(O(req=r, ex=ex, id='%s#%d' % (r.id, n)))
    responses = {}
    if not items:
        return items, responses, ops
    if not rec.oracles:
        d.add(spec.file, spec.line, 'T019')
        return items, responses, ops
    orc = rec.oracles[0]
    run = [it for it in items if it.ex.raw or has_error_expect(it.ex) or it.ex.op in ops]
    for it in run:
        it.line = build_line(it.ex, it.id, spec, ops.get(it.ex.op))
    words_ = split_command(orc.command)
    cwd = None
    tmp = None
    try:
        if words_:
            tmp = write_files(rec.files)
            cwd = os.path.join(tmp, *orc.file.split('/')[:-1])
        batch = [it for it in run if not is_solo(it.ex)]
        if batch:
            started = False
            if words_:
                started, ok, out = run_process(words_, cwd, [it.line for it in batch])
            if not started or not ok:
                d.add(orc.file, orc.line, 'T020')
            if started:
                for l in out:
                    resp = parse_response(l)
                    if resp is not None and isinstance(resp.get('id'), str) and resp['id'] not in responses:
                        responses[resp['id']] = resp
        for it in run:
            if not is_solo(it.ex):
                continue
            started = False
            if words_:
                started, ok, out = run_process(words_, cwd, [it.line])
            if not started or not ok:
                d.add(it.req.file, it.ex.line, 'T020')
            if started and len(out) == 1:
                resp = parse_response(out[0])
                if resp is not None:
                    responses[it.id] = resp
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)
    for it in run:
        ex = it.ex
        f = it.req.file
        resp = responses.get(it.id)
        it.resp = resp
        if resp is None:
            d.add(f, ex.line, 'T021')
            continue
        if 'oracle_error' in resp:
            d.add(f, ex.line, 'T022')
            it.oracle_error = True
            continue
        if not ex.expects and 'error' in resp:
            d.add(f, ex.line, 'T024', 'warning')
        for e in ex.expects:
            found, val = get_path(resp, e.path)
            if e.kind == 'oracle':
                if not found:
                    d.add(f, e.line, 'T025')
                else:
                    e.oracle_value = val
            elif e.kind == 'eq':
                if not (found and jeq(val, e.value)):
                    d.add(f, e.line, 'T002')
            else:
                if not (found and is_num(val) and abs(val - e.value) <= e.tol):
                    d.add(f, e.line, 'T002')
    return items, responses, ops


def analyze(files, entry):
    d = Diags()
    rec = read_record(files, entry, d)
    items = None
    ops = None
    if rec is not None and not d.has_p_error():
        items, _, ops = check_record(rec, d, entry)
    return d, rec, items, ops


def do_check(files, entry):
    d, _, _, _ = analyze(files, entry)
    return {'diagnostics': d.lines(), 'errors': d.count('error'), 'warnings': d.count('warning')}


def do_cases(files, entry):
    d, rec, items, ops = analyze(files, entry)
    nerr = d.count('error')
    if nerr:
        return {'errors': nerr, 'cases': []}
    spec = rec.specs[0] if rec else None
    cases = []
    for it in items:
        ex = it.ex
        op = ops.get(ex.op) if ex.op else None
        resp = getattr(it, 'resp', None)
        checks = []
        for e in ex.expects:
            if e.kind == 'eq':
                checks.append({'path': e.path, 'kind': 'eq', 'value': e.value})
            elif e.kind == 'approx':
                checks.append({'path': e.path, 'kind': 'approx', 'value': e.value, 'tol': e.tol})
            else:
                checks.append({'path': e.path, 'kind': 'eq', 'value': e.oracle_value, 'from': 'oracle'})
        full = {'members': sorted(resp.keys(), key=utf16key) if resp else []}
        if resp:
            if 'error' in resp:
                full['error'] = resp['error']
            if 'result' in resp:
                full['result'] = resp['result']
            if op is not None and op.audit and 'audit' in resp:
                full['audit'] = resp['audit']
        full['tolerances'] = dict(op.tolerances) if op is not None else {}
        case = {'id': it.id, 'kind': 'example', 'reqs': ['REQ-' + it.req.id],
                'platform': it.req.platform, 'line': it.line, 'checks': checks, 'full': full}
        if is_solo(ex):
            case['solo'] = True
        cases.append(case)
    return {'errors': 0, 'cases': cases}
