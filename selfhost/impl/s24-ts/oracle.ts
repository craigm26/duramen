import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, open, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { json, object, own, dict } from './values.ts';
import { add } from './parser.ts';
import type { RecordModel, Statement, Example } from './parser.ts';

/** Shell-free tokenization: only spaces/tabs separate words. */
export function commandWords(command: string): string[] | undefined {
  const result: string[] = [];
  let word = '', active = false, quote = '';
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = '';
      else if (quote === '"' && c === '\\' && command[i+1] === '"') { word += '"'; i++; }
      else word += c;
    } else if (c === '"' || c === "'") { quote = c; active = true; }
    else if (c === ' ' || c === '\t') {
      if (active) { result.push(word); word = ''; active = false; }
    } else { word += c; active = true; }
  }
  if (quote) return;
  if (active) result.push(word);
  return result;
}
export function makeRequest(e: Example, spec: Statement, op?: Statement): void {
  e.solo = e.isRaw || e.omit.has('id');
  if (e.isRaw) { e.requestLine = e.raw!; return; }
  const members = Object.assign(dict(), op?.request ?? spec.request ?? {}, e.request ?? {});
  const pieces: string[] = [];
  if (!e.omit.has('id')) pieces.push('"id":' + JSON.stringify(e.id));
  if (!e.omit.has('op')) pieces.push('"op":' + JSON.stringify(e.op));
  for (const k of Object.keys(members)) if (!e.omit.has(k)) pieces.push(JSON.stringify(k) + ':' + JSON.stringify(members[k]));
  if (!e.omit.has('input') && (e.inputText !== undefined || e.inputLines)) {
    pieces.push('"input":' + (e.inputLines ? JSON.stringify(e.input) : e.inputText));
  }
  e.requestLine = '{' + pieces.join(',') + '}';
}
type RunResult = { output: string; failed: boolean };
async function run(words: string[] | undefined, cwd: string, lines: string[], ioRoot: string): Promise<RunResult> {
  if (!words?.length || !words[0]) return { output:'', failed:true };
  const io = await mkdtemp(join(ioRoot,'io-'));
  await writeFile(join(io,'input'),lines.join('\n') + '\n','utf8');
  const input = await open(join(io,'input'),'r');
  const output = await open(join(io,'output'),'w');
  try {
    const failed = await new Promise<boolean>(resolveRun => {
      let failed = false;
      let child;
      try { child = spawn(words[0], words.slice(1), {cwd, shell:false, stdio:[input.fd,output.fd,'ignore']}); }
      catch { resolveRun(true); return; }
      const timer = setTimeout(() => { failed = true; child.kill('SIGKILL'); }, 5000);
      child.on('error', () => { failed = true; });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolveRun(failed || code !== 0 || signal !== null);
      });
    });
    return {output:await readFile(join(io,'output'),'utf8'), failed};
  } finally { await input.close(); await output.close(); await rm(io,{recursive:true,force:true}); }
}
export async function runOracle(r: RecordModel, examples: Example[]): Promise<void> {
  if (!r.oracle || !examples.length) return;
  const root = await mkdtemp(resolve('.duramen-run-'));
  const recordRoot = join(root,'record');
  await mkdir(recordRoot);
  try {
    for (const [name,text] of Object.entries(r.files)) {
      const target = join(recordRoot,name);
      await mkdir(dirname(target), {recursive:true});
      await writeFile(target,text,'utf8');
    }
    const words = commandWords(r.oracle.rest);
    const cwd = join(recordRoot,dirname(r.oracle.file));
    const grouped = examples.filter(e => !e.solo);
    if (grouped.length) {
      const result = await run(words,cwd,grouped.map(e => e.requestLine!),root);
      if (result.failed) add(r,r.oracle,'T020');
      const responses = new Map<string,any>();
      for (const line of result.output.split('\n')) {
        if (!line.trim()) continue;
        try {
          const value = json(line);
          if (object(value) && typeof value.id === 'string' && !responses.has(value.id)) responses.set(value.id,value);
        } catch {}
      }
      grouped.forEach(e => { if (responses.has(e.id!)) e.answer = responses.get(e.id!); });
    }
    for (const e of examples.filter(e => e.solo)) {
      const result = await run(words,cwd,[e.requestLine!],root);
      if (result.failed) add(r,e,'T020');
      const lines = result.output.split('\n').filter(line => !!line.trim());
      if (lines.length === 1) {
        try { const value = json(lines[0]); if (object(value)) e.answer = value; } catch {}
      }
    }
  } finally { await rm(root,{recursive:true,force:true}); }
}
