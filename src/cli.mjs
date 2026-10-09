// The command line. Exit status: 0 everything passed; 1 the spec has errors or the suite failed;
// 2 the command line or a file could not be used; 3 duramen itself failed (a bug: please report).
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { loadRecord } from './record.mjs';
import { check } from './check.mjs';
import { renderSpec, renderDecisions, renderTrace } from './render.mjs';
import { generateCases, runCases } from './suite.mjs';
import { implDriver, killAll, parseCommand } from './driver.mjs';
import { regen } from './regen.mjs';
import { serve } from './serve.mjs';
import { mutate, oracleSources } from './mutate.mjs';
import { agree } from './agree.mjs';
import { diffRecords, behaviorChanges, withBehavior } from './diff.mjs';

export const VERSION = '0.2.0';

const USAGE = `usage:
  duramen check <record> [--strict] [--no-oracle] [--json]
  duramen build <record> [--out <dir>] [--strict] [--json]
  duramen run   <record> (--impl <dir> | --driver "<command>" [--cwd <dir>]) [--repeat <n>] [--timeout <s>]
                [--without-oracle] [--no-static] [--strict] [--json]
  duramen mutate <record> [--file <oracle source>] [--limit <n>] [--jobs <n>] [--json]
  duramen agree  <record> --impl <dir> [--impl <dir> ...] [--oracle] [--samples <n>] [--seed <n>] [--json]
  duramen diff   <old record> <new record> [--no-oracle] [--json]
  duramen regen  <record> --lang ts|py [--model sonnet] [--runs <dir>] [--sandbox-root <dir>] [--leak-terms <file.json>]
                [--prompt <file>] [--run-id <id>] [--max-minutes <n>] [--max-turns <n>] [--json]
                [--agent <base URL> --model <name> [--agent-key-env VAR] [--agent-text-tools]]
                  (--agent: build with an OpenAI-compatible endpoint instead of Claude Code)
  duramen serve  (duramen as a driver: check and cases requests on standard input)
  duramen --version

A record is a .duramen file or a folder of them.`;

// --name value, --name=value, and bare flags. Unknown options are errors.
export function parseArgs(argv, spec) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const [name, inline] = a.slice(2).split(/=(.*)/s, 2);
    if (!(name in spec)) return { error: `unknown option --${name}` };
    if (spec[name] === 'flag') { if (inline !== undefined) return { error: `--${name} takes no value` }; out[name] = true; continue; }
    const v = inline ?? argv[++i];
    if (v === undefined || (inline === undefined && v.startsWith('--'))) return { error: `--${name} needs a value` };
    if (spec[name] === 'list') (out[name] ??= []).push(v);
    else out[name] = v;
  }
  return out;
}

const OPTIONS = {
  check: { strict: 'flag', 'no-oracle': 'flag', json: 'flag', timeout: 'value' },
  build: { out: 'value', strict: 'flag', json: 'flag', timeout: 'value' },
  run: { impl: 'value', driver: 'value', cwd: 'value', repeat: 'value', timeout: 'value', strict: 'flag', json: 'flag', 'without-oracle': 'flag', 'no-static': 'flag' },
  mutate: { file: 'value', limit: 'value', jobs: 'value', timeout: 'value', json: 'flag' },
  agree: { impl: 'list', oracle: 'flag', samples: 'value', seed: 'value', timeout: 'value', json: 'flag' },
  diff: { json: 'flag', 'no-oracle': 'flag' },
  regen: { lang: 'value', model: 'value', runs: 'value', 'sandbox-root': 'value', 'leak-terms': 'value', prompt: 'value', 'run-id': 'value', 'max-minutes': 'value', 'max-turns': 'value', builder: 'value', agent: 'value', 'agent-key-env': 'value', 'agent-text-tools': 'flag', 'agent-context-chars': 'value', 'agent-max-tokens': 'value', json: 'flag' },
};

