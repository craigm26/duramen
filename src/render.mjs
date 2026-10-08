// Renders the builder's brief (SPEC.md), DECISIONS.md and a trace report from a checked spec.
// Every example shown in the brief was run through the oracle by `duramen check`; when an example
// states no expectations, the oracle's own answer is what the brief shows. Evidence, properties
// and static checks are shown under the requirements they support, because the suite checks them.
import { basename } from 'node:path';
import { exampleId, pick } from './check.mjs';
import { describeStatic } from './static.mjs';

const code = (s) => '`' + String(s).replace(/`/g, 'ˋ') + '`';
const cell = (s) => String(s).replace(/\|/g, '\\|');
// Values are shown with object members sorted (by UTF-16 code units). Expectations are compared
// as parsed JSON, so member order means nothing there, and a sorted object cannot look like it
// contradicts a canonical-JSON rule (the first blind build from a generated brief, t01, read an
// unsorted example that way).
const sorted = (v) => (v === null || typeof v !== 'object' ? v : Array.isArray(v) ? v.map(sorted) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])));
const val = (v) => JSON.stringify(sorted(v));
const EVIDENCE_ROWS_SHOWN = 8;

// `expect <path> = ?` shows the oracle's value.
function renderExpect(e, resp) {
  if (e.kind === 'show') { const p = resp ? pick(resp, e.path) : { found: false }; return `${code(e.path)} = ${p.found ? code(val(p.value)) : '(no oracle answer)'}`; }
  return e.kind === 'approx' ? `${code(e.path)} ≈ ${code(e.value)} (± ${e.tol})` : `${code(e.path)} = ${code(val(e.value))}`;
}

// A table of rows (examples from a req's tables, or evidence rows) for one op.
function rowsTable(rows, respOf) {
  const out = [];
  const inCols = [...new Set(rows.flatMap((x) => Object.keys(x.input)))];
  const exCols = [...new Set(rows.flatMap((x) => x.expects.map((e) => e.path)))];
  out.push('', `| ${[...inCols, ...exCols].map(cell).join(' | ')} |`, `|${[...inCols, ...exCols].map(() => '---').join('|')}|`);
  for (const x of rows) {
    const resp = respOf(x);
    const shown = (e) => { const p = resp ? pick(resp, e.path) : { found: false }; return p.found ? code(val(p.value)) : '(no oracle answer)'; };
    const cells = [
      ...inCols.map((c) => (c in x.input ? code(x.rawFields?.[c] ?? val(x.input[c])) : '')),
      ...exCols.map((p) => { const e = x.expects.find((y) => y.path === p); return !e ? '' : e.kind === 'show' ? shown(e) : e.kind === 'approx' ? `${code(e.value)} ± ${e.tol}` : code(val(e.value)); }),
    ];
    out.push(`| ${cells.map(cell).join(' | ')} |`);
  }
  return out;
}

function renderExamples(r, oracle) {
  const out = [];
  const listed = r.examples.map((ex, k) => ({ ex, k })).filter(({ ex }) => ex.from === 'example');
  if (listed.length) {
    out.push('', 'Examples:');
    for (const { ex, k } of listed) {
      let head;
      if (ex.rawLine !== undefined) head = `the request line ${code(ex.rawLine)} ⟶`;
      else {
        const notes = [];
        if (ex.request) notes.push(`with ${Object.entries(ex.request).map(([m, v]) => code(`"${m}": ${val(v)}`)).join(', ')}`);
        const left = [...(ex.noInput ? ['input'] : []), ...ex.omit];
        if (left.length) notes.push(`no ${left.map(code).join(' or ')} member`);
        head = `${code(ex.noInput ? ex.op : `${ex.op} ${ex.raw ?? val(ex.input)}`)}${notes.length ? ` (${notes.join('; ')})` : ''} ⟶`;
      }
      const resp = oracle?.responses.get(exampleId(r, k));
      if (ex.expects.length) out.push(`- ${head} ${ex.expects.map((e) => renderExpect(e, resp)).join('; ')}`);
      else out.push(`- ${head} ${resp ? code(val('error' in resp ? { error: resp.error } : resp.result)) : '(no oracle answer)'}`);
    }
  }
  // Tables: one per op, in order of first appearance.
  const rows = r.examples.filter((ex) => ex.from === 'table');
  for (const op of [...new Set(rows.map((x) => x.op))]) {
    out.push(...rowsTable(rows.filter((x) => x.op === op), (x) => oracle?.responses.get(exampleId(r, r.examples.indexOf(x)))));
    out.push('', `(Rows are \`${op}\` requests. An empty cell states nothing.)`);
  }
  return out;
}

