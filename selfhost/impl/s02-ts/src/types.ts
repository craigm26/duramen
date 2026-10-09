export type Level = 'error' | 'warning' | 'info';

export interface Diag {
  file: string;
  line: number;
  level: Level;
  code: string;
}

export type Entries = [string, unknown][];

export interface Expect {
  line: number;
  path: string;
  kind: 'eq' | 'approx' | 'oracle';
  value?: unknown;
  tol?: number;
}

export interface Item {
  file: string;
  line: number;
  n: number;
  kind: 'example' | 'row';
  raw: boolean;
  rawLine: string;
  op: string;
  hasInput: boolean;
  inputText: string;
  inputObj: Record<string, unknown> | null;
  request: Entries;
  omit: string[];
  expects: Expect[];
  reqId: string;
  platform: string;
}

export interface TextBlock {
  line: number;
  lines: string[];
}

export interface SpecM {
  file: string;
  line: number;
  request: Entries | null;
  text: TextBlock | null;
}

export interface OracleM {
  file: string;
  line: number;
  command: string;
}

export interface OpM {
  file: string;
  line: number;
  name: string;
  fields: { name: string; optional: boolean }[];
  hasAudit: boolean;
  tolerances: [string, number][];
  request: Entries | null;
  result: string | null;
}

export interface ErrorsM {
  file: string;
  line: number;
  clauses: { code: string; line: number; condition: string[] }[];
}

export interface ReqM {
  file: string;
  line: number;
  id: string;
  text: TextBlock | null;
  decisions: string[];
  platform: string;
  items: Item[];
}

export interface OpenM {
  file: string;
  line: number;
  id: string;
  text: TextBlock | null;
  reported: number[];
}

export interface DecisionM {
  file: string;
  line: number;
  id: string;
  source: string | null;
  status: string | null;
  rejected: string[];
  text: TextBlock | null;
}

export interface TextStmtM {
  file: string;
  line: number;
  text: TextBlock | null;
}

export interface FileModel {
  name: string;
  diags: Diag[];
  version: string | null;
  hasDuramen: boolean;
  specs: SpecM[];
  oracles: OracleM[];
  sections: TextStmtM[];
  notes: TextStmtM[];
  ops: OpM[];
  errors: ErrorsM[];
  reqs: ReqM[];
  opens: OpenM[];
  decisions: DecisionM[];
}
