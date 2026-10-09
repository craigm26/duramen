// Generates the suite from a checked spec, and runs it against an implementation.
//
// Kinds of case:
//   example   one per example: its own expectations, plus the oracle's whole answer (the same
//             members; the result within the op's tolerances; the audit byte for byte; or the
//             same error code)
//   evidence  one per evidence row: the row's values (unless a decision waives the row), plus
//             the oracle's whole answer
//   edge      one per item of a bound edge pack
//   property  one per property: its generated samples, its calls and its expectations
//   static    one per static check on the implementation folder
// and in every run three protocol cases on the stream itself: exit status, bytes, and one
// response per request in order (a fourth, determinism, when the run is repeated).
import { exampleId, edgeCaseId, evidenceCaseId, requestFor, edgeRequest, requestMembers, holds, pick, deepEqual, expectsError, isRaw, isSolo, typeEnv } from './check.mjs';
import { runDriver } from './driver.mjs';
import { runPropertyCases, showBindings } from './property.mjs';
import { evaluateStatic } from './static.mjs';

// Compare two results, allowing the op's per-path tolerances (paths like "result.wetBulbC").
function sameResult(a, b, tolerances, path = 'result') {
  if (typeof a === 'number' && typeof b === 'number') {
    const t = tolerances[path];
    return t === undefined ? a === b : Math.abs(a - b) <= t;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return Object.is(a, b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).sort(); const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => sameResult(a[k], b[k], tolerances, `${path}.${k}`));
}

const members = (resp) => Object.keys(resp).sort();

const fullAnswer = (resp, op) => (resp && !('oracle_error' in resp)
  ? { members: members(resp), error: resp.error, result: resp.result, audit: op?.audit ? resp.audit : undefined, tolerances: op?.tolerances ?? {} }
  : null);

export function generateCases(ast, oracle, propertyRuns = []) {
  const cases = [];
  const lib = ast.edgeLib ?? { defs: new Map() };
  for (const r of ast.items.filter((i) => i.type === 'req')) {
    r.examples.forEach((ex, k) => {
      const op = ast.ops.find((o) => o.name === ex.op);
      if (!op && !expectsError(ex) && !isRaw(ex)) return;
      const id = exampleId(r, k);
      const resp = oracle?.responses.get(id);
      const ok = resp && !('oracle_error' in resp);
      cases.push({
        id, kind: 'example', reqs: [`REQ-${r.id}`], platform: r.platform, line: requestFor(ast, ex, id), ...(isSolo(ex) ? { solo: true } : {}),
        // `expect <path> = ?` becomes an exact check of the oracle's value.
        checks: ex.expects.map(({ path, kind, value, tol }) => (kind === 'show' ? { path, kind: 'eq', value: ok ? pick(resp, path).value : undefined, from: 'oracle' } : { path, kind, value, tol })),
        full: ok ? fullAnswer(resp, op) : null,
      });
    });
    r.statics.forEach((st, k) => {
      cases.push({
        id: `static:${r.id}#${k + 1}`, kind: 'static', reqs: [`REQ-${r.id}`], platform: r.platform,
        static: staticOf(st),
        ...(st.kind === 'json' ? { types: [...typeEnv(ast)] } : {}),
      });
    });
  }
  for (const ev of ast.evidence) {
    for (const row of ev.rows ?? []) {
      const op = ast.ops.find((o) => o.name === row.op);
      if (!op) continue;
      const id = evidenceCaseId(ev, row);
      const resp = oracle?.responses.get(id);
      const waived = ev.waivers.some((w) => w.row === row.rowId);
      cases.push({
        id, kind: 'evidence', reqs: [`EV-${ev.id}`, ...ev.supports.map((s) => `REQ-${s}`)], platform: 'any', line: requestFor(ast, row, id),
        checks: waived ? [] : row.expects.map(({ path, kind, value, tol }) => ({ path, kind, value, tol })),
        ...(waived ? { waived: ev.waivers.find((w) => w.row === row.rowId).decision } : {}),
        full: fullAnswer(resp, op),
      });
    }
  }
  for (const e of ast.edges) {
    if (!e.via || !lib.defs.has(e.name)) continue;
    lib.defs.get(e.name).pack.forEach((item, k) => {
      const id = edgeCaseId(ast, e, k);
      const resp = oracle?.responses.get(id);
      cases.push({
        id, kind: 'edge', reqs: [`EDGE ${e.name}`], platform: 'any', line: edgeRequest(ast, e.via, id, item.input),
        checks: item.refuse ? [{ path: 'error', kind: 'present' }] : [{ path: 'result', kind: 'eq', value: item.text, ...(e.via.encoding === 'base64' ? { encoding: 'base64' } : {}) }],
        full: resp && !('oracle_error' in resp) ? { members: members(resp) } : null,
      });
    });
  }
  for (const pr of propertyRuns) cases.push(pr.case);
  return cases;
}

