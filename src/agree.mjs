// `duramen agree`: run several implementations (and the oracle) on the same generated requests
// and show where they disagree. Blind builds are independent evidence about the oracle: where
// two builds agree with each other and not with the oracle, the oracle is the suspect. Every
// disagreement is either a bug in someone, or behavior the spec leaves open; triage turns it
// into a pinned example or an open item.
import { genType, makeRng, seedOf, setOwn } from './types.mjs';
import { typeEnv, requestMembers } from './check.mjs';
import { runDriver } from './driver.mjs';
import { answerDiffers } from './suite.mjs';

// The type an input field is drawn from: the op's `draw` type for it, else its input type.
const drawType = (op, f) => (op.draws ?? []).find((x) => x.name === f.name)?.parsed ?? f.parsed;

// Requests for every op whose inputs all have types: `samples` drawn inputs per op.
export function agreeRequests(ast, { samples = 50, seed = 1 } = {}) {
  const env = typeEnv(ast);
  const out = [];
  const skipped = [];
  for (const op of ast.ops) {
    if (!op.inputs.every((f) => drawType(op, f))) { skipped.push({ op: op.name, why: 'an input has no type duramen can draw from' }); continue; }
    const rng = makeRng((seedOf(op.name) ^ seed) >>> 0);
    for (let k = 1; k <= samples; k++) {
      const input = {};
      let error = null;
      for (const f of op.inputs) {
        if (f.optional && rng.next() < 0.3) continue;
        const g = genType(drawType(op, f), rng, env);
        if (g.error) { error = g.error; break; }
        setOwn(input, f.name, g.value);
      }
      if (error) { skipped.push({ op: op.name, why: error }); break; }
      const id = `agree:${op.name}#${k}`;
      const members = { id, op: op.name };
      for (const [m, v] of Object.entries(requestMembers(ast, op.name))) if (!['id', 'op', 'input'].includes(m)) setOwn(members, m, v);
      members.input = input;
      out.push({ id, op: op.name, input, line: JSON.stringify(members) });
    }
  }
  return { requests: out, skipped };
}

// participants: [{ name, command, cwd }]. Returns { requests, disagreements, errors }.
export async function agree(ast, participants, opts = {}) {
  const { requests, skipped } = agreeRequests(ast, opts);
  const runs = [];
  for (const p of participants) runs.push({ p, run: await runDriver(p.command, requests.map((r) => r.line), { cwd: p.cwd, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) }) });
  const errors = runs.filter((x) => x.run.error).map((x) => ({ name: x.p.name, error: x.run.error }));
  const disagreements = [];
  for (const r of requests) {
    const op = ast.ops.find((o) => o.name === r.op);
    // group participants whose answers agree (within the op's tolerances, audit byte for byte)
    const groups = [];
    for (const { p, run } of runs) {
      const resp = run.responses.get(r.id);
      const full = resp ? { members: Object.keys(resp).sort(), error: resp.error, result: resp.result, audit: op?.audit ? resp.audit : undefined, tolerances: op?.tolerances ?? {} } : null;
      const g = groups.find((x) => (x.full === null && full === null) || (x.full && full && answerDiffers(x.full, resp).length === 0));
      if (g) g.names.push(p.name);
      else groups.push({ names: [p.name], full, resp: resp ?? null });
    }
    if (groups.length > 1) disagreements.push({ id: r.id, op: r.op, input: r.input, groups: groups.map((g) => ({ names: g.names, answer: g.resp })) });
  }
  return { requests: requests.length, skipped, disagreements, errors };
}
