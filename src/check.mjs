// `duramen check`: everything that can be known about a spec before any implementation exists.
// Structural rules are checked first; then every example, every evidence row, every property
// and every bound edge pack is run through the oracle. Examples written `?` take the oracle's
// value; everything else is a claim the oracle must agree with. A requirement that nothing but
// the oracle backs is reported (T032), because then the spec is only as right as its model.
import { dirname } from 'node:path';
import { runDriver } from './driver.mjs';
import { checkType, refsOf } from './types.mjs';
import { planProperty, propertyCase, runPropertyCases, showBindings } from './property.mjs';

const OBLIGATION = /\b(MUST|MUST NOT|SHALL|SHALL NOT|REQUIRED)\b/;
const STATUSES = ['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'];
const ORDER_WORDS = /\b(in this order|in the order|first that applies|first match|precede[sd]?|before|after|takes? precedence)\b/i;

const v02 = (ast) => (ast.version ?? '0.1') >= '0.2';

export function exampleId(req, k) { return `${req.id}#${k + 1}`; }
export const evidenceCaseId = (ev, row) => `ev:${ev.id}#${row.rowId}`;

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

export const typeEnv = (ast) => new Map(ast.types.map((t) => [t.name, t.type]));

// Two edges bound to the same op and field are two claims about the same output. Where their
// packs share an input and expect different things, a spec cannot hold both.
export function packConflicts(lib, a, b) {
  const out = [];
  const A = lib.defs.get(a)?.pack ?? [];
  const B = lib.defs.get(b)?.pack ?? [];
  for (const x of A) {
    const y = B.find((i) => i.input === x.input);
    if (!y) continue;
    const say = (i) => (i.refuse ? 'an error' : JSON.stringify(i.text));
    if (!!x.refuse !== !!y.refuse || x.text !== y.text) out.push({ input: x.input, a: say(x), b: say(y) });
  }
  return out;
}

// Which inputs each requirement's checks come from. "Independent" means: not the oracle.
export function corroboration(ast) {
  const reqs = ast.items.filter((i) => i.type === 'req');
  return reqs.map((r) => {
    let typed = 0, shown = 0;
    for (const ex of r.examples) {
      if (!ex.expects.length) shown++;
      for (const e of ex.expects) { if (e.kind === 'show') shown++; else typed++; }
    }
    const evidence = ast.evidence.filter((ev) => ev.supports.includes(r.id)).reduce((n, ev) => n + (ev.rows?.length ?? 0), 0);
    const properties = ast.properties.filter((p) => p.supports.includes(r.id)).length;
    const statics = r.statics.length;
    const independent = typed + evidence + properties + statics;
    return { id: r.id, typed, shown, evidence, properties, statics, oracleOnly: independent === 0 && shown > 0 };
  });
}

