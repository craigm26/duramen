// Evaluation of queries: nodelists (R3, R6), selectors (R8-R11, R14), comparisons (R18), the
// functions (R22-R26), and the normalized paths of results (R29).

import { JsonNumber } from './json.ts';
import type { Json } from './json.ts';
import type { CompareOp, Expr, Operand, Query, Selector } from './query.ts';
import { compileIRegexp } from './iregexp.ts';

// "Nothing" (R18): distinct from every JSON value, including null.
export const NOTHING = Symbol('nothing');
export type Value = Json | typeof NOTHING;

export interface Node {
  value: Json;
  path: string;
}

// root: the document, for $. current: the node @ refers to, for @.
export interface Context {
  root: Json;
  current: Json;
}

const ESCAPED_NAME_CHARS = new Map([
  [0x08, '\\b'],
  [0x0c, '\\f'],
  [0x0a, '\\n'],
  [0x0d, '\\r'],
  [0x09, '\\t'],
  [0x27, "\\'"],
  [0x5c, '\\\\'],
]);

export function runQuery(query: Query, document: Json): Node[] {
  return evalQuery(query, { root: document, current: document });
}

// R29.2: the escaped form of a member name inside single quotes.
function nameStep(name: string): string {
  let out = '';
  for (const ch of name) {
    const cp = ch.codePointAt(0) ?? 0;
    const escaped = ESCAPED_NAME_CHARS.get(cp);
    if (escaped !== undefined) out += escaped;
    else if (cp < 0x20) out += `\\u00${cp.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return `['${out}']`;
}

// The children of a node, in the order of R30 (array order; document order of members).
function children(node: Node): Node[] {
  const value = node.value;
  if (Array.isArray(value)) {
    return value.map((item, i) => ({ value: item, path: `${node.path}[${i}]` }));
  }
  if (value instanceof Map) {
    return [...value].map(([name, item]) => ({ value: item, path: node.path + nameStep(name) }));
  }
  return [];
}

// The node and all its descendants in pre-order (R6.2).
function descendantsOf(node: Node, out: Node[]): void {
  out.push(node);
  for (const child of children(node)) descendantsOf(child, out);
}

export function evalQuery(query: Query, ctx: Context): Node[] {
  let nodes: Node[] = [{ value: query.root === '$' ? ctx.root : ctx.current, path: '$' }];
  for (const segment of query.segments) {
    const next: Node[] = [];
    for (const node of nodes) {
      const inputs: Node[] = [];
      if (segment.descendant) descendantsOf(node, inputs);
      else inputs.push(node);
      for (const input of inputs) {
        for (const selector of segment.selectors) applySelector(input, selector, ctx, next);
      }
    }
    nodes = next;
  }
  return nodes;
}

function applySelector(node: Node, selector: Selector, ctx: Context, out: Node[]): void {
  const value = node.value;
  switch (selector.kind) {
    case 'name':
      if (value instanceof Map && value.has(selector.name)) {
        out.push({ value: value.get(selector.name) as Json, path: node.path + nameStep(selector.name) });
      }
      return;
    case 'wildcard':
      for (const child of children(node)) out.push(child);
      return;
    case 'index':
      if (Array.isArray(value)) {
        const i = selector.index < 0 ? value.length + selector.index : selector.index;
        if (i >= 0 && i < value.length) out.push({ value: value[i], path: `${node.path}[${i}]` });
      }
      return;
    case 'slice':
      if (Array.isArray(value)) {
        for (const i of sliceIndices(selector, value.length)) {
          out.push({ value: value[i], path: `${node.path}[${i}]` });
        }
      }
      return;
    case 'filter':
      for (const child of children(node)) {
        if (holds(selector.expr, { root: ctx.root, current: child.value })) out.push(child);
      }
      return;
  }
}

// R11.2: the indices a slice selects in an array of the given length, in selection order.
function sliceIndices(slice: { start: number | null; end: number | null; step: number | null }, len: number): number[] {
  const step = slice.step ?? 1;
  const out: number[] = [];
  if (step === 0) return out;
  const norm = (i: number): number => (i >= 0 ? i : len + i);
  if (step > 0) {
    const lower = Math.min(Math.max(norm(slice.start ?? 0), 0), len);
    const upper = Math.min(Math.max(norm(slice.end ?? len), 0), len);
    for (let i = lower; i < upper; i += step) out.push(i);
  } else {
    const upper = Math.min(Math.max(norm(slice.start ?? len - 1), -1), len - 1);
    const lower = Math.min(Math.max(norm(slice.end ?? -len - 1), -1), len - 1);
    for (let i = upper; i > lower; i += step) out.push(i);
  }
  return out;
}

// ---- Logical expressions (R13-R19) ----

function holds(expr: Expr, ctx: Context): boolean {
  switch (expr.kind) {
    case 'or':
      return holds(expr.left, ctx) || holds(expr.right, ctx);
    case 'and':
      return holds(expr.left, ctx) && holds(expr.right, ctx);
    case 'not':
      return !holds(expr.expr, ctx);
    case 'group':
      return holds(expr.expr, ctx);
    case 'compare':
      return compare(expr.op, operandValue(expr.left, ctx), operandValue(expr.right, ctx));
    case 'operand':
      // A test: a query is true when it selects a node (R15); a logical function gives its result.
      if (expr.operand.kind === 'query') return evalQuery(expr.operand.query, ctx).length > 0;
      if (expr.operand.kind === 'call') return callLogical(expr.operand.name, expr.operand.args, ctx);
      return false;
  }
}

function operandValue(operand: Operand, ctx: Context): Value {
  switch (operand.kind) {
    case 'literal':
      return operand.value;
    case 'query': {
      const nodes = evalQuery(operand.query, ctx);
      return nodes.length > 0 ? nodes[0].value : NOTHING;
    }
    case 'call':
      return callValue(operand.name, operand.args, ctx);
  }
}

function compare(op: CompareOp, a: Value, b: Value): boolean {
  switch (op) {
    case '==':
      return equal(a, b);
    case '!=':
      return !equal(a, b);
    case '<':
      return less(a, b);
    case '<=':
      return less(a, b) || equal(a, b);
    case '>':
      return less(b, a);
    case '>=':
      return less(b, a) || equal(a, b);
  }
}

// R18.1-2: Nothing equals only Nothing.
function equal(a: Value, b: Value): boolean {
  if (a === NOTHING || b === NOTHING) return a === b;
  return jsonEqual(a, b);
}

function jsonEqual(a: Json, b: Json): boolean {
  if (a instanceof JsonNumber) return b instanceof JsonNumber && a.value === b.value;
  if (a === null || typeof a === 'boolean' || typeof a === 'string') return a === b;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  }
  if (!(b instanceof Map) || a.size !== b.size) return false;
  for (const [name, item] of a) {
    const other = b.get(name);
    if (other === undefined || !jsonEqual(item, other)) return false;
  }
  return true;
}

// R18.1, R18.3: only numbers and strings are ordered; Nothing is never less than anything.
function less(a: Value, b: Value): boolean {
  if (a === NOTHING || b === NOTHING) return false;
  if (a instanceof JsonNumber) return b instanceof JsonNumber && a.value < b.value;
  if (typeof a === 'string') return typeof b === 'string' && compareStrings(a, b) < 0;
  return false;
}

// Compares by Unicode scalar values, not UTF-16 code units (R18.3, Appendix B).
function compareStrings(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const common = Math.min(x.length, y.length);
  for (let i = 0; i < common; i++) {
    const difference = (x[i].codePointAt(0) ?? 0) - (y[i].codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return x.length - y.length;
}

// ---- Functions (R20-R26) ----

function numberValue(n: number): JsonNumber {
  return new JsonNumber(String(n));
}

function valueArgument(expr: Expr, ctx: Context): Value {
  if (expr.kind !== 'operand') throw new Error('unchecked argument');
  return operandValue(expr.operand, ctx);
}

function nodesArgument(expr: Expr, ctx: Context): Node[] {
  if (expr.kind !== 'operand' || expr.operand.kind !== 'query') throw new Error('unchecked argument');
  return evalQuery(expr.operand.query, ctx);
}

// length, count and value: the functions with a ValueType result (R22, R23, R26).
function callValue(name: string, args: Expr[], ctx: Context): Value {
  switch (name) {
    case 'length': {
      const v = valueArgument(args[0], ctx);
      if (typeof v === 'string') return numberValue(Array.from(v).length);
      if (Array.isArray(v)) return numberValue(v.length);
      if (v instanceof Map) return numberValue(v.size);
      return NOTHING;
    }
    case 'count':
      return numberValue(nodesArgument(args[0], ctx).length);
    case 'value': {
      const nodes = nodesArgument(args[0], ctx);
      return nodes.length === 1 ? nodes[0].value : NOTHING;
    }
  }
  throw new Error(`not a value function: ${name}`);
}

// match and search: the functions with a LogicalType result (R24, R25).
function callLogical(name: string, args: Expr[], ctx: Context): boolean {
  const s = valueArgument(args[0], ctx);
  const r = valueArgument(args[1], ctx);
  if (typeof s !== 'string' || typeof r !== 'string') return false;
  const compiled = compileIRegexp(r);
  if (compiled === null) return false;
  return (name === 'match' ? compiled.full : compiled.search).test(s);
}
