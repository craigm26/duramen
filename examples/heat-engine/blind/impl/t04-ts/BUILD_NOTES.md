# Build notes

- Build: none. Node 22.18+ runs the `.ts` files directly by type stripping.
- Test: `node --test` (19 tests in `heat.test.ts`, covering every REQ plus a driver subprocess test).
- Run: `node driver.ts`, then send one JSON request per line on stdin.

## Layout
- `canonical.ts`: canonical JSON. `JSON.stringify` on strings and `String(n)` already match the spec's escaping and number text.
- `heat.ts`: wet-bulb and flag operations, which build the audit records.
- `engine.ts`: parses one request line, validates it, and dispatches.
- `driver.ts`: stdin/stdout loop.

## Notes
- ECMAScript's `Number#toString` and `toFixed` are exactly the two number edges, so the host language does that work.
- Shell commands other than `node`, `mkdir`, `ls` and git were refused, so the files were written with the file tools.
