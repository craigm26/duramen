"""Checking a record: records, T diagnostics, the oracle, and the suite."""
import os
import re
import subprocess
import tempfile

from jsutil import (WS_SET, parse_json, is_num, jeq, js_str, js_stringify, js_keys, u16)
from reader import Ctx, Rec, read_file

LEVEL_RANK = {'error': 0, 'warning': 1, 'info': 2}
ORACLE_TIMEOUT = 20


# ---------------------------------------------------------------- the record's files

def collect(files, entry):
    """(names in order, record folder, record name) or (None, None, name) when it is missing."""
    if entry is None or entry == '.':
        names = [n for n in files if folder_member(n, '')]
        folder, name = '', '.'
        return sorted(names, key=u16), folder, name
    if entry in files:
        return [entry], entry.rsplit('/', 1)[0] if '/' in entry else '', entry
    prefix = entry + '/'
    names = [n for n in files if n.startswith(prefix) and folder_member(n[len(prefix):], '')]
    if any(n.startswith(prefix) for n in files):
        return sorted(names, key=u16), entry, entry
    return [], None, entry


def folder_member(rel, _):
    parts = rel.split('/')
    if not parts[-1].endswith('.duramen'):
        return False
    for p in parts[:-1]:
        if p.startswith('.') or p in ('build', 'node_modules'):
            return False
    return not parts[-1].startswith('.')


def full_names(files, entry, names):
    return names


# ---------------------------------------------------------------- helpers for the checks

_OBLIG = re.compile(r'(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])')
_QUOTES = re.compile(r'"[^"]*"|“[^”]*”|`[^`]*`')


def has_obligation(text):
    if text is None:
        return False
    for line in text.split('\n'):
        if _OBLIG.search(_QUOTES.sub(' ', line)):
            return True
    return False


_PHRASES = ['in this order', 'in the order', 'first that applies', 'first match', 'precede',
            'precedes', 'preceded', 'before', 'after', 'take precedence', 'takes precedence']
_WSC = '[\t\n\x0b\x0c\r    -     　﻿]+'
_PHRASE_RE = re.compile('|'.join(
    r'(?<![A-Za-z0-9_])' + _WSC.join(re.escape(w) for w in p.split(' ')) + r'(?![A-Za-z0-9_])'
    for p in _PHRASES), re.I | re.A)


def names_two_codes(text, codes):
    found = set()
    for c in codes:
        if re.search(r'(?<![A-Za-z0-9_-])' + re.escape(c) + r'(?![A-Za-z0-9_-])', text):
            found.add(c)
    return len(found) >= 2


STATES = ('observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected')


def value_at(resp, path):
    names = path.split('.')
    cur = resp
    if names[0] == 'audit' and len(names) > 1:
        a = resp.get('audit')
        if not isinstance(a, str):
            return False, None
        st, v = parse_json(a)
        if st != 'ok':
            return False, None
        cur = v
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


def split_command(cmd):
    words = []
    cur = []
    have = False
    i = 0
    n = len(cmd)
    while i < n:
        c = cmd[i]
        if c in ' \t':
            if have:
                words.append(''.join(cur))
                cur = []
                have = False
            i += 1
        elif c == '"':
            have = True
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
            have = True
            j = cmd.find("'", i + 1)
            if j < 0:
                return None
            cur.append(cmd[i + 1:j])
            i = j + 1
        else:
            have = True
            cur.append(c)
            i += 1
    if have:
        words.append(''.join(cur))
    return words


def run_process(argv, cwd, data):
    """(stdout text, failed)"""
    try:
        p = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL)
    except (OSError, ValueError):
        return '', True
    failed = False
    try:
        out, _ = p.communicate(data, timeout=ORACLE_TIMEOUT)
    except subprocess.TimeoutExpired:
        p.kill()
        out, _ = p.communicate()
        failed = True
    except OSError:
        out = b''
        failed = True
    if p.returncode != 0:
        failed = True
    return (out or b'').decode('utf-8', 'replace'), failed


def materialize(files, root):
    for name, text in files.items():
        path = os.path.join(root, *name.split('/'))
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as f:
                f.write(text.encode('utf-8', 'surrogatepass'))
        except (OSError, ValueError):
            pass


def request_line(ex, rec, ops):
    if ex.kind == 'raw':
        return ex.raw
    op = ops.get(ex.op)
    base = op.request if op is not None and op.request is not None else (
        rec.spec.request if rec.spec is not None and rec.spec.request else {})
    merged = dict(base)
    if ex.req_members:
        merged.update(ex.req_members)
    omit = set(ex.omit)
    parts = []
    if 'id' not in omit:
        parts.append('"id":' + js_str(ex.id))
    if 'op' not in omit:
        parts.append('"op":' + js_str(ex.op))
    for k in js_keys(merged):
        if k not in omit:
            parts.append(js_str(k) + ':' + js_stringify(merged[k]))
    if 'input' not in omit and ex.input_text is not None:
        parts.append('"input":' + ex.input_text)
    return '{' + ','.join(parts) + '}'


