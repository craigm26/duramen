import { parseStatement, parseJSON, isJSON } from './syntax.ts';

export function parseRecord(lines) {
  const diagnostics = [];
  const record = {
    duramenVersion: null,
    spec: null,
    oracle: null,
    operations: new Map(),
    requirements: [],
    openItems: [],
    decisions: new Map(),
    sections: [],
    notes: [],
    errorsList: null,
  };

  const statements = parseStatements(lines);

  for (const stmt of statements.statements) {
    if (stmt.keyword === 'duramen') {
      const version = parseVersionStatement(stmt);
      if (version.value) {
        record.duramenVersion = version.value;
      }
      if (version.diagnostics) {
        diagnostics.push(...version.diagnostics);
      }
    } else if (stmt.keyword === 'spec') {
      const spec = parseSpecStatement(stmt);
      if (spec.value) {
        record.spec = spec.value;
      }
      if (spec.diagnostics) {
        diagnostics.push(...spec.diagnostics);
      }
    } else if (stmt.keyword === 'oracle') {
      const oracle = parseOracleStatement(stmt);
      if (oracle.value) {
        record.oracle = oracle.value;
      }
      if (oracle.diagnostics) {
        diagnostics.push(...oracle.diagnostics);
      }
    } else if (stmt.keyword === 'op') {
      const op = parseOpStatement(stmt);
      if (op.value) {
        record.operations.set(op.value.name, op.value);
      }
      if (op.diagnostics) {
        diagnostics.push(...op.diagnostics);
      }
    } else if (stmt.keyword === 'req') {
      const req = parseReqStatement(stmt);
      if (req.value) {
        record.requirements.push(req.value);
      }
      if (req.diagnostics) {
        diagnostics.push(...req.diagnostics);
      }
    } else if (stmt.keyword === 'open') {
      const open = parseOpenStatement(stmt);
      if (open.value) {
        record.openItems.push(open.value);
      }
      if (open.diagnostics) {
        diagnostics.push(...open.diagnostics);
      }
    } else if (stmt.keyword === 'decision') {
      const decision = parseDecisionStatement(stmt);
      if (decision.value) {
        record.decisions.set(decision.value.id, decision.value);
      }
      if (decision.diagnostics) {
        diagnostics.push(...decision.diagnostics);
      }
    } else if (stmt.keyword === 'section') {
      const section = parseSectionStatement(stmt);
      if (section.value) {
        record.sections.push(section.value);
      }
      if (section.diagnostics) {
        diagnostics.push(...section.diagnostics);
      }
    } else if (stmt.keyword === 'note') {
      const note = parseNoteStatement(stmt);
      if (note.value) {
        record.notes.push(note.value);
      }
      if (note.diagnostics) {
        diagnostics.push(...note.diagnostics);
      }
    } else if (stmt.keyword === 'errors') {
      const errors = parseErrorsStatement(stmt);
      if (errors.value) {
        record.errorsList = errors.value;
      }
      if (errors.diagnostics) {
        diagnostics.push(...errors.diagnostics);
      }
    }
  }

  return { record, diagnostics: [...diagnostics, ...statements.diagnostics] };
}

function parseStatements(lines) {
  const statements = [];
  const diagnostics = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.indent === 0) {
      if (line.content === '' || line.content.startsWith('#')) {
        i++;
        continue;
      }

      const parsed = parseStatement(line.content);
      if (!parsed) {
        i++;
        continue;
      }

      const body = [];
      let j = i + 1;
      while (j < lines.length && lines[j].indent > 0) {
        body.push(lines[j]);
        j++;
      }

      statements.push({
        keyword: parsed.keyword,
        line,
        body,
        fullLine: parsed.fullLine,
        rest: parsed.rest,
      });

      i = j;
    } else {
      i++;
    }
  }

  return { statements, diagnostics };
}

function parseVersionStatement(stmt) {
  const diagnostics = [];
  const parts = stmt.rest;

  if (parts.length === 0) {
    diagnostics.push({
      file: stmt.line.file,
      line: stmt.line.lineNum,
      level: 'error',
      code: 'P023',
    });
    return { value: null, diagnostics };
  }

  const version = parts[0];
  if (!['0.1', '0.2'].includes(version)) {
    diagnostics.push({
      file: stmt.line.file,
      line: stmt.line.lineNum,
      level: 'error',
      code: 'P023',
    });
  }

  return { value: version, diagnostics };
}

