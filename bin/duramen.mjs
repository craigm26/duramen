#!/usr/bin/env node
// duramen check <spec.duramen>                      check the spec, run its examples through the oracle
// duramen build <spec.duramen> [--out <dir>]        check, then write SPEC.md, DECISIONS.md, trace.md, cases.jsonl
// duramen run <spec.duramen> --impl <dir>           check, then run the generated suite against an implementation
//           [--driver "<command>" --cwd <dir>]  (or name the driver command directly)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { parse } from '../src/parse.mjs';
import { check } from '../src/check.mjs';
import { renderSpec, renderDecisions, renderTrace } from '../src/render.mjs';
import { generateCases, runCases } from '../src/suite.mjs';
import { implDriver } from '../src/driver.mjs';

const VERSION = '0.1.0';
const [cmd, file, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const usage = () => { console.error('usage: duramen check|build|run <spec.duramen> [--out dir] [--impl dir | --driver "cmd" --cwd dir]'); process.exit(2); };
if (!['check', 'build', 'run'].includes(cmd) || !file) usage();

const path = resolve(file);
let source;
try { source = readFileSync(path, 'utf8'); } catch (e) { console.error(`duramen: ${e.message}`); process.exit(2); }
const { ast, diagnostics: parseDs } = parse(source, path);
const { diagnostics: checkDs, oracle } = parseDs.some((d) => d.level === 'error') ? { diagnostics: [], oracle: null } : await check(ast);
const ds = [...parseDs, ...checkDs].sort((a, b) => a.line - b.line);
const rel = file;
for (const d of ds) console.log(`${rel}:${d.line}: ${d.level} ${d.code}: ${d.message}`);
const errors = ds.filter((d) => d.level === 'error').length;
const reqs = ast.items.filter((i) => i.type === 'req');
const examples = reqs.reduce((n, r) => n + r.examples.length, 0);
console.log(`${errors ? 'FAILED' : 'ok'}: ${reqs.length} requirements, ${examples} examples, ${ast.decisions.length} decisions, ${ast.items.filter((i) => i.type === 'open').length} open, ${ast.edges.length} edges; ${errors} errors, ${ds.filter((d) => d.level === 'warning').length} warnings`);
if (errors) process.exit(1);
if (cmd === 'check') process.exit(0);

const cases = generateCases(ast, oracle);
if (cmd === 'build') {
  const out = resolve(opt('--out') ?? join(dirname(path), 'build'));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'SPEC.md'), renderSpec(ast, oracle, { version: VERSION }));
  writeFileSync(join(out, 'DECISIONS.md'), renderDecisions(ast));
  writeFileSync(join(out, 'trace.md'), renderTrace(ast, cases));
  writeFileSync(join(out, 'cases.jsonl'), cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
  console.log(`wrote SPEC.md, DECISIONS.md, trace.md and cases.jsonl (${cases.length} cases) to ${out}`);
  process.exit(0);
}

// run
const impl = opt('--impl');
const command = opt('--driver') ?? (impl ? implDriver(resolve(impl)) : usage());
const cwd = resolve(opt('--cwd') ?? impl ?? '.');
const r = await runCases(cases, { command, cwd });
if (r.driverError) console.log(`driver: ${r.driverError}${r.stderr ? `\n${r.stderr.trim()}` : ''}`);
for (const f of r.failures) console.log(`  FAIL ${f.id} [${f.reqs.join(', ')}]\n      ${f.why.join('\n      ')}`);
console.log(`passed ${r.passed}/${r.total}${r.skipped ? ` (skipped ${r.skipped} for this platform)` : ''}`);
process.exit(r.failures.length || r.driverError ? 1 : 0);
