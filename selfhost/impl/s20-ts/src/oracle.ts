import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { hasBig, hasOwn, isObj, tryParse } from './util.ts';

const TIMEOUT_MS = 30000;

// Splits an oracle command into words (REQ-OR-002); null when a quote is not closed.
export function splitCommand(cmd: string): string[] | null {
  const words: string[] = [];
  let cur = '';
  let has = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (ch === ' ' || ch === '\t') {
      if (has) words.push(cur);
      cur = '';
      has = false;
    } else if (ch === '"' || ch === "'") {
      has = true;
      let closed = false;
      for (i++; i < cmd.length; i++) {
        if (ch === '"' && cmd[i] === '\\' && cmd[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (cmd[i] === ch) {
          closed = true;
          break;
        } else cur += cmd[i];
      }
      if (!closed) return null;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) words.push(cur);
  return words;
}

// Runs the oracle once with these request lines. `lines` are the non-blank output lines.
export function runOracle(files: Record<string, string>, cmd: string, dir: string, requests: string[]): { failed: boolean; lines: string[] } {
  const words = splitCommand(cmd);
  if (!words || words.length === 0) return { failed: true, lines: [] };
  const root = mkdtempSync(join(tmpdir(), 'duramen-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      try {
        const p = join(root, name);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, text);
      } catch {
        // names a file system cannot hold (OPEN-RQ-003)
      }
    }
    const cwd = join(root, dir);
    mkdirSync(cwd, { recursive: true });
    const prog = words[0] === 'node' ? process.execPath : words[0];
    const r = spawnSync(prog, words.slice(1), {
      cwd,
      input: Buffer.from(requests.map((l) => l + '\n').join(''), 'utf8'),
      timeout: TIMEOUT_MS,
      maxBuffer: 1 << 30,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const out = r.stdout ? r.stdout.toString('utf8') : '';
    const lines = out.split('\n').filter((l) => !/^\s*$/.test(l));
    const hardError = r.error && (r.error as any).code !== 'EPIPE';
    return { failed: Boolean(hardError) || r.status !== 0, lines };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function parseObject(line: string): any {
  const p = tryParse(line);
  return p.ok && isObj(p.value) && !hasBig(p.value) ? p.value : null;
}

// Responses of a shared run, by id; the first of two with one id wins.
export function responsesById(lines: string[]): Map<string, any> {
  const m = new Map<string, any>();
  for (const l of lines) {
    const o = parseObject(l);
    if (o && hasOwn(o, 'id') && typeof o.id === 'string' && !m.has(o.id)) m.set(o.id, o);
  }
  return m;
}

// The response of a run that carried one request alone.
export function soloResponse(lines: string[]): any {
  return lines.length === 1 ? parseObject(lines[0]) : null;
}
