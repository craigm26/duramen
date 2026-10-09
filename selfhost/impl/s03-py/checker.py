"""Checking a record (T diagnostics), the oracle, and the suite."""
import os
import re
import subprocess
import tempfile

from jsutil import (WS, is_num, jdump, jeq, jparse, u16)
from reader import Reader

ORACLE_TIMEOUT = 20
LEVEL_RANK = {'error': 0, 'warning': 1, 'info': 2}
QUOTED = re.compile('"[^"]*"|“[^”]*”|`[^`]*`')
OBLIGATION = re.compile(r'(?<!\w)(?:MUST|SHALL|REQUIRED)(?!\w)')
ORDER_PHRASES = ["in this order", "in the order", "first that applies", "first match",
                 "precede", "precedes", "preceded", "before", "after", "take precedence",
                 "takes precedence"]
ORDER_RE = re.compile('(?<!\\w)(?:' + '|'.join(
    r'\s+'.join(re.escape(w) for w in p.split(' ')) for p in ORDER_PHRASES) + ')(?!\\w)',
    re.I)
STATUSES = ('observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded',
            'rejected')


def status_word(status):
    w = re.split(WS, status.strip())[0] if status.strip() else ''
    return w


def has_obligation(text):
    for line in (text or '').split('\n'):
        if OBLIGATION.search(QUOTED.sub(' ', line)):
            return True
    return False


def is_valid_name(n):
    if not isinstance(n, str) or n == '' or '\\' in n or '\x00' in n:
        return False
    if re.match(r'[A-Za-z]:', n):
        return False
    return all(p not in ('', '.', '..') for p in n.split('/'))


def split_command(cmd):
    out, cur, i, n = [], None, 0, len(cmd)
    while i < n:
        c = cmd[i]
        if c in ' \t':
            if cur is not None:
                out.append(cur)
                cur = None
            i += 1
        elif c in '"\'':
            cur = cur or ''
            i += 1
            while True:
                if i >= n:
                    return None
                ch = cmd[i]
                if c == '"' and ch == '\\' and i + 1 < n and cmd[i + 1] == '"':
                    cur += '"'
                    i += 2
                elif ch == c:
                    i += 1
                    break
                else:
                    cur += ch
                    i += 1
        else:
            cur = (cur or '') + c
            i += 1
    if cur is not None:
        out.append(cur)
    return out


def lookup(resp, path):
    names = path.split('.')
    cur = resp
    if names[0] == 'audit' and len(names) > 1:
        a = resp.get('audit')
        if not isinstance(a, str):
            return False, None
        ok, cur = jparse(a)
        if not ok:
            return False, None
        names = names[1:]
    for nm in names:
        if isinstance(cur, dict):
            if nm not in cur:
                return False, None
            cur = cur[nm]
        elif isinstance(cur, list):
            if not re.fullmatch(r'0|[1-9][0-9]*', nm) or int(nm) >= len(cur):
                return False, None
            cur = cur[int(nm)]
        else:
            return False, None
    return True, cur


def expects_error(ex):
    return any(e.path == 'error' for e in ex.exps)


class Analysis:
    pass


def resolve(files, entry):
    """-> (name, folder_parts, [file names in order]) or (name, None, None) when missing."""
    if entry in (None, '.'):
        name, prefix, folder = '.', '', []
    elif entry in files:
        return entry, entry.split('/')[:-1], [entry]
    else:
        name, prefix, folder = entry, entry + '/', entry.split('/')
        if not any(n.startswith(prefix) for n in files):
            return name, None, None
    sel = []
    for n in files:
        if not n.startswith(prefix):
            continue
        rel = n[len(prefix):]
        parts = rel.split('/')
        if not rel.endswith('.duramen') or any(p.startswith('.') for p in parts):
            continue
        if any(p in ('build', 'node_modules') for p in parts[:-1]):
            continue
        sel.append((rel, n))
    sel.sort(key=lambda t: u16(t[0]))
    if not sel:
        return name, None, None
    return name, folder, [n for _, n in sel]


def finalize(diags):
    diags = sorted(diags, key=lambda d: (u16(d[0]), d[1], u16(d[3]), LEVEL_RANK[d[2]]))
    strings = ['%s:%d: %s %s' % (f, l, lv, c) for (f, l, lv, c) in diags]
    return (strings, sum(1 for d in diags if d[2] == 'error'),
            sum(1 for d in diags if d[2] == 'warning'))


def analyze(files, entry):
    a = Analysis()
    a.rec = None
    name, folder, names = resolve(files, entry)
    if folder is None:
        a.diags = [(name, 1, 'error', 'P046')]
        return a
    rd = Reader(name, folder, files)
    for n in names:
        rd.read_file(n, files[n])
    diags = rd.diags
    if rd.spec is None:
        diags.append((name, 1, 'error', 'P021'))
    if len(set(rd.versions.values())) > 1:
        diags.append((name, 1, 'error', 'P047'))
    a.diags = diags
    if any(d[2] == 'error' for d in diags):
        return a
    a.rec = rd
    check(rd, files, diags)
    return a


