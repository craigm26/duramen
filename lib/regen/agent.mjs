#!/usr/bin/env node
// duramen's agent builder: a small tool-using loop for any OpenAI-compatible chat completions
// endpoint (llama.cpp's llama-server, Ollama, LM Studio, vLLM, or a vendor's compatible API),
// so that `duramen regen --agent <base URL>` can ask a model other than Claude Code to build
// from a brief.
//
//   node lib/regen/agent.mjs --base-url http://127.0.0.1:8080/v1 --model <name> --work <folder>
//     --prompt-file <PROMPT.md> --lang ts|py [--max-turns 200] [--max-minutes 60]
//     [--api-key-env VAR] [--context-chars 60000] [--max-tokens 4096] [--temperature 0.2]
//
// The model gets six tools and nothing else: list_files, read_file, write_file and edit_file,
// confined to the work folder; run, for one command of the language's toolchain in the work
// folder; and finish. Everything it does is written to standard output as JSON lines (the
// transcript `duramen regen` audits): an init line, each assistant turn, each tool result
// (refusals included), and a result line.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const AGENT_VERSION = '1';
export const AGENT_TOOLS = ['edit_file', 'finish', 'list_files', 'read_file', 'run', 'write_file'];

// The commands a builder may run, by language: the same as the Claude Code builder's.
export function commandAllowed(command, lang) {
  const c = String(command ?? '').trim();
  if (!c) return 'empty command';
  if (/[;&|<>`$%\r\n]/.test(c)) return 'one command only: no ; & | < > ` $ % or line breaks';
  const [first, second] = c.split(/\s+/);
  const ok = lang === 'py'
    ? ['python', 'python3', 'py'].includes(first)
    : first === 'node' || (first === 'npm' && ['test', 'run'].includes(second));
  if (!ok) return lang === 'py' ? 'allowed: python, python3 or py' : 'allowed: node ..., npm test, npm run ...';
  if (/\b(install|add|ci|exec|publish|link)\b/.test(c) && first === 'npm') return 'npm may only test or run scripts';
  if (/(^|\s)-m\s+pip\b/.test(c)) return 'pip is not allowed';
  return null;
}

// A path inside the work folder, or null.
export function inside(work, p) {
  if (typeof p !== 'string' || p === '' || p.includes('\0')) return null;
  const abs = resolve(work, p);
  const rel = relative(work, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return abs;
}

const clip = (s, n) => (s.length > n ? `[${s.length - n} characters cut]\n${s.slice(-n)}` : s);

function listFiles(dir, base, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '__pycache__'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, out);
    else out.push(`${relative(base, p).split('\\').join('/')} (${statSync(p).size} bytes)`);
    if (out.length > 500) break;
  }
  return out;
}

function runCommand(command, cwd, seconds) {
  return new Promise((done) => {
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    let out = '';
    const keep = (d) => { out = (out + d.toString('utf8')).slice(-200_000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(-child.pid, 'SIGKILL');
      } catch { /* gone */ }
    }, seconds * 1000);
    child.on('error', (e) => { clearTimeout(timer); done({ code: null, out: `${out}\n${e.message}`, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, out, timedOut }); });
  });
}

