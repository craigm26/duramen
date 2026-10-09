// `duramen hook`: a Claude Code hook. Registered for PostToolUse on Edit, Write and MultiEdit, it
// reads the hook's JSON on standard input and, when the edited file is a .duramen file, checks
// the record it belongs to. Problems go back to the agent as a block decision with the
// diagnostics, so a record is never left in a state that does not check; a clean record adds
// one line of context. Other files are left alone.
//
// .claude/settings.json:
//   {"hooks": {"PostToolUse": [{"matcher": "Edit|Write|MultiEdit",
//     "hooks": [{"type": "command", "command": "node /path/to/duramen/bin/duramen.mjs hook"}]}]}}
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, isAbsolute, basename, join } from 'node:path';

// The record a .duramen file belongs to. A folder whose .duramen files hold exactly one `spec`
// statement between them is one record (as spec/ is); a folder where several files each state
// their own spec holds several records (as examples/history does), and the file is its own.
export function recordOf(file) {
  const dir = dirname(file);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.duramen')); } catch { return file; }
  if (files.length < 2) return file;
  const specs = files.filter((f) => { try { return /^spec\s/m.test(readFileSync(join(dir, f), 'utf8')); } catch { return false; } }).length;
  return specs === 1 ? dir : file;
}

export async function hook(input, { run } = {}) {
  let event;
  try { event = JSON.parse(input); } catch { return { code: 0, out: '' }; }
  const f = event?.tool_input?.file_path ?? event?.tool_input?.path;
  if (typeof f !== 'string' || !f.endsWith('.duramen')) return { code: 0, out: '' };
  const file = isAbsolute(f) ? f : resolve(event.cwd ?? process.cwd(), f);
  if (!existsSync(file)) return { code: 0, out: '' };
  const target = recordOf(file);
  const lines = [];
  const code = await run(['check', target], { out: (s) => lines.push(s), err: (s) => lines.push(s) });
  const summary = lines.at(-1) ?? '';
  if (code === 0) {
    return { code: 0, out: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `duramen check ${basename(target)}: ${summary}` } }) };
  }
  const reason = [`duramen check found problems in ${target} after this edit:`, ...lines, 'Fix the record so that it checks clean before going on. Each code is explained in duramen\'s DESIGN.md (or by the explain tool of duramen mcp).'].join('\n');
  return { code: 0, out: JSON.stringify({ decision: 'block', reason }) };
}
