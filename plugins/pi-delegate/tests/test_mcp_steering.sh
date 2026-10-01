#!/usr/bin/env bash
# pi_send_message against a live child (0.11 §2.2), lab stub. Responses are
# matched by JSON-RPC id: a steer returns before the call holding the turn.
#   A unknown name -> "No pi agent named"
#   B live steer: delivered steer at once; the steer reaches the child before
#     the turn ends (its text is in the turn's result)
#   C live interrupt: the running turn ends as interrupted, the new turn's
#     result comes back on the interrupting call (reply-2)
#   D two names in parallel: a steer on one and an interrupt on the other, no
#     cross-talk
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/mcp.sh"
export PI_DELEGATE_PI_PACKAGE=/nonexistent
use_stub pi-rpc-lab

J() { json_for_id "$@"; }

{
  PA="$(make_scratch)"; OUT="$(make_scratch)/a.jsonl"
  CLAUDE_PROJECT_DIR="$PA" feed "$OUT" "$(call 3 pi_send_message '{"to":"sa","message":"x"}')" "WAIT_FOR \"id\":3 5"
  [ "$(field_of "$(J "$OUT" 3)" errorMessage)" = 'No pi agent named "sa". Known: none.' ] && pass "A: unknown name" || fail "A: ($(J "$OUT" 3))"
} || true

{
  PB="$(make_scratch)"; OUT="$(make_scratch)/b.jsonl"
  CLAUDE_PROJECT_DIR="$PB" PI_STUB_SETTLE_MS=1500 feed "$OUT" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_agent","arguments":{"name":"sc","prompt":"one","run_in_background":false},"_meta":{"progressToken":"tok-sc"}}}' \
    'WAIT_FOR "progressToken":"tok-sc" 10' \
    "$(call 4 pi_send_message '{"to":"sc","message":"extra"}')" "WAIT_FOR \"id\":3 10"
  [ "$(field_of "$(J "$OUT" 4)" delivered)" = steer ] && pass "B: delivered steer" || fail "B: id4 ($(J "$OUT" 4))"
  case "$(field_of "$(J "$OUT" 3)" text)" in *"reply-1|steer:extra"*) pass "B: the steer reached the running turn" ;; *) fail "B: id3 ($(J "$OUT" 3))" ;; esac
} || true

{
  PC="$(make_scratch)"; OUT="$(make_scratch)/c.jsonl"
  CLAUDE_PROJECT_DIR="$PC" PI_STUB_SETTLE_MS=1500 feed "$OUT" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_agent","arguments":{"name":"sd","prompt":"one","run_in_background":false},"_meta":{"progressToken":"tok-sd"}}}' \
    'WAIT_FOR "progressToken":"tok-sd" 10' \
    "$(call 4 pi_send_message '{"to":"sd","message":"redo","interrupt":true}')" "WAIT_FOR \"id\":4 15" "WAIT_FOR \"id\":3 5"
  [ "$(field_of "$(J "$OUT" 3)" status)" = interrupted ] && pass "C: the interrupted turn's call says interrupted" || fail "C: id3 ($(J "$OUT" 3))"
  case "$(J "$OUT" 4)" in *'"delivered":"interrupt"'*'"status":"done"'*'reply-2'*) pass "C: interrupt delivered, new turn reply-2 on the interrupting call" ;; *) fail "C: id4 ($(J "$OUT" 4))" ;; esac
} || true

{
  PD="$(make_scratch)"; OUT="$(make_scratch)/d.jsonl"
  CLAUDE_PROJECT_DIR="$PD" PI_STUB_SETTLE_MS=1500 feed "$OUT" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_agent","arguments":{"name":"fa","prompt":"one","run_in_background":false},"_meta":{"progressToken":"tok-fa"}}}' \
    '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"pi_agent","arguments":{"name":"fb","prompt":"two","run_in_background":false},"_meta":{"progressToken":"tok-fb"}}}' \
    'WAIT_FOR "progressToken":"tok-fa" 10' 'WAIT_FOR "progressToken":"tok-fb" 10' \
    "$(call 4 pi_send_message '{"to":"fa","message":"steer-fa"}')" \
    "$(call 6 pi_send_message '{"to":"fb","message":"abort-fb","interrupt":true}')" \
    "WAIT_FOR \"id\":3 10" "WAIT_FOR \"id\":6 15" "WAIT_FOR \"id\":5 5"
  case "$(field_of "$(J "$OUT" 3)" text)" in *"steer:steer-fa"*) pass "D: fa got its steer" ;; *) fail "D: fa ($(J "$OUT" 3))" ;; esac
  case "$(J "$OUT" 3)" in *abort-fb*) fail "D: fb's message leaked into fa" ;; *) pass "D: no cross-talk into fa" ;; esac
  [ "$(field_of "$(J "$OUT" 5)" status)" = interrupted ] && [ "$(field_of "$(J "$OUT" 6)" status)" = done ] && pass "D: fb interrupted, its new turn done" || fail "D: fb ($(J "$OUT" 5) / $(J "$OUT" 6))"
} || true

finish
