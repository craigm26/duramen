// Static checks: requirements on an implementation folder that no driver request can observe,
// such as REGEN.json's shape, line and dependency budgets, or the builder's own test command.
// They run in-process against the folder (the test command runs through the platform shell,
// as the regen protocol says `build` and `test` do).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { checkType } from './types.mjs';

// "**/" any folders (or none), "**" anything, "*" anything but "/", "?" one character but "/".
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:[^/]*/)*'; i += 2; } else { re += '.*'; i++; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'u');
}

const MAX_FILES = 20000;

// Every path in a folder, relative and with "/" separators; folders end with "/". `.git` is skipped.
export function listTree(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.name === '.git') continue;
      const p = join(d, e.name);
      const rel = relative(dir, p).split('\\').join('/');
      if (e.isDirectory()) { out.push(rel + '/'); walk(p); } else out.push(rel);
    }
  };
  walk(dir);
  return out;
}

const matchAny = (globs, path) => globs.some((g) => globToRegExp(g).test(path) || (path.endsWith('/') && globToRegExp(g).test(path.slice(0, -1))));
const nonBlank = (text) => text.split(/\r?\n/).filter((l) => l.trim() !== '').length;

function regenCommand(regen, key) {
  const v = regen?.[key];
  if (v === undefined) return { error: `REGEN.json has no "${key}"` };
  const c = typeof v === 'string' || Array.isArray(v) ? v : v && typeof v === 'object' ? v[process.platform] ?? v.default : undefined;
  if (c === undefined) return { error: `REGEN.json "${key}" has no entry for ${process.platform} and no "default"` };
  return { command: Array.isArray(c) ? c.join(' ') : c };
}

function runShell(command, cwd, seconds) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    let tail = '';
    const keep = (d) => { tail = (tail + d.toString('utf8')).slice(-4000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(-child.pid, 'SIGKILL');
      } catch { /* gone */ }
      resolve({ code: null, timedOut: true, tail });
    }, seconds * 1000);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, error: e.message, tail }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, tail }); });
  });
}

// Evaluate one static check against a folder. Returns { ok, why: [..] }.
export async function evaluateStatic(st, dir, typeEnv) {
  const tree = listTree(dir);
  const files = tree.filter((p) => !p.endsWith('/'));
  switch (st.kind) {
    case 'exists': {
      const missing = st.globs.filter((g) => !tree.some((p) => matchAny([g], p)));
      return { ok: !missing.length, why: missing.map((g) => `nothing matches ${JSON.stringify(g)}`) };
    }
    case 'absent': {
      const found = tree.filter((p) => matchAny(st.globs, p));
      return { ok: !found.length, why: found.slice(0, 5).map((p) => `${p} should not exist`) };
    }
    case 'lines': {
      const counted = files.filter((p) => matchAny(st.globs, p) && !matchAny(st.exclude, p));
      let total = 0;
      for (const p of counted) { try { total += nonBlank(readFileSync(join(dir, p), 'utf8')); } catch { /* unreadable: not counted */ } }
      return { ok: total <= st.max, why: total <= st.max ? [] : [`${total} non-blank lines in ${counted.length} files; at most ${st.max}`], measured: total };
    }
    case 'json': {
      let value;
      try { value = JSON.parse(readFileSync(join(dir, st.target), 'utf8')); } catch (e) { return { ok: false, why: [`${st.target}: ${e.code === 'ENOENT' ? 'not found' : e.message}`] }; }
      const why = checkType(st.type, value, typeEnv);
      return { ok: !why, why: why ? [`${st.target} ${why}`] : [] };
    }
    case 'text': {
      const re = new RegExp(st.pattern, 'u');
      const hits = [];
      for (const p of files.filter((x) => matchAny(st.globs, x))) {
        let text;
        try { if (statSync(join(dir, p)).size > 4 * 1024 * 1024) continue; text = readFileSync(join(dir, p), 'utf8'); } catch { continue; }
        const lines = text.split(/\r?\n/);
        const k = lines.findIndex((l) => re.test(l));
        if (k >= 0) hits.push(`${p}:${k + 1} matches ${JSON.stringify(st.pattern)}`);
      }
      return { ok: !hits.length, why: hits.slice(0, 5) };
    }
    case 'command': {
      let regen;
      try { regen = JSON.parse(readFileSync(join(dir, 'REGEN.json'), 'utf8')); } catch (e) { return { ok: false, why: [`REGEN.json: ${e.code === 'ENOENT' ? 'not found' : e.message}`] }; }
      const c = regenCommand(regen, st.key);
      if (c.error) return { ok: false, why: [c.error] };
      if (c.command.trim() === '') return { ok: true, why: [] }; // an empty command means there is nothing to do
      const r = await runShell(c.command, dir, st.within);
      if (r.timedOut) return { ok: false, why: [`"${c.command}" did not finish within ${st.within} s`] };
      if (r.error) return { ok: false, why: [`"${c.command}": ${r.error}`] };
      return { ok: r.code === 0, why: r.code === 0 ? [] : [`"${c.command}" exited with status ${r.code}`, ...r.tail.trim().split('\n').slice(-8).map((l) => `  ${l}`)] };
    }
    default: return { ok: false, why: [`unknown static check ${st.kind}`] };
  }
}

export function describeStatic(st) {
  const list = (gs) => gs.map((g) => `\`${g}\``).join(', ');
  switch (st.kind) {
    case 'exists': return `the implementation folder has ${list(st.globs)}`;
    case 'absent': return `the implementation folder has nothing matching ${list(st.globs)}`;
    case 'lines': return `files matching ${list(st.globs)}${st.exclude.length ? `, excluding ${list(st.exclude)},` : ''} hold at most ${st.max} non-blank lines in total`;
    case 'json': return `\`${st.target}\` is JSON of type \`${st.typeText}\``;
    case 'command': return `the command REGEN.json names as \`${st.key}\` exits with status 0 within ${st.within} s (run in the implementation folder, through the platform shell)`;
    case 'text': return `no file matching ${list(st.globs)} has a line matching \`${st.pattern}\``;
    default: return st.kind;
  }
}
