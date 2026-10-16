// One round of round three's loop (CONFIDENCE-3.md, R5), with every judgment made by the two
// regenerated builds, A and B:
//   1. each build writes the suite of spec/ (a `cases` request holding spec/'s files) with itself
//      as the record's oracle, and the two suites are compared as JSON values;
//   2. each build answers every case of both suites, and both builds' `judge` rule on every pair
//      of a case and an answer (a case passes only if both judges pass it);
//   3. A, B and duramen answer `check` and `cases` for the mutated records of seeds 1 to 3 (made by
//      duramen's `mutate` in agree.mjs, which writes inputs and rules on nothing) and every probe
//      record in the files given.
// Requests go through runner.mjs, which pairs responses by request id and rules on nothing.
// duramen appears only as a third subject in step 3, for R9; it judges nothing.
//
//   node selfhost/loop/round.mjs --a <build> --b <build> --out <dir> [--probes <file> ...]
//        [--mutants 1500] [--seeds 1,2,3] [--steps 1,2,3] [--spec <folder>]
//
// --spec names the record steps 1 and 2 use (spec/ by default); the mutated records of step 3 are
// always made from this repository's spec/, as agree.mjs makes them, so run a round with spec/ at
// the round's version.
//
// Everything sent and every answer is written under --out, so the round can be checked and rerun.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { driverOf, absoluteCommand, answerById, answerAlone, rawSession, canon } from './runner.mjs';
import { seeds, mutate } from '../agree.mjs';
import { makeRng } from '../../src/types.mjs';
import { readProbes } from '../probe.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SPEC = join(ROOT, 'spec');
const log = (s) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${s}\n`);

// Every file of spec/ (records and fixtures), as a request's `files`.
export function specFiles(dir = SPEC) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'build') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[relative(dir, p).split('\\').join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

// spec/ with its `oracle` statement pointed at a command.
export function withOracle(files, command) {
  const out = { ...files };
  const keys = Object.keys(out).filter((k) => k.endsWith('.duramen') && /^oracle\s/m.test(out[k]));
  if (keys.length !== 1) throw new Error(`expected one oracle statement in spec/, found ${keys.length}`);
  out[keys[0]] = out[keys[0]].replace(/^oracle .*$/m, `oracle ${command}`);
  return out;
}

const writeJson = (file, v) => writeFileSync(file, `${JSON.stringify(v, null, 1)}\n`);
const writeGz = (file, rows) => writeFileSync(file, gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'));
const readGz = (file) => gunzipSync(readFileSync(file)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const isSuite = (r) => r && typeof r === 'object' && typeof r.errors === 'number' && Array.isArray(r.cases)
  && r.cases.every((c) => c && typeof c === 'object' && !Array.isArray(c) && typeof c.id === 'string' && typeof c.line === 'string');

// Where two suites differ, for reading: case IDs, then each member that differs.
function suiteDifferences(a, b) {
  const out = [];
  if (a.errors !== b.errors) out.push(`errors: ${a.errors} vs ${b.errors}`);
  const ia = new Map(a.cases.map((c) => [c.id, c]));
  const ib = new Map(b.cases.map((c) => [c.id, c]));
  for (const id of ia.keys()) if (!ib.has(id)) out.push(`${id}: only in A's suite`);
  for (const id of ib.keys()) if (!ia.has(id)) out.push(`${id}: only in B's suite`);
  const order = (s, other) => s.cases.map((c) => c.id).filter((id) => other.has(id)).join('\n');
  if (order(a, ib) !== order(b, ia)) out.push('the cases they share are in a different order');
  for (const [id, ca] of ia) {
    const cb = ib.get(id);
    if (!cb) continue;
    for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
      if (canon(ca[k]) !== canon(cb[k])) out.push(`${id}.${k}: A ${JSON.stringify(ca[k])?.slice(0, 400)} | B ${JSON.stringify(cb[k])?.slice(0, 400)}`);
    }
  }
  return out;
}

// The id a request line carries, if it is a JSON object with a string id.
const lineId = (line) => {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' && !Array.isArray(v) && typeof v.id === 'string' ? v.id : null;
  } catch {
    return null;
  }
};

