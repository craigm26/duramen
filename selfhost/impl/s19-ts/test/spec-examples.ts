// Extracts the examples of SPEC.md as requests and expectations, so that every example the
// specification states is a test.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface SpecExample {
  /** The requirement (or open item) the example sits under. */
  item: string;
  /** Where in SPEC.md the example starts. */
  at: number;
  /** The request line sent to the driver. */
  line: string;
  /** Paths in the response, with the JSON value each must hold. */
  expect: { path: string; value: unknown }[];
}

const spec = readFileSync(join(ROOT, 'SPEC.md'), 'utf8').split('\n');

function echoFixture(): string {
  const at = spec.indexOf('### `fixtures/echo.mjs`');
  const start = spec.indexOf('```', at) + 1;
  const end = spec.indexOf('```', start);
  return spec.slice(start, end).map((l) => l + '\n').join('');
}

export const ECHO = echoFixture();

function parseExpectations(text: string): { path: string; value: unknown }[] {
  const out: { path: string; value: unknown }[] = [];
  const re = /`([^`]*)` = `(.*?)`(?=; `|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ path: m[1], value: JSON.parse(m[2]) });
  if (out.length === 0) throw new Error(`no expectations in: ${text}`);
  return out;
}

let counter = 0;

function requestLine(op: string, input: unknown, omit?: string): string {
  const req: Record<string, unknown> = { id: `t${++counter}`, op };
  if (input !== undefined) req.input = input;
  if (omit === 'id') delete req.id;
  if (omit === 'input') delete req.input;
  return JSON.stringify(req);
}

function backquoted(cell: string): string | null {
  const t = cell.trim();
  if (t === '') return null;
  if (!t.startsWith('`') || !t.endsWith('`')) throw new Error(`cell not quoted: ${cell}`);
  return t.slice(1, -1);
}

export function specExamples(): SpecExample[] {
  const out: SpecExample[] = [];
  let item = '';
  for (let i = 0; i < spec.length; i++) {
    const line = spec[i];
    const head = /^\*\*((?:REQ|OPEN)-[A-Z]+-\d+)\.\*\*/.exec(line);
    if (head) item = head[1];
    if (line.startsWith('## Files')) break;

    const ex = /^Example \d+: `(\w+)` with input `(.*)` and these texts:$/.exec(line);
    if (ex) {
      const input = JSON.parse(ex[2]) as Record<string, unknown>;
      const files: Record<string, string> = { ...((input.files as Record<string, string>) ?? {}) };
      let j = i + 1;
      for (; !spec[j].startsWith('⟶ '); j++) {
        const f = /^`input\.files\.(".*")`:(.*)$/.exec(spec[j]);
        if (!f) continue;
        const name = JSON.parse(f[1]) as string;
        if (f[2].includes('fixtures/echo.mjs')) {
          files[name] = ECHO;
          continue;
        }
        const start = spec.indexOf('```', j) + 1;
        const end = spec.indexOf('```', start);
        files[name] = spec.slice(start, end).map((l) => l + '\n').join('');
        j = end;
      }
      out.push({
        item,
        at: i + 1,
        line: requestLine(ex[1], { ...input, files }),
        expect: parseExpectations(spec[j].slice(2)),
      });
      i = j;
      continue;
    }

    const rawLine = /^- the request line `(.*)` ⟶ (.*)$/.exec(line);
    if (rawLine) {
      out.push({ item, at: i + 1, line: rawLine[1], expect: parseExpectations(rawLine[2]) });
      continue;
    }

    const li = /^- `(\w+)(?: (.*?))?`(?: \(no `(\w+)` member\))? ⟶ (.*)$/.exec(line);
    if (li) {
      const input = li[2] === undefined ? undefined : JSON.parse(li[2]);
      out.push({ item, at: i + 1, line: requestLine(li[1], input, li[3]), expect: parseExpectations(li[4]) });
      continue;
    }

    if (/^\| case \| answer \|/.test(line)) {
      const cols = line.split('|').slice(1, -1).map((c) => c.trim());
      for (let j = i + 2; spec[j].startsWith('|'); j++) {
        const cells = spec[j].split('|').slice(1, -1).map(backquoted);
        const input = { case: JSON.parse(cells[0]!), answer: JSON.parse(cells[1]!) };
        const expect: { path: string; value: unknown }[] = [];
        for (let k = 2; k < cols.length; k++) {
          if (cells[k] !== null) expect.push({ path: cols[k], value: JSON.parse(cells[k]!) });
        }
        out.push({ item, at: j + 1, line: requestLine('judge', input), expect });
      }
    }
  }
  return out;
}

/** Reads a path such as `result.cases.0.id` in a response. */
export function at(value: unknown, path: string): unknown {
  let cur = value;
  for (const name of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[name];
  }
  return cur;
}
