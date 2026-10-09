// duramen mcp (an MCP server over standard input and output) and duramen hook (a Claude Code
// PostToolUse hook), driven the way their clients drive them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, withFiles } from './helpers.mjs';

const BIN = join(ROOT, 'bin', 'duramen.mjs');

// Send JSON-RPC messages to `duramen mcp`, close its input, and collect the answers by id.
function mcp(messages) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [BIN, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', fail);
    child.on('close', () => {
      const answers = new Map();
      for (const line of out.split('\n').filter(Boolean)) { const m = JSON.parse(line); answers.set(m.id, m); }
      done(answers);
    });
    child.stdin.end(messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
  });
}

function hook(event) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, 'hook'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', (code) => done({ code, out: out.trim() }));
    child.stdin.end(JSON.stringify(event));
  });
}

const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

test('mcp: initialize, tools, and calls with a record carried in the call or named by path', async () => {
  await withFiles({ 'r/a.duramen': 'duramen 0.1\nspec a 1\nfrobnicate\n', 'ok.duramen': 'duramen 0.1\nspec ok 1\nnote\n  text\n    Fine.\n' }, async (dir) => {
    const a = await mcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      call(3, 'check', { files: { 'a.duramen': 'duramen 0.1\nspec a 1\nfrobnicate\n' } }),
      call(4, 'check', { path: join(dir, 'r') }),
      call(5, 'check', { path: join(dir, 'ok.duramen') }),
      call(6, 'explain', { code: 'p002, X1' }),
      call(7, 'brief', { path: join(dir, 'r') }),
      call(8, 'check', {}),
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'lint', arguments: {} } },
      { jsonrpc: '2.0', id: 10, method: 'resources/list' },
      { jsonrpc: '2.0', id: 11, method: 'ping' },
    ]);
    assert.equal(a.get(1).result.protocolVersion, '2025-03-26');
    assert.equal(a.get(1).result.serverInfo.name, 'duramen');
    assert.deepEqual(a.get(2).result.tools.map((t) => t.name), ['check', 'brief', 'cases', 'run', 'diff', 'explain']);
    const textOf = (id) => a.get(id).result.content[0].text;
    assert.match(textOf(3), /^a\.duramen:3:1: error P002/);
    assert.ok(!textOf(3).includes('duramen-serve-'), 'the temporary folder is not shown');
    assert.match(textOf(4), /error P002/);
    assert.match(textOf(5), /^ok: /m);
    assert.match(textOf(6), /^P002: /);
    assert.match(textOf(6), /X1: not a duramen code/);
    assert.equal(a.get(7).result.isError, true);
    assert.equal(a.get(8).result.isError, true);
    assert.equal(a.get(9).error.code, -32602);
    assert.equal(a.get(10).error.code, -32601);
    assert.deepEqual(a.get(11).result, {});
    assert.ok(!a.has(undefined), 'no answer to a notification');
  });
});

test('mcp: brief and cases of a record that checks clean', async () => {
  const spec = 'duramen 0.1\nspec calc 1\noracle node calc.mjs\nop add\nreq A "adds"\n  example add {"a": 1}\n    expect result = ?\n';
  const calc = "import { createInterface } from 'node:readline';\nfor await (const l of createInterface({ input: process.stdin })) { if (!l.trim()) continue; const r = JSON.parse(l); console.log(JSON.stringify({ id: r.id, result: 2 })); }\n";
  const a = await mcp([call(1, 'brief', { files: { 'calc.duramen': spec, 'calc.mjs': calc }, entry: 'calc.duramen' }), call(2, 'cases', { files: { 'calc.duramen': spec, 'calc.mjs': calc }, entry: 'calc.duramen' })]);
  assert.match(a.get(1).result.content[0].text, /REQ-A/);
  const cases = a.get(2).result.content[0].text.split('\n');
  assert.equal(cases[0], '1 cases');
  assert.deepEqual(JSON.parse(cases[1]).checks, [{ path: 'result', kind: 'eq', value: 2, from: 'oracle' }]);
});

test('mcp: a message holding U+2028 or U+2029 is one message', async () => {
  // JSON leaves these characters raw in strings; from Node 24, readline would end a line there.
  const files = { 'a.duramen': 'duramen 0.1\nspec a 1\nnote\n  text\n    One\u2028two\u2029three.\n' };
  const answers = await mcp([call(1, 'check', { files })]);
  assert.equal(answers.size, 1);
  assert.equal(answers.get(1).error, undefined);
  assert.match(answers.get(1).result.content[0].text, /0 errors/);
});

test('hook: a .duramen edit is checked, its problems block, other files pass through', async () => {
  await withFiles({ 'one/bad.duramen': 'duramen 0.1\nspec a 1\nfrobnicate\n', 'one/good.duramen': 'duramen 0.1\nspec b 1\n', 'folder/00.duramen': 'duramen 0.1\nspec f 1\n', 'folder/10.duramen': 'duramen 0.1\nnote\n  text\n    Part of f.\n' }, async (dir) => {
    const bad = await hook({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'bad.duramen' }, cwd: join(dir, 'one') });
    assert.equal(bad.code, 0);
    const b = JSON.parse(bad.out);
    assert.equal(b.decision, 'block');
    assert.match(b.reason, /bad\.duramen:3:1: error P002/);
    assert.ok(!b.reason.includes('good.duramen'), 'a folder of separate records is not checked as one record');
    const good = JSON.parse((await hook({ tool_name: 'Write', tool_input: { file_path: join(dir, 'folder', '10.duramen') } })).out);
    assert.match(good.hookSpecificOutput.additionalContext, /^duramen check folder: ok: /);
    assert.deepEqual(await hook({ tool_name: 'Write', tool_input: { file_path: join(dir, 'x.txt') } }), { code: 0, out: '' });
    assert.deepEqual(await hook({ tool_name: 'Edit', tool_input: { file_path: join(dir, 'gone.duramen') } }), { code: 0, out: '' });
  });
});

test('hook: a file in a subfolder of a folder record checks that record; a file of its own stays alone', async () => {
  const files = { 'rec/00.duramen': 'duramen 0.1\nspec r 1\n', 'rec/sub/10.duramen': 'duramen 0.1\nnote\n  text\n    Part of r.\n', 'lonely/x.duramen': 'duramen 0.1\nspec x 1\n', 'other/y.duramen': 'duramen 0.1\nspec y 1\n' };
  await withFiles(files, async (dir) => {
    const nested = JSON.parse((await hook({ tool_name: 'Edit', tool_input: { file_path: 'rec/sub/10.duramen' }, cwd: dir })).out);
    assert.match(nested.hookSpecificOutput.additionalContext, /^duramen check rec: ok: /);
    const alone = JSON.parse((await hook({ tool_name: 'Edit', tool_input: { file_path: 'lonely/x.duramen' }, cwd: dir })).out);
    assert.match(alone.hookSpecificOutput.additionalContext, /^duramen check x\.duramen: ok: /);
  });
});

test('mcp: an entry outside the files carried in the call is refused, as duramen serve refuses it', async () => {
  const files = { 'a.duramen': 'duramen 0.1\nspec a 1\n' };
  const answers = await mcp([call(1, 'check', { files, entry: '..' }), call(2, 'check', { files, entry: '/tmp' }), call(3, 'check', { files, entry: 'a.duramen' })]);
  assert.equal(answers.get(1).result.isError, true);
  assert.match(answers.get(1).result.content[0].text, /entry must be/);
  assert.equal(answers.get(2).result.isError, true);
  assert.notEqual(answers.get(3).result.isError, true);
});

