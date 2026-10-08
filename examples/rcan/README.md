# The edge packs against the RCAN SDKs

`canonical.duramen` binds `json/rfc8785` and `number-text/ecmascript` to the `canonical` operation
of [regen-rcan-assurance](https://github.com/craigm26/regen-rcan-assurance)'s driver protocol.
To reproduce the table in the top-level README:

1. Clone regen-rcan-assurance (the results used ebb8281), rcan-ts and rcan-py
   (github.com/RobotRegistryFoundation).
2. Put each SDK state somewhere outside the clones:
   - rcan-ts at `ff8c73d` (master) and `b563fb5` (PR #55 head): `src/encoding.ts`, and for
     `b563fb5` also `src/errors.ts`, with the import `from "./errors.js"` changed to
     `from "./errors.ts"` so Node can load it without a build.
   - rcan-py at `0184314` (main) and `638ca3b` (PR #66 head): the `rcan/` package
     (`git archive <commit> rcan | tar -x -C <dir>`).
3. Copy regen-rcan-assurance's `.regenerate/suite/adapters/sdk-ts` (for TypeScript) or
   `adapters/port-py` (for Python) once per state, and give each copy a `local.json`:
   `{"encoding": "<dir>/encoding.ts"}` or `{"sdk": "<dir>"}`. For the `b563fb5` copy, set
   `REGEN.json`'s driver to `node --experimental-transform-types --no-warnings driver.mjs`:
   its error classes use TypeScript parameter properties, which plain type stripping refuses.
4. `node bin/duramen.mjs run examples/rcan/canonical.duramen --impl <adapter copy>`, and the same
   with `--impl <regen-rcan-assurance>/impl/ts` and `impl/py`.

The adapters' own drivers are used unchanged (sha256 `ba993c04…` for `sdk-ts/driver.mjs`,
`4aec7a1d…` for `port-py/driver.py` at ebb8281). There is no oracle in `canonical.duramen`; the
packs are the whole check, so `duramen check` reports T019 as information only.
