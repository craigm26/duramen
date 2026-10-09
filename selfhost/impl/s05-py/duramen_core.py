"""duramen-core: the checker (`check`) and the suite generator (`cases`), spoken over the driver protocol."""
import json
import os
import re
import subprocess
import sys
import tempfile

from jsutil import (WSC, stringify, js_str, es_keys, jeq, jparse, split_ws, strip_ws, ascii_escape)
from reader import Reader, Model

ORACLE_TIMEOUT = 30.0
VERSIONS = ('0.1', '0.2')


def u16(s):
    return s.encode('utf-16-be', 'surrogatepass')


# ------------------------------------------------------------------ requests
def valid_name(n):
    if not isinstance(n, str) or n == '':
        return False
    if '\\' in n or '\x00' in n or re.match(r'^[A-Za-z]:', n):
        return False
    return all(p not in ('', '.', '..') for p in n.split('/'))


def validate(inp):
    """True if input is acceptable (the third check of Errors)."""
    if not isinstance(inp, dict):
        return False
    files = inp.get('files')
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
    if 'entry' in inp:
        e = inp['entry']
        if not (e == '.' or valid_name(e)):
            return False
    return True


# ------------------------------------------------------------------- records
def resolve(files, entry):
    """(record name, root folder, [(relative name, full name)]) or (name, None, []) when missing."""
    if entry is None or entry == '.':
        name, root, prefix = '.', '', ''
    elif entry in files:
        return entry, entry.rsplit('/', 1)[0] if '/' in entry else '', [(entry, entry)]
    else:
        name, root, prefix = entry, entry, entry + '/'
        if not any(k.startswith(prefix) for k in files):
            return name, None, []
    out = []
    for k in files:
        if not k.startswith(prefix):
            continue
        rel = k[len(prefix):]
        if not rel.endswith('.duramen'):
            continue
        parts = rel.split('/')
        if any(p.startswith('.') for p in parts):
            continue
        if any(p in ('build', 'node_modules') for p in parts[:-1]):
            continue
        out.append((rel, k))
    out.sort(key=lambda t: u16(t[0]))
    if not out:
        return name, None, []
    return name, root, out


LEVELS = {'error': 0, 'warning': 1, 'info': 2}


def sort_diags(diags):
    return sorted(diags, key=lambda d: (u16(d[0]), d[1], u16(d[3]), LEVELS[d[2]]))


def fmt(d):
    return '%s:%d: %s %s' % (d[0], d[1], d[2], d[3])


# ------------------------------------------------------------------- analyze
def analyze(files, entry):
    """(diagnostics, model or None). The model is None when reading found errors."""
    name, root, recfiles = resolve(files, entry)
    if root is None:
        return [(name, 1, 'error', 'P046')], None
    diags = []
    model = Model()
    versions = set()
    for rel, full in recfiles:
        rd = Reader(files, root, model, diags)
        v = rd.read_file(full, files[full])
        if v:
            versions.add(v)
    if model.spec is None:
        diags.append((name, 1, 'error', 'P021'))
    if len(versions) > 1:
        diags.append((name, 1, 'error', 'P047'))
    if any(d[2] == 'error' for d in diags):
        return sort_diags(diags), None
    run_checks(model, files, diags)
    return sort_diags(diags), model


OBL = re.compile(r'(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])')
QUOTE = re.compile(r'"[^"]*"|“[^”]*”|`[^`]*`')
ORDER_PHRASES = ['in this order', 'in the order', 'first that applies', 'first match', 'precede',
                 'precedes', 'preceded', 'before', 'after', 'take precedence', 'takes precedence']
STATUS_WORDS = ('observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected')


def has_obligation(text):
    for ln in text.split('\n'):
        if OBL.search(QUOTE.sub(' ', ln)):
            return True
    return False


def get_path(resp, path):
    names = path.split('.')
    cur = resp
    start = 0
    if names[0] == 'audit' and len(names) > 1:
        a = resp.get('audit') if isinstance(resp, dict) else None
        if not isinstance(a, str):
            return False, None
        try:
            cur = jparse(a)
        except Exception:
            return False, None
        start = 1
    for nm in names[start:]:
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


