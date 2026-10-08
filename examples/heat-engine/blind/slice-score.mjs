// Scores an implementation of the heat-engine slice with regen-heat-engine's hand-built suite,
// counting only the cases in the slice's scope:
//   - every case whose request is for wetBulb, wetBulbF, flagF, flagC or canonical;
//   - every error case whose request names no operation of the full spec, or is not a request
//     at all (malformed lines, missing or unknown ops);
//   - the stream and static checks (bytes, order, exit status, REGEN.json, budgets).
// Out of scope: cases for workRest, verdict and cascade, which the slice does not have.
//
//   node slice-score.mjs --impl <dir> --suite <regen-heat-engine>/.regenerate/suite [--json out.json]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const IMPL = resolve(opt('--impl') ?? ''), SUITE = resolve(opt('--suite') ?? '');
if (!opt('--impl') || !opt('--suite')) { console.error('usage: slice-score.mjs --impl <dir> --suite <suite dir> [--json out.json]'); process.exit(2); }

const SLICE = new Set(['wetBulb', 'wetBulbF', 'flagF', 'flagC', 'canonical']);
const OTHER = new Set(['workRest', 'verdict', 'cascade']);
const { buildCases } = await import(pathToFileURL(join(SUITE, 'cases.mjs')).href);
const opOf = (c) => {
  if (c.line === undefined) return undefined;
  if (typeof c.line === 'object') return c.line.op;
  try { return JSON.parse(c.line)?.op; } catch { return undefined; }
};
const inScope = (c) => {
  if (c.check.kind === 'stdout' || c.check.kind === 'static') return true;
  const op = opOf(c);
  return SLICE.has(op) || !OTHER.has(op);
};
const cases = buildCases();
const scope = new Set(cases.filter(inScope).map((c) => c.id));

const tmp = mkdtempSync(join(tmpdir(), 'slice-score-'));
const rep = join(tmp, 'suite.json');
const r = spawnSync(process.execPath, [join(SUITE, 'run.mjs'), '--impl', IMPL, '--json', rep], { encoding: 'utf8', timeout: 1800000 });
const report = JSON.parse(readFileSync(rep, 'utf8'));
const failing = report.failing.filter((f) => scope.has(f.case));
const out = {
  impl: IMPL, total_cases: cases.length, in_scope: scope.size,
  passed: scope.size - failing.length, failing: failing.map((f) => ({ case: f.case, reqs: f.reqs, why: f.why ?? f.detail ?? f.message })),
  out_of_scope_failing: report.failing.length - failing.length,
  full_run: { passed: report.passed, total: report.total },
};
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify(out, null, 1));
console.log(`hand-built suite, slice scope: passed ${out.passed}/${out.in_scope} (whole suite ${report.passed}/${report.total}; ${out.out_of_scope_failing} failing cases are outside the slice)`);
for (const f of out.failing) console.log(`  FAIL ${f.case} [${f.reqs.join(', ')}]`);
if (r.status === null) console.log(r.stderr);
