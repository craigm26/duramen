// Extracts the examples of SPEC.md into test/spec-examples.json.
// Usage: node tools/extract-examples.ts
import { readFileSync, writeFileSync } from 'node:fs';

const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
const lines = spec.split('\n');

const echoStart = lines.findIndex((l) => l === '### `fixtures/echo.mjs`');
const echo: string[] = [];
for (let i = echoStart + 3; lines[i] !== '```'; i++) echo.push(lines[i]);
const echoText = echo.join('\n') + '\n';

interface Assertion {
  path: string;
  value: unknown;
}
interface Example {
  name: string;
  request: { id: string; op: string; input: unknown };
  assertions: Assertion[];
}
const out: Example[] = [];
let section = '';

function assertionsOf(s: string): Assertion[] {
  const res: Assertion[] = [];
  for (const m of s.matchAll(/`([^`]+)` = `([^`]*)`/g)) res.push({ path: m[1], value: JSON.parse(m[2]) });
  return res;
}

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  const h = /^\*\*(REQ-[A-Z]+-\d+)\./.exec(l);
  if (h) section = h[1];
  let m = /^(?:Example (\d+): )?`(check|cases|judge)` with input `(.*)` and these texts:$/.exec(l);
  if (m) {
    const input = JSON.parse(m[3]) as Record<string, unknown>;
    const files: Record<string, string> = { ...((input.files as Record<string, string>) ?? {}) };
    let j = i + 1;
    for (;;) {
      while (lines[j] === '') j++;
      const f = /^`input\.files\.(".*")`:(.*)$/.exec(lines[j]);
      if (!f) break;
      const name = JSON.parse(f[1]) as string;
      if (f[2].includes('fixtures/echo.mjs')) {
        files[name] = echoText;
        j++;
        continue;
      }
      j += 3; // blank line, then the fence
      const body: string[] = [];
      while (lines[j] !== '```') body.push(lines[j++]);
      j++;
      files[name] = body.length === 0 ? '' : body.join('\n') + '\n';
    }
    while (lines[j] === '') j++;
    if (lines[j].startsWith('⟶ ')) {
      out.push({
        name: `${section} ${m[1] ? 'example ' + m[1] : 'inline'} (line ${i + 1})`,
        request: { id: 'x' + out.length, op: m[2], input: { ...input, files } },
        assertions: assertionsOf(lines[j]),
      });
    }
    continue;
  }
  m = /^- `(check|cases|judge) (\{.*?\})`(?: \(.*?\))? ⟶ (.*)$/.exec(l);
  if (m && !m[3].includes('`id` =')) {
    out.push({
      name: `${section} bullet (line ${i + 1})`,
      request: { id: 'x' + out.length, op: m[1], input: JSON.parse(m[2]) },
      assertions: assertionsOf(m[3]),
    });
    continue;
  }
  // tables of judge requests
  if (/^\| case \| answer \| (error|result\.pass \| result\.failed) \|$/.test(l)) {
    const withError = l.endsWith('| error |');
    for (let j = i + 2; lines[j]?.startsWith('| '); j++) {
      const cells = lines[j].slice(2, -2).split(' | ').map((c) => c.replace(/^`|`$/g, ''));
      const assertions: Assertion[] = [];
      if (withError) assertions.push({ path: 'error', value: JSON.parse(cells[2]) });
      else {
        assertions.push({ path: 'result.pass', value: JSON.parse(cells[2]) });
        if (cells[3]) assertions.push({ path: 'result.failed', value: JSON.parse(cells[3]) });
      }
      out.push({
        name: `${section} table row (line ${j + 1})`,
        request: { id: 'x' + out.length, op: 'judge', input: { case: JSON.parse(cells[0]), answer: JSON.parse(cells[1]) } },
        assertions,
      });
    }
  }
}

writeFileSync(new URL('../test/spec-examples.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`${out.length} examples`);
