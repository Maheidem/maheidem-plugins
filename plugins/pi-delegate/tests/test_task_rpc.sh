#!/usr/bin/env bash
# Drives `pi-companion.mjs task` against RPC-style stubs.
# Covers: default RPC, explicit --marker (now rejected), RPC timeout, and
# flag-sanity (--marker is removed, must be rejected).
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"
taskName="say ok"

# ---------------------------------------------------------------------------
# 1. RPC default — pi-conv-send-happy installed as `pi`; no --marker.
#    The stub responds to {type:"prompt"}, {type:"get_last_assistant_text"}
#    and {type:"get_state"} (RPC verbs used by runTaskRpc).
# ---------------------------------------------------------------------------
use_stub pi-conv-send-happy
out_rpc="$scratch/rpc.json"
timeout 30 node "$COMPANION" task "$taskName" --json --timeout 15000 > "$out_rpc"
rc=$?
check "rpc: exit code 0" test "$rc" -eq 0
assert_json "rpc: ok:true" "$out_rpc" 'r.ok === true'
assert_json "rpc: finalText non-empty" "$out_rpc" "r.finalText === \"stub reply text\""
assert_json "rpc: no marker-related keys" "$out_rpc" '!("completionMarker" in r) && !("markerMissing" in r) && !("degraded" in r)'

# ---------------------------------------------------------------------------
# 2. RPC timeout — pi-conv-never-settles installed as `pi`; no --marker, short timeout.
#    Stub ignores SIGTERM, sleeps 60s. The companion must kill it (SIGTERM→SIGKILL)
#    and return within ~12s with ok:false + timeout in errorMessage.
# ---------------------------------------------------------------------------
use_stub pi-conv-never-settles
out_timeout="$scratch/timeout.json"
start=$SECONDS
rc=0
timeout 30 node "$COMPANION" task "$taskName" --json --timeout 3000 > "$out_timeout" 2> "$scratch/stderr-t.txt" || rc=$?
elapsed=$((SECONDS - start))

check "timeout: nonzero exit or ok:false" test "$rc" -ne 0 || node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).ok ? 1 : 0)' "$out_timeout"
assert_json "timeout: ok:false" "$out_timeout" 'r.ok === false'
assert_json "timeout: errorMessage mentions timeout" "$out_timeout" '/timeout|timed out|did not settle/.test(r.errorMessage)'
check "timeout: returned within 15s (got ${elapsed}s)" test "$elapsed" -le 15

# ---------------------------------------------------------------------------
# 3. Flag sanity — --marker is now removed; companion must reject it with exit 2
#    and a clear message. No marker path exists anymore.
# ---------------------------------------------------------------------------
use_stub pi-conv-send-happy
out_sanity="$scratch/sanity.json"
rc=0
timeout 30 node "$COMPANION" task "$taskName" --json --timeout 15000 --marker > "$out_sanity" 2>&1 || rc=$?
check "removed flag: exit 2" test "$rc" -eq 2
check "removed flag: stderr/stdout contains rejection message" grep -q -- "--marker was removed" "$out_sanity"

# ---------------------------------------------------------------------------
# 4. Error turn — pi-rpc-error-turn installed as `pi`; no --marker.
#    The stub simulates a backend-failure turn (agent_end with stopReason:error,
#    auto_retry_end with success:false). Companion must surface ok:false +
#    errorMessage containing "pi turn failed" + empty finalText.
# ---------------------------------------------------------------------------
use_stub pi-rpc-error-turn
out_error="$scratch/error.json"
rc=0
timeout 30 node "$COMPANION" task "$taskName" --json --timeout 15000 > "$out_error" || rc=$?
check "error turn: nonzero exit or ok:false" test "$rc" -ne 0 || node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).ok ? 1 : 0)' "$out_error"
assert_json "error turn detected: ok:false" "$out_error" 'r.ok === false'
assert_json "error turn detected: errorMessage non-null & contains \"pi turn failed\"" "$out_error" 'r.errorMessage && r.errorMessage.includes("pi turn failed")'
assert_json "error turn detected: finalText empty or null" "$out_error" '!r.finalText || r.finalText === ""'

finish
