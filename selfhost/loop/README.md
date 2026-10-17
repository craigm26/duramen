# Round three's loop

The tools for [CONFIDENCE-3.md](../../CONFIDENCE-3.md): two builders from different model families
rebuild duramen-core blind, and every judgment about a rebuild is made by the rebuilds.

- [`runner.mjs`](runner.mjs): sends request lines to a driver and pairs each response with its
  request by id. It rules on nothing and shares no code with duramen's own runner.
- [`round.mjs`](round.mjs): one round of R5. Each build writes the suite of `spec/` with itself
  as the oracle; both builds answer every case of both suites and both builds' `judge` rule on
  every answer; A, B and duramen answer the mutated records of seeds 1 to 3 (duramen's `mutate`
  in [`../agree.mjs`](../agree.mjs) makes them) and every probe file given.
- [`outside.mjs`](outside.mjs): R6's outside suite against one program, after the last round.
- [`codex-audit.mjs`](codex-audit.mjs): what a Codex session ran, checked for paths outside its
  folder, network use and commands outside the brief's list.
- [`wsl/`](wsl/): how builder B and R6's writer run on Craig's PC: Codex CLI in a WSL mount
  namespace that covers every drive, every home folder and WSL's views of the PC with empty file
  systems: it sees its folder, its own Codex home and tools, and the distro's system folders and
  `/tmp`, and nothing on the PC's drives or in its homes ([`ns-run.sh`](wsl/ns-run.sh)), launched
  by [`b-launch.sh`](wsl/b-launch.sh) and [`r6-launch.sh`](wsl/r6-launch.sh); the models Codex
  offered on that login are in [`codex-models.json`](wsl/codex-models.json), each one's name,
  place and description copied from the list Codex fetched, without the login's identity.
- [`import-codex.mjs`](import-codex.mjs): brings one of B's builds from Craig's PC into
  `selfhost/impl/`, audits its transcript, scores it with duramen's suite (beside the loop), and
  writes its ledger row and run record.
- [`r6-task.md`](r6-task.md) and [`r6-suite.md`](r6-suite.md): R6's writer's task, and the
  outside suite's hash, pushed before the first build. [`r6/`](r6/) holds the suite, its writer's
  notes and the transcripts of both of the writer's attempts, committed after the last round
  ([`wsl/r6-pack.sh`](wsl/r6-pack.sh) packed them).
- [`mutate-record.sh`](mutate-record.sh) and [`wsl/stryker-run.sh`](wsl/stryker-run.sh): the
  mutation scores of CONFIDENCE-3.md's "Outside us", duramen's own `mutate` on the record and
  Stryker on a build.

To rerun a round, check out the commit that holds its builds and its brief (round eleven
`6c847eb`, round twelve `a1f9189`, round thirteen `23d84de`) and run, for round eleven:

```
node selfhost/loop/round.mjs --a selfhost/impl/s23-ts --b selfhost/impl/s24-ts --out <dir> \
  --probes selfhost/probes/s06-s07.txt --probes selfhost/probes/s08-s09.txt ... --probes selfhost/probes/s23-s24.txt
```

with every probe file the commit holds. The answers it writes can be compared with
[`../rounds/round11/`](../rounds/round11/). The outside suite was committed after the last round,
so R6 is rerun from a later commit, on any build or on duramen, and compared with
[`../rounds/r6/`](../rounds/r6/):

```
node selfhost/loop/outside.mjs selfhost/loop/r6/outside-suite.jsonl selfhost/impl/s23-ts --out <file>
```
