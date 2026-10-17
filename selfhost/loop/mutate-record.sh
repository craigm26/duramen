#!/usr/bin/env bash
# duramen's own `mutate` on duramen-core's record (CONFIDENCE-3.md, "Outside us"): how many small
# mistakes planted in the oracle, duramen itself, the record's examples catch. `duramen mutate`
# mutates only files inside the oracle's folder, so a copy of spec/ is made with duramen's own
# bin/, src/, lib/ and package.json in a folder `.duramen/` inside it (which the record leaves
# out, as it leaves out every name starting with "."), and the oracle line points there.
#   mutate-record.sh <commit> <out dir> [limit per file] [jobs]
set -euo pipefail
REV=$1; OUT=$(realpath -m "$2"); LIMIT=${3:-100}; JOBS=${4:-2}
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
W=$(mktemp -d)
git -C "$ROOT" archive "$REV" | tar -x -C "$W"
REC="$W/record"
mkdir -p "$REC/.duramen" "$OUT"
cp -r "$W/spec/." "$REC/"
cp -r "$W/bin" "$W/src" "$W/lib" "$W/package.json" "$REC/.duramen/"
sed -i 's#^oracle node ../bin/duramen.mjs serve$#oracle node .duramen/bin/duramen.mjs serve#' "$REC/00-spec.duramen"
cd "$W"
node bin/duramen.mjs check "$REC" >&2
for f in parse record check suite serve driver types; do
  node bin/duramen.mjs mutate "$REC" --file "$REC/.duramen/src/$f.mjs" --limit "$LIMIT" --jobs "$JOBS" --json > "$OUT/duramen-$REV-$f.json"
done
rm -rf "$W"