// Execute one tool call. Returns { ok, text, refused? }.
export async function runTool(name, input, { work, lang, readLines = 400, commandSeconds = 180, outputChars = 6000 }) {
  const a = input && typeof input === 'object' ? input : {};
  const refuse = (why) => ({ ok: false, refused: why, text: `Refused: ${why}` });
  try {
    switch (name) {
      case 'list_files': {
        const dir = inside(work, a.path ?? '.');
        if (!dir) return refuse('that path is outside your folder');
        if (!existsSync(dir)) return { ok: false, text: 'No such folder.' };
        return { ok: true, text: listFiles(dir, work).join('\n') || '(empty)' };
      }
      case 'read_file': {
        const p = inside(work, a.path);
        if (!p) return refuse('that path is outside your folder');
        if (!existsSync(p) || statSync(p).isDirectory()) return { ok: false, text: 'No such file.' };
        const lines = readFileSync(p, 'utf8').split('\n');
        const from = Math.max(1, Number.isInteger(a.offset) ? a.offset : 1);
        const count = Math.max(1, Math.min(Number.isInteger(a.limit) ? a.limit : readLines, 2000));
        const part = lines.slice(from - 1, from - 1 + count);
        const more = from - 1 + count < lines.length ? `\n[lines ${from} to ${from - 1 + part.length} of ${lines.length}; read on with offset ${from + part.length}]` : '';
        return { ok: true, text: part.join('\n') + more };
      }
      case 'write_file': {
        const p = inside(work, a.path);
        if (!p) return refuse('that path is outside your folder');
        if (typeof a.content !== 'string') return { ok: false, text: 'content must be a string.' };
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, a.content);
        return { ok: true, text: `Wrote ${a.path} (${a.content.length} characters).` };
      }
      case 'edit_file': {
        const p = inside(work, a.path);
        if (!p) return refuse('that path is outside your folder');
        if (!existsSync(p)) return { ok: false, text: 'No such file.' };
        const text = readFileSync(p, 'utf8');
        if (typeof a.old !== 'string' || typeof a.new !== 'string' || a.old === '') return { ok: false, text: 'old and new must be strings, and old not empty.' };
        const n = text.split(a.old).length - 1;
        if (n !== 1) return { ok: false, text: `old occurs ${n} times; it must occur exactly once.` };
        writeFileSync(p, text.replace(a.old, () => a.new));
        return { ok: true, text: `Edited ${a.path}.` };
      }
      case 'run': {
        const why = commandAllowed(a.command, lang);
        if (why) return refuse(why);
        const r = await runCommand(a.command, work, commandSeconds);
        return { ok: r.code === 0, text: `exit ${r.timedOut ? `(stopped after ${commandSeconds} s)` : r.code}\n${clip(r.out, outputChars)}` };
      }
      case 'finish':
        return { ok: true, text: 'Finished.' };
      default:
        return refuse(`there is no tool named ${name}`);
    }
  } catch (e) {
    return { ok: false, text: `Error: ${e.message}` };
  }
}

const TOOL_SPECS = (lang) => [
  { name: 'list_files', description: 'List the files in your folder, or in a folder inside it, with their sizes.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'a folder inside your folder; "." by default' } } } },
  { name: 'read_file', description: 'Read a text file in your folder. Long files come in parts: pass offset (the first line, from 1) and limit (the number of lines).', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } }, required: ['path'] } },
  { name: 'write_file', description: 'Create or replace a text file in your folder. Folders are created as needed.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'edit_file', description: 'Replace a piece of text in a file with another. old must occur exactly once in the file.', parameters: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, required: ['path', 'old', 'new'] } },
  { name: 'run', description: `Run one command in your folder and get its exit status and output. ${lang === 'py' ? 'Allowed: python, python3 or py.' : 'Allowed: node ..., npm test, npm run ....'}`, parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  { name: 'finish', description: 'Say that you are done, with a short summary. Call it only when your tests pass and CHOICES.md and BUILD_NOTES.md are written.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
].map((f) => ({ type: 'function', function: f }));

// A model without native tool calls may write one as text: {"name": ..., "arguments": {...}},
// possibly in a fenced block, or {"tool_call": {...}}. Returns [] when there is none.
export function textToolCalls(content) {
  if (typeof content !== 'string' || !content.includes('{')) return [];
  const calls = [];
  const blocks = [...content.matchAll(/```(?:json|tool)?\s*\n?([\s\S]*?)```/g)].map((m) => m[1]);
  for (const text of blocks.length ? blocks : [content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)]) {
    let v;
    try { v = JSON.parse(text.trim()); } catch { continue; }
    for (const c of Array.isArray(v) ? v : [v]) {
      const t = c?.tool_call ?? c?.function ?? c;
      const name = t?.name ?? t?.tool;
      let args = t?.arguments ?? t?.parameters ?? t?.input ?? {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      if (typeof name === 'string' && AGENT_TOOLS.includes(name)) calls.push({ id: null, name, arguments: args });
    }
  }
  return calls;
}

// Keep the conversation within a budget: the oldest tool results are elided first.
function fit(messages, budget, elidable) {
  const size = () => messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0) + JSON.stringify(m.tool_calls ?? '').length, 0);
  for (let i = 2; i < messages.length - 6 && size() > budget; i++) {
    const m = messages[i];
    if ((m.role === 'tool' || elidable.has(m)) && typeof m.content === 'string' && m.content.length > 200) m.content = `[elided: ${m.content.length} characters, from an earlier turn]`;
    else if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const c of m.tool_calls) if (c.function?.arguments?.length > 400) c.function.arguments = JSON.stringify({ elided: `${c.function.arguments.length} characters` });
    }
  }
}