def build_line(ex, model):
    if ex.raw:
        return ex.raw_line
    op = model.ops.get(ex.op)
    if op is not None and op.request is not None:
        base = op.request
    else:
        base = (model.spec or {}).get('request') or {}
    members = dict(base)
    for k, v in ex.request.items():
        members[k] = v
    parts = []
    if 'id' not in ex.omit:
        parts.append('"id":' + js_str(ex.id))
    if 'op' not in ex.omit:
        parts.append('"op":' + js_str(ex.op))
    for k in es_keys(members):
        if k not in ex.omit:
            parts.append(js_str(k) + ':' + stringify(members[k]))
    if 'input' not in ex.omit and ex.has_input:
        parts.append('"input":' + ex.input_text)
    return '{' + ','.join(parts) + '}'


def split_command(cmd):
    """Words of an oracle command, or None when a quote is not closed."""
    words, cur, have, i, n = [], [], False, 0, len(cmd)
    while i < n:
        ch = cmd[i]
        if ch in ' \t':
            if have:
                words.append(''.join(cur))
                cur, have = [], False
            i += 1
        elif ch == '"':
            have = True
            i += 1
            while True:
                if i >= n:
                    return None
                if cmd[i] == '\\' and i + 1 < n and cmd[i + 1] == '"':
                    cur.append('"')
                    i += 2
                elif cmd[i] == '"':
                    i += 1
                    break
                else:
                    cur.append(cmd[i])
                    i += 1
        elif ch == "'":
            have = True
            j = cmd.find("'", i + 1)
            if j < 0:
                return None
            cur.append(cmd[i + 1:j])
            i = j + 1
        else:
            have = True
            cur.append(ch)
            i += 1
    if have:
        words.append(''.join(cur))
    return words


def run_once(words, cwd, lines):
    """(stdout lines, failed) for one run of the oracle."""
    data = ''.join(l + '\n' for l in lines).encode('utf-8', 'surrogatepass')
    try:
        proc = subprocess.Popen(words, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL)
    except Exception:
        return [], True
    failed = False
    try:
        out, _ = proc.communicate(data, timeout=ORACLE_TIMEOUT)
    except subprocess.TimeoutExpired:
        proc.kill()
        out, _ = proc.communicate()
        failed = True
    except Exception:
        proc.kill()
        out, _ = proc.communicate()
        failed = True
    if proc.returncode != 0:
        failed = True
    text = (out or b'').decode('utf-8', 'replace')
    return [l.rstrip('\r') for l in text.split('\n') if l.strip('\r') != ''], failed


def parse_response(line):
    try:
        v = json.loads(line, parse_float=float, parse_int=float, parse_constant=lambda x: 1 / 0)
    except Exception:
        return None
    return v if isinstance(v, dict) else None


def write_tree(files, tmp):
    for k, v in files.items():
        p = os.path.join(tmp, *k.split('/'))
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'wb') as f:
                f.write(v.encode('utf-8', 'surrogatepass'))
        except Exception:
            pass


def run_oracle(model, files, runset, diags):
    orc = model.oracle
    words = split_command(orc['cmd'])
    solo = [e for e in runset if e.solo]
    batch = [e for e in runset if not e.solo]
    tmp = tempfile.mkdtemp(prefix='duramen-')
    try:
        write_tree(files, tmp)
        d = orc['file'].rsplit('/', 1)[0] if '/' in orc['file'] else ''
        cwd = os.path.join(tmp, *d.split('/')) if d else tmp

        def run(lines):
            if words is None or not words:
                return [], True
            return run_once(words, cwd, lines)

        if batch:
            out, failed = run([e.line_text for e in batch])
            if failed:
                diags.append((orc['file'], orc['line'], 'error', 'T020'))
            found = {}
            for l in out:
                r = parse_response(l)
                if r is not None and isinstance(r.get('id'), str) and r['id'] not in found:
                    found[r['id']] = r
            for e in batch:
                e.resp = found.get(e.id)
        for e in solo:
            out, failed = run([e.line_text])
            if failed:
                diags.append((e.file, e.line, 'error', 'T020'))
            e.resp = parse_response(out[0]) if len(out) == 1 else None
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


