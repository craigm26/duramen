// Extracts the examples of SPEC.md into test/spec-examples.json.
// Usage: node tools/extract-examples.mjs SPEC.md test/spec-examples.json
import { readFileSync, writeFileSync } from 'node:fs';

const [src, dst] = process.argv.slice(2);
const lines = readFileSync(src, 'utf8').split('\n');
const echo = (() => {
  const i = lines.findIndex((l) => l.startsWith('### `fixtures/echo.mjs`'));
  const start = lines.indexOf('```', i) + 1;
  const end = lines.indexOf('```', start);
  return lines.slice(start, end).join('\n') + '\n';
})();

function assertions(s) {
  const out = [];
  for (const m of s.matchAll(/`([^`]*)` = `([^`]*)`/g)) out.push({ path: m[1], value: JSON.parse(m[2]) });
  return out;
}

const examples = [];
let reqId = '';
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  const rm = /^\*\*(REQ-[A-Z]+-\d+)\.\*\*/.exec(l);
  if (rm) reqId = rm[1];
  const h = /^Example (\d+): `(\w+)` with input `(.*)` and these texts:$/.exec(l);
  if (h) {
    const input = JSON.parse(h[3]);
    const files = { ...(input.files ?? {}) };
    let j = i + 1;
    for (; j < lines.length && !lines[j].startsWith('⟶'); j++) {
      const f = /^`input\.files\.(".*")`:(.*)$/.exec(lines[j]);
      if (!f) continue;
      const name = JSON.parse(f[1]);
      if (f[2].includes('fixtures/echo.mjs')) files[name] = echo;
      else {
        const start = lines.indexOf('```', j + 1) + 1;
        const end = lines.indexOf('```', start);
        files[name] = lines.slice(start, end).join('\n') + '\n';
        j = end;
      }
    }
    input.files = files;
    examples.push({ req: reqId, name: `${reqId} example ${h[1]}`, op: h[2], input, expect: assertions(lines[j]) });
    continue;
  }
  const b = /^- `(check|cases|judge) ([^`]*)` ⟶ (.*)$/.exec(l);
  if (b) {
    examples.push({ req: reqId, name: `${reqId} bullet line ${i + 1}`, op: b[1], input: JSON.parse(b[2]), expect: assertions(b[3]) });
    continue;
  }
  if (l.startsWith('| `') && reqId.startsWith('REQ-JU')) {
    const cells = l.slice(2, -2).split(' | ').map((c) => c.trim().replace(/^`|`$/g, ''));
    if (reqId === 'REQ-JU-001') {
      examples.push({ req: reqId, name: `${reqId} row line ${i + 1}`, op: 'judge', input: { case: JSON.parse(cells[0]), answer: JSON.parse(cells[1]) }, expect: [{ path: 'error', value: JSON.parse(cells[2]) }] });
    } else {
      const expect = [{ path: 'result.pass', value: JSON.parse(cells[2]) }];
      if (cells[3]) expect.push({ path: 'result.failed', value: JSON.parse(cells[3]) });
      examples.push({ req: reqId, name: `${reqId} row line ${i + 1}`, op: 'judge', input: { case: JSON.parse(cells[0]), answer: JSON.parse(cells[1]) }, expect });
    }
  }
}
writeFileSync(dst, JSON.stringify(examples, null, 1) + '\n');
console.log(examples.length + ' examples');
