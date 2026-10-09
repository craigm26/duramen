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

export const MAX_FILES = 20000;
export const MAX_SEARCH_BYTES = 4 * 1024 * 1024;

// Every path in a folder, relative and with "/" separators; folders end with "/". `.git` is
// skipped. A listing is never cut short in silence: `truncated` says it stopped at MAX_FILES,
// and `unreadable` names the folders it could not read (the folder itself as "."), so a check
// that needs the whole tree fails instead of judging part of it.
export function listTree(dir, max = MAX_FILES) {
  const paths = [];
  const unreadable = [];
  let truncated = false;
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { unreadable.push(relative(dir, d).split('\\').join('/') || '.'); return; }
    for (const e of entries) {
      if (paths.length >= max) { truncated = true; return; }
      if (e.name === '.git') continue;
      const p = join(d, e.name);
      const rel = relative(dir, p).split('\\').join('/');
      if (e.isDirectory()) { paths.push(rel + '/'); walk(p); } else paths.push(rel);
    }
  };
  walk(dir);
  return { paths, truncated, unreadable };
}

// Why a check that needs the whole tree cannot be judged, or [] when it can.
const incomplete = (t, max) => [
  ...(t.truncated ? [`the folder has more than ${max} entries; only the first ${max} were read, so this cannot be judged`] : []),
  ...t.unreadable.map((d) => `${d === '.' ? 'the folder' : d} could not be read`),
];

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
export async function evaluateStatic(st, dir, typeEnv, { maxFiles = MAX_FILES, maxSearchBytes = MAX_SEARCH_BYTES } = {}) {
  const listing = ['exists', 'absent', 'lines', 'text'].includes(st.kind) ? listTree(dir, maxFiles) : { paths: [], truncated: false, unreadable: [] };
  const tree = listing.paths;
  const files = tree.filter((p) => !p.endsWith('/'));
  const gaps = incomplete(listing, maxFiles);
  switch (st.kind) {
    case 'exists': {
      // What was found is found; what was not found may lie in the part that was not read.
      const missing = st.globs.filter((g) => !tree.some((p) => matchAny([g], p)));
      return { ok: !missing.length, why: [...missing.map((g) => `nothing matches ${JSON.stringify(g)}`), ...(missing.length ? gaps : [])] };
    }
    case 'absent': {
      const found = tree.filter((p) => matchAny(st.globs, p));
      return { ok: !found.length && !gaps.length, why: [...found.slice(0, 5).map((p) => `${p} should not exist`), ...gaps] };
    }
    case 'lines': {
      const counted = files.filter((p) => matchAny(st.globs, p) && !matchAny(st.exclude, p));
      let total = 0;
      const unread = [];
      for (const p of counted) { try { total += nonBlank(readFileSync(join(dir, p), 'utf8')); } catch (e) { unread.push(`${p} could not be read (${e.code ?? e.message}), so its lines were not counted`); } }
      const why = [...(total > st.max ? [`${total} non-blank lines in ${counted.length} files; at most ${st.max}`] : []), ...unread, ...gaps];
      return { ok: !why.length, why, measured: total };
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
      const unread = [];
      for (const p of files.filter((x) => matchAny(st.globs, x))) {
        let text;
        try {
          if (statSync(join(dir, p)).size > maxSearchBytes) { unread.push(`${p} is larger than ${maxSearchBytes} bytes and was not searched`); continue; }
          text = readFileSync(join(dir, p), 'utf8');
        } catch (e) { unread.push(`${p} could not be read (${e.code ?? e.message}) and was not searched`); continue; }
        const lines = text.split(/\r?\n/);
        const k = lines.findIndex((l) => re.test(l));
        if (k >= 0) hits.push(`${p}:${k + 1} matches ${JSON.stringify(st.pattern)}`);
      }
      const why = [...hits.slice(0, 5), ...unread.slice(0, 5), ...gaps];
      return { ok: !why.length, why };
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
