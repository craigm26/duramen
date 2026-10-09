"""The duramen-core driver: one JSON request per line in, one JSON response per line out."""
import sys

from jsonx import parse, JsonError, dumps
import checker


def handle(line):
    """Returns the response object for one non-blank request line."""
    try:
        req = parse(line, allow_big=True)
    except JsonError:
        return {'id': None, 'error': 'bad_request'}
    if not isinstance(req, dict) or not isinstance(req.get('id'), str):
        return {'id': None, 'error': 'bad_request'}
    rid = req['id']
    op = req.get('op')
    if not isinstance(op, str) or op not in ('check', 'cases', 'judge'):
        return {'id': rid, 'error': 'unknown_op'}
    inp = req.get('input')
    if not isinstance(inp, dict):
        return {'id': rid, 'error': 'bad_request'}
    try:
        if op == 'judge':
            if 'case' not in inp or 'answer' not in inp or \
                    not checker.valid_judge(inp['case'], inp['answer']):
                return {'id': rid, 'error': 'bad_request'}
            return {'id': rid, 'result': checker.judge(inp['case'], inp['answer'])}
        files = inp.get('files')
        has_entry = 'entry' in inp
        entry = inp.get('entry')
        if not checker.validate_files(files, entry, has_entry):
            return {'id': rid, 'error': 'bad_request'}
        diags, cases = checker.analyze(files, entry)
        errors = sum(1 for d in diags if d[3] == 'error')
        if op == 'check':
            warnings = sum(1 for d in diags if d[3] == 'warning')
            return {'id': rid, 'result': {'diagnostics': [checker.fmt_diag(d) for d in diags],
                                          'errors': errors, 'warnings': warnings}}
        return {'id': rid, 'result': {'errors': errors, 'cases': cases or []}}
    except Exception as exc:  # the checker itself failed
        import traceback
        sys.stderr.write('internal error: %r\n' % (exc,))
        traceback.print_exc()
        return {'id': rid, 'error': 'internal_error'}


def main():
    out = sys.stdout.buffer
    for raw in sys.stdin.buffer:
        text = raw.decode('utf-8', 'replace')
        if text.endswith('\n'):
            text = text[:-1]
        if text.strip(' \t') == '':
            continue
        out.write((dumps(handle(text)) + '\n').encode('ascii'))
        out.flush()
    return 0


if __name__ == '__main__':
    sys.exit(main())
