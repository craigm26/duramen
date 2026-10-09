// `duramen mcp`: duramen as an MCP server over standard input and output, for Claude desktop,
// Claude Code and any other MCP client. One JSON-RPC 2.0 message per line.
//
// Tools: check, brief, cases, run, diff and explain. A record is named by `path` (a .duramen
// file or a folder of them on this machine) or carried in the call as `files` (a map of file
// names to texts, with `entry`, as `duramen serve` takes it). Nothing here edits a record: the
// tools read records, write nothing but the temporary folder of a `files` call, and `run`
// starts the driver an implementation's REGEN.json names, as `duramen run` does.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { validFiles, withRecord } from './serve.mjs';
import { streamLines } from './driver.mjs';
import { loadRecord } from './record.mjs';
import { check } from './check.mjs';
import { renderSpec, renderDecisions } from './render.mjs';
import { generateCases } from './suite.mjs';

const ROOT = resolve(import.meta.dirname, '..');
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_TEXT = 200_000;

const record = {
  path: { type: 'string', description: 'A .duramen file or a folder of them on this machine (an absolute path is safest).' },
  files: { type: 'object', additionalProperties: { type: 'string' }, description: 'Instead of path: the record as a map of relative file names ("/" separated) to their texts.' },
  entry: { type: 'string', description: 'With files: the file or folder that is the record ("." for all of them, the default).' },
};

export const TOOLS = [
  { name: 'check', description: 'Check a duramen record: read it, report its problems (P codes for reading, T codes for checking), and run every example through the record\'s oracle. Give path or files.', inputSchema: { type: 'object', properties: { ...record, no_oracle: { type: 'boolean', description: 'Skip running the examples through the oracle.' } } } },
  { name: 'brief', description: 'The brief a builder is given, generated from a record after it checks clean: SPEC.md, or DECISIONS.md with which="decisions". Give path or files.', inputSchema: { type: 'object', properties: { ...record, which: { type: 'string', enum: ['spec', 'decisions'] } } } },
  { name: 'cases', description: 'The suite generated from a record, one JSON case per line, with the oracle\'s answers in it. Give path or files.', inputSchema: { type: 'object', properties: { ...record } } },
  { name: 'run', description: 'Run a record\'s suite against an implementation folder, whose REGEN.json names its driver, and report what fails. This starts the implementation\'s driver.', inputSchema: { type: 'object', properties: { path: record.path, impl: { type: 'string', description: 'The implementation folder.' }, no_static: { type: 'boolean', description: 'Skip the static checks on the folder.' } }, required: ['path', 'impl'] } },
  { name: 'diff', description: 'Compare two versions of a record: each change classified (breaking, tightening, additive, relaxing, prose), the old examples run through the new oracle, and whether the version bump is big enough.', inputSchema: { type: 'object', properties: { old: { type: 'string' }, new: { type: 'string' } }, required: ['old', 'new'] } },
  { name: 'explain', description: 'What duramen diagnostic codes mean, such as P013 or T002. Several codes may be given, separated by commas.', inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } },
];

