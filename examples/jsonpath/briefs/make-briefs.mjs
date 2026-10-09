// The three briefs of claim 7 (CONFIDENCE-2.md), made from what they are made of:
//   C-duramen/  SPEC.md and DECISIONS.md, as `duramen build` writes them from jsonpath.duramen
//   protocol.md the Driver protocol, Operations and Errors parts of C's Interface section, and
//               C's implementation-folder section, verbatim (C's Types and Properties parts list
//               its own test inputs, so they are left out: the protocol carries no JSONPath semantics)
//   A-rfc/      SPEC.md: the protocol, then RFC 9535 and RFC 9485 in full; DECISIONS.md: none
//   B-markdown/ SPEC.md: the protocol, then B's specification (B-markdown/author/SPEC-B.md);
//               DECISIONS.md: B's own (author/DECISIONS-B.md)
//
//   node examples/jsonpath/briefs/make-briefs.mjs [--protocol-only]
//
// The RFC texts are read from briefs/rfc/ and checked against the sha256 that CONFIDENCE-2.md pins.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const HERE = import.meta.dirname;
const ROOT = join(HERE, '..', '..', '..');
const PINNED = {
  'rfc9535.txt': 'bfcb53387d47e3b807bdb695d0a3e136f0c515947289d9c67df354f12ae1fda5',
  'rfc9485.txt': '61e7addfe64e3b0fbff96619d067f3812aa9960cf9b87526d064c3fb3bfbe91f',
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// The text of a `## name` section (or `### name` subsection), up to the next heading of the same
// or a higher level, or a `---` rule.
export function section(md, heading) {
  const lines = md.split('\n');
  const level = heading.match(/^#+/)[0].length;
  const start = lines.findIndex((l) => l === heading);
  if (start < 0) throw new Error(`no "${heading}" in the brief`);
  let end = start + 1;
  for (; end < lines.length; end++) {
    const h = lines[end].match(/^(#+) /);
    if ((h && h[1].length <= level) || lines[end] === '---') break;
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

export function protocolOf(specC) {
  const iface = section(specC, '## Interface');
  const parts = ['### Driver protocol', '### Operations', '### Errors'].map((h) => section(iface, h));
  // The record's open items are rendered after its last section, the implementation folder; they
  // are about JSONPath, so the protocol stops before the first of them.
  const folder = section(specC, '## The implementation folder').split('\n');
  const open = folder.findIndex((l) => l.startsWith('**OPEN-'));
  return ['## Interface', '', ...parts.flatMap((p) => [p, '']), (open < 0 ? folder : folder.slice(0, open)).join('\n').trimEnd(), ''].join('\n');
}

function main(argv) {
  const out = (dir, files) => { mkdirSync(join(HERE, dir), { recursive: true }); for (const [f, text] of Object.entries(files)) writeFileSync(join(HERE, dir, f), text); };
  const built = spawnSync(process.execPath, [join(ROOT, 'bin', 'duramen.mjs'), 'build', join(HERE, '..', 'jsonpath.duramen'), '--out', join(HERE, 'C-duramen')], { encoding: 'utf8' });
  if (built.status !== 0) { process.stderr.write(built.stdout + built.stderr); return 1; }
  const specC = readFileSync(join(HERE, 'C-duramen', 'SPEC.md'), 'utf8');
  const protocol = protocolOf(specC);
  writeFileSync(join(HERE, 'protocol.md'), protocol);
  if (argv.includes('--protocol-only')) { process.stdout.write(`wrote protocol.md (${protocol.length} characters)\n`); return 0; }

  const rfc = {};
  for (const [f, want] of Object.entries(PINNED)) {
    rfc[f] = readFileSync(join(HERE, 'rfc', f), 'utf8');
    if (sha256(rfc[f]) !== want) { process.stderr.write(`${f}: sha256 is not the one CONFIDENCE-2.md pins\n`); return 1; }
  }
  const head = '# jsonpath: specification\n\n';
  out('A-rfc', {
    'SPEC.md': `${head}This program evaluates JSONPath queries as RFC 9535 defines them, with RFC 9485 (I-Regexp) for the regular expressions of the \`match()\` and \`search()\` functions. The interface below says how it is run and judged; the two RFCs, in full after it, are the specification of its behavior.\n\n${protocol}\n---\n\n# RFC 9535\n\n${rfc['rfc9535.txt']}\n---\n\n# RFC 9485\n\n${rfc['rfc9485.txt']}`,
    'DECISIONS.md': '# jsonpath: decisions\n\nNone.\n',
  });
  const bSpec = join(HERE, 'B-markdown', 'author', 'SPEC-B.md');
  if (existsSync(bSpec)) {
    const bDecisions = join(HERE, 'B-markdown', 'author', 'DECISIONS-B.md');
    out('B-markdown', {
      'SPEC.md': `${head}This program evaluates JSONPath queries as RFC 9535 defines them. The interface below says how it is run and judged; the specification after it says what it does.\n\n${protocol}\n---\n\n${readFileSync(bSpec, 'utf8')}`,
      'DECISIONS.md': existsSync(bDecisions) ? readFileSync(bDecisions, 'utf8') : '# jsonpath: decisions\n\nNone.\n',
    });
  }
  for (const d of ['A-rfc', 'B-markdown', 'C-duramen']) {
    if (!existsSync(join(HERE, d, 'SPEC.md'))) continue;
    const s = readFileSync(join(HERE, d, 'SPEC.md'), 'utf8'), dd = readFileSync(join(HERE, d, 'DECISIONS.md'), 'utf8');
    process.stdout.write(`${d}: SPEC.md ${s.length} characters (sha256 ${sha256(s).slice(0, 12)}), DECISIONS.md ${dd.length} (${sha256(dd).slice(0, 12)})\n`);
  }
  return 0;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) process.exitCode = main(process.argv.slice(2));
