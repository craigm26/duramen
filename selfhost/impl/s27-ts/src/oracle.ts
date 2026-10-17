// Running the oracle (REQ-OR-002, REQ-OR-004).

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { holdsBigNumber, isPlainObject, parseJson } from './util.ts';

const RUN_TIMEOUT_MS = 30000;

// Splits an oracle command into words; undefined when a quote is not closed.
export function splitCommand(cmd: string): string[] | undefined {
  const words: string[] = [];
  let cur = '';
  let has = false;
  let i = 0;
  while (i < cmd.length) {
    const ch = cmd[i];
    if (ch === ' ' || ch === '\t') {
      if (has) words.push(cur);
      cur = '';
      has = false;
      i++;
    } else if (ch === '"') {
      has = true;
      i++;
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '\\' && cmd[i + 1] === '"') {
          cur += '"';
          i += 2;
        } else cur += cmd[i++];
      }
      if (i >= cmd.length) return undefined;
      i++;
    } else if (ch === "'") {
      has = true;
      i++;
      while (i < cmd.length && cmd[i] !== "'") cur += cmd[i++];
      if (i >= cmd.length) return undefined;
      i++;
    } else {
      has = true;
      cur += ch;
      i++;
    }
  }
  if (has) words.push(cur);
  return words;
}

export type Run = { lines: string[]; failed: boolean };

export class Oracle {
  dir: string | undefined;
  command: string;
  cwdRel: string;

  constructor(files: Record<string, string>, command: string, oracleFile: string) {
    this.command = command;
    this.cwdRel = dirname(oracleFile) === '.' ? '' : dirname(oracleFile);
    try {
      this.dir = mkdtempSync(join(tmpdir(), 'duramen-'));
      for (const name of Object.keys(files)) {
        try {
          const p = join(this.dir, name);
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, files[name]);
        } catch {
          // a name the file system cannot hold (OPEN-RQ-003)
        }
      }
    } catch {
      this.dir = undefined;
    }
  }

  // Writes the request lines to a run of the oracle and returns its output lines.
  run(requestLines: string[]): Run {
    const words = splitCommand(this.command);
    if (!words || words.length === 0 || !this.dir) return { lines: [], failed: true };
    const input = Buffer.from(requestLines.map((l) => l + '\n').join(''), 'utf8');
    const r = spawnSync(words[0], words.slice(1), {
      cwd: join(this.dir, this.cwdRel),
      input,
      timeout: RUN_TIMEOUT_MS,
      maxBuffer: 1 << 29,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let failed = false;
    if (r.error && (r.error as any).code !== 'EPIPE') failed = true;
    if (r.signal) failed = true;
    if (r.status !== 0 && !(r.error && (r.error as any).code === 'EPIPE' && r.status === null && !r.signal)) {
      failed = true;
    }
    const out = r.stdout ? r.stdout.toString('utf8') : '';
    return { lines: out.split('\n'), failed };
  }

  close() {
    if (this.dir) {
      try {
        rmSync(this.dir, { recursive: true, force: true });
      } catch {
        // nothing to do
      }
    }
  }
}

function asResponse(line: string): any | undefined {
  const p = parseJson(line);
  if (!p.ok || !isPlainObject(p.value) || holdsBigNumber(p.value)) return undefined;
  return p.value;
}

// Matches the output lines of a shared run to examples by id; the first response of an id wins.
export function responsesById(lines: string[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const line of lines) {
    if (/^\s*$/.test(line)) continue;
    const r = asResponse(line);
    if (r && typeof r.id === 'string' && !map.has(r.id)) map.set(r.id, r);
  }
  return map;
}

// The response of a run that held one example alone: the one line it wrote.
export function soloResponse(lines: string[]): any | undefined {
  const real = lines.filter((l) => !/^\s*$/.test(l));
  if (real.length !== 1) return undefined;
  return asResponse(real[0]);
}
