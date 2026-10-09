// `op … draw`: where `duramen agree` draws an input field from. It changes what agree sends and
// nothing else: check reports a draw that names no input field or cannot be drawn from, the brief
// leaves out types only draws use, and a generated object keeps a member named __proto__.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.mjs';
import { check } from '../src/check.mjs';
import { agreeRequests } from '../src/agree.mjs';
import { renderSpec } from '../src/render.mjs';
import { parseType, genType, makeRng } from '../src/types.mjs';
import { parseExpr, evaluate } from '../src/expr.mjs';

const record = (opLines, extra = '') => `duramen 0.2

spec d 1.0.0

type wide = {t: number}
type near = {t: 999 | 1000 | 1001}
type onlyDrawn = 1 | 2
${extra}
op f
  input x wide
${opLines}

req R-001 "f"
  text
    It MUST answer.
  example f {"x": {"t": 5}}
    expect error = "nope"
`;

const codes = (ds, code) => ds.filter((d) => d.code === code).map((d) => d.message);

test('draw: agree draws the field from the draw type, the input type stays the contract', async () => {
  const { ast, diagnostics } = parse(record('  draw x near'), 'd.duramen');
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.ops[0].draws.length, 1);
  const { requests, skipped } = agreeRequests(ast, { samples: 50, seed: 1 });
  assert.deepEqual(skipped, []);
  assert.equal(requests.length, 50);
  for (const r of requests) assert.ok([999, 1000, 1001].includes(r.input.x.t), JSON.stringify(r.input));
  // Without the draw, the same op draws from its input type.
  const plain = agreeRequests(parse(record(''), 'd.duramen').ast, { samples: 50, seed: 1 });
  assert.ok(plain.requests.some((r) => ![999, 1000, 1001].includes(r.input.x.t)));
});

test('draw: check reports a field the op does not have, an unknown type, a type that does not parse, and 0.1', async () => {
  const bad = parse(record('  draw y near, x nosuch', ''), 'd.duramen');
  const r = await check(bad.ast, { runOracle: false });
  assert.equal(codes(r.diagnostics, 'T041').length, 1);
  assert.match(codes(r.diagnostics, 'T041')[0], /draws y, which is not one of its input fields/);
  assert.match(codes(r.diagnostics, 'T034').join('\n'), /draw x uses type nosuch/);
  const unparsed = await check(parse(record('  draw x {t: }'), 'd.duramen').ast, { runOracle: false });
  assert.equal(codes(unparsed.diagnostics, 'T040').length, 1);
  const pattern = await check(parse(record('  draw x {t: string matching "a+"}'), 'd.duramen').ast, { runOracle: false });
  assert.match(codes(pattern.diagnostics, 'T041').join('\n'), /cannot draw x/);
  const old = parse(record('  draw x near').replace('duramen 0.2', 'duramen 0.1'), 'd.duramen');
  assert.match(codes((await check(old.ast, { runOracle: false })).diagnostics, 'T037').join('\n'), /draw needs duramen 0.2/);
  // A second draw of one field is a parse error, like a second input field of one name.
  assert.equal(parse(record('  draw x near\n  draw x wide'), 'd.duramen').diagnostics.filter((d) => d.code === 'P052').length, 1);
});

test('draw: the brief leaves out types only draws use, and keeps the rest', () => {
  const { ast } = parse(record('  draw x near', 'type unused = 3'), 'd.duramen');
  const text = renderSpec(ast, null);
  assert.match(text, /`wide` =/);
  assert.match(text, /`unused` =/); // used by nothing at all: listed, as before draw existed
  assert.doesNotMatch(text, /`near` =/);
  assert.doesNotMatch(text, /draw/);
  // A type a draw and an input both use is listed.
  const both = parse(record('  draw x near').replace('input x wide', 'input x near'), 'd.duramen');
  assert.match(renderSpec(both.ast, null), /`near` =/);
});

test('draw: a generated object, and an object written in an expression, keep a member named __proto__', () => {
  const g = genType(parseType('{__proto__: 1, a: 2}').type, makeRng(1));
  assert.equal(JSON.stringify(g.value), '{"__proto__":1,"a":2}');
  assert.equal(Object.getPrototypeOf(g.value), Object.prototype);
  const v = evaluate(parseExpr('{"__proto__": 1, "b": 2}').ast, new Map());
  assert.equal(JSON.stringify(v), '{"__proto__":1,"b":2}');
});
