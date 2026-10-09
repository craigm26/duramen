import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { loadRecord } from '../src/record.mjs';
import { regen, leakCheck, auditTranscript, launch } from '../src/regen.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CALC_ORACLE, src, withFiles } from './helpers.mjs';

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

// A stand-in for the builder: writes an implementation into its working folder and prints a
// transcript like the real CLI's (an init line, one tool call, a result line).
const FAKE_BUILDER = (oracle) => `
import { writeFileSync } from 'node:fs';
writeFileSync('calc.mjs', ${JSON.stringify(oracle)});
writeFileSync('REGEN.json', JSON.stringify({ lang: 'ts', build: '', test: '', driver: 'node calc.mjs' }));
writeFileSync('CHOICES.md', '## C-1: Sums of large numbers\\n- Situation: missing\\n');
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
say({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'], mcp_servers: [], permissionMode: 'dontAsk', model: 'claude-sonnet-test' });
say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'SPEC.md' } }, { type: 'tool_use', name: 'Bash', input: { command: 'cat /etc/passwd' } }] } });
say({ type: 'result', subtype: 'success', num_turns: 3, duration_ms: 1200, total_cost_usd: 0.01, is_error: false, permission_denials: [] });
`;

test('regen: brief, sandbox, builder, audit, score and ledger, with a stand-in builder', async () => {
  await withFiles({ 'calc.mjs': CALC_ORACLE, 'calc.duramen': SPEC, 'fake.mjs': FAKE_BUILDER(CALC_ORACLE) }, async (dir) => {
    const { ast } = loadRecord(join(dir, 'calc.duramen'));
    const r = await regen(ast, { lang: 'ts', sandboxRoot: join(dir, 'sb'), runsDir: join(dir, 'runs'), runId: 'r1', version: 'test', builder: ['node', join(dir, 'fake.mjs')] });
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.score.passed, r.score.total, JSON.stringify(r.score.failures));
    assert.equal(r.audit.init.ok, true, r.audit.init.problems.join('; '));
    // the builder ran `cat /etc/passwd`: a path outside its folder
    assert.equal(r.audit.violations, 1);
    assert.equal(r.entry.choices.total, 1);
    assert.ok(!existsSync(join(r.impl, 'SPEC.md')), 'the brief is not copied out with the build');
    const ledger = readFileSync(join(dir, 'runs', 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].run, 'r1');
    assert.match(readFileSync(join(dir, 'runs', 'r1-ts.md'), 'utf8'), /\| C-1 \| Sums of large numbers \| \? \| \? \|/);
  });
});

test('regen: the leak check stops a brief that names the reference', async () => {
  await withFiles({ 'calc.mjs': CALC_ORACLE, 'calc.duramen': SPEC.replace('Adds"', 'Adds, as in the Frobnitz library"'), 'fake.mjs': FAKE_BUILDER(CALC_ORACLE) }, async (dir) => {
    const { ast } = loadRecord(join(dir, 'calc.duramen'));
    const r = await regen(ast, { lang: 'ts', sandboxRoot: join(dir, 'sb'), runsDir: join(dir, 'runs'), version: 'test', leakTerms: { identifiers: ['frobnitz'] }, builder: ['node', join(dir, 'fake.mjs')] });
    assert.match(r.error, /leak check failed before launch/);
    assert.ok(!existsSync(join(dir, 'runs', 'ledger.jsonl')), 'nothing was launched');
  });
  await withFiles({ 'w/a.txt': 'see /home/alice/x and the Frobnitz code', 'w/b.txt': 'fine' }, async (dir) => {
    const hits = leakCheck(join(dir, 'w'), { identifiers: ['frobnitz'] });
    assert.equal(hits.length, 2);
  });
});

test('regen: the audit flags network use and tools beyond the allowed set', () => {
  const t = [
    { type: 'system', subtype: 'init', cwd: '/w', tools: ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write', 'WebFetch'], mcp_servers: [], permissionMode: 'dontAsk', model: 'claude-sonnet-x' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm install left-pad' } }, { type: 'tool_use', name: 'WebFetch', input: { url: 'https://example.com' } }, { type: 'tool_use', name: 'Write', input: { file_path: 'a.ts', content: 'fetch("https://registry.npmjs.org/x")' } }] } },
  ].map((o) => JSON.stringify(o)).join('\n');
  const a = auditTranscript(t, '/w');
  assert.equal(a.init.ok, false);
  assert.equal(a.network_violations.length, 3);
});

test('regen: the audit takes a family or a full model ID', () => {
  const init = (model) => [{ type: 'system', subtype: 'init', cwd: '/w', tools: ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'], mcp_servers: [], permissionMode: 'dontAsk', model }].map((o) => JSON.stringify(o)).join('\n');
  assert.equal(auditTranscript(init('claude-haiku-5-5'), '/w', { family: 'haiku' }).init.ok, true);
  assert.equal(auditTranscript(init('claude-haiku-5-5'), '/w', { family: 'sonnet' }).init.ok, false);
  assert.equal(auditTranscript(init('claude-haiku-4-5-20251001'), '/w', { family: 'claude-haiku-4-5-20251001' }).init.ok, true);
  assert.equal(auditTranscript(init('claude-haiku-4-5-20251001'), '/w', { family: 'claude-haiku-4-5' }).init.ok, true);
  const other = auditTranscript(init('claude-haiku-5-5'), '/w', { family: 'claude-haiku-4-5' });
  assert.equal(other.init.ok, false);
  assert.match(other.init.problems.join(), /is not claude-haiku-4-5/);
});

test('regen: a builder that cannot be started settles once, with its error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'duramen-launch-'));
  try {
    const r = await launch(dir, dir, { prompt: 'x', model: 'm', lang: 'ts', maxTurns: 1, maxMinutes: 1, builder: [join(dir, 'no-such-program')] });
    assert.equal(r.code, null);
    assert.match(r.error, /ENOENT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('regen: a builder that ignores SIGTERM is killed after --max-minutes', { skip: process.platform === 'win32' && 'process groups are POSIX' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'duramen-launch-'));
  try {
    writeFileSync(join(dir, 'stubborn.mjs'), "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n");
    const t0 = Date.now();
    const r = await launch(dir, dir, { prompt: 'x', model: 'm', lang: 'ts', maxTurns: 1, maxMinutes: 0.002, killGraceMs: 200, builder: [process.execPath, join(dir, 'stubborn.mjs')] });
    assert.equal(r.timedOut, true);
    assert.equal(r.signal, 'SIGKILL');
    assert.ok(Date.now() - t0 < 5000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
