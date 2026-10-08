// `tilth check`: everything that can be known about a spec before any implementation exists.
// Structural rules are checked first; then every example and every bound edge pack is run
// through the oracle, so no example in the brief can disagree with the spec's own model.
import { dirname } from 'node:path';
import { EDGES, AMBIGUOUS, packConflicts } from './edges.mjs';
import { runDriver } from './driver.mjs';

const OBLIGATION = /\b(MUST|MUST NOT|SHALL|SHALL NOT|REQUIRED)\b/;
const STATUSES = ['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'];
const ORDER_WORDS = /\b(in this order|in the order|first that applies|first match|precede[sd]?|before|after|takes? precedence)\b/i;

export function exampleId(req, k) { return `${req.id}#${k + 1}`; }

// Suite case IDs for edge pack items; the binding is part of the ID when an edge is bound twice.
export function edgeCaseId(ast, e, k) {
  const twice = ast.edges.filter((x) => x.name === e.name && x.via).length > 1;
  return `edge:${e.name}${twice ? `@${e.via.op}.${e.via.field}` : ''}#${k + 1}`;
}

// An example that expects an error may name an unknown op or leave out required fields: that is
// what it is about. A raw example is a request line written out in full.
export const expectsError = (ex) => ex.expects.some((e) => e.path === 'error');
export const isRaw = (ex) => ex.rawLine !== undefined;
// A request whose response cannot be matched by id is sent on its own, in its own run.
export const isSolo = (ex) => isRaw(ex) || ex.omit.includes('id');

// The members a request carries besides id, op and input: the spec's `request` members, replaced
// by the op's if it declares its own, then the example's on top.
export function requestMembers(ast, opName, exampleRequest) {
  const op = ast.ops.find((o) => o.name === opName);
  return { ...(op?.request ?? ast.spec?.request ?? {}), ...(exampleRequest ?? {}) };
}

function requestLine(ast, id, opName, rawInput, exampleRequest, omit = []) {
  const members = { id, op: opName };
  for (const [k, v] of Object.entries(requestMembers(ast, opName, exampleRequest))) {
    if (!['id', 'op', 'input'].includes(k)) members[k] = v;
  }
  for (const k of omit) delete members[k];
  const head = JSON.stringify(members);
  return rawInput === null || omit.includes('input') ? head : `${head.slice(0, -1)}${head === '{}' ? '' : ','}"input":${rawInput}}`;
}

// The request line for an example. The input is spliced in exactly as the spec wrote it.
export function requestFor(ast, ex, id) {
  if (isRaw(ex)) return ex.rawLine;
  return requestLine(ast, id, ex.op, ex.noInput ? null : ex.raw ?? JSON.stringify(ex.input), ex.request, ex.omit);
}

// The request line for an edge pack item bound to <op> <field> (pack inputs are raw JSON text).
export function edgeRequest(ast, binding, id, rawInput) {
  return requestLine(ast, id, binding.op, `{${JSON.stringify(binding.field)}:${rawInput}}`, null);
}

// Read a dotted path from a driver response. `audit.x` parses the audit text first.
export function pick(resp, path) {
  const parts = path.split('.');
  let v = resp;
  for (let i = 0; i < parts.length; i++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, parts[i])) return { found: false };
    v = v[parts[i]];
    if (i === 0 && parts[0] === 'audit' && parts.length > 1) {
      if (typeof v !== 'string') return { found: false };
      try { v = JSON.parse(v); } catch { return { found: false }; }
    }
  }
  return { found: true, value: v };
}

export function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a); const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

// The text an edge-bound op answered with (decoded when the binding says base64).
export const edgeText = (value, encoding) => (encoding === 'base64' && typeof value === 'string' ? Buffer.from(value, 'base64').toString('utf8') : value);

export function holds(resp, e) {
  const raw = pick(resp, e.path);
  const got = raw.found && e.encoding ? { found: true, value: edgeText(raw.value, e.encoding) } : raw;
  if (!got.found) return { ok: false, got: undefined };
  if (e.kind === 'approx') return { ok: typeof got.value === 'number' && Math.abs(got.value - e.value) <= e.tol, got: got.value };
  return { ok: deepEqual(got.value, e.value), got: got.value };
}

