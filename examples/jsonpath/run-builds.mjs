// Claim 7's builds (CONFIDENCE-2.md): every brief through `duramen regen --brief`, the same
// launch, isolation, audit and score for each. Cells in order (claude-sonnet-5-5 TypeScript and
// Python, two of each; claude-haiku-5-5 TypeScript, two), and within a cell the briefs
// interleaved A, B, C; at most four builds at a time. Each build's output goes to
// regen/logs/<run>.log; the ledger and run records are regen/ledger.jsonl and regen/<run>-<lang>.md.
//
//   node examples/jsonpath/run-builds.mjs [--only <run id prefix>] [--jobs 4]
import { spawn } from 'node:child_process';
import { mkdirSync, appendFileSync, existsSync, openSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname;
const ROOT = join(HERE, '..', '..');
const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : '';
const jobs = argv.includes('--jobs') ? Number(argv[argv.indexOf('--jobs') + 1]) : 4;
const BRIEFS = { A: 'A-rfc', B: 'B-markdown', C: 'C-duramen' };
const CELLS = [
  ['sonnet', 'claude-sonnet-5-5', 'ts', 1], ['sonnet', 'claude-sonnet-5-5', 'py', 1],
  ['sonnet', 'claude-sonnet-5-5', 'ts', 2], ['sonnet', 'claude-sonnet-5-5', 'py', 2],
  ['haiku', 'claude-haiku-5-5', 'ts', 1], ['haiku', 'claude-haiku-5-5', 'ts', 2],
];
const queue = [];
for (const [short, model, lang, n] of CELLS) for (const b of ['A', 'B', 'C']) queue.push({ id: `${b}-${short}-${n}`, brief: BRIEFS[b], model, lang });
const todo = queue.filter((q) => q.id.startsWith(only) && !existsSync(join(HERE, 'regen', 'impl', `${q.id}-${q.lang}`)));
mkdirSync(join(HERE, 'regen', 'logs'), { recursive: true });
const log = (s) => appendFileSync(join(HERE, 'regen', 'logs', 'runner.log'), `${new Date().toISOString()} ${s}\n`);
log(`start: ${todo.map((q) => `${q.id}-${q.lang}`).join(' ')}`);

let running = 0;
function next() {
  while (running < jobs && todo.length) {
    const q = todo.shift();
    running++;
    log(`launch ${q.id}-${q.lang} (${q.model}, ${q.brief})`);
    const out = openSync(join(HERE, 'regen', 'logs', `${q.id}-${q.lang}.log`), 'w');
    const child = spawn(process.execPath, [join(ROOT, 'bin', 'duramen.mjs'), 'regen', join(HERE, 'jsonpath.duramen'), '--lang', q.lang, '--model', q.model,
      '--brief', join(HERE, 'briefs', q.brief), '--runs', join(HERE, 'regen'), '--run-id', q.id, '--leak-terms', join(HERE, 'leak-terms.json'),
      '--max-minutes', '60'], { cwd: ROOT, stdio: ['ignore', out, out] });
    child.on('close', (code) => { running--; log(`done ${q.id}-${q.lang}: exit ${code}`); next(); });
  }
  if (!running && !todo.length) log('all done');
}
next();
