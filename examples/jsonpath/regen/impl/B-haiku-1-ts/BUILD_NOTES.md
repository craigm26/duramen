# Build notes

## What is here

- `driver.ts`: the program. Reads JSON request lines on stdin and writes response lines on stdout.
- `protocol.ts`: one request line in, one response line out (the error order of SPEC.md).
- `json.ts`: a strict JSON reader that keeps member order and number text, and a writer.
- `query.ts`: the query parser (syntax, integer range, function arity) and the static type checks.
- `iregexp.ts`: I-Regexp validation, translated to a JavaScript `u`-flag RegExp.
- `eval.ts`: evaluation of parsed queries, comparisons, and normalized paths.
- `REGEN.json`: `lang` ts, `build` empty, `test` `node --test`, `driver` `node driver.ts`.
- `package.json`: `"type": "module"`, scripts only, no dependencies.
- Tests (`*.test.ts`): `spec-syntax`, `spec-filters`, `spec-results` (the SPEC scenario tables, R2-R32), `protocol` (R1, through the real driver), `json`, `edge`, and `repo` (the REQ-BU checks: REGEN.json shape, no dependencies, size, erasable syntax, `.ts` imports).
- `CHOICES.md`: each place the spec was silent, ambiguous or contradictory, and what I chose.

## How to build

Nothing to build. There is no compiler and no bundling step. Node 22.18 or later runs the `.ts` files directly through type stripping. I used Node v22.22.0 on Linux.

## How to test

```
npm test
```

or the same command that REGEN.json names:

```
node --test
```

Expect 61 tests, all passing, in about 3 seconds. The driver tests start `node driver.ts` as a child process, so they take a little longer.

## How to run

The driver reads one JSON object per line on stdin and writes one JSON object per line on stdout, in request order:

```
node driver.ts
```

For example, a request whose query is `$.a` on the document `{"a":1}` gets the response `{"id":"r1","result":{"values":[1],"paths":["$['a']"]}}`.

## What surprised me

- **JSON.parse changes member order.** Integer-like names move to the front (`{"b":1,"1":2}` comes back as `"1"`, then `"b"`), and the spec requires document order (R30). The reader therefore builds `Map`s itself.
- **String comparison is in UTF-16 code units.** `<` on JavaScript strings is wrong for R18.3: U+1F600 must sort after U+E000, which needs code point comparison (`codePointAt`).
- **readline splits on a lone CR.** The spec defines lines by LF (C-4), so the driver splits the input by hand.
- **Type stripping needs `import type` for type-only imports.** A type-only name imported without `type` is left in the emitted code and fails at run time with a missing-export error.
- **Eager paths made deep documents quadratic.** The first version built the full path string for every node. A 50,000-deep document then ran out of memory during a descendant walk. Nodes now keep a link to their parent, and a path is built only for the nodes returned.
- **Recursion limit.** The parser, writer, descendant walk and deep equality were recursive and overflowed at about 6,000 levels, which crashed the driver on that request. All four are now iterative (C-12). The query parser is still recursive (C-13).
- **Nothing was type-checked.** No compiler is available to this build, so the TypeScript types are checked only by reading. The tests cover behaviour, not types.
- **Shell restrictions.** Only `node`, `npm`, `mkdir`, `ls` and git commands are permitted here. Two of my checks were refused for that reason (a `printf` pipeline into `node`, and piping test output to `grep`). I ran every check with plain `node` commands instead.
- **Not tested.** Windows (REGEN.json uses plain words, so it should work there, but I have not run it there). Invalid UTF-8 input and a byte order mark (C-6). Exact nesting limits (I tested 50,000 for documents and 20,000 for queries).