export async function check(ast, { baseDir = dirname(ast.file) } = {}) {
  const ds = [];
  const d = (level, line, code, message) => ds.push({ level, file: ast.file, line, code, message });
  const reqs = ast.items.filter((i) => i.type === 'req');
  const opens = ast.items.filter((i) => i.type === 'open');
  const opNames = new Set(ast.ops.map((o) => o.name));
  const decisionIds = new Set(ast.decisions.map((x) => x.id));

  // IDs are unique: REQ-x, OPEN-x and decision IDs (REQ-WB-002 and OPEN-WB-002 may coexist).
  const seen = new Map();
  const full = (x) => (x.type === 'req' ? `REQ-${x.id}` : x.type === 'open' ? `OPEN-${x.id}` : x.id);
  for (const x of [...reqs, ...opens, ...ast.decisions]) {
    if (seen.has(full(x))) d('error', x.line, 'T007', `duplicate ID ${full(x)} (first at line ${seen.get(full(x))})`);
    else seen.set(full(x), x.line);
  }

  const codes = [...new Set(ast.errors.map((e) => e.code))];
  for (const r of reqs) {
    // T001: every obligation has at least one evaluation.
    if (r.examples.length === 0) d('error', r.line, 'T001', `${r.id} has no example or table row: every requirement needs an evaluation`);
    for (const id of r.decisions) if (!decisionIds.has(id)) d('error', r.line, 'T008', `${r.id} cites ${id}, which is not declared`);
    for (const ex of r.examples) {
      const op = ast.ops.find((o) => o.name === ex.op);
      if (expectsError(ex) || isRaw(ex)) {
        for (const e of ex.expects.filter((y) => y.path === 'error')) {
          if (!codes.includes(e.value)) d('error', e.line, 'T023', `${JSON.stringify(e.value)} is not an error code declared in "errors"`);
        }
        continue;
      }
      if (!op) { d('error', ex.line, 'T009', `unknown op "${ex.op}"`); continue; }
      for (const f of op.inputs) if (!f.optional && !(f.name in ex.input)) d('error', ex.line, 'T010', `${ex.op} input is missing required field "${f.name}"`);
      for (const k of Object.keys(ex.input)) if (!op.inputs.some((f) => f.name === k)) d('warning', ex.line, 'T011', `${ex.op} has no input field "${k}"`);
    }
    // T005: order is declared once (`errors`), never restated in prose.
    const named = codes.filter((c) => r.text.includes(c));
    if (named.length >= 2 && ORDER_WORDS.test(r.text)) {
      d('error', r.textLine ?? r.line, 'T005', `${r.id} restates the order of ${named.join(', ')}; that order is declared once, in "errors" (line ${ast.errors[0]?.line})`);
    }
  }
  for (const e of ast.edges) for (const id of e.decisions) if (!decisionIds.has(id)) d('error', e.line, 'T008', `edge ${e.name} cites ${id}, which is not declared`);
  // Decisions have a lifecycle (the states are Chad Fowler's, from "The Specification Is Not a
  // Document"). Only an accepted decision, or one with no status, carries a requirement.
  for (const x of ast.decisions) {
    if (!x.status) continue;
    const word = x.status.split(/\s+/)[0];
    if (!STATUSES.includes(word)) d('error', x.line, 'T027', `${x.id} has status "${word}"; use one of ${STATUSES.join(', ')}`);
    const by = x.status.match(/^superseded by (\S+)$/);
    if (word === 'superseded' && !(by && decisionIds.has(by[1]))) d('error', x.line, 'T027', `${x.id} is superseded: say by which declared decision ("superseded by D-…")`);
  }
  for (const r of [...reqs, ...ast.edges]) {
    for (const id of r.decisions) {
      const word = ast.decisions.find((y) => y.id === id)?.status?.split(/\s+/)[0];
      const who = r.type === 'req' ? `REQ-${r.id}` : `edge ${r.name}`;
      if (['contested', 'superseded', 'rejected'].includes(word)) d('error', r.line, 'T028', `${who} rests on ${id}, which is ${word}`);
      else if (['observed', 'inferred', 'proposed'].includes(word)) d('warning', r.line, 'T028', `${who} rests on ${id}, which is only ${word}, not accepted`);
    }
  }
  for (const x of ast.decisions) {
    const cited = reqs.some((r) => r.decisions.includes(x.id)) || ast.edges.some((e) => e.decisions.includes(x.id));
    if (!cited) d('warning', x.line, 'T012', `${x.id} is not cited by any requirement or edge`);
    if (!x.source) d('warning', x.line, 'T013', `${x.id} has no "source" (where the claim came from)`);
  }
  // T004: obligations live in requirements (and in the edge texts a spec imports). Anywhere
  // else, an RFC 2119 keyword is an error, unless it is quoted ("..." or `...`), as when a
  // decision quotes an earlier text.
  const keyword = (text) => (text ?? '').replace(/"[^"\n]*"|“[^”\n]*”|`[^`\n]*`/g, '').match(OBLIGATION);
  const place = [
    ...ast.items.filter((i) => i.type === 'note' || i.type === 'section').map((i) => [i.text, i.line, `a ${i.type}`]),
    [ast.spec?.text, ast.spec?.line ?? 1, "the spec's text"],
    ...ast.decisions.flatMap((x) => [[x.text, x.line, `decision ${x.id}`], ...x.rejected.map((t) => [t, x.line, `decision ${x.id}`])]),
    ...ast.ops.map((o) => [o.summary, o.line, `op ${o.name}`]),
    ...ast.errors.map((e) => [e.when, e.line, `the errors list`]),
  ];
  for (const [text, line, where] of place) {
    const m = keyword(text);
    if (m) d('error', line, 'T004', `"${m[1]}" in ${where}: obligations belong in a req, where they get an ID and an evaluation`);
  }
  for (const o of opens) {
    for (const n of o.exampleLines ?? []) d('error', n, 'T003', `open ${o.id} cannot have examples: open behavior is never tested`);
    const m = keyword(o.text);
    if (m) d('warning', o.line, 'T014', `"${m[1]}" in open ${o.id}: open behavior should not be obligatory`);
  }
  // Edges: known, unambiguous, bound to a real op.
  for (const e of ast.edges) {
    if (AMBIGUOUS[e.name]) d('error', e.line, 'T015', `edge "${e.name}" is ambiguous; say which: ${AMBIGUOUS[e.name].join(' or ')}`);
    else if (!EDGES[e.name]) d('error', e.line, 'T016', `unknown edge "${e.name}"`);
    if (e.via && !opNames.has(e.via.op)) d('error', e.line, 'T017', `edge ${e.name} is bound to unknown op "${e.via.op}"`);
    if (EDGES[e.name] && !e.via) d('info', e.line, 'T018', `edge ${e.name} is not bound to an op: its definition is in the brief, but no pack cases reach the suite`);
  }
  // T026: two edges bound to the same op and field that disagree on a shared input.
  const bound = ast.edges.filter((e) => e.via && EDGES[e.name]);
  for (let i = 0; i < bound.length; i++) {
    for (let j = i + 1; j < bound.length; j++) {
      const [a, b] = [bound[i], bound[j]];
      if (a.via.op !== b.via.op || a.via.field !== b.via.field) continue;
      for (const c of packConflicts(a.name, b.name)) {
        d('error', b.line, 'T026', `edges ${a.name} (line ${a.line}) and ${b.name} disagree on ${c.input}: ${a.name} expects ${c.a}, ${b.name} expects ${c.b}; one ${a.via.op} cannot do both`);
      }
    }
  }
  const hasExamples = reqs.some((r) => r.examples.length > 0);
  if (!ast.oracle && hasExamples) d('error', ast.spec?.line ?? 1, 'T019', 'no oracle: examples cannot be computed');
  else if (!ast.oracle && bound.length) d('info', ast.spec?.line ?? 1, 'T019', 'no oracle: the edge packs were not run against a model of this spec');

  const out = { diagnostics: ds, oracle: null };
  if (!ast.oracle) return out;

  // Run every example and every bound pack item through the oracle in one batch; examples whose
  // response cannot be matched by id each get a run of their own.
  const lines = [];
  const examples = [];
  const solos = [];
  for (const r of reqs) {
    r.examples.forEach((ex, k) => {
      if (!opNames.has(ex.op) && !expectsError(ex) && !isRaw(ex)) return;
      const id = exampleId(r, k);
      if (isSolo(ex)) { solos.push({ r, ex, id }); return; }
      examples.push({ r, ex, id });
      lines.push(requestFor(ast, ex, id));
    });
  }
  const packs = [];
  for (const e of ast.edges) {
    if (!e.via || !EDGES[e.name] || !opNames.has(e.via.op)) continue;
    EDGES[e.name].pack.forEach((item, k) => { const id = edgeCaseId(ast, e, k); packs.push({ e, item, id }); lines.push(edgeRequest(ast, e.via, id, item.input)); });
  }
  const run = await runDriver(ast.oracle.command, lines, { cwd: baseDir });
  if (run.error) { d('error', ast.oracle.line, 'T020', `oracle: ${run.error}${run.stderr ? `\n${run.stderr.trim()}` : ''}`); }
  const answers = new Map(run.responses);
  for (const s of solos) {
    const sr = await runDriver(ast.oracle.command, [requestFor(ast, s.ex, s.id)], { cwd: baseDir });
    if (sr.error) d('error', s.ex.line, 'T020', `oracle: ${sr.error}${sr.stderr ? `\n${sr.stderr.trim()}` : ''}`);
    if (sr.list.length === 1 && sr.list[0]) answers.set(s.id, sr.list[0]);
  }
  out.oracle = { ...run, responses: answers };
  for (const { r, ex, id } of [...examples, ...solos]) {
    const resp = answers.get(id);
    if (!resp) { d('error', ex.line, 'T021', `oracle gave no response for ${id}`); continue; }
    if ('oracle_error' in resp) { d('error', ex.line, 'T022', `the oracle cannot compute ${id}: ${resp.oracle_error} (is this example in open territory?)`); continue; }
    for (const e of ex.expects) {
      if (e.kind === 'show') {
        if (!pick(resp, e.path).found) d('error', e.line, 'T025', `${r.id}: the oracle's answer has no ${e.path} to show`);
        continue;
      }
      const h = holds(resp, e);
      if (!h.ok) {
        const want = e.kind === 'approx' ? `${e.value} ± ${e.tol}` : JSON.stringify(e.value);
        d('error', e.line, 'T002', `${r.id} example disagrees with the oracle: ${e.path} should be ${want}, the oracle gives ${h.got === undefined ? '(nothing)' : JSON.stringify(h.got)}`);
      }
    }
    if ('error' in resp && !expectsError(ex) && ex.expects.length === 0) {
      d('warning', ex.line, 'T024', `the oracle answers ${id} with error ${JSON.stringify(resp.error)}; if that is the point, say: expect error = ${JSON.stringify(resp.error)}`);
    }
  }
  for (const { e, item, id } of packs) {
    const resp = answers.get(id);
    if (!resp) { d('error', e.line, 'T021', `oracle gave no response for ${id}`); continue; }
    if ('oracle_error' in resp) { d('error', e.line, 'T022', `the oracle cannot compute ${id} (${item.input}): ${resp.oracle_error}`); continue; }
    const text = edgeText(resp.result, e.via.encoding);
    if (item.refuse ? !('error' in resp) : text !== item.text) {
      d('error', e.line, 'T006', `the oracle disagrees with edge ${e.name} on ${item.input}: expected ${item.refuse ? 'a refusal' : JSON.stringify(item.text)}, got ${JSON.stringify('error' in resp ? { error: resp.error } : text)}`);
    }
  }
  return out;
}
