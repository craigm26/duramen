// Claim 7's agreement measure (CONFIDENCE-2.md). Each build answers the 6,000 requests of
// generate.mjs (seeds 1 to 3, 2,000 each). Two builds agree on a request when both answer
// `invalid_query`, or both answer a nodelist with the same (path, value) pairs, counted with
// multiplicity and in any order; values compare as JSON values (member order aside, numbers by
// value). Anything else (no answer, another error, a result of the wrong shape) agrees with no
// build on that request.
//
//   node examples/jsonpath/agreement.mjs <impl dir> ... [--oracle] [--out <file.json>]
//
// Requests go to a build's driver 250 at a time; when a driver stops early, each request it left
// unanswered is sent again on its own, so one crash costs one request, not the rest of a batch.
import { writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { generate } from './generate.mjs';
import { runDriver, implDriver } from '../../src/driver.mjs';

const SEEDS = [1, 2, 3];
const N = 2000;
const BATCH = 250;

const canonical = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
};

// An answer as a key two agreeing answers share, or null when it agrees with nothing.
export function answerKey(resp) {
  if (resp === null || typeof resp !== 'object') return null;
  if (Object.hasOwn(resp, 'error')) return resp.error === 'invalid_query' && !Object.hasOwn(resp, 'result') ? 'E' : null;
  const r = resp.result;
  if (r === null || typeof r !== 'object' || !Array.isArray(r.values) || !Array.isArray(r.paths)) return null;
  if (r.values.length !== r.paths.length || !r.paths.every((p) => typeof p === 'string')) return null;
  return `R${r.paths.map((p, k) => `${JSON.stringify(p)}=${canonical(r.values[k])}`).sort().join('\n')}`;
}

export const requests = () => SEEDS.flatMap((s) => generate(s, N));

const line = (i, r) => JSON.stringify({ id: `q${i}`, op: 'query', input: { query: r.query, document: r.document } });

export async function answers(command, cwd, reqs) {
  const out = new Array(reqs.length).fill(null);
  let retried = 0;
  for (let b = 0; b < reqs.length; b += BATCH) {
    const chunk = reqs.slice(b, b + BATCH);
    const run = await runDriver(command, chunk.map((r, k) => line(b + k, r)), { cwd, timeoutMs: 60_000, perLineMs: 200 });
    const missing = [];
    chunk.forEach((_, k) => { const resp = run.responses.get(`q${b + k}`); if (resp) out[b + k] = resp; else missing.push(b + k); });
    for (const i of missing) {
      retried++;
      const one = await runDriver(command, [line(i, reqs[i])], { cwd, timeoutMs: 10_000 });
      out[i] = one.responses.get(`q${i}`) ?? null;
    }
  }
  return { out, retried };
}

async function main(argv) {
  const dirs = argv.filter((a, k) => !a.startsWith('--') && argv[k - 1] !== '--out').map((d) => resolve(d));
  const outFile = argv.includes('--out') ? resolve(argv[argv.indexOf('--out') + 1]) : null;
  const subjects = dirs.map((d) => ({ name: basename(d), dir: d, ...implDriver(d) }));
  if (argv.includes('--oracle')) subjects.push({ name: 'oracle', dir: import.meta.dirname, command: 'node driver.mjs' });
  const reqs = requests();
  const keys = [];
  const builds = [];
  for (const s of subjects) {
    if (s.error) { builds.push({ name: s.name, error: s.error, answered: 0 }); keys.push(new Array(reqs.length).fill(null)); continue; }
    const t0 = Date.now();
    const { out, retried } = await answers(s.command, s.dir, reqs);
    const k = out.map(answerKey);
    keys.push(k);
    builds.push({ name: s.name, answered: k.filter((x) => x !== null).length, invalid: k.filter((x) => x === 'E').length, retried, seconds: Math.round((Date.now() - t0) / 1000) });
    process.stderr.write(`${s.name}: ${builds.at(-1).answered} of ${reqs.length} answered, ${builds.at(-1).invalid} invalid_query, ${retried} sent again alone\n`);
  }
  const pairs = [];
  for (let i = 0; i < subjects.length; i++) {
    for (let j = i + 1; j < subjects.length; j++) {
      let agree = 0;
      for (let k = 0; k < reqs.length; k++) if (keys[i][k] !== null && keys[i][k] === keys[j][k]) agree++;
      pairs.push({ a: subjects[i].name, b: subjects[j].name, agree, of: reqs.length });
    }
  }
  const report = { requests: reqs.length, seeds: SEEDS, builds, pairs };
  if (outFile) writeFileSync(outFile, JSON.stringify(report, null, 1) + '\n');
  else process.stdout.write(JSON.stringify(report, null, 1) + '\n');
  return 0;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) process.exitCode = await main(process.argv.slice(2));
