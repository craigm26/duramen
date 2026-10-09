// Extracts the examples of SPEC.md as request lines and expectations, for the tests.
// Usage: node tools/extract-examples.ts SPEC.md tests/spec-examples.json

import { readFileSync, writeFileSync } from 'node:fs';

export interface SpecExample {
  req: string;
  name: string;
  line: string;
  expect: [string, unknown][];
}

export function extract(spec: string): SpecExample[] {
  const lines = spec.split('\n');
  const fixtures = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const m = /^### `(fixtures\/[^`]+)`$/.exec(lines[i]);
    if (m) fixtures.set(m[1], block(lines, i + 1).text);
  }
  const out: SpecExample[] = [];
  let req = '';
  let n = 0;
  const id = () => `t${++n}`;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^\*\*((?:REQ|OPEN)-[A-Z]+-\d+)\.\*\*/.exec(line);
    if (h) req = h[1];
    const ex = /^(Example \d+): `(\w+)` with input `(.*)` and these texts:$/.exec(line);
    if (ex) {
      const input = JSON.parse(ex[3]);
      input.files = { ...(input.files ?? {}) };
      let j = i + 1;
      for (; !lines[j].startsWith('⟶'); j++) {
        const f = /^`input\.files\.("(?:[^"\\]|\\.)*")`:(.*)$/.exec(lines[j]);
        if (!f) continue;
        const name = JSON.parse(f[1]);
        const fx = /the file `([^`]+)`/.exec(f[2]);
        if (fx) input.files[name] = fixtures.get(fx[1]);
        else {
          const b = block(lines, j + 1);
          input.files[name] = b.text;
          j = b.end;
        }
      }
      const reqId = id();
      out.push({
        req, name: `${req} ${ex[1]}`, line: JSON.stringify({ id: reqId, op: ex[2], input }), expect: expectations(lines[j]),
      });
      i = j;
      continue;
    }
    const raw = /^- the request line `(.*)` ⟶ (.*)$/.exec(line);
    if (raw) {
      out.push({ req, name: `${req} line ${raw[1]}`, line: raw[1], expect: expectations('⟶ ' + raw[2]) });
      continue;
    }
    const bullet = /^- `(\w+)(?: (.*?))?`( \(no `(id|input)` member\))? ⟶ (.*)$/.exec(line);
    if (bullet) {
      const request: { [k: string]: unknown } = { op: bullet[1] };
      if (bullet[4] !== 'id') request.id = id();
      if (bullet[2] !== undefined) request.input = JSON.parse(bullet[2]);
      out.push({ req, name: `${req} ${line.slice(2, 80)}`, line: JSON.stringify(request), expect: expectations('⟶ ' + bullet[5]) });
    }
  }
  return out;
}

function block(lines: string[], from: number): { text: string; end: number } {
  let i = from;
  while (lines[i] !== '```') i++;
  const start = i + 1;
  i = start;
  while (lines[i] !== '```') i++;
  return { text: lines.slice(start, i).map((l) => l + '\n').join(''), end: i };
}

function expectations(line: string): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const m of line.matchAll(/`([^`]+)` = `([^`]*)`/g)) out.push([m[1], JSON.parse(m[2])]);
  if (out.length === 0) throw new Error(`no expectations in: ${line}`);
  return out;
}

if (import.meta.filename === process.argv[1]) {
  const [from, to] = process.argv.slice(2);
  const examples = extract(readFileSync(from, 'utf8'));
  writeFileSync(to, JSON.stringify(examples, null, 1) + '\n');
  console.log(`${examples.length} examples written to ${to}`);
}
