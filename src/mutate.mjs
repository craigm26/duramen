// `duramen mutate`: how much of the oracle does the spec actually pin down?
//
// The oracle is a program, and an example written `?` takes whatever it answers. So the useful
// question is not whether the oracle passes the spec's checks (it does, by construction) but
// whether the spec would notice if the oracle were wrong. This module plants one small mistake
// at a time in the oracle's JavaScript source (a number, an arithmetic or comparison operator,
// a logical operator), runs `duramen check` against the mutated oracle, and counts the mistakes
// that some check catches. A mistake nothing catches marks behavior that only the oracle
// stands behind: add a typed value, evidence or a property there, or say it is open.
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, dirname, relative, resolve } from 'node:path';
import { tmpdir, availableParallelism } from 'node:os';
import { check } from './check.mjs';
import { generateCases, answerDiffers } from './suite.mjs';

const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>', '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '!', '~', '?', ':', '=', '.', '@', '#'];
const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '=>', '==', '===', '!=', '!==', '<=', '>=', '&&', '||', '??', '+=', '-=', '*=', '/=', '%=', 'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

// A tokenizer good enough to find numbers and operators in ordinary JavaScript: it skips
// comments, strings, template literals (with nested `${}`) and regular expression literals.
export function tokenize(src) {
  const toks = [];
  let i = 0, line = 1, col = 1;
  const stack = []; // template nesting: brace depth at each `${`
  let depth = 0;
  const adv = (n) => { for (let k = 0; k < n; k++) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } };
  const prevSig = () => toks[toks.length - 1];
  const regexAllowed = () => { const p = prevSig(); return !p || (p.t === 'punct' && REGEX_AFTER.has(p.v)) || (p.t === 'name' && REGEX_AFTER.has(p.v)); };
  function template() { // after an opening ` or a closing } of a ${}: read to ` or ${
    while (i < src.length) {
      if (src[i] === '\\') { adv(2); continue; }
      if (src[i] === '`') { adv(1); return; }
      if (src[i] === '$' && src[i + 1] === '{') { adv(2); stack.push(depth); depth = 0; return; }
      adv(1);
    }
  }
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { adv(1); continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') adv(1); continue; }
    if (c === '/' && src[i + 1] === '*') { adv(2); while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) adv(1); adv(2); continue; }
    const at = { line, col, i };
    if (c === '"' || c === "'") {
      adv(1);
      while (i < src.length && src[i] !== c && src[i] !== '\n') adv(src[i] === '\\' ? 2 : 1);
      adv(1);
      toks.push({ t: 'str', ...at, end: i });
      continue;
    }
    if (c === '`') { adv(1); template(); toks.push({ t: 'str', ...at, end: i }); continue; }
    if (c === '}' && depth === 0 && stack.length) { adv(1); depth = stack.pop(); template(); toks.push({ t: 'str', ...at, end: i }); continue; }
    if (c === '/' && regexAllowed()) {
      adv(1);
      let cls = false;
      while (i < src.length && src[i] !== '\n') {
        if (src[i] === '\\') { adv(2); continue; }
        if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; else if (src[i] === '/' && !cls) break;
        adv(1);
      }
      adv(1);
      while (/[a-z]/i.test(src[i] ?? '')) adv(1);
      toks.push({ t: 'regex', ...at, end: i });
      continue;
    }
    const num = src.slice(i).match(/^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)n?/);
    if (num && /[\d.]/.test(c) && !(c === '.' && !/\d/.test(src[i + 1] ?? ''))) { adv(num[0].length); toks.push({ t: 'num', v: num[0], ...at, end: i }); continue; }
    const name = src.slice(i).match(/^[A-Za-z_$][\w$]*/);
    if (name) { adv(name[0].length); toks.push({ t: 'name', v: name[0], ...at, end: i }); continue; }
    const p = PUNCT.find((x) => src.startsWith(x, i));
    if (p) {
      if (p === '{') depth++;
      if (p === '}') depth--;
      adv(p.length);
      toks.push({ t: 'punct', v: p, ...at, end: i });
      continue;
    }
    adv(1); // anything else (unicode, stray characters): skip
  }
  return toks;
}

const SWAP = { '+': ['-'], '-': ['+'], '*': ['/'], '/': ['*'], '<': ['<='], '<=': ['<'], '>': ['>='], '>=': ['>'], '===': ['!=='], '!==': ['==='], '==': ['!='], '!=': ['=='], '&&': ['||'], '||': ['&&'] };

