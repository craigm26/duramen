// The checks of a record that was read without errors (REQ-CK-001 to REQ-CK-009) and the
// comparison of its examples with the oracle's answers (REQ-OR-001, REQ-OR-003 to REQ-OR-008).

import { report, type Diag } from "./diags.ts";
import { isRun, declaredOp, type Item } from "./requests.ts";
import { lookup, splitPath } from "./jsonpath.ts";
import { jsonEqual, parseJson } from "./text.ts";
import type { Example, RecordModel, Text } from "./model.ts";

// The words of a decision's status that state it (REQ-CK-009).
const STATUS_WORDS = ["observed", "inferred", "proposed", "accepted", "contested", "superseded", "rejected"];

// The phrases that state an order (REQ-CK-008), as whole words in any letter case.
const ORDER_PHRASES = [
  "in this order",
  "in the order",
  "first that applies",
  "first match",
  "precede",
  "precedes",
  "preceded",
  "before",
  "after",
  "take precedence",
  "takes precedence",
];
const ORDER_RES = ORDER_PHRASES.map(
  (p) => new RegExp(`(?<![A-Za-z0-9_])${p.split(" ").join("\\s+")}(?![A-Za-z0-9_])`, "i"),
);

// The words that state obligations (REQ-CK-006).
const OBLIGATION_RE = /(?<![A-Za-z0-9_])(MUST|SHALL|REQUIRED)(?![A-Za-z0-9_])/;

// A line with its quotations blanked out: a word inside one is not an obligation.
function unquoted(line: string): string {
  return line.replace(/"[^"]*"|“[^”]*”|`[^`]*`/g, (m) => " ".repeat(m.length));
}

