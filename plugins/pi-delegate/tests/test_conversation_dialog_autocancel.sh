#!/usr/bin/env bash
# The stub emits an extension_ui_request and only proceeds to settle once it
# has actually read back {"cancelled":true} on stdin -- proves rpcRoundtrip's
# auto-cancel write really happens (not just that the event was ignored) and
# that it doesn't hang the roundtrip.
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

use_stub pi-conv-dialog-autocancel
scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"
name="convtest-dialog-$$"
out="$scratch/result.json"

start=$SECONDS
node "$COMPANION" conversation send "$name" "hello" --json --timeout 5000 > "$out"
rc=$?
elapsed=$((SECONDS - start))

check "exit code 0" test "$rc" -eq 0
check "did not hang (returned within 5s, got ${elapsed}s)" test "$elapsed" -le 5
assert_json "ok:true" "$out" 'r.ok === true'
assert_json "finalText from stub after dialog gate" "$out" 'r.finalText === "dialog-ok"'

finish
