"""Checking a record: entry resolution, T diagnostics, the oracle, and the suite."""
import os
import re
import subprocess
import tempfile

from jsutil import (WS_CLASS, NOT_WS, strip, split_word, parse_json, TooBig, js_dumps, js_keys,
                    jeq, dist, is_num, lookup, u16)
from reader import Reader

ORACLE_TIMEOUT = 30

STATUS_WORDS = ('observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded',
                'rejected')
BAD_STATUS = ('contested', 'superseded', 'rejected')
WEAK_STATUS = ('observed', 'inferred', 'proposed')

OBL_RE = re.compile(r'(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])')
QUOTES = {'"': '"', '“': '”', '`': '`'}
PHRASES = ['in this order', 'in the order', 'first that applies', 'first match', 'precede',
           'precedes', 'preceded', 'before', 'after', 'take precedence', 'takes precedence']
PHRASE_RES = [re.compile(r'(?<![A-Za-z0-9_])' + (WS_CLASS + '+').join(re.escape(w) for w in p.split())
                         + r'(?![A-Za-z0-9_])', re.I | re.A) for p in PHRASES]
SUPERSEDED_RE = re.compile('superseded by (' + NOT_WS + '+)')
LEVELS = {'error': 0, 'warning': 1, 'info': 2}


def valid_name(name):
    if not isinstance(name, str) or '\\' in name or '\0' in name:
        return False
    if re.match(r'[A-Za-z]:', name):
        return False
    return all(p not in ('', '.', '..') for p in name.split('/'))


def strip_quotes(line):
    out = []
    i = 0
    n = len(line)
    while i < n:
        ch = line[i]
        close = QUOTES.get(ch)
        if close is not None:
            j = line.find(close, i + 1)
            if j >= 0:
                out.append(' ')
                i = j + 1
                continue
        out.append(ch)
        i += 1
    return ''.join(out)


def has_obligation(lines):
    return any(OBL_RE.search(strip_quotes(x)) for x in lines)


def split_command(cmd):
    words = []
    cur = []
    has = False
    i = 0
    n = len(cmd)
    while i < n:
        ch = cmd[i]
        if ch in ' \t':
            if has:
                words.append(''.join(cur))
                cur = []
                has = False
            i += 1
        elif ch == '"':
            has = True
            i += 1
            while True:
                if i >= n:
                    return None
                c2 = cmd[i]
                if c2 == '\\' and i + 1 < n and cmd[i + 1] == '"':
                    cur.append('"')
                    i += 2
                elif c2 == '"':
                    i += 1
                    break
                else:
                    cur.append(c2)
                    i += 1
        elif ch == "'":
            has = True
            j = cmd.find("'", i + 1)
            if j < 0:
                return None
            cur.append(cmd[i + 1:j])
            i = j + 1
        else:
            cur.append(ch)
            has = True
            i += 1
    if has:
        words.append(''.join(cur))
    return words


def clean_surrogates(s):
    return re.sub('[\ud800-\udfff]', '�', s)


def exec_oracle(command, cwd, lines):
    """Run the oracle once. Returns (output text, ok)."""
    words = split_command(command)
    if not words:
        return '', False
    try:
        p = subprocess.Popen(words, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL)
    except (OSError, ValueError):
        return '', False
    data = clean_surrogates(''.join(x + '\n' for x in lines)).encode('utf-8')
    ok = True
    try:
        out, _ = p.communicate(data, timeout=ORACLE_TIMEOUT)
    except subprocess.TimeoutExpired:
        p.kill()
        out, _ = p.communicate()
        ok = False
    except OSError:
        p.kill()
        out, _ = p.communicate()
        ok = False
    if p.returncode != 0:
        ok = False
    return out.decode('utf-8', errors='replace'), ok


def output_lines(out):
    return [x for x in out.split('\n') if strip(x) != '']


def parse_response(line):
    try:
        v = parse_json(line)
    except ValueError:
        return None
    return v if isinstance(v, dict) else None


