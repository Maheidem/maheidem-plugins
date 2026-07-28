#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

use_stub pi-big-stdout
scratch="$(make_scratch)"
out="$scratch/result.json"
export CLAUDE_PROJECT_DIR="$scratch"

node "$COMPANION" task "do thing" --marker --json --timeout 30000 > "$out"
rc=$?
check "exit code 0" test "$rc" -eq 0

assert_json "ok:true" "$out" 'r.ok === true'
assert_json "rawStdoutTruncated:true" "$out" 'r.rawStdoutTruncated === true'
assert_json "rawStdout <= 10240 chars" "$out" 'r.rawStdout.length <= 10240'
assert_json "finalText intact despite truncation" "$out" 'r.finalText === "big final answer"'

finish
