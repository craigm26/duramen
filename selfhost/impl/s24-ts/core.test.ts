import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, openSync, closeSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { handleLine } from './service.ts';
import { parseRecord } from './parser.ts';
import { commandWords } from './oracle.ts';
import { atPath, equal, meets, missing } from './values.ts';

const echo = readFileSync(new URL('./fixtures/echo.mjs',import.meta.url),'utf8');
const header = 'duramen 0.1\nspec p 1\n';
const normalize = (value: any): any => JSON.parse(JSON.stringify(value));
async function request(op: string, input: any): Promise<any> {
  return normalize(await handleLine(JSON.stringify({id:'custom',op,input})));
}
async function record(text: string, extra: Record<string,string> = {}, op = 'check', entry?: string): Promise<any> {
  const response = await request(op,{files:{'s.duramen':text,...extra},...(entry === undefined ? {} : {entry})});
  assert.ok(response.result,JSON.stringify(response));
  return response.result;
}
async function syntax(body: string, expected: string[]): Promise<void> {
  const result = await record(header+body);
  assert.deepEqual(result.diagnostics,expected.map(s => 's.duramen:' + s));
}
const echoRecord = (body: string, declaration = '  input x? json, answer? json, silent? json, say? json, exit? json\n'): string =>
  header + 'oracle node echo.mjs\nop f\n' + declaration + 'req R "Requirement"\n' + body;

// Independent tests complement every published requirement, especially interactions
// between parsing, semantic diagnostics, process execution, and generated cases.
test('Interface and REQ-RQ-002: framing, continuation, response shape, UTF-8, and clean EOF', () => {
  const dir = mkdtempSync(resolve('.driver-test-'));
  const good = {id:'café😀',op:'judge',input:{case:{checks:[{kind:'eq',path:'result',value:'a\u2028b\u2029c\r\n'}],full:null},answer:{result:'a\u2028b\u2029c\r\n'}}};
  const lines = ['',' \t','{bad',JSON.stringify({id:'u',op:'nope'}),JSON.stringify(good),JSON.stringify({id:'last',op:'check',input:{files:{'x':header},entry:'x'}})];
  writeFileSync(join(dir,'in'),lines.join('\n')); // final line deliberately lacks LF
  const fds = [openSync(join(dir,'in'),'r'),openSync(join(dir,'out'),'w'),openSync(join(dir,'err'),'w')];
  try {
    const child = spawnSync(process.execPath,['driver.ts'],{cwd:process.cwd(),stdio:fds});
    assert.equal(child.error,undefined); assert.equal(child.status,0);
    const bytes = readFileSync(join(dir,'out'));
    assert.equal(bytes.includes(13),false); assert.equal(bytes.at(-1),10);
    const answers = bytes.toString('utf8').trimEnd().split('\n').map(s => JSON.parse(s));
    assert.deepEqual(answers,[{id:null,error:'bad_request'},{id:'u',error:'unknown_op'},{id:good.id,result:{pass:true}},{id:'last',result:{diagnostics:[],errors:0,warnings:0}}]);
    assert.equal(readFileSync(join(dir,'err'),'utf8'),'');
  } finally { fds.forEach(closeSync); rmSync(dir,{recursive:true,force:true}); }
});

test('REQ-RQ-001/002: relative paths, collisions, whole request, and error priority', async () => {
  for (const name of ['', '/', 'a//b', 'a/./b', 'a/../b', 'Z:thing','a\\b','a\0b']) {
    assert.deepEqual(await request('check',{files:{[name]:header}}),{id:'custom',error:'bad_request'});
  }
  for (const files of [{a:'x','a-b':'y','a/b.duramen':header}, {'a/b':'x','a/b/c':'z'}]) {
    assert.equal((await request('cases',{files})).error,'bad_request');
  }
  assert.equal((await request('check',{files:{'1:file':header},entry:'1:file'})).result.errors,0);
  for (const line of ['null','[]','{}','{"id":false,"op":"wat"}']) assert.deepEqual(await handleLine(line),{id:null,error:'bad_request'});
  assert.deepEqual(await handleLine('{"id":"x","op":"wat","input":[]}'),{id:'x',error:'unknown_op'});
});

