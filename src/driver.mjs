// Talks to a driver program: JSON request lines in, JSON response lines out, matched by id.
// Used for the oracle (when checking a spec) and for implementations (when running a suite).
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Split a command on single spaces and start it without a shell, as the regen suites do.
// Returns the parsed responses by id, the parsed lines and their ids in the order they came, and
// the raw stdout bytes (for the protocol checks in suite.mjs).
export function runDriver(command, lines, { cwd, timeoutMs = 60_000 } = {}) {
  const [prog, ...args] = command.split(' ').filter(Boolean);
  return new Promise((resolve) => {
    let child;
    const out = [];
    let err = '';
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    const empty = { responses: new Map(), list: [], order: [], stdout: Buffer.alloc(0), bad: [] };
    const timer = setTimeout(() => { child?.kill(); done({ ok: false, error: `driver timed out after ${timeoutMs} ms`, ...empty, stderr: err }); }, timeoutMs);
    try {
      child = spawn(prog, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      done({ ok: false, error: `cannot start driver "${command}": ${e.message}`, ...empty, stderr: '' });
      return;
    }
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
    child.on('error', (e) => done({ ok: false, error: `cannot start driver "${command}": ${e.message}`, ...empty, stderr: err }));
    child.on('close', (code) => {
      const stdout = Buffer.concat(out);
      const responses = new Map();
      const list = [];
      const order = [];
      const bad = [];
      for (const line of stdout.toString('utf8').split('\n')) {
        if (line.trim() === '') continue;
        try {
          const o = JSON.parse(line);
          if (o && typeof o === 'object' && !Array.isArray(o)) {
            list.push(o);
            order.push(typeof o.id === 'string' ? o.id : null);
            if (typeof o.id === 'string') responses.set(o.id, o); else bad.push(line);
          } else { list.push(undefined); order.push(undefined); bad.push(line); }
        } catch { list.push(undefined); order.push(undefined); bad.push(line); }
      }
      done({ ok: code === 0, code, error: code === 0 ? null : `driver exited with status ${code}`, responses, list, order, stdout, bad, stderr: err });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(lines.map((l) => l + '\n').join(''));
  });
}

// The driver command for an implementation folder, from its REGEN.json (platform-specific
// entries allowed: { "win32": "...", "default": "..." }).
export function implDriver(dir) {
  const p = join(dir, 'REGEN.json');
  if (!existsSync(p)) throw new Error(`${p} not found`);
  const regen = JSON.parse(readFileSync(p, 'utf8'));
  const d = regen.driver;
  const cmd = typeof d === 'string' ? d : d?.[process.platform] ?? d?.default;
  if (!cmd) throw new Error(`${p}: no driver for ${process.platform}`);
  return cmd;
}