def write_files(root, files):
    for name, text in files.items():
        path = os.path.join(root, *name.split('/'))
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as f:
                f.write(text.encode('utf-8', 'surrogatepass'))
        except (OSError, ValueError):
            pass


def build_line(rec, ex, cid):
    if ex.raw_line is not None:
        return ex.raw_line
    op = rec.op_by_name.get(ex.op)
    if op is not None and op.request is not None:
        base = op.request
    elif rec.spec is not None and rec.spec['request'] is not None:
        base = rec.spec['request']
    else:
        base = {}
    members = dict(base)
    members.update(ex.request)
    for k in ex.omit:
        members.pop(k, None)
    parts = []
    if 'id' not in ex.omit:
        parts.append('"id":' + js_dumps(cid))
    if 'op' not in ex.omit:
        parts.append('"op":' + js_dumps(ex.op))
    for k in js_keys(members):
        parts.append(js_dumps(k) + ':' + js_dumps(members[k]))
    if 'input' not in ex.omit:
        if ex.has_input_lines:
            parts.append('"input":' + js_dumps(ex.input_obj))
        elif ex.input_text is not None:
            parts.append('"input":' + ex.input_text)
    return '{' + ','.join(parts) + '}'


def resolve_record(files, entry):
    """(label, folder, names) or (label, None, None) when the record does not exist."""
    if entry is None or entry == '.':
        label, folder = '.', ''
    elif entry in files:
        return entry, entry.rpartition('/')[0], [entry]
    else:
        label, folder = entry, entry
    prefix = folder + '/' if folder else ''
    names = []
    for name in files:
        if not name.startswith(prefix):
            continue
        rel = name[len(prefix):]
        parts = rel.split('/')
        if not rel.endswith('.duramen'):
            continue
        if any(p.startswith('.') for p in parts):
            continue
        if any(p in ('build', 'node_modules') for p in parts[:-1]):
            continue
        names.append(name)
    if not names:
        return label, None, None
    names.sort(key=lambda s: u16(s[len(prefix):]))
    return label, folder, names


class Result:
    def __init__(self):
        self.diags = []
        self.cases = None


