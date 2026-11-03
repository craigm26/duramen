// duramen's JSON reader (src/json.mjs) and the oracle drivers' copies of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseJson, readJson } from '../src/json.mjs';
import { readJson as copyReadJson } from '../examples/heat-engine/read-json.mjs';
import { ROOT } from './helpers.mjs';

const TEXTS = [
  '0', '-0', '1.5', '-2e3', '1E+2', '1e400', '-1e-400', '123456789012345678901234567890', '"x"', 'true', 'false', 'null',
  ' \t\r\n[ ] ', '{}', '[1,[2,[3,{}]]]', '{"a":1,"b":[true,false,null],"c":{"d":"e"}}',
  String.raw`"\"\\\/\b\f\n\r\t\u0041\ud83d\ude00\ud800"`,
  String.raw`{"\u0000":[""],"\\":[],"\"":0,"\n":1,"10":2,"2":3,"😀":4}`,
  '{"a":1,"a":2,"b":3,"a":4}', '{"__proto__":{"x":1},"constructor":0}', '{"9":0,"10":1,"-1":2,"01":3}',
];
const BAD = ['', ' ', '01', '1.', '.5', '-', '+1', '1e', '[1,]', '{"a":1,}', '{a:1}', "'x'", '"\u0001"', '"\\x"', '"\\u12"', '[1 2]', '{"a" 1}', 'tru', 'nulll', '"abc', '[', '{', '1 2', 'NaN', 'Infinity'];

const same = (a, b) => { assert.deepEqual(a, b); if (a && typeof a === 'object') assert.deepEqual(Object.keys(a), Object.keys(b)); };
const deepKeys = (v) => v && typeof v === 'object' ? [Object.keys(v), ...Object.values(v).map(deepKeys)] : null;

test('json: readJson reads every text as JSON.parse does, keys in the same order', () => {
  for (const t of TEXTS) {
    for (const read of [readJson, copyReadJson, parseJson]) {
      const a = read(t), b = JSON.parse(t);
      same(a, b);
      assert.deepEqual(deepKeys(a), deepKeys(b), t);
      if (t.includes('__proto__')) assert.ok(Object.hasOwn(a, '__proto__'), t);
    }
  }
});

test('json: readJson refuses what JSON.parse refuses, with a SyntaxError', () => {
  for (const t of BAD) {
    assert.throws(() => JSON.parse(t), SyntaxError, t);
    for (const read of [readJson, copyReadJson, parseJson]) assert.throws(() => read(t), SyntaxError, t);
  }
});

test('json: parseJson reads escaped keys right after an object that primes the V8 key bug', () => {
  // In a fresh process, so this file's other parses cannot prime or hide it. On Node.js 24 and 26
  // the JSON.parse line answers ["\u0000","\\"]; parseJson must answer ["\u0000","\""] everywhere.
  const url = (p) => JSON.stringify(new URL(`file://${join(ROOT, p)}`).href);
  const prog = `
    const { parseJson } = await import(${url('src/json.mjs')});
    const copy = await import(${url('examples/heat-engine/read-json.mjs')});
    const out = [];
    for (const read of [parseJson, copy.parseJson]) {
      read(String.raw\`{"\\u0000":[""],"\\\\":[]}\`);
      out.push(Object.keys(read(String.raw\`{"\\u0000":0,"\\"":0}\`)));
      out.push(Object.keys(read(String.raw\`[{"q":0,"\\\\":0},{"q":0,"\\n":0}]\`)[1]));
    }
    process.stdout.write(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', prog], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [['\u0000', '"'], ['q', '\n'], ['\u0000', '"'], ['q', '\n']]);
});

test('json: the oracle drivers carry the same reader, byte for byte', () => {
  const one = readFileSync(join(ROOT, 'examples/heat-engine/read-json.mjs'), 'utf8');
  for (const d of ['jsonpath', 'rcan-gate']) assert.equal(readFileSync(join(ROOT, 'examples', d, 'read-json.mjs'), 'utf8'), one, d);
});
