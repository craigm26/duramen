import {
  type Diag, type Level, type Obj, cmp, deepEqual, hasOwn, holdsObligation, isPlainObject, parseJson,
  setKey, splitFirst,
} from './util.ts';
import { type Item, type Stmt, readFile } from './read.ts';
import { Sandbox, parseResponse } from './oracle.ts';

export interface Case {
  id: string;
  kind: 'example';
  reqs: string[];
  platform: string;
  line: string;
  solo?: true;
  checks: Obj[];
  full: Obj;
}

export interface Analysis { diags: Diag[]; cases?: Case[] }

type Selection =
  | { kind: 'missing' }
  | { kind: 'file'; name: string; folder: string }
  | { kind: 'folder'; folder: string; names: string[] };

function dirOf(name: string): string {
  const i = name.lastIndexOf('/');
  return i < 0 ? '' : name.slice(0, i);
}

function select(files: Record<string, string>, entry: string | undefined): Selection {
  const all = Object.keys(files);
  let folder = '';
  if (entry !== undefined && entry !== '.') {
    if (hasOwn(files, entry)) return { kind: 'file', name: entry, folder: dirOf(entry) };
    if (!all.some((n) => n.startsWith(entry + '/'))) return { kind: 'missing' };
    folder = entry;
  }
  const prefix = folder === '' ? '' : folder + '/';
  const names = all.filter((n) => {
    if (!n.startsWith(prefix)) return false;
    const parts = n.slice(prefix.length).split('/');
    if (!parts[parts.length - 1].endsWith('.duramen')) return false;
    if (parts.some((p) => p.startsWith('.'))) return false;
    return !parts.slice(0, -1).some((p) => p === 'build' || p === 'node_modules');
  });
  if (names.length === 0) return { kind: 'missing' };
  names.sort(cmp);
  return { kind: 'folder', folder, names };
}

const SEVEN = ['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'];
const PHRASES = [
  'in this order', 'in the order', 'first that applies', 'first match', 'precede', 'precedes',
  'preceded', 'before', 'after', 'take precedence', 'takes precedence',
].map((p) => new RegExp(`(?<![A-Za-z0-9_])${p.split(' ').join('\\s+')}(?![A-Za-z0-9_])`, 'i'));

type Found = { found: true; value: unknown } | { found: false };

function valueAt(resp: Obj, path: string): Found {
  const segs = path.split('.');
  let cur: unknown = resp;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (i === 1 && segs[0] === 'audit') {
      if (typeof cur !== 'string') return { found: false };
      const p = parseJson(cur);
      if (!p.ok) return { found: false };
      cur = p.value;
    }
    if (Array.isArray(cur)) {
      if (!/^(?:0|[1-9]\d*)$/.test(seg) || Number(seg) >= cur.length) return { found: false };
      cur = cur[Number(seg)];
    } else if (isPlainObject(cur)) {
      if (!hasOwn(cur, seg)) return { found: false };
      cur = cur[seg];
    } else return { found: false };
  }
  return { found: true, value: cur };
}

interface Run {
  req: Extract<Stmt, { k: 'req' }>;
  item: Item;
  caseId: string;
  line: string;
  solo: boolean;
  runnable: boolean;
  resp?: Obj;
}