const showGen = (g) => (g.kind === 'oneof' ? `one of ${g.values.map((v) => code(JSON.stringify(v))).join(', ')}` : g.kind === 'json' ? 'any JSON value' : code(g.text));

function renderProperty(pr, run) {
  const out = [`**PROP-${pr.id}.** *${pr.title}.*${pr.text ? ` ${pr.text}` : ''}`.trimEnd(), ''];
  const vars = pr.vars.map((v) => `${code(v.name)} in ${showGen(v.gen)}`);
  out.push(`- For ${vars.length ? vars.join(', ') : 'each case'}${pr.where.length ? `, where ${pr.where.map((w) => code(w.text)).join(' and ')}` : ''}:`);
  for (const c of pr.calls) out.push(`  - ${code(c.name)} is the response to ${code(`${c.op} ${c.inputText}`)}`);
  out.push(`  - then ${pr.expects.map((e) => code(e.text)).join(' and ')}`);
  out.push(`- The suite checks this on ${run ? run.samples : pr.samples} generated cases${pr.decisions.length ? `. Decisions: ${pr.decisions.join(', ')}` : ''}.`);
  return out;
}

function renderEvidence(ev, oracle) {
  const out = [`**EV-${ev.id}.** *${ev.title}.* ${ev.kind}${ev.kindDetail ? ` (${ev.kindDetail})` : ''}. Source: ${ev.source}.${ev.text ? ` ${ev.text}` : ''}`];
  const rows = ev.rows ?? [];
  const waived = new Map(ev.waivers.map((w) => [w.row, w.decision]));
  const kept = rows.filter((r) => !waived.has(r.rowId));
  out.push('', `The suite checks all ${kept.length} rows${waived.size ? `, and checks the ${waived.size} waived rows against this specification instead (${[...new Set(waived.values())].join(', ')})` : ''}.${kept.length > EVIDENCE_ROWS_SHOWN ? ` The first ${EVIDENCE_ROWS_SHOWN}:` : ''}`);
  for (const op of [...new Set(kept.map((r) => r.op))]) {
    const shown = kept.filter((r) => r.op === op).slice(0, EVIDENCE_ROWS_SHOWN);
    out.push(...rowsTable(shown, () => null));
    out.push('', `(Rows are \`${op}\` requests.)`);
  }
  void oracle;
  return out;
}

// The request members a spec adds, and which operations carry them.
function requestMembersLine(ast) {
  const names = new Set([...Object.keys(ast.spec?.request ?? {}), ...ast.ops.flatMap((o) => Object.keys(o.request ?? {}))]);
  if (!names.size) return null;
  const parts = [...names].map((m) => {
    const carry = ast.ops.filter((o) => Object.hasOwn(o.request ?? ast.spec?.request ?? {}, m)).map((o) => o.name);
    const without = ast.ops.filter((o) => !carry.includes(o.name)).map((o) => code(o.name));
    return `${code(m)} (${without.length === 0 ? 'every operation' : carry.length > without.length ? `every operation except ${without.join(', ')}` : carry.map(code).join(', ')})`;
  });
  return `Requests also carry ${parts.join('; ')}.`;
}

