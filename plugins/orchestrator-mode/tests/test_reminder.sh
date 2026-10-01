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
remind "pi: no pin -> says so, points at /mode pi" "No pi model is pinned"
mkdir -p "$PROJ/.claude"
printf -- '---\nprovider: mac-m3\nmodel: qwen3.8-flash@adaptive\n---\n' > "$PROJ/.claude/pi-delegate.local.md"
remind "pi: names the pinned model" "pinned model mac-m3/qwen3.8-flash@adaptive"
remind "pi: names the 0.11 pi tools" "pi_agent starts a pi child, pi_send_message talks to it, pi_answer answers its questions, pi_stop stops it"
total=$((total+1))
if printf '{"cwd":"%s"}' "$PROJ" | python3 "$PLUGIN_ROOT/hooks/inject-reminder.py" | grep -qE 'pi_task|pi_conversation|pi_respond'; then
  echo "FAIL: pi: reminder still names a renamed 0.10 tool"; fail=$((fail+1))
else
  echo "PASS: pi: reminder names no renamed 0.10 tool"; pass=$((pass+1))
fi
total=$((total+1))
if printf '{"cwd":"%s"}' "$PROJ" | python3 "$PLUGIN_ROOT/hooks/inject-reminder.py" | grep -q "Model allowlist"; then
  echo "FAIL: pi: family allowlist sentence should not appear"; fail=$((fail+1))
else
  echo "PASS: pi: family allowlist sentence not shown (the pin governs)"; pass=$((pass+1))
fi
new_proj '{"mode":"on","allowed-models":["haiku"]}'
remind "on: model allowlist sentence still shown" "Model allowlist: haiku"

new_proj '{"mode":"on",'
remind "malformed config: nothing, warns" "__EMPTY__" "treating as OFF"
run_case "unparseable stdin: nothing" inject-reminder.py 'nope' 0 "__EMPTY__" "__EMPTY__"

echo
echo "test_reminder.sh: $pass/$total passed"
[ "$fail" -eq 0 ]