test('REQ-RC-001/002: exact file selection, explicit hidden entry, exclusions, and UTF-16 order', async () => {
  const files = {'r/a.duramen':header,'r/.hide/b.duramen':'bad','r/build/x.duramen':'bad','r/x/node_modules/a.duramen':'bad','outside.duramen':'bad'};
  assert.equal((await request('check',{files,entry:'r'})).result.errors,0);
  assert.equal((await request('check',{files:{'.hide/s':header,'other.duramen':'bad'},entry:'.hide/s'})).result.errors,0);
  const sorted = await request('check',{files:{'\uff61.duramen':header,'😀.duramen':header}});
  assert.deepEqual(sorted.result.diagnostics,['\uff61.duramen:2: error P044']);
  assert.deepEqual((await request('check',{files:{'n.txt':'x'}})).result,{diagnostics:['.:1: error P046'],errors:1,warnings:0});
});

test('REQ-RC-003/004/005: malformed first declarations still claim their singleton', async () => {
  await syntax('oracle\noracle\nerrors extra\nerrors\n  e no\nduramen 9\n  title x\nreq R "r"\n',[
    '3: error P028','4: error P028','4: error P044','5: error P050','6: error P032','7: error P019','8: error P023','9: error P015'
  ]);
  const result = await request('check',{files:{'a.duramen':'duramen 9\nduramen 0.2\nspec p 1\n','b.duramen':'duramen 0.1\n'}});
  assert.deepEqual(result.result.diagnostics,['a.duramen:1: error P023','a.duramen:2: error P023']);
});

test('REQ-RC-006: preserve identical diagnostics and count each level', async () => {
  const result = await record(echoRecord('  example f {}\n','  input a number, b number\n'),{'echo.mjs':echo});
  assert.deepEqual(result.diagnostics,['s.duramen:7: error T010','s.duramen:7: error T010']);
  assert.equal(result.errors,2); assert.equal(result.warnings,0);
});

test('REQ-SY-001/002/003: normalization, comments, ignored unknown bodies, and illegal indentation', async () => {
  assert.equal((await record('\ufeffduramen 0.1\r\nspec p 1\rnote\n  text\n    plain\u2028text\u2029end\n')).errors,0);
  await syntax('wat\n  nope\n    ignored\nnote\n \u00a0bad\n #odd\n    #no clause\n  text\n   #text at three\n',[
    '3: error P002','7: error P001','8: error P007','9: error P006','11: error P008'
  ]);
  const p = parseRecord({'s':'  #indented before a statement\n' + header},'s');
  assert.deepEqual(p.diagnostics.map(d => d.code),['P003']);
});

test('REQ-SY-003/004/005/006: once-only clauses, malformed quoted strings and continuing bodies', async () => {
  await syntax('  title bad\n  title "valid"\n    ignored\n  request {"id":1e400}\n  request {}\nnote\n  text extra\n   bad\n  text\n    ignored\nsection S "a" "b"\nsection T "\n',[
    '3: error P004','4: error P052','6: error P009','7: error P052','9: error P008','10: error P008','11: error P052','13: error P004','14: error P005'
  ]);
});

test('REQ-SY-007: balanced field separators, malformed declarations claim no names or paths', async () => {
  const r = parseRecord({'s':header+'op f\n  input a (x}, b? {q:[1,2]}, c "x,\\"y", d x], e y\n  input a, a z, , b? x\n  tolerance __proto__ 1\n  tolerance __proto__ x\n  tolerance __proto__ 2\n  audit other\n  audit\n'},'s');
  const op = r.statements.find(s => s.kind === 'op')!;
  assert.deepEqual([...op.fields],[['a',false],['b',true],['c',false],['d',false],['e',false]]);
  assert.equal(op.tolerances.__proto__,1);
  assert.deepEqual(r.diagnostics.map(d => d.code),['P017','P052','P017','P052','P018','P052','P050','P052']);
});

test('REQ-SY-008/009: error continuations, platform and bare statements', async () => {
  await syntax('errors x\n  e when\n   bad\n  e no condition\nreq R "r"\n  on linux\nnote extra\n',[
    '3: error P050','4: error P019','5: error P006','6: error P019','8: error P033','9: error P050'
  ]);
});

test('REQ-SY-010: failed example headers still read all body kinds; raw from lines take no block', async () => {
  await syntax('req R "r"\n  example f []\n    expect result =\n    request {"id":1}\n    request {}\n    request nope\n    omit , \n    input a.b from "missing"\n  example raw "bad"\n    input a\n      skipped\n    input b from "missing"\n      bad\n',[
    '4: error P012','5: error P009','6: error P051','8: error P052','9: error P011','10: error P048','12: error P022','14: error P022','15: error P006'
  ]);
});

