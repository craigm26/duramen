// Do two duramen checkers agree on records nobody wrote down? The suite judges a rebuilt
// checker on the examples in spec/; this compares it with duramen on mutants of those examples'
// records: lines deleted, duplicated, swapped, re-indented, cut short, or with a word or a
// character changed. Where the two checkers answer differently, either the rebuilt one misread
// the specification, the specification is silent (an OPEN item, or a gap to pin), or duramen
// itself is wrong.
//
//   node selfhost/agree.mjs <implementation folder> [--mutants 600] [--seed 1] [--against <folder>] [--json]
//
// --against compares with another implementation instead of duramen (it then stands where D0
// does in the report), so that two rebuilt checkers can be compared with duramen out of the loop.
// --json writes the report as JSON, with the id of every request answered differently
// (`<mutant>:<op>`, or `seed<k>:<op>` for an unmutated record), under `differing`.
import { loadRecord } from '../src/record.mjs';
import { runDriver } from '../src/driver.mjs';
import { makeRng } from '../src/types.mjs';
import { D0, implementation } from './fixedpoint.mjs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

// The records the examples of spec/ send, as { files, entry }.
export function seeds() {
  const { ast } = loadRecord(join(ROOT, 'spec'));
  const out = [];
  for (const r of ast.items.filter((i) => i.type === 'req')) {
    for (const ex of r.examples) {
      const f = ex.input?.files;
      if (!f || typeof f !== 'object' || Array.isArray(f) || !Object.keys(f).length || !Object.values(f).every((v) => typeof v === 'string')) continue;
      if (!Object.keys(f).some((k) => k.endsWith('.duramen'))) continue;
      out.push({ from: `REQ-${r.id}#${r.examples.indexOf(ex) + 1}`, files: f, entry: typeof ex.input.entry === 'string' ? ex.input.entry : '.' });
    }
  }
  return out;
}

const WORDS = ['duramen', 'spec', 'oracle', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note', 'text', 'example', 'table', 'expect', 'input', 'request',
  'omit', 'on', 'source', 'status', 'rejected', 'title', 'result', 'tolerance', 'audit', 'raw', 'when', 'from', '=', '?', '≈', '±', '~', '+-', '|', '#', '0.1', '0.2',
  '1', '-1', '{}', '[]', '"t"', "'x'", 'MUST', 'before', 'f', 'g', 'A', 'D-1', 'x', 'posix', 'accepted', 'superseded', 'contested', 'error', 'id'];
const CHARS = ['"', "'", '{', '}', '[', ']', '|', '\\', ':', ',', '.', '#', ' ', '\t', ' ', '='];

function mutate(seed, others, rng) {
  const files = { ...seed.files };
  const names = Object.keys(files).filter((k) => k.endsWith('.duramen'));
  const name = names[Math.floor(rng() * names.length)];
  let lines = files[name].replace(/\n$/, '').split('\n');
  const pick = (n) => Math.floor(rng() * n);
  const n = 1 + pick(3);
  const done = [];
  for (let k = 0; k < n; k++) {
    const i = pick(lines.length);
    const op = pick(10);
    if (op === 0 && lines.length > 1) { lines.splice(i, 1); done.push(`delete ${i + 1}`); }
    else if (op === 1) { lines.splice(i, 0, lines[i]); done.push(`duplicate ${i + 1}`); }
    else if (op === 2) { const d = [-2, -1, 1, 2][pick(4)]; const lead = lines[i].match(/^ */)[0].length; lines[i] = ' '.repeat(Math.max(0, lead + d)) + lines[i].trimStart(); done.push(`indent ${i + 1} ${d > 0 ? '+' : ''}${d}`); }
    else if (op === 3 && i + 1 < lines.length) { [lines[i], lines[i + 1]] = [lines[i + 1], lines[i]]; done.push(`swap ${i + 1}`); }
    else if (op === 4) { const o = others[pick(others.length)]; const on = Object.keys(o.files).filter((x) => x.endsWith('.duramen')); const ol = o.files[on[0]].split('\n'); lines.splice(i, 0, ol[pick(ol.length)]); done.push(`insert at ${i + 1}`); }
    else if (op === 5 || op === 6) {
      const ws = lines[i].split(/( +)/);
      const wi = ws.map((w, j) => [w, j]).filter(([w]) => w.trim()).map(([, j]) => j);
      if (wi.length) { ws[wi[pick(wi.length)]] = WORDS[pick(WORDS.length)]; lines[i] = ws.join(''); done.push(`word ${i + 1}`); }
    } else if (op === 7) { const at = pick(lines[i].length + 1); lines[i] = lines[i].slice(0, at) + CHARS[pick(CHARS.length)] + lines[i].slice(at); done.push(`char ${i + 1}`); }
    else if (op === 8 && lines[i].length) { lines[i] = lines[i].slice(0, pick(lines[i].length)); done.push(`cut ${i + 1}`); }
    else if (op === 9 && lines[i].length) { const at = pick(lines[i].length); lines[i] = lines[i].slice(0, at) + lines[i].slice(at + 1); done.push(`drop char ${i + 1}`); }
  }
  files[name] = lines.join('\n') + '\n';
  return { from: seed.from, mutation: `${name}: ${done.join(', ')}`, files, entry: seed.entry };
}

