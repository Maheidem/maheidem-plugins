#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

use_stub pi-ignore-sigterm
scratch="$(make_scratch)"
out="$scratch/result.json"
export CLAUDE_PROJECT_DIR="$scratch"

markers_before="$(find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'pi-delegate-result-*.json' 2>/dev/null | wc -l | tr -d ' ')"

start=$SECONDS
rc=0
node "$COMPANION" task "do thing" --json --timeout 2000 > "$out" 2> "$scratch/stderr.txt" || rc=$?
elapsed=$((SECONDS - start))

check "nonzero exit" test "$rc" -ne 0
# SIGTERM at 2s (ignored) -> SIGKILL at 7s -> resolve; must not wait the full 60s
check "returned within 12s (got ${elapsed}s)" test "$elapsed" -le 12

assert_json "ok:false" "$out" 'r.ok === false'
assert_json "errorMessage mentions timeout" "$out" '/timeout|timed out|did not finish/.test(r.errorMessage)'
assert_json "progress log path in errorMessage" "$out" '/progress log: /.test(r.errorMessage)'
assert_json "progressLogPath set" "$out" 'typeof r.progressLogPath === "string" && r.progressLogPath.includes("pi-companion-progress-")'

markers_after="$(find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'pi-delegate-result-*.json' 2>/dev/null | wc -l | tr -d ' ')"
check "no leftover marker files" test "$markers_after" -le "$markers_before"

# clean up the retained progress log
plog="$(json_get "$out" 'r.progressLogPath')"
[ -n "$plog" ] && rm -f "$plog"

finish
