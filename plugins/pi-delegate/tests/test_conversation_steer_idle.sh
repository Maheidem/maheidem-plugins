#!/usr/bin/env bash
# Idle-conversation failure modes for steer/interrupt -- no `pi` needed, these
# verbs never spawn anything when idle.
#   (a) no FIFO/lock at all -> ok:false "conversation is idle"
#   (b) a STALE FIFO file exists with a dead PID recorded in the lockfile ->
#       must still report idle via the PID-liveness check, not by accidentally
#       succeeding a write into an unread pipe (existence of the FIFO path is
#       NOT liveness).
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"

# --- (a) nothing on disk at all ---
name_a="convtest-idle-none-$$"
out_a="$scratch/steer_none.json"
rc=0
node "$COMPANION" conversation steer "$name_a" "hello" --json > "$out_a" || rc=$?
check "steer, no lock/fifo: exit code 1" test "$rc" -eq 1
assert_json "steer, no lock/fifo: ok:false" "$out_a" 'r.ok === false'
assert_json "steer, no lock/fifo: idle error message" "$out_a" \
  '/conversation is idle/.test(r.errorMessage || "")'

out_a_int="$scratch/interrupt_none.json"
rc=0
node "$COMPANION" conversation interrupt "$name_a" "hello" --json > "$out_a_int" || rc=$?
check "interrupt, no lock/fifo: exit code 1" test "$rc" -eq 1
assert_json "interrupt, no lock/fifo: ok:false" "$out_a_int" 'r.ok === false'
assert_json "interrupt, no lock/fifo: idle error message" "$out_a_int" \
  '/conversation is idle/.test(r.errorMessage || "")'

# --- (b) stale FIFO + dead-PID lockfile (simulating a crashed `send`) ---
name_b="convtest-idle-stale-$$"
lock_file="$(pi_lock_path "$scratch" "$name_b")"
fifo_file="${lock_file}.fifo"
mkdir -p "$(dirname "$lock_file")"

# A PID essentially guaranteed to be dead: PID 1 exists (init/launchd) but
# under a different user so EPERM would read as "alive" -- use a very high,
# almost-certainly-unassigned PID instead so kill(pid, 0) reliably reports ESRCH.
dead_pid=999999
echo "$dead_pid" > "$lock_file"
mkfifo "$fifo_file" 2>/dev/null || echo "not a real fifo" > "$fifo_file" # either way: no live reader
check "stale-fifo case: lockfile exists" test -e "$lock_file"
check "stale-fifo case: fifo path exists" test -e "$fifo_file"

out_b="$scratch/steer_stale.json"
rc=0
node "$COMPANION" conversation steer "$name_b" "hello" --json > "$out_b" || rc=$?
check "steer, stale fifo + dead pid: exit code 1" test "$rc" -eq 1
assert_json "steer, stale fifo + dead pid: ok:false" "$out_b" 'r.ok === false'
assert_json "steer, stale fifo + dead pid: idle error message (liveness beats fifo existence)" "$out_b" \
  '/conversation is idle/.test(r.errorMessage || "")'

out_b_int="$scratch/interrupt_stale.json"
rc=0
node "$COMPANION" conversation interrupt "$name_b" "hello" --json > "$out_b_int" || rc=$?
check "interrupt, stale fifo + dead pid: exit code 1" test "$rc" -eq 1
assert_json "interrupt, stale fifo + dead pid: ok:false" "$out_b_int" 'r.ok === false'
assert_json "interrupt, stale fifo + dead pid: idle error message" "$out_b_int" \
  '/conversation is idle/.test(r.errorMessage || "")'

rm -f "$lock_file" "$fifo_file"

finish