def check(rd, files, diags):
    def add(f, line, code, level='error'):
        diags.append((f, line, level, code))

    ops, decisions, codes = {}, {}, set()
    if rd.errors:
        codes = {c for (c, _, _) in rd.errors.codes}
    seen_req, seen_open = set(), set()
    cited = set()
    for kind, o in rd.items:
        if kind == 'op':
            if o.name in ops:
                add(o.file, o.line, 'T007')
            else:
                ops[o.name] = o
        elif kind == 'decision':
            if o.id in decisions:
                add(o.file, o.line, 'T007')
            else:
                decisions[o.id] = o
        elif kind == 'req':
            if o.id in seen_req:
                add(o.file, o.line, 'T007')
            seen_req.add(o.id)
        elif kind == 'open':
            if o.id in seen_open:
                add(o.file, o.line, 'T007')
            seen_open.add(o.id)
    rd.ops, rd.decisions_by_id = ops, decisions

    # obligations outside requirements
    for kind, o in rd.items:
        if kind in ('spec', 'section', 'note') and has_obligation(o.text):
            add(o.file, o.line, 'T004')
        elif kind == 'decision':
            if has_obligation(o.text):
                add(o.file, o.line, 'T004')
            for alt in o.rejected:
                if has_obligation(alt):
                    add(o.file, o.line, 'T004')
        elif kind == 'op' and has_obligation(o.result):
            add(o.file, o.line, 'T004')
        elif kind == 'errors':
            for (code, ln, cond) in o.codes:
                if has_obligation(cond):
                    add(o.file, ln, 'T004')
        elif kind == 'open':
            if has_obligation(o.text):
                add(o.file, o.line, 'T014', 'warning')
            for ln in o.exlines:
                add(o.file, ln, 'T003')

    for req in rd.reqs:
        f = req.file
        if not req.examples:
            add(f, req.line, 'T001')
        done = set()
        for d in req.decisions:
            if d in done:
                continue
            done.add(d)
            cited.add(d)
            dec = decisions.get(d)
            if dec is None:
                add(f, req.line, 'T008')
                continue
            w = 'accepted' if dec.status is None else status_word(dec.status)
            if w in ('contested', 'superseded', 'rejected'):
                add(f, req.line, 'T028')
            elif w in ('observed', 'inferred', 'proposed'):
                add(f, req.line, 'T028', 'warning')
        for ex in req.examples:
            if ex.raw is not None or expects_error(ex):
                pass
            else:
                op = ops.get(ex.op)
                if op is None:
                    add(f, ex.line, 'T009')
                else:
                    have = set(ex.input_obj) if ex.has_input else set()
                    for fld, optional in op.fields.items():
                        if not optional and fld not in have:
                            add(f, ex.line, 'T010')
                    for k in have:
                        if k not in op.fields:
                            add(f, ex.line, 'T011', 'warning')
            for e in ex.exps:
                if e.path == 'error' and e.kind != 'oracle':
                    if not (isinstance(e.value, str) and e.value in codes):
                        add(f, e.line, 'T023')
        if req.text is not None and len(codes) >= 2:
            hit = [c for c in codes
                   if re.search(r'(?<![\w-])' + re.escape(c) + r'(?![\w-])', req.text)]
            if len(hit) >= 2 and ORDER_RE.search(req.text):
                add(f, req.text_line, 'T005')

    for did, dec in ((o.id, o) for k, o in rd.items if k == 'decision'):
        f = dec.file
        if did not in cited:
            add(f, dec.line, 'T012', 'warning')
        if dec.source is None or dec.source == '':
            add(f, dec.line, 'T013', 'warning')
        if dec.status is not None:
            w = status_word(dec.status)
            bad = w not in STATUSES
            if not bad and w == 'superseded':
                m = re.fullmatch(r'superseded by (\S+)', dec.status.strip())
                bad = not m or m.group(1) not in decisions
            if bad:
                add(f, dec.line, 'T027')

    examples = [ex for req in rd.reqs for ex in req.examples]
    if examples and rd.oracle is None:
        add(rd.spec.file, rd.spec.line, 'T019')
        return
    if not examples:
        return
    run_oracle(rd, files, examples, ops, add)


def build_line(rd, ex, op):
    if ex.raw is not None:
        return ex.raw
    base = op.request if op is not None and op.request is not None else (rd.spec.request or {})
    members = dict(base)
    members.update(ex.request or {})
    for n in ex.omit:
        members.pop(n, None)
    parts = []
    if 'id' not in ex.omit:
        parts.append('"id":' + jdump(ex.cid))
    if 'op' not in ex.omit:
        parts.append('"op":' + jdump(ex.op))
    if members:
        parts.append(jdump(members)[1:-1])
    if ex.has_input and 'input' not in ex.omit:
        parts.append('"input":' + ex.input_text)
    return '{' + ','.join(parts) + '}'


