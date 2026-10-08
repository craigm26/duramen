// Parser for duramen source files (.duramen). Line-oriented and indentation-based:
// statements start in column 0, their clauses are indented two spaces, and prose (`text`),
// expectations (`expect`), table rows (`|`) and other continuation lines are indented four.
// The parser never throws on bad input: it returns { ast, diagnostics }, and every diagnostic
// has a file, a line and a column.
import { parseType } from './types.mjs';
import { parseExpr, namesOf, unknownFunctions } from './expr.mjs';

export const VERSIONS = ['0.1', '0.2'];
const TOP = new Set(['duramen', 'spec', 'oracle', 'type', 'edge', 'edgedef', 'section', 'op', 'errors', 'req', 'property', 'evidence', 'open', 'decision', 'note']);
// A number written as JSON writes one (no hex, no Infinity, no leading +), or NaN.
const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
export const jsonNumber = (text) => (JSON_NUMBER.test(text) ? Number(text) : NaN);
export const EVIDENCE_KINDS = ['published', 'derived', 'computed', 'measured', 'implementation', 'incident'];

export function parse(source, file = '<input>') {
  const diagnostics = [];
  const diag = (level, line, code, message, col = 1) => diagnostics.push({ level, file, line, col, code, message });
  const ast = {
    file, version: null, spec: null, oracle: null, types: [], edges: [], edgedefs: [], errors: [], ops: [],
    items: [], // sections, reqs, opens and notes, in source order
    decisions: [], properties: [], evidence: [],
  };
  try {
    parseInto(String(source), file, ast, diag);
  } catch (e) {
    diag('error', 1, 'P099', `internal parser error (please report): ${e?.message ?? e}`);
  }
  return { ast, diagnostics };
}

