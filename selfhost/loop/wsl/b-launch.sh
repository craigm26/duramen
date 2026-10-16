#!/usr/bin/env bash
# One blind build of duramen-core by Codex (builder B of CONFIDENCE-3.md's R5): a fresh box holding
# only the brief's SPEC.md, DECISIONS.md and PROMPT.md, and PROMPT.md itself as the prompt, as
# duramen regen gives it to claude -p for builder A. Afterwards the box and the run's records
# (never the login) are packed into ../out for copying.
#   b-launch.sh <run id> <brief folder> [minutes]
set -euo pipefail
RUN=$1; BRIEF=$2; MIN=${3:-120}
R=$HOME/r11
OUT=$(dirname "$(realpath "$0")")/../out   # beside the folder these scripts were copied to
install -m 755 "$(dirname "$(realpath "$0")")/ns-run.sh" "$R/ns-run.sh"
W="$R/boxes/$RUN"
mkdir "$W"
cp "$BRIEF/SPEC.md" "$BRIEF/DECISIONS.md" "$BRIEF/PROMPT.md" "$W/"
(cd "$W" && sha256sum SPEC.md DECISIONS.md PROMPT.md) > "$R/boxes/$RUN.inputs.sha256"
CODEX_MINUTES=$MIN "$R/ns-run.sh" "$W" "$W/PROMPT.md" "$R/io/$RUN" || true
mkdir -p "$OUT"
tar -czf "$OUT/$RUN-box.tgz" -C "$R/boxes" "$RUN"
cd "$R/io/$RUN"
files=(prompt.md transcript.jsonl stderr.txt started finished)
[ -d home/sessions ] && files+=(home/sessions)
tar -czf "$OUT/$RUN-io.tgz" "${files[@]}"
cp "$R/boxes/$RUN.inputs.sha256" "$OUT/"
echo done > "$OUT/$RUN.done"
