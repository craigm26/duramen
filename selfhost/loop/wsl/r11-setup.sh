#!/usr/bin/env bash
# Round eleven's setup in WSL: install the namespace script, keep only the login and the config in
# the shared Codex home (the probes' state moves aside), and make the R6 writer's box from the
# 0.12.0 brief's SPEC.md and DECISIONS.md plus its task.
set -euo pipefail
S=$(dirname "$(realpath "$0")")   # the folder these scripts were copied to
R=$HOME/r11
install -m 755 "$S/ns-run.sh" "$R/ns-run.sh"
mkdir -p "$R/prompts" "$R/boxes" "$R/io" "$R/old-home-state"
shopt -s dotglob nullglob
for f in "$R"/codex-home/*; do
  case "$(basename "$f")" in auth.json|config.toml) ;; *) mv "$f" "$R/old-home-state/" ;; esac
done
ls -la "$R/codex-home"
mkdir -p "$R/brief-0.12.0"
cp "$S/brief-0.12.0/SPEC.md" "$S/brief-0.12.0/DECISIONS.md" "$S/brief-0.12.0/PROMPT.md" "$R/brief-0.12.0/"
cp "$S/r6-task.md" "$R/prompts/r6-task.md"
W="$R/boxes/r6-writer"
if [ -e "$W" ]; then echo "writer box exists" >&2; exit 2; fi
mkdir -p "$W"
cp "$R/brief-0.12.0/SPEC.md" "$R/brief-0.12.0/DECISIONS.md" "$W/"
cp "$R/prompts/r6-task.md" "$W/TASK.md"
cd "$W" && sha256sum SPEC.md DECISIONS.md TASK.md && ls -la
