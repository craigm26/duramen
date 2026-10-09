// What reading a record produces: its diagnostics and the statements the checks need.

import type { Obj } from './json.ts';

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
  kind: 'eq' | 'approx' | 'oracle';
  value?: unknown;
  tol?: number;
}

export interface Example {
  file: string;
  /** The example's line, or the table row's. */
  line: number;
  /** The operation named, or null for a raw example. */
  op: string | null;
  rawLine: string | null;
  /** The input as written (or built from a table row), or null for none. */
  inputText: string | null;
  /** The input as a value, after its input lines; undefined when there is none. */
  input: Obj | undefined;
  hasInputLines: boolean;
  request: Obj | null;
  omit: Set<string>;
  expects: Expectation[];
}

export interface Req {
  id: string;
  file: string;
  line: number;
  platform: string;
  decisions: string[];
  text: { line: number; lines: string[] } | null;
  examples: Example[];
}

export interface Field {
  name: string;
  optional: boolean;
}

export interface Op {
  name: string;
  file: string;
  line: number;
  fields: Field[];
  tolerances: Obj;
  audit: boolean;
  request: Obj | null;
}

export interface Decision {
  id: string;
  file: string;
  line: number;
  source: string | null;
  status: string | null;
}

export interface Labelled {
  id: string;
  file: string;
  line: number;
}

/** A text that may hold no obligation (REQ-CK-006). */
export interface ProseText {
  file: string;
  line: number;
  lines: string[];
  warning: boolean;
}

export interface Model {
  spec: { file: string; line: number; request: Obj | null } | null;
  oracle: { file: string; line: number; command: string } | null;
  ops: Op[];
  reqs: Req[];
  opens: Labelled[];
  /** Lines of `example` and `table` clauses of open items (REQ-CK-007). */
  openExamples: { file: string; line: number }[];
  decisions: Decision[];
  codes: string[];
  prose: ProseText[];
}
