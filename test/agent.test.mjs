// The agent builder (lib/regen/agent.mjs) against a scripted OpenAI-compatible endpoint, alone
// and inside `duramen regen --agent`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadRecord } from '../src/record.mjs';
import { regen, auditAgentTranscript } from '../src/regen.mjs';
import { agent, commandAllowed, inside, textToolCalls } from '../lib/regen/agent.mjs';
import { CALC_ORACLE, src, withFiles } from './helpers.mjs';

// A chat completions endpoint that answers from a script, one reply per request, and keeps the
// requests it got.
async function fakeEndpoint(replies) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const r = JSON.parse(body);
      requests.push(r);
      const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: 'fake-coder-1b', choices: [{ message: { role: 'assistant', ...reply } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, requests, close: () => new Promise((ok) => server.close(ok)) };
}

const call = (name, args, id = `c${Math.random().toString(36).slice(2, 8)}`) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

const BUILD = (oracle) => [
  { content: 'Reading the spec.', tool_calls: [call('read_file', { path: 'SPEC.md' })] },
  { content: null, tool_calls: [
    call('write_file', { path: 'calc.mjs', content: oracle }),
    call('write_file', { path: 'REGEN.json', content: JSON.stringify({ lang: 'ts', build: '', test: '', driver: 'node calc.mjs' }) }),
    call('write_file', { path: 'CHOICES.md', content: '## C-1: Sums of large numbers\n- Situation: missing\n' }),
    call('write_file', { path: 'BUILD_NOTES.md', content: 'Run: node calc.mjs\n' }),
  ] },
  { content: null, tool_calls: [call('read_file', { path: '../outside.txt' }), call('run', { command: 'curl http://example.com' }), call('run', { command: 'node calc.mjs' })] },
  { content: 'Done.', tool_calls: [call('finish', { summary: 'calc built' })] },
];

test('agent: commands and paths it allows', () => {
  assert.equal(commandAllowed('node calc.mjs', 'ts'), null);
  assert.equal(commandAllowed('npm test', 'ts'), null);
  assert.match(commandAllowed('npm install left-pad', 'ts'), /npm/);
  assert.match(commandAllowed('node a.js; rm -rf x', 'ts'), /one command/);
  assert.match(commandAllowed('python x.py', 'ts'), /allowed/);
  assert.equal(commandAllowed('python3 -m unittest', 'py'), null);
  assert.match(commandAllowed('python -m pip install x', 'py'), /pip/);
  const work = mkdtempSync(join(tmpdir(), 'duramen-agent-'));
  try {
    assert.ok(inside(work, 'a/b.txt'));
    assert.equal(inside(work, '../x'), null);
    assert.equal(inside(work, '/etc/passwd'), null);
  } finally { rmSync(work, { recursive: true, force: true }); }
  assert.deepEqual(textToolCalls('```json\n{"name": "read_file", "arguments": {"path": "SPEC.md"}}\n```').map((c) => [c.name, c.arguments.path]), [['read_file', 'SPEC.md']]);
  assert.deepEqual(textToolCalls('no tools here'), []);
});

test('agent: builds through the tools, refuses what leaves the folder, and writes a transcript', async () => {
  const ep = await fakeEndpoint(BUILD(CALC_ORACLE));
  const work = mkdtempSync(join(tmpdir(), 'duramen-agent-'));
  try {
    writeFileSync(join(work, 'PROMPT.md'), '# Build calc\n');
    writeFileSync(join(work, 'SPEC.md'), 'calc adds.\n');
    const lines = [];
    const r = await agent({ baseUrl: ep.url, model: 'fake', work, promptFile: join(work, 'PROMPT.md'), lang: 'ts', maxTurns: 10, maxMinutes: 2, contextChars: 60_000, maxTokens: 512, temperature: 0, requestMinutes: 1 }, (x) => lines.push(x));
    assert.equal(r.subtype, 'finished');
    assert.equal(r.served_model, 'fake-coder-1b');
    assert.ok(existsSync(join(work, 'calc.mjs')) && existsSync(join(work, 'REGEN.json')));
    const refused = lines.filter((l) => l.type === 'tool_result' && l.refused).map((l) => l.name);
    assert.deepEqual(refused, ['read_file', 'run']);
    // the tool results go back to the model with the ids of its calls
    const third = ep.requests[2].messages.filter((m) => m.role === 'tool');
    assert.ok(third.length >= 5 && third.every((m) => typeof m.tool_call_id === 'string'));
    assert.ok(ep.requests.every((q) => q.tools?.length === 6));
    const audit = auditAgentTranscript(lines.map((l) => JSON.stringify(l)).join('\n'), work, { lang: 'ts' });
    assert.equal(audit.init.ok, true, audit.init.problems.join('; '));
    assert.equal(audit.violations, 0);
    assert.equal(audit.denied_calls, 2);
  } finally { await ep.close(); rmSync(work, { recursive: true, force: true }); }
});