def parse_responses(text):
    out = {}
    for line in text.split('\n'):
        if line.strip(''.join(WS_SET)) == '':
            continue
        st, v = parse_json(line)
        if st == 'ok' and isinstance(v, dict) and isinstance(v.get('id'), str):
            out.setdefault(v['id'], v)
    return out


def solo_response(text):
    lines = [l for l in text.split('\n') if l.strip(''.join(WS_SET)) != '']
    if len(lines) != 1:
        return None
    st, v = parse_json(lines[0])
    if st == 'ok' and isinstance(v, dict):
        return v
    return None


# ---------------------------------------------------------------- the whole analysis

def analyze(files, entry, want_cases=False):
    """Returns (sorted diagnostics as tuples, cases or None)."""
    names, folder, rname = collect(files, entry)
    ctx = Ctx(files)
    if folder is None or not names:
        ctx.add(rname, 1, 'P046')
        return finish(ctx), None
    ctx.record_dir = folder
    rec = Rec()
    for n in names:
        read_file(ctx, n, files[n], rec)
    if rec.spec is None:
        ctx.add(rname, 1, 'P021')
    if len(set(rec.versions)) > 1:
        ctx.add(rname, 1, 'P047')
    if ctx.diags:
        return finish(ctx), None
    cases = check_record(ctx, rec, files, want_cases)
    return finish(ctx), cases


def finish(ctx):
    return sorted(ctx.diags, key=lambda d: (u16(d[0]), d[1], u16(d[3]), LEVEL_RANK[d[2]]))


def check_record(ctx, rec, files, want_cases):
    ops = {}
    for op in rec.ops:
        if op.name is not None:
            ops.setdefault(op.name, op)
    # T007, T001, T008, T009..T011, T023 -- file of each statement is kept on reqs only;
    # other statements carry their file through `file` below.
    seen_req, seen_open, seen_dec, seen_op = set(), set(), set(), set()
    decisions = {}
    for d in rec.decisions:
        decisions.setdefault(d.id, d)
    cited = set()
    for r in rec.reqs:
        cited.update(r.decisions)

    for r in rec.reqs:
        f = r.file
        if r.id in seen_req:
            ctx.add(f, r.line, 'T007')
        seen_req.add(r.id)
        if not r.examples and not r.static:
            ctx.add(f, r.line, 'T001')
        done = set()
        for did in r.decisions:
            if did in done:
                continue
            done.add(did)
            d = decisions.get(did)
            if d is None:
                ctx.add(f, r.line, 'T008')
                continue
            state = first_state(d)
            if state in ('contested', 'superseded', 'rejected'):
                ctx.add(f, r.line, 'T028')
            elif state in ('observed', 'inferred', 'proposed'):
                ctx.add(f, r.line, 'T028', 'warning')
        for ex in r.examples:
            expects_error = any(e.path == 'error' for e in ex.expects)
            for e in ex.expects:
                if e.path == 'error' and e.kind == 'eq':
                    if not (isinstance(e.value, str) and e.value in rec.codes):
                        ctx.add(f, e.line, 'T023')
            if ex.kind == 'raw' or expects_error:
                continue
            op = ops.get(ex.op)
            if op is None:
                ctx.add(f, ex.line, 'T009')
                continue
            keys = list(ex.input_obj.keys()) if ex.input_obj is not None else []
            for fname, optional in op.fields.items():
                if not optional and fname not in keys:
                    ctx.add(f, ex.line, 'T010')
            for k in keys:
                if k not in op.fields:
                    ctx.add(f, ex.line, 'T011', 'warning')
        if r.text is not None and names_two_codes(r.text, rec.codes) and _PHRASE_RE.search(r.text):
            ctx.add(f, r.text_line, 'T005')

    for o in rec.opens:
        if o.id in seen_open:
            ctx.add(o.file, o.line, 'T007')
        seen_open.add(o.id)
        for ln in o.clauses:
            ctx.add(o.file, ln, 'T003')
        if has_obligation(o.text):
            ctx.add(o.file, o.line, 'T014', 'warning')
    for op in rec.ops:
        if op.name is not None:
            if op.name in seen_op:
                ctx.add(op.file, op.line, 'T007')
            seen_op.add(op.name)
        if has_obligation(op.result):
            ctx.add(op.file, op.line, 'T004')
    for d in rec.decisions:
        if d.id in seen_dec:
            ctx.add(d.file, d.line, 'T007')
        seen_dec.add(d.id)
        if d.id not in cited:
            ctx.add(d.file, d.line, 'T012', 'warning')
        if d.source == '':
            ctx.add(d.file, d.line, 'T013', 'warning')
        if d.status is not None and not status_ok(d.status, decisions):
            ctx.add(d.file, d.line, 'T027')
        for text in [d.text] + d.rejected:
            if has_obligation(text):
                ctx.add(d.file, d.line, 'T004')
    for s in rec.sections:
        if has_obligation(s.text):
            ctx.add(s.file, s.line, 'T004')
    for n in rec.notes:
        if has_obligation(n.text):
            ctx.add(n.file, n.line, 'T004')
    if rec.spec is not None and has_obligation(rec.spec.text):
        ctx.add(rec.spec.file, rec.spec.line, 'T004')
    for (file, line, text) in rec.conditions:
        if has_obligation(text):
            ctx.add(file, line, 'T004')

    run_oracle_phase(ctx, rec, files, ops)
    if want_cases and not any(d[2] == 'error' for d in ctx.diags):
        return build_cases(rec, ops)
    return None