export async function check(ast, { runOracle = true, strict = false, timeoutMs, env: processEnv } = {}) {
  const ds = [];
  const d = (level, node, code, message, col) => ds.push({ level, file: node?.file ?? ast.file, line: node?.line ?? 1, col: col ?? node?.col ?? 1, code, message });
  const reqs = ast.items.filter((i) => i.type === 'req');
  const opens = ast.items.filter((i) => i.type === 'open');
  const opNames = new Set(ast.ops.map((o) => o.name));
  const decisionIds = new Set(ast.decisions.map((x) => x.id));
  const reqIds = new Set(reqs.map((r) => r.id));
  const lib = ast.edgeLib ?? { defs: new Map(), families: new Map() };
  const env = typeEnv(ast);
  const newer = v02(ast);

  // IDs are unique: REQ-x, OPEN-x, PROP-x, EV-x and decision IDs (REQ-WB-002 and OPEN-WB-002 may coexist).
  const seen = new Map();
  const allIds = [
    ...reqs.map((x) => [x, `REQ-${x.id}`]), ...opens.map((x) => [x, `OPEN-${x.id}`]),
    ...ast.properties.map((x) => [x, `PROP-${x.id}`]), ...ast.evidence.map((x) => [x, `EV-${x.id}`]),
    ...ast.decisions.map((x) => [x, x.id]),
  ];
  for (const [x, id] of allIds) {
    if (seen.has(id)) d('error', x, 'T007', `duplicate ID ${id} (first at ${seen.get(id)})`);
    else seen.set(id, `${x.file === ast.file ? '' : `${x.file}:`}line ${x.line}`);
  }

  // Types: declared once, every name known, no cycle that never reaches a structure.
  const typeSeen = new Map();
  for (const t of ast.types) {
    if (typeSeen.has(t.name)) d('error', t, 'T034', `type ${t.name} is declared twice`);
    typeSeen.set(t.name, t);
    for (const n of refsOf(t.type)) if (!env.has(n)) d('error', t, 'T034', `type ${t.name} uses ${n}, which is not declared`);
  }
  const directRefs = (t) => (t.kind === 'ref' ? [t.name] : t.kind === 'union' ? t.of.flatMap(directRefs) : []);
  for (const t of ast.types) {
    const stack = [...directRefs(t.type)];
    const visited = new Set();
    while (stack.length) {
      const n = stack.pop();
      if (n === t.name) { d('error', t, 'T034', `type ${t.name} refers to itself without a structure in between`); break; }
      if (visited.has(n) || !env.has(n)) continue;
      visited.add(n);
      stack.push(...directRefs(env.get(n)));
    }
  }
  for (const op of ast.ops) {
    for (const f of op.inputs) {
      if (f.typeError) { if (newer) d('error', f, 'T040', `${op.name} input ${f.name}: "${f.type}" is not a type (${f.typeError})`, f.col); continue; }
      if (newer) for (const n of refsOf(f.parsed)) if (!env.has(n)) d('error', f, 'T034', `${op.name} input ${f.name} uses type ${n}, which is not declared`, f.col);
    }
    if (op.returns) for (const n of refsOf(op.returns)) if (!env.has(n)) d('error', op, 'T034', `${op.name} returns type ${n}, which is not declared`);
  }

  // Inputs against declared types (0.2): an example that sends a value of the wrong type must
  // say what error it expects; otherwise it is not an example of the requirement.
  const inputProblems = (opName, input) => {
    const op = ast.ops.find((o) => o.name === opName);
    if (!op || !newer) return [];
    const out = [];
    for (const f of op.inputs) {
      if (!f.parsed || !(f.name in input)) continue;
      const why = checkType(f.parsed, input[f.name], env, `.${f.name}`);
      if (why) out.push(why);
    }
    return out;
  };

  const codes = [...new Set(ast.errors.map((e) => e.code))];
  for (const r of reqs) {
    // T001: every obligation has at least one evaluation.
    if (r.examples.length === 0 && r.statics.length === 0 && !ast.properties.some((p) => p.supports.includes(r.id)) && !ast.evidence.some((ev) => ev.supports.includes(r.id))) {
      d('error', r, 'T001', `${r.id} has no example, table row, static check, property or evidence: every requirement needs an evaluation`);
    }
    for (const id of r.decisions) if (!decisionIds.has(id)) d('error', r, 'T008', `${r.id} cites ${id}, which is not declared`);
    if (r.statics.length && !newer) d('error', r.statics[0], 'T037', 'static checks need duramen 0.2');
    for (const ex of r.examples) {
      const op = ast.ops.find((o) => o.name === ex.op);
      if (expectsError(ex) || isRaw(ex)) {
        for (const e of ex.expects.filter((y) => y.path === 'error')) {
          if (!codes.includes(e.value)) d('error', e, 'T023', `${JSON.stringify(e.value)} is not an error code declared in "errors"`);
        }
        continue;
      }
      if (!op) { d('error', ex, 'T009', `unknown op "${ex.op}"`); continue; }
      for (const f of op.inputs) if (!f.optional && !(f.name in ex.input)) d('error', ex, 'T010', `${ex.op} input is missing required field "${f.name}"`);
      for (const k of Object.keys(ex.input)) if (!op.inputs.some((f) => f.name === k)) d('warning', ex, 'T011', `${ex.op} has no input field "${k}"`);
      for (const why of inputProblems(ex.op, ex.input)) d('error', ex, 'T029', `${r.id}: the input does not have ${ex.op}'s declared types (${why}); an example of a bad input says which error it expects`);
    }
    // T005: order is declared once (`errors`), never restated in prose.
    const named = codes.filter((c) => r.text.includes(c));
    if (named.length >= 2 && ORDER_WORDS.test(r.text)) {
      d('error', { file: r.file, line: r.textLine ?? r.line }, 'T005', `${r.id} restates the order of ${named.join(', ')}; that order is declared once, in "errors" (line ${ast.errors[0]?.line})`);
    }
  }
  for (const e of ast.edges) for (const id of e.decisions) if (!decisionIds.has(id)) d('error', e, 'T008', `edge ${e.name} cites ${id}, which is not declared`);

  // Evidence: well-formed, about real ops and requirements, waivers that name real rows.
  for (const ev of ast.evidence) {
    for (const id of ev.decisions) if (!decisionIds.has(id)) d('error', ev, 'T008', `evidence ${ev.id} cites ${id}, which is not declared`);
    for (const id of ev.supports) if (!reqIds.has(id)) d('error', ev, 'T039', `evidence ${ev.id} supports REQ-${id}, which is not declared`);
    if (!ev.supports.length) d('warning', ev, 'T039', `evidence ${ev.id} supports no requirement; say which (supports <req id>)`);
    if (!newer) d('error', ev, 'T037', 'evidence needs duramen 0.2');
    for (const t of ev.tables) if (!opNames.has(t.op)) d('error', { file: ev.file, line: t.line }, 'T036', `evidence ${ev.id}: unknown op "${t.op}"`);
    const rowIds = new Set((ev.rows ?? []).map((r) => r.rowId));
    for (const w of ev.waivers) {
      if (!rowIds.has(w.row)) d('error', { file: ev.file, line: w.line }, 'T036', `evidence ${ev.id} waives row ${w.row}, which it does not have`);
      if (!decisionIds.has(w.decision)) d('error', { file: ev.file, line: w.line }, 'T008', `evidence ${ev.id} waives row ${w.row} citing ${w.decision}, which is not declared`);
    }
    for (const row of ev.rows ?? []) {
      const op = ast.ops.find((o) => o.name === row.op);
      if (!op) continue;
      for (const f of op.inputs) if (!f.optional && !(f.name in row.input)) d('error', { file: ev.file, line: row.line }, 'T010', `evidence ${ev.id} row ${row.rowId}: ${row.op} input is missing required field "${f.name}"`);
      for (const why of inputProblems(row.op, row.input)) d('error', { file: ev.file, line: row.line }, 'T029', `evidence ${ev.id} row ${row.rowId}: the input does not have ${row.op}'s declared types (${why})`);
    }
  }

  // Properties: real ops, drawable generators, requirements that exist.
  for (const pr of ast.properties) {
    if (!newer) d('error', pr, 'T037', 'properties need duramen 0.2');
    for (const id of pr.decisions) if (!decisionIds.has(id)) d('error', pr, 'T008', `property ${pr.id} cites ${id}, which is not declared`);
    for (const id of pr.supports) if (!reqIds.has(id)) d('error', pr, 'T039', `property ${pr.id} supports REQ-${id}, which is not declared`);
    if (!pr.supports.length) d('warning', pr, 'T039', `property ${pr.id} supports no requirement; say which (supports <req id>)`);
    for (const c of pr.calls) if (!opNames.has(c.op)) d('error', { file: pr.file, line: c.line }, 'T035', `property ${pr.id} calls unknown op "${c.op}"`);
    for (const v of pr.vars) if (v.gen.kind === 'type') for (const n of refsOf(v.gen.type)) if (!env.has(n)) d('error', { file: pr.file, line: v.line }, 'T034', `property ${pr.id}: type ${n} is not declared`);
  }

  // Decisions have a lifecycle (the states are Chad Fowler's, from "The Specification Is Not a
  // Document"). Only an accepted decision, or one with no status, carries a requirement.
  for (const x of ast.decisions) {
    if (!x.status) continue;
    const word = x.status.split(/\s+/)[0];
    if (!STATUSES.includes(word)) d('error', x, 'T027', `${x.id} has status "${word}"; use one of ${STATUSES.join(', ')}`);
    const by = x.status.match(/^superseded by (\S+)$/);
    if (word === 'superseded' && !(by && decisionIds.has(by[1]))) d('error', x, 'T027', `${x.id} is superseded: say by which declared decision ("superseded by D-…")`);
  }
  const resting = [
    ...reqs.map((r) => [r, `REQ-${r.id}`]),
    ...ast.edges.map((e) => [e, `edge ${e.name}`]),
    ...ast.properties.map((p) => [p, `PROP-${p.id}`]),
    ...ast.evidence.map((ev) => [ev, `evidence ${ev.id}`]),
  ];
  for (const [r, who] of resting) {
    for (const id of r.decisions) {
      const word = ast.decisions.find((y) => y.id === id)?.status?.split(/\s+/)[0];
      if (['contested', 'superseded', 'rejected'].includes(word)) d('error', r, 'T028', `${who} rests on ${id}, which is ${word}`);
      else if (['observed', 'inferred', 'proposed'].includes(word)) d('warning', r, 'T028', `${who} rests on ${id}, which is only ${word}, not accepted`);
    }
  }
  for (const x of ast.decisions) {
    const cited = resting.some(([r]) => r.decisions.includes(x.id)) || ast.evidence.some((ev) => ev.waivers.some((w) => w.decision === x.id));
    if (!cited) d('warning', x, 'T012', `${x.id} is not cited by any requirement, edge, property or evidence`);
    if (!x.source) d('warning', x, 'T013', `${x.id} has no "source" (where the claim came from)`);
  }
  // T004: obligations live in requirements (and in the edge texts a spec imports). Anywhere
  // else, an RFC 2119 keyword is an error, unless it is quoted ("..." or `...`), as when a
  // decision quotes an earlier text.
  const keyword = (text) => (text ?? '').replace(/"[^"\n]*"|“[^”\n]*”|`[^`\n]*`/g, '').match(OBLIGATION);
  const place = [
    ...ast.items.filter((i) => i.type === 'note' || i.type === 'section').map((i) => [i.text, i, `a ${i.type}`]),
    [ast.spec?.text, ast.spec ?? { line: 1 }, "the spec's text"],
    ...ast.decisions.flatMap((x) => [[x.text, x, `decision ${x.id}`], ...x.rejected.map((t) => [t, x, `decision ${x.id}`])]),
    ...ast.ops.map((o) => [o.summary, o, `op ${o.name}`]),
    ...ast.errors.map((e) => [e.when, e, 'the errors list']),
    ...ast.evidence.map((ev) => [ev.text, ev, `evidence ${ev.id}`]),
    ...ast.properties.map((p) => [p.text, p, `property ${p.id}`]),
  ];
  for (const [text, node, where] of place) {
    const m = keyword(text);
    if (m) d('error', node, 'T004', `"${m[1]}" in ${where}: obligations belong in a req, where they get an ID and an evaluation`);
  }
  for (const o of opens) {
    for (const n of o.exampleLines ?? []) d('error', { file: o.file, line: n }, 'T003', `open ${o.id} cannot have examples: open behavior is never tested`);
    const m = keyword(o.text);
    if (m) d('warning', o, 'T014', `"${m[1]}" in open ${o.id}: open behavior should not be obligatory`);
  }
  // Edges: known, unambiguous, bound to a real op.
  for (const e of ast.edges) {
    if (lib.families.has(e.name)) d('error', e, 'T015', `edge "${e.name}" is ambiguous; say which: ${lib.families.get(e.name).join(' or ')}`);
    else if (!lib.defs.has(e.name)) d('error', e, 'T016', `unknown edge "${e.name}"`);
    if (e.via && !opNames.has(e.via.op)) d('error', e, 'T017', `edge ${e.name} is bound to unknown op "${e.via.op}"`);
    if (lib.defs.has(e.name) && !e.via) d('info', e, 'T018', `edge ${e.name} is not bound to an op: its definition is in the brief, but no pack cases reach the suite`);
  }
  // T026: two edges bound to the same op and field that disagree on a shared input.
  const bound = ast.edges.filter((e) => e.via && lib.defs.has(e.name));
  for (let i = 0; i < bound.length; i++) {
    for (let j = i + 1; j < bound.length; j++) {
      const [a, b] = [bound[i], bound[j]];
      if (a.via.op !== b.via.op || a.via.field !== b.via.field) continue;
      for (const c of packConflicts(lib, a.name, b.name)) {
        d('error', b, 'T026', `edges ${a.name} (line ${a.line}) and ${b.name} disagree on ${c.input}: ${a.name} expects ${c.a}, ${b.name} expects ${c.b}; one ${a.via.op} cannot do both`);
      }
    }
  }

  // T032: a requirement whose only checks are the oracle's own answers.
  const corr = corroboration(ast);
  if (newer) for (const c of corr) if (c.oracleOnly) d(strict ? 'error' : 'warning', reqs.find((r) => r.id === c.id), 'T032', `REQ-${c.id} rests on the oracle alone: every value its examples check is the oracle's; add a typed value, evidence or a property`);

  const hasRuns = reqs.some((r) => r.examples.length > 0) || ast.properties.length > 0 || ast.evidence.some((ev) => ev.rows?.length);
  if (!ast.oracle && hasRuns) d('error', ast.spec ?? { line: 1 }, 'T019', 'no oracle: examples cannot be computed');
  else if (!ast.oracle && bound.length) d('info', ast.spec ?? { line: 1 }, 'T019', 'no oracle: the edge packs were not run against a model of this spec');

  const out = { diagnostics: ds, oracle: null, corroboration: corr, properties: [] };
  if (!ast.oracle || !runOracle) return out;
  const cwd = dirname(ast.oracle.file ?? ast.file);
  const runOpts = { cwd, ...(timeoutMs ? { timeoutMs } : {}), ...(processEnv ? { env: processEnv } : {}) };

  // Run every example, evidence row and bound pack item through the oracle in one batch;
  // examples whose response cannot be matched by id each get a run of their own.
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
  const rows = [];
  for (const ev of ast.evidence) {
    for (const row of ev.rows ?? []) {
      if (!opNames.has(row.op)) continue;
      const id = evidenceCaseId(ev, row);
      rows.push({ ev, row, id });
      lines.push(requestFor(ast, row, id));
    }
  }
  const packs = [];
  for (const e of ast.edges) {
    if (!e.via || !lib.defs.has(e.name) || !opNames.has(e.via.op)) continue;
    lib.defs.get(e.name).pack.forEach((item, k) => { const id = edgeCaseId(ast, e, k); packs.push({ e, item, id }); lines.push(edgeRequest(ast, e.via, id, item.input)); });
  }
  // One run for everything that is matched by id; none when there is nothing to send.
  const run = lines.length ? await runDriver(ast.oracle.command, lines, runOpts) : { responses: new Map(), list: [], order: [], error: null };
  if (run.error) d('error', ast.oracle, 'T020', `oracle: ${run.error}${run.stderr ? `\n${run.stderr.trim()}` : ''}`);
  const answers = new Map(run.responses);
  for (const s of solos) {
    const sr = await runDriver(ast.oracle.command, [requestFor(ast, s.ex, s.id)], runOpts);
    if (sr.error) d('error', s.ex, 'T020', `oracle: ${sr.error}${sr.stderr ? `\n${sr.stderr.trim()}` : ''}`);
    if (sr.list.length === 1 && sr.list[0]) answers.set(s.id, sr.list[0]);
  }
  out.oracle = { ...run, responses: answers };

  // The oracle's results must have the types the ops declare.
  const returnsOk = (opName, resp, node, what) => {
    const op = ast.ops.find((o) => o.name === opName);
    if (!op?.returns || !resp || !('result' in resp)) return;
    const why = checkType(op.returns, resp.result, env, 'result');
    if (why) d('error', node, 'T038', `the oracle's answer to ${what} does not have ${opName}'s declared result type (${why})`);
  };

  for (const { r, ex, id } of [...examples, ...solos]) {
    const resp = answers.get(id);
    if (!resp) { d('error', ex, 'T021', `oracle gave no response for ${id}`); continue; }
    if ('oracle_error' in resp) { d('error', ex, 'T022', `the oracle cannot compute ${id}: ${resp.oracle_error} (is this example in open territory?)`); continue; }
    returnsOk(ex.op, resp, ex, id);
    for (const e of ex.expects) {
      if (e.kind === 'show') {
        if (!pick(resp, e.path).found) d('error', e, 'T025', `${r.id}: the oracle's answer has no ${e.path} to show`);
        continue;
      }
      const h = holds(resp, e);
      if (!h.ok) {
        const want = e.kind === 'approx' ? `${e.value} ± ${e.tol}` : JSON.stringify(e.value);
        d('error', e, 'T002', `${r.id} example disagrees with the oracle: ${e.path} should be ${want}, the oracle gives ${h.got === undefined ? '(nothing)' : JSON.stringify(h.got)}`);
      }
    }
    if ('error' in resp && !expectsError(ex) && ex.expects.length === 0) {
      d('warning', ex, 'T024', `the oracle answers ${id} with error ${JSON.stringify(resp.error)}; if that is the point, say: expect error = ${JSON.stringify(resp.error)}`);
    }
  }

  // Evidence against the oracle: a disagreement is an error unless a decision waives the row.
  for (const { ev, row, id } of rows) {
    const resp = answers.get(id);
    const at = { file: ev.file, line: row.line };
    if (!resp) { d('error', at, 'T021', `oracle gave no response for ${id}`); continue; }
    if ('oracle_error' in resp) { d('error', at, 'T022', `the oracle cannot compute ${id}: ${resp.oracle_error}`); continue; }
    returnsOk(row.op, resp, at, id);
    const waiver = ev.waivers.find((w) => w.row === row.rowId);
    const bad = row.expects.map((e) => ({ e, h: holds(resp, e) })).filter((x) => !x.h.ok);
    row.oracleAgrees = bad.length === 0;
    if (bad.length && !waiver) {
      const { e, h } = bad[0];
      const want = e.kind === 'approx' ? `${e.value} ± ${e.tol}` : JSON.stringify(e.value);
      d('error', at, 'T030', `evidence ${ev.id} row ${row.rowId}${row.dataFile ? ` (${row.dataFile}:${row.dataLine})` : ''} disagrees with the oracle: ${e.path} is ${want} in the evidence, the oracle gives ${h.got === undefined ? '(nothing)' : JSON.stringify(h.got)}${bad.length > 1 ? ` (and ${bad.length - 1} more)` : ''}; fix the oracle, or waive the row with a decision`);
    }
    if (!bad.length && waiver) d('warning', { file: ev.file, line: waiver.line }, 'T036', `evidence ${ev.id} waives row ${row.rowId}, but the oracle agrees with it; drop the waiver`);
  }

  for (const { e, item, id } of packs) {
    const resp = answers.get(id);
    if (!resp) { d('error', e, 'T021', `oracle gave no response for ${id}`); continue; }
    if ('oracle_error' in resp) { d('error', e, 'T022', `the oracle cannot compute ${id} (${item.input}): ${resp.oracle_error}`); continue; }
    const text = edgeText(resp.result, e.via.encoding);
    if (item.refuse ? !('error' in resp) : text !== item.text) {
      d('error', e, 'T006', `the oracle disagrees with edge ${e.name} on ${item.input}: expected ${item.refuse ? 'a refusal' : JSON.stringify(item.text)}, got ${JSON.stringify('error' in resp ? { error: resp.error } : text)}`);
    }
  }

  // Properties against the oracle.
  const runnable = ast.properties.filter((p) => p.calls.every((c) => opNames.has(c.op)));
  const planned = [];
  for (const pr of runnable) {
    const plan = planProperty(pr, env);
    if (plan.error) { d('error', pr, 'T035', `property ${pr.id} cannot draw its inputs: ${plan.error}`); continue; }
    if (plan.accepted < pr.samples) d('warning', pr, 'T035', `property ${pr.id}: its where conditions accepted ${plan.accepted} of ${plan.drawn} draws, fewer than the ${pr.samples} samples asked for`);
    if (!plan.accepted) continue;
    planned.push({ pr, plan, pc: propertyCase(pr, plan.samples, (op) => requestMembers(ast, op)) });
  }
  const propResults = await runPropertyCases(planned.map((p) => p.pc), (ls) => runDriver(ast.oracle.command, ls, runOpts));
  planned.forEach(({ pr, pc }, i) => {
    const res = propResults[i];
    out.properties.push({ id: pr.id, samples: pc.samples.length, case: pc, failures: res.failures, answers: res.answers });
    for (const err of res.errors) d('error', pr, 'T035', `property ${pr.id}: ${err}`);
    if (res.failures.length) {
      const f = res.failures[0];
      d('error', pr, 'T031', `the oracle breaks property ${pr.id} on ${res.failures.length} of ${pc.samples.length} samples; first: ${showBindings(f.bindings)}: ${f.why}`);
    }
  });
  return out;
}
