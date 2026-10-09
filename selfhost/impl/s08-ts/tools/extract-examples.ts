// Reads SPEC.md and writes tests/spec-examples.json (the examples of the specification, as cases)
// and fixtures/echo.mjs (the oracle under Files). Usage: node tools/extract-examples.ts
import * as fs from 'node:fs';

const spec = fs.readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8').split('\n');

interface Case { req: string; name: string; line: string; expect: [string, unknown][] }
const cases: Case[] = [];
let echo = '';

function readFence(i: number): { text: string; next: number } {
  // spec[i] is the opening fence
  const body: string[] = [];
  let j = i + 1;
  while (j < spec.length && spec[j] !== '```') body.push(spec[j++]);
  return { text: body.length ? body.join('\n') + '\n' : '', next: j + 1 };
}

function expectations(s: string): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const m of s.matchAll(/`([^`]+)` = `([^`]*)`/g)) out.push([m[1], JSON.parse(m[2])]);
  return out;
}

let req = '';
for (let i = 0; i < spec.length; i++) {
  const l = spec[i];
  let m = /^\*\*((?:REQ|OPEN)-[A-Z]+-\d+)\./.exec(l);
  if (m) { req = m[1]; continue; }
  if (l === '### `fixtures/echo.mjs`') {
    echo = readFence(i + 2).text;
    continue;
  }
  m = /^Example (\d+): `(\w+)` with input `(.*)` and these texts:$/.exec(l);
  if (m) {
    const input = JSON.parse(m[3]);
    const files: Record<string, string> = {};
    let j = i + 1;
    let echoNames: string[] = [];
    for (; j < spec.length && !spec[j].startsWith('⟶'); j++) {
      const f = /^`input\.files\.(".*")`:\s*(.*)$/.exec(spec[j]);
      if (!f) continue;
      const name = JSON.parse(f[1]);
      if (f[2].startsWith('the file `fixtures/echo.mjs`')) { echoNames.push(name); continue; }
      let k = j + 1;
      while (spec[k] !== '```') k++;
      const fence = readFence(k);
      files[name] = fence.text;
      j = fence.next - 1;
    }
    cases.push({
      req, name: `${req} example ${m[1]}`, line: JSON.stringify({ id: 't', op: m[2], input: { ...input, files: { ...(input.files ?? {}), ...files, ...Object.fromEntries(echoNames.map((n) => [n, '@echo'])) } } }),
      expect: expectations(spec[j]),
    });
    i = j;
    continue;
  }
  m = /^- (?:the request line )?`([^`]*)`(.*?)⟶ (.*)$/.exec(l);
  if (m) {
    const note = m[2];
    let line: string;
    if (l.startsWith('- the request line')) line = m[1];
    else {
      const [op, ...rest] = m[1].split(' ');
      const r: Record<string, unknown> = { id: 't', op };
      if (rest.length > 0 && !note.includes('no `input` member')) r.input = JSON.parse(rest.join(' '));
      if (note.includes('no `id` member')) delete r.id;
      line = JSON.stringify(r);
    }
    cases.push({ req, name: `${req} bullet ${cases.length}`, line, expect: expectations(m[3]) });
  }
}

fs.mkdirSync(new URL('../fixtures/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../fixtures/echo.mjs', import.meta.url), echo);
fs.writeFileSync(new URL('../tests/spec-examples.json', import.meta.url), JSON.stringify(cases, null, 1));
console.log(`${cases.length} cases`);