const shown = (f) => { if (!f) return f; const r = relative(process.cwd(), f); return r && !r.startsWith('..') && !isAbsolute(r) ? r : f; };
const sortDs = (ds) => [...ds].sort((a, b) => (a.file === b.file ? a.line - b.line || (a.col ?? 1) - (b.col ?? 1) : a.file < b.file ? -1 : 1));

export async function main(argv, io = { out: (s) => process.stdout.write(s + '\n'), err: (s) => process.stderr.write(s + '\n') }) {
  const [cmd, ...rest] = argv;
  if (cmd === '--version' || cmd === 'version') { io.out(`duramen ${VERSION}`); return 0; }
  if (cmd === 'serve') {
    if (argv.length > 1) { io.err('duramen serve takes no arguments: it reads requests on standard input'); return 2; }
    await serve();
    return 0;
  }
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { (cmd ? io.out : io.err)(USAGE); return cmd ? 0 : 2; }
  if (!OPTIONS[cmd]) { io.err(`duramen: unknown command "${cmd}"\n${USAGE}`); return 2; }
  const args = parseArgs(rest, OPTIONS[cmd]);
  if (args.error) { io.err(`duramen ${cmd}: ${args.error}\n${USAGE}`); return 2; }
  if (cmd === 'diff') return diffCommand(args, io);
  if (args._.length !== 1) { io.err(`duramen ${cmd}: name one record (a .duramen file or a folder)\n${USAGE}`); return 2; }
  const timeoutMs = args.timeout !== undefined ? Number(args.timeout) * 1000 : undefined;
  if (timeoutMs !== undefined && !(timeoutMs > 0)) { io.err(`duramen ${cmd}: --timeout needs a number of seconds`); return 2; }
  const repeat = args.repeat !== undefined ? Number(args.repeat) : 1;
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) { io.err(`duramen ${cmd}: --repeat needs a whole number from 1 to 10`); return 2; }
  if (cmd === 'run' && !args.impl && !args.driver) { io.err('duramen run: name an implementation (--impl <dir>) or a driver (--driver "<command>")'); return 2; }
  if (cmd === 'mutate') return mutateCommand(args, io, timeoutMs);
  if (cmd === 'agree') return agreeCommand(args, io, timeoutMs);
  if (cmd === 'regen') return regenCommand(args, io);

  const path = resolve(args._[0]);
  const { ast, diagnostics: loadDs } = loadRecord(path);
  if (loadDs.some((d) => d.code === 'P046')) { for (const d of loadDs) io.err(`duramen: ${d.message}`); return 2; }
  const blocked = loadDs.some((d) => d.level === 'error');
  const checked = blocked ? { diagnostics: [], oracle: null, corroboration: [], properties: [] } : await check(ast, { runOracle: !args['no-oracle'], strict: !!args.strict, timeoutMs });
  const ds = sortDs([...loadDs, ...checked.diagnostics]);
  const errors = ds.filter((d) => d.level === 'error').length;
  const warnings = ds.filter((d) => d.level === 'warning').length;
  const reqs = ast.items.filter((i) => i.type === 'req');
  const summary = {
    requirements: reqs.length, examples: reqs.reduce((n, r) => n + r.examples.length, 0), decisions: ast.decisions.length,
    open: ast.items.filter((i) => i.type === 'open').length, edges: ast.edges.length, evidence: ast.evidence.length,
    evidenceRows: ast.evidence.reduce((n, ev) => n + (ev.rows?.length ?? 0), 0), properties: ast.properties.length,
    statics: reqs.reduce((n, r) => n + r.statics.length, 0), errors, warnings,
  };
  const report = { duramen: VERSION, command: cmd, record: shown(path), ok: errors === 0, summary, diagnostics: ds.map((d) => ({ ...d, file: shown(d.file) })), corroboration: checked.corroboration };
  if (!args.json) {
    for (const d of ds) io.out(`${shown(d.file)}:${d.line}:${d.col ?? 1}: ${d.level} ${d.code}: ${d.message}`);
    const extra = [summary.evidence && `${summary.evidence} evidence (${summary.evidenceRows} rows)`, summary.properties && `${summary.properties} properties`, summary.statics && `${summary.statics} static checks`].filter(Boolean);
    io.out(`${errors ? 'FAILED' : 'ok'}: ${summary.requirements} requirements, ${summary.examples} examples, ${summary.decisions} decisions, ${summary.open} open, ${summary.edges} edges${extra.length ? `, ${extra.join(', ')}` : ''}; ${errors} errors, ${warnings} warnings`);
  }
  const done = (code, more = {}) => { if (args.json) io.out(JSON.stringify({ ...report, ...more, ok: code === 0 })); return code; };
  if (errors) return done(1);
  if (cmd === 'check') return done(0);

  const cases = generateCases(ast, checked.oracle, checked.properties);
  if (cmd === 'build') {
    const out = resolve(args.out ?? join(dirname(path), 'build'));
    try {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'SPEC.md'), renderSpec(ast, checked.oracle, { version: VERSION, properties: checked.properties }));
      writeFileSync(join(out, 'DECISIONS.md'), renderDecisions(ast));
      writeFileSync(join(out, 'trace.md'), renderTrace(ast, cases, checked.corroboration));
      writeFileSync(join(out, 'cases.jsonl'), cases.map((c) => JSON.stringify(c)).join('\n') + '\n');
    } catch (e) { io.err(`duramen build: cannot write ${shown(out)}: ${e.code ?? e.message}`); return 2; }
    if (!args.json) io.out(`wrote SPEC.md, DECISIONS.md, trace.md and cases.jsonl (${cases.length} cases) to ${shown(out)}`);
    return done(0, { out: shown(out), cases: cases.length });
  }

  // run
  let command = args.driver;
  if (!command) {
    const d = implDriver(resolve(args.impl));
    if (d.error) { io.err(`duramen run: ${d.error}`); return 2; }
    command = d.command;
  }
  const cwd = resolve(args.cwd ?? args.impl ?? '.');
  const r = await runCases(cases, { command, cwd, implDir: args.impl ? resolve(args.impl) : undefined, repeat, timeoutMs, withoutOracle: !!args['without-oracle'], noStatic: !!args['no-static'] });
  if (!args.json) {
    if (r.driverError) io.out(`driver: ${r.driverError}${r.stderr ? `\n${r.stderr.trim()}` : ''}`);
    for (const f of r.failures) io.out(`  FAIL ${f.id} [${f.reqs.join(', ')}]\n      ${f.why.join('\n      ')}`);
    const kinds = Object.entries(r.tally).map(([k, t]) => `${k} ${t.passed}/${t.total}`).join(', ');
    io.out(`passed ${r.passed}/${r.total}${r.skipped ? ` (skipped ${r.skipped} for this platform)` : ''}${kinds ? ` (${kinds})` : ''}`);
  }
  return done(r.failures.length || r.driverError ? 1 : 0, { run: { passed: r.passed, total: r.total, skipped: r.skipped, tally: r.tally, failures: r.failures, driverError: r.driverError } });
}

