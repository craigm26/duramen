import { readFileSync } from 'node:fs';
import { analyze, requestLine } from '../src/checker.ts';

const examples = JSON.parse(readFileSync(new URL('../test/spec-examples.json', import.meta.url), 'utf8'));
const e = examples.find((x: { name: string }) => x.name.startsWith(process.argv[2]));
const a = analyze(e.request.input.files, e.request.input.entry);
const ops = new Map(a.rec!.ops.map((o) => [o.name, o]));
for (const r of a.rec!.reqs) for (const ex of r.examples) {
  console.log(ex.caseId, requestLine(ex, a.rec!, ops), JSON.stringify(a.responses.get(ex)));
}
