#!/usr/bin/env bash
# wait-for-pane-text.sh — poll a tmux pane until its capture matches a regex.
#
# Generalizes terminal-testing/scripts/wait-for-prompt.sh — works for any
# regex, not just shell prompts.
#
# Default behavior: exit 0 on the FIRST capture that matches the regex.
# With --quiet (or env QUIET=1), additionally require two consecutive
# stable captures (no change between polls) before declaring success. Use
# this for prompt-readiness where you want to know the TUI is idle, not just
# that the glyph briefly flashed.
#
# Usage:
#   wait-for-pane-text.sh [--quiet] <target> <regex> [timeout_s=30] [poll_interval_s=0.5]
#
# <target> can be a session name, %pane-id, session:window.pane — anything
# valid as `tmux -t`.
#
# Examples:
#   wait-for-pane-text.sh build 'BUILD SUCCESS'                # job completion
#   wait-for-pane-text.sh --quiet repl '^>>> '   10            # python REPL idle
#   wait-for-pane-text.sh %0 'Error:'  20 0.25                 # error appeared
#
# Exit codes:
#   0 — regex matched (and stable, if --quiet)
#   1 — timeout
#   2 — invalid args / tmux missing
set -euo pipefail

quiet_mode="${QUIET:-0}"
if [[ "${1:-}" == "--quiet" ]]; then quiet_mode=1; shift; fi

if [[ $# -lt 2 ]]; then
  echo "usage: $(basename "$0") [--quiet] <target> <regex> [timeout_s] [poll_interval_s]" >&2
  exit 2
fi

target="$1"
regex="$2"
timeout="${3:-30}"
interval="${4:-0.5}"

command -v tmux >/dev/null 2>&1 || { echo "tmux not found in PATH" >&2; exit 2; }

deadline=$(( $(date +%s) + timeout ))
prev=""
stable_matches=0

while (( $(date +%s) < deadline )); do
  # Capture full visible pane + a bit of scrollback. tmux pads visible pane
  # with blank lines to terminal height, so tail-only checks miss real text.
  cur=$(tmux capture-pane -p -t "$target" -S -100 2>/dev/null || true)
  if echo "$cur" | grep -qE "$regex"; then
    if [[ "$quiet_mode" == "1" ]]; then
      if [[ "$cur" == "$prev" ]]; then
        stable_matches=$((stable_matches + 1))
        (( stable_matches >= 2 )) && exit 0
      else
        stable_matches=1
      fi
    else
      exit 0
    fi
  else
    stable_matches=0
  fi
  prev="$cur"
  sleep "$interval"
done

echo "TIMEOUT after ${timeout}s waiting for /${regex}/ in '${target}'" >&2
echo "--- last capture ---" >&2
echo "$prev" >&2
exit 1