async function mutateCommand(args, io, timeoutMs) {
  const path = resolve(args._[0]);
  const { ast, diagnostics } = loadRecord(path);
  if (diagnostics.some((d) => d.level === 'error')) { for (const d of diagnostics.filter((x) => x.level === 'error')) io.out(`${shown(d.file)}:${d.line}:${d.col ?? 1}: ${d.level} ${d.code}: ${d.message}`); return 1; }
  if (!ast.oracle) { io.err('duramen mutate: the record has no oracle'); return 2; }
  const files = args.file ? [resolve(args.file)] : oracleSources(ast);
  if (!files.length) { io.err('duramen mutate: name the oracle\'s source files (oracle ... / source <file>, or --file <path>)'); return 2; }
  const limit = args.limit !== undefined ? Number(args.limit) : undefined;
  const jobs = args.jobs !== undefined ? Number(args.jobs) : undefined;
  if ((limit !== undefined && !(limit > 0)) || (jobs !== undefined && !(jobs > 0))) { io.err('duramen mutate: --limit and --jobs need positive numbers'); return 2; }
  const r = await mutate(ast, files, { limit, jobs, timeoutMs, onProgress: args.json ? undefined : (d, n) => { if (d % 25 === 0 || d === n) io.err(`  ${d}/${n} mutants`); } });
  if (r.error) { io.err(`duramen mutate: ${r.error}`); return 1; }
  if (args.json) { io.out(JSON.stringify({ duramen: VERSION, command: 'mutate', record: shown(path), total: r.total, of: r.of, killed: r.killed, unreached: r.unreached, byCode: r.byCode, unpinned: r.unpinned.map(({ text, ...m }) => m), tolerated: r.tolerated.map(({ text, ...m }) => m), silent: r.silent.map(({ text, ...m }) => m) })); return 0; }
  for (const m of r.unpinned) io.out(`  unpinned ${m.file}:${m.line}:${m.col}: ${m.from} -> ${m.to} changes ${m.beyond.length} answer${m.beyond.length > 1 ? 's' : ''} (${m.beyond.slice(0, 3).join(', ')}${m.beyond.length > 3 ? ', ...' : ''}) and no check notices`);
  for (const m of r.tolerated) io.out(`  within tolerance ${m.file}:${m.line}:${m.col}: ${m.from} -> ${m.to} changes ${m.changed.length} answer${m.changed.length > 1 ? 's' : ''}, all within the ops' tolerances`);
  io.out(`${r.total + r.unreached} mutants of the oracle${r.total < r.of ? ` (${r.total} of ${r.of} reached ones sampled)` : ''}: ${r.killed} caught; ${r.unpinned.length} unpinned (an answer to some check's request changed beyond tolerance, and no check noticed); ${r.tolerated.length} within tolerance; ${r.silent.length} silent (no answer to any check's request changed); ${r.unreached} in code no check runs`);
  io.out(`caught by: ${Object.entries(r.byCode).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ') || 'nothing'}`);
  return 0;
}

