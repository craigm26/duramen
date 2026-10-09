// Evaluates a parsed query against a JSON document, with the semantics SPEC.md gives for
// segments, selectors, filters, comparisons, functions and Normalized Paths.

import type { CmpOp, Expr, Json, Query, Segment, Selector } from './parse.ts';
import { compileIRegexp } from './iregexp.ts';

type CallExpr = Extract<Expr, { kind: 'call' }>;

export type Key = string | number;

// A node: a value and its location in the document.
export interface Node {
  value: Json;
  path: Key[];
}

export function evaluateQuery(query: Query, document: Json): Node[] {
  const root: Node = { value: document, path: [] };
  return evalQuery(query, root, root);
}

// `$` starts at the document's root; `@` (inside a filter) starts at the current node.
function evalQuery(query: Query, current: Node, root: Node): Node[] {
  let nodes: Node[] = [query.absolute ? root : current];
  for (const segment of query.segments) {
    nodes = nodes.flatMap((node) => applySegment(segment, node, root));
  }
  return nodes;
}

// A descendant segment applies its selectors to each node of the subtree, the node first
// (REQ-SE-007); a child segment applies them to the node alone (REQ-SE-006).
function applySegment(segment: Segment, node: Node, root: Node): Node[] {
  const visited = segment.descendant ? descendantsOrSelf(node) : [node];
  return visited.flatMap((n) => segment.selectors.flatMap((selector) => selectFrom(selector, n, root)));
}

function descendantsOrSelf(node: Node): Node[] {
  const out = [node];
  for (const child of children(node)) {
    for (const descendant of descendantsOrSelf(child)) out.push(descendant);
  }
  return out;
}

// The children of a node: array elements in order, or member values in name order (REQ-SE-008).
export function children(node: Node): Node[] {
  const value = node.value;
  if (Array.isArray(value)) {
    return value.map((item, i) => ({ value: item, path: [...node.path, i] }));
  }
  if (isObject(value)) {
    return Object.keys(value)
      .sort(compareStrings)
      .map((name) => ({ value: value[name], path: [...node.path, name] }));
  }
  return [];
}

function selectFrom(selector: Selector, node: Node, root: Node): Node[] {
  const value = node.value;
  switch (selector.kind) {
    case 'name':
      return isObject(value) && Object.hasOwn(value, selector.name)
        ? [{ value: value[selector.name], path: [...node.path, selector.name] }]
        : [];
    case 'wild':
      return children(node);
    case 'index': {
      if (!Array.isArray(value)) return [];
      const i = selector.index < 0 ? value.length + selector.index : selector.index;
      return i >= 0 && i < value.length ? [{ value: value[i], path: [...node.path, i] }] : [];
    }
    case 'slice': {
      if (!Array.isArray(value)) return [];
      const indices = sliceIndices(value.length, selector.start, selector.end, selector.step);
      return indices.map((i) => ({ value: value[i], path: [...node.path, i] }));
    }
    case 'filter':
      return children(node).filter((child) => evalLogical(selector.expr, child, root));
  }
}

// The indices a slice selects, in the order it selects them (REQ-SE-005).
function sliceIndices(len: number, start?: number, end?: number, step?: number): number[] {
  const s = step ?? 1;
  if (s === 0) return [];
  const norm = (x: number): number => (x < 0 ? x + len : x);
  const out: number[] = [];
  if (s > 0) {
    const from = norm(start ?? 0);
    const to = norm(end ?? len);
    const lower = Math.min(Math.max(from, 0), len);
    const upper = Math.min(Math.max(to, 0), len);
    for (let i = lower; i < upper; i += s) out.push(i);
  } else {
    const from = norm(start ?? len - 1);
    const to = norm(end ?? -len - 1);
    const upper = Math.min(Math.max(from, -1), len - 1);
    const lower = Math.min(Math.max(to, -1), len - 1);
    for (let i = upper; i > lower; i += s) out.push(i);
  }
  return out;
}

// A logical expression for one current node (REQ-FI-001, REQ-FI-007).
function evalLogical(expr: Expr, current: Node, root: Node): boolean {
  switch (expr.kind) {
    case 'or':
      return expr.items.some((item) => evalLogical(item, current, root));
    case 'and':
      return expr.items.every((item) => evalLogical(item, current, root));
    case 'not':
      return !evalLogical(expr.expr, current, root);
    case 'paren':
      return evalLogical(expr.expr, current, root);
    case 'query':
      return evalQuery(expr.query, current, root).length > 0;
    case 'call':
      return callLogical(expr, current, root);
    case 'cmp':
      return compare(
        expr.op,
        operandValue(expr.left, current, root),
        operandValue(expr.right, current, root),
      );
    case 'lit':
      throw new Error('a literal is not a test');
  }
}

