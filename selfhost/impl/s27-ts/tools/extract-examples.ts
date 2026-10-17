// Turns the examples of SPEC.md into tests/fixtures/spec-examples.json, which
// tests/spec-examples.test.ts replays. Run: node tools/extract-examples.ts

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = readFileSync(join(root, 'SPEC.md'), 'utf8').split('\n');

// the shared fixture
let echo = '';
{
  const at = spec.findIndex((l) => l.startsWith('### `fixtures/echo.mjs`'));
  const open = spec.findIndex((l, i) => i > at && l.startsWith('```'));
  const close = spec.findIndex((l, i) => i > open && l.startsWith('```'));
  echo = spec.slice(open + 1, close).join('\n') + '\n';
}

type Expectation = { path: string; value: any };
type Case = { name: string; req?: string; line?: string; op?: string; input?: any; noInput?: boolean; noId?: boolean; expects: Expectation[] };
const cases: Case[] = [];

function expectations(s: string): Expectation[] {
  const out: Expectation[] = [];
  const re = /`([^`]+)` = `([^`]*)`/g;
  let m;
  while ((m = re.exec(s))) out.push({ path: m[1], value: JSON.parse(m[2]) });
  return out;
}

let current = '';
for (let i = 0; i < spec.length; i++) {
  const l = spec[i];
  const h = /^\*\*(REQ-[A-Z]+-\d+|OPEN-[A-Z]+-\d+)\./.exec(l);
  if (h) current = h[1];

  // Example N: `op` with input `{...}` and these texts:
  const e = /^Example (\d+): `(\w+)` with input `([\s\S]*)` and these texts:$/.exec(l);
  if (e) {
    const input = JSON.parse(e[3]);
    const files: Record<string, string> = input.files ?? {};
    let j = i + 1;
    let expects: Expectation[] = [];
    while (j < spec.length) {
      const f = /^`input\.files\.(".*")`:(.*)$/.exec(spec[j]);
      if (f) {
        const name = JSON.parse(f[1]);
        if (f[2].includes('fixtures/echo.mjs')) files[name] = echo;
        else {
          const close = spec.findIndex((x, k) => k > j + 2 && x.startsWith('```'));
          files[name] = spec.slice(j + 3, close).join('\n') + '\n';
          j = close;
        }
      } else if (spec[j].startsWith('⟶ ')) {
        expects = expectations(spec[j]);
        break;
      }
      j++;
    }
    input.files = files;
    cases.push({ name: `${current} example ${e[1]}`, req: current, op: e[2], input, expects });
    continue;
  }

  // bullets with a request on one line
  let b = /^- the request line `([\s\S]*)` ⟶ ([\s\S]*)$/.exec(l);
  if (b) {
    cases.push({ name: `${current} line ${i + 1}`, req: current, line: b[1], expects: expectations(b[2]) });
    continue;
  }
  b = /^- `(\w+)(?: ([\s\S]*?))?`(?: \(no `(\w+)` member\))? ⟶ ([\s\S]*)$/.exec(l);
  if (b) {
    const c: Case = { name: `${current} line ${i + 1}`, req: current, op: b[1], expects: expectations(b[4]) };
    if (b[3] === 'input') c.noInput = true;
    else if (b[2] !== undefined) c.input = JSON.parse(b[2]);
    if (b[3] === 'id') c.noId = true;
    cases.push(c);
    continue;
  }

  // judge tables: | case | answer | error | / | case | answer | result.pass | result.failed |
  if (/^\| case \| answer \| /.test(l)) {
    const head = l.split('|').slice(1, -1).map((x) => x.trim());
    for (let k = i + 2; k < spec.length && spec[k].startsWith('|'); k++) {
      const cells = spec[k].split('|').slice(1, -1).map((x) => x.trim());
      const val = (c: string) => JSON.parse(c.replace(/^`|`$/g, ''));
      const exp: Expectation[] = [];
      for (let c = 2; c < head.length; c++) if (cells[c]) exp.push({ path: head[c] === 'error' ? 'error' : head[c], value: val(cells[c]) });
      cases.push({
        name: `${current} table row ${k + 1}`,
        req: current,
        op: 'judge',
        input: { case: val(cells[0]), answer: val(cells[1]) },
        expects: exp,
      });
    }
  }
}

mkdirSync(join(root, 'tests', 'fixtures'), { recursive: true });
writeFileSync(join(root, 'tests', 'fixtures', 'spec-examples.json'), JSON.stringify(cases, null, 1));
console.log(cases.length + ' examples');
