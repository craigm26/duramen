// `duramen serve`: duramen as a driver, so that duramen can be specified in duramen and judged
// by its own suite. It speaks the driver protocol every duramen spec uses: one JSON request per
// line on standard input, one JSON response per non-blank line on standard output, in order.
//
//   {"id": "1", "op": "check", "input": {"files": {"s.duramen": "..."}, "entry": "s.duramen"}}
//   {"id": "2", "op": "cases", "input": {"files": {...}, "entry": "."}}
//   {"id": "3", "op": "judge", "input": {"case": {"checks": [...], "full": {...}}, "answer": {...}}}
//
// `files` maps relative paths (with "/") to file contents; they are written to a fresh folder,
// the record named by `entry` (a file or a folder; "." for all of them) is read from there, and
// the folder is removed. A diagnostic is written "<file>:<line>: <level> <code>"; columns and
// message text are not part of the contract.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRecord } from './record.mjs';
import { check } from './check.mjs';
import { generateCases, judgeAnswer } from './suite.mjs';

const ERR = (id, code) => ({ id, error: code });
const LEVELS = { error: 0, warning: 1, info: 2 };

const validName = (n) => n !== '' && !n.includes('\\') && !n.includes('\0') && !isAbsolute(n) && !/^[a-zA-Z]:/.test(n) && !n.split('/').some((p) => p === '' || p === '.' || p === '..');

// Every name a relative path, every value a string, and no name also the folder of another.
export function validFiles(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) return false;
  const names = Object.keys(files);
  if (!names.length) return false;
  const set = new Set(names);
  for (const n of names) {
    if (typeof files[n] !== 'string' || !validName(n)) return false;
    const parts = n.split('/');
    for (let k = 1; k < parts.length; k++) if (set.has(parts.slice(0, k).join('/'))) return false;
  }
  return true;
}

export async function withRecord(input, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'duramen-serve-'));
  try {
    for (const [name, text] of Object.entries(input.files)) {
      const p = join(dir, ...name.split('/'));
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
    }
    const entry = input.entry === undefined || input.entry === '.' ? dir : join(dir, ...input.entry.split('/'));
    const rel = (f) => (f ? relative(dir, f).split('\\').join('/') || '.' : '.');
    return await fn(entry, rel, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function checked(entry, rel) {
  const { ast, diagnostics } = loadRecord(entry);
  const blocked = diagnostics.some((d) => d.level === 'error');
  const r = blocked ? { diagnostics: [], oracle: null, properties: [] } : await check(ast, { timeoutMs: 30_000 });
  const ds = [...diagnostics, ...r.diagnostics]
    .map((d) => ({ file: rel(d.file), line: d.line, level: d.level, code: d.code }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.code < b.code ? -1 : a.code > b.code ? 1 : LEVELS[a.level] - LEVELS[b.level])));
  return { ast, r, ds };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// A check `judge` can read: a string path, and `eq` with a value, or `approx` with numbers (the
// tolerance 0 or more). `present` (the rest of the language: edge packs that refuse) is read too.
function validCheck(ch) {
  if (!isObj(ch) || typeof ch.path !== 'string') return false;
  if (ch.kind === 'eq') return Object.hasOwn(ch, 'value');
  if (ch.kind === 'approx') return isNum(ch.value) && isNum(ch.tol) && ch.tol >= 0;
  return ch.kind === 'present';
}

// The input of `judge` (REQ-JU-001): a case with `checks` and `full`, and an answer.
export function validJudge(input) {
  const c = input.case;
  if (!isObj(c) || !Array.isArray(c.checks) || !c.checks.every(validCheck)) return false;
  if (!Object.hasOwn(c, 'full')) return false;
  const f = c.full;
  if (f !== null) {
    if (!isObj(f) || !Array.isArray(f.members) || !f.members.every((m) => typeof m === 'string')) return false;
    if (!isObj(f.tolerances) || !Object.values(f.tolerances).every((t) => isNum(t) && t >= 0)) return false;
    if (Object.hasOwn(f, 'audit') && typeof f.audit !== 'string') return false;
  }
  return Object.hasOwn(input, 'answer') && (input.answer === null || isObj(input.answer));
}

export async function handle(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req) || typeof req.id !== 'string') return ERR(null, 'bad_request');
  const { id } = req;
  if (req.op !== 'check' && req.op !== 'cases' && req.op !== 'judge') return ERR(id, 'unknown_op');
  const input = req.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ERR(id, 'bad_request');
  if (req.op === 'judge') {
    if (!validJudge(input)) return ERR(id, 'bad_request');
    const failed = judgeAnswer(input.case, input.answer);
    return { id, result: failed.length ? { pass: false, failed } : { pass: true } };
  }
  if (!validFiles(input.files)) return ERR(id, 'bad_request');
  if (input.entry !== undefined && (typeof input.entry !== 'string' || (input.entry !== '.' && !validName(input.entry)))) return ERR(id, 'bad_request');
  return withRecord(input, async (entry, rel) => {
    const { ast, r, ds } = await checked(entry, rel);
    const errors = ds.filter((d) => d.level === 'error').length;
    if (req.op === 'check') return { id, result: { diagnostics: ds.map((d) => `${d.file}:${d.line}: ${d.level} ${d.code}`), errors, warnings: ds.filter((d) => d.level === 'warning').length } };
    // Every case as the suite holds it: an example case is the core's, and the cases of the rest
    // of the language (static checks, evidence, edges, properties) keep what they need to run.
    const cases = errors ? [] : generateCases(ast, r.oracle, r.properties);
    return { id, result: { errors, cases } };
  });
}

// Read every request, then answer them in order (the protocol allows answering after the end of
// input). Never throws: a request that cannot be handled gets an error response.
export async function serve(stdin = process.stdin, write = (s) => process.stdout.write(s)) {
  // The bytes are decoded once, at the end: a character can be split across two chunks.
  const chunks = [];
  for await (const chunk of stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    if (/^[ \t]*$/.test(line)) continue;
    let resp;
    let req;
    try {
      try { req = JSON.parse(line); } catch { req = undefined; }
      resp = req === undefined ? ERR(null, 'bad_request') : await handle(req);
    } catch (e) {
      process.stderr.write(`duramen serve: internal error: ${e?.stack ?? e}\n`);
      resp = ERR(typeof req?.id === 'string' ? req.id : null, 'internal_error');
    }
    write(JSON.stringify(resp) + '\n');
  }
}
