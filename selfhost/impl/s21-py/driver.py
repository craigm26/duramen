"""The duramen-core driver: one JSON request per line in, one JSON response per line out."""
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from jsutil import parse_json_lenient, js_dumps  # noqa: E402
from checker import analyze, valid_name, format_diags  # noqa: E402
from judge import judge, valid_input  # noqa: E402


def valid_files(files):
    if not isinstance(files, dict) or not files:
        return False
    if not all(isinstance(v, str) for v in files.values()):
        return False
    names = list(files)
    if not all(valid_name(n) for n in names):
        return False
    nameset = set(names)
    for n in names:
        parts = n.split('/')
        for i in range(1, len(parts)):
            if '/'.join(parts[:i]) in nameset:
                return False
    return True


def handle(req):
    op = req.get('op')
    if not isinstance(op, str) or op not in ('check', 'cases', 'judge'):
        return {'error': 'unknown_op'}
    inp = req.get('input')
    if not isinstance(inp, dict):
        return {'error': 'bad_request'}
    if op == 'judge':
        if not valid_input(inp):
            return {'error': 'bad_request'}
        return {'result': judge(inp)}
    files = inp.get('files')
    if not valid_files(files):
        return {'error': 'bad_request'}
    entry = None
    if 'entry' in inp:
        entry = inp['entry']
        if not isinstance(entry, str) or not (entry == '.' or valid_name(entry)):
            return {'error': 'bad_request'}
    res = analyze(files, entry, want_cases=(op == 'cases'))
    strings, ordered = format_diags(res.diags)
    errors = sum(1 for x in ordered if x[2] == 'error')
    if op == 'check':
        warnings = sum(1 for x in ordered if x[2] == 'warning')
        return {'result': {'diagnostics': strings, 'errors': errors, 'warnings': warnings}}
    return {'result': {'errors': errors, 'cases': res.cases if res.cases is not None else []}}


def respond(raw):
    line = raw.decode('utf-8', errors='replace')
    if line.strip(' \t\r\n') == '':
        return None
    try:
        req = parse_json_lenient(line)
    except ValueError:
        return {'id': None, 'error': 'bad_request'}
    if not isinstance(req, dict) or not isinstance(req.get('id'), str):
        return {'id': None, 'error': 'bad_request'}
    rid = req['id']
    try:
        out = handle(req)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        return {'id': rid, 'error': 'internal_error'}
    out['id'] = rid
    return out


def main():
    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer
    for raw in stdin:
        out = respond(raw)
        if out is None:
            continue
        stdout.write((js_dumps(out) + '\n').encode('utf-8'))
        stdout.flush()


if __name__ == '__main__':
    main()
