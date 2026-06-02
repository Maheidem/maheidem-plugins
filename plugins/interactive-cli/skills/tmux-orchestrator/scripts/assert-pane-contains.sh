#!/usr/bin/env bash
# assert-pane-contains.sh — check whether a regex appears in a tmux pane's recent output.
#
# One-shot capture + grep. Prints PASS on match, dumps the pane to stderr on miss.
#
# Usage:
#   assert-pane-contains.sh <target> <pattern> [lines=50]
#
# Examples:
#   assert-pane-contains.sh build 'BUILD SUCCESS'
#   assert-pane-contains.sh %0    'Error: .*not found'  200
#
# Exit codes:
#   0 — pattern matched
#   1 — not found (pane content dumped to stderr)
#   2 — invalid args / tmux missing
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $(basename "$0") <target> <pattern> [lines]" >&2
  exit 2
fi

target="$1"
pattern="$2"
lines="${3:-50}"

command -v tmux >/dev/null 2>&1 || { echo "tmux not found in PATH" >&2; exit 2; }

content=$(tmux capture-pane -p -t "$target" -S "-${lines}" 2>/dev/null || true)

if echo "$content" | grep -qE "$pattern"; then
  echo "PASS: pattern matched in '${target}'"
  exit 0
fi

echo "FAIL: pattern '/${pattern}/' not found in '${target}' (last ${lines} lines)" >&2
echo "--- pane content ---" >&2
echo "$content" >&2
echo "--- end ---" >&2
exit 1