// A static check as the suite file holds it: no source path, so cases.jsonl is the same everywhere.
const staticOf = ({ kind, globs, max, exclude, target, type, typeText, key, within, pattern }) => ({ kind, globs, max, exclude, target, type, typeText, key, within, pattern });

const platformOk = (p) => p === 'any' || (p === 'windows' ? process.platform === 'win32' : p === 'posix' || p === 'linux' ? process.platform !== 'win32' : true);

// Blank request lines (empty, and white space only) go first: they must get no response.
const BLANKS = ['', ' \t '];

function protocolCases(run, ids) {
  const out = [];
  out.push({ id: 'protocol:exit', why: run.code === 0 && !run.error ? [] : [run.error ?? `exit status ${run.code}`] });
  const why = [];
  try { new TextDecoder('utf-8', { fatal: true }).decode(run.stdout); } catch { why.push('standard output is not valid UTF-8'); }
  if (run.stdout.includes(0x0d)) why.push('standard output contains CR (0x0D)');
  if (run.stdout.length && run.stdout[run.stdout.length - 1] !== 0x0a) why.push('the last response line does not end with LF');
  out.push({ id: 'protocol:bytes', why });
  const lw = [];
  if (run.order.length !== ids.length) lw.push(`${run.order.length} response lines for ${ids.length} requests (and ${BLANKS.length} blank lines, which get none)`);
  const k = ids.findIndex((id, i) => run.order[i] !== id);
  if (k >= 0 && run.order.length === ids.length) lw.push(`response ${k + 1} is for ${JSON.stringify(run.order[k])}, expected ${JSON.stringify(ids[k])}: responses come in request order`);
  if (run.duplicates?.length) lw.push(`more than one response for ${run.duplicates.slice(0, 3).map((x) => JSON.stringify(x)).join(', ')}`);
  out.push({ id: 'protocol:lines', why: lw });
  return out;
}

// The parts of a case that an answer does not meet (duramen-core's `judge`, REQ-JU-001): `answer`
// alone when there is none; else `checks.<n>` for each check it does not hold, counting from 0,
// then `members`, `error`, `result` and `audit` for each part of the whole answer it does not
// match (members sorted; the error as a JSON value; the result as a JSON value, a number within
// the tolerance its path has; the audit byte for byte). [] when it meets them all. This is the
// one comparison `duramen run`, `duramen agree` and `judge` share.
export function judgeAnswer(c, answer) {
  if (answer === null || answer === undefined) return ['answer'];
  const failed = [];
  (c.checks ?? []).forEach((ch, k) => {
    const ok = ch.kind === 'present' ? Object.hasOwn(answer, ch.path) : holds(answer, ch).ok;
    if (!ok) failed.push(`checks.${k}`);
  });
  const f = c.full;
  if (f) {
    const got = members(answer);
    if (got.length !== f.members.length || got.some((m, i) => m !== f.members[i])) failed.push('members');
    // (an expected answer built in this program may hold a member whose value is undefined: none)
    if (f.error !== undefined) { if (!deepEqual(answer.error, f.error)) failed.push('error'); }
    else {
      if (f.result !== undefined && !sameResult(answer.result, f.result, f.tolerances ?? {})) failed.push('result');
      if (f.audit !== undefined && answer.audit !== f.audit) failed.push('audit');
    }
  }
  return failed;
}

// What each failed part means, for people.
function describe(part, c, resp) {
  if (part === 'answer') return 'no response';
  const k = part.startsWith('checks.') ? Number(part.slice(7)) : -1;
  if (k >= 0) {
    const ch = c.checks[k];
    if (ch.kind === 'present') return `expected ${ch.path}`;
    const h = holds(resp, ch);
    return `${ch.path}: expected ${ch.kind === 'approx' ? `${ch.value} ± ${ch.tol}` : JSON.stringify(ch.value)}, got ${h.got === undefined ? '(nothing)' : JSON.stringify(h.got)}`;
  }
  const f = c.full;
  if (part === 'members') return `members: expected ${f.members.join(', ')}; got ${members(resp).join(', ')}`;
  if (part === 'error') return `error: expected ${JSON.stringify(f.error)}, got ${JSON.stringify(resp.error)}`;
  if (part === 'result') return `result: expected ${JSON.stringify(f.result)}, got ${JSON.stringify(resp.result)}`;
  return `audit: expected ${f.audit}\n        got      ${resp.audit}`;
}

// How a response differs from an expected whole answer; [] when it does not.
export function answerDiffers(f, resp) {
  if (!f) return [];
  const c = { checks: [], full: f };
  return judgeAnswer(c, resp ?? null).map((part) => describe(part, c, resp));
}

