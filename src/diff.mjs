// `duramen diff`: what changed between two versions of a record, and whether the version number
// says so. Changes are sorted by what they do to an implementation that met the old version:
//
//   breaking    the contract changed: an expected value changed, an op or a requirement went
//               away, an input became required or changed type, the error order changed
//   tightening  new checks on behavior the old version already described: a new example,
//               evidence row, property, pack, static check or result type; an implementation
//               that met the old prose still passes, one that only passed the old suite may not
//   additive    new surface: a new op, a new optional input, a new requirement on new ops
//   relaxing    it still passes: a check removed, behavior made open
//   prose       wording only: requirement text, decisions, notes; types in a 0.1 record
//
// A breaking change needs a new major version (before 1.0, a new minor: 0.MINOR.PATCH, as npm
// reads it); tightening and additive changes a new minor; the rest a new patch.
import { requestFor } from './check.mjs';

const KINDS = ['breaking', 'tightening', 'additive', 'relaxing', 'prose'];

const exampleKey = (ast, ex) => (ex.rawLine !== undefined ? `raw ${ex.rawLine}` : requestFor(ast, ex, '_'));
const expectKey = (e) => JSON.stringify([e.path, e.kind, e.kind === 'show' ? null : e.value, e.tol ?? null]);

export function diffRecords(a, b) {
  const changes = [];
  const add = (kind, what) => changes.push({ kind, what });
  const typedA = (a.version ?? '0.1') >= '0.2'; // in 0.1, input types were documentation
  const reqsA = new Map(a.items.filter((i) => i.type === 'req').map((r) => [r.id, r]));
  const reqsB = new Map(b.items.filter((i) => i.type === 'req').map((r) => [r.id, r]));
  const opensA = new Set(a.items.filter((i) => i.type === 'open').map((o) => o.id));
  const opensB = new Set(b.items.filter((i) => i.type === 'open').map((o) => o.id));

  // operations
  const opsA = new Map(a.ops.map((o) => [o.name, o]));
  const opsB = new Map(b.ops.map((o) => [o.name, o]));
  for (const [n] of opsA) if (!opsB.has(n)) add('breaking', `op ${n} removed`);
  for (const [n, o] of opsB) {
    const old = opsA.get(n);
    if (!old) { add('additive', `op ${n} added`); continue; }
    for (const f of o.inputs) {
      const g = old.inputs.find((x) => x.name === f.name);
      if (!g) add(f.optional ? 'additive' : 'breaking', `${n}: input ${f.name} added${f.optional ? ' (optional)' : ' (required)'}`);
      else {
        if (g.optional && !f.optional) add('breaking', `${n}: input ${f.name} is now required`);
        if (!g.optional && f.optional) add('relaxing', `${n}: input ${f.name} is now optional`);
        if (g.type !== f.type) add(typedA ? 'breaking' : 'prose', `${n}: input ${f.name} type ${g.type} -> ${f.type}${typedA ? '' : ' (0.1 types were documentation)'}`);
      }
    }
    for (const g of old.inputs) if (!o.inputs.some((f) => f.name === g.name)) add('breaking', `${n}: input ${g.name} removed`);
    if ((old.returnsText ?? '') !== (o.returnsText ?? '')) add(!old.returnsText ? 'tightening' : !o.returnsText ? 'relaxing' : 'breaking', `${n}: result type ${old.returnsText ?? '(none)'} -> ${o.returnsText ?? '(none)'}`);
    if (JSON.stringify(old.tolerances) !== JSON.stringify(o.tolerances)) {
      for (const [p, t] of Object.entries(o.tolerances)) { const u = old.tolerances[p]; if (u === undefined || t < u) add('tightening', `${n}: tolerance ${p} ${u ?? 'exact'} -> ${t}`); else if (t > u) add('relaxing', `${n}: tolerance ${p} ${u} -> ${t}`); }
      for (const [p, u] of Object.entries(old.tolerances)) if (!(p in o.tolerances)) add('tightening', `${n}: tolerance ${p} ${u} -> exact`);
    }
    if (!!old.audit !== !!o.audit) add('breaking', `${n}: ${o.audit ? 'now has' : 'no longer has'} an audit`);
    if (JSON.stringify(old.request) !== JSON.stringify(o.request)) add('breaking', `${n}: request members changed`);
    if (old.summary !== o.summary) add('prose', `${n}: result summary reworded`);
  }
  if (JSON.stringify(a.errors.map((e) => e.code)) !== JSON.stringify(b.errors.map((e) => e.code))) add('breaking', `error order ${a.errors.map((e) => e.code).join(', ')} -> ${b.errors.map((e) => e.code).join(', ')}`);
  else a.errors.forEach((e, i) => { if (e.when !== b.errors[i].when) add('prose', `error ${e.code}: condition reworded`); });
  if (JSON.stringify(a.spec?.request ?? {}) !== JSON.stringify(b.spec?.request ?? {})) add('breaking', 'the members every request carries changed');

  // requirements and their examples
  for (const [id] of reqsA) if (!reqsB.has(id)) add(opensB.has(id) ? 'relaxing' : 'breaking', `REQ-${id} removed${opensB.has(id) ? ' (now open)' : ''}`);
  for (const [id, r] of reqsB) {
    const old = reqsA.get(id);
    if (!old) {
      // a new requirement constrains existing ops (or the implementation folder) unless every
      // example it has is about an op the old version did not have
      const onlyNewOps = r.statics.length === 0 && r.examples.length > 0 && r.examples.every((ex) => ex.op && !opsA.has(ex.op));
      add(opensA.has(id) || !onlyNewOps ? 'tightening' : 'additive', `REQ-${id} added${opensA.has(id) ? ' (was open)' : ''}`);
      continue;
    }
    if (old.text !== r.text) add('prose', `REQ-${id}: text changed`);
    if (old.platform !== r.platform) add('breaking', `REQ-${id}: platform ${old.platform} -> ${r.platform}`);
    const exA = new Map(old.examples.map((ex) => [exampleKey(a, ex), ex]));
    const exB = new Map(r.examples.map((ex) => [exampleKey(b, ex), ex]));
    for (const [k, ex] of exB) {
      const prev = exA.get(k);
      if (!prev) { add('tightening', `REQ-${id}: example added (line ${ex.line})`); continue; }
      const ea = new Set(prev.expects.map(expectKey));
      const eb = new Set(ex.expects.map(expectKey));
      const pathsA = new Set(prev.expects.map((e) => e.path));
      for (const e of ex.expects) if (!ea.has(expectKey(e))) add(pathsA.has(e.path) ? 'breaking' : 'tightening', `REQ-${id}: expectation ${e.path} ${pathsA.has(e.path) ? 'changed' : 'added'} (line ${ex.line})`);
      for (const e of prev.expects) if (!eb.has(expectKey(e)) && !ex.expects.some((x) => x.path === e.path)) add('relaxing', `REQ-${id}: expectation ${e.path} removed (line ${ex.line})`);
    }
    for (const [k, ex] of exA) if (!exB.has(k)) add('relaxing', `REQ-${id}: example removed (was line ${ex.line})`);
    const sa = new Set(old.statics.map((s) => JSON.stringify({ ...s, line: 0, file: 0 })));
    const sb = new Set(r.statics.map((s) => JSON.stringify({ ...s, line: 0, file: 0 })));
    for (const s of sb) if (!sa.has(s)) add('tightening', `REQ-${id}: static check added or changed (${JSON.parse(s).kind})`);
    for (const s of sa) if (!sb.has(s)) add('relaxing', `REQ-${id}: static check removed or changed (${JSON.parse(s).kind})`);
    if (JSON.stringify(old.decisions) !== JSON.stringify(r.decisions)) add('prose', `REQ-${id}: decisions ${old.decisions.join(', ') || '(none)'} -> ${r.decisions.join(', ') || '(none)'}`);
  }
  for (const id of opensB) if (!opensA.has(id) && !reqsA.has(id)) add('relaxing', `OPEN-${id} added`);
  for (const id of opensA) if (!opensB.has(id) && !reqsB.has(id)) add('tightening', `OPEN-${id} removed`);

  // properties, evidence, edges
  const props = (x) => new Map(x.properties.map((p) => [p.id, JSON.stringify([p.vars.map((v) => [v.name, v.gen.text]), p.where.map((w) => w.text), p.calls.map((c) => [c.name, c.op, c.inputText]), p.expects.map((e) => e.text)])]));
  const pa = props(a), pb = props(b);
  for (const [id, sig] of pb) { if (!pa.has(id)) add('tightening', `PROP-${id} added`); else if (pa.get(id) !== sig) add('breaking', `PROP-${id} changed`); }
  for (const [id] of pa) if (!pb.has(id)) add('relaxing', `PROP-${id} removed`);
  // evidence rows, counted per evidence statement
  const rows = (x) => new Map(x.evidence.map((ev) => [ev.id, new Map((ev.rows ?? []).filter((r) => !ev.waivers.some((w) => w.row === r.rowId)).map((r) => [r.rowId, JSON.stringify([r.op, r.input, r.expects.map(expectKey)])]))]));
  const ra = rows(a), rb = rows(b);
  for (const id of new Set([...ra.keys(), ...rb.keys()])) {
    const A2 = ra.get(id) ?? new Map(), B2 = rb.get(id) ?? new Map();
    const added = [...B2.keys()].filter((k) => !A2.has(k)).length;
    const changed = [...B2.keys()].filter((k) => A2.has(k) && A2.get(k) !== B2.get(k)).length;
    const removed = [...A2.keys()].filter((k) => !B2.has(k)).length;
    if (added) add('tightening', `EV-${id}: ${added} row${added > 1 ? 's' : ''} added`);
    if (changed) add('breaking', `EV-${id}: ${changed} row${changed > 1 ? 's' : ''} changed`);
    if (removed) add('relaxing', `EV-${id}: ${removed} row${removed > 1 ? 's' : ''} removed or waived`);
  }
  const bind = (x) => new Set(x.edges.filter((e) => e.via).map((e) => `${e.name} via ${e.via.op} ${e.via.field}`));
  const ba = bind(a), bb = bind(b);
  for (const e of bb) if (!ba.has(e)) add('tightening', `edge ${e} bound`);
  for (const e of ba) if (!bb.has(e)) add('relaxing', `edge ${e} unbound`);

  // decisions
  const dA = new Map(a.decisions.map((d) => [d.id, d]));
  for (const d of b.decisions) {
    const old = dA.get(d.id);
    if (!old) add('prose', `${d.id} added: ${d.title}`);
    else {
      if ((old.status ?? 'accepted') !== (d.status ?? 'accepted')) add('prose', `${d.id}: status ${old.status ?? 'accepted'} -> ${d.status ?? 'accepted'}`);
      if (old.text !== d.text || JSON.stringify(old.rejected) !== JSON.stringify(d.rejected)) add('prose', `${d.id}: text changed`);
    }
  }
  for (const d of a.decisions) if (!b.decisions.some((x) => x.id === d.id)) add('prose', `${d.id} removed`);

  const worst = KINDS.find((k) => changes.some((c) => c.kind === k)) ?? null;
  return { changes, worst, version: versionVerdict(a.spec?.version, b.spec?.version, worst), contract: a.spec?.contract !== b.spec?.contract ? [a.spec?.contract ?? null, b.spec?.contract ?? null] : null };
}

// Is the version bump big enough? Semantic versions only; anything else is reported as unchecked.
export function versionVerdict(from, to, worst) {
  const parse = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v ?? ''); return m ? m.slice(1, 4).map(Number) : null; };
  const A = parse(from), B = parse(to);
  if (!A || !B) return { from, to, ok: null, why: 'not semantic versions; not checked' };
  const bump = B[0] > A[0] ? 'major' : B[0] === A[0] && B[1] > A[1] ? 'minor' : B[0] === A[0] && B[1] === A[1] && B[2] > A[2] ? 'patch' : B.join() === A.join() ? 'none' : 'down';
  const pre1 = A[0] === 0;
  const need = worst === 'breaking' ? (pre1 ? 'minor' : 'major') : worst === 'tightening' || worst === 'additive' ? 'minor' : worst === 'relaxing' || worst === 'prose' ? 'patch' : 'none';
  const rank = { none: 0, patch: 1, minor: 2, major: 3, down: -1 };
  return { from, to, bump, need, ok: rank[bump] >= rank[need], why: rank[bump] >= rank[need] ? '' : `the changes are ${worst}; that needs at least a ${need} bump${pre1 ? ' (before 1.0, the minor carries breaking changes)' : ''}` };
}
