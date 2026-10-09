"""Checking a record: the T codes, the oracle, the suite and the judge."""
import math
import os
import re
import shutil
import subprocess
import tempfile

from jsonx import (parse as jparse, JsonError, jeq, is_num, js_str, js_key_order,
                   stringify, u16key)
from reader import (Ctx, read_file, WS, _W, words)

ORACLE_TIMEOUT = 60.0
MISSING = object()
_INDEX = re.compile(r'^(0|[1-9][0-9]*)$')


# ------------------------------------------------------------------ requests

def valid_name(n):
    if not isinstance(n, str) or n == '':
        return False
    if '\\' in n or '\x00' in n:
        return False
    if len(n) >= 2 and n[1] == ':' and n[0].isascii() and n[0].isalpha():
        return False
    return all(p not in ('', '.', '..') for p in n.split('/'))


def validate_files(files, entry, has_entry):
    """True when the request is acceptable."""
    if not isinstance(files, dict) or not files:
        return False
    for k, v in files.items():
        if not isinstance(v, str) or not valid_name(k):
            return False
    names = set(files)
    for k in names:
        parts = k.split('/')
        for i in range(1, len(parts)):
            if '/'.join(parts[:i]) in names:
                return False
    if has_entry:
        if not isinstance(entry, str):
            return False
        if entry != '.' and not valid_name(entry):
            return False
    return True


# ------------------------------------------------------------------ record

def resolve_record(files, entry):
    """Returns (label, folder, names) or (label, None, None) when missing."""
    if entry is None or entry == '.':
        label, folder = '.', ''
        names = []
        for n in files:
            parts = n.split('/')
            if not n.endswith('.duramen'):
                continue
            if any(p.startswith('.') for p in parts):
                continue
            if any(p in ('build', 'node_modules') for p in parts[:-1]):
                continue
            names.append((n, n))
    elif entry in files:
        return entry, entry.rsplit('/', 1)[0] if '/' in entry else '', [entry]
    else:
        prefix = entry + '/'
        label, folder = entry, entry
        names = []
        for n in files:
            if not n.startswith(prefix):
                continue
            rel = n[len(prefix):]
            parts = rel.split('/')
            if not rel.endswith('.duramen'):
                continue
            if any(p.startswith('.') for p in parts):
                continue
            if any(p in ('build', 'node_modules') for p in parts[:-1]):
                continue
            names.append((rel, n))
    if not names:
        return label, None, None
    names.sort(key=lambda t: u16key(t[0]))
    return label, folder, [n for _, n in names]


_LEVEL = {'error': 0, 'warning': 1, 'info': 2}


def sort_diags(diags):
    return sorted(diags, key=lambda d: (u16key(d[0]), d[1], u16key(d[2]), _LEVEL[d[3]]))


def fmt_diag(d):
    return '%s:%d: %s %s' % (d[0], d[1], d[3], d[2])


# ------------------------------------------------------------------ oracle

def split_command(s):
    """Words of an oracle command, or None when a quote is not closed."""
    out = []
    cur = None
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c in ' \t':
            if cur is not None:
                out.append(cur)
                cur = None
            i += 1
        elif c == '"':
            cur = cur or ''
            i += 1
            while True:
                if i >= n:
                    return None
                if s[i] == '\\' and i + 1 < n and s[i + 1] == '"':
                    cur += '"'
                    i += 2
                elif s[i] == '"':
                    i += 1
                    break
                else:
                    cur += s[i]
                    i += 1
        elif c == "'":
            cur = cur or ''
            j = s.find("'", i + 1)
            if j == -1:
                return None
            cur += s[i + 1:j]
            i = j + 1
        else:
            cur = (cur or '') + c
            i += 1
    if cur is not None:
        out.append(cur)
    return out


def run_oracle(argv, cwd, lines):
    """Returns (stdout text, ok)."""
    data = ''.join(l + '\n' for l in lines).encode('utf-8', 'surrogatepass')
    if not argv:
        return '', False
    try:
        p = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL)
    except (OSError, ValueError):
        return '', False
    try:
        out, _ = p.communicate(data, timeout=ORACLE_TIMEOUT)
    except subprocess.TimeoutExpired:
        p.kill()
        out, _ = p.communicate()
        return out.decode('utf-8', 'replace'), False
    except OSError:
        p.kill()
        out, _ = p.communicate()
        return out.decode('utf-8', 'replace'), False
    return out.decode('utf-8', 'replace'), p.returncode == 0


