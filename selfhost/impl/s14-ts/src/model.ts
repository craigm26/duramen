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
  dir: string[];
  line: number;
  raw: boolean;
  rawLine?: string;
  op?: string;
  jsonText?: string;
  jsonValue?: unknown;
  inputObj?: Record<string, unknown>;
  hasInputLines: boolean;
  request?: Record<string, unknown>;
  omit: string[];
  expects: Expect[];
  isRow: boolean;
  caseId: string;
}

export interface Req {
  file: string;
  line: number;
  id: string;
  platform: string;
  decisions: string[];
  text?: { line: number; text: string };
  examples: Example[];
}

export interface Op {
  file: string;
  line: number;
  name: string;
  fields: { name: string; optional: boolean }[];
  tolerances: Map<string, number>;
  audit: boolean;
  request?: Record<string, unknown>;
}

export interface Decision {
  file: string;
  line: number;
  id: string;
  source?: string;
  hasStatus: boolean;
  status: string;
}

export interface OpenItem {
  file: string;
  line: number;
  id: string;
  exTableLines: number[];
}

export interface Obligation {
  file: string;
  line: number;
  text: string;
  warn: boolean;
}

export interface Rec {
  spec?: { file: string; line: number; request?: Record<string, unknown> };
  oracle?: { file: string; line: number; command: string; dir: string[] };
  errorCodes: string[];
  ops: Op[];
  reqs: Req[];
  decisions: Decision[];
  opens: OpenItem[];
  obligations: Obligation[];
}
