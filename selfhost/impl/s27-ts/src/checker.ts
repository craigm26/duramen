// Checking a record that was read without errors (REQ-CK-*, REQ-OR-*), and the whole of `check`.

import { Oracle, responsesById, soloResponse } from './oracle.ts';
import { readRecord } from './reader.ts';
import type { Diag, Item, Model, Req } from './reader.ts';
import { compareUtf16, deepEqual, hasOwn, resolvePath } from './util.ts';

export type Analysis = {
  diags: Diag[];
  errors: number;
  warnings: number;
  model?: Model;
  runs?: Map<Item, { req: Req; id: string; response?: any }>;
};

const LEVEL_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

export function formatDiag(d: Diag): string {
  return `${d.file}:${d.line}: ${d.level} ${d.code}`;
}

export function sortDiags(diags: Diag[]): Diag[] {
  return diags
    .map((d, i) => ({ d, i }))
    .sort(
      (a, b) =>
        compareUtf16(a.d.file, b.d.file) ||
        a.d.line - b.d.line ||
        compareUtf16(a.d.code, b.d.code) ||
        LEVEL_ORDER[a.d.level] - LEVEL_ORDER[b.d.level] ||
        a.i - b.i,
    )
    .map((x) => x.d);
}

const OBLIGATION = /(?<![A-Za-z0-9_])(?:MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])/;

// REQ-CK-006: quotations are replaced by a separator; a quotation never spans lines.
export function holdsObligation(lines: string[]): boolean {
  for (const raw of lines) {
    for (const line of raw.split(/\r\n|\n|\r/)) {
      let out = '';
      let i = 0;
      while (i < line.length) {
        const ch = line[i];
        const close = ch === '"' ? '"' : ch === '“' ? '”' : ch === '`' ? '`' : '';
        const j = close ? line.indexOf(close, i + 1) : -1;
        if (j >= 0) {
          out += ' ';
          i = j + 1;
        } else {
          out += ch;
          i++;
        }
      }
      if (OBLIGATION.test(out)) return true;
    }
  }
  return false;
}

const PHRASES =
  /(?<![A-Za-z0-9_])(?:in\s+this\s+order|in\s+the\s+order|first\s+that\s+applies|first\s+match|precedes?|preceded|before|after|take\s+precedence|takes\s+precedence)(?![A-Za-z0-9_])/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
}

function firstWord(s: string): string {
  return s.split(/\s+/)[0] ?? '';
}

export function requestLine(model: Model, id: string, item: Item): string {
  if (item.raw) return item.rawLine as string;
  const op = model.ops.find((o) => o.name === item.op);
  const base = op && op.request !== undefined ? op.request : (model.spec?.request ?? {});
  const members: any = {};
  for (const k of Object.keys(base)) Object.defineProperty(members, k, { value: base[k], enumerable: true, writable: true, configurable: true });
  if (item.request) {
    for (const k of Object.keys(item.request)) {
      Object.defineProperty(members, k, { value: item.request[k], enumerable: true, writable: true, configurable: true });
    }
  }
  const parts: string[] = [];
  if (!item.omit.has('id')) parts.push('"id":' + JSON.stringify(id));
  if (!item.omit.has('op')) parts.push('"op":' + JSON.stringify(item.op));
  for (const k of Object.keys(members)) {
    if (item.omit.has(k) || k === 'id' || k === 'op' || k === 'input') continue;
    parts.push(JSON.stringify(k) + ':' + JSON.stringify(members[k]));
  }
  if (!item.omit.has('input')) {
    if (item.hasInputLines) parts.push('"input":' + JSON.stringify(item.inputObj));
    else if (item.inputText !== undefined) parts.push('"input":' + item.inputText);
  }
  return '{' + parts.join(',') + '}';
}

export function isSolo(item: Item): boolean {
  return item.raw || item.omit.has('id');
}

