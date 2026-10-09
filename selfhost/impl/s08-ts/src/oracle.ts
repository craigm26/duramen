import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { type Obj, splitCommand, parseJson, isPlainObject } from './util.ts';

export interface RunResult { failed: boolean; lines: string[] }

const TIMEOUT_MS = 20000;

// The record's files, written to a temporary folder so that the oracle can read its own.
export class Sandbox {
  files: Record<string, string>;
  dir: string | undefined;

  constructor(files: Record<string, string>) {
    this.files = files;
  }

  private ensure(): string {
    if (this.dir) return this.dir;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duramen-'));
    for (const [name, text] of Object.entries(this.files)) {
      const full = path.join(dir, ...name.split('/'));
      try {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, text);
      } catch {
        // a name this file system cannot hold (OPEN-RQ-003)
      }
    }
    this.dir = dir;
    return dir;
  }

  run(command: string, cwdRel: string, lines: string[]): RunResult {
    const argv = splitCommand(command);
    if (!argv || argv.length === 0) return { failed: true, lines: [] };
    const dir = this.ensure();
    const cmd = argv[0] === 'node' ? process.execPath : argv[0];
    const r = spawnSync(cmd, argv.slice(1), {
      cwd: cwdRel === '' ? dir : path.join(dir, ...cwdRel.split('/')),
      input: lines.join('\n') + '\n',
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      maxBuffer: 1 << 28,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const err = r.error as NodeJS.ErrnoException | undefined;
    let failed = false;
    if (err && err.code !== 'EPIPE') failed = true;
    if (r.signal) failed = true;
    if (r.status !== null && r.status !== 0) failed = true;
    if (r.status === null && !r.signal && !err) failed = true;
    const out = typeof r.stdout === 'string' ? r.stdout : '';
    const outLines = out.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '');
    return { failed, lines: outLines };
  }

  dispose(): void {
    if (this.dir) {
      try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

export function parseResponse(line: string): Obj | undefined {
  const p = parseJson(line);
  return p.ok && isPlainObject(p.value) ? p.value : undefined;
}