def run_proc(argv, cwd, payload):
    if argv is None or not argv:
        return b'', False
    try:
        p = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL)
    except Exception:
        return b'', False
    try:
        out, _ = p.communicate(payload, timeout=ORACLE_TIMEOUT)
    except subprocess.TimeoutExpired:
        p.kill()
        out, _ = p.communicate()
        return out, False
    except Exception:
        p.kill()
        out, _ = p.communicate()
        return out, False
    return out, p.returncode == 0


def run_oracle(rd, files, examples, ops, add):
    runnable = []
    for ex in examples:
        op = ops.get(ex.op) if ex.raw is None else None
        ex.rline = build_line(rd, ex, op)
        ex.solo = ex.raw is not None or 'id' in ex.omit
        if ex.raw is not None or expects_error(ex) or op is not None:
            runnable.append(ex)
    if not runnable:
        return
    argv = split_command(rd.oracle.command)
    with tempfile.TemporaryDirectory() as tmp:
        for n, text in files.items():
            path = os.path.join(tmp, *n.split('/'))
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, 'wb') as fh:
                    fh.write(text.encode('utf-8', 'surrogatepass'))
            except Exception:
                pass
        cwd = os.path.join(tmp, *rd.oracle.file.split('/')[:-1])
        batch = [e for e in runnable if not e.solo]
        if batch:
            payload = ''.join(e.rline + '\n' for e in batch).encode('utf-8', 'replace')
            out, ok = run_proc(argv, cwd, payload)
            if not ok:
                add(rd.oracle.file, rd.oracle.line, 'T020')
            byid = {}
            for ln in out.decode('utf-8', 'replace').split('\n'):
                g, v = jparse(ln)
                if g and isinstance(v, dict) and isinstance(v.get('id'), str) and v['id'] not in byid:
                    byid[v['id']] = v
            for e in batch:
                e.resp = byid.get(e.cid)
        for e in runnable:
            if not e.solo:
                continue
            out, ok = run_proc(argv, cwd, (e.rline + '\n').encode('utf-8', 'replace'))
            if not ok:
                add(e.file, e.line, 'T020')
            lines = [l for l in out.decode('utf-8', 'replace').split('\n')
                     if l.strip(' \t\r') != '']
            if len(lines) == 1:
                g, v = jparse(lines[0])
                if g and isinstance(v, dict):
                    e.resp = v
    for e in runnable:
        r = e.resp
        if r is None:
            add(e.file, e.line, 'T021')
            continue
        if 'oracle_error' in r:
            add(e.file, e.line, 'T022')
            continue
        if not e.exps and 'error' in r:
            add(e.file, e.line, 'T024', 'warning')
        for x in e.exps:
            found, val = lookup(r, x.path)
            if x.kind == 'oracle':
                if not found:
                    add(e.file, x.line, 'T025')
            elif x.kind == 'eq':
                if not (found and jeq(val, x.value)):
                    add(e.file, x.line, 'T002')
            else:
                if not (found and is_num(val) and abs(val - x.value) <= x.tol):
                    add(e.file, x.line, 'T002')


def make_cases(rd):
    cases = []
    for req in rd.reqs:
        for ex in req.examples:
            op = rd.ops.get(ex.op) if ex.raw is None else None
            checks = []
            for x in ex.exps:
                if x.kind == 'eq':
                    checks.append({'path': x.path, 'kind': 'eq', 'value': x.value})
                elif x.kind == 'approx':
                    checks.append({'path': x.path, 'kind': 'approx', 'value': x.value,
                                   'tol': x.tol})
                else:
                    found, val = lookup(ex.resp, x.path)
                    checks.append({'path': x.path, 'kind': 'eq', 'value': val,
                                   'from': 'oracle'})
            r = ex.resp or {}
            full = {'members': sorted(r, key=u16)}
            if 'error' in r:
                full['error'] = r['error']
            if 'result' in r:
                full['result'] = r['result']
            if op is not None and op.audit and 'audit' in r:
                full['audit'] = r['audit']
            full['tolerances'] = dict(op.tolerances) if op is not None else {}
            case = {'id': ex.cid, 'kind': 'example', 'reqs': ['REQ-' + req.id],
                    'platform': req.on, 'line': ex.rline, 'checks': checks, 'full': full}
            if ex.solo:
                case['solo'] = True
            cases.append(case)
    return cases


def do_check(files, entry):
    a = analyze(files, entry)
    strings, errors, warnings = finalize(a.diags)
    return {'diagnostics': strings, 'errors': errors, 'warnings': warnings}


def do_cases(files, entry):
    a = analyze(files, entry)
    strings, errors, warnings = finalize(a.diags)
    if errors != 0 or a.rec is None:
        return {'errors': errors, 'cases': []}
    return {'errors': errors, 'cases': make_cases(a.rec)}