function numberMutants(text) {
  if (/[xXbBoOn_]/.test(text)) return [];
  const v = Number(text);
  if (!Number.isFinite(v)) return [];
  if (Number.isInteger(v) && !/[.eE]/.test(text)) return [...new Set([String(v + 1), String(v === 0 ? 2 : v - 1)])].filter((x) => x !== text);
  // a decimal: change its last digit by one, which keeps the size of the number
  const m = text.match(/^(.*?)(\d)((?:[eE][+-]?\d+)?)$/);
  if (!m) return [];
  const d = Number(m[2]);
  return [`${m[1]}${(d + 1) % 10}${m[3]}`];
}

// Every mutant of a source text: { line, col, from, to, text }.
export function mutantsOf(src) {
  const toks = tokenize(src);
  const out = [];
  toks.forEach((t, k) => {
    const prev = toks[k - 1];
    let alts = [];
    if (t.t === 'num') {
      // leave array indexes and import-like positions alone: x[0], .at(0) are structural
      if (prev?.t === 'punct' && prev.v === '[' && toks[k + 1]?.v === ']') return;
      alts = numberMutants(t.v);
    } else if (t.t === 'punct' && SWAP[t.v]) {
      // a + or - that is unary (after an operator or an opening bracket) is a sign, not arithmetic
      if ((t.v === '+' || t.v === '-') && (!prev || (prev.t === 'punct' && !([')', ']', '}'].includes(prev.v))) || (prev.t === 'name' && REGEX_AFTER.has(prev.v)))) return;
      alts = SWAP[t.v];
    }
    for (const a of alts) out.push({ line: t.line, col: t.col, at: t.i, from: src.slice(t.i, t.end), to: a, text: src.slice(0, t.i) + a + src.slice(t.end) });
  });
  return out;
}

const CAUGHT = new Set(['T002', 'T006', 'T030', 'T031', 'T038', 'T020', 'T021', 'T022', 'T024', 'T025']);

// Which offsets of a source file ran, from the V8 coverage files of every process that loaded it
// (NODE_V8_COVERAGE). An offset's count is the count of the smallest range around it.
function coverage(covDir, file) {
  const url = pathToFileURL(file).href;
  const runs = [];
  for (const f of readdirSync(covDir)) {
    let j;
    try { j = JSON.parse(readFileSync(join(covDir, f), 'utf8')); } catch { continue; }
    for (const script of j.result ?? []) {
      if (script.url !== url) continue;
      runs.push(script.functions.flatMap((fn) => fn.ranges.map((r) => [r.startOffset, r.endOffset, r.count])));
    }
  }
  return (offset) => runs.some((ranges) => {
    let best = null;
    for (const r of ranges) if (r[0] <= offset && offset < r[1] && (!best || r[1] - r[0] < best[1] - best[0])) best = r;
    return best ? best[2] > 0 : false;
  });
}