export function analyze(files: Record<string, string>, entry: string | undefined, wantCases: boolean): Analysis {
  const diags: Diag[] = [];
  const push = (file: string, line: number, code: string, level: Level = 'error'): void => {
    diags.push({ file, line, level, code });
  };
  const recordName = entry ?? '.';

  const sel = select(files, entry);
  if (sel.kind === 'missing') {
    push(recordName, 1, 'P046');
    return { diags };
  }
  const names = sel.kind === 'file' ? [sel.name] : sel.names;
  const env = { files, folder: sel.folder };

  const results = names.map((n) => ({ name: n, res: readFile(n, files[n], env, diags) }));
  const versions = new Set<string>();
  const counts = { spec: 0, oracle: 0, errors: 0 };
  for (const { name, res } of results) {
    if (!res.hasDuramen) push(name, 1, 'P020');
    if (res.version) versions.add(res.version);
    for (const s of res.stmts) {
      if (s.k === 'spec' || s.k === 'oracle' || s.k === 'errors') {
        counts[s.k]++;
        if (counts[s.k] > 1) push(name, s.line, s.k === 'errors' ? 'P032' : 'P044');
      }
    }
  }
  if (counts.spec === 0) push(recordName, 1, 'P021');
  if (versions.size > 1) push(recordName, 1, 'P047');
  if (diags.some((d) => d.level === 'error')) return { diags };

  const stmts = results.flatMap((r) => r.res.stmts);
  const spec = stmts.find((s) => s.k === 'spec') as Extract<Stmt, { k: 'spec' }>;
  const oracle = stmts.find((s) => s.k === 'oracle') as Extract<Stmt, { k: 'oracle' }> | undefined;
  const errorsStmt = stmts.find((s) => s.k === 'errors') as Extract<Stmt, { k: 'errors' }> | undefined;
  const codes = new Set((errorsStmt?.clauses ?? []).map((c) => c.code));

  // IDs are unique (REQ-CK-002)
  const ops = new Map<string, Extract<Stmt, { k: 'op' }>>();
  const reqIds = new Set<string>();
  const openIds = new Set<string>();
  const decisions = new Map<string, Extract<Stmt, { k: 'decision' }>>();
  for (const s of stmts) {
    if (s.k === 'op' && s.name !== undefined) {
      if (ops.has(s.name)) push(s.file, s.line, 'T007');
      else ops.set(s.name, s);
    } else if (s.k === 'req') {
      if (reqIds.has(s.id)) push(s.file, s.line, 'T007');
      reqIds.add(s.id);
    } else if (s.k === 'open') {
      if (openIds.has(s.id)) push(s.file, s.line, 'T007');
      openIds.add(s.id);
    } else if (s.k === 'decision') {
      if (decisions.has(s.id)) push(s.file, s.line, 'T007');
      else decisions.set(s.id, s);
    }
  }

  // obligations live in requirements (REQ-CK-006)
  for (const s of stmts) {
    if (s.k === 'spec' || s.k === 'section' || s.k === 'note') {
      if (s.text && holdsObligation(s.text.text)) push(s.file, s.line, 'T004');
    } else if (s.k === 'decision') {
      if (s.text && holdsObligation(s.text.text)) push(s.file, s.line, 'T004');
      for (const r of s.rejected) if (holdsObligation(r)) push(s.file, s.line, 'T004');
    } else if (s.k === 'op') {
      if (s.result !== undefined && holdsObligation(s.result)) push(s.file, s.line, 'T004');
    } else if (s.k === 'errors') {
      for (const c of s.clauses) if (holdsObligation(c.cond)) push(s.file, c.line, 'T004');
    } else if (s.k === 'open') {
      if (s.text && holdsObligation(s.text.text)) push(s.file, s.line, 'T014', 'warning');
      for (const l of s.tests) push(s.file, l, 'T003');
    }
  }

  // decisions (REQ-CK-009)
  const cited = new Set<string>();
  for (const s of stmts) if (s.k === 'req') for (const d of s.decisions) cited.add(d);
  const stateOf = new Map<string, string>();
  for (const d of decisions.values()) {
    if (!cited.has(d.id)) push(d.file, d.line, 'T012', 'warning');
    if (d.source === '') push(d.file, d.line, 'T013', 'warning');
    let state = 'accepted';
    if (d.status !== undefined) {
      const first = splitFirst(d.status)[0];
      if (!SEVEN.includes(first)) push(d.file, d.line, 'T027');
      else {
        state = first;
        if (first === 'superseded') {
          const m = /^superseded by (\S+)$/.exec(d.status);
          if (!m || !decisions.has(m[1])) push(d.file, d.line, 'T027');
        }
      }
    }
    stateOf.set(d.id, state);
  }

  // requirements
  const runs: Run[] = [];
  let anyExample = false;
  for (const r of stmts) {
    if (r.k !== 'req') continue;
    if (r.items.length === 0 && !r.hasStatic) push(r.file, r.line, 'T001');
    for (const id of new Set(r.decisions)) {
      const st = stateOf.get(id);
      if (st === undefined) push(r.file, r.line, 'T008');
      else if (st === 'contested' || st === 'superseded' || st === 'rejected') push(r.file, r.line, 'T028');
      else if (st !== 'accepted') push(r.file, r.line, 'T028', 'warning');
    }
    if (r.text && codes.size >= 2) {
      const named = [...codes].filter((c) =>
        new RegExp(`(?<![A-Za-z0-9_-])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`).test(r.text!.text));
      if (named.length >= 2 && PHRASES.some((p) => p.test(r.text!.text))) push(r.file, r.text.line, 'T005');
    }
    r.items.forEach((item, n) => {
      anyExample = true;
      const op = ops.get(item.op);
      const expectsError = item.expects.some((e) => e.path === 'error');
      let runnable = true;
      if (!item.raw && !expectsError) {
        if (!op) { push(item.file, item.line, 'T009'); runnable = false; }
        else {
          for (const f of op.fields) {
            if (!f.optional && !item.inputKeys.includes(f.name)) push(item.file, item.line, 'T010');
          }
          const declared = new Set(op.fields.map((f) => f.name));
          for (const k of item.inputKeys) if (!declared.has(k)) push(item.file, item.line, 'T011', 'warning');
        }
      }
      for (const e of item.expects) {
        if (e.path === 'error' && e.kind === 'eq' && !(typeof e.value === 'string' && codes.has(e.value))) {
          push(item.file, e.line, 'T023');
        }
      }
      const caseId = `${r.id}#${n + 1}`;
      runs.push({
        req: r, item, caseId, line: requestLine(item, caseId, op, spec.request),
        solo: item.raw || item.omit.has('id'), runnable,
      });
    });
  }

  // running the examples through the oracle (REQ-OR-001 to REQ-OR-008)
  let box: Sandbox | undefined;
  if (anyExample && !oracle) push(spec.file, spec.line, 'T019');
  if (anyExample && oracle) {
    box = new Sandbox(files);
    const cwd = oracle.file.includes('/') ? oracle.file.slice(0, oracle.file.lastIndexOf('/')) : '';
    const batch = runs.filter((x) => x.runnable && !x.solo);
    if (batch.length > 0) {
      const out = box.run(oracle.command, cwd, batch.map((x) => x.line));
      if (out.failed) push(oracle.file, oracle.line, 'T020');
      const byId = new Map<string, Obj>();
      for (const l of out.lines) {
        const o = parseResponse(l);
        if (o && typeof o.id === 'string' && !byId.has(o.id)) byId.set(o.id, o);
      }
      for (const x of batch) x.resp = byId.get(x.caseId);
    }
    for (const x of runs.filter((y) => y.runnable && y.solo)) {
      const out = box.run(oracle.command, cwd, [x.line]);
      if (out.failed) push(x.item.file, x.item.line, 'T020');
      if (out.lines.length === 1) x.resp = parseResponse(out.lines[0]);
    }
    for (const x of runs) {
      if (!x.runnable) continue;
      const { item } = x;
      if (!x.resp) { push(item.file, item.line, 'T021'); continue; }
      if (hasOwn(x.resp, 'oracle_error')) { push(item.file, item.line, 'T022'); continue; }
      for (const e of item.expects) {
        const got = valueAt(x.resp, e.path);
        if (e.kind === 'oracle') {
          if (!got.found) push(item.file, e.line, 'T025');
        } else if (e.kind === 'eq') {
          if (!got.found || !deepEqual(got.value, e.value)) push(item.file, e.line, 'T002');
        } else if (!got.found || typeof got.value !== 'number' || !(Math.abs(got.value - (e.value as number)) <= (e.tol as number))) {
          push(item.file, e.line, 'T002');
        }
      }
      if (item.expects.length === 0 && hasOwn(x.resp, 'error')) push(item.file, item.line, 'T024', 'warning');
    }
  }
  box?.dispose();

  const out: Analysis = { diags };
  if (wantCases && !diags.some((d) => d.level === 'error')) {
    out.cases = runs.map((x) => makeCase(x, ops));
  }
  return out;
}

