import { object, relative, own } from './values.ts';
import { validJudge, judge } from './judge.ts';
import { analyze } from './checker.ts';

function validRecord(input: any): boolean {
  if (!object(input.files)) return false;
  const names = Object.keys(input.files);
  if (!names.length || names.some(name => !relative(name) || typeof input.files[name] !== 'string')) return false;
  const all = new Set(names);
  for (const name of names) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) if (all.has(parts.slice(0,i).join('/'))) return false;
  }
  return !own(input,'entry') || (typeof input.entry === 'string' && (input.entry === '.' || relative(input.entry)));
}
export async function handle(request: any): Promise<any> {
  if (!object(request) || typeof request.id !== 'string') return {id:null,error:'bad_request'};
  const id = request.id;
  if (!['check','cases','judge'].includes(request.op)) return {id,error:'unknown_op'};
  if (!object(request.input)) return {id,error:'bad_request'};
  if (request.op === 'judge') {
    if (!validJudge(request.input)) return {id,error:'bad_request'};
    return {id,result:judge(request.input.case,request.input.answer)};
  }
  if (!validRecord(request.input)) return {id,error:'bad_request'};
  const result = await analyze(request.input.files,request.input.entry ?? '.');
  return {id,result:request.op === 'check' ? result.check : result.cases};
}
export async function handleLine(line: string): Promise<any> {
  let request;
  try { request = JSON.parse(line); } catch { return {id:null,error:'bad_request'}; }
  try { return await handle(request); }
  catch (error) {
    console.error(error);
    return {id:typeof request?.id === 'string' ? request.id : null,error:'internal_error'};
  }
}
