// Round three's runner (CONFIDENCE-3.md, R1). It starts a program's driver, sends it request
// lines through the driver protocol, and pairs each response with its request by the request's
// id. It rules on nothing: whether an answer is right is for the regenerated judges to say. It
// shares no code with duramen's own runner (src/driver.mjs), which the loop does not use.
//
// Which response is a case's answer is open in duramen-core (OPEN-SU-001). This runner's rule:
// - a request with an id is sent with others, at most `chunk` to a process, and its answer is
//   the first response line that parses as a JSON object with that id; a request left without
//   an answer (the process died, or wrote nothing for it) is sent again alone, once;
// - a line sent alone (a case marked `solo`, a raw line, a line without an id) gets as its
//   answer the first line the process writes, if that parses as a JSON object;
// - no answer is `null`, which is what the judges are given for it.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';

// The driver an implementation folder's REGEN.json names, as duramen-core's Interface says: a
// command string, or an object keyed by process.platform with `default`.
export function driverOf(dir) {
  const regen = JSON.parse(readFileSync(join(dir, 'REGEN.json'), 'utf8'));
  let d = regen.driver;
  if (d && typeof d === 'object' && !Array.isArray(d)) d = Object.hasOwn(d, process.platform) ? d[process.platform] : d.default;
  if (typeof d !== 'string' || d === '') throw new Error(`${dir}: REGEN.json names no driver`);
  return { command: d, cwd: resolve(dir) };
}

// The same command with every word that names a file in the folder made absolute, so that it
// runs from any folder (for a record's `oracle` statement, which runs where the record is).
export function absoluteCommand(driver) {
  return driver.command.split(' ').map((w) => (w && !isAbsolute(w) && existsSync(join(driver.cwd, w)) && statSync(join(driver.cwd, w)).isFile() ? join(driver.cwd, w) : w)).join(' ');
}

// One process: the lines go in, each followed by LF, and standard input is closed after the
// last (or, with `bytes`, exactly those bytes go in). Resolves with every line the process wrote
// to standard output, and how it ended.
export function session(driver, lines, { timeoutMs = 300_000, bytes = null } = {}) {
  return new Promise((done) => {
    const words = driver.command.split(' ');
    let finished = false;
    const finish = (v) => { if (!finished) { finished = true; done(v); } };
    const child = spawn(words[0], words.slice(1), { cwd: driver.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    let errBytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => { if (errBytes < 1 << 20) { err.push(c); errBytes += c.length; } });
    child.on('error', (e) => { clearTimeout(timer); finish({ lines: [], exit: null, signal: null, timedOut, failed: String(e), stderr: '' }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const text = Buffer.concat(out).toString('utf8');
      const ls = text.split('\n');
      if (ls[ls.length - 1] === '') ls.pop();
      finish({ lines: ls, exit: code, signal, timedOut, stderr: Buffer.concat(err).toString('utf8').slice(-4000) });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes ?? lines.map((l) => `${l}\n`).join(''));
  });
}

const asObject = (line) => {
  try {
    const v = JSON.parse(line);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

// Answers to requests that carry ids: [{ key, id, line }] -> Map key -> { answer, how }.
export async function answerById(driver, requests, { chunk = 40, timeoutMs = 300_000 } = {}) {
  const out = new Map();
  for (let k = 0; k < requests.length; k += chunk) {
    const part = requests.slice(k, k + chunk);
    const r = await session(driver, part.map((q) => q.line), { timeoutMs });
    const byId = new Map();
    for (const l of r.lines) {
      const v = asObject(l);
      if (v && typeof v.id === 'string' && !byId.has(v.id)) byId.set(v.id, v);
    }
    for (const q of part) {
      if (byId.has(q.id)) { out.set(q.key, { answer: byId.get(q.id), how: 'batch' }); continue; }
      const one = await session(driver, [q.line], { timeoutMs });
      const v = one.lines.map(asObject).find((x) => x && x.id === q.id) ?? null;
      out.set(q.key, { answer: v, how: 'alone', exit: one.exit, timedOut: one.timedOut || undefined });
    }
  }
  return out;
}

// The answer to a line sent alone: the first line written, if it is a JSON object.
export async function answerAlone(driver, line, { timeoutMs = 300_000 } = {}) {
  const r = await session(driver, [line], { timeoutMs });
  return { answer: r.lines.length ? asObject(r.lines[0]) : null, how: 'solo', exit: r.exit, timedOut: r.timedOut || undefined };
}

// A whole session for a probe written as raw lines (or as raw bytes): every line written, parsed
// where it can be, and the exit status.
export async function rawSession(driver, lines, { timeoutMs = 60_000, bytes = null } = {}) {
  const r = await session(driver, lines, { timeoutMs, bytes });
  return { exit: r.exit, lines: r.lines.filter((l) => l.trim() !== '').map((l) => { try { return JSON.parse(l); } catch { return { text: l }; } }) };
}

// JSON values compared with member order ignored, as duramen-core compares results.
export const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
