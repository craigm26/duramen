// What reading a record produces: its statements, as the checker and the suite need them.

import type { Json } from './json.ts';

export type Level = 'error' | 'warning' | 'info';

export interface Diagnostic {
  file: string;
  line: number;
  level: Level;
  code: string;
}

export interface Expectation {
  line: number;
  path: string;
  kind: 'eq' | 'approx' | 'oracle';
  value?: Json;
  tol?: number;
}

export interface Example {
  file: string;
  line: number;
  /** The requirement it belongs to. */
  req: Req;
  raw: boolean;
  rawLine?: string;
  op?: string;
  /** The input as written; undefined when the example has no input member. */
  inputText?: string;
  /** The input with its input lines applied, when it has input lines. */
  inputValue?: { [k: string]: Json };
  hasInputLines: boolean;
  request?: { [k: string]: Json };
  omit: string[];
  expects: Expectation[];
  /** For a table row, the names of its input cells. */
  rowFields?: string[];
  /** Set while checking: the case's ID. */
  id?: string;
}

export interface TextBlock {
  line: number;
  lines: string[];
}

export interface Spec {
  file: string;
  line: number;
  text?: TextBlock;
  request?: { [k: string]: Json };
}

export interface Oracle {
  file: string;
  line: number;
  command: string;
}

export interface Op {
  name: string;
  file: string;
  line: number;
  fields: Map<string, boolean>;
  hasRequest: boolean;
  request?: { [k: string]: Json };
  tolerances: [string, number][];
  audit: boolean;
  result?: string;
}

export interface ErrorCode {
  code: string;
  line: number;
  condition: string[];
}

export interface ErrorsList {
  file: string;
  line: number;
  codes: ErrorCode[];
}

export interface Req {
  id: string;
  file: string;
  line: number;
  text?: TextBlock;
  decisions: string[];
  platform: string;
  examples: Example[];
}

export interface Open {
  id: string;
  file: string;
  line: number;
  text?: TextBlock;
  exampleLines: number[];
}

export interface Decision {
  id: string;
  file: string;
  line: number;
  source?: string;
  status?: string;
  text?: TextBlock;
  rejected: string[];
}

export interface Prose {
  file: string;
  line: number;
  text?: TextBlock;
}

export interface Record {
  /** The name diagnostics about the whole record are written at. */
  name: string;
  /** The folder of the record, '' for the folder that holds all the files. */
  folder: string;
  files: string[];
  specs: Spec[];
  oracles: Oracle[];
  ops: Op[];
  errors: ErrorsList[];
  reqs: Req[];
  opens: Open[];
  decisions: Decision[];
  sections: Prose[];
  notes: Prose[];
}

export function emptyRecord(name: string, folder: string, files: string[]): Record {
  return {
    name, folder, files,
    specs: [], oracles: [], ops: [], errors: [], reqs: [], opens: [], decisions: [], sections: [], notes: [],
  };
}