// The value of a comparable, or undefined for Nothing (REQ-FI-003).
function operandValue(expr: Expr, current: Node, root: Node): Json | undefined {
  switch (expr.kind) {
    case 'lit':
      return expr.value;
    case 'query': {
      const nodes = evalQuery(expr.query, current, root);
      return nodes.length > 0 ? nodes[0].value : undefined;
    }
    case 'call':
      return callValue(expr, current, root);
    default:
      throw new Error('not a value');
  }
}

function callValue(call: CallExpr, current: Node, root: Node): Json | undefined {
  switch (call.name) {
    case 'length':
      return lengthOf(operandValue(call.args[0], current, root));
    case 'count':
      return nodesOf(call.args[0], current, root).length;
    case 'value': {
      const nodes = nodesOf(call.args[0], current, root);
      return nodes.length === 1 ? nodes[0].value : undefined;
    }
    default:
      return undefined; // match and search give a logical result; typing keeps them out of here
  }
}

function nodesOf(expr: Expr, current: Node, root: Node): Node[] {
  if (expr.kind !== 'query') throw new Error('a nodelist is expected');
  return evalQuery(expr.query, current, root);
}

// match() and search() (REQ-FN-004, REQ-FN-005): false for anything that is not a string pair
// with an I-Regexp as its second value.
function callLogical(call: CallExpr, current: Node, root: Node): boolean {
  const subject = operandValue(call.args[0], current, root);
  const pattern = operandValue(call.args[1], current, root);
  if (typeof subject !== 'string' || typeof pattern !== 'string') return false;
  const regex = compileIRegexp(pattern);
  if (regex === undefined) return false;
  return call.name === 'match' ? regex.full.test(subject) : regex.partial.test(subject);
}

// length() (REQ-FN-001): code points of a string, elements of an array, members of an object.
function lengthOf(value: Json | undefined): number | undefined {
  if (typeof value === 'string') return Array.from(value).length;
  if (Array.isArray(value)) return value.length;
  if (isObject(value)) return Object.keys(value).length;
  return undefined;
}

// Comparison with Nothing and the orders of REQ-FI-004 to REQ-FI-006.
function compare(op: CmpOp, a: Json | undefined, b: Json | undefined): boolean {
  const equal = a === undefined || b === undefined ? a === b : deepEqual(a, b);
  switch (op) {
    case '==':
      return equal;
    case '!=':
      return !equal;
    case '<':
      return lessThan(a, b);
    case '<=':
      return lessThan(a, b) || equal;
    case '>':
      return lessThan(b, a);
    case '>=':
      return lessThan(b, a) || equal;
  }
}

function lessThan(a: Json | undefined, b: Json | undefined): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  if (typeof a === 'string' && typeof b === 'string') return compareStrings(a, b) < 0;
  return false;
}

// Equality of JSON values (REQ-FI-004): numbers as numbers, members by name in any order.
export function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const names = Object.keys(a);
    return (
      names.length === Object.keys(b).length &&
      names.every((name) => Object.hasOwn(b, name) && deepEqual(a[name], b[name]))
    );
  }
  return false;
}

// Compares strings code point by code point; a prefix comes first (REQ-FI-005).
export function compareStrings(a: string, b: string): number {
  const x = Array.from(a, (ch) => ch.codePointAt(0) as number);
  const y = Array.from(b, (ch) => ch.codePointAt(0) as number);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return x.length - y.length;
}

export function isObject(value: unknown): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The Normalized Path of a node (REQ-NP-001, REQ-NP-002).
export function normalizedPath(path: Key[]): string {
  const steps = path.map((key) => (typeof key === 'number' ? `[${key}]` : `['${escapeName(key)}']`));
  return `$${steps.join('')}`;
}

const NAME_ESCAPES: Record<number, string> = {
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
  0x27: "\\'",
  0x5c: '\\\\',
};

function escapeName(name: string): string {
  let out = '';
  for (const ch of name) {
    const code = ch.codePointAt(0) as number;
    if (NAME_ESCAPES[code] !== undefined) {
      out += NAME_ESCAPES[code];
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += ch;
    }
  }
  return out;
}
