// Talks to a driver program: JSON request lines in, JSON response lines out, matched by id.
// Used for the oracle (when checking a spec) and for implementations (when running a suite).
//
// The runner is defensive about the program on the other end. It never uses a shell; it kills
// the whole process tree on timeout or runaway output; it keeps every response that arrived
// before a failure, so one hung or crashing request does not hide the answers to the others;
// and it reports what happened (exit status, signal, timeout, output cap, the tail of standard
// error) instead of throwing.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULTS = Object.freeze({
  timeoutMs: 60_000, // for the whole run, plus perLineMs for each request line
  perLineMs: 100,
  maxOutputBytes: 64 * 1024 * 1024,
  stderrTailBytes: 16 * 1024,
});

// A command is an array of words, or a string split on spaces and tabs. In a string, a word may
// be quoted with "..." or '...' to hold spaces; inside double quotes \" is a quote and every
// other backslash is literal, so Windows paths survive. No shell features: no variables, globs,
// pipes or redirection.
export function parseCommand(command) {
  if (Array.isArray(command)) {
    if (!command.length || !command.every((w) => typeof w === 'string' && w !== '')) return { error: 'a command array must hold non-empty strings' };
    return { words: [...command] };
  }
  if (typeof command !== 'string') return { error: 'a command is a string or an array of strings' };
  const words = [];
  let cur = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === ' ' || c === '\t') { if (cur !== null) { words.push(cur); cur = null; } continue; }
    if (c === '"' || c === "'") {
      const q = c;
      cur ??= '';
      let j = i + 1;
      for (; j < command.length && command[j] !== q; j++) {
        if (q === '"' && command[j] === '\\' && command[j + 1] === '"') { cur += '"'; j++; continue; }
        cur += command[j];
      }
      if (j >= command.length) return { error: `unclosed ${q} in command` };
      i = j;
      continue;
    }
    cur = (cur ?? '') + c;
  }
  if (cur !== null) words.push(cur);
  if (!words.length) return { error: 'empty command' };
  return { words };
}

export const showCommand = (command) => (Array.isArray(command) ? command.map((w) => (/[\s"']/.test(w) ? JSON.stringify(w) : w)).join(' ') : command);

// Drivers still running, so a caller can stop them all (for example on Ctrl-C).
const ACTIVE = new Set();
export function killAll() { for (const c of ACTIVE) killTree(c); }

function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL'); // the child leads its own process group (detached)
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

// Parse response bytes into lines. Blank lines are skipped. Each non-blank line is either an
// object (kept, and indexed by its string id) or a bad line (kept as undefined in `list`).
export function parseResponses(stdout) {
  const responses = new Map();
  const list = [];
  const order = [];
  const bad = [];
  const duplicates = [];
  for (const line of stdout.toString('utf8').split('\n')) {
    if (line.trim() === '') continue;
    let o;
    try { o = JSON.parse(line); } catch { list.push(undefined); order.push(undefined); bad.push(line); continue; }
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      list.push(o);
      order.push(typeof o.id === 'string' ? o.id : null);
      if (typeof o.id === 'string') {
        if (responses.has(o.id)) duplicates.push(o.id);
        else responses.set(o.id, o);
      } else bad.push(line);
    } else { list.push(undefined); order.push(undefined); bad.push(line); }
  }
  return { responses, list, order, bad, duplicates };
}

// Run a driver once with these request lines. Never rejects. The result:
//   { ok, code, signal, error, timedOut, truncated, responses, list, order, bad, duplicates,
//     stdout (Buffer), stderr (tail, string) }
// `ok` is true only when the driver exited 0 by itself, within the time and output limits.
export function runDriver(command, lines, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const budget = o.timeoutMs + o.perLineMs * lines.length;
  const parsed = parseCommand(command);
  const finish = (base, stdout = Buffer.alloc(0), stderr = '') => ({ ...base, ...parseResponses(stdout), stdout, stderr });
  if (parsed.error) return Promise.resolve(finish({ ok: false, code: null, signal: null, error: `bad driver command ${JSON.stringify(showCommand(command))}: ${parsed.error}`, timedOut: false, truncated: false }));
  const [prog, ...args] = parsed.words;
  return new Promise((resolve) => {
    let child;
    const out = [];
    let outBytes = 0;
    let err = Buffer.alloc(0);
    let settled = false;
    let timedOut = false;
    let truncated = false;
    let timer;
    const settle = (base) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(finish(base, Buffer.concat(out), err.toString('utf8')));
    };
    try {
      child = spawn(prog, args, { cwd: o.cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, env: o.env ?? process.env });
    } catch (e) {
      settle({ ok: false, code: null, signal: null, error: `cannot start driver ${JSON.stringify(showCommand(command))}: ${e.message}`, timedOut: false, truncated: false });
      return;
    }
    ACTIVE.add(child);
    timer = setTimeout(() => { timedOut = true; killTree(child); }, budget);
    child.stdout.on('data', (d) => {
      if (truncated) return;
      outBytes += d.length;
      if (outBytes > o.maxOutputBytes) { truncated = true; out.push(d.subarray(0, d.length - (outBytes - o.maxOutputBytes))); killTree(child); return; }
      out.push(d);
    });
    child.stderr.on('data', (d) => {
      err = Buffer.concat([err, d]);
      if (err.length > o.stderrTailBytes) err = err.subarray(err.length - o.stderrTailBytes);
    });
    child.on('error', (e) => { ACTIVE.delete(child); settle({ ok: false, code: null, signal: null, error: `cannot start driver ${JSON.stringify(showCommand(command))}: ${e.message}`, timedOut: false, truncated: false }); });
    child.on('close', (code, signal) => {
      ACTIVE.delete(child);
      let error = null;
      if (timedOut) error = `driver timed out after ${budget} ms (killed; responses that arrived before that are kept)`;
      else if (truncated) error = `driver wrote more than ${o.maxOutputBytes} bytes to standard output (killed)`;
      else if (signal) error = `driver was killed by ${signal}`;
      else if (code !== 0) error = `driver exited with status ${code}`;
      settle({ ok: error === null, code, signal, error, timedOut, truncated });
    });
    child.stdin.on('error', () => {}); // a driver may exit without reading its input
    child.stdin.end(lines.map((l) => l + '\n').join(''));
  });
}

// The driver command for an implementation folder, from its REGEN.json: a command string, an
// array of words, or an object keyed by Node.js process.platform values plus "default".
export function implDriver(dir) {
  const p = join(dir, 'REGEN.json');
  if (!existsSync(p)) return { error: `${p} not found` };
  let regen;
  try { regen = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return { error: `${p} is not valid JSON: ${e.message}` }; }
  const d = regen?.driver;
  const cmd = typeof d === 'string' || Array.isArray(d) ? d : d && typeof d === 'object' ? d[process.platform] ?? d.default : undefined;
  if (cmd === undefined) return { error: `${p}: no "driver" for ${process.platform}` };
  const parsed = parseCommand(cmd);
  if (parsed.error) return { error: `${p}: driver: ${parsed.error}` };
  return { command: cmd, regen };
}