// A build's answers to every case of a suite: solo cases and lines without an id alone, the
// others by id.
async function answerSuite(driver, suite) {
  const byId = [];
  const solo = [];
  for (const c of suite.cases) {
    const id = lineId(c.line);
    if (c.solo === true || id === null) solo.push(c);
    else byId.push({ key: c.id, id, line: c.line });
  }
  const out = await answerById(driver, byId, { timeoutMs: 600_000 });
  for (const c of solo) out.set(c.id, await answerAlone(driver, c.line, { timeoutMs: 600_000 }));
  return Object.fromEntries(suite.cases.map((c) => [c.id, out.get(c.id)]));
}

async function judgeAll(driver, suite, answers) {
  const reqs = suite.cases.map((c, n) => ({ key: c.id, id: `j${n}`, line: JSON.stringify({ id: `j${n}`, op: 'judge', input: { case: c, answer: answers[c.id]?.answer ?? null } }) }));
  const out = await answerById(driver, reqs, { timeoutMs: 600_000 });
  return Object.fromEntries(suite.cases.map((c) => [c.id, out.get(c.id)?.answer ?? null]));
}

// The inputs of step 3: mutated records (as agree.mjs and claim 8 make them), the suite's own
// unmutated records, and probe records.
export function step3Inputs(seedList, count, probeFiles) {
  const all = seeds();
  const inputs = [];
  for (const s of seedList) {
    const rng = makeRng(s).next;
    const mutants = Array.from({ length: count }, () => mutate(all[Math.floor(rng() * all.length)], all, rng));
    mutants.forEach((m, k) => {
      for (const op of ['check', 'cases']) inputs.push({ key: `seed${s}/m${k}:${op}`, kind: 'mutant', from: m.from, mutation: m.mutation, request: { op, input: { files: m.files, entry: m.entry } } });
    });
  }
  all.forEach((x, k) => { for (const op of ['check', 'cases']) inputs.push({ key: `unmutated/${k}:${op}`, kind: 'unmutated', from: x.from, request: { op, input: { files: x.files, entry: x.entry } } }); });
  for (const f of probeFiles) {
    const name = basename(f).replace(/\.txt$/, '');
    readProbes(readFileSync(f, 'utf8')).forEach((p, i) => {
      const key = `probe/${name}/${i}`;
      if (p.op === 'raw') inputs.push({ key, kind: 'probe', file: name, name: p.name, raw: p.raw });
      else inputs.push({ key, kind: 'probe', file: name, name: p.name, request: { op: p.op, input: p.input ?? { files: p.files, entry: '.' } } });
    });
  }
  return inputs;
}

async function answerInputs(driver, inputs) {
  const reqs = [];
  const out = new Map();
  inputs.forEach((x, n) => { if (x.request) reqs.push({ key: x.key, id: `q${n}`, line: JSON.stringify({ id: `q${n}`, ...x.request }) }); });
  const got = await answerById(driver, reqs, { timeoutMs: 600_000 });
  for (const [k, v] of got) out.set(k, v.answer);
  for (const x of inputs) if (x.raw) out.set(x.key, await rawSession(driver, x.raw));
  return out;
}

const diagCodes = (resp) => (Array.isArray(resp?.result?.diagnostics) ? resp.result.diagnostics : []).map((d) => (typeof d === 'string' ? d.replace(/^.*: (error|warning|info) /, '$1 ') : JSON.stringify(d)));
// A short name for how two answers differ, to group differences for reading.
function signature(x, a, b) {
  if (x.kind === 'probe') return `probe ${x.file}: ${x.name}`;
  const op = x.request.op;
  if (op === 'cases') return a?.result?.errors !== b?.result?.errors ? `cases: errors ${a?.result?.errors} vs ${b?.result?.errors}` : 'cases: the suites differ';
  if (!a?.result || !b?.result) return `check: ${JSON.stringify(a?.error ?? null)} vs ${JSON.stringify(b?.error ?? null)}`;
  const ca = diagCodes(a);
  const cb = diagCodes(b);
  const only = (p, q) => { const left = [...q]; return p.filter((c) => { const i = left.indexOf(c); if (i < 0) return true; left.splice(i, 1); return false; }); };
  const plus = only(ca, cb);
  const minus = only(cb, ca);
  if (!plus.length && !minus.length) return 'check: same codes, different files or lines';
  return `check: ${plus.join(', ') || '-'} | ${minus.join(', ') || '-'}`;
}

