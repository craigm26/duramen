// `duramen regen`: one regeneration, end to end. Build the brief from the record, give it to a
// blind builder in a fresh sandbox, audit what the builder did, score what it built with the
// record's own suite, and write the run down. The loop the regen experiments ran by hand
// (sandbox, leak check, launch, audit, score, ledger) is part of the tool, so anyone can rerun
// it and get a comparable record.
//
// The builder is Claude Code run non-interactively (`claude -p`) in the sandbox's work folder,
// with an environment built from an allow-list (what the CLI needs to reach the model, nothing
// of the caller's session or credentials), only file and shell tools, shell commands limited to
// the language's toolchain, no web or MCP tools. Blind means the builder was not shown the
// reference or earlier builds; it does not mean the model never saw similar code in training.
//
// The audit and the leak check are adapted from the regen kit's audit-transcript.mjs and
// leak-check.mjs (MIT, Copyright (c) 2026 craigm26).
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, cpSync, existsSync, openSync, closeSync, appendFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, normalize } from 'node:path';
import { check } from './check.mjs';
import { renderSpec, renderDecisions } from './render.mjs';
import { generateCases, runCases } from './suite.mjs';
import { implDriver } from './driver.mjs';
import { LIB_DIR } from './record.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const KEEP_ENV = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TERM', 'TZ', 'TMPDIR', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST', 'SYSTEMROOT', 'SystemRoot', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP'];
export const LANG_RULES = {
  ts: ['Bash(node *)', 'Bash(npm test*)', 'Bash(npm run *)'],
  py: ['Bash(py *)', 'Bash(python *)', 'Bash(python3 *)'],
};
const BRIEF_FILES = ['SPEC.md', 'DECISIONS.md', 'PROMPT.md'];

