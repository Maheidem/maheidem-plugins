#!/usr/bin/env bash
# MCP elicitation tests -- ADR-002 §7: a pi extension_ui_request is mapped to
# MCP elicitation/create when the client declares the capability; otherwise
# it is parked as a d_* dialog and answered with pi_answer (0.11 §2.3; the
# former pi_respond).
#   A elicitation round trip: the client accepts "red", the turn ends picked:red
#   B no elicitation: status shows the d_* dialog; pi_answer {question_id:d_*,
#     value} delivers it while pi_agent still holds the wake; picked:blue
#   C pi_answer for a dialog with nothing pending fails cleanly
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/mcp.sh"
export PI_DELEGATE_PI_PACKAGE=/nonexistent
use_stub pi-rpc-dialog

feed_raw() { # feed_raw <out> <init-json> <entries...>: like feed, with a custom initialize
  local out="$1" init="$2"; shift 2
  local script; script="$(make_scratch)/raw.sh"
  {
    echo '{'
    printf "  printf '%%s\\\\n' '%s'\n" "$init"
    echo '  sleep 0.2'
    for e in "$@"; do case "$e" in SLEEP\ *) echo "  sleep ${e#SLEEP }" ;; *) printf "  printf '%%s\\\\n' '%s'\n" "$e" ;; esac; done
    echo '  sleep 1'
    echo "} | timeout 60 node '$SERVER' > '$out' 2>/dev/null || true"
  } > "$script"
  bash "$script"
}

{
  PA="$(make_scratch)"; OUT="$(make_scratch)/a.jsonl"
  CLAUDE_PROJECT_DIR="$PA" feed_raw "$OUT" '{"jsonrpc":"2.0","id":10,"method":"initialize","params":{"capabilities":{"elicitation":{}}}}' \
    "$(call 3 pi_agent '{"name":"ea","prompt":"go","run_in_background":false}')" "SLEEP 0.8" \
    '{"jsonrpc":"2.0","id":1,"result":{"action":"accept","content":{"value":"red"}}}' "SLEEP 2"
  grep -q '"method":"elicitation/create"' "$OUT" && pass "A: server emitted elicitation/create" || fail "A: no elicitation/create ($(head -c 400 "$OUT"))"
  J="$(json_for_id "$OUT" 3)"
  [ "$(field_of "$J" status)" = done ] && case "$(field_of "$J" text)" in *picked:red*) true ;; *) false ;; esac \
    && pass "A: turn ends picked:red" || fail "A: id3 ($J)"
} || true

{
  PB="$(make_scratch)"; OUT="$(make_scratch)/b.jsonl"; D="$(node -e 'process.stdout.write("d_" + require("crypto").createHash("sha1").update("q1").digest("hex").slice(0, 6))')"
  CLAUDE_PROJECT_DIR="$PB" feed_raw "$OUT" '{"jsonrpc":"2.0","id":10,"method":"initialize","params":{}}' \
    "$(call 3 pi_agent '{"name":"eb","prompt":"go","run_in_background":false}')" "SLEEP 0.8" \
    "$(call 4 pi_list_agents '{"name":"eb"}')" "SLEEP 0.3" \
    "$(call 5 pi_answer "$(json_obj to eb question_id "$D" value blue)")" "SLEEP 2"
  [ "$(field_of "$(json_for_id "$OUT" 4)" 'pendingQuestion.method + ":" + d.pendingQuestion.dialogId')" = "select:$D" ] && pass "B: status shows the d_* dialog" || fail "B: status ($(json_for_id "$OUT" 4))"
  [ "$(head_for_id "$OUT" 5)" = "answered dialog $D (select) for pi:eb" ] && pass "B: pi_answer delivered the dialog value" || fail "B: id5 ($(inner_for_id "$OUT" 5))"
  J="$(json_for_id "$OUT" 3)"
  [ "$(field_of "$J" status)" = done ] && case "$(field_of "$J" text)" in *picked:blue*) true ;; *) false ;; esac \
    && pass "B: pi_agent held the wake; turn ends picked:blue" || fail "B: id3 ($J)"
} || true

{
  PC="$(make_scratch)"; OUT="$(make_scratch)/c.jsonl"
  CLAUDE_PROJECT_DIR="$PC" feed_raw "$OUT" '{"jsonrpc":"2.0","id":10,"method":"initialize","params":{}}' \
    "$(call 3 pi_answer '{"to":"ec","question_id":"d_abcdef","value":"x"}')" "SLEEP 0.5"
  [ "$(field_of "$(json_for_id "$OUT" 3)" errorMessage)" = "no pending dialog on pi:ec" ] && pass "C: no pending dialog" || fail "C: ($(json_for_id "$OUT" 3))"
} || true

finish
