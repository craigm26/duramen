// Claim 8 of CONFIDENCE-2.md, for one round of builds: which builds are checkers, the mutated
// records the checkers do not all answer alike (splits), and the same records between two builds
// with duramen out of the loop.
//
//   node selfhost/converge.mjs <round> <implementation folder> ... [--out <file.json>] [--mutants 1500] [--cache <dir>]
//
// - A build is a checker when it passes every case of the suite of spec/ (`duramen run`) and is
//   a fixed point (fixedpoint.mjs).
// - Every build answers `check` and `cases` for the mutated records of agree.mjs, three seeds of
//   1,500 (4,500 records), and for the suite's own unmutated records, which each seed sends again.
//   A record splits when a checker's answer to either request differs from duramen's, as JSON
//   values: with every checker compared with duramen, that is exactly "not all checkers answer
//   alike".
// - Every pair of checkers is compared with duramen out of the loop (agree.mjs --against).
// Whether a split is declared (an open item of the round's brief covers it) is decided by reading
// it; this writes what is needed to read it: each difference's signature and first examples.
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SEEDS = [1, 2, 3];

// With --cache <dir>, each answer is kept in <dir>/<key>.json and read from there on a later run
// (one folder per round: the keys name builds, not the duramen they were compared with).
let CACHE = null;
function json(key, args) {
  const file = CACHE && join(CACHE, `${key}.json`);
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });
  let v;
  try { v = JSON.parse(r.stdout); } catch { return { error: `exit ${r.status}: ${(r.stderr || r.stdout).slice(-1000)}` }; }
  if (file) writeFileSync(file, JSON.stringify(v) + '\n');
  return v;
}

// A request id names its record: `<mutant>:<op>` under a seed, or `seed<k>:<op>` for the suite's
// own record k, the same under every seed.
const recordOf = (seed, id) => { const k = id.split(':')[0]; return k.startsWith('seed') ? k : `${seed}/${k}`; };

async function main(argv) {
  const valueOf = (f) => { const k = argv.indexOf(f); return k >= 0 ? argv[k + 1] : null; };
  const out = valueOf('--out') ? resolve(valueOf('--out')) : null;
  const MUTANTS = Number(valueOf('--mutants') ?? 1500);
  if (valueOf('--cache')) { CACHE = resolve(valueOf('--cache')); mkdirSync(CACHE, { recursive: true }); }
  const [round, ...dirs] = argv.filter((a, k) => !a.startsWith('--') && !['--out', '--mutants', '--cache'].includes(argv[k - 1]));
  if (!round || !dirs.length) { console.error('usage: node selfhost/converge.mjs <round> <implementation folder> ... [--out <file.json>] [--mutants 1500] [--cache <dir>]'); return 2; }
  const builds = [];
  for (const dir of dirs.map((d) => resolve(d))) {
    const name = basename(dir);
    const run = json(`${name}-suite`, ['bin/duramen.mjs', 'run', 'spec/', '--impl', dir, '--json']);
    const fp = json(`${name}-fixedpoint`, ['selfhost/fixedpoint.mjs', dir, '--json']);
    const suite = run.run ? { passed: run.run.passed, total: run.run.total } : { error: run.error ?? 'no result' };
    const b = { name, dir, suite, fixedPoint: fp.fixedPoint === true, fixedPointText: fp.comparisons?.['C(D1, D1)']?.sameText === true };
    b.checker = !!run.run && run.run.passed === run.run.total && b.fixedPoint;
    b.seeds = [];
    for (const s of SEEDS) {
      const a = json(`${name}-seed${s}-${MUTANTS}`, ['selfhost/agree.mjs', dir, '--mutants', String(MUTANTS), '--seed', String(s), '--json']);
      b.seeds.push({ seed: s, requests: a.requests, same: a.same, differ: a.differ, records: [...new Set((a.differing ?? []).map((id) => recordOf(s, id)))], groups: (a.groups ?? []).map((g) => ({ signature: g.signature, count: g.count, examples: g.examples })), error: a.error });
      process.stderr.write(`${round} ${name} seed ${s}: ${a.same ?? '?'} of ${a.requests ?? '?'} alike with duramen\n`);
    }
    builds.push(b);
    process.stderr.write(`${round} ${name}: suite ${suite.passed ?? '-'}/${suite.total ?? '-'}, fixed point ${b.fixedPoint ? 'yes' : 'no'}, checker ${b.checker ? 'yes' : 'no'}\n`);
  }
  const checkers = builds.filter((b) => b.checker);
  const split = new Map();
  for (const b of checkers) for (const s of b.seeds) for (const r of s.records) split.set(r, [...(split.get(r) ?? []), b.name]);
  const pairs = [];
  for (let i = 0; i < checkers.length; i++) {
    for (let j = i + 1; j < checkers.length; j++) {
      const p = { a: checkers[i].name, b: checkers[j].name, seeds: [] };
      for (const s of SEEDS) {
        const r = json(`${checkers[i].name}--${checkers[j].name}-seed${s}-${MUTANTS}`, ['selfhost/agree.mjs', checkers[j].dir, '--against', checkers[i].dir, '--mutants', String(MUTANTS), '--seed', String(s), '--json']);
        p.seeds.push({ seed: s, requests: r.requests, same: r.same, differ: r.differ, records: [...new Set((r.differing ?? []).map((id) => recordOf(s, id)))], groups: (r.groups ?? []).map((g) => ({ signature: g.signature, count: g.count, examples: g.examples })), error: r.error });
      }
      p.records = [...new Set(p.seeds.flatMap((s) => s.records))];
      pairs.push(p);
      process.stderr.write(`${round} ${p.a} and ${p.b}, duramen out of the loop: ${p.records.length} records answered differently\n`);
    }
  }
  const mutated = [...split.keys()].filter((r) => !r.startsWith('seed'));
  const report = {
    round, mutantsPerSeed: MUTANTS, seeds: SEEDS,
    builds: builds.map(({ seeds, ...b }) => ({ ...b, differ: seeds.map((s) => ({ seed: s.seed, requests: s.requests, same: s.same, records: s.records.length })) })),
    checkers: checkers.map((b) => b.name),
    splits: { records: split.size, mutated: mutated.length, unmutated: split.size - mutated.length, list: [...split].map(([r, by]) => ({ record: r, by })) },
    pairs: pairs.map(({ seeds, ...p }) => ({ ...p, differ: seeds.map((s) => ({ seed: s.seed, requests: s.requests, same: s.same, records: s.records.length })) })),
    detail: { builds: builds.map((b) => ({ name: b.name, seeds: b.seeds })), pairs: pairs.map((p) => ({ a: p.a, b: p.b, seeds: p.seeds })) },
  };
  const text = JSON.stringify(report, null, 1) + '\n';
  if (out) writeFileSync(out, text); else process.stdout.write(text);
  process.stderr.write(`${round}: ${checkers.length} checkers besides duramen; ${split.size} records split (${mutated.length} mutated, ${split.size - mutated.length} unmutated)\n`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
