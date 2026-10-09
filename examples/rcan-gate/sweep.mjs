// Mutants of the gate's oracle that `duramen mutate` does not make, checked the way it checks its
// own: each is written into a copy of this folder and the record is checked against it; a mutant
// is caught when the check reports an error.
//
//   node examples/rcan-gate/sweep.mjs [--jobs 4]
//
// Two kinds of mutant:
// - each string literal of oracle.mjs that names a member of a family below, swapped for the
//   next member of that family (a literal in two families counts in the first that holds it);
// - each line of `decide` that returns early (every `return out(` but the last), deleted.
// The output is kept in sweep.txt.
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRecord } from '../../src/record.mjs';
import { check } from '../../src/check.mjs';

const HERE = import.meta.dirname;
const FAMILIES = {
  decisions: ['execute', 'refuse', 'hold'],
  reasons: ['estop', 'stale', 'future', 'replay', 'estopped', 'role', 'loa', 'status', 'estop_clear', 'stop', 'resume', 'stopped', 'unknown_joint', 'duplicate_joint', 'limits', 'speed', 'confidence', 'ok'],
  events: ['ESTOP', 'STOP', 'RESUME', 'ESTOP_CLEAR'],
  roles: ['GUEST', 'OPERATOR', 'CONTRIBUTOR', 'ADMIN', 'M2M_PEER', 'CREATOR', 'M2M_TRUSTED'],
  tiers: ['root', 'authoritative', 'community'],
  onFail: ['block', 'escalate'],
  kinds: ['safety', 'status', 'move'],
};
const familyOf = (s) => Object.entries(FAMILIES).find(([, xs]) => xs.includes(s));

export function sweepMutants(src) {
  const lines = src.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, ''); // the oracle's comments hold no quotes
    for (const m of code.matchAll(/'([^'\\]*)'/g)) {
      const fam = familyOf(m[1]);
      if (!fam) continue;
      const [name, xs] = fam;
      const to = xs[(xs.indexOf(m[1]) + 1) % xs.length];
      const text = [...lines.slice(0, i), line.slice(0, m.index) + `'${to}'` + line.slice(m.index + m[0].length), ...lines.slice(i + 1)].join('\n');
      // what: the literal with the text before it on its line, as far as the last comma, space or bracket
      const before = code.slice(0, m.index).match(/[\w.'"]*:?\s*$/)[0];
      out.push({ kind: `swap ${name}`, line: i + 1, what: `${before}'${m[1]}' -> '${to}'`, text });
    }
  });
  const start = lines.findIndex((l) => l.startsWith('export function decide'));
  const returns = lines.map((l, i) => i).filter((i) => i > start && lines[i].includes('return out('));
  for (const i of returns.slice(0, -1)) {
    out.push({ kind: 'delete early return', line: i + 1, what: lines[i].trim(), text: [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n') });
  }
  return out;
}

async function main(argv) {
  const jobs = Number(argv[argv.indexOf('--jobs') + 1]) || 4;
  const { ast, diagnostics } = loadRecord(join(HERE, 'gate.duramen'));
  if (diagnostics.some((d) => d.level === 'error')) { console.error('gate.duramen does not check clean'); return 1; }
  const base = await check(ast, { timeoutMs: 60_000 });
  if (base.diagnostics.some((d) => d.level === 'error')) { console.error('gate.duramen does not check clean against its oracle'); return 1; }
  const mutants = sweepMutants(readFileSync(join(HERE, 'oracle.mjs'), 'utf8'));
  const results = new Array(mutants.length);
  let next = 0;
  async function worker() {
    const dir = mkdtempSync(join(tmpdir(), 'rcan-gate-sweep-'));
    try {
      for (const f of ['gate.duramen', 'driver.mjs']) copyFileSync(join(HERE, f), join(dir, f));
      while (next < mutants.length) {
        const k = next++;
        writeFileSync(join(dir, 'oracle.mjs'), mutants[k].text);
        const mast = { ...ast, oracle: { ...ast.oracle, file: join(dir, 'gate.duramen') } };
        const r = await check(mast, { timeoutMs: 60_000 });
        results[k] = [...new Set(r.diagnostics.filter((d) => d.level === 'error').map((d) => d.code))].sort();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, mutants.length) }, worker));
  const survivors = mutants.map((m, k) => ({ ...m, codes: results[k] })).filter((m) => !m.codes.length);
  const byKind = {};
  mutants.forEach((m, k) => { const b = (byKind[m.kind] ??= { made: 0, caught: 0 }); b.made++; if (results[k].length) b.caught++; });
  console.log(`${mutants.length} mutants of oracle.mjs, ${mutants.length - survivors.length} caught, ${survivors.length} not`);
  for (const [kind, b] of Object.entries(byKind)) console.log(`  ${kind}: ${b.made} made, ${b.caught} caught`);
  for (const s of survivors) console.log(`not caught: oracle.mjs:${s.line} ${s.kind}: ${s.what}`);
  return 0;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