def analyze(files, entry, want_cases=False):
    label, folder, names = resolve_record(files, entry)
    if names is None:
        res = Result()
        res.diags = [(label, 1, 'error', 'P046')]
        return res
    rd = Reader(files, label, folder)
    rd.read(names)
    res = Result()
    if rd.diags:
        res.diags = rd.diags
        return res
    rec = rd
    rec.op_by_name = {}
    for op in rec.ops:
        rec.op_by_name.setdefault(op.name, op)
    diags = []

    def d(file, line, code, level='error'):
        diags.append((file, line, level, code))

    # T007 -----------------------------------------------------------------
    for kind_items, key in ((rec.reqs, lambda r: r.id), (rec.opens, lambda o: o['id']),
                            (rec.decisions, lambda x: x.id), (rec.ops, lambda o: o.name)):
        seen = set()
        for it in kind_items:
            k = key(it)
            if k in seen:
                f, ln = (it['file'], it['line']) if isinstance(it, dict) else (it.file, it.line)
                d(f, ln, 'T007')
            seen.add(k)

    # T001 -----------------------------------------------------------------
    for r in rec.reqs:
        if not r.items and not r.static:
            d(r.file, r.line, 'T001')

    # T003 -----------------------------------------------------------------
    for o in rec.opens:
        for ln in o['tests']:
            d(o['file'], ln, 'T003')

    # T004 / T014 ----------------------------------------------------------
    if rec.spec is not None and rec.spec['text'] and has_obligation(rec.spec['text']):
        d(rec.spec['file'], rec.spec['line'], 'T004')
    for s in rec.sections + rec.notes:
        if s['text'] and has_obligation(s['text']):
            d(s['file'], s['line'], 'T004')
    for dec in rec.decisions:
        if dec.text and has_obligation(dec.text):
            d(dec.file, dec.line, 'T004')
        for alt in dec.rejected:
            if has_obligation(re.split(r'\r\n|\n|\r', alt)):
                d(dec.file, dec.line, 'T004')
    for op in rec.ops:
        if op.result is not None and has_obligation([op.result]):
            d(op.file, op.line, 'T004')
    for f, ln, cond in rec.error_conds:
        if has_obligation(cond):
            d(f, ln, 'T004')
    for o in rec.opens:
        if o['text'] and has_obligation(o['text']):
            d(o['file'], o['line'], 'T014', 'warning')

    # T005 -----------------------------------------------------------------
    codes = list(dict.fromkeys(rec.error_codes))
    for r in rec.reqs:
        if not r.text:
            continue
        text = '\n'.join(r.text)
        named = [c for c in codes
                 if re.search(r'(?<![A-Za-z0-9_-])' + re.escape(c) + r'(?![A-Za-z0-9_-])', text)]
        if len(named) >= 2 and any(p.search(text) for p in PHRASE_RES):
            d(r.file, r.text_line, 'T005')

    # decisions: T008, T012, T013, T027, T028 --------------------------------
    first_dec = {}
    for dec in rec.decisions:
        first_dec.setdefault(dec.id, dec)
    cited = set()
    for r in rec.reqs:
        cited.update(r.decisions)
        done = set()
        for did in r.decisions:
            if did in done:
                continue
            done.add(did)
            dec = first_dec.get(did)
            if dec is None:
                d(r.file, r.line, 'T008')
                continue
            word = split_word(dec.status)[0] if dec.status is not None else 'accepted'
            if word in BAD_STATUS:
                d(r.file, r.line, 'T028')
            elif word in WEAK_STATUS:
                d(r.file, r.line, 'T028', 'warning')
    for dec in rec.decisions:
        if dec.id not in cited:
            d(dec.file, dec.line, 'T012', 'warning')
        if not dec.source:
            d(dec.file, dec.line, 'T013', 'warning')
        if dec.status is not None:
            word = split_word(dec.status)[0]
            if word not in STATUS_WORDS:
                d(dec.file, dec.line, 'T027')
            elif word == 'superseded':
                m = SUPERSEDED_RE.fullmatch(dec.status)
                if not m or m.group(1) not in first_dec:
                    d(dec.file, dec.line, 'T027')

    # examples: T009-T011, T023 ------------------------------------------------
    items = []          # (req, n, example)
    for r in rec.reqs:
        for n, ex in enumerate(r.items, 1):
            items.append((r, n, ex))
    runnable = []
    for r, n, ex in items:
        if not ex.raw and not ex.expects_error:
            op = rec.op_by_name.get(ex.op)
            if op is None:
                d(ex.file, ex.line, 'T009')
            else:
                keys = ex.input_obj if isinstance(ex.input_obj, dict) else {}
                for fname, optional in op.fields:
                    if not optional and fname not in keys:
                        d(ex.file, ex.line, 'T010')
                declared = {fname for fname, _ in op.fields}
                for k in keys:
                    if k not in declared:
                        d(ex.file, ex.line, 'T011', 'warning')
        if ex.raw or ex.expects_error or ex.op in rec.op_by_name:
            runnable.append((r, n, ex))
        for e in ex.expects:
            if e.path == 'error' and e.kind != 'oracle':
                if not (e.kind == 'eq' and isinstance(e.value, str) and e.value in codes):
                    d(ex.file, e.line, 'T023')

    # oracle ---------------------------------------------------------------
    responses = {}
    if items and rec.oracle is None:
        d(rec.spec['file'], rec.spec['line'], 'T019')
    elif items:
        run_oracle(rec, files, runnable, responses, d)
        for r, n, ex in runnable:
            check_example(rec, ex, responses.get(id(ex)), d)

    diags.extend([])
    res.diags = diags
    n_errors = sum(1 for x in diags if x[2] == 'error')
    if want_cases and n_errors == 0:
        res.cases = build_cases(rec, items, responses)
    return res


