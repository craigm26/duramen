"""Developer tool: read the examples out of SPEC.md into spec_examples.json.

Usage: python3 tools/extract_examples.py   (run from the implementation folder)
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VALS = re.compile(r'`([^`]+?)` = `([^`]*)`')


def outcomes(s):
    out = {}
    for path, val in VALS.findall(s):
        out[path] = json.loads(val)
    return out


def main():
    lines = open(os.path.join(HERE, 'SPEC.md'), encoding='utf-8').read().split('\n')
    cases = []
    # the fixture
    fixture = None
    for i, l in enumerate(lines):
        if l.startswith('### `fixtures/echo.mjs`'):
            j = i + 2
            assert lines[j] == '```'
            k = j + 1
            while lines[k] != '```':
                k += 1
            fixture = '\n'.join(lines[j + 1:k]) + '\n'
    assert fixture
    i = 0
    n = len(lines)
    while i < n:
        l = lines[i]
        m = re.match(r'^Example (\d+): `(check|cases)` with input `(.+)` and these texts:$', l)
        if m:
            inp = json.loads(m.group(3))
            inp.setdefault('files', {})
            src = 'SPEC.md:%d' % (i + 1)
            i += 1
            while not lines[i].startswith('⟶'):
                mm = re.match(r'^`input\.files\.(".*")`:(.*)$', lines[i])
                if mm:
                    name = json.loads(mm.group(1))
                    if 'fixtures/echo.mjs' in mm.group(2):
                        inp['files'][name] = fixture
                    else:
                        assert lines[i + 1] == '' and lines[i + 2] == '```', (i, lines[i])
                        k = i + 3
                        while lines[k] != '```':
                            k += 1
                        inp['files'][name] = '\n'.join(lines[i + 3:k]) + '\n'
                        i = k
                i += 1
            exp = outcomes(lines[i][1:])
            cases.append({'src': src, 'op': m.group(2), 'input': inp, 'expect': exp})
        elif l.startswith('- `') or l.startswith('- the request line'):
            src = 'SPEC.md:%d' % (i + 1)
            if '⟶' in l:
                head, tail = l[2:].split(' ⟶ ', 1)
                exp = {}
                for part in tail.split('; '):
                    mm = re.match(r'^`([^`]+)` = `(.*)`$', part)
                    if mm:
                        exp[mm.group(1)] = json.loads(mm.group(2))
                req = None
                if head.startswith('the request line `'):
                    req = {'raw': head[len('the request line `'):-1]}
                else:
                    mm = re.match(r'^`(\w+)(?: (.*))?`(?: \((.*)\))?$', head)
                    if mm:
                        op, js, note = mm.group(1), mm.group(2), mm.group(3)
                        r = {'id': 'x', 'op': op}
                        if js is not None:
                            r['input'] = json.loads(js)
                        if note == 'no `id` member':
                            del r['id']
                        req = {'request': r}
                if req is not None:
                    cases.append(dict(src=src, expect=exp, **req))
        elif l.startswith('| `') and ('"bad_request"' in l or '`true`' in l or '`false`' in l):
            cells = [c.strip() for c in l.strip().strip('|').split(' | ')]
            cells = [c.strip('`') for c in cells]
            src = 'SPEC.md:%d' % (i + 1)
            case = json.loads(cells[0])
            ans = json.loads(cells[1])
            req = {'id': 'x', 'op': 'judge', 'input': {'case': case, 'answer': ans}}
            if len(cells) == 3:
                cases.append({'src': src, 'request': req, 'expect': {'error': json.loads(cells[2])}})
            else:
                exp = {'result.pass': json.loads(cells[2])}
                if len(cells) > 3 and cells[3]:
                    exp['result.failed'] = json.loads(cells[3])
                cases.append({'src': src, 'request': req, 'expect': exp})
        i += 1
    with open(os.path.join(HERE, 'spec_examples.json'), 'w', encoding='utf-8') as fh:
        json.dump(cases, fh, ensure_ascii=True, indent=0)
    print(len(cases), 'examples')


if __name__ == '__main__':
    main()
