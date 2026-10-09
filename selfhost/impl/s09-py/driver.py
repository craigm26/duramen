"""duramen-core driver: one JSON request per line in, one JSON response per line out."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from checker import analyze  # noqa: E402
from jsutil import js_stringify  # noqa: E402


def _no_constant(c):
    raise ValueError(c)


def valid_name(n):
    if not isinstance(n, str) or n == '':
        return False
    if '\\' in n or '\x00' in n or re.match(r'[A-Za-z]:', n):
        return False
    return not any(p in ('', '.', '..') for p in n.split('/'))


def bad_files(files):
    if not isinstance(files, dict) or not files:
        return True
    for name, text in files.items():
        if not valid_name(name) or not isinstance(text, str):
            return True
    for name in files:
        parts = name.split('/')
        for i in range(1, len(parts)):
            if '/'.join(parts[:i]) in files:
                return True
    return False


def handle(line):
    """The response object for one non-blank request line."""
    try:
        req = json.loads(line, parse_int=float, parse_constant=_no_constant)
    except (ValueError, RecursionError):
        return {'id': None, 'error': 'bad_request'}
    if not isinstance(req, dict) or not isinstance(req.get('id'), str):
        return {'id': None, 'error': 'bad_request'}
    rid = req['id']
    op = req.get('op')
    if op not in ('check', 'cases'):
        return {'id': rid, 'error': 'unknown_op'}
    inp = req.get('input')
    if not isinstance(inp, dict) or bad_files(inp.get('files')):
        return {'id': rid, 'error': 'bad_request'}
    entry = None
    if 'entry' in inp:
        entry = inp['entry']
        if not (entry == '.' or valid_name(entry)):
            return {'id': rid, 'error': 'bad_request'}
    diags, cases = analyze(inp['files'], entry, op == 'cases')
    errors = sum(1 for d in diags if d[2] == 'error')
    if op == 'check':
        warnings = sum(1 for d in diags if d[2] == 'warning')
        return {'id': rid, 'result': {
            'diagnostics': ['%s:%d: %s %s' % (d[0], d[1], d[2], d[3]) for d in diags],
            'errors': errors, 'warnings': warnings}}
    return {'id': rid, 'result': {'errors': errors, 'cases': cases if cases is not None else []}}


def respond(line):
    try:
        return handle(line)
    except Exception as exc:  # the checker failed on a request it accepted
        sys.stderr.write('internal error: %r\n' % (exc,))
        rid = None
        try:
            rid = json.loads(line).get('id')
        except Exception:
            pass
        return {'id': rid if isinstance(rid, str) else None, 'error': 'internal_error'}


def main():
    data = sys.stdin.buffer.read().decode('utf-8', 'replace')
    out = sys.stdout.buffer
    lines = data.split('\n')
    if lines and lines[-1] == '':
        lines.pop()
    for line in lines:
        if line.strip(' \t') == '':
            continue
        out.write((js_stringify(respond(line)) + '\n').encode('utf-8'))
        out.flush()


if __name__ == '__main__':
    main()
