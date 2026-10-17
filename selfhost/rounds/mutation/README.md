# Mutation scores (CONFIDENCE-3.md, "Outside us")

- `stryker-s23-ts.json.gz` and `stryker-s24-ts.json.gz`: Stryker 10.0.0's reports for round
  eleven's two builds (mutation-testing-elements JSON, schema 1.0): every mutant with its status
  and, for each one killed, the output of `duramen run` naming the cases that failed. Made by
  [`../../loop/wsl/stryker-run.sh`](../../loop/wsl/stryker-run.sh) on Craig's PC; the paths there
  are replaced, the duramen worktree at `6c847eb` by `<duramen 6c847eb>`, the build's work folder
  by `<build>` and the home folder by `$HOME`. `stryker-s23-ts.txt` and `stryker-s24-ts.txt` are
  the end of each run's log, with Stryker's table by file.
- `duramen-6c847eb-<file>.json`: duramen's own `mutate` on seven files of `src/`, as
  [`../../loop/mutate-record.sh`](../../loop/mutate-record.sh) `6c847eb <dir> 100 4` wrote them.
  A first run of the same commands, before the script was written, gave the same results.

The scores are in [CONFIDENCE-3.md](../../../CONFIDENCE-3.md#outside-us-1), under Results.
