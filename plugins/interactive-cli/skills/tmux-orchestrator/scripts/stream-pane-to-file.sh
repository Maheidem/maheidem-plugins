#!/usr/bin/env bash
# stream-pane-to-file.sh — open a pipe-pane that appends a tmux pane's output to a file.
#
# Wraps `tmux pipe-pane -o "cat >> <file>"` with a simple "close on Ctrl-C / exit"
# behavior when run in the foreground. If run with --detach, opens the pipe and exits;
# caller is responsible for `tmux pipe-pane -t <target>` (no command) to close.
#
# Usage:
#   stream-pane-to-file.sh <target> <logfile> [--detach]
#
# Examples (foreground — Ctrl-C to close pipe and exit):
#   stream-pane-to-file.sh build /tmp/build.full.log
#
# Detached (pipe stays open until you close it):
#   stream-pane-to-file.sh build /tmp/build.full.log --detach
#   # ...later...
#   tmux pipe-pane -t build
#
# Exit codes:
#   0 — opened (and closed cleanly, if foreground)
#   2 — invalid args / tmux missing
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $(basename "$0") <target> <logfile> [--detach]" >&2
  exit 2
fi

target="$1"
logfile="$2"
mode="${3:-foreground}"

command -v tmux >/dev/null 2>&1 || { echo "tmux not found in PATH" >&2; exit 2; }

# Ensure the parent dir exists; do not clobber existing file (we append).
mkdir -p "$(dirname "$logfile")"
touch "$logfile"

close_pipe() {
  tmux pipe-pane -t "$target" 2>/dev/null || true
  echo "stream closed for '${target}' -> ${logfile}" >&2
}

# Open the pipe (idempotent with -o)
tmux pipe-pane -t "$target" -o "cat >> $(printf %q "$logfile")"
echo "streaming '${target}' -> ${logfile}" >&2

if [[ "$mode" == "--detach" ]]; then
  exit 0
fi

trap close_pipe EXIT INT TERM

# Block: tail the log so the user sees output land; Ctrl-C closes the pipe.
tail -F "$logfile"
