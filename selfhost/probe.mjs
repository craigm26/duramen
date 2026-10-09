// Triage aid: send records written for a builder's choices to duramen and to blind builds, and
// show where their answers differ. A choice a builder recorded is a corner the brief left to
// it; a record that reaches that corner shows whether duramen, and the other builds, read it
// the same way.
//
//   node selfhost/probe.mjs <probes.txt> <implementation folder> [...] [--diff] [--json]
//
// probes.txt holds sections. Each starts with "=== <name>" and holds one record: the lines of
// a.duramen, then optionally "--- <file name>" lines that start other files of the request
// ("--- <file name> from <path>" takes the file from this repository, as it is).
// "@op cases" in a section asks for `cases` instead of `check`. Two other kinds of section:
// - "@input <JSON>" sends that object as the request's input instead of a record (with "@op
//   judge" for a judge request);
// - "@raw" sends, in a driver session of its own, the lines that follow, each written as a JSON
//   string (so that "\r" or "\u000b" can be one); its answer is every line the driver writes,
//   parsed, and its exit status.
// With --diff, only the sections whose answers differ are shown; with --json, every answer is
// written as JSON. Answers are compared as JSON values.
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runDriver } from '../src/driver.mjs';
import { D0, implementation } from './fixedpoint.mjs';

const ROOT = resolve(import.meta.dirname, '..');

export function readProbes(text) {
  const probes = [];
  for (const sec of text.split(/^=== /m).slice(1)) {
    const [head, ...rest] = sec.split('\n');
    let op = 'check';
    let input = null;
    let raw = null;
    const files = {};
    const loaded = new Set();
    let cur = 'a.duramen';
    for (const line of rest) {
      if (line.startsWith('@op ')) { op = line.slice(4).trim(); continue; }
      if (line.startsWith('@input ')) { input = JSON.parse(line.slice(7)); continue; }
      if (line.trim() === '@raw') { raw = []; continue; }
      if (raw) { if (line.trim() !== '') raw.push(JSON.parse(line)); continue; }
      const from = line.match(/^--- (.+) from (\S+)$/);
      if (from) { cur = null; files[from[1]] = readFileSync(join(ROOT, from[2]), 'utf8'); loaded.add(from[1]); continue; }
      const m = line.match(/^--- (.+)$/);
      if (m) { cur = m[1]; files[cur] = ''; continue; }
      if (cur === null) continue;
      files[cur] = (files[cur] ?? '') + line + '\n';
    }
    for (const k of Object.keys(files)) if (!loaded.has(k)) files[k] = files[k].replace(/\n+$/, '\n');
    probes.push(raw ? { name: head.trim(), op: 'raw', raw } : input ? { name: head.trim(), op, input } : { name: head.trim(), op, files });
  }
  return probes;
}

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

export async function probe(probes, drivers) {
  for (const d of drivers) {
    const lines = probes.map((p, i) => (p.raw ? null : JSON.stringify({ id: String(i), op: p.op, input: p.input ?? { files: p.files, entry: '.' } }))).filter((l) => l !== null);
    const r = await runDriver(d.command, lines, { cwd: d.cwd, timeoutMs: 300_000 });
    d.res = new Map(r.responses);
    for (const [i, p] of probes.entries()) {
      if (!p.raw) continue;
      const one = await runDriver(d.command, p.raw, { cwd: d.cwd, timeoutMs: 60_000 });
      const out = one.stdout.toString('utf8').split('\n').filter((l) => l.trim() !== '').map((l) => { try { return JSON.parse(l); } catch { return { text: l }; } });
      d.res.set(String(i), { exit: one.code, lines: out });
    }
  }
  return probes.map((p, i) => {
    const answers = drivers.map((d) => d.res.get(String(i)) ?? null);
    const same = answers.every((a) => canon(a) === canon(answers[0]));
    return { name: p.name, op: p.op, same, answers };
  });
}

const show = (x, op) => {
  if (!x) return 'no response';
  if (op === 'raw' || !x.result) return JSON.stringify(x);
  if (op === 'check') return x.result.diagnostics.join(' | ') || '(none)';
  return JSON.stringify(x.result).slice(0, 300);
};

async function main(argv) {
  const onlyDiff = argv.includes('--diff');
  const asJson = argv.includes('--json');
  const [file, ...dirs] = argv.filter((a) => !a.startsWith('--'));
  if (!file || !dirs.length) { console.error('usage: node selfhost/probe.mjs <probes.txt> <implementation folder> [...] [--diff] [--json]'); return 2; }
  const drivers = [{ ...D0, name: 'duramen' }, ...dirs.map((d) => ({ ...implementation(resolve(d)), name: resolve(d).split(/[\\/]/).pop() }))];
  const results = await probe(readProbes(readFileSync(file, 'utf8')), drivers);
  if (asJson) { console.log(JSON.stringify({ checkers: drivers.map((d) => d.name), probes: results }, null, 1)); return 0; }
  for (const r of results) {
    if (onlyDiff && r.same) continue;
    console.log(`== ${r.name}${r.same ? '  [all agree]' : ''}`);
    if (r.same) console.log(`   ${show(r.answers[0], r.op)}`);
    else drivers.forEach((d, k) => console.log(`   ${d.name.padEnd(8)} ${show(r.answers[k], r.op)}`));
  }
  const differ = results.filter((r) => !r.same).length;
  console.log(`\n${results.length} records, ${differ} answered differently`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('probe.mjs')) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
