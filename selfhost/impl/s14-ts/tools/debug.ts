// Usage: node tools/debug.ts "<example name prefix>"
// Prints the driver's response to one extracted spec example, and what the spec expects.
import { readFileSync } from 'node:fs';
import { handle } from '../src/driver.ts';

const examples = JSON.parse(readFileSync(new URL('../test/spec-examples.json', import.meta.url), 'utf8'));
const e = examples.find((x: { name: string }) => x.name.startsWith(process.argv[2]));
if (!e) throw new Error('no such example');
console.error(JSON.stringify(e.assertions));
console.log(JSON.stringify(handle(JSON.stringify(e.request))));
