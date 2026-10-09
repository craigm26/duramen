# Python twin of echo.mjs, so the tests can run where node is missing.
import json
import sys

status = 0
for line in sys.stdin:
    line = line.rstrip('\n')
    if line.strip() == '':
        continue
    try:
        req = json.loads(line)
    except Exception:
        print(json.dumps({'id': None, 'error': 'bad_request'}))
        continue
    inp = req.get('input') if isinstance(req, dict) else None
    inp = inp if isinstance(inp, dict) else {}
    if isinstance(inp.get('exit'), int) and not isinstance(inp.get('exit'), bool):
        status = inp['exit']
    if inp.get('silent') is True:
        continue
    result = {'result': line} if inp.get('line') is True else {'result': inp}
    ans = inp['answer'] if 'answer' in inp else result
    out = {'id': req.get('id') if isinstance(req, dict) else None}
    out.update(ans)
    print(json.dumps(out), flush=True)
sys.exit(status)
