#!/usr/bin/env bash
# MCP steering tests -- ADR-002 stage 5.3b: pi_conversation_steer and
# pi_conversation_interrupt against the real MCP server over a live stdio
# pipe. Responses are matched by JSON-RPC id (never by output line order:
# steer/interrupt responses return before the blocking send response).
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
    echo '  sleep 3.0'
    echo "} | timeout 60 node '$SERVER' > '$out' 2>/dev/null || true"
  } > "$script"
  bash "$script"
}

# ---------------------------------------------------------------------------
# A. Idle steer -- no conversation running: ok:false + "conversation is idle".
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-two-turns
  OUT_A="$(make_scratch)/steer_idle.jsonl"
  run_feeder "$OUT_A" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_steer","arguments":{"name":"sa","message":"x"}}}'
  IN_A="$(inner_for_id "$OUT_A" 3)"
  [ "$(field_of "$IN_A" ok)" = "false" ] && pass "A: idle steer ok:false" || fail "A: idle steer ok:false (inner=$IN_A)"
  case "$(field_of "$IN_A" errorMessage)" in *"conversation is idle"*) pass "A: idle steer says conversation is idle" ;; *) fail "A: idle steer says conversation is idle (inner=$IN_A)" ;; esac
} || true

# ---------------------------------------------------------------------------
# B. Idle interrupt -- same contract as A.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-two-turns
  OUT_B="$(make_scratch)/interrupt_idle.jsonl"
  run_feeder "$OUT_B" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_interrupt","arguments":{"name":"sb","message":"x"}}}'
  IN_B="$(inner_for_id "$OUT_B" 3)"
  [ "$(field_of "$IN_B" ok)" = "false" ] && pass "B: idle interrupt ok:false" || fail "B: idle interrupt ok:false (inner=$IN_B)"
  case "$(field_of "$IN_B" errorMessage)" in *"conversation is idle"*) pass "B: idle interrupt says conversation is idle" ;; *) fail "B: idle interrupt says conversation is idle (inner=$IN_B)" ;; esac
} || true

# ---------------------------------------------------------------------------
# C. Live steer -- steer lands mid-turn (stub settles after 400ms):
#    steer response ok:true "steer queued"; send returns steered:["extra"],
#    finalText reply-1.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-two-turns
  OUT_C="$(make_scratch)/steer_live.jsonl"
  run_feeder "$OUT_C" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"sc","message":"one","timeout_ms":20000}}}' \
    'SLEEP 0.15' \
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"pi_conversation_steer","arguments":{"name":"sc","message":"extra"}}}'
  IN_C3="$(inner_for_id "$OUT_C" 3)"
  IN_C4="$(inner_for_id "$OUT_C" 4)"
  [ "$(field_of "$IN_C4" ok)" = "true" ] && pass "C: steer ok:true" || fail "C: steer ok:true (inner=$IN_C4)"
  case "$(field_of "$IN_C4" summary)" in *"steer queued"*) pass "C: steer summary says queued" ;; *) fail "C: steer summary says queued (inner=$IN_C4)" ;; esac
  [ "$(field_of "$IN_C3" ok)" = "true" ] && pass "C: send ok:true" || fail "C: send ok:true (inner=$IN_C3)"
  [ "$(field_of "$IN_C3" steered)" = '["extra"]' ] && pass "C: send steered=[\"extra\"]" || fail "C: send steered=[\"extra\"] (got $(field_of "$IN_C3" steered))"
  [ "$(field_of "$IN_C3" finalText)" = "reply-1" ] && pass "C: send finalText reply-1" || fail "C: send finalText reply-1 (got '$(field_of "$IN_C3" finalText)')"
} || true