async function agreeCommand(args, io, timeoutMs) {
  const path = resolve(args._[0]);
  const { ast, diagnostics } = loadRecord(path);
  if (diagnostics.some((d) => d.level === 'error')) { for (const d of diagnostics.filter((x) => x.level === 'error')) io.out(`${shown(d.file)}:${d.line}:${d.col ?? 1}: ${d.level} ${d.code}: ${d.message}`); return 1; }
  const participants = [];
  if (args.oracle) {
    if (!ast.oracle) { io.err('duramen agree: --oracle, but the record has no oracle'); return 2; }
    participants.push({ name: 'oracle', command: ast.oracle.command, cwd: dirname(ast.oracle.file ?? ast.file) });
  }
  for (const dir of args.impl ?? []) {
    const d = implDriver(resolve(dir));
    if (d.error) { io.err(`duramen agree: ${d.error}`); return 2; }
    participants.push({ name: shown(resolve(dir)), command: d.command, cwd: resolve(dir) });
  }
  if (participants.length < 2) { io.err('duramen agree: name at least two of --impl <dir> (repeatable) and --oracle'); return 2; }
  const samples = args.samples !== undefined ? Number(args.samples) : 50;
  const seed = args.seed !== undefined ? Number(args.seed) : 1;
  if (!(Number.isInteger(samples) && samples > 0 && samples <= 10000) || !Number.isInteger(seed)) { io.err('duramen agree: --samples is 1 to 10000 and --seed a whole number'); return 2; }
  const r = await agree(ast, participants, { samples, seed, timeoutMs });
  if (args.json) { io.out(JSON.stringify({ duramen: VERSION, command: 'agree', record: shown(path), participants: participants.map((p) => p.name), ...r })); return r.disagreements.length || r.errors.length ? 1 : 0; }
  for (const e of r.errors) io.out(`  ${e.name}: ${e.error}`);
  for (const s of r.skipped) io.out(`  skipped ${s.op}: ${s.why}`);
  for (const dis of r.disagreements.slice(0, 20)) {
    io.out(`  ${dis.id} ${dis.op} ${JSON.stringify(dis.input)}`);
    for (const g of dis.groups) io.out(`      ${g.names.join(', ')}: ${g.answer ? JSON.stringify(g.answer).slice(0, 160) : '(no answer)'}`);
  }
  if (r.disagreements.length > 20) io.out(`  ... and ${r.disagreements.length - 20} more`);
  io.out(`${participants.length} participants, ${r.requests} generated requests: ${r.disagreements.length} disagreements`);
  return r.disagreements.length || r.errors.length ? 1 : 0;
}

