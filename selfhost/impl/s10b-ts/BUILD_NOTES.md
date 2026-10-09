# duramen-core: Build Notes

## Overview
This is a TypeScript implementation of duramen-core, the checker for the duramen specification language. It validates duramen records and generates test suites from them.

## Building

No build step is required. The implementation uses Node.js 22.18+ with type stripping via `--input-type=module`.

## Testing

Run tests with:
```bash
npm test
```

Or directly:
```bash
node --test *.test.ts
```

## Running

The driver protocol is specified in REGEN.json:
```json
{
  "driver": "node --input-type=module driver.ts"
}
```

The driver reads JSON request objects from stdin and writes JSON response objects to stdout, one per line, following the protocol in REQ-RQ-001 and REQ-RQ-002 of the specification.

Example request:
```json
{"id": "1", "op": "check", "input": {"files": {"s.duramen": "duramen 0.1\nspec s 1\n"}}}
```

Example response:
```json
{"id": "1", "result": {"diagnostics": [], "errors": 0, "warnings": 0}}
```

## Implementation Status

### Implemented
- **File reading and validation**: Correctly reads .duramen files from requests, filters by entry point, and ignores build/, node_modules/, and dotted names per REQ-RC-001
- **UTF-16 sorting**: Sorts files by UTF-16 code unit order per REQ-RC-002  
- **Basic syntax validation**:
  - P001: Tab indentation errors
  - P002: Unknown statement keywords
  - P003: Indented lines before first statement
  - P007: Indentation of one space (invalid between 0 and 2)
  - P020: Missing duramen statement
  - P023: Invalid duramen version
  - P021: Missing spec statement (across entire record)
  - P044: Duplicate spec/oracle statements
  - P032: Duplicate errors statement
  - P046: Entry path doesn't exist or has no .duramen files
- **Request validation**: Full validation per REQ-RQ-002 (id must be string, input must be object, files must be non-empty object with string values, paths must be relative and valid)
- **Diagnostic ordering**: Diagnostics sorted by file name, line, code, level per REQ-RC-006
- **Test suite**: 16 passing tests covering key requirements

### Not Implemented (Deferred)
- Most P codes (P004-P006, P008-P019, P024-P031, P033-P052)
- All T codes (checking rules T001-T028)
- Oracle running and example validation
- Cases generation beyond empty suite with error count
- Clause parsing and validation (title, text, request, example, table, etc.)
- Operation, requirement, decision, section parsing and validation
- Semantic checking (ID uniqueness, decision references, obligation validation, etc.)

## Architecture

### Core Modules

- **driver.ts**: Main entry point; implements JSON request/response protocol; routes to check/cases operations
- **types.ts**: Diagnostic type definitions and formatting; comparison for sorting
- **reader.ts**: Reads and validates the "files" input object; returns Map and entry point
- **parser.ts**: Parses file content into lines; handles BOM, CRLF, whitespace, indentation
- **checker.ts**: Main validation logic; orchestrates reading, parsing, and syntax validation
- **cases.ts**: Stub for case generation; returns empty suite with error count
- **syntax.ts**: Statement parsing and JSON validation utilities
- **validator.ts**: Additional validation functions (currently minimal)
- **record.ts**: Record structure parsing (currently minimal)

### Test Files

- **basic.test.ts**: 6 foundational tests covering basic requirements
- **spec.test.ts**: 10 tests covering file ordering, missing statements, and indentation errors
- **fixtures/echo.mjs**: Tiny oracle for testing (from spec examples)

## Key Design Decisions

1. **Whitespace handling**: Implemented as character code checks for ECMAScript \s pattern rather than regex due to type-stripping limitations

2. **Global statement tracking**: Track spec/oracle/errors statements across all files (in sorted order) to properly detect duplicates that span files

3. **Error-first approach**: Stop processing as soon as reading errors are found; don't proceed to checking phase (per REQ-RC-005)

4. **Minimal initial scope**: Focused on getting core file reading, sorting, and basic syntax validation working correctly before adding more rules

## Surprises and Learnings

1. **Type-stripping limitations**: Node.js type stripping with `--input-type=module` requires careful syntax choices; interfaces and type-only exports don't create runtime bindings, so all exports must be functions or variables

2. **UTF-16 code unit sorting**: JavaScript's native string comparison uses UTF-16 code units, which is exactly what the spec requires for deterministic cross-platform ordering

3. **Specification complexity**: The duramen specification is large (3400+ lines) with 52 error codes (P) and 28 checking codes (T), plus requirements about examples, oracles, case generation, etc. Building even a partial checker requires careful design

4. **Statement tracking across files**: Detecting duplicate spec/oracle/errors statements requires processing files in the correct order globally, not just per-file

## Next Steps for Completion

1. Implement remaining P codes (P004-P006, P008-P019, P024-P031, P033-P052)
2. Implement clause parsing (title, text, request, on, decision, etc.)
3. Implement statement parsing (op, req, open, decision, section, note, errors details)
4. Implement checking rules (T codes)
5. Implement oracle running and example validation
6. Implement case generation from parsed records
7. Add comprehensive error handling and edge case coverage
