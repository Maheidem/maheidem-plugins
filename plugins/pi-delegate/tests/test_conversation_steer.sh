#!/usr/bin/env bash
# Integration-level: exercises the REAL FIFO plumbing (startFifoRelay,
# ctx.injectSteer) by running `send` in the background against a stub `pi`
# that sleeps mid-turn, then concurrently invoking `conversation steer`
# against the same session while `send` is in flight. Bounded throughout --
# no unbounded `wait`.
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

use_stub pi-conv-steer-happy

scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"
name="convtest-steer-$$"
fifo_file="$(pi_lock_path "$scratch" "$name").fifo"

out_send="$scratch/send.json"
node "$COMPANION" conversation send "$name" "hello, please wait" --json --timeout 15000 > "$out_send" 2>"$scratch/send.stderr" &
send_pid=$!

# Wait (bounded) for the FIFO to appear -- proof `send` actually opened its
# control channel before we try to steer it.
waited=0
until [ -e "$fifo_file" ] || [ "$waited" -ge 100 ]; do
  sleep 0.1
  waited=$((waited + 1))
done
check "fifo appears while send is in flight" test -e "$fifo_file"

out_steer="$scratch/steer.json"
rc=0
node "$COMPANION" conversation steer "$name" "GAMMA marker" --json > "$out_steer" || rc=$?
check "steer: exit code 0" test "$rc" -eq 0
assert_json "steer: ok:true" "$out_steer" 'r.ok === true'
assert_json "steer: queued:true" "$out_steer" 'r.queued === true'

# steer must return well before `send` (which is still asleep in the stub).
check "steer returned while send is still running" bash -c "kill -0 $send_pid 2>/dev/null"

# Bounded wait for the background `send` to finish (stub sleeps 1.5s).
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
assert_json "send: steered array contains the GAMMA marker" "$out_send" \
  'Array.isArray(r.steered) && r.steered.includes("GAMMA marker")'

check "fifo cleaned up after send exits" test ! -e "$fifo_file"

finish
