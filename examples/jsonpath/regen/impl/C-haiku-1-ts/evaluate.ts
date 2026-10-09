// Runs a parsed query over a document: segments and selectors (SPEC.md, Segments and
// selectors), filters (Filters) and functions (Functions).

import type { Call, Expr, Operand, Query, Selector } from "./parse.ts";
import { matchesPart, matchesWhole } from "./regex.ts";
import type { Json } from "./values.ts";
import { NOTHING, equal, hasMember, isObject, lessThan, normalizedPath, sortedNames } from "./values.ts";

// A node: a value with its location in the document.
export interface Node {
  value: Json;
  path: Array<string | number>;
}

export interface Result {
  values: Json[];
  paths: string[];
}

export function runQuery(query: Query, document: Json): Result {
  const root: Node = { value: document, path: [] };
  const nodes = select(query, root, root);
  return {
    values: nodes.map((node) => node.value),
    paths: nodes.map((node) => normalizedPath(node.path)),
  };
}

// The nodelist a query selects, from the current node `current` (for `@`) and the root (for `$`).
function select(query: Query, root: Node, current: Node): Node[] {
  let nodes: Node[] = [query.root === "$" ? root : current];
  for (const segment of query.segments) {
    const next: Node[] = [];
    for (const node of nodes) {
      const visited = segment.descendant ? subtree(node) : [node];
      for (const v of visited) {
        for (const selector of segment.selectors) pick(selector, v, root, next);
      }
    }
    nodes = next;
  }
  return nodes;
}

function member(node: Node, name: string): Node {
  const obj = node.value as { [name: string]: Json };
  return { value: obj[name], path: [...node.path, name] };
}

function element(node: Node, index: number): Node {
  const arr = node.value as Json[];
  return { value: arr[index], path: [...node.path, index] };
}

// The children of a node in their order (REQ-SE-003, REQ-SE-008): elements, or members by name.
function children(node: Node): Node[] {
  const v = node.value;
  if (Array.isArray(v)) return v.map((_, i) => element(node, i));
  if (isObject(v)) return sortedNames(v).map((name) => member(node, name));
  return [];
}

// The node and all its descendants, each before its own descendants (REQ-SE-007).
function subtree(node: Node): Node[] {
  const out: Node[] = [];
  const stack: Node[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    out.push(current);
    const kids = children(current);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}

// Applies one selector to one node, appending what it selects to `out`.
function pick(selector: Selector, node: Node, root: Node, out: Node[]): void {
  const v = node.value;
  switch (selector.kind) {
    case "name":
      if (isObject(v) && hasMember(v, selector.name)) out.push(member(node, selector.name));
      return;
    case "index":
      if (Array.isArray(v)) {
        const i = selector.index < 0 ? v.length + selector.index : selector.index;
        if (i >= 0 && i < v.length) out.push(element(node, i));
      }
      return;
    case "slice":
      if (Array.isArray(v)) {
        for (const i of sliceIndexes(selector.start, selector.end, selector.step, v.length)) {
          out.push(element(node, i));
        }
      }
      return;
    case "wild":
      for (const kid of children(node)) out.push(kid);
      return;
    case "filter":
      for (const kid of children(node)) {
        if (holds(selector.expr, kid, root)) out.push(kid);
      }
      return;
  }
}

// The indexes a slice selects (REQ-SE-005), in the order it selects them.
export function sliceIndexes(start: number | null, end: number | null, step: number | null, len: number): number[] {
  const s = step ?? 1;
  const out: number[] = [];
  if (s === 0) return out;
  if (s > 0) {
    let from = start ?? 0;
    let to = end ?? len;
    if (from < 0) from += len;
    if (to < 0) to += len;
    const lower = Math.min(Math.max(from, 0), len);
    const upper = Math.min(Math.max(to, 0), len);
    for (let i = lower; i < upper; i += s) out.push(i);
  } else {
    let from = start ?? len - 1;
    let to = end ?? -len - 1;
    if (from < 0) from += len;
    if (to < 0) to += len;
    const upper = Math.min(Math.max(from, -1), len - 1);
    const lower = Math.min(Math.max(to, -1), len - 1);
    for (let i = upper; i > lower; i += s) out.push(i);
  }
  return out;
}

// Whether a filter expression holds for the current node (REQ-FI-001, REQ-FI-007).
function holds(expr: Expr, cur: Node, root: Node): boolean {
  switch (expr.kind) {
    case "or":
      return expr.items.some((item) => holds(item, cur, root));
    case "and":
      return expr.items.every((item) => holds(item, cur, root));
    case "not":
      return !holds(expr.expr, cur, root);
    case "test":
      return select(expr.query, root, cur).length > 0;
    case "call":
      return logicalCall(expr.call, cur, root);
    case "compare":
      return compare(expr.op, operand(expr.left, cur, root), operand(expr.right, cur, root));
  }
}

// The value of an operand, or NOTHING (REQ-FI-003).
function operand(o: Operand, cur: Node, root: Node): unknown {
  switch (o.kind) {
    case "literal":
      return o.value;
    case "query": {
      const nodes = select(o.query, root, cur);
      return nodes.length > 0 ? nodes[0].value : NOTHING;
    }
    case "call":
      return valueCall(o.call, cur, root);
  }
}

// The nodelist of an argument that must be a query (REQ-SY-011, item 4).
function nodesOf(arg: Operand, cur: Node, root: Node): Node[] {
  if (arg.kind !== "query") throw new Error("a nodelist argument must be a query");
  return select(arg.query, root, cur);
}

// length(), count() and value() (REQ-FN-001 to REQ-FN-003).
function valueCall(call: Call, cur: Node, root: Node): unknown {
  switch (call.name) {
    case "length": {
      const v = operand(call.args[0], cur, root);
      if (typeof v === "string") return Array.from(v).length;
      if (Array.isArray(v)) return v.length;
      if (isObject(v)) return Object.keys(v).length;
      return NOTHING;
    }
    case "count":
      return nodesOf(call.args[0], cur, root).length;
    default: {
      const nodes = nodesOf(call.args[0], cur, root);
      return nodes.length === 1 ? nodes[0].value : NOTHING;
    }
  }
}

// match() and search() (REQ-FN-004, REQ-FN-005): false unless both are strings and the
// pattern is an I-Regexp.
function logicalCall(call: Call, cur: Node, root: Node): boolean {
  const subject = operand(call.args[0], cur, root);
  const pattern = operand(call.args[1], cur, root);
  if (typeof subject !== "string" || typeof pattern !== "string") return false;
  return call.name === "match" ? matchesWhole(subject, pattern) : matchesPart(subject, pattern);
}

// Equality of two operands, where NOTHING equals only NOTHING (REQ-FI-003, REQ-FI-004).
function same(a: unknown, b: unknown): boolean {
  if (a === NOTHING || b === NOTHING) return a === b;
  return equal(a as Json, b as Json);
}

// The six comparison operators, each in terms of == and < (REQ-FI-006).
function compare(op: string, a: unknown, b: unknown): boolean {
  switch (op) {
    case "==":
      return same(a, b);
    case "!=":
      return !same(a, b);
    case "<":
      return lessThan(a, b);
    case "<=":
      return lessThan(a, b) || same(a, b);
    case ">":
      return lessThan(b, a);
    default:
      return lessThan(b, a) || same(a, b);
  }
}
