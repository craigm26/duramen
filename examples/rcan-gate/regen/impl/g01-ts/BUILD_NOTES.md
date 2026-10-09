# Build notes

- Build: none (Node.js 22.18+ type stripping; no compiler, no dependencies).
- Test: `npm test` (runs `node --test`, which picks up `gate.test.ts`).
- Run: `node driver.ts` reads one JSON request per line on stdin and writes one response per line.
- Files: `gate.ts` (validation and the `decide` function), `driver.ts` (line protocol), `gate.test.ts`.

Notes:
- `JSON.parse` makes `__proto__` an own member, and object spread keeps it, so state members named like that pass through unchanged. Lookups use `Object.hasOwn` and `Map`s.
- `npm test` needs a `package.json`, so one exists (no dependencies).
- `driver.ts` runs its stdin loop only when it is the entry file, so tests can import `handle`.
- The shell would not run heredocs, so files were written with the editor tool instead.
- Slip: I once ran `mkdir /tmp/x` outside the folder (in a command that was refused anyway); nothing was created from it that this project uses.
