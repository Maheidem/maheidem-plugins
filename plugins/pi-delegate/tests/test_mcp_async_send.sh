#!/usr/bin/env bash
# MCP async dispatch tests -- ADR-005 §A: pi_conversation_send_async against
# the real MCP server over a live stdio pipe. Responses matched by JSON-RPC
# id (never line order), same pattern as test_mcp_steering.sh, since dispatch
# responses race the eventual background settle.
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

SERVER="$PLUGIN_ROOT/scripts/pi-mcp-server.mjs"

# inner_for_id <file> <id> -> prints the inner result JSON (content[0].text)
# of the tools/call response with that id, or {} if absent.
inner_for_id() {
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
    let found = null;
    for (const l of lines) {
      try { const o = JSON.parse(l); if (o.id === Number(process.argv[2]) && o.result) found = o; } catch {}
    }
    process.stdout.write(found ? found.result.content[0].text : "{}");
  ' "$1" "$2"
}

# field_of <inner-json> <js-expr over d> -> prints value (JSON for non-strings)
field_of() {
  node -e '
    const d = JSON.parse(process.argv[1] || "{}");
    const v = eval("d." + process.argv[2]);
    process.stdout.write(typeof v === "string" ? v : JSON.stringify(v === undefined ? null : v));
  ' "$1" "$2"
}

# run_feeder <out-file> <extra-lines...> -- pipes initialize + the given JSON
# lines (with sleeps encoded as "SLEEP <sec>" entries) into one server process.
run_feeder() {
  local out="$1"; shift
  local script
  script="$(make_scratch)/feeder.sh"
  {
    echo '#!/usr/bin/env bash'
    echo 'set -uo pipefail'
    echo '{'
    echo "  printf '%s\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}'"
    echo '  sleep 0.2'
    local entry
    for entry in "$@"; do
      case "$entry" in
        SLEEP\ *) echo "  sleep ${entry#SLEEP }" ;;
        *) printf "  printf '%%s\\\\n' '%s'\n" "$entry" ;;
      esac
    done
    echo '  sleep 1.5'
    echo "} | timeout 60 node '$SERVER' > '$out' 2>/dev/null || true"
  } > "$script"
  bash "$script"
}

# ---------------------------------------------------------------------------
# A. Happy path -- dispatch returns immediately with a turnId; poll mid-flight
#    (turnInFlight, currentTurnId set, lastTurnId still null), then poll after
#    the stub's 400ms settle (lastTurnId==turnId, turnInFlight:false).
#    pi_conversation_read reads a real on-disk pi session file, which the RPC
#    stub never writes -- finalText delivery via read is verified separately
#    in the plan's live end-to-end check against real pi, not here.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-two-turns
  OUT_A="$(make_scratch)/async_happy.jsonl"
  run_feeder "$OUT_A" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send_async","arguments":{"name":"aa","message":"one","timeout_ms":20000}}}' \
    'SLEEP 0.1' \
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"pi_conversation_status","arguments":{"name":"aa"}}}' \
    'SLEEP 2.5' \
    '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"pi_conversation_status","arguments":{"name":"aa"}}}'
  IN_A3="$(inner_for_id "$OUT_A" 3)"
  IN_A4="$(inner_for_id "$OUT_A" 4)"
  IN_A5="$(inner_for_id "$OUT_A" 5)"
  TURN_ID="$(field_of "$IN_A3" turnId)"
  [ "$(field_of "$IN_A3" ok)" = "true" ] && pass "A: dispatch ok:true" || fail "A: dispatch ok:true (inner=$IN_A3)"
  [ "$(field_of "$IN_A3" dispatched)" = "true" ] && pass "A: dispatched:true" || fail "A: dispatched:true (inner=$IN_A3)"
  [ -n "$TURN_ID" ] && [ "$TURN_ID" != "null" ] && pass "A: turnId present" || fail "A: turnId present (inner=$IN_A3)"
  [ "$(field_of "$IN_A4" channel.turnInFlight)" = "true" ] && pass "A: mid-flight turnInFlight:true" || fail "A: mid-flight turnInFlight:true (inner=$IN_A4)"
  [ "$(field_of "$IN_A4" channel.currentTurnId)" = "$TURN_ID" ] && pass "A: mid-flight currentTurnId matches" || fail "A: mid-flight currentTurnId matches (inner=$IN_A4)"
  [ "$(field_of "$IN_A5" channel.turnInFlight)" = "false" ] && pass "A: settled turnInFlight:false" || fail "A: settled turnInFlight:false (inner=$IN_A5)"
  [ "$(field_of "$IN_A5" channel.lastTurnId)" = "$TURN_ID" ] && pass "A: settled lastTurnId matches" || fail "A: settled lastTurnId matches (inner=$IN_A5)"
} || true

