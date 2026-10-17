import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleLine } from './service.ts';

// This reader extracts examples from the supplied Markdown; it is independent of the
// duramen parser and exercises the public request protocol with every published example.
const source = readFileSync(new URL('./SPEC.md',import.meta.url),'utf8');
const echo = readFileSync(new URL('./fixtures/echo.mjs',import.meta.url),'utf8');
const lines = source.split('\n');
type Sample = { name: string; req: string; line: string; assertions: {path:string;value:any}[] };
const samples: Sample[] = [];
let req = '', table: string[] = [];
const tick = String.fromCharCode(96);
function assertions(text: string): {path:string;value:any}[] {
  return [...text.matchAll(/\x60((?:result|id|error)(?:\.[^\x60]*)?)\x60 = \x60([^\x60]*)\x60/g)].map(m => ({path:m[1],value:JSON.parse(m[2])}));
}
function requestLine(opAndInput: string, suffix = ''): string {
  const m = /^(\S+)(?: ([\s\S]*))?$/.exec(opAndInput)!;
  const request: any = {id:'test',op:m[1]};
  if (m[2] !== undefined) request.input = JSON.parse(m[2]);
  if (suffix.includes('no ' + tick + 'id' + tick + ' member')) delete request.id;
  return JSON.stringify(request);
}
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const heading = /^\*\*(REQ-[A-Z]+-[0-9]+)\./.exec(line);
  if (heading) req = heading[1];
  const block = /^Example [^:]+: \x60(check|cases)\x60 with input \x60([^\x60]*)\x60 and these texts:$/.exec(line);
  if (block) {
    const at = i+1;
    const input = JSON.parse(block[2]);
    input.files ??= {};
    for (i++; i < lines.length && !lines[i].startsWith('⟶'); i++) {
      const file = /^\x60input\.files\."([\s\S]*)"\x60:/.exec(lines[i]);
      if (!file) continue;
      const name = JSON.parse('"' + file[1] + '"');
      if (lines[i].includes('the file ' + tick + 'fixtures/echo.mjs')) { input.files[name] = echo; continue; }
      while (i < lines.length && lines[i] !== tick.repeat(3)) i++;
      const text: string[] = [];
      for (i++; i < lines.length && lines[i] !== tick.repeat(3); i++) text.push(lines[i]);
      input.files[name] = text.join('\n') + '\n';
    }
    const a = assertions(lines[i]);
    assert.ok(a.length, 'No assertions for example at ' + at);
    samples.push({name:req + ' example at SPEC.md:' + at,req,line:JSON.stringify({id:'test',op:block[1],input}),assertions:a});
    continue;
  }
  if (line === tick.repeat(3)) {
    for (i++; i < lines.length && lines[i] !== tick.repeat(3); i++);
    continue;
  }
  if (line.startsWith('- ') && line.includes('⟶')) {
    let inputLine: string;
    const raw = /^- the request line \x60([^\x60]*)\x60/.exec(line);
    if (raw) inputLine = raw[1];
    else {
      const request = /^- \x60([^\x60]+)\x60([^⟶]*)/.exec(line);
      if (!request) throw new Error('Cannot read inline example at ' + (i+1));
      inputLine = requestLine(request[1],request[2]);
    }
    samples.push({name:req + ' inline at SPEC.md:' + (i+1),req,line:inputLine,assertions:assertions(line)});
  }
  if (line.startsWith('| case |')) table = line.split('|').slice(1,-1).map(x => x.trim());
  else if (line.startsWith('| ') && table.length && line.includes(tick)) {
    const cells = line.split('|').slice(1,-1).map(x => x.trim());
    const input: any = {}, a: {path:string;value:any}[] = [];
    cells.forEach((cell,i) => {
      if (!cell) return;
      assert.ok(cell.startsWith(tick) && cell.endsWith(tick));
      const value = JSON.parse(cell.slice(1,-1));
      if (table[i] === 'case' || table[i] === 'answer') input[table[i]] = value;
      else a.push({path:table[i],value});
    });
    samples.push({name:req + ' row at SPEC.md:' + (i+1),req,line:JSON.stringify({id:'test',op:'judge',input}),assertions:a});
  }
}
function at(value: any, path: string): any { return path.split('.').reduce((v,key) => v?.[key],value); }
for (const sample of samples) test(sample.name, async () => {
  const answer = JSON.parse(JSON.stringify(await handleLine(sample.line)));
  for (const a of sample.assertions) assert.deepEqual(at(answer,a.path),a.value,a.path + ' for ' + sample.line);
});
test('Every REQ has executable examples in the extracted corpus', () => {
  const ids = [...source.matchAll(/^\*\*(REQ-[A-Z]+-[0-9]+)\./gm)].map(m => m[1]);
  for (const id of ids) assert.ok(samples.some(s => s.req === id),id);
  assert.ok(samples.length >= 180);
});