def run_checks(model, files, diags):
    def add(file, line, code, level='error'):
        diags.append((file, line, level, code))

    # IDs
    seen = set()
    for r in model.reqs:
        if r.id in seen:
            add(r.file, r.line, 'T007')
        seen.add(r.id)
    seen = set()
    for o in model.opens:
        if o['id'] in seen:
            add(o['file'], o['line'], 'T007')
        seen.add(o['id'])
    decs = {}
    for dc in model.decisions:
        if dc.id in decs:
            add(dc.file, dc.line, 'T007')
        else:
            decs[dc.id] = dc
    for op in model.op_list:
        if op.name is None:
            continue
        if op.name in model.ops:
            add(op.file, op.line, 'T007')
        else:
            model.ops[op.name] = op

    codes = model.errors['codes'] if model.errors else []

    # requirements
    cited = set()
    for r in model.reqs:
        if not r.exs:
            add(r.file, r.line, 'T001')
        ids = []
        for x in r.decisions:
            if x not in ids:
                ids.append(x)
        for x in ids:
            cited.add(x)
            dc = decs.get(x)
            if dc is None:
                add(r.file, r.line, 'T008')
                continue
            st = split_ws(dc.status)[0] if dc.status and split_ws(dc.status) else ('accepted' if dc.status is None else None)
            if st in ('contested', 'superseded', 'rejected'):
                add(r.file, r.line, 'T028')
            elif st in ('observed', 'inferred', 'proposed'):
                add(r.file, r.line, 'T028', 'warning')
        if r.text is not None:
            lower = r.text
            named = [c for c in codes if re.search(
                r'(?<![A-Za-z0-9_-])' + re.escape(c) + r'(?![A-Za-z0-9_-])', lower)]
            if len(set(named)) >= 2:
                for ph in ORDER_PHRASES:
                    pat = r'(?<![A-Za-z0-9_])' + r'\s+'.join(map(re.escape, ph.split(' '))) + r'(?![A-Za-z0-9_])'
                    if re.search(pat, lower, re.I):
                        add(r.file, r.text_line, 'T005')
                        break

    # decisions
    for dc in model.decisions:
        if dc.id not in cited:
            add(dc.file, dc.line, 'T012', 'warning')
        if dc.source is None or dc.source == '':
            add(dc.file, dc.line, 'T013', 'warning')
        if dc.status is not None:
            w = split_ws(dc.status)
            if not w or w[0] not in STATUS_WORDS:
                add(dc.file, dc.line, 'T027')
            elif w[0] == 'superseded':
                m = re.fullmatch(r'superseded by ([^' + WSC + ']+)', dc.status)
                if not m or m.group(1) not in decs:
                    add(dc.file, dc.line, 'T027')

    # open items
    for o in model.opens:
        for ln in o['demo']:
            add(o['file'], ln, 'T003')
        if o['text'] is not None and has_obligation(o['text']):
            add(o['file'], o['line'], 'T014', 'warning')

    # obligations
    for kind, text, file, line in model.texts:
        if has_obligation(text):
            add(file, line, 'T004')
    if model.errors:
        for text, file, line in model.errors['conds']:
            if has_obligation(text):
                add(file, line, 'T004')

    # examples
    exs = []
    for r in model.reqs:
        for n, e in enumerate(r.exs, 1):
            e.id = '%s#%d' % (r.id, n)
            exs.append(e)
    for e in exs:
        e.line_text = build_line(e, model)
        if not e.raw and not e.has_error_exp:
            op = model.ops.get(e.op)
            if op is None:
                add(e.file, e.line, 'T009')
            else:
                have = set(e.fields)
                for f, opt in op.fields.items():
                    if not opt and f not in have:
                        add(e.file, e.line, 'T010')
                for f in e.fields:
                    if f not in op.fields:
                        add(e.file, e.line, 'T011', 'warning')
        for x in e.expects:
            if x['path'] == 'error' and x['kind'] == 'eq':
                v = x['value']
                if not (isinstance(v, str) and v in codes):
                    add(e.file, x['line'], 'T023')

    if exs and model.oracle is None:
        add(model.spec['file'], model.spec['line'], 'T019')
        return
    runset = [e for e in exs if e.raw or e.has_error_exp or e.op in model.ops]
    if not runset:
        return
    run_oracle(model, files, runset, diags)
    for e in runset:
        resp = e.resp
        if resp is None:
            add(e.file, e.line, 'T021')
            continue
        if 'oracle_error' in resp:
            add(e.file, e.line, 'T022')
            continue
        if 'error' in resp and not e.expects:
            add(e.file, e.line, 'T024', 'warning')
        for x in e.expects:
            found, val = get_path(resp, x['path'])
            if x['kind'] == 'oracle':
                if not found:
                    add(e.file, x['line'], 'T025')
                else:
                    x['oracle_value'] = val
            elif x['kind'] == 'eq':
                if not (found and jeq(val, x['value'])):
                    add(e.file, x['line'], 'T002')
            else:
                ok = (found and type(val) is float and abs(val - x['value']) <= x['tol'])
                if not ok:
                    add(e.file, x['line'], 'T002')


