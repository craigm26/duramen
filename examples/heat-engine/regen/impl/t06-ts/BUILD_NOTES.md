# Build notes

- Build: none (Node.js 22.18+ runs the `.ts` files directly by type stripping).
- Test: `npm test` (same as `node --test`); tests live in `test/engine.test.ts`.
- Run: `node driver.ts`, reading request lines on stdin and writing one response line each to stdout.
- Layout: `driver.ts` (entry), `src/driver.ts` (protocol and validation), `src/engine.ts` (operations and audits), `src/canon.ts` (canonical JSON and number text).

Notes:
- ECMAScript `String(n)`, `toFixed` and `JSON.stringify` of strings already implement the three edges, so the code leans on them. Keys are sorted with the default sort, which compares UTF-16 code units.
- Input is read in full and answered at end of input (allowed by OPEN-IF-005).
- Only `node`, `npm`, `mkdir`, `ls` and git were allowed, so files were written with the editor tool instead of shell redirection.
- Surprise: the spec's own `-0.04` example (`T=-0.0`) works only because `toFixed` keeps the sign for negative non-zero inputs that round to zero.
