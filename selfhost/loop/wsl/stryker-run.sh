#!/usr/bin/env bash
# Stryker on one build of duramen-core (CONFIDENCE-3.md, "Outside us"): the share of the build's
# mutants that the duramen-core suite of the build's own version kills, run and judged by
# duramen (`duramen run`), a measurement beside the loop.
#   stryker-run.sh <build> <commit holding the build and its spec> [concurrency]
set -euo pipefail
BUILD=$1; REV=$2; CONC=${3:-8}
export PATH="$HOME/r11/tools/node/bin:/usr/local/bin:/usr/bin:/bin"   # Linux node and npm only
R=$HOME/r11/stryker
OUT=$(dirname "$(realpath "$0")")/../out
mkdir -p "$R" "$OUT"
cd "$R"
if [ ! -d duramen ]; then git clone -q https://github.com/craigm26/duramen.git duramen; fi
git -C duramen fetch -q origin round-three
WT="$R/wt-$REV"
[ -d "$WT" ] || git -C duramen worktree add -q --detach "$WT" "$REV"
if [ ! -x tool/node_modules/.bin/stryker ] || ! head -c 2 tool/node_modules/.bin/stryker | grep -q '#!'; then rm -rf tool; fi
if [ ! -d tool/node_modules/@stryker-mutator/core ]; then mkdir -p tool; (cd tool && npm init -y >/dev/null && npm i -D @stryker-mutator/core@10.0.0 >/dev/null 2>&1); fi
W="$R/work/$BUILD"
rm -rf "$W"; mkdir -p "$R/work"
cp -r "$WT/selfhost/impl/$BUILD" "$W"
ln -s "$R/tool/node_modules" "$W/node_modules"
cat > "$W/stryker.config.json" <<CONF
{
  "testRunner": "command",
  "commandRunner": { "command": "node $WT/bin/duramen.mjs run $WT/spec --impl ." },
  "mutate": ["**/*.ts", "!**/*.test.ts", "!test/**", "!tests/**", "!tools/**", "!node_modules/**", "!fixtures/**", "!.stryker-tmp/**"],
  "coverageAnalysis": "off",
  "concurrency": $CONC,
  "timeoutMS": 180000,
  "reporters": ["json", "clear-text"],
  "tempDirName": ".stryker-tmp"
}
CONF
cd "$W"
date -u +%FT%TZ > "$OUT/$BUILD-stryker.started"
"$R/tool/node_modules/.bin/stryker" run > "$R/$BUILD-stryker.log" 2>&1 || true
date -u +%FT%TZ > "$OUT/$BUILD-stryker.finished"
cp reports/mutation/mutation.json "$OUT/$BUILD-mutation.json" || true
tail -40 "$R/$BUILD-stryker.log" > "$OUT/$BUILD-stryker-tail.txt"
echo done > "$OUT/$BUILD-stryker.done"
