"""The driver: one JSON request per line on stdin, one JSON response per line on stdout."""
import json
import sys

import duramen


def main():
    out = sys.stdout.buffer
    for raw in sys.stdin.buffer:
        line = raw.decode('utf-8', 'replace')
        if line.endswith('\n'):
            line = line[:-1]
        if line.strip(' \t') == '':
            continue
        try:
            resp = duramen.handle_line(line)
        except Exception:
            import traceback
            traceback.print_exc(file=sys.stderr)
            resp = {'id': None, 'error': 'internal_error'}
        out.write((json.dumps(resp, ensure_ascii=True, separators=(',', ':')) + '\n').encode('ascii'))
        out.flush()


if __name__ == '__main__':
    main()
