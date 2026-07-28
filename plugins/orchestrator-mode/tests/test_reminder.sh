#!/usr/bin/env bash
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/helpers.sh"

# mode off -> nothing injected
new_proj "off"
run_case "reminder/off no injection" inject-reminder.py \
  "{\"cwd\":\"$TMP/proj\"}" 0 "__EMPTY__" ""

# mode on -> READ-ONLY reminder, mentions Workflow/WebFetch/WebSearch
new_proj "on"
run_case "reminder/on READ-ONLY" inject-reminder.py \
  "{\"cwd\":\"$TMP/proj\"}" 0 "READ-ONLY" ""
run_case "reminder/on mentions Workflow" inject-reminder.py \
  "{\"cwd\":\"$TMP/proj\"}" 0 "Workflow" ""
run_case "reminder/on mentions WebFetch" inject-reminder.py \
  "{\"cwd\":\"$TMP/proj\"}" 0 "WebFetch" ""
run_case "reminder/on mentions WebSearch" inject-reminder.py \
  "{\"cwd\":\"$TMP/proj\"}" 0 "WebSearch" ""

# mode pi -> mentions pi-delegate
new_proj "pi"
run_case "reminder/pi mentions pi-delegate" inject-reminder.py \
  "{\"cwd\":\"$TMP/proj\"}" 0 "pi-delegate" ""

# mode wf -> mentions Workflow tool
new_proj "wf"
run_case "reminder/wf mentions Workflow tool" inject-reminder.py \
  "{\"cwd\":\"$TMP/proj\"}" 0 "Workflow tool" ""

# mode on + allowed-models -> names models AND says model is required (not "allowed to omit")
new_proj "on allowed-models=sonnet,opus"
run_case "reminder/on+allowlist names models" inject-reminder.py \
  "{\"cwd\":\"$TMP/proj\"}" 0 "sonnet" ""
run_case "reminder/on+allowlist requires model" inject-reminder.py \
  "{\"cwd\":\"$TMP/proj\"}" 0 "NOT allowed" ""

# corrupted state (garbage token) -> fail open, no injection, but stderr warning
# (get_state fails open silently; the T5 warning is shared via _state.py import)
new_proj "banana"
run_case "reminder/corrupted state no injection" inject-reminder.py \
  "{\"cwd\":\"$TMP/proj\"}" 0 "__EMPTY__" "unrecognized state-file mode token"

echo
echo "test_reminder.sh: $pass/$total passed"
[ "$fail" -eq 0 ]