# ---------------------------------------------------------------------------
# D. Live interrupt -- abort + reprompt: interrupt response ok:true; send
#    returns interrupted:true and finalText reply-2 (the reprompted turn
#    increments the stub's counter).
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-two-turns
  OUT_D="$(make_scratch)/interrupt_live.jsonl"
  run_feeder "$OUT_D" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"sd","message":"one","timeout_ms":20000}}}' \
    'SLEEP 0.15' \
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"pi_conversation_interrupt","arguments":{"name":"sd","message":"redo"}}}'
  IN_D3="$(inner_for_id "$OUT_D" 3)"
  IN_D4="$(inner_for_id "$OUT_D" 4)"
  [ "$(field_of "$IN_D4" ok)" = "true" ] && pass "D: interrupt ok:true" || fail "D: interrupt ok:true (inner=$IN_D4)"
  [ "$(field_of "$IN_D3" ok)" = "true" ] && pass "D: send ok:true" || fail "D: send ok:true (inner=$IN_D3)"
  [ "$(field_of "$IN_D3" interrupted)" = "true" ] && pass "D: send interrupted:true" || fail "D: send interrupted:true (got $(field_of "$IN_D3" interrupted))"
  [ "$(field_of "$IN_D3" finalText)" = "reply-2" ] && pass "D: send finalText reply-2" || fail "D: send finalText reply-2 (got '$(field_of "$IN_D3" finalText)')"
} || true

# ---------------------------------------------------------------------------
# E. Steer then interrupt on the same turn -- steered:["extra"] survives the
#    reprompt, interrupted:true, finalText reply-2.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-two-turns
  OUT_E="$(make_scratch)/steer_then_interrupt.jsonl"
  run_feeder "$OUT_E" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"se","message":"one","timeout_ms":20000}}}' \
    'SLEEP 0.15' \
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"pi_conversation_steer","arguments":{"name":"se","message":"extra"}}}' \
    'SLEEP 0.1' \
    '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"pi_conversation_interrupt","arguments":{"name":"se","message":"after"}}}'
  IN_E3="$(inner_for_id "$OUT_E" 3)"
  IN_E4="$(inner_for_id "$OUT_E" 4)"
  IN_E5="$(inner_for_id "$OUT_E" 5)"
  [ "$(field_of "$IN_E4" ok)" = "true" ] && pass "E: steer ok:true" || fail "E: steer ok:true (inner=$IN_E4)"
  [ "$(field_of "$IN_E5" ok)" = "true" ] && pass "E: interrupt ok:true" || fail "E: interrupt ok:true (inner=$IN_E5)"
  [ "$(field_of "$IN_E3" ok)" = "true" ] && pass "E: send ok:true" || fail "E: send ok:true (inner=$IN_E3)"
  [ "$(field_of "$IN_E3" steered)" = '["extra"]' ] && pass "E: send steered=[\"extra\"]" || fail "E: send steered=[\"extra\"] (got $(field_of "$IN_E3" steered))"
  [ "$(field_of "$IN_E3" interrupted)" = "true" ] && pass "E: send interrupted:true" || fail "E: send interrupted:true (got $(field_of "$IN_E3" interrupted))"
} || true

# ---------------------------------------------------------------------------
# F. Two names in parallel -- steer on fa, interrupt on fb, no cross-talk:
#    all four responses ok:true.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-two-turns
  OUT_F="$(make_scratch)/concurrent.jsonl"
  run_feeder "$OUT_F" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"fa","message":"one","timeout_ms":20000}}}' \
    '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"fb","message":"two","timeout_ms":20000}}}' \
    'SLEEP 0.15' \
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"pi_conversation_steer","arguments":{"name":"fa","message":"steer-fa"}}}' \
    '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"pi_conversation_interrupt","arguments":{"name":"fb","message":"abort-fb"}}}'
  for pair in "3:send fa" "4:steer fa" "5:send fb" "6:interrupt fb"; do
    id="${pair%%:*}"; label="${pair#*:}"
    INNER="$(inner_for_id "$OUT_F" "$id")"
    [ "$(field_of "$INNER" ok)" = "true" ] && pass "F: $label ok:true" || fail "F: $label ok:true (inner=$INNER)"
  done
} || true

finish
