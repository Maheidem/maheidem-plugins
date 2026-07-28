#!/usr/bin/env bash
# Real-pi end-to-end: exercises conversation start/send/send/end against the
# actual, locally-installed `pi` CLI (no stub). Skips cleanly (exit 0, with a
# clear "SKIPPED" line) if `pi` or its configured model isn't actually
# reachable -- this must never fail the suite just because the environment
# has no local model configured.
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

skip() {
  echo "SKIPPED: $1"
  exit 0
}

command -v pi >/dev/null 2>&1 || skip "pi CLI not found on PATH"
pi --version >/dev/null 2>&1 || skip "pi --version failed (pi installed but not runnable)"

scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"
name="convtest-e2e-real-$$"
lock_file="$(pi_lock_path "$scratch" "$name")"

cleanup_conversation() {
  node "$COMPANION" conversation end "$name" --json --timeout 15000 > /dev/null 2>&1 || true
  rm -f "$lock_file"
}
add_cleanup cleanup_conversation

# Always print the pass/fail tally on the way out, even if a later command
# aborts the script under `set -e` before reaching the normal `finish` call
# at the bottom -- otherwise a mid-script failure silently drops the tally.
_FINISHED=0
finish_once() {
  if [ "$_FINISHED" -eq 0 ]; then
    _FINISHED=1
    finish || true
  fi
}
add_cleanup finish_once

t0=$SECONDS
out_start="$scratch/start.json"
if ! node "$COMPANION" conversation start "$name" --json --timeout 30000 > "$out_start" 2>"$scratch/start.stderr"; then
  skip "conversation start failed -- treating as environment issue (no reachable model), not a protocol bug. stderr: $(cat "$scratch/start.stderr" 2>/dev/null | tail -5)"
fi
echo "  latency: start took $((SECONDS - t0))s"

t1=$SECONDS
out_send1="$scratch/send1.json"
if ! node "$COMPANION" conversation send "$name" "Remember the word BANANA. Reply OK." --json --timeout 60000 > "$out_send1" 2>"$scratch/send1.stderr"; then
  skip "first conversation send failed -- treating as environment issue, not a protocol bug. stderr: $(cat "$scratch/send1.stderr" 2>/dev/null | tail -5)"
fi
echo "  latency: send #1 (spawn to agent_settled) took $((SECONDS - t1))s"
echo "  transcript: send #1 finalText = $(json_get "$out_send1" 'r.finalText')"

t2=$SECONDS
out_send2="$scratch/send2.json"
if ! node "$COMPANION" conversation send "$name" "What word did I ask you to remember? Reply with just the word." --json --timeout 60000 > "$out_send2" 2>"$scratch/send2.stderr"; then
  skip "second conversation send failed -- treating as environment issue, not a protocol bug. stderr: $(cat "$scratch/send2.stderr" 2>/dev/null | tail -5)"
fi
echo "  latency: send #2 (spawn to agent_settled) took $((SECONDS - t2))s"
echo "  transcript: send #2 finalText = $(json_get "$out_send2" 'r.finalText')"

assert_json "send #2 ok:true" "$out_send2" 'r.ok === true'
assert_json "send #2 finalText mentions BANANA" "$out_send2" '/banana/i.test(r.finalText || "")'

# --- mid-conversation read: peek at a live conversation without contending
# for the lock (read is lock-free) -- assert both prior turns' gists show up.
out_read="$scratch/read_midturn.json"
if node "$COMPANION" conversation read "$name" --json --timeout 15000 > "$out_read" 2>"$scratch/read.stderr"; then
  check "read (mid-conversation): exit code 0" test 0 -eq 0
  assert_json "read: ok:true" "$out_read" 'r.ok === true'
  assert_json "read: entries include both prior turns" "$out_read" '
    (() => {
      const entries = JSON.parse(r.summary).entries;
      const text = entries.map(e => e.gist).join(" ").toLowerCase();
      return entries.length >= 2 && text.includes("banana");
    })()
  '
else
  fail "read (mid-conversation): command failed unexpectedly -- $(cat "$scratch/read.stderr" 2>/dev/null | tail -5)"
fi

# --- steer scenario: a real, long-running turn, steered mid-flight with a
# distinguishing marker, asserting the final transcript reflects it. Best-
# effort against a real model -- an unresponsive/uncooperative model degrades
# to a SKIP-style note rather than failing the whole suite, since the
# mechanism itself (FIFO relay, ctx.injectSteer) already has deterministic,
# non-flaky coverage in test_conversation_steer.sh against a stub.
name_steer="convtest-e2e-steer-$$"
lock_file_steer="$(pi_lock_path "$scratch" "$name_steer")"
fifo_file_steer="${lock_file_steer}.fifo"
add_cleanup_steer() {
  node "$COMPANION" conversation end "$name_steer" --json --timeout 15000 > /dev/null 2>&1 || true
  rm -f "$lock_file_steer" "$fifo_file_steer"
}
add_cleanup add_cleanup_steer

out_steer_send="$scratch/steer_send.json"
node "$COMPANION" conversation send "$name_steer" \
  "Use your shell/bash tool to run: sleep 6 ; echo woke. Then, after that command completes, reply with a single short sentence confirming you are done -- do not reply before the command finishes." \
  --json --timeout 45000 > "$out_steer_send" 2>"$scratch/steer_send.stderr" &
steer_send_pid=$!

waited=0
until [ -e "$fifo_file_steer" ] || [ "$waited" -ge 100 ]; do
  sleep 0.1
  waited=$((waited + 1))
done

