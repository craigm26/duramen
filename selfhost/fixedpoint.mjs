// The fixed-point test for duramen-core: does a checker rebuilt from spec/ generate the very
// suite that judged it?
//
//   node selfhost/fixedpoint.mjs <implementation folder> [--json]
//
// D0 is this repository's duramen (`duramen serve`); D1 is the implementation (its REGEN.json
// driver). Each is asked for the `cases` of spec/, sent as files in the request, with the
// record's oracle pointed at D0 or at D1:
//
//   C(D0, D0)  the suite as duramen generates it: the suite D1 was judged by
//   C(D1, D1)  the suite D1 generates with itself as the oracle
//   C(D1, D0)  D1 generating the suite from D0's answers: is D1's suite generation D0's?
//   C(D0, D1)  D0 generating the suite from D1's answers: are D1's answers D0's?
//
// The fixed point is C(D1, D1) == C(D0, D0): the rebuilt checker, reading the specification it
// was built from and using itself as that specification's model, writes the same suite, case
// for case, as the one that judged it. Suites are compared as JSON values, as the specification
// compares results (member order does not matter); whether they are also the same text is
// reported beside.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { runDriver, implDriver, parseCommand } from '../src/driver.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SPEC = join(ROOT, 'spec');

// Every file of spec/ (records and fixtures), as the request's `files`.
export function specFiles() {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'build') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[relative(SPEC, p).split('\\').join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(SPEC);
  return out;
}

const quote = (w) => (/[\s"']/.test(w) ? `"${w.replace(/"/g, '\\"')}"` : w);

// A driver command that works from any folder: words naming files in the implementation folder
// become absolute paths.
export function absoluteCommand(command, dir) {
  const p = parseCommand(command);
  if (p.error) throw new Error(p.error);
  return p.words.map((w) => (!isAbsolute(w) && existsSync(join(dir, w)) && statSync(join(dir, w)).isFile() ? join(dir, w) : w)).map(quote).join(' ');
}

export const D0 = { name: 'D0', command: `node ${quote(join(ROOT, 'bin', 'duramen.mjs'))} serve`, cwd: ROOT };

export function implementation(dir) {
  const d = implDriver(resolve(dir));
  if (d.error) throw new Error(d.error);
  return { name: 'D1', command: absoluteCommand(d.command, resolve(dir)), cwd: resolve(dir) };
}

// spec/ with its oracle pointed at `oracle`.
export function withOracle(files, oracle) {
  const out = { ...files };
  const key = Object.keys(out).find((k) => /^oracle\s/m.test(out[k]) && k.endsWith('.duramen'));
  out[key] = out[key].replace(/^oracle .*$/m, `oracle ${oracle.command}`);
  return out;
}

export async function casesOf(driver, files, timeoutMs = 600_000) {
  const line = JSON.stringify({ id: 'fp', op: 'cases', input: { files, entry: '.' } });
  const r = await runDriver(driver.command, [line], { cwd: driver.cwd, timeoutMs });
  const resp = r.responses.get('fp');
  if (!resp) return { error: r.error ?? 'no response', stderr: r.stderr };
  if ('error' in resp) return { error: `answered ${JSON.stringify(resp.error)}`, stderr: r.stderr };
  const why = notASuite(resp.result);
  if (why) return { error: `answered a result that is not a suite: ${why}`, stderr: r.stderr };
  return { result: resp.result, run: r };
}

// The builds judged here may be wrong in any way, so a `cases` result is checked before it is
// compared: an object with a number `errors` and an array `cases` of objects with string IDs.
export function notASuite(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return 'not an object';
  if (typeof result.errors !== 'number') return '"errors" is not a number';
  if (!Array.isArray(result.cases)) return '"cases" is not an array';
  const k = result.cases.findIndex((c) => !c || typeof c !== 'object' || Array.isArray(c) || typeof c.id !== 'string');
  return k >= 0 ? `case ${k + 1} is not an object with a string "id"` : null;
}

// JSON text with object members sorted, so that equal values give equal text.
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

// Where two suites differ: case IDs, then the first member that differs in each case.
export function compareSuites(a, b) {
  const out = [];
  if (a.errors !== b.errors) out.push(`errors: ${a.errors} vs ${b.errors}`);
  const ia = new Map(a.cases.map((c) => [c.id, c]));
  const ib = new Map(b.cases.map((c) => [c.id, c]));
  for (const id of ia.keys()) if (!ib.has(id)) out.push(`${id}: only in the first`);
  for (const id of ib.keys()) if (!ia.has(id)) out.push(`${id}: only in the second`);
  if (a.cases.map((c) => c.id).join() !== b.cases.map((c) => c.id).filter((id) => ia.has(id)).join() && !out.length) out.push('the cases are in a different order');
  for (const [id, ca] of ia) {
    const cb = ib.get(id);
    if (!cb) continue;
    for (const k of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
      if (canon(ca[k]) !== canon(cb[k])) out.push(`${id}.${k}: ${JSON.stringify(ca[k])?.slice(0, 160)} vs ${JSON.stringify(cb[k])?.slice(0, 160)}`);
    }
  }
  return out;
}

async function main(argv) {
  const json = argv.includes('--json');
  const dir = argv.find((a) => !a.startsWith('--'));
  if (!dir) { console.error('usage: node selfhost/fixedpoint.mjs <implementation folder> [--json]'); return 2; }
  const d1 = implementation(dir);
  const files = specFiles();
  const pairs = [[D0, D0], [d1, d1], [d1, D0], [D0, d1]];
  const suites = {};
  for (const [gen, orc] of pairs) {
    const key = `C(${gen.name}, ${orc.name})`;
    const t0 = Date.now();
    const r = await casesOf(gen, withOracle(files, orc));
    suites[key] = r;
    if (!json) console.log(`${key}: ${r.error ? `ERROR ${r.error}${r.stderr ? `\n${r.stderr.slice(-2000)}` : ''}` : `${r.result.cases.length} cases, ${r.result.errors} errors`} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  const base = suites['C(D0, D0)'].result;
  const report = { implementation: dir, d1: d1.command, comparisons: {} };
  for (const key of ['C(D1, D1)', 'C(D1, D0)', 'C(D0, D1)']) {
    const r = suites[key];
    const diffs = r.error || !base ? [r.error ?? 'no base suite'] : compareSuites(base, r.result);
    const sameText = !r.error && !!base && JSON.stringify(base) === JSON.stringify(r.result);
    report.comparisons[key] = { same: diffs.length === 0, sameText, differences: diffs.length, first: diffs.slice(0, 20) };
    if (!json) {
      console.log(`\n${key} vs C(D0, D0): ${diffs.length ? `${diffs.length} differences` : `identical${sameText ? ', as text too' : ' as JSON values (the text differs in member order)'}`}`);
      for (const x of diffs.slice(0, 20)) console.log(`  ${x}`);
      if (diffs.length > 20) console.log(`  ... and ${diffs.length - 20} more`);
    }
  }
  report.fixedPoint = report.comparisons['C(D1, D1)'].same;
  if (json) console.log(JSON.stringify(report, null, 1));
  else console.log(`\nfixed point: ${report.fixedPoint ? 'yes' : 'no'}`);
  return report.fixedPoint ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('fixedpoint.mjs')) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
