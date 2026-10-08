# Build notes

- Build: none (Node 22.18+ runs `.ts` by type stripping).
- Test: `node --test`
- Run: `node driver.ts` (JSON lines on stdin, one response line each on stdout).
- Files: `canon.ts` (number text, fixed text, canonical JSON), `engine.ts` (operations and audits), `driver.ts` (protocol), `heat.test.ts`.

Surprises:
- ECMAScript number text and `toFixed` are what Node does natively, so those edges are thin wrappers (only `-0` is normalised and lone surrogates are escaped by hand).
- The spec examples list `constants` in non-sorted order, but audit text is canonical (sorted) JSON; see C-1.
