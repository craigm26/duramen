#!/usr/bin/env bash
# Run Codex on one box in a mount namespace that shows it only that box, a Codex home of its own
# and its tools: every drive under /mnt, WSLg's view of the distro (/mnt/wslg/distro), every home
# folder (/home) and WSL's interop sockets (/run/WSL) are covered with empty file systems, so no
# other copy of duramen, and no other run's files, are reachable by path. The namespace's own
# files live on a tmpfs at /srv.
#   [CODEX_MINUTES=<n>] ns-run.sh <box dir> <prompt file> <io dir> [codex exec options...]
# CODEX_MINUTES stops Codex after that many minutes (exit 124); unset or 0, no limit.
# The run's Codex home is <io dir>/home, a fresh copy of the login and the config; afterwards it
# also holds the session's own logs. A login Codex refreshed during the run is copied back, so
# that the next run starts from it.
set -euo pipefail
R=$HOME/r11
BOX=$(realpath "$1"); PROMPT=$(realpath "$2"); IO=$(realpath -m "$3"); shift 3
if [ -e "$IO" ]; then echo "io folder exists: $IO" >&2; exit 2; fi
mkdir -p "$IO/home"
cp "$PROMPT" "$IO/prompt.md"
cp "$R/codex-home/auth.json" "$R/codex-home/config.toml" "$IO/home/"
chmod 600 "$IO/home/auth.json"
before=$(sha256sum "$IO/home/auth.json" | cut -d' ' -f1)
date -u +%FT%TZ > "$IO/started"
set +e
unshare --user --map-root-user --mount --propagation private bash -s "$BOX" "$IO" "$R" "$@" <<'INNER'
set -euo pipefail
BOX=$1; IO=$2; R=$3; shift 3
NS=/srv/ns
mount -t tmpfs none /srv
mkdir -p "$NS/box" "$NS/home" "$NS/tools" "$NS/io" "$NS/tmp"
mount --bind "$BOX" "$NS/box"
mount --bind "$IO/home" "$NS/home"
mount --bind "$R/tools" "$NS/tools"
mount --bind "$IO" "$NS/io"
for d in /mnt/*; do [ "$d" = /mnt/wslg ] || mount -t tmpfs none "$d"; done
mount -t tmpfs none /mnt/wslg/distro
# Codex's sandbox (bwrap) finds /tmp's files through WSLg's view of the distro, so that one
# folder of the view shows /tmp again.
mkdir -p /mnt/wslg/distro/tmp
mount --rbind /tmp /mnt/wslg/distro/tmp
mount -t tmpfs none /home
mount -t tmpfs none /run/WSL 2>/dev/null || true
cd "$NS/box"
export TMPDIR="$NS/tmp" XDG_RUNTIME_DIR="$NS/tmp" HOME="$NS/home" CODEX_HOME="$NS/home" PATH="$NS/tools/node/bin:$NS/tools/codex/node_modules/.bin:/usr/local/bin:/usr/bin:/bin"
unset WSL_INTEROP WSLENV
set +e
limit=()
if [ "${CODEX_MINUTES:-0}" != 0 ]; then limit=(timeout --kill-after=60 "${CODEX_MINUTES}m"); fi
"${limit[@]}" codex exec --skip-git-repo-check -C "$NS/box" --json "$@" - < "$NS/io/prompt.md" > "$NS/io/transcript.jsonl" 2> "$NS/io/stderr.txt"
echo "codex exit $?" >> "$NS/io/stderr.txt"
INNER
echo "namespace exit $?" >> "$IO/stderr.txt"
date -u +%FT%TZ > "$IO/finished"
after=$(sha256sum "$IO/home/auth.json" | cut -d' ' -f1)
if [ "$before" != "$after" ]; then
  cp "$IO/home/auth.json" "$R/codex-home/auth.json"
  echo "the login was refreshed during the run and copied back" >> "$IO/stderr.txt"
fi