async function chat(o, messages, useTools) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.requestMinutes * 60_000);
  try {
    const res = await fetch(`${o.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', ...(o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {}) },
      body: JSON.stringify({ model: o.model, messages, temperature: o.temperature, max_tokens: o.maxTokens, ...(useTools ? { tools: TOOL_SPECS(o.lang), tool_choice: 'auto' } : {}) }),
    });
    const text = await res.text();
    if (!res.ok) return { error: `HTTP ${res.status}: ${text.slice(0, 500)}`, status: res.status };
    return { body: JSON.parse(text) };
  } catch (e) {
    return { error: e.name === 'AbortError' ? `no answer within ${o.requestMinutes} min` : e.message };
  } finally { clearTimeout(timer); }
}

export async function agent(o, say = (x) => process.stdout.write(JSON.stringify(x) + '\n')) {
  const t0 = Date.now();
  const deadline = t0 + o.maxMinutes * 60_000;
  const work = resolve(o.work);
  const prompt = readFileSync(o.promptFile, 'utf8');
  say({ type: 'init', builder: 'duramen-agent', version: AGENT_VERSION, base_url: o.baseUrl, model: o.model, cwd: work, lang: o.lang, tools: AGENT_TOOLS, time: new Date().toISOString() });
  const system = `${prompt}\n\n## How you work here\nYou work only through the tools you are given: list_files, read_file, write_file, edit_file, run and finish. Your folder holds SPEC.md, DECISIONS.md and PROMPT.md. Read SPEC.md and DECISIONS.md in full first (read_file returns long files in parts), then write the implementation, its tests, REGEN.json, CHOICES.md and BUILD_NOTES.md with write_file, run your tests with run, fix what fails, and call finish when everything is done.`;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: 'Build the program that SPEC.md describes, in this folder, following PROMPT.md. Start by reading SPEC.md.' },
  ];
  let useTools = !o.textTools;
  const elidable = new WeakSet(); // tool results sent back as user messages
  let served = null;
  let usage = { prompt_tokens: 0, completion_tokens: 0 };
  let nudges = 0;
  let turn = 0;
  let outcome = 'max_turns';
  let error = null;
  for (turn = 1; turn <= o.maxTurns; turn++) {
    if (Date.now() > deadline) { outcome = 'timeout'; break; }
    fit(messages, o.contextChars, elidable);
    let r = await chat(o, messages, useTools);
    if (r.error && useTools && r.status && r.status >= 400 && r.status < 500 && /tool/i.test(r.error)) {
      useTools = false; // the endpoint takes no tools: ask for them as text instead
      messages[0].content += '\n\nTo use a tool, answer with only a JSON object: {"name": "<tool>", "arguments": {...}}. The tools: ' + JSON.stringify(TOOL_SPECS(o.lang).map((t) => t.function));
      say({ type: 'note', turn, text: 'the endpoint does not take tools; switching to tool calls written as JSON' });
      r = await chat(o, messages, false);
    }
    for (let k = 0; r.error && k < 2; k++) { await new Promise((s) => setTimeout(s, 3000)); r = await chat(o, messages, useTools); }
    if (r.error) { outcome = 'error'; error = r.error; break; }
    const msg = r.body.choices?.[0]?.message ?? {};
    served = served ?? r.body.model ?? null;
    usage = { prompt_tokens: usage.prompt_tokens + (r.body.usage?.prompt_tokens ?? 0), completion_tokens: usage.completion_tokens + (r.body.usage?.completion_tokens ?? 0) };
    const native = Array.isArray(msg.tool_calls) ? msg.tool_calls.filter((c) => c?.function?.name) : [];
    const calls = native.length
      ? native.map((c) => { let args = {}; try { args = typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : c.function.arguments ?? {}; } catch { args = { unparsed: String(c.function.arguments).slice(0, 200) }; } return { id: c.id ?? null, name: c.function.name, arguments: args }; })
      : textToolCalls(msg.content);
    say({ type: 'assistant', turn, content: typeof msg.content === 'string' ? msg.content.slice(0, 4000) : null, tool_calls: calls.map((c) => ({ name: c.name, input: c.arguments })), usage: r.body.usage ?? null });
    if (native.length) messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: native });
    else messages.push({ role: 'assistant', content: msg.content ?? '' });
    if (!calls.length) {
      if (++nudges >= 4) { outcome = 'stopped'; break; }
      messages.push({ role: 'user', content: 'Keep going: use the tools to build and test the program. When everything is done, call finish.' });
      continue;
    }
    nudges = 0;
    let finished = false;
    for (const c of calls) {
      const res = await runTool(c.name, c.arguments, { work, lang: o.lang });
      say({ type: 'tool_result', turn, name: c.name, input: c.arguments, ok: res.ok, ...(res.refused ? { refused: res.refused } : {}), output: res.text.slice(0, 2000) });
      if (c.id && native.length) messages.push({ role: 'tool', tool_call_id: c.id, content: res.text });
      else { const m = { role: 'user', content: `Result of ${c.name}:\n${res.text}` }; elidable.add(m); messages.push(m); }
      if (c.name === 'finish') finished = true;
    }
    if (finished) { outcome = 'finished'; break; }
  }
  const result = { type: 'result', subtype: outcome, turns: Math.min(turn, o.maxTurns), duration_ms: Date.now() - t0, served_model: served, usage, ...(error ? { error } : {}) };
  say(result);
  return result;
}

