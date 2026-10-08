// Generates the suite from a checked spec, and runs it against an implementation's driver.
// Each example becomes one case: the example's own expectations, plus the oracle's whole answer
// (the same members; the result within the op's tolerances; the audit byte for byte; or the
// same error code). Each item of a bound edge pack becomes one case. Three protocol cases check
// the stream itself: exit status, bytes, and one response per request in order.
import { EDGES } from './edges.mjs';
import { exampleId, edgeCaseId, requestFor, edgeRequest, holds, pick, expectsError, isRaw, isSolo } from './check.mjs';
import { runDriver } from './driver.mjs';

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

export function generateCases(ast, oracle) {
  const cases = [];
  for (const r of ast.items.filter((i) => i.type === 'req')) {
    r.examples.forEach((ex, k) => {
      const op = ast.ops.find((o) => o.name === ex.op);
      if (!op && !expectsError(ex) && !isRaw(ex)) return;
      const id = exampleId(r, k);
      const resp = oracle?.responses.get(id);
      const ok = resp && !('oracle_error' in resp);
      cases.push({
        id, reqs: [`REQ-${r.id}`], platform: r.platform, line: requestFor(ast, ex, id), ...(isSolo(ex) ? { solo: true } : {}),
        // `expect <path> = ?` becomes an exact check of the oracle's value.
        checks: ex.expects.map(({ path, kind, value, tol }) => (kind === 'show' ? { path, kind: 'eq', value: ok ? pick(resp, path).value : undefined } : { path, kind, value, tol })),
        full: ok ? { members: members(resp), error: resp.error, result: resp.result, audit: op?.audit ? resp.audit : undefined, tolerances: op?.tolerances ?? {} } : null,
      });
    });
  }
  for (const e of ast.edges) {
    if (!e.via || !EDGES[e.name]) continue;
    EDGES[e.name].pack.forEach((item, k) => {
      const id = edgeCaseId(ast, e, k);
      const resp = oracle?.responses.get(id);
      cases.push({
        id, reqs: [`EDGE ${e.name}`], platform: 'any', line: edgeRequest(ast, e.via, id, item.input),
        checks: item.refuse ? [{ path: 'error', kind: 'present' }] : [{ path: 'result', kind: 'eq', value: item.text, ...(e.via.encoding === 'base64' ? { encoding: 'base64' } : {}) }],
        full: resp && !('oracle_error' in resp) ? { members: members(resp) } : null,
      });
    });
  }
  return cases;
}

const platformOk = (p) => p === 'any' || (p === 'windows' ? process.platform === 'win32' : p === 'posix' || p === 'linux' ? process.platform !== 'win32' : true);

// Blank request lines (empty, and white space only) go first: they must get no response.
const BLANKS = ['', ' \t '];

function protocolCases(run, ids) {
  const out = [];
  out.push({ id: 'protocol:exit', why: run.code === 0 ? [] : [run.error ?? `exit status ${run.code}`] });
  const why = [];
  try { new TextDecoder('utf-8', { fatal: true }).decode(run.stdout); } catch { why.push('standard output is not valid UTF-8'); }
  if (run.stdout.includes(0x0d)) why.push('standard output contains CR (0x0D)');
  if (run.stdout.length && run.stdout[run.stdout.length - 1] !== 0x0a) why.push('the last response line does not end with LF');
  out.push({ id: 'protocol:bytes', why });
  const lw = [];
  if (run.order.length !== ids.length) lw.push(`${run.order.length} response lines for ${ids.length} requests (and ${BLANKS.length} blank lines, which get none)`);
  const k = ids.findIndex((id, i) => run.order[i] !== id);
  if (k >= 0 && run.order.length === ids.length) lw.push(`response ${k + 1} is for ${JSON.stringify(run.order[k])}, expected ${JSON.stringify(ids[k])}: responses come in request order`);
  out.push({ id: 'protocol:lines', why: lw });
  return out;
}

export async function runCases(cases, { command, cwd }) {
  const todo = cases.filter((c) => platformOk(c.platform));
  const batch = todo.filter((c) => !c.solo);
  const run = await runDriver(command, [...BLANKS, ...batch.map((c) => c.line)], { cwd });
  // A case whose response cannot be matched by id runs alone: its one response line is its answer.
  const answers = new Map(run.responses);
  const soloWhy = new Map();
  for (const c of todo.filter((x) => x.solo)) {
    const sr = await runDriver(command, [c.line], { cwd });
    const why = [];
    if (sr.error) why.push(sr.error);
    if (sr.list.length !== 1) why.push(`${sr.list.length} response lines for 1 request`);
    else if (sr.list[0]) answers.set(c.id, sr.list[0]);
    soloWhy.set(c.id, why);
  }
  const failures = [];
  for (const c of todo) {
    const resp = answers.get(c.id);
    const why = [...(soloWhy.get(c.id) ?? [])];
    if (!resp) why.push('no response');
    else {
      for (const ch of c.checks) {
        if (ch.kind === 'present') { if (!(ch.path in resp)) why.push(`expected ${ch.path}`); continue; }
        const h = holds(resp, ch);
        if (!h.ok) why.push(`${ch.path}: expected ${ch.kind === 'approx' ? `${ch.value} ± ${ch.tol}` : JSON.stringify(ch.value)}, got ${h.got === undefined ? '(nothing)' : JSON.stringify(h.got)}`);
      }
      const f = c.full;
      if (f) {
        const got = members(resp);
        if (got.join() !== f.members.join()) why.push(`members: expected ${f.members.join(', ')}; got ${got.join(', ')}`);
        if (f.error !== undefined) { if (resp.error !== f.error) why.push(`error: expected ${JSON.stringify(f.error)}, got ${JSON.stringify(resp.error)}`); }
        else if (f.result !== undefined || f.audit !== undefined) {
          if (!sameResult(resp.result, f.result, f.tolerances)) why.push(`result: expected ${JSON.stringify(f.result)}, got ${JSON.stringify(resp.result)}`);
          if (f.audit !== undefined && resp.audit !== f.audit) why.push(`audit: expected ${f.audit}\n        got      ${resp.audit}`);
        }
      }
    }
    if (why.length) failures.push({ id: c.id, reqs: c.reqs, why });
  }
  for (const p of protocolCases(run, batch.map((c) => c.id))) if (p.why.length) failures.push({ id: p.id, reqs: ['protocol'], why: p.why });
  const total = todo.length + 3;
  return { total, skipped: cases.length - todo.length, passed: total - failures.length, failures, driverError: run.error, stderr: run.stderr };
}
