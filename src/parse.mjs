// Parser for Tilth source files (.tilth). Line-oriented and indentation-based:
// statements start in column 0, their clauses are indented two spaces, and prose
// (`text`), expectations (`expect`) and table rows (`|`) are indented four.
// The parser never throws on bad input: it returns { ast, diagnostics }.

const TOP = new Set(['tilth', 'spec', 'oracle', 'edge', 'section', 'op', 'errors', 'req', 'open', 'decision', 'note']);

export function parse(source, file = '<input>') {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const diagnostics = [];
  const diag = (level, line, code, message) => diagnostics.push({ level, file, line, code, message });
  const ast = {
    file, version: null, spec: null, oracle: null, edges: [], errors: [], ops: [],
    items: [], // sections, reqs, opens and notes, in source order
    decisions: [],
  };
  let section = null;

  // Split into top-level statements: [{ line, words, rest, body: [{ n, indent, text }] }]
  const stmts = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const n = i + 1;
    if (/\t/.test(raw.match(/^\s*/)[0])) { diag('error', n, 'P001', 'indent with spaces, not tabs'); continue; }
    const indent = raw.match(/^ */)[0].length;
    const text = raw.slice(indent).replace(/\s+$/, '');
    if (indent === 0) {
      // A blank line belongs to the statement above it (prose keeps its paragraphs).
      if (text === '') { stmts[stmts.length - 1]?.body.push({ n, indent: 0, text: '' }); continue; }
      if (text.startsWith('#')) continue;
      const [kw] = text.split(/\s+/, 1);
      if (!TOP.has(kw)) { diag('error', n, 'P002', `unknown statement "${kw}"`); stmts.push({ line: n, kw: null, rest: '', body: [] }); continue; }
      stmts.push({ line: n, kw, rest: text.slice(kw.length).trim(), body: [] });
    } else {
      const cur = stmts[stmts.length - 1];
      if (!cur) { diag('error', n, 'P003', 'indented line before any statement'); continue; }
      cur.body.push({ n, indent, text });
    }
  }

  const unquote = (s, n, what) => {
    const m = s.match(/^"((?:[^"\\]|\\.)*)"$/);
    if (!m) { diag('error', n, 'P004', `${what} must be a quoted string`); return s; }
    try { return JSON.parse(`"${m[1]}"`); } catch { diag('error', n, 'P004', `${what}: bad string escape`); return m[1]; }
  };
  const idAndTitle = (rest, n, what) => {
    const m = rest.match(/^(\S+)\s+(".*")$/);
    if (!m) { diag('error', n, 'P005', `${what} needs an ID and a quoted title`); return { id: rest.split(/\s+/)[0] || '?', title: '' }; }
    return { id: m[1], title: unquote(m[2], n, 'title') };
  };

  // Clauses inside a statement body. Indent 2 starts a clause; deeper lines belong to it.
  function clauses(body) {
    const out = [];
    for (const l of body) {
      if (l.indent === 2) {
        if (l.text === '' ) continue;
        if (l.text.startsWith('#')) continue;
        const [kw] = l.text.split(/\s+/, 1);
        out.push({ n: l.n, kw, rest: l.text.slice(kw.length).trim(), sub: [] });
      } else if (l.indent > 2 || l.text === '') {
        const cur = out[out.length - 1];
        if (!cur) { if (l.text !== '') diag('error', l.n, 'P006', 'indented line belongs to no clause'); continue; }
        cur.sub.push(l);
      } else {
        diag('error', l.n, 'P007', 'clauses are indented two spaces');
      }
    }
    return out;
  }
  // Prose under a `text` clause: lines indented four or more, blank lines kept, indent 4 removed.
  const prose = (c) => {
    const ls = c.sub.map((l) => (l.text === '' ? '' : ' '.repeat(l.indent - 4) + l.text));
    while (ls.length && ls[ls.length - 1] === '') ls.pop();
    for (const l of c.sub) if (l.text !== '' && l.indent < 4) diag('error', l.n, 'P008', 'text is indented four spaces');
    return ls.join('\n');
  };

  function parseJSON(s, n, what) {
    try { return { ok: true, value: JSON.parse(s) }; } catch (e) { diag('error', n, 'P009', `${what} is not valid JSON: ${e.message}`); return { ok: false }; }
  }

  // expect <path> = <json>   |   expect <path> ≈ <number> ± <tol>   (ASCII: ~ and +-)
  // expect <path> = ?         the value is the oracle's: shown in the brief, checked by the suite
  function expectation(text, n) {
    if (/^expect\s+\S+\s*=\s*\?$/.test(text)) return { path: text.match(/^expect\s+(\S+)/)[1], kind: 'show', line: n };
    let m = text.match(/^expect\s+(\S+)\s*(?:≈|~)\s*(\S+)\s*(?:±|\+-)\s*(\S+)$/);
    if (m) {
      const v = Number(m[2]); const tol = Number(m[3]);
      if (!Number.isFinite(v) || !Number.isFinite(tol)) { diag('error', n, 'P010', 'approximate expectation needs finite numbers'); return null; }
      return { path: m[1], kind: 'approx', value: v, tol, line: n };
    }
    m = text.match(/^expect\s+(\S+)\s*=\s*(.+)$/);
    if (m) { const j = parseJSON(m[2], n, 'expected value'); return j.ok ? { path: m[1], kind: 'eq', value: j.value, line: n } : null; }
    diag('error', n, 'P011', 'expect <path> = <json>, or expect <path> ≈ <number> ± <tolerance>');
    return null;
  }

  // Examples keep the input exactly as written (`raw`), so spellings such as 2.0e1 or -0 reach
  // the oracle and the implementation unchanged; `input` is the parsed value, for checking.
  //   example <op> <json object>     a request with that input
  //   example <op>                   a request with no `input` member at all
  //   example raw "<line>"           exactly this request line (for lines that are not a
  //                                  well-formed request); sent on its own, in its own run
  // Under an example: `request <json>` adds or replaces request members, `omit <a>, <b>`
  // leaves members out, and `expect` lines state what the response holds.
  function examplesOf(c, req) {
    if (c.kw === 'example') {
      let ex;
      const rm = c.rest.match(/^raw\s+(".*")$/);
      if (rm) {
        ex = { op: null, input: {}, raw: null, rawLine: unquote(rm[1], c.n, 'raw request line'), request: null, omit: [], expects: [], line: c.n, from: 'example' };
      } else {
        const m = c.rest.match(/^(\S+)(?:\s+(.+))?$/);
        if (!m) { diag('error', c.n, 'P012', 'example <op> [<json input>], or example raw "<request line>"'); return; }
        if (m[2] === undefined) ex = { op: m[1], input: {}, raw: null, noInput: true, request: null, omit: [], expects: [], line: c.n, from: 'example' };
        else {
          const j = parseJSON(m[2], c.n, 'example input');
          if (!j.ok) return;
          if (j.value === null || typeof j.value !== 'object' || Array.isArray(j.value)) { diag('error', c.n, 'P012', 'an example input is a JSON object'); return; }
          ex = { op: m[1], input: j.value, raw: m[2], request: null, omit: [], expects: [], line: c.n, from: 'example' };
        }
      }
      for (const l of c.sub) {
        if (l.text === '' || l.text.startsWith('#')) continue;
        if (l.text.startsWith('request ') || l.text.startsWith('omit ')) {
          if (ex.rawLine !== undefined) { diag('error', l.n, 'P022', 'a raw example is sent exactly as written: no request or omit lines'); continue; }
          if (l.text.startsWith('omit ')) { ex.omit.push(...l.text.slice(5).split(/[\s,]+/).filter(Boolean)); continue; }
          const r = parseJSON(l.text.slice(8), l.n, 'request members');
          if (r.ok) ex.request = r.value;
          continue;
        }
        const e = expectation(l.text, l.n);
        if (e) ex.expects.push(e);
      }
      req.examples.push(ex);
    } else { // table <op>
      const op = c.rest.trim();
      const rows = c.sub.filter((l) => l.text.startsWith('|'));
      if (!op || rows.length < 2) { diag('error', c.n, 'P013', 'table <op>, then a header row and at least one row'); return; }
      const cells = (l) => l.text.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((x) => x.trim().replace(/\\\|/g, '|'));
      const header = cells(rows[0]).map((h) => {
        const hm = h.match(/^(\S+)(?:\s*(?:±|\+-)\s*(\S+))?$/);
        return hm ? { name: hm[1], tol: hm[2] === undefined ? null : Number(hm[2]) } : { name: h, tol: null };
      });
      for (const l of rows.slice(1)) {
        if (/^\|[\s|:-]+\|$/.test(l.text)) continue; // markdown separator row
        const vals = cells(l);
        if (vals.length !== header.length) { diag('error', l.n, 'P014', `row has ${vals.length} cells, header has ${header.length}`); continue; }
        const ex = { op, input: {}, raw: null, request: null, omit: [], expects: [], line: l.n, from: 'table' };
        const rawFields = [];
        let ok = true;
        header.forEach((h, i) => {
          if (vals[i] === '') return; // an empty cell states nothing: no input field, no expectation
          const isExpect = /^(result|audit|error|id)(\.|$)/.test(h.name);
          if (isExpect && vals[i] === '?') { ex.expects.push({ path: h.name, kind: 'show', line: l.n }); return; }
          const j = parseJSON(vals[i], l.n, `cell "${h.name}"`);
          if (!j.ok) { ok = false; return; }
          if (isExpect) {
            ex.expects.push(h.tol !== null ? { path: h.name, kind: 'approx', value: j.value, tol: h.tol, line: l.n } : { path: h.name, kind: 'eq', value: j.value, line: l.n });
          } else { ex.input[h.name] = j.value; rawFields.push(`${JSON.stringify(h.name)}:${vals[i]}`); }
        });
        ex.raw = `{${rawFields.join(',')}}`;
        ex.rawFields = Object.fromEntries(header.map((h, i) => [h.name, vals[i]]).filter(([k, v]) => v !== '' && k in ex.input));
        if (ok) req.examples.push(ex);
      }
    }
  }

  for (const s of stmts) {
    if (!s.kw) continue;
    const cs = clauses(s.body);
    const textOf = (allowed) => {
      let text = '';
      for (const c of cs) {
        if (c.kw === 'text') text = prose(c);
        else if (!allowed.includes(c.kw)) diag('error', c.n, 'P015', `"${c.kw}" is not a clause of ${s.kw}`);
      }
      return text;
    };
    switch (s.kw) {
      case 'tilth': ast.version = s.rest; break;
      case 'spec': {
        const [name, version] = s.rest.split(/\s+/);
        ast.spec = { name, version, title: '', contract: null, text: '', request: {}, line: s.line };
        for (const c of cs) {
          if (c.kw === 'title') ast.spec.title = unquote(c.rest, c.n, 'title');
          else if (c.kw === 'contract') ast.spec.contract = c.rest;
          else if (c.kw === 'request') { const j = parseJSON(c.rest, c.n, 'request members'); if (j.ok) ast.spec.request = j.value; }
          else if (c.kw === 'text') ast.spec.text = prose(c);
          else diag('error', c.n, 'P015', `"${c.kw}" is not a clause of spec`);
        }
        break;
      }
      case 'oracle': ast.oracle = { command: s.rest, line: s.line }; break;
      case 'edge': {
        // edge <name> [via <op> <input field> [base64]]: base64 when the op answers with the
        // canonical bytes in base64 rather than as text.
        const m = s.rest.match(/^(\S+)(?:\s+via\s+(\S+)\s+(\S+)(?:\s+(base64))?)?$/);
        if (!m) { diag('error', s.line, 'P016', 'edge <name> [via <op> <input field> [base64]]'); break; }
        const edge = { name: m[1], via: m[2] ? { op: m[2], field: m[3], encoding: m[4] ?? 'text' } : null, decisions: [], line: s.line };
        for (const c of cs) {
          if (c.kw === 'decision') edge.decisions.push(...c.rest.split(/[\s,]+/).filter(Boolean));
          else diag('error', c.n, 'P015', `"${c.kw}" is not a clause of edge`);
        }
        ast.edges.push(edge);
        break;
      }
      case 'section': {
        const { id, title } = idAndTitle(s.rest, s.line, 'section');
        section = { type: 'section', id, title, text: textOf([]), line: s.line };
        ast.items.push(section);
        break;
      }
      case 'op': {
        const op = { name: s.rest, inputs: [], tolerances: {}, audit: null, summary: '', request: null, line: s.line };
        for (const c of cs) {
          if (c.kw === 'request') { const j = parseJSON(c.rest, c.n, 'request members'); if (j.ok) op.request = j.value; continue; }
          if (c.kw === 'input') {
            for (const f of c.rest.split(',').map((x) => x.trim()).filter(Boolean)) {
              const fm = f.match(/^(\w+)(\?)?\s+(.+)$/);
              if (!fm) { diag('error', c.n, 'P017', `input field "${f}": <name>[?] <type>`); continue; }
              op.inputs.push({ name: fm[1], optional: !!fm[2], type: fm[3] });
            }
          } else if (c.kw === 'tolerance') {
            const tm = c.rest.match(/^(\S+)\s+(\S+)$/);
            if (!tm || !Number.isFinite(Number(tm[2]))) diag('error', c.n, 'P018', 'tolerance <result path> <number>');
            else op.tolerances[tm[1]] = Number(tm[2]);
          } else if (c.kw === 'audit') op.audit = c.rest || 'text';
          else if (c.kw === 'result') op.summary = c.rest;
          else diag('error', c.n, 'P015', `"${c.kw}" is not a clause of op`);
        }
        ast.ops.push(op);
        break;
      }
      case 'errors': {
        // One "<code> when <condition>" per clause, first match wins; a condition may continue
        // on lines indented four.
        for (const c of cs) {
          const m = (c.kw + ' ' + c.rest).match(/^(\S+)\s+when\s+(.+)$/);
          if (!m) { diag('error', c.n, 'P019', 'errors: one "<code> when <condition>" per line, first match wins'); continue; }
          const more = c.sub.map((l) => l.text).filter((t) => t !== '');
          ast.errors.push({ code: m[1], when: [m[2], ...more].join(' '), line: c.n });
        }
        break;
      }
      case 'req': {
        const { id, title } = idAndTitle(s.rest, s.line, 'req');
        const req = { type: 'req', id, title, section: section?.id ?? null, decisions: [], platform: 'any', text: '', textLine: null, examples: [], line: s.line };
        for (const c of cs) {
          if (c.kw === 'text') { req.text = prose(c); req.textLine = c.n; }
          else if (c.kw === 'decision') req.decisions.push(...c.rest.split(/[\s,]+/).filter(Boolean));
          else if (c.kw === 'on') req.platform = c.rest;
          else if (c.kw === 'example' || c.kw === 'table') examplesOf(c, req);
          else diag('error', c.n, 'P015', `"${c.kw}" is not a clause of req`);
        }
        ast.items.push(req);
        break;
      }
      case 'open': {
        const { id, title } = idAndTitle(s.rest, s.line, 'open');
        const text = textOf(['example', 'table']);
        const exampleLines = cs.filter((c) => c.kw === 'example' || c.kw === 'table').map((c) => c.n); // T003, in check
        ast.items.push({ type: 'open', id, title, section: section?.id ?? null, text, exampleLines, line: s.line });
        break;
      }
      case 'decision': {
        const { id, title } = idAndTitle(s.rest, s.line, 'decision');
        const d = { id, title, source: null, status: null, text: '', rejected: [], line: s.line };
        for (const c of cs) {
          if (c.kw === 'source') d.source = c.rest;
          else if (c.kw === 'status') d.status = c.rest;
          else if (c.kw === 'text') d.text = prose(c);
          else if (c.kw === 'rejected') d.rejected.push(unquote(c.rest, c.n, 'rejected alternative'));
          else diag('error', c.n, 'P015', `"${c.kw}" is not a clause of decision`);
        }
        ast.decisions.push(d);
        break;
      }
      case 'note': {
        ast.items.push({ type: 'note', section: section?.id ?? null, text: textOf([]), line: s.line });
        break;
      }
    }
  }
  if (!ast.version) diag('error', 1, 'P020', 'the file must start with "tilth <version>"');
  if (!ast.spec) diag('error', 1, 'P021', 'missing "spec <name> <version>"');
  return { ast, diagnostics };
}