// Run the mutation analysis. `files` are oracle source files (absolute). A mutant is caught when
// a check reports it; unpinned when it changes an answer to some check's request beyond the op's
// tolerances and nothing reports it; within tolerance; or silent when no answer changes. Mutants in code the
// spec's checks never run are reported apart (unreached): no check can catch them, and that the
// spec never exercises the code is itself worth knowing. Returns
// { total, killed, survived: [...], unreached, byCode: {...} }.
export async function mutate(ast, files, { jobs = Math.max(1, Math.min(8, availableParallelism() - 1)), limit, onProgress, timeoutMs } = {}) {
  const oracleDir = dirname(ast.oracle.file ?? ast.file);
  const covDir = mkdtempSync(join(tmpdir(), 'duramen-coverage-'));
  let base;
  try {
    base = await check(ast, { timeoutMs, env: { ...process.env, NODE_V8_COVERAGE: covDir } });
  } catch (e) { rmSync(covDir, { recursive: true, force: true }); throw e; }
  const baseErrors = base.diagnostics.filter((d) => d.level === 'error');
  if (baseErrors.length) { rmSync(covDir, { recursive: true, force: true }); return { error: `the spec does not check clean before mutation (${baseErrors.length} errors)`, baseline: baseErrors }; }
  const all = [];
  let unreached = 0;
  try {
    for (const f of files) {
      const rel = relative(oracleDir, f);
      if (rel.startsWith('..')) return { error: `${f} is not inside the oracle's folder ${oracleDir}` };
      const src = readFileSync(f, 'utf8');
      const ran = coverage(covDir, f);
      for (const m of mutantsOf(src)) { if (ran(m.at)) all.push({ file: rel, ...m }); else unreached++; }
    }
  } finally { rmSync(covDir, { recursive: true, force: true }); }
  const todo = limit ? sample(all, limit) : all;
  // Every answer the checks asked for: examples, evidence rows, pack items, and property calls.
  // A property call whose input depends on an earlier answer is compared only when its request
  // is the same as in the unmutated run; otherwise the difference began upstream.
  const linesOf = (r) => new Map((r.properties ?? []).flatMap((p) => [...(p.answers ?? [])].map(([id, a]) => [id, a.line])));
  const answersOf = (r) => {
    const m = new Map(r.oracle?.responses ?? []);
    for (const p of r.properties ?? []) for (const [id, a] of p.answers ?? []) m.set(id, a.resp);
    return m;
  };
  const baseMap = answersOf(base);
  const baseLines = linesOf(base);
  const baseAnswers = new Map([...baseMap].map(([id, resp]) => [id, JSON.stringify(resp)]));
  const fullOf = new Map(generateCases(ast, base.oracle).filter((c) => c.full).map((c) => [c.id, c.full]));
  for (const p of base.properties) {
    for (const [id, { op: opName, resp }] of p.answers) {
      const op = ast.ops.find((o) => o.name === opName);
      fullOf.set(id, { members: Object.keys(resp).sort(), error: resp.error, result: resp.result, audit: op?.audit ? resp.audit : undefined, tolerances: op?.tolerances ?? {} });
    }
  }
  const results = new Array(todo.length);
  let next = 0, done = 0;
  async function worker() {
    const dir = mkdtempSync(join(tmpdir(), 'duramen-mutate-'));
    try {
      cpSync(oracleDir, dir, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git|build)([\\/]|$)/.test(p) });
      const originals = new Map(files.map((f) => [relative(oracleDir, f), readFileSync(f, 'utf8')]));
      while (next < todo.length) {
        const k = next++;
        const m = todo[k];
        for (const [rel, text] of originals) writeFileSync(join(dir, rel), rel === m.file ? m.text : text);
        const mast = { ...ast, oracle: { ...ast.oracle, file: join(dir, 'oracle.duramen') } };
        const r = await check(mast, { timeoutMs: timeoutMs ?? 20_000 });
        const codes = [...new Set(r.diagnostics.filter((d) => d.level === 'error' || d.code === 'T024').map((d) => d.code))].filter((c) => CAUGHT.has(c)).sort();
        // A mutant nothing caught either changed some answer (and only the oracle stood behind
        // it: "unpinned") or changed none of the answers the checks asked for ("silent").
        const now = answersOf(r);
        const nowLines = linesOf(r);
        const changed = codes.length ? [] : [...baseAnswers].filter(([id, text]) => (!baseLines.has(id) || baseLines.get(id) === nowLines.get(id)) && JSON.stringify(now.get(id)) !== text).map(([id]) => id);
        // ... and an answer that changed only within the op's tolerances is one the suite allows.
        const beyond = changed.filter((id) => !fullOf.has(id) || answerDiffers(fullOf.get(id), now.get(id)).length);
        results[k] = { file: m.file, line: m.line, col: m.col, from: m.from, to: m.to, caught: codes, changed, beyond };
        done++;
        onProgress?.(done, todo.length);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, todo.length || 1) }, worker));
  const byCode = {};
  for (const r of results) for (const c of r.caught) byCode[c] = (byCode[c] ?? 0) + 1;
  const survived = results.filter((r) => !r.caught.length);
  const unpinned = survived.filter((r) => r.beyond.length);
  const tolerated = survived.filter((r) => !r.beyond.length && r.changed.length);
  const silent = survived.filter((r) => !r.changed.length);
  return { total: results.length, killed: results.length - survived.length, survived, unpinned, tolerated, silent, byCode, results, of: all.length, unreached };
}

function sample(xs, n) {
  if (n >= xs.length) return xs;
  const step = xs.length / n;
  return Array.from({ length: n }, (_, k) => xs[Math.floor(k * step)]);
}

export const oracleSources = (ast) => (ast.oracle?.sources ?? []).map((s) => resolve(dirname(ast.oracle.file ?? ast.file), s));
