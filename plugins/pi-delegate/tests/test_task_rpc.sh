#!/usr/bin/env bash
# Drives `pi-companion.mjs task` against RPC-style and marker-style stubs.
# Covers: default RPC, explicit --marker, RPC timeout, and flag-sanity (RPC stub
# with --marker must NOT succeed because the stub never writes a marker file).
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
assert_json "rpc: completionMarker is null" "$out_rpc" 'r.completionMarker === null'
assert_json "rpc: markerMissing false" "$out_rpc" 'r.markerMissing === false'
assert_json "rpc: degraded false" "$out_rpc" 'r.degraded === false'

# ---------------------------------------------------------------------------
# 2. Marker fallback — pi-marker-ok installed as `pi`; same command plus --marker.
#    The stub writes a valid marker file and emits NDJSON with agent_end.
# ---------------------------------------------------------------------------
use_stub pi-marker-ok
out_marker="$scratch/marker.json"
timeout 30 node "$COMPANION" task "$taskName" --json --timeout 15000 --marker > "$out_marker"
rc=$?
check "marker: exit code 0" test "$rc" -eq 0
assert_json "marker: ok:true" "$out_marker" 'r.ok === true'
assert_json "marker: completionMarker non-null (status ok)" "$out_marker" 'r.completionMarker !== null && r.completionMarker.status === "ok"'

# ---------------------------------------------------------------------------
# 3. RPC timeout — pi-conv-never-settles installed as `pi`; no --marker, short timeout.
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
# 4. Flag sanity — pi-conv-send-happy (RPC stub that never writes a marker file)
#    used with --marker. Must NOT succeed as if RPC: because --marker routes to
#    the marker path (runTask), which expects a marker file on disk. The stub
#    does not write one, so the marker path should fail (markerMissing).
# ---------------------------------------------------------------------------
use_stub pi-conv-send-happy
out_sanity="$scratch/sanity.json"
rc=0
timeout 30 node "$COMPANION" task "$taskName" --json --timeout 15000 --marker > "$out_sanity" || rc=$?
check "sanity: exit nonzero (marker path, no marker written)" test "$rc" -ne 0
assert_json "sanity: ok:false or markerMissing true" "$out_sanity" 'r.ok === false || r.markerMissing === true'

# ---------------------------------------------------------------------------
# 5. Error turn — pi-rpc-error-turn installed as `pi`; no --marker.
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
