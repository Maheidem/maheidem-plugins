#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

use_stub pi-no-marker-clean
scratch="$(make_scratch)"
out="$scratch/result.json"
export CLAUDE_PROJECT_DIR="$scratch"

node "$COMPANION" task "do thing" --marker --json --timeout 30000 > "$out"
rc=$?
check "exit code 0 (degraded success)" test "$rc" -eq 0

assert_json "ok:true" "$out" 'r.ok === true'
assert_json "degraded:true" "$out" 'r.degraded === true'
assert_json "markerMissing:true" "$out" 'r.markerMissing === true'
assert_json "finalText from NDJSON" "$out" 'r.finalText === "degraded final answer"'
assert_json "warning present" "$out" 'typeof r.warning === "string" && /verify the work/.test(r.warning)'
assert_json "errorMessage null" "$out" 'r.errorMessage === null'

finish