function compareDriverCase(c, resp) {
  return judgeAnswer(c, resp).map((part) => describe(part, c, resp));
}

// Run the suite. `command` and `cwd` start the implementation's driver; `implDir` is the folder
// static checks look at; `repeat` (>= 2) runs the main batch again and requires the same bytes.
// `withoutOracle` drops every check whose value is the oracle's (the whole answer, and values
// written `?`), to show what the suite catches on the strength of everything else.
// `noStatic` skips static checks (for a driver with no implementation folder, such as an oracle).
export async function runCases(cases, { command, cwd, implDir = cwd, repeat = 1, timeoutMs, withoutOracle = false, noStatic = false } = {}) {
  const strip = (c) => (withoutOracle && (c.kind ?? 'example') !== 'property' && c.kind !== 'static' ? { ...c, full: null, checks: (c.checks ?? []).filter((ch) => ch.from !== 'oracle') } : c);
  const todo = cases.filter((c) => platformOk(c.platform) && !(noStatic && c.kind === 'static')).map(strip);
  const driverCases = todo.filter((c) => c.kind !== 'property' && c.kind !== 'static');
  const batch = driverCases.filter((c) => !c.solo);
  const opts = { cwd, ...(timeoutMs ? { timeoutMs } : {}) };
  const run = await runDriver(command, [...BLANKS, ...batch.map((c) => c.line)], opts);
  // A case whose response cannot be matched by id runs alone: its one response line is its answer.
  const answers = new Map(run.responses);
  const soloWhy = new Map();
  for (const c of driverCases.filter((x) => x.solo)) {
    const sr = await runDriver(command, [c.line], opts);
    const why = [];
    if (sr.error) why.push(sr.error);
    if (sr.list.length !== 1) why.push(`${sr.list.length} response lines for 1 request`);
    else if (sr.list[0]) answers.set(c.id, sr.list[0]);
    soloWhy.set(c.id, why);
  }
  const failures = [];
  const tally = {};
  const count = (kind, ok) => { tally[kind] ??= { passed: 0, total: 0 }; tally[kind].total++; if (ok) tally[kind].passed++; };
  for (const c of driverCases) {
    const resp = answers.get(c.id);
    const why = [...(soloWhy.get(c.id) ?? [])];
    if (!resp) why.push('no response');
    else why.push(...compareDriverCase(c, resp));
    count(c.kind ?? 'example', !why.length);
    if (why.length) failures.push({ id: c.id, kind: c.kind ?? 'example', reqs: c.reqs, why });
  }
  // Properties: their calls run in stages, each stage one driver run.
  const props = todo.filter((c) => c.kind === 'property');
  if (props.length) {
    const results = await runPropertyCases(props, (lines) => runDriver(command, lines, opts));
    props.forEach((c, i) => {
      const r = results[i];
      const why = [...r.errors];
      for (const f of r.failures.slice(0, 3)) why.push(`sample ${f.sample} (${showBindings(f.bindings)}): ${f.why}`);
      if (r.failures.length > 3) why.push(`... and ${r.failures.length - 3} more of ${c.samples.length} samples`);
      count('property', !why.length);
      if (why.length) failures.push({ id: c.id, kind: 'property', reqs: c.reqs, why });
    });
  }
  // Static checks on the folder.
  for (const c of todo.filter((x) => x.kind === 'static')) {
    const r = implDir ? await evaluateStatic(c.static, implDir, new Map(c.types ?? [])) : { ok: false, why: ['no implementation folder to check'] };
    count('static', r.ok);
    if (!r.ok) failures.push({ id: c.id, kind: 'static', reqs: c.reqs, why: r.why });
  }
  const protocol = protocolCases(run, batch.map((c) => c.id));
  if (repeat >= 2) {
    const why = [];
    for (let k = 2; k <= repeat && !why.length; k++) {
      const again = await runDriver(command, [...BLANKS, ...batch.map((c) => c.line)], opts);
      if (!again.stdout.equals(run.stdout)) {
        const i = run.list.findIndex((x, j) => JSON.stringify(x) !== JSON.stringify(again.list[j]));
        why.push(`run ${k} wrote different bytes${i >= 0 ? ` (first at response ${i + 1}, ${JSON.stringify(run.order[i])})` : ''}`);
      }
    }
    protocol.push({ id: 'protocol:deterministic', why });
  }
  for (const p of protocol) { count('protocol', !p.why.length); if (p.why.length) failures.push({ id: p.id, kind: 'protocol', reqs: ['protocol'], why: p.why }); }
  const total = Object.values(tally).reduce((n, t) => n + t.total, 0);
  return { total, skipped: cases.filter((c) => !platformOk(c.platform)).length, passed: total - failures.length, failures, tally, driverError: run.error, stderr: run.stderr };
}

export { requestMembers };
