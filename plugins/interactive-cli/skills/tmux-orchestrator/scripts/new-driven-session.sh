#!/usr/bin/env bash
# new-driven-session.sh — spawn a detached, named tmux session running a command.
#
# Replaces terminal-testing/scripts/spawn-pi-test.sh — generalized: no longer
# pi-specific, no longer creates a test cwd. Pure "make me a session" helper.
#
# Usage:
#   new-driven-session.sh <session-name> <command> [args...]
#
# Examples:
#   new-driven-session.sh build 'make all'
#   new-driven-session.sh repl python3 -i
#   eval "$(new-driven-session.sh probe sleep 60)"
#
# Eval-friendly output:
#   TMUX_SESSION=<name>
#   PANE_ID=%N
#
# Exit codes:
#   0 — created
#   1 — session with same name already exists (use a unique name)
#   2 — invalid arguments / tmux missing
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $(basename "$0") <session-name> <command> [args...]" >&2
  exit 2
fi

session="$1"; shift
cmd="$*"

command -v tmux >/dev/null 2>&1 || { echo "tmux not found in PATH" >&2; exit 2; }

if tmux has-session -t "$session" 2>/dev/null; then
  echo "session '$session' already exists; pick a unique name (e.g. \"$session-\$\$\")" >&2
  exit 1
fi

tmux new-session -d -s "$session" "$cmd"
pane=$(tmux list-panes -t "$session" -F '#{pane_id}' | head -1)

printf 'TMUX_SESSION=%s\nPANE_ID=%s\n' "$session" "$pane"
