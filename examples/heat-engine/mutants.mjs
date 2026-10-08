// Does the generated suite have teeth? Applies one small, plausible mistake at a time to a copy
// of a TypeScript heat-engine implementation, then runs the suite duramen generates from
// heat.duramen and, if given, the hand-built regen suite, and reports which of them notice.
//
//   node examples/heat-engine/mutants.mjs --impl <regen-heat-engine>/impl/ts [--suite <regen-heat-engine>/.regenerate/suite/run.mjs]
//
// Each mutation must match its file exactly once, or the run stops.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? resolve(args[i + 1]) : undefined; };
const IMPL = opt('--impl');
const SUITE = opt('--suite');
if (!IMPL) { console.error('usage: mutants.mjs --impl <impl/ts> [--suite <run.mjs>]'); process.exit(2); }
const HERE = import.meta.dirname;
const DURAMEN = join(HERE, '..', '..', 'bin', 'duramen.mjs');
const SPEC = join(HERE, 'heat.duramen');

const HALF_EVEN = 'const fx = (x: number, f: number) => { const m = x * 10 ** f, t = Math.trunc(m); const v = Math.abs(m - t) === 0.5 ? (t % 2 === 0 ? t : t + Math.sign(m)) : Math.round(m); return (v / 10 ** f).toFixed(f); };\n';
const CODEPOINT = '.sort((a, b) => { const A = [...a].map((c) => c.codePointAt(0)!), B = [...b].map((c) => c.codePointAt(0)!); for (let i = 0; i < Math.min(A.length, B.length); i++) if (A[i] !== B[i]) return A[i] - B[i]; return A.length - B.length; })';

// [name, what it imitates, file, from, to]
const MUTANTS = [
  ['flagC-times-1.8', 'D-010: c * 1.8 + 32 instead of (c * 9) / 5 + 32', 'engine.ts', 'const f = (c * 9) / 5 + 32;', 'const f = c * 1.8 + 32;'],
  ['wetBulbF-over-1.8', 'D-010: (tempF - 32) / 1.8 instead of ((tempF - 32) * 5) / 9', 'engine.ts', 'wetBulb(((tempF - 32) * 5) / 9,', 'wetBulb((tempF - 32) / 1.8,'],
  ['rh-clamp-99', 'D-009: clamp RH to [5, 99] as the earlier schema said', 'engine.ts', 'Math.min(100, Math.max(5, rhPercent))', 'Math.min(99, Math.max(5, rhPercent))'],
  ['band-80-inclusive', 'FL-001: 80 °F counted as white', 'engine.ts', 'w < 80 ? "white"', 'w <= 80 ? "white"'],
  ['no-marker-at-60', 'WB-003: validity range ends at 60 °C', 'engine.ts', 'tempC > 50) markers', 'tempC > 60) markers'],
  ['stull-constant-typo', 'WB-001: 0.023110 for 0.023101 in term4', 'engine.ts', 'Math.atan(0.023101 * RH)', 'Math.atan(0.023110 * RH)'],
  ['fixed-half-even', 'D-002: Python-style rounding of exact ties in summaries', 'engine.ts', '  const summary = `T=${T.toFixed(1)}', HALF_EVEN + '  const summary = `T=${fx(T, 1)}'],
  ['number-text-exp2', 'D-002: exponents padded to two digits (1e-07), as C and Python write them', 'engine.ts', 'return Number.isFinite(v) ? String(v) : "null";', 'return Number.isFinite(v) ? String(v).replace(/e([+-])(\\d)$/, "e$10$2") : "null";'],
  ['keys-code-point', 'D-021: object keys sorted by code point', 'engine.ts', '.filter((k) => v[k] !== undefined).sort();', '.filter((k) => v[k] !== undefined)' + CODEPOINT + ';'],
  ['lone-surrogate-fffd', 'json/sorted-utf16: lone surrogates replaced instead of escaped', 'engine.ts', 'if (typeof v === "string") return JSON.stringify(v);', 'if (typeof v === "string") return JSON.stringify(v.toWellFormed());'],
  ['infinity-as-null', 'D-007: Infinity written as null in audit inputs (the earlier TypeScript)', 'engine.ts', 'if (x === Infinity) return "Infinity";', 'if (x === Infinity) return null as any;'],
  ['wall-clock', 'IF-004: computed_at from the wall clock', 'engine.ts', 'result_summary: summary, computed_at: clock,', 'result_summary: summary, computed_at: new Date().toISOString(),'],
  ['input-checked-before-op', 'D-024: an unknown op without input answered bad_request', 'driver.ts', 'return canonical({ id, error: "unknown_op" });', 'return canonical({ id, error: isObj(req.input) ? "unknown_op" : "bad_request" });'],
  ['crlf', 'protocol: CRLF line ends', 'driver.ts', 'outLines.push(handle(line) + "\\n");', 'outLines.push(handle(line) + "\\r\\n");'],
];

function duramenRun(dir) {
  const r = spawnSync(process.execPath, [DURAMEN, 'run', SPEC, '--impl', dir], { encoding: 'utf8' });
  const m = r.stdout.match(/passed (\d+)\/(\d+)/);
  return m ? { passed: +m[1], total: +m[2] } : { error: (r.stdout + r.stderr).trim().split('\n').pop() };
}
function handRun(dir) {
  const r = spawnSync(process.execPath, [SUITE, '--impl', dir], { encoding: 'utf8', cwd: dirname(dirname(dirname(SUITE))) });
  const m = r.stdout.match(/passed (\d+)\/(\d+)/);
  return m ? { passed: +m[1], total: +m[2] } : { error: (r.stdout + r.stderr).trim().split('\n').pop() };
}
const show = (x) => (x.error ? `error (${x.error})` : x.passed === x.total ? `${x.passed}/${x.total} (missed)` : `${x.passed}/${x.total} (caught)`);

const rows = [];
const base = mkdtempSync(join(tmpdir(), 'duramen-mutants-'));
try {
  for (const [name, what, file, from, to] of [['none', 'the implementation as released', null, null, null], ...MUTANTS]) {
    const dir = join(base, name);
    cpSync(IMPL, dir, { recursive: true });
    if (file) {
      const p = join(dir, file);
      const src = readFileSync(p, 'utf8');
      const n = src.split(from).length - 1;
      if (n !== 1) throw new Error(`${name}: "${from}" matches ${n} times in ${file}`);
      writeFileSync(p, src.replace(from, () => to));
    }
    const t = duramenRun(dir);
    const h = SUITE ? handRun(dir) : null;
    rows.push({ name, what, duramen: t, hand: h });
    console.log(`${name.padEnd(24)} duramen ${show(t).padEnd(22)}${h ? ` hand-built ${show(h)}` : ''}`);
  }
} finally {
  rmSync(base, { recursive: true, force: true });
}
if (args.includes('--md')) {
  console.log('\n| mutant | imitates | duramen suite | hand-built suite |\n|---|---|---|---|');
  for (const r of rows) console.log(`| \`${r.name}\` | ${r.what} | ${show(r.duramen)} | ${r.hand ? show(r.hand) : '—'} |`);
}
