# Build notes

- Build: none (Node.js >= 22.18 runs the `.ts` files directly by type stripping).
- Test: `npm test` or `node --test` (runs `tests/jsonpath.test.ts`).
- Run: `node driver.ts`, then feed one JSON request per line on stdin, e.g.
  `{"id":"1","op":"query","input":{"query":"$.a[*]","document":{"a":[1,2]}}}`.

Layout: `json.ts` (exact-number JSON parser/serializer), `regex.ts` (I-Regexp checker and translator),
`parse.ts` (query parser and type checker), `eval.ts` (evaluation, normalized paths), `driver.ts` (protocol).

Things that surprised me:
- The grammar makes `$ ` (trailing space) invalid but `$ .a` valid.
- `$` and `^` are ordinary literal characters in I-Regexp.
- `-0` is a valid number literal in filters but not a valid index.
- "numbers compare exactly" needs a custom JSON parser, since `JSON.parse` loses precision above 2^53.
- `import.meta.main` is used so `driver.ts` can be imported by tests without starting the reader.
