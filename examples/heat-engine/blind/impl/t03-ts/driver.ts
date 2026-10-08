// heat-engine driver: JSON lines on stdin, one JSON line per non-blank request on stdout.
import { readFileSync } from 'node:fs';
import { canonical, wetBulb, wetBulbFromF, flagF, flagC } from './engine.ts';
import type { Out } from './engine.ts';

const SPECIAL: Record<string, number> = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity };

class BadRequest extends Error {}

function num(input: Record<string, unknown>, name: string): number {
  if (!Object.hasOwn(input, name)) throw new BadRequest();
  const v = input[name];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && Object.hasOwn(SPECIAL, v)) return SPECIAL[v];
  throw new BadRequest();
}

const OPS: Record<string, (i: Record<string, unknown>, clock: string) => Out> = {
  wetBulb: (i, c) => wetBulb(num(i, 'tempC'), num(i, 'rhPercent'), c),
  wetBulbF: (i, c) => wetBulbFromF(num(i, 'tempF'), num(i, 'rhPercent'), c),
  flagF: (i, c) => flagF(num(i, 'wetBulbF'), c),
  flagC: (i, c) => flagC(num(i, 'wetBulbC'), c),
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function handle(line: string): string {
  let req: unknown;
  try {
    req = JSON.parse(line);
  } catch {
    return canonical({ id: null, error: 'bad_request' });
  }
  if (!isObj(req) || typeof req.id !== 'string') return canonical({ id: null, error: 'bad_request' });
  const id = req.id;
  const err = (error: string) => canonical({ id, error });
  const op = req.op;
  const isCanon = op === 'canonical';
  if (typeof op !== 'string' || !(isCanon || Object.hasOwn(OPS, op))) return err('unknown_op');
  const input = req.input;
  if (!isObj(input)) return err('bad_request');
  if (isCanon) {
    if (!Object.hasOwn(input, 'value')) return err('bad_request');
    return canonical({ id, result: canonical(input.value) });
  }
  if (typeof req.clock !== 'string') return err('bad_request');
  try {
    const out = OPS[op](input, req.clock);
    return canonical({ id, result: out.result, audit: canonical(out.audit) });
  } catch (e) {
    if (e instanceof BadRequest) return err('bad_request');
    throw e;
  }
}

if (import.meta.main) {
  const text = readFileSync(0).toString('utf8');
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    out.push(handle(line) + '\n');
  }
  process.stdout.write(out.join(''));
}
