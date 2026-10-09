// Launches brief B's author (CONFIDENCE-2.md, claim 7): claude -p in a folder holding only the two
// RFC texts, protocol.md and its prompt, with file tools only (no shell, so it runs no code),
// no web tools and no MCP servers, in don't-ask mode; the environment is cut down as `duramen
// regen` cuts it for builders. Its transcript is kept beside its work.
//
//   node examples/jsonpath/briefs/author-launch.mjs <work folder> <meta folder> [--model claude-opus-5-5]
import { spawn } from 'node:child_process';
import { openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [work, meta, ...rest] = process.argv.slice(2);
const model = rest[rest.indexOf('--model') + 1] && rest.includes('--model') ? rest[rest.indexOf('--model') + 1] : 'claude-opus-5-5';
const KEEP = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TERM', 'TZ', 'TMPDIR', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'];
const env = {};
for (const k of KEEP) if (process.env[k] !== undefined) env[k] = process.env[k];
writeFileSync(join(meta, 'env-names.txt'), Object.keys(env).sort().join('\n') + '\n');
const prompt = readFileSync(join(work, 'AUTHOR-PROMPT.md'), 'utf8');
const tools = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
const args = ['-p', prompt, '--model', model, '--restricted', '--safe-mode', '--tools', tools.join(','),
  '--disallowedTools', 'WebFetch', 'WebSearch', 'Bash', 'mcp__*', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--allowedTools', ...tools,
  '--max-turns', '300', '--no-session-persistence', '--output-format', 'stream-json', '--verbose'];
const out = openSync(join(meta, 'transcript.jsonl'), 'w');
const err = openSync(join(meta, 'stderr.log'), 'w');
const child = spawn('claude', args, { cwd: work, env, stdio: ['ignore', out, err] });
const t0 = Date.now();
child.on('close', (code, signal) => {
  writeFileSync(join(meta, 'exit.json'), JSON.stringify({ code, signal: signal ?? null, minutes: +((Date.now() - t0) / 60000).toFixed(1), model }) + '\n');
});
