import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { handle, handleLine } from './core.ts';

// Turn the specification's published claims into independent regression tests.
// These fixtures are used only by tests; the implementation never reads SPEC.md.
const source = readFileSync(new URL('./SPEC.md', import.meta.url), 'utf8');
const lines = source.split('\n');
const fixture = source.slice(source.indexOf('### `fixtures/echo.mjs`')).split('```')[1].replace(/^\n/, '');
let requirement = '', serial = 0;
const covered = new Set<string>();

function assertions(text: string): [string, any][] {
  return [...text.matchAll(/`((?:result|error|id)(?:\.[^`]*)?)` = `([^`]*)`/g)].map(m => [m[1], JSON.parse(m[2])]);
}
function verify(title: string, response: any, expected: [string, any][]): void {
  assert.ok(expected.length, 'No expectations extracted from ' + title);
  for (const [path, value] of expected) {
    const actual = path.split('.').reduce((value, key) => value?.[key], response);
    assert.deepEqual(actual, value, path);
  }
}

for (let i = 0; i < lines.length; i++) {
  const req = /^\*\*(REQ-[A-Z]+-\d+)\./.exec(lines[i]);
  if (req) requirement = req[1];
  const example = /^Example (\d+): `(check|cases)` with input `([\s\S]*)` and these texts:/.exec(lines[i]);
  if (example) {
    const start = i;
    const input = JSON.parse(example[3]);
    input.files ??= {};
    let expected: [string, any][] = [];
    for (i++; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('⟶')) { expected = assertions(line); break; }
      const file = /^`input\.files\.("[\s\S]*")`:([\s\S]*)/.exec(line);
      if (!file) continue;
      const name = JSON.parse(file[1]);
      if (file[2].includes('the file `fixtures/echo.mjs`')) { input.files[name] = fixture; continue; }
      while (++i < lines.length && lines[i] !== '```') {}
      const text: string[] = [];
      while (++i < lines.length && lines[i] !== '```') text.push(lines[i]);
      input.files[name] = text.join('\n') + '\n';
    }
    const title = `${requirement} published example ${example[1]} (line ${start + 1})`;
    const op = example[2];
    covered.add(requirement);
    test(title, () => verify(title, handle({ id: 'test', op, input }), expected));
    continue;
  }
  if (lines[i].startsWith('- ') && lines[i].includes('⟶')) {
    const text = lines[i], first = /`([^`]*)`/.exec(text);
    if (!first) continue;
    let request: any, raw: string | undefined;
    if (text.startsWith('- the request line ')) raw = first[1];
    else {
      const m = /^(check|cases|judge|lint)(?:\s+([\s\S]+))?$/.exec(first[1]);
      if (!m) continue;
      request = { id: 'test', op: m[1] };
      if (m[2]) request.input = JSON.parse(m[2]);
      if (text.includes('(no `id` member)')) delete request.id;
    }
    const expected = assertions(text.slice(text.indexOf('⟶')));
    const title = `${requirement} published inline ${++serial} (line ${i + 1})`;
    covered.add(requirement);
    test(title, () => verify(title, raw === undefined ? handle(request) : handleLine(raw), expected));
  }
  if (/^\| case \| answer \|/.test(lines[i])) {
    const headers = lines[i].split('|').slice(1, -1).map(s => s.trim());
    i++;
    while (i + 1 < lines.length && lines[i + 1].startsWith('|')) {
      const row = lines[++i].split('|').slice(1, -1).map(s => s.trim().replace(/^`|`$/g, ''));
      const input = { case: JSON.parse(row[0]), answer: JSON.parse(row[1]) };
      const expected: [string, any][] = headers.slice(2).flatMap((h, n) => row[n + 2] ? [[h, JSON.parse(row[n + 2])] as [string, any]] : []);
      const title = `${requirement} published judge row (line ${i + 1})`;
      covered.add(requirement);
      test(title, () => verify(title, handle({ id: 'test', op: 'judge', input }), expected));
    }
  }
}

test('Every normative requirement has executable published regression coverage', () => {
  const ids = [...source.matchAll(/^\*\*(REQ-[A-Z]+-\d+)\./gm)].map(m => m[1]);
  assert.deepEqual(ids.filter(id => !covered.has(id)), []);
});