BAD = object()


def output_lines(out):
    res = []
    for ln in out.split('\n'):
        if ln.strip(WS) == '':
            continue
        try:
            v = jparse(ln)
        except JsonError:
            v = BAD
        res.append(v)
    return res


def write_files(files, root):
    for name, text in files.items():
        path = os.path.join(root, *name.split('/'))
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as f:
                f.write(text.encode('utf-8', 'surrogatepass'))
        except (OSError, ValueError):
            pass


# ------------------------------------------------------------------ paths

def step(cur, seg):
    if isinstance(cur, dict):
        return cur[seg] if seg in cur else MISSING
    if isinstance(cur, list):
        if _INDEX.match(seg):
            i = int(seg)
            if i < len(cur):
                return cur[i]
    return MISSING


def resolve(resp, path):
    segs = path.split('.')
    cur = resp
    if segs[0] == 'audit' and len(segs) > 1:
        a = step(resp, 'audit')
        if not isinstance(a, str):
            return MISSING
        try:
            cur = jparse(a)
        except JsonError:
            return MISSING
        segs = segs[1:]
    for seg in segs:
        cur = step(cur, seg)
        if cur is MISSING:
            return MISSING
    return cur


# ------------------------------------------------------------------ checks

_OBLIG = re.compile(r'(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])')
_QUOTES = {'"': '"', '“': '”', '`': '`'}


def strip_quotes(line):
    out = []
    i = 0
    n = len(line)
    while i < n:
        c = line[i]
        if c in _QUOTES:
            j = line.find(_QUOTES[c], i + 1)
            if j != -1:
                out.append(' ')
                i = j + 1
                continue
        out.append(c)
        i += 1
    return ''.join(out)


def has_obligation(lines):
    return any(_OBLIG.search(strip_quotes(l)) for l in lines)


_PHRASES = ['in this order', 'in the order', 'first that applies', 'first match', 'precede',
            'precedes', 'preceded', 'before', 'after', 'take precedence', 'takes precedence']
_SEP = '[' + _W + ']+'
_PHRASE_RE = [re.compile('(?<![A-Za-z0-9_])' + _SEP.join(re.escape(w) for w in p.split(' ')) +
                         '(?![A-Za-z0-9_])', re.I | re.A) for p in _PHRASES]
_STATUS_WORDS = ('observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded',
                 'rejected')


def analyze(files, entry):
    """Returns (diagnostics, cases or None)."""
    label, folder, names = resolve_record(files, entry)
    if names is None:
        return [(label, 1, 'P046', 'error')], None
    ctx = Ctx(files, folder)
    for n in names:
        read_file(ctx, n, files[n])
    if ctx.spec is None:
        ctx.d(label, 1, 'P021')
    versions = {fi.version for fi in ctx.fileinfos if fi.version}
    if len(versions) > 1:
        ctx.d(label, 1, 'P047')
    if ctx.diags:
        return sort_diags(ctx.diags), None
    cases = check_record(ctx)
    diags = sort_diags(ctx.diags)
    if any(d[3] == 'error' for d in diags):
        cases = None
    return diags, cases


def has_error_expect(ex):
    return any(e.path == 'error' for e in ex.expects)


def build_line(ctx, ex, case_id, ops):
    if ex.raw:
        return ex.raw_line
    op = ops.get(ex.op)
    base = op.request if (op is not None and op.request is not None) else (ctx.spec.request or {})
    members = dict(base)
    members.update(ex.request)
    omit = set(ex.omit)
    parts = []
    if 'id' not in omit:
        parts.append('"id":' + js_str(case_id))
    if 'op' not in omit:
        parts.append('"op":' + js_str(ex.op))
    for k in js_key_order(members):
        if k not in omit:
            parts.append(js_str(k) + ':' + stringify(members[k]))
    text = None
    if ex.table_row:
        text = '{' + ','.join(js_str(f) + ':' + c for f, c in ex.cells) + '}'
    elif ex.input_lines:
        text = stringify(ex.input_obj)
    elif ex.input_text is not None:
        text = ex.input_text
    if text is not None and 'input' not in omit:
        parts.append('"input":' + text)
    return '{' + ','.join(parts) + '}'


