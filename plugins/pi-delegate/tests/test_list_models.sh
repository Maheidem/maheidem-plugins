#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"

# --- good table ---
use_stub pi-list-good
out="$scratch/good.json"
node "$COMPANION" list-models --json > "$out"
check "good: exit 0" test $? -eq 0
assert_json "good: ok:true" "$out" 'r.ok === true'
assert_json "good: 3 models parsed" "$out" 'r.models.length === 3'
assert_json "good: first row" "$out" 'r.models[0].provider === "zai" && r.models[0].model === "glm-4.5-air"'

# --- garbage rows, exit 0 ---
use_stub pi-list-garbage
out="$scratch/garbage.json"
node "$COMPANION" list-models --json > "$out" 2> "$scratch/garbage.err"
check "garbage: exit 0" test $? -eq 0
assert_json "garbage: ok:true, 0 models" "$out" 'r.ok === true && r.models.length === 0'
check "garbage: stderr warning per bad line" grep -q "could not parse line" "$scratch/garbage.err"

# --- nonzero exit ---
use_stub pi-list-exit1
out="$scratch/exit1.json"
rc=0
node "$COMPANION" list-models --json > "$out" || rc=$?
check "exit1: nonzero exit" test "$rc" -ne 0
assert_json "exit1: ok:false" "$out" 'r.ok === false'
assert_json "exit1: errorMessage names status" "$out" '/exited with status 1/.test(r.errorMessage)'
assert_json "exit1: stderr tail included" "$out" '/provider registry unavailable/.test(r.errorMessage)'

finish
