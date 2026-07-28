#!/usr/bin/env bash
# Two sub-cases: (a) a lockfile held by a live PID -> send fails loud, no
# reclaim; (b) a lockfile pointing at a dead PID -> send reclaims it and
# succeeds, ending with the lockfile owned by the new (stub pi child's caller,
# i.e. released) state.
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"
name="convtest-lock-$$"
lock_file="$(pi_lock_path "$scratch" "$name")"
mkdir -p "$(dirname "$lock_file")"

# --- (a) live PID holds the lock ---
sleep 30 &
holder_pid=$!
echo "$holder_pid" > "$lock_file"

use_stub pi-conv-send-happy
out_a="$scratch/contended.json"
rc=0
node "$COMPANION" conversation send "$name" "hello" --json --timeout 5000 > "$out_a" || rc=$?

check "(a) nonzero exit on contention" test "$rc" -ne 0
assert_json "(a) ok:false" "$out_a" 'r.ok === false'
assert_json "(a) lockHeldByPid matches live holder" "$out_a" "r.lockHeldByPid === $holder_pid"
check "(a) holder still alive (no reclaim)" kill -0 "$holder_pid"
check "(a) lockfile untouched, still names holder" grep -q "^$holder_pid$" "$lock_file"

kill "$holder_pid" 2>/dev/null || true
wait "$holder_pid" 2>/dev/null || true
rm -f "$lock_file"

# --- (b) stale lock, dead PID -> reclaimed ---
( exit 0 ) &
dead_pid=$!
wait "$dead_pid" 2>/dev/null || true
# dead_pid is now guaranteed exited; confirm it is indeed not alive before using it
check "(b) chosen pid is actually dead" bash -c "! kill -0 $dead_pid 2>/dev/null"
echo "$dead_pid" > "$lock_file"

out_b="$scratch/reclaimed.json"
rc=0
node "$COMPANION" conversation send "$name" "hello" --json --timeout 5000 > "$out_b" || rc=$?

check "(b) exit code 0 after reclaim" test "$rc" -eq 0
assert_json "(b) ok:true" "$out_b" 'r.ok === true'
assert_json "(b) finalText from stub" "$out_b" 'r.finalText === "stub reply text"'
check "(b) lockfile released after successful send" test ! -e "$lock_file"

finish