// JSON values compare with member order ignored, as the specification compares results.
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

async function answers(driver, requests, chunk = 40) {
  const out = new Map();
  for (let k = 0; k < requests.length; k += chunk) {
    const part = requests.slice(k, k + chunk);
    const r = await runDriver(driver.command, part.map((q) => JSON.stringify(q)), { cwd: driver.cwd, timeoutMs: 240_000 });
    for (const q of part) out.set(q.id, r.responses.get(q.id) ?? { missing: true, why: r.error });
  }
  return out;
}

// A build may answer anything: diagnostics that are not strings are compared as their JSON.
const diagCodes = (resp) => (Array.isArray(resp?.result?.diagnostics) ? resp.result.diagnostics : []).map((d) => (typeof d === 'string' ? d.replace(/^.*: (error|warning|info) /, '$1 ') : JSON.stringify(d)));
function signature(a, b, op) {
  if (op === 'cases') return a?.result?.errors !== b?.result?.errors ? `cases: errors ${a?.result?.errors} vs ${b?.result?.errors}` : 'cases: the suites differ';
  if (!a?.result || !b?.result) return `check: ${JSON.stringify(a?.error ?? a?.missing ?? null)} vs ${JSON.stringify(b?.error ?? b?.missing ?? null)}`;
  const ca = diagCodes(a), cb = diagCodes(b);
  const only = (x, y) => { const left = [...y]; return x.filter((c) => { const i = left.indexOf(c); if (i < 0) return true; left.splice(i, 1); return false; }); };
  const plus = only(ca, cb), minus = only(cb, ca);
  if (!plus.length && !minus.length) return 'check: same codes, different files or lines';
  return `check: D0 ${plus.join(', ') || '-'} | D1 ${minus.join(', ') || '-'}`;
}

async function main(argv) {
  const json = argv.includes('--json');
  const get = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
  const dir = argv.find((a, i) => !a.startsWith('--') && !['--mutants', '--seed', '--against'].includes(argv[i - 1]));
  if (!dir) { console.error('usage: node selfhost/agree.mjs <implementation folder> [--mutants 600] [--seed 1] [--against <folder>] [--json]'); return 2; }
  const d1 = implementation(dir);
  const against = get('--against', null);
  const d0 = against ? { ...implementation(against), name: 'D0' } : D0;
  const all = seeds();
  const rng = makeRng(Number(get("--seed", "1"))).next;
  const count = Number(get('--mutants', '600'));
  const mutants = Array.from({ length: count }, () => mutate(all[Math.floor(rng() * all.length)], all, rng));
  const requests = [];
  mutants.forEach((m, k) => { for (const op of ['check', 'cases']) requests.push({ id: `${k}:${op}`, op, input: { files: m.files, entry: m.entry } }); });
  // the unmutated seeds too: the suite's own records
  all.forEach((s, k) => { for (const op of ['check', 'cases']) requests.push({ id: `seed${k}:${op}`, op, input: { files: s.files, entry: s.entry } }); });
  const t0 = Date.now();
  const [a, b] = [await answers(d0, requests), await answers(d1, requests)];
  const groups = new Map();
  const differing = [];
  let same = 0;
  for (const q of requests) {
    const ra = a.get(q.id), rb = b.get(q.id);
    if (canon(ra) === canon(rb)) { same++; continue; }
    differing.push(q.id);
    const sig = signature(ra, rb, q.op);
    const k = q.id.split(':')[0];
    const m = k.startsWith('seed') ? { from: all[Number(k.slice(4))].from, mutation: '(unmutated)', files: all[Number(k.slice(4))].files } : mutants[Number(k)];
    const g = groups.get(sig) ?? { count: 0, examples: [] };
    g.count++;
    if (g.examples.length < 3) g.examples.push({ id: q.id, from: m.from, mutation: m.mutation, files: m.files, d0: ra, d1: rb });
    groups.set(sig, g);
  }
  const sorted = [...groups].sort((x, y) => y[1].count - x[1].count);
  const report = { implementation: dir, against: against ?? 'duramen', seeds: all.length, mutants: count, requests: requests.length, same, differ: requests.length - same, seconds: Math.round((Date.now() - t0) / 1000), groups: sorted.map(([sig, g]) => ({ signature: sig, count: g.count, examples: g.examples })), differing };
  if (json) { console.log(JSON.stringify(report, null, 1)); return 0; }
  console.log(`${report.requests} requests (${count} mutants and ${all.length} seeds, check and cases each): ${same} answered the same, ${report.differ} differently (${report.seconds} s)`);
  for (const [sig, g] of sorted) {
    console.log(`\n${g.count} × ${sig}`);
    const e = g.examples[0];
    console.log(`  e.g. ${e.id} from ${e.from}, ${e.mutation}`);
    console.log(`  D0: ${JSON.stringify(e.d0).slice(0, 300)}`);
    console.log(`  D1: ${JSON.stringify(e.d1).slice(0, 300)}`);
  }
  return 0;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
