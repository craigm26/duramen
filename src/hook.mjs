// `duramen hook`: a Claude Code hook. Registered for PostToolUse on Edit, Write and MultiEdit, it
// reads the hook's JSON on standard input and, when the edited file is a .duramen file, checks
// the record it belongs to. Problems go back to the agent as a block decision with the
// diagnostics, so a record is never left in a state that does not check; a clean record adds
// one line of context. Other files are left alone.
//
// .claude/settings.json:
//   {"hooks": {"PostToolUse": [{"matcher": "Edit|Write|MultiEdit",
//     "hooks": [{"type": "command", "command": "node /path/to/duramen/bin/duramen.mjs hook"}]}]}}
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, isAbsolute, basename, relative } from 'node:path';
import { recordFiles } from './record.mjs';

// The record a .duramen file belongs to: the nearest folder, from the file's own up to `top`,
// whose .duramen files, subfolders included as a folder record reads them, hold exactly one
// `spec` statement between them (as spec/ does). A folder where several files each state their
// own spec holds several records (as examples/history does), and there, or when no folder up to
// `top` is a record, the file is its own. The walk goes no higher than `top`, the project's
// folder, and stays in the file's own folder when the file is outside it.
export function recordOf(file, top = dirname(file)) {
  const within = (d) => { const r = relative(top, d); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    let files = [];
    try { files = recordFiles(dir); } catch { return file; }
    if (files.length >= 2) {
      const specs = files.filter((f) => { try { return /^spec\s/m.test(readFileSync(f, 'utf8')); } catch { return false; } }).length;
      if (specs === 1) return dir;
      if (specs > 1) return file;
    }
    if (!within(dir) || dir === top || dirname(dir) === dir) return file;
  }
}

export async function hook(input, { run } = {}) {
  let event;
  try { event = JSON.parse(input); } catch { return { code: 0, out: '' }; }
  const f = event?.tool_input?.file_path ?? event?.tool_input?.path;
  if (typeof f !== 'string' || !f.endsWith('.duramen')) return { code: 0, out: '' };
  const file = isAbsolute(f) ? f : resolve(event.cwd ?? process.cwd(), f);
  if (!existsSync(file)) return { code: 0, out: '' };
  const project = resolve(event.cwd ?? process.cwd());
  const inProject = !relative(project, file).startsWith('..') && !isAbsolute(relative(project, file));
  const target = recordOf(file, inProject ? project : dirname(file));
  const lines = [];
  const code = await run(['check', target], { out: (s) => lines.push(s), err: (s) => lines.push(s) });
  const summary = lines.at(-1) ?? '';
  if (code === 0) {
    return { code: 0, out: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `duramen check ${basename(target)}: ${summary}` } }) };
  }
  const reason = [`duramen check found problems in ${target} after this edit:`, ...lines, 'Fix the record so that it checks clean before going on. Each code is explained in duramen\'s DESIGN.md (or by the explain tool of duramen mcp).'].join('\n');
  return { code: 0, out: JSON.stringify({ decision: 'block', reason }) };
}
