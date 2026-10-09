// Claim 7's judge (CONFIDENCE-2.md): the JSONPath Compliance Test Suite, run against each build
// (and the oracle) through its driver. Written before the suite was opened, from its README's
// description; CONFIDENCE-2.md's scoring rules:
// - a case that expects an invalid selector passes when the answer is the error `invalid_query`
//   (such a case gives no document, so the request carries `null`);
// - a case with one `result` passes when the answer's values equal it, in order, and its paths
//   equal the case's normalized paths when the case gives them;
// - a case with several acceptable `results` passes when the answer equals any one of them,
//   paths included when given.
// Values compare as JSON values: member order does not matter, and numbers compare by value.
//
//   node examples/jsonpath/judge-cts.mjs <cts.json> <impl dir> ... [--oracle] [--out <file.json>]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { implDriver } from '../../src/driver.mjs';
import { answers } from './agreement.mjs';

export function sameValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, k) => sameValue(x, b[k]));
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k]));
}

const samePaths = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((p, k) => p === b[k]);

// Whether an answer passes a case, and why not.
export function judge(c, resp) {
  if (resp === null || typeof resp !== 'object') return { pass: false, why: 'no answer' };
  if (c.invalid_selector) {
    return resp.error === 'invalid_query' && !Object.hasOwn(resp, 'result') ? { pass: true } : { pass: false, why: `expected invalid_query, got ${JSON.stringify(resp.result ?? resp.error).slice(0, 120)}` };
  }
  if (Object.hasOwn(resp, 'error')) return { pass: false, why: `error ${resp.error}` };
  const r = resp.result;
  if (r === null || typeof r !== 'object' || !Array.isArray(r.values)) return { pass: false, why: 'a result of the wrong shape' };
  const options = Object.hasOwn(c, 'result')
    ? [{ values: c.result, paths: c.result_paths }]
    : (c.results ?? []).map((v, k) => ({ values: v, paths: c.results_paths?.[k] }));
  if (!options.length) return { pass: false, why: 'the case states no result' };
  for (const o of options) if (sameValue(r.values, o.values) && (o.paths === undefined || samePaths(r.paths, o.paths))) return { pass: true };
  return { pass: false, why: `got ${JSON.stringify(r.values).slice(0, 120)} at ${JSON.stringify(r.paths).slice(0, 120)}` };
}

// A case's category: the part of its name before the first comma ("filter", "slice selector", ...).
const category = (name) => String(name ?? '').split(',')[0].trim() || '(none)';

async function main(argv) {
  const [ctsFile, ...rest] = argv;
  const dirs = rest.filter((a, k) => !a.startsWith('--') && rest[k - 1] !== '--out').map((d) => resolve(d));
  const outFile = rest.includes('--out') ? resolve(rest[rest.indexOf('--out') + 1]) : null;
  const cts = JSON.parse(readFileSync(ctsFile, 'utf8'));
  const cases = cts.tests ?? cts;
  const subjects = dirs.map((d) => ({ name: basename(d), dir: d, ...implDriver(d) }));
  if (rest.includes('--oracle')) subjects.push({ name: 'oracle', dir: import.meta.dirname, command: 'node driver.mjs' });
  const reqs = cases.map((c) => ({ query: c.selector, document: Object.hasOwn(c, 'document') ? c.document : null }));
  const report = { cases: cases.length, builds: [] };
  for (const s of subjects) {
    if (s.error) { report.builds.push({ name: s.name, error: s.error, passed: 0, failed: cases.length }); continue; }
    const { out, retried } = await answers(s.command, s.dir, reqs);
    const failures = [];
    out.forEach((resp, k) => { const v = judge(cases[k], resp); if (!v.pass) failures.push({ name: cases[k].name, category: category(cases[k].name), why: v.why }); });
    const byCategory = {};
    for (const f of failures) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    report.builds.push({ name: s.name, passed: cases.length - failures.length, failed: failures.length, retried, byCategory, failures });
    process.stderr.write(`${s.name}: passed ${cases.length - failures.length} of ${cases.length}\n`);
  }
  if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 1) + '\n');
  else process.stdout.write(JSON.stringify(report.builds.map(({ failures, ...b }) => b), null, 1) + '\n');
  return 0;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) process.exitCode = await main(process.argv.slice(2));
