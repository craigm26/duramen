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
  namespace that shows it only its folder ([`ns-run.sh`](wsl/ns-run.sh)), launched by
  [`b-launch.sh`](wsl/b-launch.sh) and [`r6-launch.sh`](wsl/r6-launch.sh).
- [`r6-task.md`](r6-task.md) and [`r6-suite.md`](r6-suite.md): R6's writer's task, and the
  outside suite's hash, pushed before the first build.
