import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, handleLine } from './driver.ts';

// These are executable assertions written against the three supplied source documents.
// Loading the examples directly prevents transcription from weakening their exact text checks.
const specification = fs.readFileSync(new URL('./SPEC.md', import.meta.url), 'utf8');
const lines = specification.split('\n');
const fixture = specification.slice(specification.indexOf('### `fixtures/echo.mjs`')).split('```')[1].replace(/^\n/, '');
type ExampleTest = { name: string; req: string; request?: any; raw?: string; expectations: [string, any][] };
const examples: ExampleTest[] = [];
let req = '', current: ExampleTest | undefined;
function expectations(text: string): [string, any][] {
  return [...text.matchAll(/`([^`]+)` = `([^`]+)`/g)].map(match => [match[1], JSON.parse(match[2])]);
}
function at(value: any, path: string): any {
  return path.split('.').reduce((v, k) => v?.[k], value);
}
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const heading = /^\*\*(REQ-[A-Z]+-\d+)\./.exec(line);
  if (heading) { req = heading[1]; current = undefined; }
  const start = /^Example (\d+): `(check|cases)` with input `([\s\S]*)` and these texts:/.exec(line);
  if (start) {
    current = { req, name: `${req} example ${start[1]}`, request: { id: 'test', op: start[2], input: JSON.parse(start[3]) }, expectations: [] };
    examples.push(current); continue;
  }
  const file = /^`input\.files\.("(?:[^"\\]|\\.)*")`:/.exec(line);
  if (file && current) {
    const name = JSON.parse(file[1]);
    current.request.input.files ??= {};
    if (line.includes('the file `fixtures/echo.mjs`')) current.request.input.files[name] = fixture;
    else {
      while (lines[++i] !== '```') assert.ok(i < lines.length, 'unclosed source fixture');
      const text: string[] = [];
      while (lines[++i] !== '```') { assert.ok(i < lines.length); text.push(lines[i]); }
      current.request.input.files[name] = text.join('\n') + '\n';
    }
    continue;
  }
  if (line.startsWith('⟶') && current) { current.expectations.push(...expectations(line)); current = undefined; continue; }
  if (line.startsWith('- ') && line.includes(' ⟶ ')) {
    const [left, right] = line.slice(2).split(' ⟶ ');
    let example: ExampleTest | undefined;
    const raw = /^the request line `([\s\S]*)`$/.exec(left);
    if (raw) example = { req, name: `${req} line ${i + 1}`, raw: raw[1], expectations: expectations(right) };
    else {
      const request = /^`([a-z]+)(?: ([\s\S]*?))?`/.exec(left);
      if (request) {
        const value: any = { id: 'test', op: request[1] };
        if (request[2] !== undefined) value.input = JSON.parse(request[2]);
        if (left.includes('(no `id` member)')) delete value.id;
        example = { req, name: `${req} line ${i + 1}`, request: value, expectations: expectations(right) };
      }
    }
    assert.ok(example, `unhandled example on line ${i + 1}`);
    examples.push(example);
  }
  if (req === 'REQ-JU-001' && line.startsWith('| `')) {
    const row = [...line.matchAll(/`([^`]+)`/g)].map(m => JSON.parse(m[1]));
    assert.equal(row.length, 3);
    examples.push({ req, name: `${req} validation row ${i + 1}`, request: { id: 'test', op: 'judge', input: { case: row[0], answer: row[1] } }, expectations: [['error', row[2]]] });
  }
}
for (const example of examples) test(example.name, () => {
  assert.ok(example.expectations.length, 'every extracted example must assert something');
  const response = example.raw === undefined ? handle(example.request) : handleLine(example.raw);
  for (const [path, expected] of example.expectations) assert.deepEqual(at(response, path), expected, path);
  if (response?.result?.diagnostics) {
    assert.equal(response.result.errors, response.result.diagnostics.filter((d: string) => d.includes(': error ')).length);
    assert.equal(response.result.warnings, response.result.diagnostics.filter((d: string) => d.includes(': warning ')).length);
  }
  if (response?.result?.cases?.length) {
    for (const c of response.result.cases) assert.equal(handle({ id: 'judge', op: 'judge', input: { case: c, answer: null } }).result.pass, false);
  }
});
test('the executable source examples cover every REQ and therefore every MUST section', () => {
  assert.equal(fs.readFileSync(new URL('./fixtures/echo.mjs', import.meta.url), 'utf8'), fixture);
  const requirements = [...specification.matchAll(/^\*\*(REQ-[A-Z]+-\d+)\./gm)].map(m => m[1]);
  assert.ok(examples.length >= 200);
  for (const requirement of requirements) assert.ok(examples.some(e => e.req === requirement), requirement);
});