def first_state(d):
    if d.status is None:
        return 'accepted'
    word = ''
    for ch in d.status:
        if ch in WS_SET:
            break
        word += ch
    return word if word in STATES else 'accepted'


def status_ok(status, decisions):
    word = ''
    for ch in status:
        if ch in WS_SET:
            break
        word += ch
    if word not in STATES:
        return False
    if word == 'superseded':
        m = re.fullmatch(r'superseded by ([^\t\n\x0b\x0c\r    - '
                         r'    　﻿]+)', status)
        return bool(m) and m.group(1) in decisions
    return True


def expects_error(ex):
    return any(e.path == 'error' for e in ex.expects)


def run_oracle_phase(ctx, rec, files, ops):
    all_ex = [(r, ex) for r in rec.reqs for ex in r.examples]
    if not all_ex:
        return
    if rec.oracle is None:
        ctx.add(rec.spec.file, rec.spec.line, 'T019')
        return
    runnable = [(r, ex) for (r, ex) in all_ex
                if ex.kind == 'raw' or expects_error(ex) or ex.op in ops]
    for r, ex in runnable:
        ex.line_text = request_line(ex, rec, ops)
        ex.solo = ex.kind == 'raw' or 'id' in ex.omit
        ex.response = None
    batch = [(r, ex) for (r, ex) in runnable if not ex.solo]
    solos = [(r, ex) for (r, ex) in runnable if ex.solo]
    if not runnable:
        return
    argv = split_command(rec.oracle.command)
    odir = rec.oracle.file.rsplit('/', 1)[0] if '/' in rec.oracle.file else ''
    with tempfile.TemporaryDirectory(prefix='duramen-') as root:
        materialize(files, root)
        cwd = os.path.join(root, *odir.split('/')) if odir else root

        def run(lines):
            if argv is None or not argv:
                return '', True
            data = ''.join(l + '\n' for l in lines).encode('utf-8', 'surrogatepass')
            return run_process(argv, cwd, data)

        if batch:
            out, failed = run([ex.line_text for _, ex in batch])
            if failed:
                ctx.add(rec.oracle.file, rec.oracle.line, 'T020')
            resp = parse_responses(out)
            for r, ex in batch:
                ex.response = resp.get(ex.id)
        for r, ex in solos:
            out, failed = run([ex.line_text])
            if failed:
                ctx.add(r.file, ex.line, 'T020')
            ex.response = solo_response(out)
    for r, ex in runnable:
        f = r.file
        resp = ex.response
        if resp is None:
            ctx.add(f, ex.line, 'T021')
            continue
        if 'oracle_error' in resp:
            ctx.add(f, ex.line, 'T022')
            continue
        for e in ex.expects:
            found, val = value_at(resp, e.path)
            if e.kind == 'oracle':
                if not found:
                    ctx.add(f, e.line, 'T025')
                e.value = val
            elif e.kind == 'eq':
                if not (found and jeq(val, e.value)):
                    ctx.add(f, e.line, 'T002')
            else:
                if not (found and is_num(val) and abs(val - e.value) <= e.tol):
                    ctx.add(f, e.line, 'T002')
        if not ex.expects and 'error' in resp:
            ctx.add(f, ex.line, 'T024', 'warning')


def build_cases(rec, ops):
    cases = []
    for r in rec.reqs:
        for ex in r.examples:
            resp = ex.response
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
            op = ops.get(ex.op) if ex.kind != 'raw' else raw_op(ex, ops)
            full = {'members': sorted(resp.keys(), key=u16),
                    'tolerances': dict(op.tolerances) if op is not None else {}}
            if 'error' in resp:
                full['error'] = resp['error']
            if 'result' in resp:
                full['result'] = resp['result']
            if op is not None and op.audit and 'audit' in resp:
                full['audit'] = resp['audit']
            case = {'id': ex.id, 'kind': 'example', 'reqs': ['REQ-' + r.id], 'platform': r.platform,
                    'line': ex.line_text, 'checks': checks, 'full': full}
            if ex.solo:
                case['solo'] = True
            cases.append(case)
    return cases


def raw_op(ex, ops):
    st, v = parse_json(ex.raw)
    if st == 'ok' and isinstance(v, dict) and isinstance(v.get('op'), str):
        return ops.get(v['op'])
    return None
