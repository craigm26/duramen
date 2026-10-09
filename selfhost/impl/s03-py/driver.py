"""duramen-core driver: one JSON request per line on stdin, one response per line on stdout."""
import sys
import traceback

from checker import do_cases, do_check, is_valid_name
from jsutil import jdump, jparse


def respond(obj):
    sys.stdout.buffer.write((jdump(obj) + '\n').encode('utf-8'))
    sys.stdout.buffer.flush()


def handle(line):
    """-> response object, or None for a blank line."""
    if line.strip(' \t') == '':
        return None
    ok, req = jparse(line)
    if not ok or not isinstance(req, dict) or not isinstance(req.get('id'), str):
        return {'id': None, 'error': 'bad_request'}
    rid = req['id']
    op = req.get('op')
    if not isinstance(op, str) or op not in ('check', 'cases'):
        return {'id': rid, 'error': 'unknown_op'}
    inp = req.get('input')
    if not isinstance(inp, dict):
        return {'id': rid, 'error': 'bad_request'}
    files = inp.get('files')
    bad = {'id': rid, 'error': 'bad_request'}
    if not isinstance(files, dict) or not files:
        return bad
    for n, t in files.items():
        if not isinstance(t, str) or not is_valid_name(n):
            return bad
    for n in files:
        parts = n.split('/')
        for k in range(1, len(parts)):
            if '/'.join(parts[:k]) in files:
                return bad
    entry = None
    if 'entry' in inp:
        entry = inp['entry']
        if not isinstance(entry, str) or not (entry == '.' or is_valid_name(entry)):
            return bad
    try:
        result = do_check(files, entry) if op == 'check' else do_cases(files, entry)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        return {'id': rid, 'error': 'internal_error'}
    return {'id': rid, 'result': result}


def main():
    for raw in sys.stdin.buffer:
        line = raw.decode('utf-8', 'replace')
        if line.endswith('\n'):
            line = line[:-1]
        out = handle(line)
        if out is not None:
            respond(out)


if __name__ == '__main__':
    main()