function requestLine(item: Item, caseId: string, op: Extract<Stmt, { k: 'op' }> | undefined, specRequest: Obj | undefined): string {
  if (item.raw) return item.rawLine!;
  const members: Obj = {};
  for (const [k, v] of Object.entries(op?.request ?? specRequest ?? {})) setKey(members, k, v);
  for (const [k, v] of Object.entries(item.request ?? {})) setKey(members, k, v);
  const parts: string[] = [];
  if (!item.omit.has('id')) parts.push(`"id":${JSON.stringify(caseId)}`);
  if (!item.omit.has('op')) parts.push(`"op":${JSON.stringify(item.op)}`);
  for (const k of Object.keys(members)) {
    if (!item.omit.has(k)) parts.push(`${JSON.stringify(k)}:${JSON.stringify(members[k])}`);
  }
  if (item.inputText !== undefined && !item.omit.has('input')) parts.push(`"input":${item.inputText}`);
  return `{${parts.join(',')}}`;
}

function makeCase(x: Run, ops: Map<string, Extract<Stmt, { k: 'op' }>>): Case {
  const resp = x.resp as Obj;
  let opName = x.item.op;
  if (x.item.raw) {
    const p = parseJson(x.item.rawLine ?? '');
    opName = p.ok && isPlainObject(p.value) && typeof p.value.op === 'string' ? p.value.op : '';
  }
  const op = ops.get(opName);
  const checks: Obj[] = x.item.expects.map((e) => {
    if (e.kind === 'eq') return { path: e.path, kind: 'eq', value: e.value };
    if (e.kind === 'approx') return { path: e.path, kind: 'approx', value: e.value, tol: e.tol };
    const got = valueAt(resp, e.path);
    return { path: e.path, kind: 'eq', value: got.found ? got.value : null, from: 'oracle' };
  });
  const full: Obj = { members: Object.keys(resp).sort(cmp) };
  if (hasOwn(resp, 'error')) full.error = resp.error;
  if (hasOwn(resp, 'result')) full.result = resp.result;
  if (op?.audit && hasOwn(resp, 'audit')) full.audit = resp.audit;
  const tolerances: Obj = {};
  for (const [k, v] of op?.tolerances ?? []) setKey(tolerances, k, v);
  full.tolerances = tolerances;
  const c: Case = {
    id: x.caseId, kind: 'example', reqs: [`REQ-${x.req.id}`], platform: x.req.platform,
    line: x.line, checks, full,
  };
  if (x.solo) c.solo = true;
  return c;
}

export function formatDiag(d: Diag): string {
  return `${d.file}:${d.line}: ${d.level} ${d.code}`;
}

const RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };

export function sortDiags(diags: Diag[]): Diag[] {
  return diags
    .map((d, i) => ({ d, i }))
    .sort((a, b) =>
      cmp(a.d.file, b.d.file) || a.d.line - b.d.line || cmp(a.d.code, b.d.code) ||
      RANK[a.d.level] - RANK[b.d.level] || a.i - b.i)
    .map((x) => x.d);
}
