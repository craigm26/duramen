"""Python port of echo.mjs, so the tests do not need Node.js."""
import json
import re
import sys

JS_WS = '\t\n\x0b\x0c\r \xa0                　﻿'

sys.stdout.reconfigure(encoding='utf-8', newline='\n')
data = sys.stdin.buffer.read().decode('utf-8', errors='replace')
lines = re.split(r'\r\n|\n|\r', data)
if lines and lines[-1] == '':
    lines.pop()
status = 0
out = sys.stdout


def emit(obj):
    out.write(json.dumps(obj, ensure_ascii=True) + '\n')
    out.flush()


for line in lines:
    if line.strip(JS_WS) == '':
        continue
    try:
        req = json.loads(line)
    except ValueError:
        emit({'id': None, 'error': 'bad_request'})
        continue
    inp = req.get('input') if isinstance(req, dict) else None
    if not isinstance(inp, dict):
        inp = {}
    ex = inp.get('exit')
    if isinstance(ex, (int, float)) and not isinstance(ex, bool) and float(ex) == int(ex):
        status = int(ex)
    if inp.get('silent') is True:
        continue
    if isinstance(inp.get('say'), str):
        out.write(inp['say'] + '\n')
        out.flush()
        continue
    result = {'result': line} if inp.get('line') is True else {'result': inp}
    ans = inp.get('answer')
    body = ans if ans is not None else result
    rid = req.get('id') if isinstance(req, dict) else None
    emit({'id': rid, **body})
sys.exit(status)
