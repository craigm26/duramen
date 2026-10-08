// Shared helpers for the tests.
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRecord } from '../src/record.mjs';
import { check } from '../src/check.mjs';

export const ROOT = resolve(import.meta.dirname, '..');
export const HEAT = join(ROOT, 'examples', 'heat-engine', 'heat.duramen');
export const HEAT_DIR = join(ROOT, 'examples', 'heat-engine');
export const ORACLE_DRIVER = join(HEAT_DIR, 'oracle-driver.mjs').replace(/\\/g, '/');
export const IMPLS = process.env.HEAT_ENGINE_IMPLS ?? join(ROOT, '..', 'regen-heat-engine', 'impl');

export const src = (s) => s.replace(/^\n/, '');
export const codes = (ds, level = 'error') => ds.filter((d) => d.level === level).map((d) => d.code).sort();

export async function checkPath(path, opts = {}) {
  const { ast, diagnostics } = loadRecord(path);
  const r = diagnostics.some((d) => d.level === 'error') ? { diagnostics: [], oracle: null, corroboration: [], properties: [] } : await check(ast, opts);
  return { ast, ds: [...diagnostics, ...r.diagnostics], oracle: r.oracle, properties: r.properties, corroboration: r.corroboration };
}

// A temporary folder with these files ({ "a/b.duramen": "..." }); removed after fn.
export async function withFiles(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'duramen-test-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A tiny oracle for tests: op "add" returns {sum: a + b}; op "echo" returns its input; op "fail"
// answers {"error": "bad"}. Requests whose input is not an object get bad_request.
export const CALC_ORACLE = `
let s = '';
for await (const c of process.stdin) s += c;
const out = [];
for (const line of s.split('\\n')) {
  if (line.trim() === '') continue;
  let r;
  try { r = JSON.parse(line); } catch { out.push(JSON.stringify({ id: null, error: 'bad_request' })); continue; }
  const id = typeof r.id === 'string' ? r.id : null;
  const i = r.input;
  if (r.op === 'add' && i && typeof i.a === 'number' && typeof i.b === 'number') out.push(JSON.stringify({ id, result: { sum: i.a + i.b } }));
  else if (r.op === 'echo') out.push(JSON.stringify({ id, result: i ?? null }));
  else if (r.op === 'fail') out.push(JSON.stringify({ id, error: 'bad' }));
  else out.push(JSON.stringify({ id, error: r.op === 'add' ? 'bad_request' : 'unknown_op' }));
}
process.stdout.write(out.map((l) => l + '\\n').join(''));
`;
