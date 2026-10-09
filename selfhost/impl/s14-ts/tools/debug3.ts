import { readFileSync } from 'node:fs';
import { makeSandbox, runOracle } from '../src/oracle.ts';

const examples = JSON.parse(readFileSync(new URL('../test/spec-examples.json', import.meta.url), 'utf8'));
const e = examples.find((x: { name: string }) => x.name.startsWith('REQ-OR-005 example 1'));
const sb = makeSandbox(e.request.input.files);
const r = runOracle('node echo.mjs', sb.root, '{"id":"A#2","op":"f","input":{}}\n');
console.log(JSON.stringify(r));
sb.cleanup();
