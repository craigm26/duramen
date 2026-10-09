// Properties: claims over generated inputs, checked against the oracle when a spec is checked
// and against an implementation when the suite runs.
//
// A property draws `samples` sets of bindings from its generators (deterministically, from its
// seed), keeps those its `where` conditions accept, makes its calls in order, and requires every
// `expect` to be exactly true. A call may use earlier calls' responses, so calls run in stages:
// every sample's first call in one driver run, then every second call, and so on. That suits
// drivers that answer only after the end of their input.
import { evaluate, parseExpr, isUndefined, showValue } from './expr.mjs';
import { genType, genJSON, makeRng, seedOf, setOwn } from './types.mjs';

export const propSeed = (pr) => (pr.seed ?? seedOf(pr.id)) >>> 0;

function draw(gen, rng, env) {
  if (gen.kind === 'oneof') return { value: gen.values[Math.floor(rng.next() * gen.values.length)] };
  if (gen.kind === 'json') return { value: genJSON(rng) };
  return genType(gen.type, rng, env);
}

// Draw the samples. Returns { samples: [{ k, bindings }], error, drawn, accepted }.
export function planProperty(pr, typeEnv) {
  const rng = makeRng(propSeed(pr));
  const samples = [];
  let drawn = 0;
  const limit = pr.samples * 20;
  while (samples.length < pr.samples && drawn < limit) {
    drawn++;
    const bindings = {};
    for (const v of pr.vars) {
      const g = draw(v.gen, rng, typeEnv);
      if (g.error) return { samples, error: `${v.name}: ${g.error}`, drawn, accepted: samples.length };
      setOwn(bindings, v.name, g.value);
    }
    const env = new Map(Object.entries(bindings));
    let ok = true;
    for (const w of pr.where) {
      const r = evaluate(w.ast, env);
      if (r !== true) { ok = false; break; }
    }
    if (ok) samples.push({ k: samples.length + 1, bindings });
  }
  return { samples, error: null, drawn, accepted: samples.length };
}

// A serializable description of a property, for the suite file (cases.jsonl).
export function propertyCase(pr, samples, requestMembersFor) {
  return {
    id: `prop:${pr.id}`,
    kind: 'property',
    reqs: [`PROP-${pr.id}`, ...pr.supports.map((r) => `REQ-${r}`)],
    platform: 'any',
    calls: pr.calls.map((c) => ({ name: c.name, op: c.op, input: c.inputText, members: requestMembersFor(c.op) })),
    expects: pr.expects.map((e) => e.text),
    samples: samples.map((s) => s.bindings),
  };
}

const NON_FINITE = (v) => typeof v === 'number' && !Number.isFinite(v);

// Run property cases (as written in cases.jsonl) against a driver.
//   send(lines) -> Promise<{ responses: Map, error }>
// Returns one result per case: { id, failures: [{ sample, bindings, why }], errors: [..] }.
export async function runPropertyCases(cases, send) {
  const parsed = cases.map((pc) => ({
    pc,
    calls: pc.calls.map((c) => ({ ...c, ast: parseExpr(c.input).ast })),
    expects: pc.expects.map((t) => ({ text: t, ast: parseExpr(t).ast })),
    envs: pc.samples.map((b) => new Map(Object.entries(b))),
    broken: pc.samples.map(() => null), // why a sample could not be completed
  }));
  const results = parsed.map(({ pc }) => ({ id: pc.id, failures: [], errors: [], answers: new Map() }));
  const stages = Math.max(0, ...parsed.map((p) => p.calls.length));
  for (let s = 0; s < stages; s++) {
    const lines = [];
    const want = [];
    parsed.forEach((p, pi) => {
      const call = p.calls[s];
      if (!call) return;
      p.envs.forEach((env, si) => {
        if (p.broken[si]) return;
        if (!call.ast) { p.broken[si] = `cannot parse call input ${call.input}`; return; }
        const input = evaluate(call.ast, env);
        if (isUndefined(input)) { p.broken[si] = `cannot build ${call.name}'s input: ${input.why}`; return; }
        if (JSON.stringify(input) === undefined || hasNonFinite(input)) { p.broken[si] = `${call.name}'s input is not JSON: ${showValue(input)}`; return; }
        const id = `${p.pc.id}#${si + 1}.${call.name}`;
        const members = { id, op: call.op };
        for (const [k, v] of Object.entries(call.members ?? {})) if (!['id', 'op', 'input'].includes(k)) setOwn(members, k, v);
        members.input = input;
        const line = JSON.stringify(members);
        lines.push(line);
        want.push({ pi, si, id, name: call.name, line });
      });
    });
    if (!lines.length) continue;
    const run = await send(lines);
    for (const w of want) {
      const resp = run.responses.get(w.id);
      if (!resp) { parsed[w.pi].broken[w.si] = `no response to ${w.name}${run.error ? ` (${run.error})` : ''}`; continue; }
      parsed[w.pi].envs[w.si].set(w.name, resp);
      results[w.pi].answers.set(w.id, { op: parsed[w.pi].calls[s].op, resp, line: w.line });
    }
  }
  parsed.forEach((p, pi) => {
    p.envs.forEach((env, si) => {
      const bindings = p.pc.samples[si];
      if (p.broken[si]) { results[pi].failures.push({ sample: si + 1, bindings, why: p.broken[si] }); return; }
      for (const e of p.expects) {
        if (!e.ast) { results[pi].errors.push(`cannot parse expectation ${e.text}`); continue; }
        const v = evaluate(e.ast, env);
        if (v !== true) {
          results[pi].failures.push({ sample: si + 1, bindings, why: `${e.text} is ${isUndefined(v) ? `undefined: ${v.why}` : showValue(v)}`, env: Object.fromEntries([...env].filter(([k]) => p.calls.some((c) => c.name === k)).map(([k, r]) => [k, r])) });
          break;
        }
      }
    });
  });
  return results;
}

function hasNonFinite(v) {
  if (NON_FINITE(v)) return true;
  if (v && typeof v === 'object') return Object.values(v).some(hasNonFinite);
  return false;
}

export const showBindings = (b) => Object.entries(b).map(([k, v]) => `${k} = ${JSON.stringify(v) ?? String(v)}${Object.is(v, -0) ? ' (-0)' : ''}`).join(', ');