// ---------- leak check: nothing in the work folder may name the reference or a local path
const LOCAL_PATHS = [/[A-Za-z]:[\\/]Users[\\/]/i, /(^|[\s"'`(])\/c\/Users\//i, /(^|[\s"'`(])\/home\/[a-z]/i, /(^|[\s"'`(])\/Users\/[A-Za-z]/];
export function leakCheck(dir, { identifiers = [], symbols = [], allow = [] } = {}) {
  const hits = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        const at = `${relative(dir, p)}:${i + 1}`;
        for (const id of identifiers) if (line.toLowerCase().includes(id.toLowerCase())) hits.push(`${at} names "${id}"`);
        for (const s of symbols) if (!allow.includes(s) && line.includes(s)) hits.push(`${at} uses the symbol "${s}"`);
        for (const re of LOCAL_PATHS) if (re.test(line)) hits.push(`${at} has a local path`);
      });
    }
  };
  walk(dir);
  return hits;
}

// ---------- the transcript audit: what the builder did, judged from its tool calls
const NET = [/\bcurl\b/, /\bwget\b/, /Invoke-WebRequest/i, /\bgit\s+clone\b/, /(^|[\s;&|])gh\s/, /\bnpm\s+(i|install|add)\b/, /\bpip3?\b/, /\bgo\s+get\b/, /\buv\s+(pip|add)\b/];
const CODE_HOSTS = ['github.com', 'raw.githubusercontent.com', 'registry.npmjs.org', 'pypi.org', 'proxy.golang.org'];

export function auditTranscript(text, workDir, { identifiers = [], allowedDomains = [], family = 'sonnet' } = {}) {
  const WORK = normalize(resolve(workDir));
  const lines = text.split('\n').filter((l) => l.trim()).map((l, i) => { try { return JSON.parse(l); } catch { return { type: 'unparseable', line: i + 1 }; } });
  const init = lines.find((l) => l.type === 'system' && l.subtype === 'init') ?? {};
  const initProblems = [];
  if (normalize(resolve(init.cwd ?? '')).toLowerCase() !== WORK.toLowerCase()) initProblems.push(`cwd ${init.cwd} is not the work folder`);
  const tools = [...(init.tools ?? [])].sort().join(',');
  if (tools !== 'Bash,Edit,Glob,Grep,Read,Write') initProblems.push(`tools ${tools}`);
  if ((init.mcp_servers ?? []).length) initProblems.push(`mcp_servers ${JSON.stringify(init.mcp_servers)}`);
  if (init.permissionMode !== 'dontAsk') initProblems.push(`permissionMode ${init.permissionMode}`);
  // `family` is a family (`sonnet`, which the CLI resolves to a dated model) or a full model ID.
  const asked = String(family);
  const served = init.model ?? '';
  const fits = asked.startsWith('claude-') ? served === asked || served.startsWith(`${asked}-`) : served.startsWith(`claude-${asked}-`);
  if (!fits) initProblems.push(`model ${init.model} is not ${asked.startsWith('claude-') ? asked : `a ${asked} model`}`);
  if (lines.filter((l) => l.type === 'system' && l.subtype === 'init').length !== 1) initProblems.push('not exactly one init line');
  const outside = (p) => {
    if (p === undefined || p === null || p === '') return null;
    const s = String(p);
    if (/^~|\$HOME|%USERPROFILE%/i.test(s)) return 'home reference';
    if (/(^|[\\/])\.claude([\\/]|$)/.test(s)) return '.claude';
    const abs = isAbsolute(s) || /^[a-zA-Z]:/.test(s) ? normalize(s) : normalize(resolve(WORK, s));
    const rel = relative(WORK, abs);
    return rel.startsWith('..') || isAbsolute(rel) ? 'outside the work folder' : null;
  };
  const pathViolations = [], netViolations = [], recognition = [];
  let readSpec = false;
  for (const l of lines) {
    if (l.type !== 'assistant') continue;
    for (const c of l.message?.content ?? []) {
      if (c.type === 'text') { if (!readSpec) for (const id of identifiers) if (c.text.toLowerCase().includes(id.toLowerCase())) recognition.push(id); continue; }
      if (c.type !== 'tool_use') continue;
      const inp = c.input ?? {};
      if (c.name === 'Read' && /SPEC\.md$/i.test(String(inp.file_path ?? ''))) readSpec = true;
      if (['Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit'].includes(c.name)) {
        for (const k of ['file_path', 'path', 'notebook_path']) { const why = outside(inp[k]); if (why) pathViolations.push({ tool: c.name, arg: inp[k], why }); }
        if (['Write', 'Edit'].includes(c.name)) for (const h of CODE_HOSTS) if (String(inp.content ?? inp.new_string ?? '').includes(h)) netViolations.push({ tool: c.name, host: h, rule: 'code-host address in written code' });
      }
      if (c.name === 'Bash') {
        const full = String(inp.command ?? '');
        // heredoc bodies and inline scripts are code the builder wrote, not paths it used
        const cmd = full.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n([\s\S]*?)\n\2(?=\n|$)/g, '<<$2$3').replace(/(\s-[ec]\s+)("(?:[^"\\]|\\[\s\S])*"|'[^']*')/g, '$1<script>'); // a double-quoted script may hold \" and other escapes
        for (const t of cmd.split(/[\s;&|<>()'"=]+/).filter((x) => x && (/^(~|\$HOME|%USERPROFILE%|[a-zA-Z]:[\\/])/i.test(x) || x === '..' || /(^|[\\/])(\.\.|[\w.-]*\w[\w.-]*)[\\/]|[\\/][\w.-]*\w[\w.-]*$/.test(x)))) {
          if (/^https?:/i.test(t) || t === '/dev/null' || t.startsWith('-')) continue;
          const why = outside(t.replace(/,+$/, ''));
          if (why) pathViolations.push({ tool: 'Bash', arg: t, command: full.slice(0, 200), why });
        }
        for (const re of NET) if (re.test(cmd)) netViolations.push({ command: cmd.slice(0, 200), rule: String(re) });
        for (const m of cmd.matchAll(/https?:\/\/([^/\s'"]+)/gi)) if (!allowedDomains.includes(m[1].toLowerCase())) netViolations.push({ command: cmd.slice(0, 200), rule: `host ${m[1]}` });
      }
      if (['WebFetch', 'WebSearch'].includes(c.name) || c.name.startsWith('mcp__')) netViolations.push({ tool: c.name });
    }
  }
  const result = [...lines].reverse().find((l) => l.type === 'result') ?? null;
  const denied = result ? (result.permission_denials?.length ?? 0) : lines.filter((l) => l.type === 'system' && l.subtype === 'permission_denied').length;
  return {
    init: { ok: initProblems.length === 0, problems: initProblems, model: init.model ?? null },
    path_violations: pathViolations,
    network_violations: netViolations,
    denied_calls: denied,
    denied_detail: (result?.permission_denials ?? []).map((x) => ({ tool: x.tool_name, input: JSON.stringify(x.tool_input).slice(0, 200) })),
    recognized_reference: recognition.length > 0,
    recognition_before_spec: [...new Set(recognition)],
    violations: pathViolations.length + netViolations.length + (initProblems.length ? 1 : 0),
    result: result ? { subtype: result.subtype, turns: result.num_turns, duration_ms: result.duration_ms, cost_usd: result.total_cost_usd ?? null, is_error: result.is_error } : null,
  };
}

// The audit of an agent builder's transcript (lib/regen/agent.mjs). The agent enforces its own
// confinement; the audit checks it from the record: one init line naming the work folder and
// the six tools, no tool call that reached outside the folder or ran a command off the
// toolchain, and refusals counted as denied calls.
export function auditAgentTranscript(text, workDir, { identifiers = [], lang = 'ts' } = {}) {
  const WORK = normalize(resolve(workDir));
  const lines = text.split('\n').filter((l) => l.trim()).map((l, i) => { try { return JSON.parse(l); } catch { return { type: 'unparseable', line: i + 1 }; } });
  const inits = lines.filter((l) => l.type === 'init');
  const init = inits[0] ?? {};
  const initProblems = [];
  if (inits.length !== 1) initProblems.push('not exactly one init line');
  if (init.builder !== 'duramen-agent') initProblems.push(`builder ${init.builder}`);
  if (normalize(resolve(init.cwd ?? '')).toLowerCase() !== WORK.toLowerCase()) initProblems.push(`cwd ${init.cwd} is not the work folder`);
  if ([...(init.tools ?? [])].sort().join(',') !== 'edit_file,finish,list_files,read_file,run,write_file') initProblems.push(`tools ${(init.tools ?? []).join(',')}`);
  const pathViolations = [], netViolations = [], recognition = [];
  let readSpec = false, denied = 0;
  for (const l of lines) {
    if (l.type === 'assistant' && typeof l.content === 'string' && !readSpec) for (const id of identifiers) if (l.content.toLowerCase().includes(id.toLowerCase())) recognition.push(id);
    if (l.type !== 'tool_result') continue;
    if (l.refused) { denied++; continue; }
    const input = l.input ?? {};
    if (l.name === 'read_file' && /SPEC\.md$/i.test(input.path ?? '')) readSpec = true;
    if (['read_file', 'write_file', 'edit_file', 'list_files'].includes(l.name)) {
      const p = input.path ?? '.';
      const rel = relative(WORK, resolve(WORK, String(p)));
      if (rel.startsWith('..') || isAbsolute(rel)) pathViolations.push({ tool: l.name, path: String(p).slice(0, 200) });
    }
    if (l.name === 'run') {
      const cmd = String(input.command ?? '');
      for (const re of NET) if (re.test(cmd)) netViolations.push({ command: cmd.slice(0, 200), rule: String(re) });
      const first = cmd.trim().split(/\s+/)[0];
      const ok = lang === 'py' ? ['python', 'python3', 'py'].includes(first) : ['node', 'npm'].includes(first);
      if (!ok) pathViolations.push({ tool: 'run', command: cmd.slice(0, 200) });
    }
  }
  const result = [...lines].reverse().find((l) => l.type === 'result') ?? null;
  return {
    init: { ok: initProblems.length === 0, problems: initProblems, model: result?.served_model ?? init.model ?? null },
    path_violations: pathViolations,
    network_violations: netViolations,
    denied_calls: denied,
    denied_detail: lines.filter((l) => l.type === 'tool_result' && l.refused).slice(0, 20).map((l) => ({ tool: l.name, input: JSON.stringify(l.input).slice(0, 200), why: l.refused })),
    recognized_reference: recognition.length > 0,
    recognition_before_spec: [...new Set(recognition)],
    violations: pathViolations.length + netViolations.length + (initProblems.length ? 1 : 0),
    result: result ? { subtype: result.subtype, turns: result.turns, duration_ms: result.duration_ms, cost_usd: null, is_error: result.subtype === 'error', served_model: result.served_model ?? null, usage: result.usage ?? null } : null,
  };
}

// Launch the builder and wait for it. Settles once, whatever happens: a builder that cannot be
// started, one that exits, and one that outlives --max-minutes. At the deadline it is asked to
// stop (SIGTERM to its process group); after a grace period it is killed with its descendants,
// and the launch settles even if it still has not closed.
export function launch(work, meta, { prompt, model, lang, maxTurns, maxMinutes, builder = ['claude'], agent = null, killGraceMs = 10_000 }) {
  const env = {};
  for (const k of KEEP_ENV) if (process.env[k] !== undefined) env[k] = process.env[k];
  Object.assign(env, { GOPROXY: 'off', GOTOOLCHAIN: 'local', npm_config_offline: 'true', PIP_NO_INDEX: '1' }); // package managers fail closed
  if (agent?.apiKeyEnv && process.env[agent.apiKeyEnv] !== undefined) env[agent.apiKeyEnv] = process.env[agent.apiKeyEnv];
  writeFileSync(join(meta, 'env-names.txt'), Object.keys(env).sort().join('\n') + '\n');
  const allowed = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(mkdir *)', 'Bash(ls *)', 'Bash(git init*)', 'Bash(git add *)', 'Bash(git commit *)', ...LANG_RULES[lang]];
  // The agent builder (lib/regen/agent.mjs) talks to an OpenAI-compatible endpoint and writes
  // its own transcript to standard output, as Claude Code's stream-json does.
  const args = agent
    ? [join(LIB_DIR, 'regen', 'agent.mjs'), '--base-url', agent.baseUrl, '--model', model, '--work', work, '--prompt-file', join(work, 'PROMPT.md'), '--lang', lang,
      '--max-turns', String(maxTurns), '--max-minutes', String(maxMinutes), ...(agent.apiKeyEnv ? ['--api-key-env', agent.apiKeyEnv] : []), ...(agent.textTools ? ['--text-tools'] : []),
      ...(agent.contextChars ? ['--context-chars', String(agent.contextChars)] : []), ...(agent.maxTokens ? ['--max-tokens', String(agent.maxTokens)] : [])]
    : ['-p', prompt, '--model', model, '--restricted', '--safe-mode', '--tools', 'Read,Write,Edit,Glob,Grep,Bash',
      '--disallowedTools', 'WebFetch', 'WebSearch', 'mcp__*', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--allowedTools', ...allowed,
      '--max-turns', String(maxTurns), '--no-session-persistence', '--output-format', 'stream-json', '--verbose'];
  if (agent) builder = [process.execPath];
  const out = openSync(join(meta, 'transcript.jsonl'), 'w');
  const err = openSync(join(meta, 'stderr.log'), 'w');
  return new Promise((done) => {
    const [program, ...pre] = builder;
    const timers = [];
    let settled = false;
    let timedOut = false;
    const settle = (r) => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      for (const fd of [out, err]) { try { closeSync(fd); } catch { /* already closed */ } }
      done(timedOut ? { ...r, timedOut: true, error: r.error ?? `stopped after --max-minutes ${maxMinutes}` } : r);
    };
    let child;
    try {
      child = spawn(program, [...pre, ...args], { cwd: work, env, stdio: ['ignore', out, err], detached: process.platform !== 'win32' });
    } catch (e) { settle({ code: null, error: e.message }); return; }
    const stop = (signal) => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') { if (signal === 'SIGKILL') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else child.kill(signal); }
        else process.kill(-child.pid, signal);
      } catch { try { child.kill(signal); } catch { /* gone */ } }
    };
    timers.push(setTimeout(() => {
      timedOut = true;
      stop('SIGTERM');
      timers.push(setTimeout(() => {
        stop('SIGKILL');
        timers.push(setTimeout(() => settle({ code: null, error: `did not stop within ${killGraceMs * 2} ms of --max-minutes ${maxMinutes}, and was killed` }), killGraceMs));
      }, killGraceMs));
    }, maxMinutes * 60_000));
    child.on('error', (e) => settle({ code: null, error: e.message }));
    child.on('close', (code, signal) => settle({ code, ...(signal ? { signal } : {}) }));
  });
}

const choicesIn = (text) => [...text.matchAll(/^## (C-\d+):\s*(.*)$/gm)].map((m) => ({ id: m[1], title: m[2].trim() }));

// One regeneration. Returns the ledger entry.
export async function regen(ast, opts) {
  const { lang, model = 'sonnet', family = model, sandboxRoot, runsDir, leakTerms = {}, promptFile, runId, maxTurns = 400, maxMinutes = 60, version, builder, agent = null, log = () => {} } = opts;
  if (!LANG_RULES[lang]) throw new Error(`--lang is ts or py, not ${lang}`);
  // 1. the brief
  const checked = await check(ast);
  const errors = checked.diagnostics.filter((d) => d.level === 'error');
  if (errors.length) return { error: `the record has ${errors.length} errors; run duramen check` };
  const spec = renderSpec(ast, checked.oracle, { version, properties: checked.properties });
  const decisions = renderDecisions(ast);
  const promptTemplate = readFileSync(promptFile ?? join(LIB_DIR, 'regen', `prompt.${lang}.md`), 'utf8');
  const prompt = promptTemplate.replaceAll('{{name}}', ast.spec.name);
  // 2. the sandbox: <root>/<six random letters>/{w,meta}
  const sandboxId = Array.from(randomBytes(6), (b) => String.fromCharCode(97 + (b % 26))).join('');
  const sb = join(sandboxRoot, sandboxId);
  const work = join(sb, 'w'), meta = join(sb, 'meta');
  mkdirSync(work, { recursive: true });
  mkdirSync(meta, { recursive: true });
  writeFileSync(join(work, 'SPEC.md'), spec);
  writeFileSync(join(work, 'DECISIONS.md'), decisions);
  writeFileSync(join(work, 'PROMPT.md'), prompt);
  const leaks = leakCheck(work, leakTerms);
  if (leaks.length) return { error: `leak check failed before launch:\n  ${leaks.join('\n  ')}`, sandbox: sb };
  log(`sandbox ${sandboxId}: brief written, leak check ok; launching ${model} (${lang})`);
  // 3. the builder
  const t0 = Date.now();
  const launched = await launch(work, meta, { prompt, model, lang, maxTurns, maxMinutes, builder, agent });
  const transcript = existsSync(join(meta, 'transcript.jsonl')) ? readFileSync(join(meta, 'transcript.jsonl'), 'utf8') : '';
  log(`builder exited with ${launched.code ?? launched.error} after ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  // 4. the audit
  const audit = agent
    ? auditAgentTranscript(transcript, work, { identifiers: leakTerms.identifiers ?? [], lang })
    : auditTranscript(transcript, work, { identifiers: leakTerms.identifiers ?? [], allowedDomains: leakTerms.allowedDomains ?? [], family });
  writeFileSync(join(meta, 'audit.json'), JSON.stringify(audit, null, 1));
  // 5. copy the build out of the sandbox (without the brief)
  const id = runId ?? `${new Date().toISOString().slice(0, 10)}-${sandboxId}`;
  const impl = join(runsDir, 'impl', `${id}-${lang}`);
  mkdirSync(impl, { recursive: true });
  cpSync(work, impl, { recursive: true, filter: (p) => { const r = relative(work, p); return !BRIEF_FILES.includes(r) && !/^(\.git|node_modules|__pycache__)([\\/]|$)/.test(r) && !/[\\/]__pycache__([\\/]|$)/.test(r); } });
  // 6. the score: the record's own suite, static checks included
  let score;
  const drv = implDriver(impl);
  if (drv.error) score = { error: drv.error };
  else {
    const cases = generateCases(ast, checked.oracle, checked.properties);
    const r = await runCases(cases, { command: drv.command, cwd: impl, implDir: impl });
    score = { passed: r.passed, total: r.total, tally: r.tally, failures: r.failures.map((f) => ({ id: f.id, why: f.why.slice(0, 3) })) };
  }
  writeFileSync(join(meta, 'score.json'), JSON.stringify(score, null, 1));
  // 7. the ledger and a draft run record
  const choices = existsSync(join(impl, 'CHOICES.md')) ? choicesIn(readFileSync(join(impl, 'CHOICES.md'), 'utf8')) : [];
  const entry = {
    run: id, kind: 'blind', date: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), record: `${ast.spec.name} ${ast.spec.version}`,
    brief: { spec_sha256: sha256(spec), decisions_sha256: sha256(decisions), prompt_sha256: sha256(prompt), duramen: version },
    model, model_id: audit.init.model, lang, sandbox_id: sandboxId,
    isolation: agent
      ? `duramen agent builder (${agent.baseUrl}): file tools confined to the work folder, commands limited to the language's toolchain, no network tools`
      : 'claude -p from duramen regen (allow-listed environment, file and shell tools only)',
    ...(agent ? { builder: { kind: 'agent', base_url: agent.baseUrl, served_model: audit.result?.served_model ?? null } } : {}),
    exit: launched.code ?? launched.error,
    audit: { violations: audit.violations, init_ok: audit.init.ok, denied_calls: audit.denied_calls, recognized_reference: audit.recognized_reference },
    turns: audit.result?.turns ?? null, duration_min: audit.result ? +(audit.result.duration_ms / 60000).toFixed(1) : null, cost_usd: audit.result?.cost_usd ?? null,
    suite: score.error ? { error: score.error } : { passed: score.passed, total: score.total },
    choices: { total: choices.length, triaged: false },
    clean: null, // set after the CHOICES triage
    transcript_sha256: sha256(transcript),
  };
  mkdirSync(join(runsDir), { recursive: true });
  appendFileSync(join(runsDir, 'ledger.jsonl'), JSON.stringify(entry) + '\n');
  const md = [
    `# ${id}: ${model}, ${lang}, ${ast.spec.name} ${ast.spec.version}`,
    `- Date / exit / duration / turns / cost: ${entry.date.slice(0, 10)} / ${entry.exit} / ${entry.duration_min ?? '?'} min / ${entry.turns ?? '?'} turns / ${entry.cost_usd === null ? '?' : `$${entry.cost_usd.toFixed(2)}`}`,
    `- Isolation and audit: init_ok ${audit.init.ok ? 'y' : 'n'}; violations ${audit.violations}; denied calls ${audit.denied_calls}; recognized reference ${audit.recognized_reference ? 'y' : 'n'}`,
    `- Model: \`${audit.init.model}\` (sandbox \`${sandboxId}\`)`,
    `- Brief: generated by duramen ${version} from ${ast.spec.name} ${ast.spec.version} (SPEC.md sha256 ${entry.brief.spec_sha256.slice(0, 12)})`,
    `- duramen suite: ${score.error ? score.error : `passed ${score.passed}/${score.total} (${Object.entries(score.tally).map(([k, t]) => `${k} ${t.passed}/${t.total}`).join(', ')})`}`,
    '- Clean run: not yet decided (triage the choices below)',
    '', '## CHOICES triage', '| C-id | Builder\'s choice | Triage | Action |', '|---|---|---|---|',
    ...choices.map((c) => `| ${c.id} | ${c.title.replace(/\|/g, '\\|')} | ? | ? |`),
    '', 'Triage: pin (the spec should say), clarify (the spec said it badly), open (deliberately unspecified), wrong (the builder misread), quirk, already pinned.', '',
  ];
  writeFileSync(join(runsDir, `${id}-${lang}.md`), md.join('\n'));
  return { entry, sandbox: sb, impl, score, audit };
}
