"""duramen-core driver: one JSON request per line in, one JSON response per line out."""
import json
import re
import sys
import traceback

import duramen_core as core

DRIVE_LETTER = re.compile(r'^[A-Za-z]:')


def valid_name(n):
    if not isinstance(n, str) or '\\' in n or '\x00' in n or DRIVE_LETTER.match(n):
        return False
    return all(p not in ('', '.', '..') for p in n.split('/'))


def validate_input(inp):
    if not isinstance(inp, dict):
        return False
    files = inp.get('files')
    if not isinstance(files, dict) or not files:
        return False
    for n, t in files.items():
        if not valid_name(n) or not isinstance(t, str):
            return False
    names = set(files)
    for n in names:
        parts = n.split('/')
        for i in range(1, len(parts)):
            if '/'.join(parts[:i]) in names:
                return False
    if 'entry' in inp:
        e = inp['entry']
        if e != '.' and not valid_name(e):
            return False
    return True


def respond(rid, **kw):
    out = {'id': rid}
    out.update(kw)
    return json.dumps(out, ensure_ascii=True, separators=(',', ':'))


def handle_line(line):
    if line.strip(' \t') == '':
        return None
    ok, req = core.parse_json(line)
    if not ok or not isinstance(req, dict) or not isinstance(req.get('id'), str):
        return respond(None, error='bad_request')
    rid = req['id']
    op = req.get('op')
    if not isinstance(op, str) or op not in ('check', 'cases'):
        return respond(rid, error='unknown_op')
    inp = req.get('input')
    if not validate_input(inp):
        return respond(rid, error='bad_request')
    try:
        entry = inp.get('entry')
        if op == 'check':
            result = core.do_check(inp['files'], entry)
        else:
            result = core.do_cases(inp['files'], entry)
        return respond(rid, result=result)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        return respond(rid, error='internal_error')


def main():
    data = sys.stdin.buffer.read().decode('utf-8', 'replace')
    out = sys.stdout.buffer
    for line in data.split('\n'):
        resp = handle_line(line)
        if resp is not None:
            out.write(resp.encode('utf-8') + b'\n')
            out.flush()
    return 0


if __name__ == '__main__':
    sys.exit(main())
