#!/usr/bin/env bash
# wait-for-idle.sh — poll a tmux pane until its content STOPS changing.
#
# Use when you do NOT know the app's ready glyph (unknown/unfamiliar TUI, or
# a heavy app like `claude` whose banner + startup gates vary). Instead of
# matching a prompt regex, this declares "ready" once the captured pane is
# byte-identical across N consecutive polls — i.e. the app has stopped
# redrawing and is sitting idle waiting for input.
#
# Complements wait-for-pane-text.sh: use THAT when you know the ready regex
# (more precise); use THIS when you don't (more robust, but can't tell an idle
# prompt from an idle *dialog* — see the WARNING below).
#
# WARNING: idle != ready-for-your-input. A startup dialog (e.g. claude's
# "Allow external CLAUDE.md imports?" trust prompt) is also "idle". After this
# returns, capture with `-e` and confirm you're at the real input prompt, not a
# gate you must answer first. See references/tui-testing.md.
#
# Usage:
#   wait-for-idle.sh <target> [stable_polls=3] [timeout_s=60] [interval_s=1]
#
# Exit codes:
#   0 — pane went idle (stable for <stable_polls> consecutive captures)
#   1 — timeout (never stabilized)
#   2 — invalid args / tmux missing
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $(basename "$0") <target> [stable_polls=3] [timeout_s=60] [interval_s=1]" >&2
  exit 2
fi

target="$1"
need="${2:-3}"
timeout="${3:-60}"
interval="${4:-1}"

command -v tmux >/dev/null 2>&1 || { echo "tmux not found in PATH" >&2; exit 2; }

deadline=$(( $(date +%s) + timeout ))
prev=""
stable=0

while (( $(date +%s) < deadline )); do
  cur=$(tmux capture-pane -p -t "$target" -S -200 2>/dev/null || true)
  if [[ -n "$cur" && "$cur" == "$prev" ]]; then
    stable=$((stable + 1))
    (( stable >= need )) && exit 0
  else
    stable=0
  fi
  prev="$cur"
  sleep "$interval"
done

echo "TIMEOUT after ${timeout}s — pane '${target}' never stayed stable for ${need} polls" >&2
exit 1
