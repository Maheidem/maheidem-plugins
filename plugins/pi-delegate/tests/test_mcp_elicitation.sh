#!/usr/bin/env bash
# MCP elicitation tests -- ADR-002 stage 5.3c / §7: pi extension_ui_request
# mapped to MCP elicitation/create when the client declares the capability;
# parked as pendingQuestion + answered via pi_respond otherwise.
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

SERVER="$PLUGIN_ROOT/scripts/pi-mcp-server.mjs"

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

field_of() {
  node -e '
    const d = JSON.parse(process.argv[1] || "{}");
    const v = eval("d." + process.argv[2]);
    process.stdout.write(typeof v === "string" ? v : JSON.stringify(v === undefined ? null : v));
  ' "$1" "$2"
}

# ---------------------------------------------------------------------------
# A. Elicitation round-trip -- client declares the elicitation capability;
#    server emits elicitation/create (server-initiated id 1); client accepts
#    with value "red"; send settles with finalText picked:red.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-dialog
  OUT_A="$(make_scratch)/elicit_roundtrip.jsonl"
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":10,"method":"initialize","params":{"capabilities":{"elicitation":{}}}}'
    sleep 0.2
    printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"ea","message":"go","timeout_ms":20000}}}'
    sleep 0.6
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"action":"accept","content":{"value":"red"}}}'
    sleep 3.0
  } | timeout 60 node "$SERVER" > "$OUT_A" 2>/dev/null || true
  grep -q '"method":"elicitation/create"' "$OUT_A" && pass "A: server emitted elicitation/create" || fail "A: server emitted elicitation/create (out=$(head -c 400 "$OUT_A"))"
  IN_A="$(inner_for_id "$OUT_A" 3)"
  [ "$(field_of "$IN_A" ok)" = "true" ] && pass "A: send ok:true" || fail "A: send ok:true (inner=$IN_A)"
  [ "$(field_of "$IN_A" finalText)" = "picked:red" ] && pass "A: finalText picked:red" || fail "A: finalText picked:red (got '$(field_of "$IN_A" finalText)')"
} || true

# ---------------------------------------------------------------------------
# B. pi_respond fallback -- client does NOT declare elicitation; question is
#    parked (status shows pendingQuestion); pi_respond delivers the answer.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-dialog
  OUT_B="$(make_scratch)/elicit_fallback.jsonl"
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":10,"method":"initialize","params":{}}'
    sleep 0.2
    printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"eb","message":"go","timeout_ms":20000}}}'
    sleep 0.6
    printf '%s\n' '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"pi_conversation_status","arguments":{"name":"eb"}}}'
    sleep 0.2
    printf '%s\n' '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"pi_respond","arguments":{"name":"eb","value":"blue"}}}'
    sleep 3.0
  } | timeout 60 node "$SERVER" > "$OUT_B" 2>/dev/null || true
  IN_B4="$(inner_for_id "$OUT_B" 4)"
  IN_B5="$(inner_for_id "$OUT_B" 5)"
  IN_B3="$(inner_for_id "$OUT_B" 3)"
  case "$(field_of "$IN_B4" 'pendingQuestion.method')" in select) pass "B: status shows pendingQuestion (select)" ;; *) fail "B: status shows pendingQuestion (inner=$IN_B4)" ;; esac
  [ "$(field_of "$IN_B5" ok)" = "true" ] && pass "B: pi_respond ok:true" || fail "B: pi_respond ok:true (inner=$IN_B5)"
  [ "$(field_of "$IN_B3" ok)" = "true" ] && pass "B: send ok:true" || fail "B: send ok:true (inner=$IN_B3)"
  [ "$(field_of "$IN_B3" finalText)" = "picked:blue" ] && pass "B: finalText picked:blue" || fail "B: finalText picked:blue (got '$(field_of "$IN_B3" finalText)')"
} || true

# ---------------------------------------------------------------------------
# C. pi_respond with nothing pending -- ok:false "no pending question".
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-dialog
  OUT_C="$(make_scratch)/elicit_nopending.jsonl"
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":10,"method":"initialize","params":{}}'
    sleep 0.2
    printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_respond","arguments":{"name":"ec","value":"x"}}}'
    sleep 1.0
  } | timeout 60 node "$SERVER" > "$OUT_C" 2>/dev/null || true
  IN_C="$(inner_for_id "$OUT_C" 3)"
  [ "$(field_of "$IN_C" ok)" = "false" ] && pass "C: pi_respond ok:false" || fail "C: pi_respond ok:false (inner=$IN_C)"
  case "$(field_of "$IN_C" errorMessage)" in *"no pending question"*) pass "C: errorMessage no pending question" ;; *) fail "C: errorMessage no pending question (inner=$IN_C)" ;; esac
} || true

finish
