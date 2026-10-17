#!/usr/bin/env bash
# After the last round: pack R6's outside suite, the writer's notes and both attempts' records
# (never the login) for copying, with their hashes.
set -euo pipefail
R=$HOME/r11
OUT=$(dirname "$(realpath "$0")")/../out
mkdir -p "$OUT"
cd "$R"
sha256sum boxes/r6-writer-2/outside-suite.jsonl boxes/r6-writer-2/NOTES.md io/r6-writer-2/transcript.jsonl io/r6-writer/transcript.jsonl > "$OUT/r6.sha256"
files=(boxes/r6-writer-2/outside-suite.jsonl boxes/r6-writer-2/NOTES.md boxes/r6-writer-2.inputs.sha256)
for a in r6-writer r6-writer-2; do
  for f in prompt.md transcript.jsonl stderr.txt started finished; do [ -e "io/$a/$f" ] && files+=("io/$a/$f"); done
  [ -d "io/$a/home/sessions" ] && files+=("io/$a/home/sessions")
done
tar -czf "$OUT/r6.tgz" "${files[@]}"
tar -tzf "$OUT/r6.tgz" | grep -c . ; tar -tzf "$OUT/r6.tgz" | grep -i auth || echo "no login in the archive"
cat "$OUT/r6.sha256"
