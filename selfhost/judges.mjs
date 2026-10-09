// Can a rebuilt judge take duramen's place in running a suite? (CONFIDENCE.md, claim 4)
//
//   node selfhost/judges.mjs <spec folder> --answers <build> [...] --judge <build> [...] [--json]
//
// 1. The suite of <spec folder>, as duramen writes it (its oracle pointed at duramen).
// 2. Every answering build's answer to every case of that suite, collected once, as `duramen
//    run` collects them: one run of the driver for the cases matched by `id`, and one run for
//    each case sent alone. A case with no answer is judged with `null`.
// 3. duramen's verdict on each answer (the comparison `duramen run` uses), and each judge
//    build's, from its `judge` operation. The two are compared: pass or fail, and the parts
//    that failed.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { D0, implementation, withOracle, casesOf } from './fixedpoint.mjs';
import { runDriver } from '../src/driver.mjs';
import { judgeAnswer } from '../src/suite.mjs';

const platformOk = (p) => !p || p === 'any' || (p === 'posix') === (process.platform !== 'win32');

function filesOf(dir) {
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

const finite = (v) => (typeof v === 'number' ? Number.isFinite(v) : v === null || typeof v !== 'object' ? true : Object.values(v).every(finite));

// Every case's answer from one build, as `duramen run` collects them.
async function answersOf(build, cases) {
  const driverCases = cases.filter((c) => (c.kind ?? 'example') === 'example' && platformOk(c.platform));
  const out = new Map();
  const batch = driverCases.filter((c) => !c.solo);
  const r = await runDriver(build.command, ['', ' \t ', ...batch.map((c) => c.line)], { cwd: build.cwd, timeoutMs: 300_000 });
  for (const c of batch) out.set(c.id, r.responses.get(c.id) ?? null);
  for (const c of driverCases.filter((x) => x.solo)) {
    const s = await runDriver(build.command, [c.line], { cwd: build.cwd, timeoutMs: 60_000 });
    out.set(c.id, s.list.length === 1 && s.list[0] ? s.list[0] : null);
  }
  return out;
}

async function judgeAll(judge, items) {
  const out = new Map();
  for (let k = 0; k < items.length; k += 200) {
    const part = items.slice(k, k + 200);
    const lines = part.map((it) => JSON.stringify({ id: it.key, op: 'judge', input: { case: { checks: it.c.checks, full: it.c.full }, answer: it.answer } }));
    const r = await runDriver(judge.command, lines, { cwd: judge.cwd, timeoutMs: 300_000 });
    for (const it of part) out.set(it.key, r.responses.get(it.key) ?? null);
  }
  return out;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main(argv) {
  const json = argv.includes('--json');
  const list = (flag) => { const out = []; let on = false; for (const a of argv) { if (a.startsWith('--')) on = a === flag; else if (on) out.push(a); } return out; };
  const specDir = argv[0];
  const answerers = list('--answers'), judges = list('--judge');
  if (!specDir || specDir.startsWith('--') || !answerers.length || !judges.length) { console.error('usage: node selfhost/judges.mjs <spec folder> --answers <build> [...] --judge <build> [...] [--json]'); return 2; }
  const suite = await casesOf(D0, withOracle(filesOf(resolve(specDir)), D0));
  if (suite.error) { console.error(`no suite: ${suite.error}`); return 1; }
  const cases = suite.result.cases;
  const items = [];
  const perBuild = [];
  for (const dir of answerers) {
    const answers = await answersOf(implementation(dir), cases);
    let passed = 0, total = 0, unfit = 0;
    for (const [id, answer] of answers) {
      const c = cases.find((x) => x.id === id);
      if (answer && !finite(answer)) { unfit++; continue; } // OPEN-JU-002: not sent to a judge
      const failed = judgeAnswer(c, answer);
      total++; if (!failed.length) passed++;
      items.push({ key: `${dir}|${id}`, build: dir, c, answer, d0: failed.length ? { pass: false, failed } : { pass: true } });
    }
    perBuild.push({ build: dir, passed, total, unfit });
  }
  const report = { suite: specDir, cases: cases.length, answers: items.length, builds: perBuild, judges: [] };
  for (const dir of judges) {
    const verdicts = await judgeAll(implementation(dir), items);
    const differ = [];
    let noVerdict = 0, sameVerdict = 0, sameParts = 0;
    for (const it of items) {
      const r = verdicts.get(it.key);
      if (!r || !r.result) { noVerdict++; if (differ.length < 20) differ.push({ key: it.key, duramen: it.d0, judge: r }); continue; }
      if (r.result.pass === it.d0.pass) sameVerdict++;
      if (same(r.result, it.d0)) sameParts++;
      else if (differ.length < 20) differ.push({ key: it.key, duramen: it.d0, judge: r.result });
    }
    report.judges.push({ judge: dir, judged: items.length, sameVerdict, sameParts, noVerdict, differences: differ });
  }
  if (json) { console.log(JSON.stringify(report, null, 1)); return 0; }
  console.log(`${report.cases} cases of ${specDir}; ${report.answers} answers from ${answerers.length} builds`);
  for (const b of perBuild) console.log(`  ${b.build}: duramen passes ${b.passed}/${b.total}${b.unfit ? ` (${b.unfit} answers with numbers too large for binary64 left out)` : ''}`);
  for (const j of report.judges) {
    console.log(`${j.judge}: the same verdict as duramen on ${j.sameVerdict}/${j.judged}, the same failed parts on ${j.sameParts}/${j.judged}${j.noVerdict ? `, no verdict on ${j.noVerdict}` : ''}`);
    for (const d of j.differences.slice(0, 10)) console.log(`    ${d.key}: duramen ${JSON.stringify(d.duramen)}, judge ${JSON.stringify(d.judge)}`);
  }
  return 0;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
