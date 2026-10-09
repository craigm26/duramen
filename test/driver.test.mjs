import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { parseCommand, runDriver, implDriver, streamLines, jsonParseMisreadsKeys } from '../src/driver.mjs';
import { withFiles } from './helpers.mjs';

test('driver: commands are words, quoted words keep spaces, no shell', () => {
  assert.deepEqual(parseCommand('node driver.ts').words, ['node', 'driver.ts']);
  assert.deepEqual(parseCommand('node  "my driver.mjs" --x').words, ['node', 'my driver.mjs', '--x']);
  assert.deepEqual(parseCommand('"C:\\Program Files\\node.exe" d.mjs').words, ['C:\\Program Files\\node.exe', 'd.mjs']);
  assert.deepEqual(parseCommand("py -3 'a b.py'").words, ['py', '-3', 'a b.py']);
  assert.deepEqual(parseCommand('node "say \\"hi\\""').words, ['node', 'say "hi"']);
  assert.deepEqual(parseCommand(['node', 'a b.mjs']).words, ['node', 'a b.mjs']);
  assert.ok(parseCommand('node "unclosed').error);
  assert.ok(parseCommand('   ').error);
  assert.ok(parseCommand([]).error);
});

const ECHO = "let s='';for await (const c of process.stdin) s+=c;for (const l of s.split('\\n')) if (l.trim()) process.stdout.write(JSON.stringify({id: JSON.parse(l).id, result: 1})+'\\n');";

test('driver: a well-behaved driver', async () => {
  await withFiles({ 'd.mjs': ECHO }, async (dir) => {
    const r = await runDriver('node d.mjs', ['{"id":"a"}', '{"id":"b"}'], { cwd: dir });
    assert.equal(r.ok, true);
    assert.deepEqual(r.order, ['a', 'b']);
    assert.equal(r.responses.get('b').result, 1);
  });
});

test('driver: a hung driver is killed, and the answers it gave are kept', async () => {
  // answers the first request at once, then never finishes
  const HANG = "process.stdin.once('data', (d) => { process.stdout.write(JSON.stringify({id: JSON.parse(String(d).split('\\n')[0]).id, result: 1}) + '\\n'); setInterval(() => {}, 1000); });";
  await withFiles({ 'd.mjs': HANG }, async (dir) => {
    const t0 = Date.now();
    const r = await runDriver('node d.mjs', ['{"id":"a"}', '{"id":"b"}'], { cwd: dir, timeoutMs: 1500, perLineMs: 0 });
    assert.equal(r.timedOut, true);
    assert.match(r.error, /timed out/);
    assert.ok(r.responses.has('a'), 'the answer before the hang is kept');
    assert.ok(Date.now() - t0 < 10_000);
  });
});

test('driver: runaway output is cut off', async () => {
  // synchronous writes, so the driver keeps writing as fast as the pipe takes it
  await withFiles({ 'd.mjs': "import { writeSync } from 'node:fs'; const b = Buffer.alloc(65536, 120); for (;;) writeSync(1, b);" }, async (dir) => {
    const r = await runDriver('node d.mjs', [], { cwd: dir, maxOutputBytes: 1 << 20, timeoutMs: 20_000 });
    assert.equal(r.truncated, true);
    assert.match(r.error, /more than/);
    assert.ok(r.stdout.length <= 1 << 20);
  });
});

test('driver: a crash is reported with the tail of standard error', async () => {
  await withFiles({ 'd.mjs': "process.stdout.write(JSON.stringify({id:'a',result:1})+'\\n'); console.error('boom'); process.exit(3);" }, async (dir) => {
    const r = await runDriver('node d.mjs', ['{"id":"a"}'], { cwd: dir });
    assert.equal(r.code, 3);
    assert.match(r.error, /status 3/);
    assert.match(r.stderr, /boom/);
    assert.ok(r.responses.has('a'));
  });
});

test('driver: a program that does not exist', async () => {
  const r = await runDriver('no-such-program-duramen-test', ['{}'], {});
  assert.equal(r.ok, false);
  assert.match(r.error, /cannot start/);
});

test('driver: the whole process tree goes on timeout', { skip: process.platform === 'win32' && 'POSIX process groups' }, async () => {
  // the driver starts a grandchild that would outlive it, reports its pid, then hangs
  const TREE = "import { spawn } from 'node:child_process'; const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); process.stdout.write(JSON.stringify({id: 'pid', result: g.pid}) + '\\n'); setInterval(() => {}, 1000);";
  await withFiles({ 'd.mjs': TREE }, async (dir) => {
    const r = await runDriver('node d.mjs', [], { cwd: dir, timeoutMs: 1500, perLineMs: 0 });
    assert.equal(r.timedOut, true);
    const pid = r.responses.get('pid').result;
    await new Promise((res) => setTimeout(res, 300));
    // gone, or a zombie that no init process has reaped yet (as in some containers): not running
    let state = 'gone';
    try { state = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0]; } catch { /* gone */ }
    if (state === 'gone' && process.platform !== 'linux') { try { process.kill(pid, 0); state = 'running'; } catch { /* gone */ } }
    assert.ok(state === 'gone' || state === 'Z', `the grandchild was killed too (state ${state})`);
  });
});

test('driver: REGEN.json driver forms', async () => {
  await withFiles({ 'a/REGEN.json': '{"driver": {"default": ["node", "d.mjs"], "win32": "node d.mjs"}}', 'b/REGEN.json': '{"driver": "node \\"unclosed"}', 'c/REGEN.json': '{', 'd/x': '' }, async (dir) => {
    assert.ok(implDriver(join(dir, 'a')).command);
    assert.match(implDriver(join(dir, 'b')).error, /unclosed/);
    assert.match(implDriver(join(dir, 'c')).error, /not valid JSON/);
    assert.match(implDriver(join(dir, 'd')).error, /not found/);
  });
});

test('driver: streamLines ends lines at LF only, and decodes across chunks', async () => {
  const bytes = Buffer.from('{"a":"é\u2028x"}\r\n\n{"b":"\u2029"}\nlast');
  const cut = bytes.indexOf(Buffer.from('é')) + 1; // inside the two bytes of é
  async function* chunks() { yield bytes.subarray(0, cut); yield bytes.subarray(cut, cut + 7); yield bytes.subarray(cut + 7); }
  const out = [];
  for await (const line of streamLines(chunks())) out.push(line);
  assert.deepEqual(out, ['{"a":"é\u2028x"}', '', '{"b":"\u2029"}', 'last']);
});

test('driver: the probe for the JSON.parse key bug answers as the bug itself does in a fresh process', async () => {
  const { spawnSync } = await import('node:child_process');
  const repro = 'JSON.parse(\'{"p":0,"\\\\\\\\":0}\'); process.stdout.write(String(Object.keys(JSON.parse(\'{"p":0,"\\\\\\"":0}\'))[1] !== \'"\'))';
  const r = spawnSync(process.execPath, ['-e', repro], { encoding: 'utf8' });
  assert.equal(r.stdout, String(jsonParseMisreadsKeys()));
  // and the probe changes no other parse
  assert.deepEqual(Object.keys(JSON.parse('{"p":0,"\\"":0}')), ['p', '"']);
});
