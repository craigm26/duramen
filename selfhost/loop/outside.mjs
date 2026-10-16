// R6's outside suite (CONFIDENCE-3.md), run against one program. The suite was written by a
// separate Codex session from the 0.12.0 brief alone, in the format its task gave
// (selfhost/loop/r6-task.md): each case is a single request line or a session of lines, sent to
// a fresh driver process, with the whole response expected or values at paths in it.
//
//   node selfhost/loop/outside.mjs <outside-suite.jsonl> <implementation folder | duramen> --out <file.json>
//   node selfhost/loop/outside.mjs <outside-suite.jsonl> --count     (format and counts only)
//
// Paths are read as duramen-core reads a path in an answer (REQ-JU-002): names separated by
// dots, each a member of an object or, written as JSON writes an integer of 0 or more, an
// element of an array. Values compare as JSON values (member order ignored, numbers as
// binary64). Whether a failure is the build's fault, the suite's, an open item's or the brief's
// is triaged by reading 0.12.0's words; this only reports what each program answered.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { driverOf, session, canon } from './runner.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');

export function readSuite(file) {
  const cases = [];
  const problems = [];
  const names = new Set();
  readFileSync(file, 'utf8').split('\n').forEach((text, n) => {
    if (text.trim() === '') return;
    let c;
    try { c = JSON.parse(text); } catch { problems.push(`line ${n + 1}: not JSON`); return; }
    const form = typeof c?.line === 'string' ? 'line' : Array.isArray(c?.session) && c.session.every((l) => typeof l === 'string') ? 'session' : null;
    if (!c || typeof c.name !== 'string' || !form) { problems.push(`line ${n + 1}: neither form`); return; }
    if (names.has(c.name)) problems.push(`line ${n + 1}: name used before`);
    names.add(c.name);
    const e = c.expect;
    const ok = form === 'line'
      ? e && typeof e === 'object' && ((Object.hasOwn(e, 'response') && Object.keys(e).length === 1) || (Array.isArray(e.checks) && e.checks.every((k) => k && typeof k.path === 'string' && Object.hasOwn(k, 'value'))))
      : e && Array.isArray(e.responses) && (e.exit === undefined || Number.isInteger(e.exit));
    if (!ok) { problems.push(`line ${n + 1}: expectation not in the form`); return; }
    cases.push({ ...c, form, at: n + 1 });
  });
  return { cases, problems };
}

const INDEX = /^(0|[1-9][0-9]*)$/;
export function at(value, path) {
  let v = value;
  for (const name of path.split('.')) {
    if (Array.isArray(v)) {
      if (!INDEX.test(name) || Number(name) >= v.length) return { found: false };
      v = v[Number(name)];
    } else if (v !== null && typeof v === 'object') {
      if (!Object.hasOwn(v, name)) return { found: false };
      v = v[name];
    } else return { found: false };
  }
  return { found: true, value: v };
}

const parse = (l) => { try { return { json: JSON.parse(l) }; } catch { return { text: l }; } };

export async function runCase(driver, c) {
  const lines = c.form === 'line' ? [c.line] : c.session;
  const r = await session(driver, lines, { timeoutMs: 120_000 });
  const got = r.lines.map(parse);
  let pass;
  const why = [];
  if (c.form === 'line') {
    const resp = got.length && 'json' in got[0] ? got[0].json : null;
    if (Object.hasOwn(c.expect, 'response')) {
      pass = canon(resp) === canon(c.expect.response);
      if (!pass) why.push('response');
    } else {
      c.expect.checks.forEach((k, i) => {
        const v = at(resp, k.path);
        if (!v.found || canon(v.value) !== canon(k.value)) why.push(`checks.${i}`);
      });
      pass = why.length === 0;
    }
  } else {
    const resp = got.map((g) => ('json' in g ? g.json : { notJson: g.text }));
    if (canon(resp) !== canon(c.expect.responses)) why.push('responses');
    if (c.expect.exit !== undefined && r.exit !== c.expect.exit) why.push('exit');
    pass = why.length === 0;
  }
  return { name: c.name, pass, failed: why, lines: r.lines, exit: r.exit, timedOut: r.timedOut || undefined };
}

async function main(argv) {
  const [file, target] = argv.filter((a, k) => !a.startsWith('--') && argv[k - 1] !== '--out');
  const { cases, problems } = readSuite(resolve(file));
  if (argv.includes('--count')) {
    const ops = {};
    for (const c of cases) {
      const first = c.form === 'line' ? c.line : c.session[0];
      let op = '(not an object)';
      try { const v = JSON.parse(first); if (v && typeof v === 'object' && !Array.isArray(v)) op = typeof v.op === 'string' ? v.op : '(no op)'; } catch { op = '(not JSON)'; }
      ops[`${c.form} ${op}`] = (ops[`${c.form} ${op}`] ?? 0) + 1;
    }
    console.log(JSON.stringify({ cases: cases.length, problems: problems.length, firstProblems: problems.slice(0, 5), byFormAndOp: ops }, null, 1));
    return problems.length ? 1 : 0;
  }
  const out = argv[argv.indexOf('--out') + 1];
  const driver = target === 'duramen' ? { command: `node ${join(ROOT, 'bin', 'duramen.mjs')} serve`, cwd: ROOT } : driverOf(resolve(target));
  const results = [];
  for (const c of cases) results.push(await runCase(driver, c));
  const passed = results.filter((r) => r.pass).length;
  writeFileSync(out, `${JSON.stringify({ suite: file, target, cases: cases.length, passed, problems, results }, null, 1)}\n`);
  console.log(`${target}: ${passed} of ${cases.length} outside cases pass`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
}
