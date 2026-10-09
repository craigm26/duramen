"""The duramen-core driver: one JSON request per line on stdin, one JSON response per line on stdout."""
import json
import sys
import traceback

import duramen


def _const(s):
    raise ValueError(s)


def respond(raw):
    """Returns the response object for one request line (bytes), or None for a blank line."""
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        return {'id': None, 'error': 'bad_request'}
    if text.strip(' \t\r\n') == '':
        return None
    try:
        req = json.loads(text, parse_int=float, parse_constant=_const)
    except (ValueError, RecursionError):
        return {'id': None, 'error': 'bad_request'}
    if not isinstance(req, dict) or not isinstance(req.get('id'), str):
        return {'id': None, 'error': 'bad_request'}
    try:
        return duramen.handle(req)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        return {'id': req['id'], 'error': 'internal_error'}


def main():
    out = sys.stdout.buffer
    for raw in sys.stdin.buffer:
        resp = respond(raw)
        if resp is None:
            continue
        out.write((duramen.js_dumps(resp) + '\n').encode('utf-8'))
        out.flush()


if __name__ == '__main__':
    main()
