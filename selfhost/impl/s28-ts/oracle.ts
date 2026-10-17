import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { object, readJSON } from './comparison.ts';
import { diagnostic } from './model.ts';
import type { Example, RecordModel } from './model.ts';

export function commandWords(text: string): string[] | undefined {
  const words: string[] = [];
  let word = '', quote = '', active = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
      else if (quote === '"' && ch === '\\' && text[i + 1] === '"') { word += '"'; i++; }
      else word += ch;
    } else if (ch === '"' || ch === "'") { quote = ch; active = true; }
    else if (ch === ' ' || ch === '\t') {
      if (active) { words.push(word); word = ''; active = false; }
    } else { word += ch; active = true; }
  }
  if (quote) return undefined;
  if (active) words.push(word);
  return words.length ? words : undefined;
}

export function runOracle(r: RecordModel, examples: Example[]): void {
  if (!r.oracle || !examples.length) return;
  const dir = mkdtempSync(join(process.cwd(), '.duramen-run-'));
  try {
    const recordDir = join(dir, 'record');
    for (const [file, text] of Object.entries(r.files)) {
      const path = join(recordDir, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, 'utf8');
    }
    const args = commandWords(r.oracle.command!);
    const cwd = join(recordDir, dirname(r.oracle.file));
    const run = (batch: Example[], solo: boolean) => {
      let stdout = '', failed = true;
      if (args) {
        const stdinPath = join(dir, 'stdin'), stdoutPath = join(dir, 'stdout');
        writeFileSync(stdinPath, Buffer.from(batch.map(e => e.requestLine + '\n').join(''), 'utf8'));
        const fds = [openSync(stdinPath, 'r'), openSync(stdoutPath, 'w'), openSync(join(dir, 'stderr'), 'w')];
        try {
          const child = spawnSync(args[0], args.slice(1), {
            cwd, stdio: fds, timeout: 10000,
          });
          failed = !!child.error || child.status !== 0 || child.signal !== null;
        } catch {} finally { fds.forEach(fd => closeSync(fd)); }
        stdout = readFileSync(stdoutPath, 'utf8');
      }
      if (failed) diagnostic(r, solo ? batch[0] : r.oracle!, 'T020');
      const lines = stdout.split('\n').filter(line => !/^\s*$/.test(line));
      if (solo) {
        if (lines.length === 1) {
          try { const response = readJSON(lines[0]); if (object(response)) batch[0].response = response; } catch {}
        }
      } else {
        const responses = new Map<string, any>();
        for (const line of lines) {
          try {
            const response = readJSON(line);
            if (object(response) && typeof response.id === 'string' && !responses.has(response.id)) responses.set(response.id, response);
          } catch {}
        }
        for (const e of batch) if (responses.has(e.id!)) e.response = responses.get(e.id!);
      }
    };
    const batch = examples.filter(e => !e.solo);
    if (batch.length) run(batch, false);
    for (const e of examples) if (e.solo) run([e], true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