class Run:
    def __init__(self, req, ex, case_id, line, solo):
        self.req, self.ex, self.case_id, self.line, self.solo = req, ex, case_id, line, solo
        self.resp = None


def check_record(ctx):
    d = ctx.d
    ops = {}
    for op in ctx.ops:
        ops.setdefault(op.name, op)
    declared = []
    if ctx.errors is not None:
        declared = [c for c, _, _ in ctx.errors.items]
    declared_set = set(declared)

    # T001, T003
    for req in ctx.reqs:
        if not req.items and not req.static:
            d(req.file, req.line, 'T001')
    for o in ctx.opens:
        for ln in o.test_lines:
            d(o.file, ln, 'T003')

    # T004, T014
    if ctx.spec is not None and ctx.spec.text is not None:
        if has_obligation(ctx.spec.text.split('\n')):
            d(ctx.spec.file, ctx.spec.line, 'T004')
    for s in ctx.sections + ctx.notes:
        if s.text is not None and has_obligation(s.text.split('\n')):
            d(s.file, s.line, 'T004')
    for dec in ctx.decisions:
        if dec.text is not None and has_obligation(dec.text.split('\n')):
            d(dec.file, dec.line, 'T004')
        for r in dec.rejected:
            if has_obligation(r.split('\n')):
                d(dec.file, dec.line, 'T004')
    for op in ctx.ops:
        if op.result is not None and has_obligation([op.result]):
            d(op.file, op.line, 'T004')
    if ctx.errors is not None:
        for code, line, conds in ctx.errors.items:
            if has_obligation(conds):
                d(ctx.errors.file, line, 'T004')
    for o in ctx.opens:
        if o.text is not None and has_obligation(o.text.split('\n')):
            d(o.file, o.line, 'T014', 'warning')

    # T005
    if len(declared_set) >= 2:
        code_res = [(c, re.compile('(?<![A-Za-z0-9_-])' + re.escape(c) + '(?![A-Za-z0-9_-])'))
                    for c in declared_set]
        for req in ctx.reqs:
            if req.text is None:
                continue
            named = sum(1 for c, r in code_res if r.search(req.text))
            if named >= 2 and any(p.search(req.text) for p in _PHRASE_RE):
                d(req.file, req.text_line, 'T005')

    # T007
    seen = set()
    for r in ctx.reqs:
        if r.id in seen:
            d(r.file, r.line, 'T007')
        seen.add(r.id)
    seen = set()
    for o in ctx.opens:
        if o.id in seen:
            d(o.file, o.line, 'T007')
        seen.add(o.id)
    seen = set()
    for x in ctx.decisions:
        if x.id in seen:
            d(x.file, x.line, 'T007')
        seen.add(x.id)
    seen = set()
    for o in ctx.ops:
        if o.name in seen:
            d(o.file, o.line, 'T007')
        seen.add(o.name)

    # decisions: T008, T012, T013, T027, T028
    dec_by_id = {}
    for x in ctx.decisions:
        dec_by_id.setdefault(x.id, []).append(x)
    cited = set()
    for req in ctx.reqs:
        done = set()
        for did in req.decisions:
            if did in done:
                continue
            done.add(did)
            cited.add(did)
            if did not in dec_by_id:
                d(req.file, req.line, 'T008')
                continue
            st = dec_by_id[did][0].status
            sw = words(st) if st is not None else []
            word = sw[0] if sw else 'accepted'
            if word in ('contested', 'superseded', 'rejected'):
                d(req.file, req.line, 'T028')
            elif word in ('observed', 'inferred', 'proposed'):
                d(req.file, req.line, 'T028', 'warning')
    for x in ctx.decisions:
        if x.id not in cited:
            d(x.file, x.line, 'T012', 'warning')
        if not x.source:
            d(x.file, x.line, 'T013', 'warning')
        if x.status is not None:
            st = x.status
            ws = words(st)
            ok = bool(ws) and ws[0] in _STATUS_WORDS
            if ok and ws[0] == 'superseded':
                m = re.fullmatch('superseded by ([^' + _W + ']+)', st)
                ok = bool(m) and m.group(1) in dec_by_id
            if not ok:
                d(x.file, x.line, 'T027')

    # examples: T009-T011, T023
    any_example = False
    for req in ctx.reqs:
        for ex in req.items:
            any_example = True
            for e in ex.expects:
                if e.path == 'error' and e.kind != 'oracle':
                    if e.kind == 'approx' or not (isinstance(e.value, str) and e.value in declared_set):
                        d(req.file, e.line, 'T023')
            if ex.raw or has_error_expect(ex):
                continue
            op = ops.get(ex.op)
            if op is None:
                d(req.file, ex.line, 'T009')
                continue
            if ex.table_row:
                keys = [f for f, _ in ex.cells]
            elif ex.input_obj is not None:
                keys = list(ex.input_obj)
            else:
                keys = []
            for f, optional in op.fields.items():
                if not optional and f not in keys:
                    d(req.file, ex.line, 'T010')
            for k in keys:
                if k not in op.fields:
                    d(req.file, ex.line, 'T011', 'warning')

    # T019 and the oracle
    runs = []
    for req in ctx.reqs:
        for n, ex in enumerate(req.items, 1):
            cid = '%s#%d' % (req.id, n)
            if not (ex.raw or has_error_expect(ex) or ex.op in ops):
                continue
            line = build_line(ctx, ex, cid, ops)
            solo = ex.raw or 'id' in ex.omit
            runs.append(Run(req, ex, cid, line, solo))
    if any_example and ctx.oracle is None:
        d(ctx.spec.file, ctx.spec.line, 'T019')
    elif ctx.oracle is not None and runs:
        run_all(ctx, runs)
        evaluate(ctx, runs)
    return build_cases(ctx, ops, runs)


