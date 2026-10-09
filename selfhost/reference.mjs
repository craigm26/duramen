// Can a rebuilt checker take duramen's place as the reference for its own specification?
//
//   node selfhost/reference.mjs <reference build> <build to judge> [...] [--json]
//
// (a) spec/, with its oracle pointed at the reference, checked by duramen: every hand-typed
//     example of the specification agrees with the reference's answers (0 errors).
// (b) The suite the reference writes for spec/ with itself as the oracle, C(R, R), judges each
//     build named; so does duramen's own suite, C(D0, D0). The verdicts are compared case by
//     case: the same cases pass and the same cases fail.
// The code that compares a build's answers with a case's checks is still duramen's (runCases);
// duramen-core 0.8.0's `judge` operation is the step that takes that away too.
import { resolve } from 'node:path';
import { D0, implementation, specFiles, withOracle, casesOf, compareSuites } from './fixedpoint.mjs';
import { runCases } from '../src/suite.mjs';

async function main(argv) {
  const json = argv.includes('--json');
  const [refDir, ...judged] = argv.filter((a) => !a.startsWith('--'));
  if (!refDir || !judged.length) { console.error('usage: node selfhost/reference.mjs <reference build> <build to judge> [...] [--json]'); return 2; }
  const R = implementation(refDir);
  const files = specFiles();
  // (a) every example of spec/ against the reference's answers, checked by duramen
  const a = await casesOf(D0, withOracle(files, R));
  if (a.error) { console.error(`(a) duramen could not check spec/ against ${refDir}: ${a.error}`); return 1; }
  // (b) the reference's own suite, and duramen's
  const cr = await casesOf(R, withOracle(files, R));
  if (cr.error) { console.error(`(b) ${refDir} wrote no suite: ${cr.error}`); return 1; }
  const cd = await casesOf(D0, withOracle(files, D0));
  const suiteDiff = compareSuites(cd.result, cr.result);
  const rows = [];
  for (const dir of judged) {
    const B = implementation(dir);
    const opts = { command: B.command, cwd: B.cwd, implDir: resolve(dir) };
    const [byR, byD] = [await runCases(cr.result.cases, opts), await runCases(cd.result.cases, opts)];
    const failR = byR.failures.map((f) => f.id).sort();
    const failD = byD.failures.map((f) => f.id).sort();
    rows.push({ build: dir, byReference: `${byR.passed}/${byR.total}`, byDuramen: `${byD.passed}/${byD.total}`, sameVerdicts: failR.join() === failD.join(), onlyReferenceFails: failR.filter((x) => !failD.includes(x)), onlyDuramenFails: failD.filter((x) => !failR.includes(x)) });
  }
  const report = { reference: refDir, a: { errors: a.result.errors, cases: a.result.cases.length }, b: { suitesDiffer: suiteDiff.length, firstDifferences: suiteDiff.slice(0, 5), judged: rows } };
  if (json) { console.log(JSON.stringify(report, null, 1)); return 0; }
  console.log(`(a) spec/ checked by duramen against ${refDir}'s answers: ${a.result.errors} errors, ${a.result.cases.length} cases`);
  console.log(`(b) C(R, R) vs C(D0, D0): ${suiteDiff.length ? `${suiteDiff.length} differences, first: ${suiteDiff[0]}` : 'identical as JSON values'}`);
  for (const r of rows) console.log(`    ${r.build}: ${r.byReference} by the reference's suite, ${r.byDuramen} by duramen's; same verdicts: ${r.sameVerdicts ? 'yes' : `no (only by the reference: ${r.onlyReferenceFails.join(', ') || '-'}; only by duramen: ${r.onlyDuramenFails.join(', ') || '-'})`}`);
  return 0;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