# --------------------------------------------------------------------- cases
def build_cases(model):
    out = []
    for r in model.reqs:
        for e in r.exs:
            checks = []
            for x in e.expects:
                if x['kind'] == 'eq':
                    checks.append({'path': x['path'], 'kind': 'eq', 'value': x['value']})
                elif x['kind'] == 'approx':
                    checks.append({'path': x['path'], 'kind': 'approx', 'value': x['value'], 'tol': x['tol']})
                else:
                    checks.append({'path': x['path'], 'kind': 'eq', 'value': x['oracle_value'], 'from': 'oracle'})
            op = model.ops.get(e.op)
            resp = e.resp or {}
            full = {'members': sorted(resp.keys(), key=u16),
                    'tolerances': dict(op.tol) if op else {}}
            if 'error' in resp:
                full['error'] = resp['error']
            if 'result' in resp:
                full['result'] = resp['result']
            if op and op.audit and 'audit' in resp:
                full['audit'] = resp['audit']
            case = {'id': e.id, 'kind': 'example', 'reqs': ['REQ-' + r.id], 'platform': r.platform,
                    'line': e.line_text, 'checks': checks, 'full': full}
            if e.solo:
                case['solo'] = True
            out.append(case)
    return out


# ------------------------------------------------------------------ protocol
def handle(line):
    """The response object for one request line, or None for a blank line."""
    if line.strip(' \t') == '':
        return None
    try:
        req = json.loads(line, parse_float=float, parse_int=float, parse_constant=lambda x: 1 / 0)
    except Exception:
        return {'id': None, 'error': 'bad_request'}
    if not isinstance(req, dict) or not isinstance(req.get('id'), str):
        return {'id': None, 'error': 'bad_request'}
    id_ = req['id']
    op = req.get('op')
    if op not in ('check', 'cases'):
        return {'id': id_, 'error': 'unknown_op'}
    inp = req.get('input')
    if not validate(inp):
        return {'id': id_, 'error': 'bad_request'}
    try:
        diags, model = analyze(inp['files'], inp.get('entry'))
        errors = sum(1 for d in diags if d[2] == 'error')
        if op == 'check':
            warnings = sum(1 for d in diags if d[2] == 'warning')
            return {'id': id_, 'result': {'diagnostics': [fmt(d) for d in diags],
                                          'errors': float(errors), 'warnings': float(warnings)}}
        cases = build_cases(model) if errors == 0 and model is not None else []
        return {'id': id_, 'result': {'errors': float(errors), 'cases': cases}}
    except Exception as ex:  # OPEN-RQ-004
        sys.stderr.write('internal error: %r\n' % (ex,))
        return {'id': id_, 'error': 'internal_error'}


def main():
    out = sys.stdout.buffer
    for raw in sys.stdin.buffer:
        line = raw.decode('utf-8', 'replace').rstrip('\n').rstrip('\r')
        resp = handle(line)
        if resp is None:
            continue
        out.write((ascii_escape(stringify(resp)) + '\n').encode('ascii'))
        out.flush()


if __name__ == '__main__':
    main()
