#!/usr/bin/env bash
# UserPromptSubmit reminder: built from the effective config, correct JSON shape.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/helpers.sh"

remind() { run_case "$1" inject-reminder.py "{\"cwd\":\"$PROJ\"}" 0 "$2" "${3:-}"; }

new_proj '{"mode":"off"}'
remind "off: nothing injected" "__EMPTY__"
new_proj ''
remind "no config: nothing injected" "__EMPTY__"

new_proj '{"mode":"on"}'
total=$((total+1))
if printf '{"cwd":"%s"}' "$PROJ" | python3 "$PLUGIN_ROOT/hooks/inject-reminder.py" | python3 -c "
import json, sys; o = json.load(sys.stdin)['hookSpecificOutput']
assert o['hookEventName'] == 'UserPromptSubmit' and 'READ-ONLY' in o['additionalContext']"; then
  echo "PASS: on: hookSpecificOutput.additionalContext shape"; pass=$((pass+1))
else
  echo "FAIL: on: JSON shape"; fail=$((fail+1))
fi
remind "on: names Agent/Task and Workflow" "Agent/Task, Workflow"
remind "on: mentions memory write exemption" ".remember/"
remind "on: says Monitor is blocked" "Monitor"
remind "on: doesn't claim ALL MCP blocked" "mcp__plugin_pi-delegate_pi-delegate__*"

new_proj '{"mode":"wf","main-allow":["mcp__okto-neuron__*"]}'
printf '{"main-allow":["mcp__waha-whatsapp__whatsapp_send_text"]}' > "$CFG/orchestrator-mode.json"
remind "wf: Workflow + Explore only" "Explore scout only"
remind "wf: lists project main-allow" "mcp__okto-neuron__*"
remind "wf: lists user-wide main-allow" "mcp__waha-whatsapp__whatsapp_send_text"

new_proj '{"mode":"pi","allowed-models":["haiku"]}'
remind "pi: pi-delegate path" "/pi-delegate:delegate"
remind "pi: model allowlist sentence" "Model allowlist: haiku"

new_proj '{"mode":"on",'
remind "malformed config: nothing, warns" "__EMPTY__" "treating as OFF"
run_case "unparseable stdin: nothing" inject-reminder.py 'nope' 0 "__EMPTY__" "__EMPTY__"

echo
echo "test_reminder.sh: $pass/$total passed"
[ "$fail" -eq 0 ]
