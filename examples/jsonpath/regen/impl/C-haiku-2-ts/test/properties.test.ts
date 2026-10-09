// The properties of SPEC.md (PROP-SE-P1, PROP-NP-P1, PROP-FI-P1), checked on documents drawn
// from the sample types of its Types section. The generator is seeded, so a failure replays.

import { test } from 'node:test';
import assert from 'node:assert';
import { respondLine } from '../protocol.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// A small seeded generator (mulberry32).
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = seeded(20260910);
const int = (below: number): number => Math.floor(random() * below);
const pick = <T>(items: T[]): T => items[int(items.length)];

// sampleScalar, sampleLeaf, sampleInner and sampleDocument of SPEC.md's Types section.
const SCALARS: Json[] = [0, 1, 2, -1, 1.5, 'a', 'b', 'ab', '', 'é', '😀', true, false, null];
const INNER_KEYS = ['a', 'b', "'", 'a b', '\n', '😀', '10', '9'];
const DOCUMENT_KEYS = ['a', 'b', "'", '\\', '\u000b', 'é', '😀', '￿', '10', '9', 'x'];

function leaf(): Json {
  const r = random();
  if (r < 0.6) return pick(SCALARS);
  if (r < 0.8) return Array.from({ length: int(4) }, () => pick(SCALARS));
  return {};
}

function subsetObject(keys: string[], make: () => Json): { [key: string]: Json } {
  const out: { [key: string]: Json } = {};
  for (const key of keys) if (random() < 0.5) out[key] = make();
  return out;
}

function inner(): Json {
  const r = random();
  if (r < 0.5) return leaf();
  if (r < 0.7) return Array.from({ length: int(4) }, () => leaf());
  return subsetObject(INNER_KEYS, leaf);
}

function document(): Json {
  if (random() < 0.5) return Array.from({ length: int(4) }, () => inner());
  return subsetObject(DOCUMENT_KEYS, inner);
}

interface Result {
  values: Json[];
  paths: string[];
}

// One query through the driver's request path.
function run(query: string, doc: Json): Result {
  const line = respondLine(JSON.stringify({ id: 'p', op: 'query', input: { query, document: doc } }));
  const response = JSON.parse(line as string) as { result?: Result; error?: string };
  assert.strictEqual(response.error, undefined, `${query} gave ${response.error}`);
  return response.result as Result;
}

test('PROP-SE-P1: two selectors in one segment give both results (200 cases)', () => {
  for (let n = 0; n < 200; n++) {
    const doc = document();
    const a = run('$..[*]', doc);
    const b = run('$..[*, *]', doc);
    assert.strictEqual(b.values.length, 2 * a.values.length, JSON.stringify(doc));
  }
});

test('PROP-NP-P1: a Normalized Path selects exactly its node (300 cases)', () => {
  const queries = ['$..*', '$.*', '$..[*]', '$..[0]', '$..[-1]', "$..['a']"];
  for (let n = 0; n < 300; n++) {
    const doc = document();
    const a = run(queries[int(queries.length)], doc);
    if (a.paths.length === 0) continue;
    const last = a.paths.length - 1;
    const b = run(a.paths[0], doc);
    const c = run(a.paths[last], doc);
    assert.deepStrictEqual(b.values, [a.values[0]], `${a.paths[0]} in ${JSON.stringify(doc)}`);
    assert.deepStrictEqual(b.paths, [a.paths[0]]);
    assert.deepStrictEqual(c.paths, [a.paths[last]]);
  }
});

test('PROP-FI-P1: a filter and its negation divide the children between them (300 cases)', () => {
  const positive = [
    '$[?@.a]',
    '$[?@ > 1]',
    "$[?@ == 'a' || @.b]",
    '$[?length(@) == 1]',
    "$[?match(@, 'a.*')]",
    '$[?@[0]]',
  ];
  const negative = [
    '$[?!@.a]',
    '$[?!(@ > 1)]',
    "$[?!(@ == 'a' || @.b)]",
    '$[?!(length(@) == 1)]',
    "$[?!match(@, 'a.*')]",
    '$[?!@[0]]',
  ];
  for (let n = 0; n < 300; n++) {
    const doc = document();
    const k = int(positive.length);
    const a = run(positive[k], doc);
    const b = run(negative[k], doc);
    const c = run('$[*]', doc);
    assert.strictEqual(a.values.length + b.values.length, c.values.length, `${positive[k]} on ${JSON.stringify(doc)}`);
  }
});
