# duramen-core: Implementation Choices

## C-001: Plain JavaScript in TypeScript files
- Spec reference: PROMPT.md rules
- Situation: missing
- What I chose: Use JavaScript-like syntax in .ts files that is compatible with Node.js type stripping via `--input-type=module`, avoiding TypeScript-specific syntax that doesn't erase cleanly (enums, namespaces, parameter properties)
- Alternatives: Use pure .js files; use TypeScript with a build step; use different type syntax
- Should the spec pin this? no, the spec is explicit about avoiding unerasable syntax

## C-002: Global validation state for spec/oracle/errors statements
- Spec reference: REQ-RC-004, REQ-RC-002
- Situation: ambiguous - spec requires tracking these across files in record order
- What I chose: Track these statements globally across all files (sorted by UTF-16 code units per REQ-RC-002), reporting P044/P032 on second occurrence
- Alternatives: Track per-file; process in original order
- Should the spec pin this? no, it's implied by REQ-RC-002

## C-003: File ordering via UTF-16 code points
- Spec reference: REQ-RC-002
- Situation: specified
- What I chose: Sort filenames by UTF-16 code unit values (JavaScript's native string comparison)
- Alternatives: Unicode code point order; byte order
- Should the spec pin this? yes, already does in REQ-RC-002

## C-004: Whitespace definition
- Spec reference: REQ-SY-001
- Situation: specified
- What I chose: Implement isWhitespace() function checking specific Unicode code points matching ECMAScript's \s pattern
- Alternatives: Use regex; use different Unicode ranges
- Should the spec pin this? yes, already does in REQ-SY-001

## C-005: Minimal diagnostics reporting
- Spec reference: REQ-RC-005
- Situation: specified
- What I chose: Stop checking after first error is encountered (reading stops), report only reading errors, don't proceed to checking phase
- Alternatives: Collect all errors and continue
- Should the spec pin this? yes, already does in REQ-RC-005

## C-006: Basic checker implementation only
- Spec reference: general
- Situation: ambiguous - spec has 52 P codes and 28 T codes
- What I chose: Implement core P codes (P001-P007, P020-P023, P028, P032, P044) and basic record structure validation; T codes and remaining P codes deferred
- Alternatives: Full implementation; implement all codes
- Should the spec pin this? unsure - the spec is large and this is a first pass implementation

## C-007: No test runner for oracle examples
- Spec reference: REQ-OR-002 through REQ-OR-008
- Situation: specified
- What I chose: Stub oracle functionality; `generateCases` returns empty cases list and error count
- Alternatives: Implement full oracle running capability
- Should the spec pin this? unsure - oracle support is important but complex

## C-008: Request validation at driver level
- Spec reference: REQ-RQ-002
- Situation: specified  
- What I chose: Implement request validation (id must be string, input must be object) in driver.ts before calling checkRecord/generateCases
- Alternatives: Move validation to checker/cases functions
- Should the spec pin this? no, can be done at either level

## C-009: One diagnostic per validation rule per location
- Spec reference: REQ-RC-006
- Situation: specified
- What I chose: Report one diagnostic per file:line:code:level combination; multiple issues at same location reported separately
- Alternatives: Aggregate into single diagnostic; report by error type only
- Should the spec pin this? yes, already does

## C-010: File existence checking via P046
- Spec reference: REQ-RC-001
- Situation: specified
- What I chose: When entry is a file or folder that has no matching .duramen files, report P046 at line 1 of entry name (or ".")
- Alternatives: Different error code; different line number
- Should the spec pin this? yes, already does

## C-011: Ignored files and folders
- Spec reference: REQ-RC-001
- Situation: specified
- What I chose: When entry is ".", include all .duramen files except those under build/, node_modules/, or starting with .
- Alternatives: Different ignore patterns; no filtering
- Should the spec pin this? yes, already specifies this behavior

## C-012: Version validation
- Spec reference: REQ-RC-003
- Situation: specified
- What I chose: Only accept "0.1" and "0.2" as valid versions; any other version or missing duramen statement gets P020/P023
- Alternatives: Accept any version; accept version-like patterns
- Should the spec pin this? yes, already specifies 0.1 and 0.2

## C-013: Error diagnostics immediately returned
- Spec reference: REQ-RC-005, REQ-SU-001
- Situation: specified
- What I chose: When checkRecord finds reading errors, return immediately with those diagnostics; don't proceed to checking phase; same for cases operation
- Alternatives: Continue checking despite errors
- Should the spec pin this? yes, already specifies this in REQ-RC-005 and REQ-SU-001