export function analyze(files: Record<string, string>, entry: string | undefined): Analysis {
  const read = readRecord(files, entry);
  let diags: Diag[] = read.diags;
  const model = read.model;
  const finish = (a?: Partial<Analysis>): Analysis => {
    const sorted = sortDiags(diags);
    return {
      diags: sorted,
      errors: sorted.filter((d) => d.level === 'error').length,
      warnings: sorted.filter((d) => d.level === 'warning').length,
      model,
      ...a,
    };
  };
  if (!model || diags.some((d) => d.level === 'error')) return finish({ model: undefined });

  const add = (file: string, line: number, level: Diag['level'], code: string) => diags.push({ file, line, level, code });
  const err = (file: string, line: number, code: string) => add(file, line, 'error', code);
  const warn = (file: string, line: number, code: string) => add(file, line, 'warning', code);

  // ---- REQ-CK-001
  for (const r of model.reqs) if (r.items.length === 0 && !r.hasStatic) err(r.file, r.line, 'T001');

  // ---- REQ-CK-002
  const dup = <T extends { id?: string; name?: string; file: string; line: number }>(list: T[], key: (t: T) => string) => {
    const seen = new Set<string>();
    for (const t of list) {
      const k = key(t);
      if (seen.has(k)) err(t.file, t.line, 'T007');
      seen.add(k);
    }
  };
  dup(model.reqs, (r) => r.id);
  dup(model.opens, (o) => o.id);
  dup(model.decisions, (d) => d.id);
  dup(model.ops, (o) => o.name);

  // ---- REQ-CK-003, REQ-CK-009
  const firstDecision = new Map<string, (typeof model.decisions)[number]>();
  for (const d of model.decisions) if (!firstDecision.has(d.id)) firstDecision.set(d.id, d);
  const cited = new Set<string>();
  for (const r of model.reqs) for (const id of r.decisions) cited.add(id);
  for (const d of model.decisions) {
    if (!cited.has(d.id)) warn(d.file, d.line, 'T012');
    if (d.source === undefined || d.source === '') warn(d.file, d.line, 'T013');
    if (d.status !== undefined) {
      const w = firstWord(d.status);
      const words = ['observed', 'inferred', 'proposed', 'accepted', 'contested', 'superseded', 'rejected'];
      let ok = words.includes(w);
      if (ok && w === 'superseded') {
        const m = /^superseded by (\S+)$/.exec(d.status);
        ok = !!m && firstDecision.has(m[1]);
      }
      if (!ok) err(d.file, d.line, 'T027');
    }
  }
  for (const r of model.reqs) {
    const seen = new Set<string>();
    for (const id of r.decisions) {
      if (seen.has(id)) continue;
      seen.add(id);
      const d = firstDecision.get(id);
      if (!d) {
        err(r.file, r.line, 'T008');
        continue;
      }
      const w = firstWord(d.status ?? '');
      if (w === 'contested' || w === 'superseded' || w === 'rejected') err(r.file, r.line, 'T028');
      else if (w === 'observed' || w === 'inferred' || w === 'proposed') warn(r.file, r.line, 'T028');
    }
  }

  // ---- REQ-CK-007
  for (const o of model.opens) for (const l of o.exampleLines) err(o.file, l, 'T003');

  // ---- REQ-CK-006
  if (model.spec?.textLines && holdsObligation(model.spec.textLines)) err(model.spec.file, model.spec.line, 'T004');
  for (const s of model.sections) if (s.textLines && holdsObligation(s.textLines)) err(s.file, s.line, 'T004');
  for (const s of model.notes) if (s.textLines && holdsObligation(s.textLines)) err(s.file, s.line, 'T004');
  for (const d of model.decisions) {
    if (d.textLines && holdsObligation(d.textLines)) err(d.file, d.line, 'T004');
    for (const alt of d.rejected) if (holdsObligation([alt])) err(d.file, d.line, 'T004');
  }
  for (const o of model.ops) if (o.resultText !== undefined && holdsObligation([o.resultText])) err(o.file, o.line, 'T004');
  for (const e of model.errorCodes) if (holdsObligation(e.cond)) err(e.file, e.line, 'T004');
  for (const o of model.opens) if (o.textLines && holdsObligation(o.textLines)) warn(o.file, o.line, 'T014');

  // ---- REQ-CK-008
  const codes = [...new Set(model.errorCodes.map((e) => e.code))];
  const codeRes = codes.map((c) => new RegExp('(?<![A-Za-z0-9_-])' + escapeRe(c) + '(?![A-Za-z0-9_-])'));
  for (const r of model.reqs) {
    if (!r.textLines || r.textLine === undefined) continue;
    const text = r.textLines.join('\n');
    const named = codeRes.filter((re) => re.test(text)).length;
    if (named >= 2 && PHRASES.test(text)) err(r.file, r.textLine, 'T005');
  }

  // ---- REQ-CK-004, REQ-CK-005
  const declared = new Set(codes);
  const firstOp = (name?: string) => model.ops.find((o) => o.name === name);
  for (const r of model.reqs) {
    for (const it of r.items) {
      for (const ex of it.expects) {
        if (ex.path !== 'error' || ex.kind === 'oracle') continue;
        if (ex.kind === 'approx' || typeof ex.value !== 'string' || !declared.has(ex.value)) err(it.file, ex.line, 'T023');
      }
      if (it.raw || it.expectsError) continue;
      const op = firstOp(it.op);
      if (!op) {
        err(it.file, it.line, 'T009');
        continue;
      }
      let keys: string[] = [];
      if (it.hasInputLines) keys = Object.keys(it.inputObj);
      else if (it.kind === 'row') keys = it.inputKeys ?? [];
      else if (it.inputText !== undefined) keys = Object.keys(JSON.parse(it.inputText));
      for (const [name, optional] of op.fields) if (!optional && !keys.includes(name)) err(it.file, it.line, 'T010');
      for (const k of keys) if (!op.fields.has(k)) warn(it.file, it.line, 'T011');
    }
  }

  // ---- REQ-OR-*: running the examples
  const runs = new Map<Item, { req: Req; id: string; response?: any }>();
  const all: { req: Req; item: Item; id: string }[] = [];
  for (const r of model.reqs) {
    r.items.forEach((item, i) => {
      if (item.raw || item.expectsError || firstOp(item.op)) all.push({ req: r, item, id: `${r.id}#${i + 1}` });
    });
  }
  const anyExample = model.reqs.some((r) => r.items.length > 0);
  if (!model.oracle) {
    if (anyExample && model.spec) err(model.spec.file, model.spec.line, 'T019');
  } else if (all.length > 0) {
    const oracle = new Oracle(files, model.oracle.command, model.oracle.file);
    try {
      const shared = all.filter((x) => !isSolo(x.item));
      let byId = new Map<string, any>();
      if (shared.length > 0) {
        const run = oracle.run(shared.map((x) => requestLine(model, x.id, x.item)));
        if (run.failed) err(model.oracle.file, model.oracle.line, 'T020');
        byId = responsesById(run.lines);
      }
      for (const x of all) {
        let response: any;
        if (isSolo(x.item)) {
          const run = oracle.run([requestLine(model, x.id, x.item)]);
          if (run.failed) err(x.item.file, x.item.line, 'T020');
          response = soloResponse(run.lines);
        } else response = byId.get(x.id);
        runs.set(x.item, { req: x.req, id: x.id, response });
      }
    } finally {
      oracle.close();
    }
    for (const [item, run] of runs) judgeItem(item, run.response);
  }

  function judgeItem(item: Item, response: any) {
    if (response === undefined) {
      err(item.file, item.line, 'T021');
      return;
    }
    if (hasOwn(response, 'oracle_error')) {
      err(item.file, item.line, 'T022');
      return;
    }
    if (hasOwn(response, 'error') && item.expects.length === 0) warn(item.file, item.line, 'T024');
    for (const ex of item.expects) {
      const got = resolvePath(response, ex.path);
      if (ex.kind === 'oracle') {
        if (!got.found) err(item.file, ex.line, 'T025');
      } else if (ex.kind === 'eq') {
        if (!got.found || !deepEqual(got.value, ex.value)) err(item.file, ex.line, 'T002');
      } else if (!got.found || typeof got.value !== 'number' || !(Math.abs(got.value - (ex.value as number)) <= (ex.tol as number))) {
        err(item.file, ex.line, 'T002');
      }
    }
  }

  return finish({ runs });
}

export function check(files: Record<string, string>, entry: string | undefined) {
  const a = analyze(files, entry);
  return { diagnostics: a.diags.map(formatDiag), errors: a.errors, warnings: a.warnings };
}
