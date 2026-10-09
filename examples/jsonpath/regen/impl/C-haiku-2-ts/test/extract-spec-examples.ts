// Reads the example tables of SPEC.md and writes them to test/fixtures/spec-examples.json, which
// the tests run through the driver. Run it with: node test/extract-spec-examples.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

interface Example {
  section: string; // the requirement, evidence or property the table belongs to
  line: number; // line in SPEC.md of the row
  request: Record<string, unknown>; // query and document, where the row states them
  expect: { error?: string; values?: unknown[]; paths?: string[] };
}

const EXAMPLE_COLUMNS = ['query', 'document', 'error', 'result.values', 'result.paths'];
const lines = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8').split('\n');
const examples: Example[] = [];
let section = 'none';

for (let i = 0; i < lines.length; i++) {
  const heading = /^\*\*((?:REQ|EV|PROP|OPEN)-[A-Za-z0-9-]+)\.\*\*/.exec(lines[i]);
  if (heading) section = heading[1];
  // A table: a header row, a separator row, then rows that start with |.
  if (!lines[i].startsWith('|') || !/^\|(\s*:?-+:?\s*\|)+\s*$/.test(lines[i + 1] ?? '')) continue;
  const header = cells(lines[i]);
  if (!header.some((column) => EXAMPLE_COLUMNS.includes(column))) continue; // e.g. the operations table
  let j = i + 2;
  for (; j < lines.length && lines[j].startsWith('|'); j++) {
    try {
      examples.push(toExample(section, j + 1, header, cells(lines[j])));
    } catch (error) {
      throw new Error(`SPEC.md line ${j + 1}: ${(error as Error).message}`);
    }
  }
  i = j - 1;
}

const counts = new Map<string, number>();
for (const ex of examples) counts.set(ex.section, (counts.get(ex.section) ?? 0) + 1);

mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
writeFileSync(new URL('./fixtures/spec-examples.json', import.meta.url), `${JSON.stringify(examples, null, 1)}\n`);
console.log(`${examples.length} rows in ${counts.size} sections`);

// The cells of a table row. An escaped \| is a pipe inside a cell.
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

// A cell holds JSON in a code span. An empty cell states nothing.
function parseCell(cell: string): unknown {
  const inner = cell.startsWith('`') && cell.endsWith('`') ? cell.slice(1, -1) : cell;
  return JSON.parse(inner);
}

function toExample(sectionName: string, line: number, header: string[], row: string[]): Example {
  const request: Record<string, unknown> = {};
  const expect: Example['expect'] = {};
  header.forEach((column, k) => {
    const cell = row[k] ?? '';
    if (cell === '') return;
    const value = parseCell(cell);
    if (column === 'query' || column === 'document') request[column] = value;
    else if (column === 'error') expect.error = value as string;
    else if (column === 'result.values') expect.values = value as unknown[];
    else if (column === 'result.paths') expect.paths = value as string[];
  });
  return { section: sectionName, line, request, expect };
}