async function regenCommand(args, io) {
  const path = resolve(args._[0]);
  const { ast, diagnostics } = loadRecord(path);
  if (diagnostics.some((d) => d.level === 'error')) { io.err('duramen regen: the record has errors; run duramen check'); return 1; }
  if (!['ts', 'py'].includes(args.lang)) { io.err('duramen regen: --lang ts or --lang py'); return 2; }
  let leakTerms = {};
  if (args['leak-terms']) { try { leakTerms = JSON.parse(readFileSync(resolve(args['leak-terms']), 'utf8')); } catch (e) { io.err(`duramen regen: --leak-terms: ${e.message}`); return 2; } }
  const maxMinutes = args['max-minutes'] !== undefined ? Number(args['max-minutes']) : 60;
  if (!(maxMinutes > 0)) { io.err('duramen regen: --max-minutes needs a positive number'); return 2; }
  let builder;
  if (args.builder) { const p = parseCommand(args.builder); if (p.error) { io.err(`duramen regen: --builder: ${p.error}`); return 2; } builder = p.words; }
  // --agent <base URL>: build with any OpenAI-compatible endpoint (llama.cpp, Ollama, LM Studio,
  // vLLM, a vendor's API) through lib/regen/agent.mjs instead of Claude Code.
  let agent = null;
  if (args.agent) {
    if (!/^https?:\/\//.test(args.agent)) { io.err('duramen regen: --agent needs an http(s) base URL, such as http://127.0.0.1:8080/v1'); return 2; }
    if (!args.model) { io.err('duramen regen: --agent needs --model, the name the endpoint serves'); return 2; }
    agent = { baseUrl: args.agent, apiKeyEnv: args['agent-key-env'], textTools: !!args['agent-text-tools'], contextChars: args['agent-context-chars'] ? Number(args['agent-context-chars']) : undefined, maxTokens: args['agent-max-tokens'] ? Number(args['agent-max-tokens']) : undefined };
  }
  const maxTurns = args['max-turns'] !== undefined ? Number(args['max-turns']) : (agent ? 200 : 400);
  if (!(Number.isInteger(maxTurns) && maxTurns > 0)) { io.err('duramen regen: --max-turns needs a whole number'); return 2; }
  const r = await regen(ast, {
    lang: args.lang, model: args.model ?? 'sonnet', runsDir: resolve(args.runs ?? join(dirname(path), 'regen')),
    sandboxRoot: resolve(args['sandbox-root'] ?? join(tmpdir(), 'duramen-regen')), leakTerms, promptFile: args.prompt ? resolve(args.prompt) : undefined,
    runId: args['run-id'], maxMinutes, maxTurns, version: VERSION, builder, agent, log: args.json ? () => {} : (m) => io.err(`  ${m}`),
  });
  if (r.error) { io.err(`duramen regen: ${r.error}`); return 1; }
  if (args.json) io.out(JSON.stringify(r.entry));
  else {
    io.out(`run ${r.entry.run}: ${r.entry.model_id ?? r.entry.model} (${r.entry.lang}), ${r.entry.turns ?? '?'} turns, ${r.entry.duration_min ?? '?'} min, ${r.entry.cost_usd === null ? '?' : `$${r.entry.cost_usd.toFixed(2)}`}`);
    io.out(`  audit: ${r.audit.violations} violations, init ${r.audit.init.ok ? 'ok' : `not ok (${r.audit.init.problems.join('; ')})`}, ${r.audit.denied_calls} denied calls`);
    io.out(`  suite: ${r.score.error ?? `passed ${r.score.passed}/${r.score.total}`}`);
    for (const f of r.score.failures ?? []) io.out(`    FAIL ${f.id}: ${f.why.join('; ').slice(0, 200)}`);
    io.out(`  build copied to ${shown(r.impl)}; ${r.entry.choices.total} choices to triage in ${shown(join(resolve(args.runs ?? join(dirname(path), 'regen')), `${r.entry.run}-${r.entry.lang}.md`))}`);
  }
  return !r.score.error && r.score.passed === r.score.total && r.audit.violations === 0 ? 0 : 1;
}

async function diffCommand(args, io) {
  if (args._.length !== 2) { io.err(`duramen diff: name two records, the old one and the new one\n${USAGE}`); return 2; }
  const [A, B] = args._.map((p) => loadRecord(resolve(p)));
  for (const [x, p] of [[A, args._[0]], [B, args._[1]]]) {
    if (x.diagnostics.some((d) => d.code === 'P046')) { io.err(`duramen diff: cannot read ${p}`); return 2; }
    if (x.diagnostics.some((d) => d.level === 'error')) { io.err(`duramen diff: ${p} has errors; run duramen check on it first`); return 1; }
  }
  let r = diffRecords(A.ast, B.ast);
  // the old version's examples, through the new version's oracle
  if (!args['no-oracle']) r = withBehavior(r, A.ast, B.ast, await behaviorChanges(A.ast, B.ast));
  if (args.json) { io.out(JSON.stringify({ duramen: VERSION, command: 'diff', ...r })); return r.version.ok === false ? 1 : 0; }
  for (const kind of ['breaking', 'tightening', 'additive', 'relaxing', 'prose']) {
    const cs = r.changes.filter((c) => c.kind === kind);
    if (!cs.length) continue;
    io.out(`${kind} (${cs.length}):`);
    for (const c of cs) io.out(`  ${c.what}`);
  }
  if (r.contract) io.out(`contract version: ${r.contract[0] ?? '(none)'} -> ${r.contract[1] ?? '(none)'}`);
  if (r.behavior?.ran) io.out(`behavior: ${r.behavior.compared} old example${r.behavior.compared === 1 ? '' : 's'} the new record no longer has, run through the new oracle${r.behavior.error ? ` (oracle: ${r.behavior.error})` : ''}`);
  const v = r.version;
  io.out(`version ${v.from} -> ${v.to}: ${v.ok === null ? v.why : v.ok ? `ok (${v.bump}${v.need !== 'none' ? `, needs ${v.need}` : ''})` : `too small: ${v.why}`}`);
  return v.ok === false ? 1 : 0;
}

export async function cli(argv) {
  const stop = (sig, code) => process.once(sig, () => { killAll(); process.exit(code); });
  stop('SIGINT', 130);
  stop('SIGTERM', 143);
  let code;
  try {
    code = await main(argv);
  } catch (e) {
    killAll();
    process.stderr.write(`duramen: internal error: ${e?.message ?? e}\nThis is a bug in duramen; please report it with the command you ran.${process.env.DURAMEN_DEBUG ? `\n${e?.stack}` : ' (set DURAMEN_DEBUG=1 for a stack trace)'}\n`);
    code = 3;
  }
  process.exitCode = code;
}
