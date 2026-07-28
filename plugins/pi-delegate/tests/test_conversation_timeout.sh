#!/usr/bin/env bash
# conversation send against a stub that acks the prompt but never settles and
# ignores SIGTERM -- proves the SIGTERM->SIGKILL escalation path fires and the
# roundtrip resolves ok:false within bounds instead of hanging.
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

use_stub pi-conv-never-settles
scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"
name="convtest-timeout-$$"
out="$scratch/result.json"

start=$SECONDS
rc=0
node "$COMPANION" conversation send "$name" "hello" --json --timeout 2000 > "$out" 2> "$scratch/stderr.txt" || rc=$?
elapsed=$((SECONDS - start))

check "nonzero exit" test "$rc" -ne 0
# SIGTERM at 2s (ignored) -> SIGKILL at 7s -> resolve; must not wait the full 60s sleep
check "returned within 12s (got ${elapsed}s)" test "$elapsed" -le 12

assert_json "ok:false" "$out" 'r.ok === false'
assert_json "sessionName echoed" "$out" "r.sessionName === \"$name\""
assert_json "errorMessage mentions timeout" "$out" '/timeout|timed out|did not settle/.test(r.errorMessage)'

# lock must be released, not left held, even on a timeout failure
lock_file="$(pi_lock_path "$scratch" "$name")"
check "lockfile released after timeout" test ! -e "$lock_file"

finish
