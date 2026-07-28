#!/usr/bin/env bash
# Drives conversation start/send/status/end against a stub RPC pi, happy path.
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"
name="convtest-happy-$$"

# --- start (no --message: just a get_state roundtrip) ---
use_stub pi-conv-status-happy
out_start="$scratch/start.json"
node "$COMPANION" conversation start "$name" --json --timeout 5000 > "$out_start"
rc=$?
check "start: exit code 0" test "$rc" -eq 0
assert_json "start: ok:true" "$out_start" 'r.ok === true'
assert_json "start: sessionName echoed" "$out_start" "r.sessionName === \"$name\""
assert_json "start: sessionId from get_state" "$out_start" 'r.sessionId === "stub-session-id"'

# --- send ---
use_stub pi-conv-send-happy
out_send="$scratch/send.json"
node "$COMPANION" conversation send "$name" "remember the word BANANA" --json --timeout 5000 > "$out_send"
rc=$?
check "send: exit code 0" test "$rc" -eq 0
assert_json "send: ok:true" "$out_send" 'r.ok === true'
assert_json "send: finalText from stub" "$out_send" 'r.finalText === "stub reply text"'
assert_json "send: sessionName echoed" "$out_send" "r.sessionName === \"$name\""

# --- status (read-only, no lock) ---
use_stub pi-conv-status-happy
out_status="$scratch/status.json"
node "$COMPANION" conversation status "$name" --json --timeout 5000 > "$out_status"
rc=$?
check "status: exit code 0" test "$rc" -eq 0
assert_json "status: ok:true" "$out_status" 'r.ok === true'
assert_json "status: sessionId reported" "$out_status" 'r.sessionId === "stub-session-id"'
assert_json "status: turnCount from get_session_stats.userMessages" "$out_status" 'r.turnCount === 2'

# --- end: place a fake session file first, matching pi's <ts>_<name>.jsonl naming ---
sess_dir="$(pi_sessions_dir "$scratch")"
mkdir -p "$sess_dir"
sess_file="$sess_dir/2026-07-28T00-00-00_${name}.jsonl"
echo '{}' > "$sess_file"
lock_file="$(pi_lock_path "$scratch" "$name")"

out_end="$scratch/end.json"
node "$COMPANION" conversation end "$name" --json --timeout 5000 > "$out_end"
rc=$?
check "end: exit code 0" test "$rc" -eq 0
assert_json "end: ok:true" "$out_end" 'r.ok === true'
check "end: session file removed" test ! -e "$sess_file"
check "end: lockfile removed" test ! -e "$lock_file"

finish
