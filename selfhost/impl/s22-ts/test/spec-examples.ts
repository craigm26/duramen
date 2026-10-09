// Reads the examples out of SPEC.md, so that every example in it is a test.

import { readFileSync } from 'node:fs';

export interface SpecExample {
  /** The requirement or section the example is under. */
  where: string;
  title: string;
  /** The request line sent. */
  line: string;
  /** Path in the response, and the JSON value expected there. */
  asserts: [string, unknown][];
}

const ECHO_NOTE = /^`input\.files\.("(?:[^"\\]|\\.)*")`: the file `fixtures\/echo\.mjs`, shown under Files at the end\.$/;
const FILE_HEAD = /^`input\.files\.("(?:[^"\\]|\\.)*")`:$/;

function parseAsserts(text: string): [string, unknown][] {
  const out: [string, unknown][] = [];
  const re = /`([^`]+)` = `(.*?)`(?=; `|$)/g;
  for (const m of text.matchAll(re)) out.push([m[1], JSON.parse(m[2])]);
  if (out.length === 0) throw new Error(`no assertions in: ${text}`);
  return out;
}

export function loadSpec(specPath: string, echo: string): { examples: SpecExample[]; echoInSpec: string } {
  const lines = readFileSync(specPath, 'utf8').split('\n');
  const examples: SpecExample[] = [];
  let where = 'Interface';
  let n = 0;
  const id = () => `ex-${++n}`;
  let echoInSpec = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const head = /^\*\*((?:REQ|OPEN)-[A-Z]+-\d+)\.\*\*/.exec(l);
    if (head) where = head[1];
    if (l === '### `fixtures/echo.mjs`') {
      const start = lines.indexOf('```', i) + 1;
      const end = lines.indexOf('```', start);
      echoInSpec = lines.slice(start, end).join('\n') + '\n';
      break;
    }
    const exA = /^Example (\d+): `(\w+)` with input `(.*)` and these texts:$/.exec(l);
    if (exA) {
      const input = JSON.parse(exA[3]);
      input.files ??= {};
      let j = i + 1;
      for (; !lines[j].startsWith('⟶'); j++) {
        const echoNote = ECHO_NOTE.exec(lines[j]);
        if (echoNote) {
          input.files[JSON.parse(echoNote[1])] = echo;
          continue;
        }
        const fh = FILE_HEAD.exec(lines[j]);
        if (fh) {
          const start = j + 2;
          if (lines[start] !== '```') throw new Error(`expected a code block at line ${start + 1}`);
          const end = lines.indexOf('```', start + 1);
          input.files[JSON.parse(fh[1])] = lines.slice(start + 1, end).map((x) => x + '\n').join('');
          j = end;
        }
      }
      examples.push({
        where,
        title: `${where} Example ${exA[1]}`,
        line: JSON.stringify({ id: id(), op: exA[2], input }),
        asserts: parseAsserts(lines[j].slice(2)),
      });
      i = j;
      continue;
    }
    const rawLine = /^- the request line `(.*?)` ⟶ (.*)$/.exec(l);
    if (rawLine) {
      examples.push({ where, title: `${where} ${l.slice(2)}`, line: rawLine[1], asserts: parseAsserts(rawLine[2]) });
      continue;
    }
    const bullet = /^- `(\w+)(?: (.*?))?`(?: \(no `(\w+)` member\))? ⟶ (.*)$/.exec(l);
    if (bullet) {
      const req: { [k: string]: unknown } = { id: id(), op: bullet[1] };
      if (bullet[2] !== undefined) req.input = JSON.parse(bullet[2]);
      if (bullet[3]) delete req[bullet[3]];
      examples.push({ where, title: `${where} ${l.slice(2, 120)}`, line: JSON.stringify(req), asserts: parseAsserts(bullet[4]) });
      continue;
    }
    if (l.startsWith('| case | answer |')) {
      const cols = l.split('|').slice(1, -1).map((c) => c.trim());
      let j = i + 2;
      for (; lines[j].startsWith('|'); j++) {
        const cells = lines[j].split(' | ').map((c) => c.replace(/^\|\s*/, '').replace(/\s*\|$/, '').trim());
        const value = (k: number) => JSON.parse(cells[k].slice(1, -1));
        const asserts: [string, unknown][] = [];
        for (let k = 2; k < cols.length; k++) if (cells[k] !== '') asserts.push([cols[k], value(k)]);
        examples.push({
          where,
          title: `${where} table row ${j + 1}`,
          line: JSON.stringify({ id: id(), op: 'judge', input: { case: value(0), answer: value(1) } }),
          asserts,
        });
      }
      i = j;
    }
  }
  return { examples, echoInSpec };
}

export function at(value: unknown, path: string): unknown {
  let cur = value;
  for (const name of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as { [k: string]: unknown })[name];
  }
  return cur;
}
