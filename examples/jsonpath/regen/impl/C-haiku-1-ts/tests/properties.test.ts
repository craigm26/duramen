// PROP-SE-P1, PROP-NP-P1 and PROP-FI-P1: properties checked on generated documents and queries
// (SPEC.md, Segments and selectors, Filters). The generator follows the spec's sampleDocument
// type; a fixed seed makes every run check the same cases.

import assert from "node:assert";
import { test } from "node:test";
import { ask } from "./support.ts";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(20260801);
const int = (n: number): number => Math.floor(rnd() * n);
const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)];

// sampleScalar, sampleLeaf, sampleInner and sampleDocument of SPEC.md, Types.
const SCALARS: unknown[] = [0, 1, 2, -1, 1.5, "a", "b", "ab", "", "é", "\u{1F600}", true, false, null];
const INNER_KEYS = ["a", "b", "'", "a b", "\n", "\u{1F600}", "10", "9"];
const DOC_KEYS = ["a", "b", "'", "\\", "\u000b", "é", "\u{1F600}", "￿", "10", "9", "x"];

function leaf(): unknown {
  const r = rnd();
  if (r < 0.6) return pick(SCALARS);
  if (r < 0.8) return Array.from({ length: int(3) }, () => pick(SCALARS));
  return {};
}

function members(keys: string[], value: () => unknown): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const key of keys) {
    if (rnd() < 0.5) obj[key] = value();
  }
  return obj;
}

function inner(): unknown {
  const r = rnd();
  if (r < 0.4) return leaf();
  if (r < 0.6) return Array.from({ length: int(3) }, () => leaf());
  return members(INNER_KEYS, leaf);
}

function document(): unknown {
  if (rnd() < 0.4) return Array.from({ length: int(4) }, () => inner());
  return members(DOC_KEYS, inner);
}

// The values a query selects in a document, failing the test on an error.
function valuesOf(query: string, doc: unknown): unknown[] {
  const r = ask(query, doc);
  assert.ok(r.result !== undefined, `${query} gave ${r.error}`);
  return r.result.values;
}

test("PROP-SE-P1: two selectors in one segment give both results", () => {
  for (let i = 0; i < 200; i++) {
    const d = document();
    const a = valuesOf("$..[*]", d);
    const b = valuesOf("$..[*, *]", d);
    assert.strictEqual(b.length, 2 * a.length, JSON.stringify(d));
  }
});

test("PROP-NP-P1: a Normalized Path selects exactly its node", () => {
  const queries = ["$..*", "$.*", "$..[*]", "$..[0]", "$..[-1]", "$..['a']"];
  for (let i = 0; i < 300; i++) {
    const d = document();
    const a = ask(queries[int(queries.length)], d).result!;
    if (a.paths.length === 0) continue;
    const first = a.paths[0];
    const last = a.paths[a.paths.length - 1];
    const b = ask(first, d).result!;
    const c = ask(last, d).result!;
    assert.deepStrictEqual(b.values, [a.values[0]], JSON.stringify({ d, first }));
    assert.deepStrictEqual(b.paths, [first], JSON.stringify({ d, first }));
    assert.deepStrictEqual(c.paths, [last], JSON.stringify({ d, last }));
  }
});

test("PROP-FI-P1: a filter and its negation divide the children between them", () => {
  const positive = ["$[?@.a]", "$[?@ > 1]", "$[?@ == 'a' || @.b]", "$[?length(@) == 1]", "$[?match(@, 'a.*')]", "$[?@[0]]"];
  const negative = ["$[?!@.a]", "$[?!(@ > 1)]", "$[?!(@ == 'a' || @.b)]", "$[?!(length(@) == 1)]", "$[?!match(@, 'a.*')]", "$[?!@[0]]"];
  for (let i = 0; i < 300; i++) {
    const d = document();
    const k = int(positive.length);
    const a = valuesOf(positive[k], d).length;
    const b = valuesOf(negative[k], d).length;
    const c = valuesOf("$[*]", d).length;
    assert.strictEqual(a + b, c, JSON.stringify({ d, query: positive[k] }));
  }
});
