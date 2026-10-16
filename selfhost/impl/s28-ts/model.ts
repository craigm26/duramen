export type Location = { file: string; line: number };
export type Diagnostic = Location & { code: string; level: 'error' | 'warning' | 'info' };
export type Line = Location & { text: string; indent: number; blank: boolean };
export type Clause = Line & { key: string; rest: string; body: Line[] };
export type Expectation = Location & { path: string; kind: 'eq' | 'approx' | 'oracle'; value?: any; tol?: number };
export type Example = Location & {
  op: string; raw?: string; input: any; inputText?: string; inputLines: boolean;
  expectations: Expectation[]; request?: any; omit: Set<string>;
  id?: string; requestLine?: string; solo?: boolean; response?: any;
};
export type Statement = Location & {
  key: string; rest: string; id: string; title?: string; clauses: Clause[]; text?: string; textLine?: number;
  request?: any; command?: string; fields: Map<string, boolean>; tolerances: Map<string, number>;
  audit?: boolean; result?: string; platform: string; examples: Example[]; citations: Set<string>;
  source?: string; status?: string; rejected: string[]; conditions: (Location & { code: string; text: string })[];
};
export type RecordModel = {
  name: string; folder: string; files: Record<string, string>; statements: Statement[]; diagnostics: Diagnostic[];
  spec?: Statement; oracle?: Statement; errors?: Statement;
};
export function diagnostic(record: RecordModel, loc: Location, code: string, level: Diagnostic['level'] = 'error'): void {
  record.diagnostics.push({ file: loc.file, line: loc.line, code, level });
}
