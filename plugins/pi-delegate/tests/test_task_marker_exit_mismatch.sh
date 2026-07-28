#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

use_stub pi-marker-ok-exit3
scratch="$(make_scratch)"
out="$scratch/result.json"
export CLAUDE_PROJECT_DIR="$scratch"

rc=0
node "$COMPANION" task "do thing" --marker --json --timeout 30000 > "$out" || rc=$?
check "nonzero exit" test "$rc" -ne 0

assert_json "ok:false" "$out" 'r.ok === false'
assert_json "markerExitMismatch:true" "$out" 'r.markerExitMismatch === true'
assert_json "exitCode 3" "$out" 'r.exitCode === 3'
assert_json "errorMessage names mismatch" "$out" '/completion marker reported ok but pi exited with status 3/.test(r.errorMessage)'
assert_json "summary kept as diagnostic" "$out" 'r.summary === "stub done"'

finish
