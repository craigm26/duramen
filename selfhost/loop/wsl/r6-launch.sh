#!/usr/bin/env bash
# R6's outside-suite writer, second attempt (the first lost every command to a sandbox startup
# error and wrote nothing): a fresh box with the 0.12.0 SPEC.md and DECISIONS.md and the task.
set -euo pipefail
R=$HOME/r11
install -m 755 "$(dirname "$(realpath "$0")")/ns-run.sh" "$R/ns-run.sh"
W="$R/boxes/r6-writer-2"
mkdir "$W"
cp "$R/brief-0.12.0/SPEC.md" "$R/brief-0.12.0/DECISIONS.md" "$W/"
cp "$R/prompts/r6-task.md" "$W/TASK.md"
(cd "$W" && sha256sum SPEC.md DECISIONS.md TASK.md) > "$R/boxes/r6-writer-2.inputs.sha256"
CODEX_MINUTES=240 "$R/ns-run.sh" "$W" "$R/prompts/r6-task.md" "$R/io/r6-writer-2"
