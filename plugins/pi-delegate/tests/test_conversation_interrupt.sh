#!/usr/bin/env bash
# Integration-level: real FIFO plumbing + rpcRoundtrip's turnGeneration state
# machine. Runs `send` in the background against a stub `pi` that holds its
# first turn open, concurrently invokes `conversation interrupt` mid-turn, and
# asserts the final result reflects the REPROMPTED turn's answer -- not the
# aborted turn's. This is the specific regression the plan calls out as easy
# to get wrong (latching onto the first agent_settled).
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

use_stub pi-conv-interrupt-happy

scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"
name="convtest-interrupt-$$"
fifo_file="$(pi_lock_path "$scratch" "$name").fifo"

out_send="$scratch/send.json"
node "$COMPANION" conversation send "$name" "original message" --json --timeout 15000 > "$out_send" 2>"$scratch/send.stderr" &
send_pid=$!

waited=0
until [ -e "$fifo_file" ] || [ "$waited" -ge 100 ]; do
  sleep 0.1
  waited=$((waited + 1))
done
check "fifo appears while first turn is held open" test -e "$fifo_file"

out_interrupt="$scratch/interrupt.json"
rc=0
node "$COMPANION" conversation interrupt "$name" "DELTA new prompt" --json > "$out_interrupt" || rc=$?
check "interrupt: exit code 0" test "$rc" -eq 0
assert_json "interrupt: ok:true" "$out_interrupt" 'r.ok === true'
assert_json "interrupt: queued:true" "$out_interrupt" 'r.queued === true'

# Bounded wait for the background `send` to finish.
waited=0
while kill -0 "$send_pid" 2>/dev/null && [ "$waited" -lt 100 ]; do
  sleep 0.1
  waited=$((waited + 1))
done
if kill -0 "$send_pid" 2>/dev/null; then
  kill -9 "$send_pid" 2>/dev/null || true
  fail "send finished within bound"
else
  wait "$send_pid" 2>/dev/null
  send_rc=$?
  check "send: exit code 0" test "$send_rc" -eq 0
fi

assert_json "send: ok:true" "$out_send" 'r.ok === true'
assert_json "send: interrupted:true" "$out_send" 'r.interrupted === true'
assert_json "send: finalText is the REPROMPTED turn's answer, not the aborted turn's" "$out_send" \
  'r.finalText === "DELTA reprompt reply"'
assert_json "send: finalText does NOT contain the pre-abort reply" "$out_send" \
  '!/original pre-abort/.test(r.finalText || "")'

check "fifo cleaned up after send exits" test ! -e "$fifo_file"

finish