export function renderSpec(ast, oracle, { version: duramenVersion = '0.2', properties = [] } = {}) {
  const s = ast.spec;
  const lib = ast.edgeLib ?? { defs: new Map() };
  const runOf = (id) => properties.find((p) => p.id === id);
  const out = [`# ${s.name}: specification`, ''];
  out.push(`- Program: ${code(s.name)}`, `- Document version: ${s.version}`);
  if (s.contract) out.push(`- Contract version: ${code(s.contract)}`);
  out.push(`- Generated from ${code(basename(ast.file))} by duramen ${duramenVersion}. Edit the source, not this file.`, '');
  if (s.title) out.push(`*${s.title}*`, '');
  if (s.text) out.push(s.text, '');
  const conv = [
    'Conventions: MUST and MUST NOT appear only in requirements (`REQ-`) and in the shared',
    'definitions under Edges, and every requirement has at least one check in the suite. Every',
    'example was checked against the specification\'s own model (its oracle) when this file was',
    'generated; where an example states no value, the value shown is the model\'s.',
  ];
  if (ast.evidence.length) conv.push('Evidence (`EV-`) is data from outside this specification, such as published values or another implementation\'s results; the model agrees with every row, except rows a decision waives, and the suite checks the rows.');
  if (ast.properties.length) conv.push('A property (`PROP-`) holds for every input it describes; the suite checks it on generated inputs, and so must an implementation.');
  if (ast.items.some((i) => i.type === 'req' && i.statics.length)) conv.push('Some requirements are checked on the implementation folder itself rather than through the driver; each says how.');
  conv.push(
    '`OPEN-` items are deliberately unspecified and never tested. An order that matters (such as',
    'which error wins) is stated once, in a numbered list. An object written in this document',
    'lists its members in no particular order; text produced as canonical JSON orders them as its',
    'edge says.',
  );
  out.push(...conv, '', '---', '');

  out.push('## Interface', '', '### Driver protocol', '',
    'An implementation is judged only through its driver: the program named by `driver` in the',
    'implementation folder\'s `REGEN.json` (a command string, or an object whose keys are Node.js',
    '`process.platform` values plus `default`). The command is split on single spaces and started',
    'without a shell, in the implementation folder.', '',
    '- Requests arrive on standard input, one JSON object per line:',
    '  `{"id": <string>, "op": <string>, "input": <object>}`, plus any members named below.',
    '- For each line that is not blank the driver writes exactly one JSON object, as one line, to',
    '  standard output, in request order, with the request\'s `id`. Blank lines (empty, or only',
    '  spaces and tabs) get no response; whether other white space makes a line blank is open.',
    '- A response holds `id` and `result` (plus `audit` for operations that have one), or `id` and',
    '  `error`, and nothing else.',
    '- Standard output is UTF-8. Every line ends with LF (0x0A) and contains no CR (0x0D). Nothing',
    '  else is written to standard output; standard error is free.',
    '- After end of input and the last response, the driver exits with status 0.');
  const rm = requestMembersLine(ast);
  if (rm) out.push('', rm);
  if (ast.types.length) {
    out.push('', '### Types', '', 'Types named in this document (`number` is a JSON number, read as an IEEE 754 binary64 value; `{a: t, b?: t}` is an object with exactly these members, `b` optional, and `...` allows others; `t[]` is an array; `|` is either):', '');
    for (const t of ast.types) out.push(`- ${code(t.name)} = ${code(t.text)}`);
  }
  out.push('', '### Operations', '', '| op | input fields (required unless marked optional) | result | audit |', '|---|---|---|---|');
  for (const o of ast.ops) {
    const result = [o.returnsText ? code(o.returnsText) : '', o.summary].filter(Boolean).join('; ') || '—';
    out.push(`| ${code(o.name)} | ${o.inputs.map((f) => `${code(f.name)} (${f.type}${f.optional ? ', optional' : ''})`).join(', ') || '—'} | ${cell(result)} | ${o.audit ? 'yes' : 'no'} |`);
  }
  // Tolerances, grouped by operations that share the same ones.
  const groups = new Map();
  for (const o of ast.ops) {
    const t = Object.entries(o.tolerances).map(([p, v]) => `${code(p)} within ± ${v}`).join(' and ');
    if (t) groups.set(t, [...(groups.get(t) ?? []), code(o.name)]);
  }
  const tol = [...groups].map(([t, names]) => `for ${names.join(' and ')}, ${t}`);
  out.push('', `Results are compared as parsed JSON: member order does not matter, and numbers compare exactly${tol.length ? ` except ${tol.join('; ')}` : ''}.`);
  if (ast.ops.some((o) => o.audit)) out.push('The `audit` text is compared byte for byte.');
  if (ast.errors.length) {
    out.push('', '### Errors', '', 'A request that cannot be handled gets `{"id": <id>, "error": <code>}`. The checks run in this',
      'order, and the first that applies decides the response:', '');
    ast.errors.forEach((e, i) => out.push(`${i + 1}. ${code(e.code)} when ${e.when}`));
  }
  if (ast.edges.length) {
    out.push('', '## Edges', '', 'These definitions are shared across specifications and referenced by name.');
    for (const e of ast.edges) {
      const E = lib.defs.get(e.name);
      if (!E) continue;
      out.push('', `### ${e.name}: ${E.title}`, '', E.text);
      if (e.via) out.push('', `The suite checks this with ${E.pack.length} cases sent through ${code(e.via.op)} (${code(e.via.field)})${e.via.encoding === 'base64' ? ', which answers with the canonical bytes in base64' : ''}.`);
      if (e.decisions.length) out.push('', `Decisions: ${e.decisions.join(', ')}.`);
    }
  }
  out.push('');
  const shownProps = new Set();
  const shownEvidence = new Set();
  for (const item of ast.items) {
    if (item.type === 'section') { out.push('---', '', `## ${item.title}`, ''); if (item.text) out.push(item.text, ''); }
    else if (item.type === 'note') { out.push(item.text, ''); }
    else if (item.type === 'req') {
      const oneLine = !item.text.includes('\n');
      out.push(`**REQ-${item.id}.** *${item.title}.*${item.platform !== 'any' ? ` (${item.platform} only)` : ''} ${oneLine ? item.text : ''}`.trimEnd());
      if (!oneLine) out.push('', item.text);
      if (item.decisions.length) out.push('', `Decisions: ${item.decisions.join(', ')}.`);
      out.push(...renderExamples(item, oracle));
      if (item.statics.length) {
        out.push('', 'Checked on the implementation folder:');
        for (const st of item.statics) out.push(`- ${describeStatic(st)}.`);
      }
      out.push('');
      for (const ev of ast.evidence.filter((x) => x.supports.includes(item.id) && !shownEvidence.has(x.id))) { shownEvidence.add(ev.id); out.push(...renderEvidence(ev, oracle), ''); }
      for (const pr of ast.properties.filter((x) => x.supports.includes(item.id) && !shownProps.has(x.id))) { shownProps.add(pr.id); out.push(...renderProperty(pr, runOf(pr.id)), ''); }
    } else if (item.type === 'open') {
      out.push(`**OPEN-${item.id}.** *${item.title}.* ${item.text} (Open: implementations may differ; never tested.)`.trimEnd(), '');
    }
  }
  const restProps = ast.properties.filter((p) => !shownProps.has(p.id));
  const restEvidence = ast.evidence.filter((x) => !shownEvidence.has(x.id));
  if (restProps.length || restEvidence.length) {
    out.push('---', '', '## Other checks', '');
    for (const ev of restEvidence) out.push(...renderEvidence(ev, oracle), '');
    for (const pr of restProps) out.push(...renderProperty(pr, runOf(pr.id)), '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function renderDecisions(ast) {
  const reqs = ast.items.filter((i) => i.type === 'req');
  const out = [`# ${ast.spec.name}: decisions`, '', 'Why the specification says what it says. Each decision names where its claim came from.', ''];
  for (const x of ast.decisions) {
    out.push(`## ${x.id}: ${x.title}`, '');
    if (x.source) out.push(`- Source: ${x.source}`);
    if (x.status) out.push(`- Status: ${x.status}`);
    const by = [
      ...reqs.filter((r) => r.decisions.includes(x.id)).map((r) => `REQ-${r.id}`),
      ...ast.edges.filter((e) => e.decisions.includes(x.id)).map((e) => `edge ${e.name}`),
      ...ast.properties.filter((p) => p.decisions.includes(x.id)).map((p) => `PROP-${p.id}`),
      ...ast.evidence.filter((e) => e.decisions.includes(x.id)).map((e) => `EV-${e.id}`),
    ];
    if (by.length) out.push(`- Cited by: ${by.join(', ')}`);
    const waives = ast.evidence.flatMap((ev) => ev.waivers.filter((w) => w.decision === x.id).map((w) => `EV-${ev.id} row ${w.row}`));
    if (waives.length) out.push(`- Waives: ${waives.join(', ')}`);
    if (x.text) out.push('', x.text);
    if (x.rejected.length) out.push('', 'Rejected:', ...x.rejected.map((a) => `- ${a}`));
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}

export function renderTrace(ast, cases, corr = []) {
  const reqs = ast.items.filter((i) => i.type === 'req');
  const out = [`# ${ast.spec.name} ${ast.spec.version}: trace`, '', '| requirement | examples | evidence rows | properties | static | suite cases | decisions | backed by more than the oracle |', '|---|---|---|---|---|---|---|---|'];
  for (const r of reqs) {
    const n = cases.filter((c) => c.reqs.includes(`REQ-${r.id}`)).length;
    const c = corr.find((x) => x.id === r.id);
    out.push(`| REQ-${r.id} | ${r.examples.length} | ${c?.evidence ?? 0} | ${c?.properties ?? 0} | ${r.statics.length} | ${n} | ${r.decisions.join(', ') || '—'} | ${c ? (c.oracleOnly ? '**no**' : 'yes') : '—'} |`);
  }
  const edgeCases = ast.edges.map((e) => `| ${e.name} | ${e.via ? `${e.via.op}.${e.via.field}` : 'not bound'} | ${cases.filter((c) => c.reqs.includes(`EDGE ${e.name}`)).length} |`);
  if (edgeCases.length) out.push('', '| edge | bound to | suite cases |', '|---|---|---|', ...edgeCases);
  const opens = ast.items.filter((i) => i.type === 'open');
  if (opens.length) out.push('', `Open (never tested): ${opens.map((o) => `OPEN-${o.id}`).join(', ')}`);
  const kinds = {};
  for (const c of cases) kinds[c.kind ?? 'example'] = (kinds[c.kind ?? 'example'] ?? 0) + 1;
  out.push('', `Total suite cases: ${cases.length} (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}), plus 3 protocol cases in every run.`);
  return out.join('\n') + '\n';
}
