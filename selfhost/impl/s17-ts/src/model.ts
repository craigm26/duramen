import type { Obj } from './util.ts';

export interface Diag {
  file: string;
  line: number;
  level: 'error' | 'warning' | 'info';
  code: string;
}

export interface Expect {
  line: number;
  path: string;
  kind: 'eq' | 'approx' | 'oracle';
  value?: unknown;
  tol?: number;
}

export interface Example {
  file: string;
  line: number;
  raw: boolean;
  rawLine: string | null;
  op: string | null;
  // The example's JSON input as written (for a table row, the text built from its cells).
  jsonText: string | null;
  // The example's input object when input lines add to it (REQ-SY-011).
  input: Obj | null;
  inputLines: boolean;
  inputKeys: string[];
  request: Obj | null;
  omit: string[];
  expects: Expect[];
}

export interface OpModel {
  file: string;
  line: number;
  name: string | null;
  fields: { name: string; optional: boolean }[];
  tolerances: Map<string, number>;
  audit: boolean;
  request: Obj | null;
  result: string | null;
}

export interface ReqModel {
  file: string;
  line: number;
  id: string;
  text: string | null;
  textLine: number;
  decisions: string[];
  platform: string;
  examples: Example[];
}

export interface OpenModel {
  file: string;
  line: number;
  id: string;
  text: string | null;
  tested: number[];
}

export interface DecisionModel {
  file: string;
  line: number;
  id: string;
  source: string | null;
  status: string | null;
  text: string | null;
  rejected: string[];
}

export interface TextHolder {
  file: string;
  line: number;
  text: string | null;
}

export interface ErrorsClause {
  line: number;
  code: string;
  lines: string[];
}

export interface FileModel {
  file: string;
  dirname: string;
  duramenCount: number;
  version: string | null;
}

export interface RecordModel {
  name: string;
  folder: string;
  files: Map<string, string>;
  fileModels: FileModel[];
  spec: { file: string; line: number; request: Obj | null; text: string | null } | null;
  specTexts: TextHolder[];
  oracle: { file: string; line: number; command: string } | null;
  errorsCodes: string[];
  errorsClauses: ErrorsClause[];
  errorsFile: string;
  ops: OpModel[];
  reqs: ReqModel[];
  opens: OpenModel[];
  decisions: DecisionModel[];
  sections: TextHolder[];
  notes: TextHolder[];
}