function parseSpecStatement(stmt) {
  const diagnostics = [];
  const parts = stmt.rest;

  if (parts.length < 2) {
    diagnostics.push({
      file: stmt.line.file,
      line: stmt.line.lineNum,
      level: 'error',
      code: 'P021',
    });
    return { value: null, diagnostics };
  }

  const name = parts[0];
  const version = parts[1];

  if (parts.length > 2) {
    diagnostics.push({
      file: stmt.line.file,
      line: stmt.line.lineNum,
      level: 'error',
      code: 'P021',
    });
    return { value: null, diagnostics };
  }

  return { value: { name, version }, diagnostics };
}

function parseOracleStatement(stmt) {
  const diagnostics = [];
  const command = stmt.rest.join(' ');

  if (!command) {
    diagnostics.push({
      file: stmt.line.file,
      line: stmt.line.lineNum,
      level: 'error',
      code: 'P028',
    });
  }

  return { value: { command }, diagnostics };
}

function parseOpStatement(stmt) {
  const diagnostics = [];
  const parts = stmt.rest;

  if (parts.length === 0) {
    diagnostics.push({
      file: stmt.line.file,
      line: stmt.line.lineNum,
      level: 'error',
      code: 'P031',
    });
    return { value: null, diagnostics };
  }

  if (parts.length > 1) {
    diagnostics.push({
      file: stmt.line.file,
      line: stmt.line.lineNum,
      level: 'error',
      code: 'P031',
    });
    return { value: null, diagnostics };
  }

  const name = parts[0];
  return { value: { name }, diagnostics };
}

function parseReqStatement(stmt) {
  const diagnostics = [];
  const parts = stmt.rest;

  if (parts.length < 2) {
    diagnostics.push({
      file: stmt.line.file,
      line: stmt.line.lineNum,
      level: 'error',
      code: 'P005',
    });
    return { value: null, diagnostics };
  }

  const id = parts[0];
  const titlePart = parts.slice(1).join(' ');

  if (!titlePart.startsWith('"') || !titlePart.endsWith('"')) {
    diagnostics.push({
      file: stmt.line.file,
      line: stmt.line.lineNum,
      level: 'error',
      code: 'P005',
    });
    return { value: null, diagnostics };
  }

  return { value: { id, title: titlePart }, diagnostics };
}

function parseOpenStatement(stmt) {
  const diagnostics = [];
  const parts = stmt.rest;

  if (parts.length < 2) {
    diagnostics.push({
      file: stmt.line.file,
      line: stmt.line.lineNum,
      level: 'error',
      code: 'P005',
    });
    return { value: null, diagnostics };
  }

  const id = parts[0];
  const titlePart = parts.slice(1).join(' ');

  if (!titlePart.startsWith('"') || !titlePart.endsWith('"')) {
    diagnostics.push({
      file: stmt.line.file,
      line: stmt.line.lineNum,
      level: 'error',
      code: 'P005',
    });
    return { value: null, diagnostics };
  }

  return { value: { id, title: titlePart }, diagnostics };
}

function parseDecisionStatement(stmt) {
  const diagnostics = [];
  const parts = stmt.rest;

  if (parts.length < 2) {
    diagnostics.push({
      file: stmt.line.file,
      line: stmt.line.lineNum,
      level: 'error',
      code: 'P005',
    });
    return { value: null, diagnostics };
  }

  const id = parts[0];
  const titlePart = parts.slice(1).join(' ');

  if (!titlePart.startsWith('"') || !titlePart.endsWith('"')) {
    diagnostics.push({
      file: stmt.line.file,
      line: stmt.line.lineNum,
      level: 'error',
      code: 'P005',
    });
    return { value: null, diagnostics };
  }

  return { value: { id, title: titlePart }, diagnostics };
}

function parseSectionStatement(stmt) {
  const diagnostics = [];
  const parts = stmt.rest;

  if (parts.length < 2) {
    diagnostics.push({
      file: stmt.line.file,
      line: stmt.line.lineNum,
      level: 'error',
      code: 'P005',
    });
    return { value: null, diagnostics };
  }

  const id = parts[0];
  const titlePart = parts.slice(1).join(' ');

  if (!titlePart.startsWith('"') || !titlePart.endsWith('"')) {
    diagnostics.push({
      file: stmt.line.file,
      line: stmt.line.lineNum,
      level: 'error',
      code: 'P005',
    });
    return { value: null, diagnostics };
  }

  return { value: { id, title: titlePart }, diagnostics };
}

function parseNoteStatement(stmt) {
  return { value: {}, diagnostics: [] };
}

function parseErrorsStatement(stmt) {
  return { value: { codes: new Map() }, diagnostics: [] };
}