test('agent: an endpoint that refuses tools gets tool calls written as JSON', async () => {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const r = JSON.parse(body);
      requests.push(r);
      if (r.tools) { res.statusCode = 400; res.end('{"error": "tools are not supported by this model"}'); return; }
      const n = requests.filter((q) => !q.tools).length;
      const content = n === 1 ? '```json\n{"name": "write_file", "arguments": {"path": "x.txt", "content": "hi"}}\n```' : '{"name": "finish", "arguments": {"summary": "ok"}}';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: 'plain-1b', choices: [{ message: { role: 'assistant', content } }] }));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const work = mkdtempSync(join(tmpdir(), 'duramen-agent-'));
  try {
    writeFileSync(join(work, 'PROMPT.md'), '# Build\n');
    const lines = [];
    const r = await agent({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'plain', work, promptFile: join(work, 'PROMPT.md'), lang: 'ts', maxTurns: 5, maxMinutes: 1, contextChars: 60_000, maxTokens: 256, temperature: 0, requestMinutes: 1 }, (x) => lines.push(x));
    assert.equal(r.subtype, 'finished');
    assert.equal(readFileSync(join(work, 'x.txt'), 'utf8'), 'hi');
    assert.ok(lines.some((l) => l.type === 'note'));
    // results of calls written as text go back as user messages, with nothing but role and content
    const last = requests.at(-1).messages;
    assert.ok(last.some((m) => m.role === 'user' && m.content.startsWith('Result of write_file')));
    assert.ok(last.every((m) => Object.keys(m).every((k) => ['role', 'content', 'tool_calls', 'tool_call_id'].includes(k))));
  } finally { await new Promise((ok) => server.close(ok)); rmSync(work, { recursive: true, force: true }); }
});

const SPEC = src(`
duramen 0.2
spec calc 1.0.0
oracle node calc.mjs
op add
  input a number, b number
req ADD-1 "Adds"
  example add {"a": 1, "b": 2}
    expect result.sum = 3
req BU-1 "The folder"
  text
    The implementation folder MUST contain REGEN.json and CHOICES.md.
  static file "REGEN.json", "CHOICES.md" exists
`);

test('regen --agent: the brief, an OpenAI-compatible builder, its audit, the score and the ledger', async () => {
  const ep = await fakeEndpoint(BUILD(CALC_ORACLE));
  try {
    await withFiles({ 'calc.mjs': CALC_ORACLE, 'calc.duramen': SPEC }, async (dir) => {
      const { ast } = loadRecord(join(dir, 'calc.duramen'));
      const r = await regen(ast, { lang: 'ts', model: 'fake', sandboxRoot: join(dir, 'sb'), runsDir: join(dir, 'runs'), runId: 'L1', version: 'test', maxTurns: 10, maxMinutes: 2, agent: { baseUrl: ep.url } });
      assert.equal(r.error, undefined, r.error);
      assert.equal(r.score.passed, r.score.total, JSON.stringify(r.score.failures));
      assert.equal(r.audit.init.ok, true, r.audit.init.problems.join('; '));
      assert.equal(r.audit.violations, 0);
      assert.equal(r.audit.denied_calls, 2);
      assert.equal(r.entry.model_id, 'fake-coder-1b');
      assert.equal(r.entry.builder.kind, 'agent');
      assert.match(r.entry.isolation, /agent builder/);
      // the agent was told the brief's PROMPT.md, as Claude Code is
      assert.match(ep.requests[0].messages[0].content, /^# Build calc/);
    });
  } finally { await ep.close(); }
});
