// What reading a record produces, and the diagnostics the checker reports.

import type { Json, JsonObject } from './util.ts';

export type Level = 'error' | 'warning' | 'info';

export interface Diag {
  file: string;
  line: number;
  level: Level;
  code: string;
}

export interface Expectation {
  line: number;
  path: string;
  /** `eq` for `= <value>`, `approx` for `≈ <n> ± <tol>`, `oracle` for `= ?`. */
  kind: 'eq' | 'approx' | 'oracle';
  value?: Json;
  tol?: number;
}

export interface Example {
  file: string;
  line: number;
  req: Req;
  /** Counted from 1 within its requirement statement. */
  n: number;
  raw: boolean;
  /** The request line of a raw example, exactly as written. */
  rawLine?: string;
  op?: string;
  /** False for `example <op>` with no JSON and no input lines: no `input` member. */
  hasInput: boolean;
  /** The JSON text of the input as written (an example's JSON, or a table row's). */
  inputText?: string;
  /** True when input lines changed the input: it is then sent as compact JSON. */
  inputLines: boolean;
  input: JsonObject;
  request?: JsonObject;
  omit: string[];
  expects: Expectation[];
  row: boolean;
}

export interface Req {
  file: string;
  line: number;
  id: string;
  platform: string;
  cited: string[];
  text?: { line: number; lines: string[] };
  examples: Example[];
}

export interface Op {
  file: string;
  line: number;
  name?: string;
  fields: Map<string, boolean>; // name -> optional
  tolerances: Map<string, number>;
  audit: boolean;
  request?: JsonObject;
}

export interface Decision {
  file: string;
  line: number;
  id: string;
  hasSource: boolean;
  status?: string;
}

export interface Named {
  file: string;
  line: number;
  id: string;
}

/** A text that may not state obligations (REQ-CK-006). */
export interface ProseText {
  file: string;
  line: number;
  lines: string[];
  code: 'T004' | 'T014';
}

export interface RecordModel {
  /** The name a record-level diagnostic is reported at. */
  name: string;
  /** The folder of the record, '' for the folder that holds all the files. */
  folder: string;
  files: string[];
  spec?: { file: string; line: number };
  specRequest?: JsonObject;
  oracle?: { file: string; line: number; command: string };
  ops: Op[];
  codes: string[];
  reqs: Req[];
  opens: Named[];
  decisions: Decision[];
  prose: ProseText[];
  /** Lines of `example` and `table` clauses of open items (T003). */
  openExamples: { file: string; line: number }[];
}