test('REQ-SY-011: path precedence, plain data keys, BOM files and uninterrupted input blocks', async () => {
  const text = echoRecord('  example f {"x":{}}\n    input x."__proto__"\n\n      café\n#zero\n  #two\n      #text\n\n    input x.constructor from "data.txt"\n    expect result.x.__proto__ = "\\ncafé\\n#text\\n"\n    expect result.x.constructor = "\\ufeffwhole\\r\\n"\n');
  const result = await record(text,{'echo.mjs':echo,'data.txt':'\ufeffwhole\r\n'},'cases');
  assert.equal(result.errors,0);
  assert.equal(JSON.parse(result.cases[0].line).input.x.__proto__,'\ncafé\n#text\n');
  const errors = await record(echoRecord('  example f {"x":1}\n    input x..bad from "missing"\n    input x.a from "missing"\n    input x.a from "data"\n    input y\n'),{'echo.mjs':echo,data:'ok'});
  assert.deepEqual(errors.diagnostics,['s.duramen:8: error P049','s.duramen:9: error P048','s.duramen:10: error P049','s.duramen:11: error P049']);
});

test('REQ-SY-012/013: tables fail left to right, preserve structural errors and reject overflow', async () => {
  await syntax('req R "r"\n  table f\n    garbage\n    | x ± -1 | bad! | result ± -3 |\n    | { | 2 | 3 |\n  table f\n    | x | result ± 0 |\n    | 1e400 | 1e400 |\n    | 1 |\n',[
    '5: error P006','6: error P010','6: error P013','10: error P009','10: error P010','11: error P014'
  ]);
});

test('REQ-CK-001/002/003/007/009: kind-scoped IDs, repeated citations and unused duplicate decisions', async () => {
  const text = header+'decision D "first"\n  source here\n  status contested\ndecision D "second"\n  source there\nopen R "open"\n  example raw wrong\n    nonsense\nreq R "r"\n  decision D, D, missing missing\n';
  const result = await record(text);
  assert.deepEqual(result.diagnostics,['s.duramen:6: error T007','s.duramen:9: error T003','s.duramen:11: error T001','s.duramen:11: error T008','s.duramen:11: error T028']);
  const unused = await record(header+'decision U "a"\ndecision U "b"\n');
  assert.equal(unused.warnings,4);
  assert.deepEqual(unused.diagnostics,['s.duramen:3: warning T012','s.duramen:3: warning T013','s.duramen:4: error T007','s.duramen:4: warning T012','s.duramen:4: warning T013']);
});

test('REQ-CK-004/005: expected error skips operation checks but named values require declared string codes', async () => {
  const text = echoRecord('  example missing {"answer":{"error":"e"}}\n    expect error = "e"\n  example f {"answer":{"error":1}}\n    expect error ≈ 1 ± 0\n  example f {"answer":{"error":null}}\n    expect error = ?\n');
  const result = await record(text.replace('req R','errors\n  e when always\nreq R'),{'echo.mjs':echo});
  assert.deepEqual(result.diagnostics,['s.duramen:12: error T023']);
});

test('REQ-CK-006: quotations are line-local, separated from surrounding words and checked per text', async () => {
  const bt = String.fromCharCode(96);
  const text = header+'note\n  text\n    x'+bt+'a'+bt+'MUST and MUST again\nnote\n  text\n    MU'+bt+'a'+bt+'ST "MUST" “SHALL” '+bt+'REQUIRED'+bt+'\nopen O "title MUST"\n  text\n    MUSTé\ndecision D "d"\n  source here\n  rejected "\\\"SHALL\\nMUST\\\""\n';
  const result = await record(text);
  assert.deepEqual(result.diagnostics,['s.duramen:3: error T004','s.duramen:9: warning T014','s.duramen:12: error T004','s.duramen:12: warning T012']);
});

test('REQ-CK-008: distinct codes and order phrases have their specified word boundaries', async () => {
  const prefix = header+'errors\n  a.b when never\n  e when never\nreq R "r"\n  text\n';
  assert.ok((await record(prefix+'    a.bé BEFORE-hand e\n')).diagnostics.includes('s.duramen:7: error T005'));
  assert.equal((await record(prefix+'    xa.b before e2\n')).diagnostics.some((s:string) => s.endsWith('T005')),false);
});