export function hasObligation(lines: string[]): boolean {
  return lines.some((l) => OBLIGATION_RE.test(unquoted(l)));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The checks that need no oracle. Problems are added to `diags`.
export function checkRecord(model: RecordModel, diags: Diag[]): void {
  const declaredCodes = new Set(model.errorCodes.map((c) => c.code));

  // T019: examples but no oracle (REQ-OR-001).
  if (model.examples.length > 0 && model.oracles.length === 0) {
    const spec = model.specs[0];
    report(diags, spec.file, spec.line, "T019");
  }

  // T001: a requirement with no example (REQ-CK-001).
  for (const req of model.reqs) {
    if (req.examples.length === 0) report(diags, req.file, req.line, "T001");
  }

  // T007: IDs are unique (REQ-CK-002). A requirement and an open item may share an ID.
  uniqueIds(model.reqIds, diags);
  uniqueIds(model.openIds, diags);
  uniqueIds(model.decisions.map((d) => ({ id: d.id, file: d.file, line: d.line })), diags);
  uniqueIds(model.ops.map((o) => ({ id: o.name, file: o.file, line: o.line })), diags);

  // T008: cited decisions are declared (REQ-CK-003).
  const declaredDecisions = new Set(model.decisions.map((d) => d.id));
  for (const req of model.reqs) {
    const seen = new Set<string>();
    for (const d of req.decisions) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      if (!declaredDecisions.has(d.id)) report(diags, req.file, req.line, "T008");
    }
  }

  // Decisions: T012, T013, T027 (REQ-CK-009).
  const cited = new Set<string>();
  for (const req of model.reqs) for (const d of req.decisions) cited.add(d.id);
  for (const dec of model.decisions) {
    if (!cited.has(dec.id)) report(diags, dec.file, dec.line, "T012");
    if (!dec.source) report(diags, dec.file, dec.line, "T013");
    if (dec.status !== null) {
      const st = dec.status.text;
      const word = st.split(/\s/)[0];
      if (!STATUS_WORDS.includes(word)) {
        report(diags, dec.file, dec.line, "T027");
      } else if (word === "superseded") {
        const m = /^superseded by (\S+)$/.exec(st);
        if (!m || !declaredDecisions.has(m[1])) report(diags, dec.file, dec.line, "T027");
      }
    }
  }

  // T028: a requirement resting on a decision that is not accepted (REQ-CK-009).
  for (const req of model.reqs) {
    const seen = new Set<string>();
    for (const d of req.decisions) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const dec = model.decisions.find((x) => x.id === d.id);
      if (!dec || !dec.status) continue;
      const word = dec.status.text.split(/\s/)[0];
      if (["contested", "superseded", "rejected"].includes(word)) {
        report(diags, req.file, req.line, "T028", "error");
      } else if (["observed", "inferred", "proposed"].includes(word)) {
        report(diags, req.file, req.line, "T028", "warning");
      }
    }
  }

  // T004: obligations outside requirements (REQ-CK-006).
  const obligationIn = (file: string, text: Text | null, line: number) => {
    if (text && hasObligation(text.lines)) report(diags, file, line, "T004");
  };
  for (const spec of model.specs) obligationIn(spec.file, spec.text, spec.line);
  for (const sec of model.sections) obligationIn(sec.file, sec.text, sec.line);
  for (const note of model.notes) obligationIn(note.file, note.text, note.line);
  for (const dec of model.decisions) {
    obligationIn(dec.file, dec.text, dec.line);
    for (const r of dec.rejected) {
      if (hasObligation([r.text])) report(diags, dec.file, dec.line, "T004");
    }
  }
  for (const op of model.ops) {
    if (op.result && hasObligation(op.result.lines)) report(diags, op.file, op.line, "T004");
  }
  for (const code of model.errorCodes) {
    if (hasObligation(code.condition.lines)) report(diags, code.file, code.line, "T004");
  }
  for (const open of model.opens) {
    if (open.text && hasObligation(open.text.lines)) report(diags, open.file, open.line, "T014");
  }

  // T005: a requirement that orders two or more of the declared errors (REQ-CK-008).
  const codesInOrder = [...declaredCodes];
  for (const req of model.reqs) {
    if (!req.text) continue;
    const body = req.text.lines.join("\n");
    const named = codesInOrder.filter((c) =>
      new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(c)}(?![A-Za-z0-9_-])`).test(body),
    );
    if (named.length >= 2 && ORDER_RES.some((re) => re.test(body))) {
      report(diags, req.file, req.text.line, "T005");
    }
  }

  // T003: open items are not tested (REQ-CK-007).
  for (const open of model.opens) {
    for (const line of open.reportedClauses) report(diags, open.file, line, "T003");
  }

  // T023: expected error codes are declared (REQ-CK-005). Each example is checked against
  // its operation (REQ-CK-004) unless it expects an error or is raw.
  for (const ex of model.examples) {
    for (const e of ex.expects) {
      if (e.path === "error" && e.kind === "eq" && !(typeof e.value === "string" && declaredCodes.has(e.value))) {
        report(diags, ex.file, e.line, "T023");
      }
    }
    if (ex.raw !== null) continue;
    if (ex.expects.some((e) => e.path === "error")) continue;
    const op = declaredOp(model, ex.op);
    if (!op) {
      report(diags, ex.file, ex.line, "T009");
      continue;
    }
    for (const f of op.inputs) {
      if (!f.optional && !ex.inputKeys.includes(f.name)) report(diags, ex.file, ex.line, "T010");
    }
    for (const k of ex.inputKeys) {
      if (!op.inputs.some((f) => f.name === k)) report(diags, ex.file, ex.line, "T011");
    }
  }
}

function uniqueIds(items: { id: string; file: string; line: number }[], diags: Diag[]): void {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) report(diags, it.file, it.line, "T007");
    seen.add(it.id);
  }
}

// The value at a path of an oracle's response (REQ-OR-003). `audit.<path>` reads the path in
// the JSON value the audit text holds.
export function valueAt(response: Record<string, unknown>, path: string): { found: boolean; value?: unknown } {
  const names = splitPath(path);
  if (names[0] === "audit" && names.length > 1) {
    if (typeof response.audit !== "string") return { found: false };
    const p = parseJson(response.audit);
    if (!p.ok || p.bigNumber) return { found: false };
    return lookup(p.value, names.slice(1));
  }
  return lookup(response, names);
}

// Compares each example's expectations with the oracle's answer (REQ-OR-003 to REQ-OR-008).
// `answers` holds the response of each example that has one.
export function checkAnswers(
  model: RecordModel,
  items: Item[],
  answers: Map<Example, Record<string, unknown>>,
  diags: Diag[],
): void {
  // Without an oracle none of the examples runs, and T019 is the only report (REQ-OR-001).
  if (model.oracles.length === 0) return;
  for (const it of items) {
    const ex = it.ex;
    if (!isRun(model, ex)) continue;
    const r = answers.get(ex);
    if (!r) {
      report(diags, ex.file, ex.line, "T021");
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(r, "oracle_error")) {
      report(diags, ex.file, ex.line, "T022");
      continue;
    }
    if (ex.expects.length === 0 && Object.prototype.hasOwnProperty.call(r, "error")) {
      report(diags, ex.file, ex.line, "T024");
    }
    for (const e of ex.expects) {
      const v = valueAt(r, e.path);
      if (e.kind === "oracle") {
        if (!v.found) report(diags, ex.file, e.line, "T025");
      } else if (e.kind === "eq") {
        if (!v.found || !jsonEqual(v.value, e.value)) report(diags, ex.file, e.line, "T002");
      } else {
        const n = v.value;
        if (!v.found || typeof n !== "number" || Math.abs(n - e.value) > e.tol) {
          report(diags, ex.file, e.line, "T002");
        }
      }
    }
  }
}
