// The driver: one JSON request per line in, one JSON response per line out.

import { check, cases } from './checker.ts';

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function validName(n: string): boolean {
  if (n === '' || /[\\\0]/.test(n) || /^[A-Za-z]:/.test(n)) return false;
  return n.split('/').every((p) => p !== '' && p !== '.' && p !== '..');
}

export function handle(line: string): Record<string, unknown> {
  let req: unknown;
  try { req = JSON.parse(line); } catch { return { id: null, error: 'bad_request' }; }
  if (!isObj(req) || typeof req.id !== 'string') return { id: null, error: 'bad_request' };
  const id = req.id;
  if (req.op !== 'check' && req.op !== 'cases') return { id, error: 'unknown_op' };
  const input = req.input;
  const bad = { id, error: 'bad_request' };
  if (!isObj(input)) return bad;
  const files = input.files;
  if (!isObj(files)) return bad;
  const names = Object.keys(files);
  if (names.length === 0) return bad;
  for (const n of names) if (typeof files[n] !== 'string' || !validName(n)) return bad;
  const set = new Set(names);
  for (const n of names) {
    for (let i = n.indexOf('/'); i >= 0; i = n.indexOf('/', i + 1)) if (set.has(n.slice(0, i))) return bad;
  }
  let entry: string | undefined;
  if (hasOwn(input, 'entry')) {
    const e = input.entry;
    if (typeof e !== 'string' || (e !== '.' && !validName(e))) return bad;
    entry = e;
  }
  try {
    const result = req.op === 'check'
      ? check(files as Record<string, string>, entry)
      : cases(files as Record<string, string>, entry);
    return { id, result };
  } catch (e) {
    process.stderr.write(`internal error: ${e instanceof Error ? e.stack : String(e)}\n`);
    return { id, error: 'internal_error' };
  }
}

function respond(line: string) {
  if (/^[ \t]*$/.test(line)) return;
  process.stdout.write(JSON.stringify(handle(line)) + '\n');
}

if (import.meta.main) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      respond(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  });
  process.stdin.on('end', () => {
    respond(buf);
    buf = '';
  });
}