def run_all(ctx, runs):
    orc = ctx.oracle
    argv = split_command(orc.command)
    tmp = tempfile.mkdtemp(prefix='duramen-')
    try:
        write_files(ctx.files, tmp)
        cwd = os.path.join(tmp, *orc.file.split('/')[:-1])
        batch = [r for r in runs if not r.solo]
        if batch:
            if argv is None:
                out, ok = '', False
            else:
                out, ok = run_oracle(argv, cwd, [r.line for r in batch])
            if not ok:
                ctx.d(orc.file, orc.line, 'T020')
            byid = {}
            for v in output_lines(out):
                if isinstance(v, dict) and isinstance(v.get('id'), str) and v['id'] not in byid:
                    byid[v['id']] = v
            for r in batch:
                r.resp = byid.get(r.case_id)
        for r in runs:
            if not r.solo:
                continue
            if argv is None:
                out, ok = '', False
            else:
                out, ok = run_oracle(argv, cwd, [r.line])
            if not ok:
                ctx.d(r.req.file, r.ex.line, 'T020')
            lines = output_lines(out)
            if len(lines) == 1 and isinstance(lines[0], dict):
                r.resp = lines[0]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def evaluate(ctx, runs):
    for r in runs:
        f = r.req.file
        ex = r.ex
        resp = r.resp
        if resp is None:
            ctx.d(f, ex.line, 'T021')
            continue
        if 'oracle_error' in resp:
            ctx.d(f, ex.line, 'T022')
            continue
        if 'error' in resp and not has_error_expect(ex):
            ctx.d(f, ex.line, 'T024', 'warning')
        for e in ex.expects:
            v = resolve(resp, e.path)
            if e.kind == 'oracle':
                if v is MISSING:
                    ctx.d(f, e.line, 'T025')
                else:
                    e.value = v
                continue
            if v is MISSING:
                ctx.d(f, e.line, 'T002')
            elif e.kind == 'eq':
                if not jeq(v, e.value):
                    ctx.d(f, e.line, 'T002')
            else:
                if not (is_num(v) and abs(float(v) - e.value) <= e.tol):
                    ctx.d(f, e.line, 'T002')