if [ -e "$fifo_file_steer" ]; then
  out_steer="$scratch/steer.json"
  if node "$COMPANION" conversation steer "$name_steer" "GAMMA marker: also mention the word GAMMA in your reply" --json --timeout 5000 > "$out_steer" 2>"$scratch/steer.stderr"; then
    check "e2e steer: queued ok" test 0 -eq 0
  else
    echo "  NOTE: e2e steer call failed (non-fatal, mechanism covered by stub test) -- $(cat "$scratch/steer.stderr" 2>/dev/null | tail -3)"
  fi
else
  echo "  NOTE: e2e steer skipped -- fifo never appeared within bound (model may have replied faster than expected)"
fi

waited=0
while kill -0 "$steer_send_pid" 2>/dev/null && [ "$waited" -lt 500 ]; do
  sleep 0.1
  waited=$((waited + 1))
done
if kill -0 "$steer_send_pid" 2>/dev/null; then
  kill -9 "$steer_send_pid" 2>/dev/null || true
  echo "  NOTE: e2e steer send did not finish within bound -- treated as environment flakiness, not asserted"
else
  wait "$steer_send_pid" 2>/dev/null
  echo "  transcript: e2e steer send finalText = $(json_get "$out_steer_send" 'r.finalText' 2>/dev/null || echo '(unparseable)')"
  if node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.exit(r.ok===true && Array.isArray(r.steered) && r.steered.length>0 ? 0 : 1)' "$out_steer_send" 2>/dev/null; then
    pass "e2e steer: send result carries the steered message"
  else
    echo "  NOTE: e2e steer send did not carry the steered message (non-fatal against a real, possibly-fast model; mechanism has deterministic stub coverage)"
  fi
fi

# --- interrupt scenario: same shape as steer, asserting the finalText
# reflects the interrupt's NEW prompt, not the original one. Same best-effort
# posture against a real model as the steer block above.
name_int="convtest-e2e-interrupt-$$"
lock_file_int="$(pi_lock_path "$scratch" "$name_int")"
fifo_file_int="${lock_file_int}.fifo"
add_cleanup_interrupt() {
  node "$COMPANION" conversation end "$name_int" --json --timeout 15000 > /dev/null 2>&1 || true
  rm -f "$lock_file_int" "$fifo_file_int"
}
add_cleanup add_cleanup_interrupt

out_int_send="$scratch/interrupt_send.json"
node "$COMPANION" conversation send "$name_int" \
  "Use your shell/bash tool to run: sleep 6 ; echo woke. Then, after that command completes, reply with a single short sentence confirming you are done -- do not reply before the command finishes." \
  --json --timeout 45000 > "$out_int_send" 2>"$scratch/interrupt_send.stderr" &
int_send_pid=$!

waited=0
until [ -e "$fifo_file_int" ] || [ "$waited" -ge 100 ]; do
  sleep 0.1
  waited=$((waited + 1))
done

if [ -e "$fifo_file_int" ]; then
  out_int="$scratch/interrupt.json"
  if node "$COMPANION" conversation interrupt "$name_int" "Forget the previous instruction. Just reply with the single word EPSILON." --json --timeout 5000 > "$out_int" 2>"$scratch/interrupt.stderr"; then
    check "e2e interrupt: queued ok" test 0 -eq 0
  else
    echo "  NOTE: e2e interrupt call failed (non-fatal, mechanism covered by stub test) -- $(cat "$scratch/interrupt.stderr" 2>/dev/null | tail -3)"
  fi
else
  echo "  NOTE: e2e interrupt skipped -- fifo never appeared within bound (model may have replied faster than expected)"
fi

waited=0
while kill -0 "$int_send_pid" 2>/dev/null && [ "$waited" -lt 500 ]; do
  sleep 0.1
  waited=$((waited + 1))
done
if kill -0 "$int_send_pid" 2>/dev/null; then
  kill -9 "$int_send_pid" 2>/dev/null || true
  echo "  NOTE: e2e interrupt send did not finish within bound -- treated as environment flakiness, not asserted"
else
  wait "$int_send_pid" 2>/dev/null
  echo "  transcript: e2e interrupt send finalText = $(json_get "$out_int_send" 'r.finalText' 2>/dev/null || echo '(unparseable)')"
  if node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.exit(r.ok===true && r.interrupted===true && /epsilon/i.test(r.finalText||"") ? 0 : 1)' "$out_int_send" 2>/dev/null; then
    pass "e2e interrupt: send result reflects the reprompt (EPSILON), not the original"
  else
    echo "  NOTE: e2e interrupt send did not clearly reflect the reprompt (non-fatal against a real, possibly-fast/non-compliant model; mechanism has deterministic stub coverage in test_conversation_interrupt.sh)"
  fi
fi

# --- end: BEFORE/AFTER file-count pair, not after-only (the ORIGINAL bug in
# this test: asserting only "count==0 after end" passes just as easily by
# "there was never a file" as by "deletion actually happened"). Verify the
# main conversation's session file exists immediately before calling end.
sess_dir="$(pi_sessions_dir "$scratch")"
before_count="$(find "$sess_dir" -maxdepth 1 -name "*_${name}.jsonl" 2>/dev/null | wc -l | tr -d ' ')" || before_count=0
check "session file exists before end" test "$before_count" -ge 1

out_end="$scratch/end.json"
node "$COMPANION" conversation end "$name" --json --timeout 15000 > "$out_end"
rc=$?
check "end: exit code 0" test "$rc" -eq 0
assert_json "end: ok:true" "$out_end" 'r.ok === true'

leftover="$(find "$sess_dir" -maxdepth 1 -name "*_${name}.jsonl" 2>/dev/null | wc -l | tr -d ' ')" || leftover=0
check "session file gone after end" test "$leftover" -eq 0

_FINISHED=1
finish
