// The record as the reader leaves it: its statements, examples and expectations, ready for
// the checks and the suite. Lines are the lines of the file each item is written in.

import type { Diag } from "./diags.ts";
import type { Files } from "./files.ts";

// An expectation of an example (REQ-OR-003, REQ-SU-004).
export type Expect =
  | { kind: "eq"; path: string; value: unknown; line: number }
  | { kind: "approx"; path: string; value: number; tol: number; line: number }
  | { kind: "oracle"; path: string; line: number };

// An example, or a row of a table (REQ-SY-010, REQ-SY-012). Its line is the example's or the
// row's line; its request line is made by requests.ts.
export type Example = {
  req: string;
  file: string;
  line: number;
  table: boolean;
  // The request line of a raw example, exactly as written (REQ-SU-003).
  raw: string | null;
  // The operation the example asks, or null for a raw example.
  op: string | null;
  // The input as the request sends it, already JSON text, or null when there is no input.
  inputText: string | null;
  // The top-level names of the input, for the checks of REQ-CK-004.
  inputKeys: string[];
  // The example's own request members (REQ-SU-003), or null when it has none.
  request: Record<string, unknown> | null;
  omit: string[];
  expects: Expect[];
};

export type Text = { line: number; lines: string[] };

export type Requirement = {
  id: string;
  file: string;
  line: number;
  platform: "any" | "posix" | "windows";
  text: Text | null;
  // Decisions the requirement rests on, with the line of the clause that names them.
  decisions: { id: string; line: number }[];
  examples: Example[];
  // The lines of its table clauses, for T001 (REQ-CK-001).
  tableLines: number[];
};

export type Open = {
  id: string;
  file: string;
  line: number;
  text: Text | null;
  // The lines of its example and table clauses (REQ-CK-007).
  reportedClauses: number[];
};

export type Decision = {
  id: string;
  file: string;
  line: number;
  // The status's text, or null when there is no status clause; "" for a status with no word.
  status: { text: string } | null;
  source: string | null;
  text: Text | null;
  rejected: { text: string; line: number }[];
};

export type Section = { id: string; file: string; line: number; text: Text | null };

export type Note = { file: string; line: number; text: Text | null };

export type ErrorCode = { code: string; file: string; line: number; condition: Text };

export type Operation = {
  name: string;
  file: string;
  line: number;
  inputs: { name: string; optional: boolean; line: number }[];
  result: Text | null;
  audit: boolean;
  request: Record<string, unknown> | null;
  // Tolerances by path (REQ-SY-007).
  tolerances: { path: string; value: number; line: number }[];
};

export type Spec = {
  file: string;
  line: number;
  name: string;
  title: string | null;
  text: Text | null;
  request: Record<string, unknown> | null;
};

export type OracleStatement = { file: string; line: number; command: string };

// What the reader gives the checks.
export type RecordModel = {
  name: string;
  folder: string;
  files: Files;
  memberFiles: string[];
  specs: Spec[];
  oracles: OracleStatement[];
  ops: Operation[];
  reqs: Requirement[];
  opens: Open[];
  decisions: Decision[];
  sections: Section[];
  notes: Note[];
  errorCodes: ErrorCode[];
  // Every example and table row of the requirements, in record order.
  examples: Example[];
  // The requirement and open-item IDs, and the decision IDs, in record order, for T007.
  reqIds: { id: string; file: string; line: number }[];
  openIds: { id: string; file: string; line: number }[];
};

// The context a reader needs for one record.
export type ReadCtx = {
  // The file being read, by its name in the request.
  file: string;
  recordFolder: string;
  files: Files;
  diags: Diag[];
};