def build_cases(ctx, ops, runs):
    if any(d[3] == 'error' for d in ctx.diags):
        return None
    cases = []
    byex = {id(r.ex): r for r in runs}
    for req in ctx.reqs:
        for n, ex in enumerate(req.items, 1):
            r = byex.get(id(ex))
            if r is None or r.resp is None:
                return None
            checks = []
            for e in ex.expects:
                if e.kind == 'eq':
                    checks.append({'path': e.path, 'kind': 'eq', 'value': e.value})
                elif e.kind == 'approx':
                    checks.append({'path': e.path, 'kind': 'approx', 'value': e.value,
                                   'tol': e.tol})
                else:
                    checks.append({'path': e.path, 'kind': 'eq', 'value': e.value,
                                   'from': 'oracle'})
            resp = r.resp
            op = None if ex.raw else ops.get(ex.op)
            full = {'members': sorted(resp.keys(), key=u16key)}
            if 'error' in resp:
                full['error'] = resp['error']
            if 'result' in resp:
                full['result'] = resp['result']
            if op is not None and op.audit and 'audit' in resp:
                full['audit'] = resp['audit']
            full['tolerances'] = dict(op.tolerances) if op is not None else {}
            case = {'id': r.case_id, 'kind': 'example', 'reqs': ['REQ-' + req.id],
                    'platform': req.platform, 'line': r.line, 'checks': checks, 'full': full}
            if r.solo:
                case['solo'] = True
            cases.append(case)
    return cases


# ------------------------------------------------------------------ judge

def _num(v):
    return is_num(v)


def valid_judge(case, answer):
    if not isinstance(case, dict):
        return False
    checks = case.get('checks')
    if not isinstance(checks, list):
        return False
    for c in checks:
        if not isinstance(c, dict) or not isinstance(c.get('path'), str):
            return False
        kind = c.get('kind')
        if not isinstance(kind, str):
            return False
        if kind == 'eq':
            if 'value' not in c:
                return False
        elif kind == 'approx':
            if not _num(c.get('value')) or not _num(c.get('tol')) or c['tol'] < 0:
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
        t = full.get('tolerances')
        if not isinstance(t, dict) or not all(_num(x) and x >= 0 for x in t.values()):
            return False
        if 'audit' in full and not isinstance(full['audit'], str):
            return False
    return answer is None or isinstance(answer, dict)


def eq_tol(exp, act, path, tols):
    if path in tols and is_num(exp) and is_num(act):
        return abs(float(act) - float(exp)) <= tols[path]
    if isinstance(exp, dict) and isinstance(act, dict):
        return exp.keys() == act.keys() and all(
            eq_tol(exp[k], act[k], path + '.' + k, tols) for k in exp)
    if isinstance(exp, list) and isinstance(act, list):
        return len(exp) == len(act) and all(
            eq_tol(x, y, path + '.' + str(i), tols) for i, (x, y) in enumerate(zip(exp, act)))
    return jeq(exp, act)


def judge(case, answer):
    if answer is None:
        return {'pass': False, 'failed': ['answer']}
    failed = []
    for i, c in enumerate(case['checks']):
        v = resolve(answer, c['path'])
        if v is MISSING:
            ok = False
        elif c['kind'] == 'eq':
            ok = jeq(v, c['value'])
        elif c['kind'] == 'approx':
            ok = is_num(v) and abs(float(v) - float(c['value'])) <= c['tol']
        else:
            ok = False
        if not ok:
            failed.append('checks.%d' % i)
    full = case['full']
    if full is not None:
        if sorted(answer.keys(), key=u16key) != full['members']:
            failed.append('members')
        if 'error' in full:
            if 'error' not in answer or not jeq(answer['error'], full['error']):
                failed.append('error')
        else:
            if 'result' in full:
                if 'result' not in answer or not eq_tol(full['result'], answer['result'],
                                                        'result', full['tolerances']):
                    failed.append('result')
            if 'audit' in full:
                if 'audit' not in answer or answer['audit'] != full['audit']:
                    failed.append('audit')
    if failed:
        return {'pass': False, 'failed': failed}
    return {'pass': True}
