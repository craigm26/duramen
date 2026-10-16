// Bring a Codex build (builder B, made by wsl/b-launch.sh) into selfhost/ as regen does for a
// Claude build: the folder, unchanged, without the brief, .git or node_modules; the audit of its
// transcript; the score by duramen's own suite (a measurement beside the loop, not part of it);
// a ledger row; and a run record to triage.
//
//   node selfhost/loop/import-codex.mjs <run id> <box.tgz> <io.tgz> --trigger "<why it was built>"
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, existsSync, cpSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { audit } from './codex-audit.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const BRIEF = ['SPEC.md', 'DECISIONS.md', 'PROMPT.md'];

function main(argv) {
  const [run, boxTgz, ioTgz] = argv.filter((a, k) => !a.startsWith('--') && argv[k - 1] !== '--trigger');
  const trigger = argv[argv.indexOf('--trigger') + 1];
  if (!run || !boxTgz || !ioTgz || !argv.includes('--trigger')) { console.error('usage: node selfhost/loop/import-codex.mjs <run id> <box.tgz> <io.tgz> --trigger "<why>"'); return 2; }
  const tmp = mkdtempSync(join(tmpdir(), `${run}-`));
  execFileSync('tar', ['-xzf', resolve(boxTgz), '-C', tmp]);
  mkdirSync(join(tmp, 'io'));
  execFileSync('tar', ['-xzf', resolve(ioTgz), '-C', join(tmp, 'io')]);
  const work = join(tmp, run);
  const brief = Object.fromEntries(BRIEF.map((f) => [f, sha256(readFileSync(join(work, f)))]));
  const impl = join(ROOT, 'selfhost', 'impl', `${run}-ts`);
  if (existsSync(impl)) { console.error(`${relative(ROOT, impl)} exists`); return 2; }
  cpSync(work, impl, { recursive: true, filter: (p) => { const r = relative(work, p); return !BRIEF.includes(r) && !/^(\.git|node_modules)([\\/]|$)/.test(r); } });
  const transcript = readFileSync(join(tmp, 'io', 'transcript.jsonl'), 'utf8');
  const a = audit(transcript, '/srv/ns/box');
  const started = readFileSync(join(tmp, 'io', 'started'), 'utf8').trim();
  const finished = existsSync(join(tmp, 'io', 'finished')) ? readFileSync(join(tmp, 'io', 'finished'), 'utf8').trim() : null;
  const stderr = readFileSync(join(tmp, 'io', 'stderr.txt'), 'utf8');
  const exit = Number(stderr.match(/codex exit (\d+)/)?.[1] ?? NaN);
  // The model as Codex recorded it in the session's rollout.
  let model = null;
  const sessions = join(tmp, 'io', 'home', 'sessions');
  const walk = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])) : []);
  for (const f of walk(sessions)) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/"model":"([^"]+)"/);
      if (m) { model = m[1]; break; }
    }
    if (model) break;
  }
  const r = spawnSync(process.execPath, ['bin/duramen.mjs', 'run', 'spec/', '--impl', impl, '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  let suite;
  try { const v = JSON.parse(r.stdout); suite = { passed: v.run.passed, total: v.run.total }; } catch { suite = { error: (r.stderr || r.stdout).slice(-300) }; }
  const choices = existsSync(join(impl, 'CHOICES.md')) ? [...readFileSync(join(impl, 'CHOICES.md'), 'utf8').matchAll(/^## (C-\d+):\s*(.*)$/gm)].map((m) => ({ id: m[1], title: m[2].trim() })) : [];
  const record = readFileSync(join(ROOT, 'spec', '00-spec.duramen'), 'utf8').match(/^spec (\S+) (\S+)/m);
  const entry = {
    run, kind: 'blind', date: finished ?? started, record: `${record[1]} ${record[2]}`,
    brief: { spec_sha256: brief['SPEC.md'], decisions_sha256: brief['DECISIONS.md'], prompt_sha256: brief['PROMPT.md'], duramen: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version },
    model: model ?? 'unknown', model_id: model ?? 'unknown', lang: 'ts',
    isolation: 'codex exec (Codex CLI 0.163.0) on a ChatGPT login, reasoning effort xhigh, workspace-write sandbox with no network for commands, in a WSL mount namespace that shows only its folder (selfhost/loop/wsl/ns-run.sh)',
    trigger,
    exit,
    audit: { commands: a.commands, outside_box: a.outsideBox, network: a.network.length, mcp_calls: Object.values(a.mcp).reduce((x, y) => x + y, 0), web_searches: a.webSearches, file_changes_outside: a.fileChangesOutside.length, commands_outside_prompt_list: Object.values(a.notListed).reduce((x, y) => x + y, 0) },
    started, finished,
    duration_min: finished ? +((Date.parse(finished) - Date.parse(started)) / 60000).toFixed(1) : null,
    tokens: a.usage,
    suite, choices: { total: choices.length, triaged: false }, clean: null,
    transcript_sha256: sha256(transcript),
  };
  appendFileSync(join(ROOT, 'selfhost', 'ledger.jsonl'), `${JSON.stringify(entry)}\n`);
  const md = [
    `# ${run}: ${entry.model}, ts, ${entry.record}`,
    `- Builder: B of [CONFIDENCE-3.md](../CONFIDENCE-3.md)'s R5, ${entry.isolation}`,
    `- Trigger: ${trigger}`,
    `- Run: ${started} to ${finished ?? '?'} (${entry.duration_min ?? '?'} min), exit ${exit}; tokens ${JSON.stringify(a.usage)}`,
    `- Audit: ${a.commands} commands; paths outside the folder: ${a.outsideBox.length ? a.outsideBox.join(', ') : 'none'}; network: ${a.network.length}; MCP: ${JSON.stringify(a.mcp)}; web searches: ${a.webSearches}; file changes outside: ${a.fileChangesOutside.length}; commands outside PROMPT.md's list: ${JSON.stringify(a.notListed)}`,
    `- Brief: SPEC.md sha256 ${brief['SPEC.md'].slice(0, 12)}, DECISIONS.md ${brief['DECISIONS.md'].slice(0, 12)}, PROMPT.md ${brief['PROMPT.md'].slice(0, 12)}`,
    `- duramen suite (beside the loop): ${suite.error ?? `passed ${suite.passed}/${suite.total}`}`,
    '', '## CHOICES triage', '| C-id | Builder\'s choice | Triage | Action |', '|---|---|---|---|',
    ...choices.map((c) => `| ${c.id} | ${c.title.replace(/\|/g, '\\|')} | ? | ? |`), '',
  ];
  writeFileSync(join(ROOT, 'selfhost', `${run}-ts.md`), md.join('\n'));
  console.log(JSON.stringify(entry, null, 1));
  return 0;
}

process.exitCode = main(process.argv.slice(2));
