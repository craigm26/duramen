# The build transcripts of round three (CONFIDENCE-3.md)

Each build's whole session, compressed with gzip. Uncompressed, each has the sha256 its ledger row
names.

| build | builder | file | sha256 of the transcript |
|---|---|---|---|
| s23 | A, `claude -p` through `duramen regen` | `s23-ts.jsonl.gz` | `8deee4ef2541abcc3933e26d7fd191e2c84a1e66d4d3ae76956fa6d792da1bec` |
| s24 | B, `codex exec --json` | `s24-ts.jsonl.gz` | `a45fa438b88b024a6b8317091b54c1764588d5cb31e34f9a13265b6fb8cb619f` |
| s25 | A | `s25-ts.jsonl.gz` | `2fbcb08d766ca7409c8171f12bdb5519d2ad39c57c97fa5c3db0e03a8e50448b` |
| s26 | B | `s26-ts.jsonl.gz` | `3db25b988161901aaefe8b27be0d862f218484fb57180b7bd9588633641d9989` |
| s27 | A | `s27-ts.jsonl.gz` | `9ab04b445599f34bae8984e5a746956ceda77f2579cddd60222f0cc78f2d2809` |
| s28 | B | `s28-ts.jsonl.gz` | `5e6fe057476153ae620c24346b4cb77ca677efbb5a64ab3d82dc8b171d999121` |

A's are the stream-json transcripts `duramen regen` keeps (`meta/transcript.jsonl` beside the work
folder `w/` in its sandbox). B's are what `codex exec --json` wrote in the WSL namespace, where the
box is `/srv/ns/box`; Codex's own session logs, which hold the login's identity, are left out.

To audit them again: for A, put each one where its sandbox kept it,
`/tmp/duramen-regen/<id>/meta/transcript.jsonl` (the ids, in the ledger, are `ewzagc` for s23,
`ctfjbv` for s25 and `faplcf` for s27), since the audit judges paths against that work folder,
and run `node selfhost/transcripts.mjs /tmp/duramen-regen <id>`; for B, run
`node selfhost/loop/codex-audit.mjs <transcript> --full`. What those audits found is in
CONFIDENCE-3.md, under Departures.