test('REQ-CK-009: invalid lifecycle syntax still influences citations through the first word', async () => {
  const text = header+'decision A "a"\n  source here\n  status superseded  by B\ndecision B "b"\n  source here\n  status observed,\nreq R "r"\n  decision A, B\n';
  const result = await record(text);
  assert.deepEqual(result.diagnostics,['s.duramen:3: error T027','s.duramen:6: error T027','s.duramen:9: error T001','s.duramen:9: error T028']);
});

test('REQ-OR-001/002: no oracle for examples is T019, no examples never starts a command', async () => {
  assert.deepEqual((await record(header+'req R "r"\n  example absent {}\n')).diagnostics,['s.duramen:2: error T019','s.duramen:4: error T009']);
  assert.deepEqual((await record(header+'oracle no-such-command\n')).diagnostics,[]);
  assert.deepEqual(commandWords('n "a b"\tc\'d e\' "" "a\\b\\\"c"'),['n','a b','cd e','','a\\b"c']);
  assert.equal(commandWords('node "unclosed'),undefined);
});

test('REQ-OR-002/003/005: match IDs, ignore malformed/nonfinite lines, first duplicate wins', async () => {
  const model = 'console.log("nope"); console.log("[1]"); console.log(\'{"id":"R#1","result":1e400}\'); console.log(\'{"id":"R#2","result":2}\'); console.log(\'{"id":"R#1","result":1}\'); console.log(\'{"id":"R#1","result":9}\');';
  const text = header+'oracle node model.mjs\nop f\nreq R "r"\n  example f {}\n    expect result = 1\n  example f {}\n    expect result = 2\n  example f {}\n    expect result = 3\n';
  const result = await record(text,{'model.mjs':model});
  assert.deepEqual(result.diagnostics,['s.duramen:10: error T021']);
});

test('REQ-OR-002: raw and omitted-id cases each run alone and accept any object id', async () => {
  const model = 'let s="";for await(const c of process.stdin)s+=c;const n=s.trim().split("\\n").length;console.log(JSON.stringify({id:7,result:n}));';
  const text = header+'oracle node model.mjs\nop f\nreq R "r"\n  example raw "{}"\n    expect result = 1\n  example f {}\n    omit id\n    expect result = 1\n';
  const result = await record(text,{'model.mjs':model},'cases');
  assert.equal(result.errors,0); assert.ok(result.cases.every((c:any) => c.solo));
});

test('REQ-OR-004: nonzero exit and signal retain earlier answers and locate solo failures', async () => {
  const text = echoRecord('  example f {"exit":7}\n    expect result.exit = 7\n  example raw \'{"input":{"exit":7}}\'\n    expect result.exit = 7\n');
  assert.deepEqual((await record(text,{'echo.mjs':echo})).diagnostics,['s.duramen:3: error T020','s.duramen:9: error T020']);
  const model = 'console.log(\'{"id":"R#1","result":1}\'); process.kill(process.pid,"SIGTERM");';
  const result = await record(header+'oracle node model.mjs\nop f\nreq R "r"\n  example f {}\n    expect result = 1\n',{'model.mjs':model});
  assert.deepEqual(result.diagnostics,['s.duramen:3: error T020']);
});

test('REQ-OR-004: timeout stops a run but still uses an answer written before it', async () => {
  const model = 'console.log(\'{"id":"R#1","result":1}\'); setInterval(()=>{},1000);';
  const result = await record(header+'oracle node model.mjs\nop f\nreq R "r"\n  example f {}\n    expect result = 1\n',{'model.mjs':model});
  assert.deepEqual(result.diagnostics,['s.duramen:3: error T020']);
});

test('REQ-OR-006/007/008: oracle_error suppresses response checks; any expectation prevents T024', async () => {
  const result = await record(echoRecord('  example f {"answer":{"oracle_error":null,"error":"bad"}}\n    expect result = ?\n  example f {"answer":{"error":null}}\n  example f {"answer":{"error":null}}\n    expect id = "R#3"\n  example f {"answer":{"result":{}}}\n    expect result.x = ?\n'),{'echo.mjs':echo});
  assert.deepEqual(result.diagnostics,['s.duramen:7: error T022','s.duramen:9: warning T024','s.duramen:13: error T025']);
});

