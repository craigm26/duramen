# Build notes

- Language: TypeScript run by Node.js 22.18+ through type stripping. No build step, no dependencies.
- Run the driver: `node driver.ts` (this is what `REGEN.json` names). It reads request lines on
  standard input and writes one response line each to standard output.
- Test: `npm test` (runs `node --test`; `spec.test.ts` has one or more tests per REQ, built from the
  spec's examples, and `driver.test.ts` runs the real driver process).
- Layout: `serve.ts` (request validation, protocol), `check.ts` (record resolution, T checks,
  oracle run, suite), `reader.ts` (P checks, the model), `oracle.ts` (oracle process handling),
  `common.ts` (helpers).
- The oracle is run in a temporary folder to which every file of the request is written, with the
  working directory set to the folder of the file holding the `oracle` statement. The folder is
  removed afterwards. `node` in an oracle command is started as the running Node binary.

Surprises:
- A row like `|   |` or a lone `|` in a table counts as a separator (only `|`, `-`, `:` and spaces),
  which is the only way REQ-SY-012 example 4 can be free of diagnostics.
- The table header problems are reported at the header row's line, the "too few rows / bad op"
  problem at the `table` line.
- Reading a record needs the whole `files` map even for a file record, because `input ... from`
  may name files other than the record's own.
