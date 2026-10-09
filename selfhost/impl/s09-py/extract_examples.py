"""Turns the examples of SPEC.md into spec_examples.json, the data of test_spec_examples.py.

Usage: python3 extract_examples.py [SPEC.md [spec_examples.json]]
"""
import json
import os
import re
import sys


def fence(lines, i):
    """Lines of the code fence starting at lines[i] == '```'; returns (text, next index)."""
    assert lines[i].startswith('```'), lines[i]
    j = i + 1
    body = []
    while not lines[j].startswith('```'):
        body.append(lines[j])
        j += 1
    return ''.join(l + '\n' for l in body), j + 1


def expectations(text):
    return [[m.group(1), json.loads(m.group(2))]
            for m in re.finditer(r'`([^`]+)` = `([^`]*)`', text)]


def main(spec, out):
    lines = open(spec, encoding='utf-8').read().split('\n')
    echo = None
    for i, l in enumerate(lines):
        if l.startswith('### `fixtures/echo.mjs`'):
            echo, _ = fence(lines, i + 2)
    cases = []
    req = None
    i = 0
    while i < len(lines):
        l = lines[i]
        m = re.match(r'\*\*((?:REQ|OPEN)-[A-Z]+-\d+)\.\*\*', l)
        if m:
            req = m.group(1)
        m = re.match(r'Example (\d+): `(\w+)` with input `(.*)` and these texts:$', l)
        if m:
            inp = json.loads(m.group(3))
            files = dict(inp.get('files', {}))
            i += 1
            while not lines[i].startswith('⟶'):
                fm = re.match(r'`input\.files\.(".*")`:(.*)$', lines[i])
                if fm:
                    name = json.loads(fm.group(1))
                    if fm.group(2).strip():
                        assert 'fixtures/echo.mjs' in fm.group(2)
                        files[name] = echo
                    else:
                        text, i = fence(lines, i + 2)
                        files[name] = text
                        continue
                i += 1
            inp['files'] = files
            cases.append({'req': req, 'name': 'Example ' + m.group(1), 'op': m.group(2),
                          'input': inp, 'expect': expectations(lines[i])})
            i += 1
            continue
        if l.startswith('- '):
            m = re.match(r'- (the request line )?`(.*?)`(?: \(no `(\w+)` member\))? ⟶ (.*)$', l)
            if m:
                exp = expectations(m.group(4))
                if m.group(1):
                    cases.append({'req': req, 'name': l[:40], 'line': m.group(2), 'expect': exp})
                else:
                    body = m.group(2)
                    op, _, js = body.partition(' ')
                    r = {'id': 't', 'op': op}
                    if js:
                        r['input'] = json.loads(js)
                    elif not m.group(3):
                        r['input'] = {}
                    if m.group(3):
                        r.pop(m.group(3), None)
                    cases.append({'req': req, 'name': l[:40], 'request': r, 'expect': exp})
        i += 1
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(cases, f, ensure_ascii=True, indent=0)
    print(len(cases), 'examples')


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'SPEC.md'),
         sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, 'spec_examples.json'))