function compareSubjects(inputs, left, right, names) {
  const groups = new Map();
  const keys = [];
  for (const x of inputs) {
    const a = left.get(x.key) ?? null;
    const b = right.get(x.key) ?? null;
    if (canon(a) === canon(b)) continue;
    keys.push(x.key);
    const sig = signature(x, a, b);
    const g = groups.get(sig) ?? { signature: sig, count: 0, keys: [], examples: [] };
    g.count++;
    g.keys.push(x.key);
    if (g.examples.length < 3) g.examples.push({ key: x.key, from: x.from, mutation: x.mutation, name: x.name, request: x.request ?? { raw: x.raw }, [names[0]]: a, [names[1]]: b });
    groups.set(sig, g);
  }
  return { differ: keys.length, of: inputs.length, groups: [...groups.values()].sort((p, q) => q.count - p.count) };
}

async function main(argv) {
  const values = (f) => argv.flatMap((a, k) => (a === f ? [argv[k + 1]] : []));
  const value = (f, d) => values(f)[0] ?? d;
  const out = resolve(value('--out'));
  const builds = { A: resolve(value('--a')), B: resolve(value('--b')) };
  const steps = value('--steps', '1,2,3').split(',').map(Number);
  const count = Number(value('--mutants', '1500'));
  const seedList = value('--seeds', '1,2,3').split(',').map(Number);
  const probeFiles = values('--probes').map((f) => resolve(f));
  mkdirSync(out, { recursive: true });
  const drivers = { A: driverOf(builds.A), B: driverOf(builds.B) };
  const files = specFiles(value('--spec') ? resolve(value('--spec')) : SPEC);
  const report = existsSync(join(out, 'report.json')) ? JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) : {};
  report.builds = Object.fromEntries(Object.entries(builds).map(([k, d]) => [k, { dir: relative(ROOT, d), driver: drivers[k].command }]));
  report.spec = Object.keys(files).sort();

  // 1. The suites.
  let suites = existsSync(join(out, 'suites.json')) ? JSON.parse(readFileSync(join(out, 'suites.json'), 'utf8')) : null;
  if (steps.includes(1)) {
    suites = { requests: {}, answers: {} };
    for (const X of ['A', 'B']) {
      const line = JSON.stringify({ id: 'suite', op: 'cases', input: { files: withOracle(files, absoluteCommand(drivers[X])), entry: '.' } });
      suites.requests[X] = line;
      const t0 = Date.now();
      const r = await answerById(drivers[X], [{ key: 'suite', id: 'suite', line }], { timeoutMs: 1_800_000 });
      suites.answers[X] = r.get('suite');
      log(`step 1: ${X} wrote ${isSuite(suites.answers[X]?.answer?.result) ? `${suites.answers[X].answer.result.cases.length} cases` : 'no suite'} in ${Math.round((Date.now() - t0) / 1000)} s`);
    }
    writeJson(join(out, 'suites.json'), suites);
  }
  const S = { A: suites?.answers?.A?.answer?.result, B: suites?.answers?.B?.answer?.result };
  const valid = { A: isSuite(S.A), B: isSuite(S.B) };
  report.step1 = { valid, cases: { A: valid.A ? S.A.cases.length : null, B: valid.B ? S.B.cases.length : null }, errors: { A: valid.A ? S.A.errors : null, B: valid.B ? S.B.errors : null } };
  report.step1.equal = valid.A && valid.B && canon(S.A) === canon(S.B);
  report.step1.differences = valid.A && valid.B ? suiteDifferences(S.A, S.B) : ['a build wrote no suite'];

  // 2. Every case of both suites, answered by both builds and judged by both.
  if (steps.includes(2)) {
    const answers = {};
    const verdicts = {};
    for (const s of ['A', 'B']) {
      if (!valid[s]) continue;
      answers[s] = {};
      verdicts[s] = {};
      for (const X of ['A', 'B']) {
        answers[s][X] = await answerSuite(drivers[X], S[s]);
        verdicts[s][X] = {};
        for (const J of ['A', 'B']) verdicts[s][X][J] = await judgeAll(drivers[J], S[s], answers[s][X]);
        log(`step 2: ${X} answered ${s}'s suite; judged by A and B`);
      }
    }
    writeJson(join(out, 'answers-suites.json'), answers);
    writeJson(join(out, 'verdicts.json'), verdicts);
  }
  if (existsSync(join(out, 'verdicts.json'))) {
    const verdicts = JSON.parse(readFileSync(join(out, 'verdicts.json'), 'utf8'));
    report.step2 = {};
    for (const s of Object.keys(verdicts)) {
      for (const X of Object.keys(verdicts[s])) {
        const vA = verdicts[s][X].A;
        const vB = verdicts[s][X].B;
        const ids = Object.keys(vA);
        const failing = ids.filter((id) => !(vA[id]?.result?.pass === true && vB[id]?.result?.pass === true));
        const judgesDiffer = ids.filter((id) => canon(vA[id]) !== canon(vB[id]));
        report.step2[`${s}'s suite, ${X} answering`] = { cases: ids.length, passing: ids.length - failing.length, failing: failing.map((id) => ({ id, A: vA[id], B: vB[id] })), judgesDiffer: judgesDiffer.map((id) => ({ id, A: vA[id], B: vB[id] })) };
      }
    }
  }

  // 3. Mutated records and probes, answered by A, B and duramen.
  if (steps.includes(3)) {
    const inputs = step3Inputs(seedList, count, probeFiles);
    writeGz(join(out, 'step3-inputs.jsonl.gz'), inputs);
    const subjects = { A: drivers.A, B: drivers.B, duramen: { command: `node ${join(ROOT, 'bin', 'duramen.mjs')} serve`, cwd: ROOT } };
    for (const [name, d] of Object.entries(subjects)) {
      const file = join(out, `step3-${name}.jsonl.gz`);
      if (existsSync(file)) { log(`step 3: ${name}'s answers already in ${relative(ROOT, file)}`); continue; }
      const t0 = Date.now();
      const got = await answerInputs(d, inputs);
      writeGz(file, inputs.map((x) => ({ key: x.key, answer: got.get(x.key) ?? null })));
      log(`step 3: ${name} answered ${inputs.length} inputs in ${Math.round((Date.now() - t0) / 1000)} s`);
    }
  }
  if (existsSync(join(out, 'step3-inputs.jsonl.gz')) && ['A', 'B', 'duramen'].every((n) => existsSync(join(out, `step3-${n}.jsonl.gz`)))) {
    const inputs = readGz(join(out, 'step3-inputs.jsonl.gz'));
    const ans = Object.fromEntries(['A', 'B', 'duramen'].map((n) => [n, new Map(readGz(join(out, `step3-${n}.jsonl.gz`)).map((r) => [r.key, r.answer]))]));
    const kinds = (k) => inputs.filter((x) => x.kind === k).length;
    report.step3 = {
      inputs: { total: inputs.length, mutant: kinds('mutant'), unmutated: kinds('unmutated'), probe: kinds('probe') },
      AvsB: compareSubjects(inputs, ans.A, ans.B, ['A', 'B']),
      duramenVsA: compareSubjects(inputs, ans.duramen, ans.A, ['duramen', 'A']),
      duramenVsB: compareSubjects(inputs, ans.duramen, ans.B, ['duramen', 'B']),
    };
    const dA = new Set(report.step3.duramenVsA.groups.flatMap((g) => g.keys));
    const dB = new Set(report.step3.duramenVsB.groups.flatMap((g) => g.keys));
    report.step3.duramenDiffersFromBoth = inputs.filter((x) => dA.has(x.key) && dB.has(x.key) && canon(ans.A.get(x.key)) === canon(ans.B.get(x.key))).map((x) => x.key);
  }
  writeJson(join(out, 'report.json'), report);
  const s2 = Object.entries(report.step2 ?? {}).map(([k, v]) => `${k}: ${v.passing}/${v.cases}, judges differ on ${v.judgesDiffer.length}`).join('; ');
  log(`suites equal: ${report.step1.equal}; ${s2}; A and B differ on ${report.step3?.AvsB?.differ ?? '?'} of ${report.step3?.inputs?.total ?? '?'} inputs`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
}
