// What did a blind builder reach outside its work folder? `duramen regen`'s audit reads the paths a
// builder names in its tool calls and commands, but not the code inside an inline script, a
// here-document or a file it wrote and ran, and `node` and `python` can read any file the user
// can. This reads all of that from the transcripts a run keeps (<sandbox>/<id>/meta/transcript.jsonl,
// next to the work folder <sandbox>/<id>/w), and prints every place that names a path outside
// the work folder.
//
//   node selfhost/transcripts.mjs <sandbox root> [<id> ...]
//
// It looks for absolute paths under /home, /root, /etc, /usr, /opt, /var and /tmp, home
// references (~/, $HOME, homedir), two parent folders in a row, and parent folders in commands.
// A hit is a place to read, not a verdict: test data that names /etc/passwd is a hit too.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const OUTSIDE = /(\/home\/|\/root\b|\/etc\/|\/usr\/|\/opt\/|\/var\/|\/tmp\b|~\/|\$HOME|homedir|\.\.\/\.\.\/)/g;
const PARENT = /(^|[\s'"(=])\.\.(\/|\s|$|['")])/g;

export function scanTranscript(text, work, sandbox) {
  const hits = [];
  const strip = (t) => String(t ?? '').split(work).join('<work>').split(sandbox).join('<sandbox>');
  text.split('\n').forEach((line, i) => {
    let r;
    try { r = JSON.parse(line); } catch { return; }
    if (r?.type !== 'assistant') return;
    for (const c of r.message?.content ?? []) {
      if (c?.type !== 'tool_use') continue;
      const inp = c.input ?? {};
      const texts = [];
      if (c.name === 'Bash') texts.push(['command', inp.command, true]);
      if (c.name === 'Write') texts.push([`wrote ${basename(String(inp.file_path))}`, inp.content, false]);
      if (c.name === 'Edit') texts.push([`edited ${basename(String(inp.file_path))}`, inp.new_string, false]);
      if (['Read', 'Glob', 'Grep'].includes(c.name)) for (const k of ['file_path', 'path', 'pattern']) if (k in inp) texts.push([`${c.name} ${k}`, inp[k], false]);
      for (const [what, raw, isCommand] of texts) {
        const t = strip(raw);
        for (const re of isCommand ? [OUTSIDE, PARENT] : [OUTSIDE]) {
          for (const m of t.matchAll(re)) {
            hits.push({ line: i + 1, tool: c.name, what, near: t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).replace(/\n/g, ' | ') });
          }
        }
      }
    }
  });
  return hits;
}

function main(argv) {
  const [root, ...ids] = argv;
  if (!root) { console.error('usage: node selfhost/transcripts.mjs <sandbox root> [<id> ...]'); return 2; }
  const all = ids.length ? ids : readdirSync(root).filter((d) => existsSync(join(root, d, 'meta', 'transcript.jsonl')));
  for (const id of all) {
    const hits = scanTranscript(readFileSync(join(root, id, 'meta', 'transcript.jsonl'), 'utf8'), join(root, id, 'w'), join(root, id));
    console.log(`${id}: ${hits.length} place${hits.length === 1 ? '' : 's'}`);
    for (const h of hits) console.log(`  line ${h.line}, ${h.what}: ...${h.near}...`);
  }
  return 0;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) process.exitCode = main(process.argv.slice(2));