function parseInto(source, file, ast, diag) {
  const lines = source.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').split('\n');
  let section = null;
  let versionLine = null;

  // Split into top-level statements: [{ line, kw, rest, restCol, body: [{ n, indent, text }] }]
  const stmts = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const n = i + 1;
    // A line of white space only is blank, whatever its indent; it belongs to the statement
    // above it (prose keeps its paragraphs).
    if (raw.trim() === '') { stmts[stmts.length - 1]?.body.push({ n, indent: 0, text: '' }); continue; }
    const lead = raw.match(/^\s*/)[0];
    if (/[^ ]/.test(lead)) { diag('error', n, 'P001', 'indent with spaces only (no tabs or other white space)', lead.search(/[^ ]/) + 1); continue; }
    const indent = lead.length;
    const text = raw.slice(indent).replace(/\s+$/, '');
    if (indent === 0) {
      if (text.startsWith('#')) continue;
      const [kw] = text.split(/\s+/, 1);
      if (!TOP.has(kw)) { diag('error', n, 'P002', `unknown statement "${kw}"`); stmts.push({ line: n, kw: null, rest: '', body: [] }); continue; }
      const rest = text.slice(kw.length).trim();
      stmts.push({ line: n, kw, rest, restCol: text.length - rest.length + 1, body: [] });
    } else {
      const cur = stmts[stmts.length - 1];
      if (!cur) { diag('error', n, 'P003', 'indented line before any statement', indent + 1); continue; }
      cur.body.push({ n, indent, text });
    }
  }

  const unquote = (s, n, what, col = 1) => {
    const m = s.match(/^"((?:[^"\\]|\\.)*)"$/);
    if (!m) { diag('error', n, 'P004', `${what} must be a quoted string`, col); return s; }
    try { return JSON.parse(`"${m[1]}"`); } catch { diag('error', n, 'P004', `${what}: bad string escape`, col); return m[1]; }
  };
  const idAndTitle = (s, what) => {
    const m = s.rest.match(/^(\S+)\s+(".*")$/);
    if (!m) { diag('error', s.line, 'P005', `${what} needs an ID and a quoted title`, s.restCol); return { id: s.rest.split(/\s+/)[0] || '?', title: '' }; }
    return { id: m[1], title: unquote(m[2], s.line, 'title', s.restCol + m[1].length + 1) };
  };
  const ids = (text) => text.split(/[\s,]+/).filter(Boolean);

  // Clauses inside a statement body. Indent 2 starts a clause; deeper lines belong to it.
  function clauses(body) {
    const out = [];
    for (const l of body) {
      if (l.indent === 2) {
        if (l.text.startsWith('#')) continue;
        const [kw] = l.text.split(/\s+/, 1);
        const rest = l.text.slice(kw.length).trim();
        out.push({ n: l.n, kw, rest, col: 3, restCol: 3 + l.text.length - rest.length, sub: [] });
      } else if (l.indent > 2 || l.text === '') {
        const cur = out[out.length - 1];
        if (!cur) { if (l.text !== '') diag('error', l.n, 'P006', 'indented line belongs to no clause', l.indent + 1); continue; }
        cur.sub.push(l);
      } else {
        diag('error', l.n, 'P007', 'clauses are indented two spaces', l.indent + 1);
      }
    }
    return out;
  }
  // Prose under a `text` clause: lines indented four or more, blank lines kept, indent 4 removed.
  const prose = (c) => {
    if (c.rest) diag('error', c.n, 'P008', 'text starts on the next line, indented four spaces', c.restCol);
    for (const l of c.sub) if (l.text !== '' && l.indent < 4) diag('error', l.n, 'P008', 'text is indented four spaces', l.indent + 1);
    const ls = c.sub.map((l) => (l.text === '' ? '' : ' '.repeat(Math.max(0, l.indent - 4)) + l.text));
    while (ls.length && ls[ls.length - 1] === '') ls.pop();
    while (ls.length && ls[0] === '') ls.shift();
    return ls.join('\n');
  };
  const contLines = (c) => c.sub.filter((l) => l.text !== '' && !l.text.startsWith('#'));

  function parseJSON(s, n, what, col = 1) {
    try { return { ok: true, value: JSON.parse(s) }; } catch (e) {
      const at = e.message.match(/position (\d+)/);
      diag('error', n, 'P009', `${what} is not valid JSON: ${e.message}`, col + (at ? Number(at[1]) : 0));
      return { ok: false };
    }
  }
  // `request <json object>` under spec or op: members every request carries.
  function requestObject(c) {
    const j = parseJSON(c.rest, c.n, 'request members', c.restCol);
    if (!j.ok) return null;
    if (j.value === null || typeof j.value !== 'object' || Array.isArray(j.value)) { diag('error', c.n, 'P009', 'request members are a JSON object', c.restCol); return null; }
    if (!ownMembersOk(j.value, c.n, c.restCol)) return null;
    return j.value;
  }
  // `id`, `op` and `input` are the example's own; request members cannot set them.
  function ownMembersOk(members, n, col) {
    const own = Object.keys(members).filter((k) => ['id', 'op', 'input'].includes(k));
    if (own.length) diag('error', n, 'P051', `request members cannot set ${own.join(', ')}: the example's own (use omit to leave one out, or a raw example)`, col);
    return !own.length;
  }
  function typeOf(text, n, col, what) {
    const r = parseType(text);
    if (r.error) { diag('error', n, 'P024', `${what}: ${r.error}`, col + (r.at ?? 0)); return null; }
    return r.type;
  }
  function exprOf(text, n, col, what) {
    const r = parseExpr(text);
    if (r.error) { diag('error', n, 'P025', `${what}: ${r.error}`, col + (r.at ?? 0)); return null; }
    const bad = unknownFunctions(r.ast);
    if (bad.length) diag('error', n, 'P025', `${what}: unknown function ${bad[0]}`, col);
    return r.ast;
  }

  // expect <path> = <json>   |   expect <path> ≈ <number> ± <tol>   (ASCII: ~ and +-)
  // expect <path> = ?         the value is the oracle's: shown in the brief, checked by the suite
  function expectation(text, n, col) {
    if (/^expect\s+\S+\s*=\s*\?$/.test(text)) return { path: text.match(/^expect\s+(\S+)/)[1], kind: 'show', line: n };
    let m = text.match(/^expect\s+(\S+)\s*(?:≈|~)\s*(\S+)\s*(?:±|\+-)\s*(\S+)$/);
    if (m) {
      const v = jsonNumber(m[2]); const tol = jsonNumber(m[3]);
      if (!Number.isFinite(v) || !Number.isFinite(tol) || tol < 0) { diag('error', n, 'P010', 'approximate expectation needs finite numbers and a tolerance of 0 or more', col); return null; }
      return { path: m[1], kind: 'approx', value: v, tol, line: n };
    }
    m = text.match(/^expect\s+(\S+)\s*=\s*(.+)$/);
    if (m) { const j = parseJSON(m[2], n, 'expected value', col + text.indexOf(m[2])); return j.ok ? { path: m[1], kind: 'eq', value: j.value, line: n } : null; }
    diag('error', n, 'P011', 'expect <path> = <json>, or expect <path> ≈ <number> ± <tolerance>', col);
    return null;
  }

  // Markdown-style table rows: header cells name input fields or expectation paths (a path may
  // carry "± <tolerance>"); an empty cell states nothing; `?` asks the oracle.
  const cells = (l) => l.text.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((x) => x.trim().replace(/\\\|/g, '|'));
  const isExpectPath = (name) => /^(result|audit|error|id)(\.|$)/.test(name);
  function tableRows(c, op, from) {
    for (const l of c.sub) if (l.text !== '' && !l.text.startsWith('#') && !l.text.startsWith('|')) diag('error', l.n, 'P006', 'a line under a table is a row, starting with |', l.indent + 1);
    // A separator row (|---|:--:|) after the header is not a row.
    const rows = c.sub.filter((l) => l.text.startsWith('|')).filter((l, i) => i === 0 || !/^\|[\s|:-]+\|$/.test(l.text));
    if (!op || /\s/.test(op) || rows.length < 2) { diag('error', c.n, 'P013', 'table <op>, then a header row and at least one row', c.restCol); return []; }
    const header = cells(rows[0]).map((h) => {
      const hm = h.match(/^(\S+)(?:\s*(?:±|\+-)\s*(\S+))?$/);
      return hm ? { name: hm[1], tol: hm[2] === undefined ? null : jsonNumber(hm[2]) } : { name: h, tol: null };
    });
    if (header.some((h) => h.name === '')) { diag('error', rows[0].n, 'P013', 'every header cell names an input field or an expectation path', rows[0].indent + 1); return []; }
    for (const h of header) {
      if (h.tol === null) continue;
      if (!isExpectPath(h.name)) diag('error', rows[0].n, 'P010', `column "${h.name}": only an expectation column takes a tolerance`, rows[0].indent + 1);
      else if (!(Number.isFinite(h.tol) && h.tol >= 0)) diag('error', rows[0].n, 'P010', `column "${h.name}": a tolerance is a number of 0 or more`, rows[0].indent + 1);
    }
    const out = [];
    for (const l of rows.slice(1)) {
      const vals = cells(l);
      if (vals.length !== header.length) { diag('error', l.n, 'P014', `row has ${vals.length} cells, header has ${header.length}`, l.indent + 1); continue; }
      const ex = { op, input: {}, raw: null, request: null, omit: [], expects: [], line: l.n, from };
      const rawFields = [];
      let ok = true;
      header.forEach((h, i) => {
        if (vals[i] === '') return; // an empty cell states nothing: no input field, no expectation
        if (isExpectPath(h.name) && vals[i] === '?') { ex.expects.push({ path: h.name, kind: 'show', line: l.n }); return; }
        const j = parseJSON(vals[i], l.n, `cell "${h.name}"`, l.indent + 1);
        if (!j.ok) { ok = false; return; }
        if (isExpectPath(h.name)) {
          if (h.tol !== null && typeof j.value !== 'number') { diag('error', l.n, 'P010', `cell "${h.name}": a column with a tolerance holds numbers`, l.indent + 1); ok = false; return; }
          ex.expects.push(h.tol !== null ? { path: h.name, kind: 'approx', value: j.value, tol: h.tol, line: l.n } : { path: h.name, kind: 'eq', value: j.value, line: l.n });
        } else { ex.input[h.name] = j.value; rawFields.push(`${JSON.stringify(h.name)}:${vals[i]}`); }
      });
      ex.raw = `{${rawFields.join(',')}}`;
      ex.rawFields = Object.fromEntries(header.map((h, i) => [h.name, vals[i]]).filter(([k, v]) => v !== '' && k in ex.input));
      if (ok) out.push(ex);
    }
    return out;
  }

  // Examples keep the input exactly as written (`raw`), so spellings such as 2.0e1 or -0 reach
  // the oracle and the implementation unchanged; `input` is the parsed value, for checking.
  //   example <op> <json object>     a request with that input
  //   example <op>                   a request with no `input` member at all
  //   example raw "<line>"           exactly this request line (for lines that are not a
  //   example raw '<line>'           well-formed request); sent on its own, in its own run
  // Under an example: `request <json>` adds or replaces request members, `omit <a>, <b>`
  // leaves members out, and `expect` lines state what the response holds.
  // input paths: names separated by dots; a name is a word or a JSON string ("s.duramen")
  function inputPath(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] === '"') {
        const m = text.slice(i).match(/^"(?:[^"\\]|\\.)*"/);
        if (!m) return null;
        try { out.push(JSON.parse(m[0])); } catch { return null; }
        i += m[0].length;
      } else {
        const m = text.slice(i).match(/^[\w-]+/);
        if (!m) return null;
        out.push(m[0]);
        i += m[0].length;
      }
      if (i < text.length) { if (text[i] !== '.') return null; i++; if (i === text.length) return null; }
    }
    return out.length ? out : null;
  }
  // Put text at a path in the example's input; the request is then written as JSON.stringify of
  // the input, so the input's own spelling is not kept.
  function setInput(ex, path, text, n) {
    if (ex.noInput) { ex.noInput = false; ex.input = {}; }
    let o = ex.input;
    for (const key of path.slice(0, -1)) {
      if (o[key] === undefined) o[key] = {};
      if (o[key] === null || typeof o[key] !== 'object' || Array.isArray(o[key])) { diag('error', n, 'P049', `input ${path.join('.')}: ${key} is not an object`); return; }
      o = o[key];
    }
    o[path[path.length - 1]] = text;
    ex.raw = JSON.stringify(ex.input);
    (ex.inputBlocks ??= []).push(path);
  }

  function example(c) {
    let ex;
    const rm = c.rest.match(/^raw\s+(".*")$/) ?? c.rest.match(/^raw\s+'(.*)'$/);
    if (rm) {
      const rawLine = rm[1].startsWith('"') ? unquote(rm[1], c.n, 'raw request line', c.restCol + 4) : rm[1];
      if (rawLine.includes('\n')) { diag('error', c.n, 'P026', 'a raw request line cannot contain a line break', c.restCol); return null; }
      ex = { op: null, input: {}, raw: null, rawLine, request: null, omit: [], expects: [], line: c.n, from: 'example' };
    } else {
      const m = c.rest.match(/^(\S+)(?:\s+(.+))?$/);
      if (!m) { diag('error', c.n, 'P012', 'example <op> [<json input>], or example raw "<request line>"', c.restCol); return null; }
      if (m[2] === undefined) ex = { op: m[1], input: {}, raw: null, noInput: true, request: null, omit: [], expects: [], line: c.n, from: 'example' };
      else {
        const j = parseJSON(m[2], c.n, 'example input', c.restCol + m[1].length + 1);
        if (!j.ok) return null;
        if (j.value === null || typeof j.value !== 'object' || Array.isArray(j.value)) { diag('error', c.n, 'P012', 'an example input is a JSON object', c.restCol + m[1].length + 1); return null; }
        ex = { op: m[1], input: j.value, raw: m[2], request: null, omit: [], expects: [], line: c.n, from: 'example' };
      }
    }
    // Lines under the example, in order. `input <path>` starts a block of text, the lines after
    // it indented six or more (blank lines kept), which becomes the value at <path> in the
    // input; `input <path> from "<file>"` takes the text of a file next to this one instead.
    const sub = c.sub;
    for (let k = 0; k < sub.length; k++) {
      const l = sub[k];
      if (l.text === '' || l.text.startsWith('#')) continue;
      const im = l.indent === 4 ? l.text.match(/^input\s+(.+?)(?:\s+from\s+("(?:[^"\\]|\\.)*"))?$/) : null;
      if (im) {
        // The text of a block is taken first, so that a bad input line does not make its text
        // look like lines of the example.
        const block = [];
        if (!im[2]) {
          while (k + 1 < sub.length && (sub[k + 1].text === '' || sub[k + 1].indent >= 6)) { k++; block.push(sub[k].text === '' ? '' : ' '.repeat(sub[k].indent - 6) + sub[k].text); }
          while (block.length && block[block.length - 1] === '') block.pop();
        }
        if (ex.rawLine !== undefined) { diag('error', l.n, 'P022', 'a raw example is sent exactly as written: no input lines', l.indent + 1); continue; }
        const path = inputPath(im[1]);
        if (!path) { diag('error', l.n, 'P049', 'input <path>: names separated by dots, each a word or a "quoted string"', l.indent + 7); continue; }
        if (im[2]) { (ex.inputFiles ??= []).push({ path, file: JSON.parse(im[2]), line: l.n }); continue; }
        if (!block.length) { diag('error', l.n, 'P049', 'input <path> needs its text on the next lines, indented six spaces', l.indent + 1); continue; }
        setInput(ex, path, block.join('\n') + '\n', l.n);
        continue;
      }
      if (l.indent !== 4) { diag('error', l.n, 'P006', 'lines under an example are indented four spaces (the text of an input block, six)', l.indent + 1); continue; }
      if (l.text.startsWith('request ') || l.text.startsWith('omit ')) {
        if (ex.rawLine !== undefined) { diag('error', l.n, 'P022', 'a raw example is sent exactly as written: no request or omit lines', l.indent + 1); continue; }
        if (l.text.startsWith('omit ')) { ex.omit.push(...ids(l.text.slice(5))); continue; }
        const r = parseJSON(l.text.slice(8), l.n, 'request members', l.indent + 9);
        if (r.ok) {
          if (r.value === null || typeof r.value !== 'object' || Array.isArray(r.value)) diag('error', l.n, 'P009', 'request members are a JSON object', l.indent + 9);
          else if (ownMembersOk(r.value, l.n, l.indent + 9)) ex.request = r.value;
        }
        continue;
      }
      const e = expectation(l.text, l.n, l.indent + 1);
      if (e) ex.expects.push(e);
    }
    return ex;
  }

  // static checks on an implementation folder (evaluated by `duramen run`, not by the driver):
  //   static file "<glob>"[, ...] exists | absent
  //   static lines "<glob>"[, ...] at most <n> [excluding "<glob>", ...]
  //   static json "<file>" matches <type>
  //   static command <REGEN.json key> exits 0 [within <seconds>]
  //   static text "<glob>"[, ...] not matching "<regex>"
  function staticCheck(c) {
    const s = c.rest;
    const globs = (t) => { try { const v = JSON.parse(`[${t}]`); return Array.isArray(v) && v.length && v.every((x) => typeof x === 'string') ? v : null; } catch { return null; } };
    let m = s.match(/^file\s+(.+?)\s+(exists|absent)$/);
    if (m) { const g = globs(m[1]); if (g) return { kind: m[2] === 'exists' ? 'exists' : 'absent', globs: g, line: c.n }; }
    m = s.match(/^lines\s+(.+?)\s+at most\s+(\d+)(?:\s+excluding\s+(.+))?$/);
    if (m) { const g = globs(m[1]); const x = m[3] ? globs(m[3]) : []; if (g && x) return { kind: 'lines', globs: g, max: Number(m[2]), exclude: x, line: c.n }; }
    m = s.match(/^json\s+("(?:[^"\\]|\\.)*")\s+matches\s+(.+)$/);
    if (m) { const t = typeOf(m[2], c.n, c.restCol + s.indexOf(m[2]), 'static json'); return t ? { kind: 'json', target: JSON.parse(m[1]), type: t, typeText: m[2], line: c.n } : null; }
    m = s.match(/^command\s+(\S+)\s+exits\s+0(?:\s+within\s+(\d+))?$/);
    if (m) return { kind: 'command', key: m[1], within: m[2] ? Number(m[2]) : 300, line: c.n };
    m = s.match(/^text\s+(.+?)\s+not matching\s+("(?:[^"\\]|\\.)*")$/);
    if (m) {
      const g = globs(m[1]);
      let re = null;
      try { re = JSON.parse(m[2]); new RegExp(re, 'u'); } catch (e) { diag('error', c.n, 'P027', `static text: bad pattern: ${e.message}`, c.restCol); return null; }
      if (g) return { kind: 'text', globs: g, pattern: re, line: c.n };
    }
    diag('error', c.n, 'P027', 'static file "<glob>" exists|absent | lines "<glob>" at most <n> [excluding "<glob>"] | json "<file>" matches <type> | command <key> exits 0 [within <s>] | text "<glob>" not matching "<re>"', c.restCol);
    return null;
  }

  for (const s of stmts) {
    if (!s.kw) continue;
    try {
      statement(s);
    } catch (e) {
      diag('error', s.line, 'P099', `internal parser error in ${s.kw} (please report): ${e?.message ?? e}`);
    }
  }

  function statement(s) {
    const cs = clauses(s.body);
    // Only text, example and table clauses, and the clauses of errors (whose conditions may
    // continue), take indented lines; under any other clause such a line belongs to nothing.
    if (s.kw !== 'errors') for (const c of cs) if (!['text', 'example', 'table'].includes(c.kw)) for (const l of c.sub) if (l.text !== '' && !l.text.startsWith('#')) diag('error', l.n, 'P006', `${c.kw} takes no indented lines`, l.indent + 1);
    const only = (allowed) => { for (const c of cs) if (!allowed.includes(c.kw)) diag('error', c.n, 'P015', `"${c.kw}" is not a clause of ${s.kw}`, c.col); };
    const textOf = () => { const c = cs.find((x) => x.kw === 'text'); return c ? prose(c) : ''; };
    switch (s.kw) {
      case 'duramen':
        if (versionLine) diag('error', s.line, 'P023', `the version is stated twice (first at line ${versionLine})`);
        else { versionLine = s.line; ast.version = s.rest; }
        if (!VERSIONS.includes(s.rest)) diag('error', s.line, 'P023', `duramen ${s.rest} is not a version this tool reads (${VERSIONS.join(', ')})`, s.restCol);
        only([]);
        break;
      case 'spec': {
        if (ast.spec) diag('error', s.line, 'P044', `a second spec statement (the first is at line ${ast.spec.line})`);
        const [name, version, extra] = s.rest.split(/\s+/);
        if (!name || !version || extra) diag('error', s.line, 'P021', 'spec <name> <version>', s.restCol);
        const spec = { name: name ?? '?', version: version ?? '?', title: '', contract: null, text: '', request: {}, line: s.line };
        for (const c of cs) {
          if (c.kw === 'title') spec.title = unquote(c.rest, c.n, 'title', c.restCol);
          else if (c.kw === 'contract') spec.contract = c.rest;
          else if (c.kw === 'request') { const j = requestObject(c); if (j) spec.request = j; }
          else if (c.kw === 'text') spec.text = prose(c);
          else diag('error', c.n, 'P015', `"${c.kw}" is not a clause of spec`, c.col);
        }
        ast.spec ??= spec;
        break;
      }
      case 'oracle': {
        if (ast.oracle) diag('error', s.line, 'P044', `a second oracle (the first is at line ${ast.oracle.line})`);
        if (!s.rest) { diag('error', s.line, 'P028', 'oracle <command>', s.restCol); break; }
        const oracle = { command: s.rest, sources: [], line: s.line };
        for (const c of cs) {
          if (c.kw === 'source') oracle.sources.push(...ids(c.rest));
          else diag('error', c.n, 'P015', `"${c.kw}" is not a clause of oracle`, c.col);
        }
        ast.oracle ??= oracle;
        break;
      }
      case 'type': {
        const m = s.rest.match(/^([A-Za-z_][\w-]*)\s*=\s*(.+)$/);
        if (!m) { diag('error', s.line, 'P029', 'type <name> = <type>', s.restCol); break; }
        const t = typeOf(m[2], s.line, s.restCol + s.rest.indexOf(m[2]), `type ${m[1]}`);
        if (t) ast.types.push({ name: m[1], type: t, text: m[2], line: s.line });
        only([]);
        break;
      }
      case 'edge': {
        // edge <name> [via <op> <input field> [base64]]: base64 when the op answers with the
        // canonical bytes in base64 rather than as text.
        const m = s.rest.match(/^(\S+)(?:\s+via\s+(\S+)\s+(\S+)(?:\s+(base64))?)?$/);
        if (!m) { diag('error', s.line, 'P016', 'edge <name> [via <op> <input field> [base64]]', s.restCol); break; }
        const edge = { name: m[1], via: m[2] ? { op: m[2], field: m[3], encoding: m[4] ?? 'text' } : null, decisions: [], line: s.line };
        for (const c of cs) {
          if (c.kw === 'decision') edge.decisions.push(...ids(c.rest));
          else diag('error', c.n, 'P015', `"${c.kw}" is not a clause of edge`, c.col);
        }
        ast.edges.push(edge);
        break;
      }
      case 'edgedef': {
        // edgedef <name> "<title>"; family <names>; text; item <raw json> => <text> | item <raw json> refused
        const { id: name, title } = idAndTitle(s, 'edgedef');
        const def = { name, title, family: [], text: '', pack: [], line: s.line };
        for (const c of cs) {
          if (c.kw === 'family') def.family.push(...ids(c.rest));
          else if (c.kw === 'text') def.text = prose(c);
          else if (c.kw === 'item') {
            const refused = c.rest.match(/^(.+?)\s+refused$/);
            const src = refused ? refused[1] : null;
            if (src !== null) {
              const j = parseJSON(src, c.n, 'pack input', c.restCol);
              if (j.ok) def.pack.push({ input: src, refuse: true, line: c.n });
              continue;
            }
            // The input is the shortest prefix before " => " (the expected text follows as written)
            // or " escaped " (the expected text follows as a JSON string, for invisible
            // characters) that is valid JSON.
            let found = false;
            const seps = [' => ', ' escaped '];
            const cands = seps.flatMap((sep) => { const at = []; for (let k = c.rest.indexOf(sep); k >= 0; k = c.rest.indexOf(sep, k + 1)) at.push([k, sep]); return at; }).sort((a, b) => a[0] - b[0]);
            for (const [k, sep] of cands) {
              const input = c.rest.slice(0, k);
              try { JSON.parse(input); } catch { continue; }
              let text = c.rest.slice(k + sep.length);
              if (sep === ' escaped ') {
                try { text = JSON.parse(text); } catch { text = null; }
                if (typeof text !== 'string') { diag('error', c.n, 'P030', 'item <json input> escaped <JSON string>: the expected text is a JSON string', c.restCol + k + sep.length); found = true; break; }
              }
              def.pack.push({ input, text, line: c.n });
              found = true;
              break;
            }
            if (!found) diag('error', c.n, 'P030', 'item <json input> => <expected text>, item <json input> escaped <JSON string>, or item <json input> refused', c.restCol);
          } else diag('error', c.n, 'P015', `"${c.kw}" is not a clause of edgedef`, c.col);
        }
        ast.edgedefs.push(def);
        break;
      }
      case 'section': {
        const { id, title } = idAndTitle(s, 'section');
        only(['text']);
        section = { type: 'section', id, title, text: textOf(), line: s.line };
        ast.items.push(section);
        break;
      }
      case 'op': {
        if (!/^\S+$/.test(s.rest)) { diag('error', s.line, 'P031', 'op <name>', s.restCol); break; }
        const op = { name: s.rest, inputs: [], returns: null, returnsText: null, tolerances: {}, audit: null, summary: '', request: null, line: s.line };
        for (const c of cs) {
          if (c.kw === 'request') { const j = requestObject(c); if (j) op.request = j; continue; }
          if (c.kw === 'input') {
            // name[?] <type>, ... ; commas inside braces, brackets, parens or quotes do not split
            for (const { text: f, at } of splitTop(c.rest)) {
              const fm = f.match(/^([\w-]+)(\?)?\s+(.+)$/);
              if (!fm) { diag('error', c.n, 'P017', `input field "${f}": <name>[?] <type>`, c.restCol + at); continue; }
              const pt = parseType(fm[3]);
              op.inputs.push({ name: fm[1], optional: !!fm[2], type: fm[3], parsed: pt.error ? null : pt.type, typeError: pt.error ?? null, line: c.n, col: c.restCol + at });
            }
          } else if (c.kw === 'returns') {
            op.returns = typeOf(c.rest, c.n, c.restCol, `returns of ${op.name}`);
            op.returnsText = c.rest;
          } else if (c.kw === 'tolerance') {
            const tm = c.rest.match(/^(\S+)\s+(\S+)$/);
            if (!tm || !Number.isFinite(jsonNumber(tm[2])) || jsonNumber(tm[2]) < 0) diag('error', c.n, 'P018', 'tolerance <result path> <number of 0 or more>', c.restCol);
            else op.tolerances[tm[1]] = jsonNumber(tm[2]);
          } else if (c.kw === 'audit') op.audit = c.rest || 'text';
          else if (c.kw === 'result') op.summary = c.rest;
          else diag('error', c.n, 'P015', `"${c.kw}" is not a clause of op`, c.col);
        }
        ast.ops.push(op);
        break;
      }
      case 'errors': {
        // One "<code> when <condition>" per clause, first match wins; a condition may continue
        // on lines indented four.
        if (s.rest) diag('error', s.line, 'P050', 'errors takes nothing after the keyword', s.restCol);
        if (ast.errorsLine !== undefined) diag('error', s.line, 'P032', `errors is declared once (it is the order in which checks run; the first is at line ${ast.errorsLine})`);
        else ast.errorsLine = s.line;
        for (const c of cs) {
          const m = (c.kw + ' ' + c.rest).match(/^(\S+)\s+when\s+(.+)$/);
          if (!m) { diag('error', c.n, 'P019', 'errors: one "<code> when <condition>" per line, first match wins', c.col); continue; }
          const more = c.sub.map((l) => l.text).filter((t) => t !== '');
          ast.errors.push({ code: m[1], when: [m[2], ...more].join(' '), line: c.n });
        }
        break;
      }
      case 'req': {
        const { id, title } = idAndTitle(s, 'req');
        const req = { type: 'req', id, title, section: section?.id ?? null, decisions: [], platform: 'any', text: '', textLine: null, examples: [], statics: [], line: s.line };
        for (const c of cs) {
          if (c.kw === 'text') { req.text = prose(c); req.textLine = c.n; }
          else if (c.kw === 'decision') req.decisions.push(...ids(c.rest));
          else if (c.kw === 'on') {
            if (!['any', 'posix', 'windows'].includes(c.rest)) diag('error', c.n, 'P033', 'on any | posix | windows', c.restCol);
            req.platform = c.rest;
          } else if (c.kw === 'example') { const ex = example(c); if (ex) req.examples.push(ex); }
          else if (c.kw === 'table') req.examples.push(...tableRows(c, c.rest.trim(), 'table'));
          else if (c.kw === 'static') { const st = staticCheck(c); if (st) req.statics.push(st); }
          else diag('error', c.n, 'P015', `"${c.kw}" is not a clause of req`, c.col);
        }
        ast.items.push(req);
        break;
      }
      case 'property': {
        // property <id> "<title>"; supports; decision; for <var> in <generator>; where; samples;
        // seed; call <name> = <op> <expr>; expect <expr>; text
        const { id, title } = idAndTitle(s, 'property');
        const pr = { id, title, supports: [], decisions: [], vars: [], where: [], samples: 100, seed: null, calls: [], expects: [], text: '', section: section?.id ?? null, line: s.line };
        for (const c of cs) {
          if (c.kw === 'supports') pr.supports.push(...ids(c.rest));
          else if (c.kw === 'decision') pr.decisions.push(...ids(c.rest));
          else if (c.kw === 'text') pr.text = prose(c);
          else if (c.kw === 'samples' || c.kw === 'seed') {
            const v = Number(c.rest);
            if (!Number.isInteger(v) || v < (c.kw === 'samples' ? 1 : 0) || v > (c.kw === 'samples' ? 100000 : 0xffffffff)) diag('error', c.n, 'P034', `${c.kw} <whole number>`, c.restCol);
            else pr[c.kw] = v;
          } else if (c.kw === 'for') {
            const m = c.rest.match(/^([A-Za-z_]\w*)\s+in\s+(.+)$/);
            if (!m) { diag('error', c.n, 'P035', 'for <name> in <lo> .. <hi> | int <lo> .. <hi> | one of <json>, ... | json | <type>', c.restCol); continue; }
            const g = generator(m[2], c.n, c.restCol + c.rest.indexOf(m[2]));
            if (g) pr.vars.push({ name: m[1], gen: g, line: c.n });
          } else if (c.kw === 'where') { const e = exprOf(c.rest, c.n, c.restCol, 'where'); if (e) pr.where.push({ ast: e, text: c.rest, line: c.n }); }
          else if (c.kw === 'call') {
            const m = c.rest.match(/^([A-Za-z_]\w*)\s*=\s*(\S+)\s+(.+)$/);
            if (!m) { diag('error', c.n, 'P036', 'call <name> = <op> <input expression>', c.restCol); continue; }
            const e = exprOf(m[3], c.n, c.restCol + c.rest.indexOf(m[3]), 'call input');
            if (e) pr.calls.push({ name: m[1], op: m[2], input: e, inputText: m[3], line: c.n });
          } else if (c.kw === 'expect') { const e = exprOf(c.rest, c.n, c.restCol, 'expect'); if (e) pr.expects.push({ ast: e, text: c.rest, line: c.n }); }
          else diag('error', c.n, 'P015', `"${c.kw}" is not a clause of property`, c.col);
        }
        // every name an expression reads is a variable or an earlier call
        const bound = new Set(pr.vars.map((v) => v.name));
        for (const w of pr.where) for (const nm of namesOf(w.ast)) if (!bound.has(nm)) diag('error', w.line, 'P037', `"${nm}" is not a variable of ${id}`, 3);
        for (const call of pr.calls) {
          for (const nm of namesOf(call.input)) if (!bound.has(nm)) diag('error', call.line, 'P037', `"${nm}" is not a variable or an earlier call of ${id}`, 3);
          if (bound.has(call.name)) diag('error', call.line, 'P037', `"${call.name}" is already a name in ${id}`, 3);
          bound.add(call.name);
        }
        for (const e of pr.expects) for (const nm of namesOf(e.ast)) if (!bound.has(nm)) diag('error', e.line, 'P037', `"${nm}" is not a variable or a call of ${id}`, 3);
        if (!pr.calls.length) diag('error', s.line, 'P038', `${id} makes no call`);
        if (!pr.expects.length) diag('error', s.line, 'P038', `${id} expects nothing`);
        if (pr.seed === null) pr.seed = undefined; // derived from the ID when the property runs
        ast.properties.push(pr);
        break;
      }
      case 'evidence': {
        // evidence <id> "<title>"; source; kind; supports; decision; text;
        // table <op> (inline rows) | table <op> from "<file>" (with columns/expect/id lines);
        // waive <row id> because <decision id>
        const { id, title } = idAndTitle(s, 'evidence');
        const ev = { id, title, source: null, kind: null, supports: [], decisions: [], text: '', tables: [], waivers: [], line: s.line };
        for (const c of cs) {
          if (c.kw === 'source') ev.source = c.rest;
          else if (c.kw === 'kind') {
            const [k, ...detail] = c.rest.split(/\s+/);
            if (!EVIDENCE_KINDS.includes(k)) diag('error', c.n, 'P039', `kind is one of ${EVIDENCE_KINDS.join(', ')}`, c.restCol);
            ev.kind = k; ev.kindDetail = detail.join(' ');
          } else if (c.kw === 'supports') ev.supports.push(...ids(c.rest));
          else if (c.kw === 'decision') ev.decisions.push(...ids(c.rest));
          else if (c.kw === 'text') ev.text = prose(c);
          else if (c.kw === 'waive') {
            const m = c.rest.match(/^(\S+)\s+because\s+(\S+)$/);
            if (!m) diag('error', c.n, 'P040', 'waive <row id> because <decision id>', c.restCol);
            else ev.waivers.push({ row: m[1], decision: m[2], line: c.n });
          } else if (c.kw === 'table') {
            const m = c.rest.match(/^(\S+)(?:\s+from\s+("(?:[^"\\]|\\.)*"))?$/);
            if (!m) { diag('error', c.n, 'P041', 'table <op> [from "<file>"]', c.restCol); continue; }
            if (!m[2]) { ev.tables.push({ op: m[1], line: c.n, rows: tableRows(c, m[1], 'evidence') }); continue; }
            const t = { op: m[1], file: JSON.parse(m[2]), line: c.n, columns: [], expects: [], idColumn: null };
            for (const l of contLines(c)) {
              let mm;
              if ((mm = l.text.match(/^columns\s+(.+)$/))) {
                for (const { text: part } of splitTop(mm[1])) {
                  const pm = part.match(/^([\w-]+)\s*=\s*([\w.-]+)(?:\s+as\s+(string|json))?$/);
                  if (!pm) { diag('error', l.n, 'P042', `columns: <input field> = <column> [as string|json], got "${part}"`, l.indent + 1); continue; }
                  t.columns.push({ field: pm[1], column: pm[2], as: pm[3] ?? 'json' });
                }
              } else if ((mm = l.text.match(/^expect\s+(\S+)\s*(?:≈|~)\s*([\w.-]+)\s*(?:±|\+-)\s*([\w.+-]+)$/))) {
                t.expects.push({ path: mm[1], kind: 'approx', column: mm[2], tol: mm[3] });
              } else if ((mm = l.text.match(/^expect\s+(\S+)\s*=\s*([\w.-]+)(?:\s+as\s+(string|json))?$/))) {
                t.expects.push({ path: mm[1], kind: 'eq', column: mm[2], as: mm[3] ?? 'json' });
              } else if ((mm = l.text.match(/^id\s+([\w.-]+)$/))) {
                t.idColumn = mm[1];
              } else diag('error', l.n, 'P042', 'under table ... from: columns <field> = <column>, expect <path> = <column>, expect <path> ≈ <column> ± <column or number>, id <column>', l.indent + 1);
            }
            if (!t.columns.length) diag('error', c.n, 'P042', 'a table from a file needs a columns line', c.restCol);
            ev.tables.push(t);
          } else diag('error', c.n, 'P015', `"${c.kw}" is not a clause of evidence`, c.col);
        }
        if (!ev.source) diag('error', s.line, 'P043', `evidence ${id} needs a source: where the values came from`);
        if (!ev.kind) diag('error', s.line, 'P043', `evidence ${id} needs a kind (${EVIDENCE_KINDS.join(', ')})`);
        ast.evidence.push(ev);
        break;
      }
      case 'open': {
        const { id, title } = idAndTitle(s, 'open');
        only(['text', 'example', 'table']);
        const exampleLines = cs.filter((c) => c.kw === 'example' || c.kw === 'table').map((c) => c.n); // T003, in check
        ast.items.push({ type: 'open', id, title, section: section?.id ?? null, text: textOf(), exampleLines, line: s.line });
        break;
      }
      case 'decision': {
        const { id, title } = idAndTitle(s, 'decision');
        const d = { id, title, source: null, status: null, text: '', rejected: [], line: s.line };
        for (const c of cs) {
          if (c.kw === 'source') d.source = c.rest;
          else if (c.kw === 'status') d.status = c.rest;
          else if (c.kw === 'text') d.text = prose(c);
          else if (c.kw === 'rejected') d.rejected.push(unquote(c.rest, c.n, 'rejected alternative', c.restCol));
          else diag('error', c.n, 'P015', `"${c.kw}" is not a clause of decision`, c.col);
        }
        ast.decisions.push(d);
        break;
      }
      case 'note': {
        if (s.rest) diag('error', s.line, 'P050', 'note takes nothing after the keyword', s.restCol);
        only(['text']);
        ast.items.push({ type: 'note', section: section?.id ?? null, text: textOf(), line: s.line });
        break;
      }
    }
  }

  // A generator for a property variable.
  function generator(text, n, col) {
    let m;
    if ((m = text.match(/^(int\s+)?(-?[\d.eE+-]+)\s*\.\.\s*(-?[\d.eE+-]+)$/))) {
      const lo = Number(m[2]), hi = Number(m[3]);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) { diag('error', n, 'P035', 'a range needs finite lo <= hi', col); return null; }
      return m[1] ? { kind: 'type', type: { kind: 'integer', range: [lo, hi] }, text } : { kind: 'type', type: { kind: 'number', range: [lo, hi] }, text };
    }
    if ((m = text.match(/^one of\s+(.+)$/))) {
      const j = parseJSON(`[${m[1]}]`, n, 'one of', col);
      if (!j.ok) return null;
      if (!j.value.length) { diag('error', n, 'P035', 'one of needs at least one value', col); return null; }
      return { kind: 'oneof', values: j.value, text };
    }
    if (text === 'json') return { kind: 'json', text };
    const t = typeOf(text, n, col, 'generator');
    return t ? { kind: 'type', type: t, text } : null;
  }

  if (!versionLine) diag('error', 1, 'P020', 'every file states its version: "duramen <version>"');
}

// Split on commas that are not inside quotes, braces, brackets or parentheses.
export function splitTop(text) {
  const out = [];
  let depth = 0, quote = null, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { out.push({ text: text.slice(start, i).trim(), at: start }); start = i + 1; }
  }
  out.push({ text: text.slice(start).trim(), at: start });
  return out.filter((x) => x.text !== '');
}