const text = (s, isError = false) => ({ content: [{ type: 'text', text: s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n[${s.length - MAX_TEXT} characters cut]` : s }], ...(isError ? { isError: true } : {}) });

// Run the CLI's own command and keep what it prints, with a temporary folder's name taken out.
async function cli(argv, strip = null) {
  const { main } = await import('./cli.mjs');
  const lines = [];
  const io = { out: (s) => lines.push(s), err: (s) => lines.push(s) };
  const code = await main(argv, io);
  let out = lines.join('\n');
  if (strip) out = out.split(join(strip, 'x').slice(0, -1)).join('').split(strip).join('.');
  return { code, out };
}

// A record from path or files, as a folder on disk for the duration of fn.
async function withInput(args, fn) {
  if (typeof args.path === 'string' && args.path) {
    const p = resolve(args.path);
    if (!existsSync(p)) return text(`No such file or folder: ${args.path}`, true);
    return fn(p, null);
  }
  if (args.files !== undefined) {
    if (!validFiles(args.files)) return text('files must map relative file names ("/" separated, no "." or ".." parts) to texts.', true);
    if (args.entry !== undefined && typeof args.entry !== 'string') return text('entry must be a string.', true);
    return withRecord({ files: args.files, entry: args.entry }, (entry, rel, dir) => fn(entry, dir));
  }
  return text('Give path (a record on this machine) or files (the record\'s texts).', true);
}

function explain(codes) {
  const design = readFileSync(join(ROOT, 'DESIGN.md'), 'utf8').split('\n');
  const out = [];
  for (const raw of codes.split(/[\s,]+/).filter(Boolean)) {
    const code = raw.toUpperCase();
    if (!/^[PT]\d{3}$/.test(code)) { out.push(`${raw}: not a duramen code (P001 to P052 for reading, T001 to T041 for checking)`); continue; }
    const row = design.find((l) => l.startsWith(`| ${code} |`));
    out.push(row ? row.split('|').map((c) => c.trim()).filter(Boolean).join(': ') : `${code}: no such code`);
  }
  return out.join('\n');
}

export async function callTool(name, args = {}) {
  switch (name) {
    case 'check':
      return withInput(args, async (p, tmp) => { const r = await cli(['check', p, ...(args.no_oracle ? ['--no-oracle'] : [])], tmp); return text(r.out || '(no output)'); });
    case 'brief':
    case 'cases':
      return withInput(args, async (p, tmp) => {
        const { ast, diagnostics } = loadRecord(p);
        const checked = diagnostics.some((d) => d.level === 'error') ? null : await check(ast);
        const errors = [...diagnostics, ...(checked?.diagnostics ?? [])].filter((d) => d.level === 'error');
        if (errors.length) { const r = await cli(['check', p], tmp); return text(`The record has ${errors.length} error${errors.length === 1 ? '' : 's'}; fix them first.\n${r.out}`, true); }
        if (name === 'cases') { const cases = generateCases(ast, checked.oracle, checked.properties); return text(`${cases.length} cases\n${cases.map((c) => JSON.stringify(c)).join('\n')}`); }
        const { VERSION } = await import('./cli.mjs');
        return text(args.which === 'decisions' ? renderDecisions(ast) : renderSpec(ast, checked.oracle, { version: VERSION, properties: checked.properties }));
      });
    case 'run': {
      if (typeof args.path !== 'string' || typeof args.impl !== 'string') return text('run needs path (the record) and impl (the implementation folder).', true);
      for (const [k, v] of [['path', args.path], ['impl', args.impl]]) if (!existsSync(resolve(v))) return text(`No such file or folder: ${k} ${v}`, true);
      if (!statSync(resolve(args.impl)).isDirectory()) return text('impl must be a folder with a REGEN.json.', true);
      const r = await cli(['run', resolve(args.path), '--impl', resolve(args.impl), ...(args.no_static ? ['--no-static'] : [])]);
      return text(r.out || '(no output)');
    }
    case 'diff': {
      if (typeof args.old !== 'string' || typeof args.new !== 'string') return text('diff needs old and new, two versions of a record.', true);
      const r = await cli(['diff', resolve(args.old), resolve(args.new)]);
      return text(r.out || '(no output)');
    }
    case 'explain':
      if (typeof args.code !== 'string') return text('explain needs code, such as P013 or T002.', true);
      return text(explain(args.code));
    default:
      return null;
  }
}

export async function handle(msg, { version } = {}) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid Request');
  const isNote = !('id' in msg);
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'duramen', version },
        instructions: 'duramen checks specifications written as .duramen records: requirements with examples, run through an executable oracle. Use check after every edit to a record; brief shows what a builder is given; run judges an implementation folder; explain says what a P or T code means.',
      });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name;
      if (!TOOLS.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
      try { return reply(await callTool(name, msg.params?.arguments ?? {})); } catch (e) { return reply(text(`duramen failed: ${e.message}`, true)); }
    }
    default:
      if (isNote || msg.method.startsWith('notifications/')) return null;
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

// Serve until standard input closes. Requests are answered as they finish (JSON-RPC allows any
// order); anything duramen itself would print goes to standard error, never into the stream.
export async function mcpServe(input = process.stdin, write = (s) => process.stdout.write(s), version = '0') {
  console.log = (...a) => process.stderr.write(a.join(' ') + '\n');
  const pending = new Set();
  for await (const line of streamLines(input)) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue; }
    const job = handle(msg, { version }).then((r) => { if (r && 'id' in msg) write(JSON.stringify(r) + '\n'); }).catch((e) => process.stderr.write(`duramen mcp: ${e.message}\n`));
    pending.add(job);
    job.finally(() => pending.delete(job));
  }
  await Promise.all(pending);
}