function parseArgs(argv) {
  const o = { maxTurns: 200, maxMinutes: 60, contextChars: 60_000, maxTokens: 4096, temperature: 0.2, requestMinutes: 15, textTools: false, lang: 'ts' };
  const key = { '--base-url': 'baseUrl', '--model': 'model', '--work': 'work', '--prompt-file': 'promptFile', '--lang': 'lang', '--max-turns': 'maxTurns', '--max-minutes': 'maxMinutes', '--api-key-env': 'apiKeyEnv', '--context-chars': 'contextChars', '--max-tokens': 'maxTokens', '--temperature': 'temperature', '--request-minutes': 'requestMinutes' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--text-tools') { o.textTools = true; continue; }
    const k = key[argv[i]];
    if (!k) throw new Error(`unknown option ${argv[i]}`);
    const v = argv[++i];
    o[k] = ['maxTurns', 'maxMinutes', 'contextChars', 'maxTokens', 'temperature', 'requestMinutes'].includes(k) ? Number(v) : v;
  }
  for (const k of ['baseUrl', 'model', 'work', 'promptFile']) if (!o[k]) throw new Error(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  if (!['ts', 'py'].includes(o.lang)) throw new Error('--lang is ts or py');
  if (o.apiKeyEnv) o.apiKey = process.env[o.apiKeyEnv];
  return o;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('agent.mjs')) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { process.stderr.write(`agent: ${e.message}\n`); process.exit(2); }
  agent(o).then((r) => { process.exitCode = ['finished', 'stopped', 'max_turns'].includes(r.subtype) ? 0 : 1; });
}
