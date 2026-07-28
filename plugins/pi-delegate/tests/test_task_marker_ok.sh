#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

use_stub pi-marker-ok
scratch="$(make_scratch)"
out="$scratch/result.json"
export CLAUDE_PROJECT_DIR="$scratch"

node "$COMPANION" task "do thing" --json --timeout 30000 > "$out"
rc=$?
check "exit code 0" test "$rc" -eq 0

assert_json "ok:true" "$out" 'r.ok === true'
assert_json "degraded:false" "$out" 'r.degraded === false'
assert_json "markerMissing:false" "$out" 'r.markerMissing === false'
assert_json "finalText from NDJSON" "$out" 'r.finalText === "real final answer"'
assert_json "summary from marker" "$out" 'r.summary === "stub done"'
assert_json "nextSteps forwarded" "$out" 'JSON.stringify(r.nextSteps) === JSON.stringify(["a"])'
assert_json "exitCode 0" "$out" 'r.exitCode === 0'
assert_json "no truncation" "$out" 'r.rawStdoutTruncated === false && r.rawStderrTruncated === false'
assert_json "completionMarker present" "$out" 'r.completionMarker && r.completionMarker.status === "ok"'

# marker file cleaned up
leftovers="$(find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'pi-delegate-result-*.json' -newer "$STUB_BIN/pi" 2>/dev/null | wc -l | tr -d ' ')"
check "marker file cleaned up" test "$leftovers" -eq 0

finish