def run_oracle(rec, files, runnable, responses, d):
    orc = rec.oracle
    tmp = tempfile.TemporaryDirectory()
    try:
        write_files(tmp.name, files)
        folder = orc['file'].rpartition('/')[0]
        cwd = os.path.join(tmp.name, *folder.split('/')) if folder else tmp.name
        batch = []
        for r, n, ex in runnable:
            cid = '%s#%d' % (r.id, n)
            line = build_line(rec, ex, cid)
            solo = ex.raw or 'id' in ex.omit
            if solo:
                out, ok = exec_oracle(orc['command'], cwd, [line])
                if not ok:
                    d(ex.file, ex.line, 'T020')
                ls = output_lines(out)
                if len(ls) == 1:
                    responses[id(ex)] = parse_response(ls[0])
                else:
                    responses[id(ex)] = None
            else:
                batch.append((cid, ex, line))
        if batch:
            out, ok = exec_oracle(orc['command'], cwd, [x[2] for x in batch])
            if not ok:
                d(orc['file'], orc['line'], 'T020')
            by_id = {}
            for ln in output_lines(out):
                v = parse_response(ln)
                if v is not None and isinstance(v.get('id'), str):
                    by_id.setdefault(v['id'], v)
            for cid, ex, line in batch:
                responses[id(ex)] = by_id.get(cid)
    finally:
        tmp.cleanup()


def check_example(rec, ex, resp, d):
    if resp is None:
        d(ex.file, ex.line, 'T021')
        return
    if 'oracle_error' in resp:
        d(ex.file, ex.line, 'T022')
        return
    for e in ex.expects:
        found, val = lookup(resp, e.path)
        if e.kind == 'oracle':
            if not found:
                d(ex.file, e.line, 'T025')
        elif e.kind == 'eq':
            if not (found and jeq(val, e.value)):
                d(ex.file, e.line, 'T002')
        else:
            if not (found and is_num(val) and dist(val, e.value) <= e.tol):
                d(ex.file, e.line, 'T002')
    if not ex.expects and 'error' in resp:
        d(ex.file, ex.line, 'T024', 'warning')


def build_cases(rec, items, responses):
    cases = []
    for r, n, ex in items:
        resp = responses.get(id(ex))
        cid = '%s#%d' % (r.id, n)
        checks = []
        for e in ex.expects:
            if e.kind == 'eq':
                checks.append({'path': e.path, 'kind': 'eq', 'value': e.value})
            elif e.kind == 'approx':
                checks.append({'path': e.path, 'kind': 'approx', 'value': e.value, 'tol': e.tol})
            else:
                found, val = lookup(resp, e.path)
                checks.append({'path': e.path, 'kind': 'eq', 'value': val, 'from': 'oracle'})
        op = None if ex.raw else rec.op_by_name.get(ex.op)
        members = sorted(resp.keys(), key=u16)
        full = {'members': members, 'tolerances': dict(op.tolerances) if op else {}}
        if 'error' in resp:
            full['error'] = resp['error']
        if 'result' in resp:
            full['result'] = resp['result']
        if op is not None and op.audit and isinstance(resp.get('audit'), str):
            full['audit'] = resp['audit']
        case = {'id': cid, 'kind': 'example', 'reqs': ['REQ-' + r.id], 'platform': r.platform,
                'line': build_line(rec, ex, cid), 'checks': checks, 'full': full}
        if ex.raw or 'id' in ex.omit:
            case['solo'] = True
        cases.append(case)
    return cases


def format_diags(diags):
    ordered = sorted(diags, key=lambda x: (u16(x[0]), x[1], u16(x[3]), LEVELS[x[2]]))
    return ['%s:%d: %s %s' % (f, ln, lv, code) for f, ln, lv, code in ordered], ordered