test('REQ-SU-001/002/003/004/005: suite ordering, preserved spellings, requests, checks and full values', async () => {
  const text = header+'  request {"a":1,"2":"two","z":0}\noracle node echo.mjs\nop f\n  input x? json\n  tolerance result.x 0.5\nreq REQ-R "r"\n  on windows\n  example f { "x" : -0e0 }\n    request {"a":2,"b":3}\n    omit z\n    expect result.x ~ 0 +- 0\n    expect result = ?\n  table f\n    | x | result.x |\n    | 2.0e1 | ? |\n';
  const result = await record(text,{'echo.mjs':echo},'cases');
  assert.equal(result.errors,0); assert.deepEqual(result.cases.map((c:any) => c.id),['REQ-R#1','REQ-R#2']);
  const first = result.cases[0];
  assert.equal(first.line,'{"id":"REQ-R#1","op":"f","2":"two","a":2,"b":3,"input":{ "x" : -0e0 }}');
  assert.equal(first.platform,'windows'); assert.deepEqual(first.reqs,['REQ-REQ-R']);
  assert.deepEqual(first.checks,[{path:'result.x',kind:'approx',value:0,tol:0},{path:'result',kind:'eq',from:'oracle',value:{x:0}}]);
  assert.deepEqual(first.full,{members:['id','result'],result:{x:0},tolerances:{'result.x':0.5}});
  for (const c of result.cases) assert.deepEqual((await request('judge',{case:c,answer:{id:c.id,result:c.full.result}})).result,{pass:true});
  const errors = await record(text+'unknown\n',{'echo.mjs':echo},'cases');
  assert.deepEqual(errors,{errors:1,cases:[]});
  const warning = await record(echoRecord('  example f {"extra":1}\n'),{'echo.mjs':echo},'cases');
  assert.equal(warning.errors,0); assert.equal(warning.cases.length,1);
});

test('REQ-JU-001/002/003/004: own members, missing paths, strict types, tolerances, audit, and failure order', async () => {
  const c = {checks:[{path:'result.constructor',kind:'eq',value:1},{path:'result.arr.length',kind:'eq',value:2},{path:'audit.x',kind:'eq',value:1}],full:{members:['audit','id','result'],result:{constructor:1,arr:[1,2]},audit:'{"x":1}',tolerances:{'result.arr.1':0.25}}};
  const result = await request('judge',{case:c,answer:{id:'any',result:{constructor:1,arr:[1,2.1]},audit:'{ "x":1 }'}});
  assert.deepEqual(result.result,{pass:false,failed:['checks.1','audit']});
  assert.equal(atPath({result:{}},'result.constructor'),missing);
  assert.equal(atPath({result:[1]},'result.00'),missing);
  assert.equal(atPath({result:{'':2}},'result.'),2);
  assert.equal(atPath({audit:'{"x":1e400}'},'audit.x'),missing);
  assert.equal(equal({a:1,b:[]},{b:[],a:1}),true);
  assert.equal(equal({},[]),false); assert.equal(equal(true,1),false);
  assert.equal(meets({path:'result',kind:'approx',value:1.9,tol:0.1},{result:2}),false);
  assert.deepEqual((await request('judge',{case:{checks:[],full:null},answer:null})).result,{pass:false,failed:['answer']});
  const errorCase = {checks:[],full:{members:['audit','error','result'],error:{e:[1]},result:1,audit:'x',tolerances:{}}};
  assert.deepEqual((await request('judge',{case:errorCase,answer:{error:{e:[1]},result:2,audit:'y'}})).result,{pass:true});
});

test('REQ-RQ-001 and OPEN-RQ-001: materialized oracle data stays isolated and is cleaned after each request', async () => {
  const before = readdirSync('.').filter(n => n.startsWith('.duramen-run-'));
  const model = 'import fs from "node:fs"; const had=fs.existsSync("marker"); fs.writeFileSync("marker","x"); console.log(JSON.stringify({id:"R#1",result:had}));';
  const text = header+'oracle node model.mjs\nop f\nreq R "r"\n  example f {}\n    expect result = false\n';
  assert.equal((await record(text,{'model.mjs':model})).errors,0);
  assert.equal((await record(text,{'model.mjs':model})).errors,0);
  assert.deepEqual(readdirSync('.').filter(n => n.startsWith('.duramen-run-')),before);
  assert.equal(existsSync('marker'),false);
});
