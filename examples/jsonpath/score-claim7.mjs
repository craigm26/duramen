// Claim 7's verdict (CONFIDENCE-2.md), from the judge's report (judge-cts.mjs) and the agreement
// report (agreement.mjs). Builds are named <brief>-<model>-<n>-<lang>, as run-builds.mjs names them.
//
//   node examples/jsonpath/score-claim7.mjs <cts report.json> <agreement report.json>
import { readFileSync } from 'node:fs';

const [ctsFile, agreeFile] = process.argv.slice(2);
const cts = JSON.parse(readFileSync(ctsFile, 'utf8'));
const agree = JSON.parse(readFileSync(agreeFile, 'utf8'));
const parse = (name) => { const m = /^([ABC])-(sonnet|haiku)-(\d)-(ts|py)$/.exec(name); return m ? { brief: m[1], model: m[2], n: +m[3], lang: m[4] } : null; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x) => `${(100 * x).toFixed(1)}%`;

const rows = cts.builds.map((b) => ({ ...b, ...parse(b.name) }));
const sonnet = (brief) => rows.filter((r) => r.brief === brief && r.model === 'sonnet');
console.log(`The suite: ${cts.cases} cases.`);
for (const r of rows) console.log(`  ${r.name.padEnd(18)} passed ${String(r.passed).padStart(4)} (${pct(r.passed / cts.cases)}), failed ${r.failed}${r.error ? ` (${r.error})` : ''}`);

const F = Object.fromEntries(['A', 'B', 'C'].map((b) => [b, mean(sonnet(b).map((r) => r.failed))]));
const c1 = sonnet('C').every((r) => r.passed / cts.cases >= 0.95);
const c2 = F.C <= F.A / 2 && F.C <= F.B / 2;
const pairAgree = (brief) => {
  const names = new Set(sonnet(brief).map((r) => r.name));
  const ps = agree.pairs.filter((p) => names.has(p.a) && names.has(p.b));
  return { pairs: ps.length, mean: mean(ps.map((p) => p.agree / p.of)) };
};
const G = Object.fromEntries(['A', 'B', 'C'].map((b) => [b, pairAgree(b)]));
const c3 = G.C.mean >= G.A.mean && G.C.mean >= G.B.mean;

console.log('\nclaude-sonnet-5-5 builds, by brief:');
for (const b of ['A', 'B', 'C']) console.log(`  ${b}: ${sonnet(b).length} builds, mean failed cases ${F[b].toFixed(2)}, mean agreement over ${G[b].pairs} pairs ${pct(G[b].mean)}`);
console.log('\nCriteria:');
console.log(`  1. each C build passes at least 95% of the cases: ${c1 ? 'holds' : 'does not hold'}`);
console.log(`  2. C fails at most half as many cases as A and as B: ${c2 ? 'holds' : 'does not hold'} (C ${F.C.toFixed(2)}, half of A ${(F.A / 2).toFixed(2)}, half of B ${(F.B / 2).toFixed(2)})`);
console.log(`  3. C's builds agree with each other at least as often as A's and B's: ${c3 ? 'holds' : 'does not hold'} (C ${pct(G.C.mean)}, A ${pct(G.A.mean)}, B ${pct(G.B.mean)})`);
console.log(`\nClaim 7 ${c1 && c2 && c3 ? 'passes' : 'fails'}.`);
