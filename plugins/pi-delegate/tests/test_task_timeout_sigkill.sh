#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

use_stub pi-ignore-sigterm
scratch="$(make_scratch)"
out="$scratch/result.json"
export CLAUDE_PROJECT_DIR="$scratch"

start=$SECONDS
rc=0
node "$COMPANION" task "do thing" --json --timeout 2000 > "$out" 2> "$scratch/stderr.txt" || rc=$?
elapsed=$((SECONDS - start))

check "nonzero exit" test "$rc" -ne 0
# SIGTERM at 2s (ignored) -> SIGKILL at 7s -> resolve; must not wait the full 60s
check "returned within 12s (got ${elapsed}s)" test "$elapsed" -le 12

assert_json "ok:false" "$out" 'r.ok === false'
assert_json "errorMessage mentions timeout" "$out" '/timeout|timed out|did not finish/.test(r.errorMessage)'

# clean up any retained progress log (legacy; may be null with RPC-only path)
plog="$(json_get "$out" 'r.progressLogPath' 2>/dev/null)" || true
if [ -n "${plog:-}" ]; then rm -f "$plog"; fi

finish