# ---------------------------------------------------------------------------
# B. Stale/mismatched poll -- mid-flight poll shows currentTurnId set and
#    lastTurnId still null; a second dispatch to the same busy name is
#    rejected (not queued).
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-two-turns
  OUT_B="$(make_scratch)/async_busy.jsonl"
  run_feeder "$OUT_B" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send_async","arguments":{"name":"bb","message":"one","timeout_ms":20000}}}' \
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"pi_conversation_send_async","arguments":{"name":"bb","message":"two","timeout_ms":20000}}}' \
    'SLEEP 0.05' \
    '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"pi_conversation_status","arguments":{"name":"bb"}}}'
  IN_B3="$(inner_for_id "$OUT_B" 3)"
  IN_B4="$(inner_for_id "$OUT_B" 4)"
  IN_B5="$(inner_for_id "$OUT_B" 5)"
  [ "$(field_of "$IN_B3" dispatched)" = "true" ] && pass "B: first dispatch succeeds" || fail "B: first dispatch succeeds (inner=$IN_B3)"
  [ "$(field_of "$IN_B4" ok)" = "false" ] && pass "B: second dispatch rejected (ok:false)" || fail "B: second dispatch rejected (inner=$IN_B4)"
  case "$(field_of "$IN_B4" errorMessage)" in *"busy"*) pass "B: second dispatch says busy" ;; *) fail "B: second dispatch says busy (inner=$IN_B4)" ;; esac
  [ "$(field_of "$IN_B5" channel.lastTurnId)" = "null" ] && pass "B: mid-flight poll lastTurnId still null" || fail "B: mid-flight poll lastTurnId still null (inner=$IN_B5)"
} || true

# ---------------------------------------------------------------------------
# C. Steer during async dispatch -- steer lands mid-turn, reflected via
#    pi_conversation_status.channel.steered once the turn settles.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-two-turns
  OUT_C="$(make_scratch)/async_steer.jsonl"
  run_feeder "$OUT_C" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send_async","arguments":{"name":"cc","message":"one","timeout_ms":20000}}}' \
    'SLEEP 0.15' \
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"pi_conversation_steer","arguments":{"name":"cc","message":"extra"}}}' \
    'SLEEP 2.5' \
    '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"pi_conversation_status","arguments":{"name":"cc"}}}'
  IN_C4="$(inner_for_id "$OUT_C" 4)"
  IN_C5="$(inner_for_id "$OUT_C" 5)"
  [ "$(field_of "$IN_C4" ok)" = "true" ] && pass "C: steer during async dispatch ok:true" || fail "C: steer during async dispatch ok:true (inner=$IN_C4)"
  [ "$(field_of "$IN_C5" channel.turnInFlight)" = "false" ] && pass "C: settled after steer" || fail "C: settled after steer (inner=$IN_C5)"
  [ "$(field_of "$IN_C5" channel.steered)" = '["extra"]' ] && pass "C: status reflects steered=[\"extra\"]" || fail "C: status reflects steered=[\"extra\"] (got $(field_of "$IN_C5" channel.steered))"
} || true

# ---------------------------------------------------------------------------
# D. Interrupt during async dispatch -- abort + reprompt, reflected via
#    lastTurnId settling and finalText from the reprompted turn.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-two-turns
  OUT_D="$(make_scratch)/async_interrupt.jsonl"
  run_feeder "$OUT_D" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send_async","arguments":{"name":"dd","message":"one","timeout_ms":20000}}}' \
    'SLEEP 0.15' \
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"pi_conversation_interrupt","arguments":{"name":"dd","message":"redo"}}}' \
    'SLEEP 3.5' \
    '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"pi_conversation_status","arguments":{"name":"dd"}}}'
  IN_D4="$(inner_for_id "$OUT_D" 4)"
  IN_D5="$(inner_for_id "$OUT_D" 5)"
  [ "$(field_of "$IN_D4" ok)" = "true" ] && pass "D: interrupt during async dispatch ok:true" || fail "D: interrupt during async dispatch ok:true (inner=$IN_D4)"
  [ "$(field_of "$IN_D5" channel.turnInFlight)" = "false" ] && pass "D: settled after interrupt" || fail "D: settled after interrupt (inner=$IN_D5)"
  [ "$(field_of "$IN_D5" channel.pendingInterrupt)" = "false" ] && pass "D: pendingInterrupt cleared after settle" || fail "D: pendingInterrupt cleared after settle (inner=$IN_D5)"
} || true

# ---------------------------------------------------------------------------
# E. Timeout mid-async-turn -- background timeout still kills the channel;
#    poll shows alive:false; the lock is released (a second dispatch now
#    succeeds).
# ---------------------------------------------------------------------------
{
  use_stub pi-conv-never-settles
  OUT_E="$(make_scratch)/async_timeout.jsonl"
  run_feeder "$OUT_E" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send_async","arguments":{"name":"ee","message":"one","timeout_ms":800}}}' \
    'SLEEP 4.0' \
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"pi_conversation_status","arguments":{"name":"ee"}}}' \
    'SLEEP 4.0' \
    '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"pi_conversation_send_async","arguments":{"name":"ee","message":"two","timeout_ms":20000}}}'
  IN_E3="$(inner_for_id "$OUT_E" 3)"
  IN_E4="$(inner_for_id "$OUT_E" 4)"
  IN_E5="$(inner_for_id "$OUT_E" 5)"
  [ "$(field_of "$IN_E3" dispatched)" = "true" ] && pass "E: initial dispatch succeeds" || fail "E: initial dispatch succeeds (inner=$IN_E3)"
  # channel is either null (reaped from the registry) or alive:false -- both mean killed.
  if node -e '
    const d = JSON.parse(process.argv[1] || "{}");
    process.exit((!d.channel || d.channel.alive === false) ? 0 : 1);
  ' "$IN_E4"; then
    pass "E: channel killed after background timeout"
  else
    fail "E: channel killed after background timeout (inner=$IN_E4)"
  fi
  [ "$(field_of "$IN_E5" dispatched)" = "true" ] && pass "E: lock released -- second dispatch succeeds" || fail "E: lock released -- second dispatch succeeds (inner=$IN_E5)"
} || true

finish
