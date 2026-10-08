# Build notes

- Build: none. Node 22.18+ runs the `.ts` files directly by type stripping.
- Test: `node --test` (19 tests in `heat.test.ts`, covering every REQ and the edges).
- Run: `node driver.ts`, with JSON-line requests on stdin and responses on stdout.
- Files: `engine.ts` (canonical JSON, wet-bulb, flags), `driver.ts` (protocol and validation), `heat.test.ts`.

Notes:
- The spec's two text edges (number text and fixed-point text) are exactly what JavaScript's `String(n)` and `toFixed` do, so the code uses them directly. Only the JSON string escaping is hand-written, because the edge requires lowercase `\u` escapes for lone surrogates.
- `Object.keys(...).sort()` compares UTF-16 code units, which is what the key-order edge requires.
- Responses go through the same canonical serializer as audits, so member order in responses is sorted. The spec allows this, since results are compared as parsed JSON.
- Not shell-testable here: my first attempt to create files with heredocs through the shell was denied, so I wrote the files with the file tool instead.
