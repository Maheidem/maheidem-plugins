#!/usr/bin/env bash
# Dispatch that returns at once (0.11, confirmed channel: PI_DELEGATE_WAKE=
# channel) -- the successor of the 0.10 async-send suite. Lab stub.
#   A pi_agent returns before the turn ends; status mid-flight shows the turn
#     in flight with its id; after the DONE push it is settled (lastTurnId)
#   B a steer on a channel-mode child returns at once and is recorded
#   C an interrupt on a channel-mode child returns at once; the new turn's DONE
#     is pushed, the aborted one never is
#   D turn_timeout_ms: the stuck turn is killed, failed{timeout} is pushed, the
#     lifetime lock is released, and pi_send_message resumes the child
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/mcp.sh"
export PI_DELEGATE_PI_PACKAGE=/nonexistent PI_DELEGATE_WAKE=channel
use_stub pi-rpc-lab
J() { json_for_id "$@"; }
pushes() { # pushes <out> <event> -> count of channel pushes of that event type
  node -e '
    let n = 0;
    for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
      try { const o = JSON.parse(l); if (o.method === "notifications/claude/channel" && o.params.meta.event === process.argv[2]) n++; } catch {}
    }
    process.stdout.write(String(n));' "$1" "$2"
}

{
  PA="$(make_scratch)"; OUT="$(make_scratch)/a.jsonl"
  CLAUDE_PROJECT_DIR="$PA" PI_STUB_SETTLE_MS=1500 feed "$OUT" \
    "$(call 3 pi_agent '{"name":"aa","prompt":"one"}')" "WAIT_FOR \"id\":3 10" \
    "$(call 4 pi_list_agents '{"name":"aa"}')" "WAIT_FOR \"id\":4 5" \
    "WAIT_FOR \"event\":\"done\" 10" \
    "$(call 5 pi_list_agents '{"name":"aa"}')" "WAIT_FOR \"id\":5 5"
  [ "$(field_of "$(J "$OUT" 3)" status)" = running ] && [ "$(field_of "$(J "$OUT" 3)" wake)" = channel ] && pass "A: pi_agent returned at once (running, wake channel)" || fail "A: id3 ($(J "$OUT" 3))"
  TID="$(field_of "$(J "$OUT" 4)" channel.currentTurnId)"
  [ "$(field_of "$(J "$OUT" 4)" channel.turnInFlight)" = true ] && [ -n "$TID" ] && [ "$TID" != null ] && pass "A: mid-flight status: turn in flight" || fail "A: id4 ($(J "$OUT" 4))"
  [ "$(field_of "$(J "$OUT" 5)" channel.turnInFlight)" = false ] && [ "$(field_of "$(J "$OUT" 5)" channel.lastTurnId)" = "$TID" ] && pass "A: after DONE: settled, lastTurnId = that turn" || fail "A: id5 ($(J "$OUT" 5))"
} || true

{
  PB="$(make_scratch)"; OUT="$(make_scratch)/b.jsonl"
  CLAUDE_PROJECT_DIR="$PB" PI_STUB_SETTLE_MS=1500 feed "$OUT" \
    "$(call 3 pi_agent '{"name":"bb","prompt":"one"}')" "WAIT_FOR \"id\":3 10" "SLEEP 0.3" \
    "$(call 4 pi_send_message '{"to":"bb","message":"extra"}')" "WAIT_FOR \"id\":4 5" \
    "WAIT_FOR \"event\":\"done\" 10" "$(call 5 pi_list_agents '{"name":"bb"}')" "WAIT_FOR \"id\":5 5"
  [ "$(field_of "$(J "$OUT" 4)" delivered)" = steer ] && pass "B: steer delivered at once" || fail "B: id4 ($(J "$OUT" 4))"
  [ "$(field_of "$(J "$OUT" 5)" channel.steered)" = '["extra"]' ] && pass "B: status records the steer" || fail "B: id5 ($(J "$OUT" 5))"
  grep -q 'steer:extra' "$OUT" && pass "B: the pushed DONE carries the steered result" || fail "B: push"
} || true

{
  PC="$(make_scratch)"; OUT="$(make_scratch)/c.jsonl"
  CLAUDE_PROJECT_DIR="$PC" PI_STUB_SETTLE_MS=1500 feed "$OUT" \
    "$(call 3 pi_agent '{"name":"cc","prompt":"one"}')" "WAIT_FOR \"id\":3 10" "SLEEP 0.3" \
    "$(call 4 pi_send_message '{"to":"cc","message":"redo","interrupt":true}')" "WAIT_FOR \"id\":4 15" \
    "WAIT_FOR \"event\":\"done\" 10" "SLEEP 0.5"
  case "$(head_for_id "$OUT" 4)" in "delivered interrupt to pi:cc (turn 2); you will be notified"*) pass "C: interrupt returned at once (turn 2)" ;; *) fail "C: id4 ($(inner_for_id "$OUT" 4))" ;; esac
  [ "$(pushes "$OUT" done)" = 1 ] && grep -q 'DONE turn 2 ok' "$OUT" && pass "C: one DONE push, for turn 2 only" || fail "C: pushes $(pushes "$OUT" done)"
} || true

{
  PD="$(make_scratch)"; OUT="$(make_scratch)/d.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"; LOCK="${TMPDIR:-/tmp}/pi-delegate-locks/$(pi_session_slug "$PD")__dd.lock"; ST="$(make_scratch)/st"
  CLAUDE_PROJECT_DIR="$PD" PI_STUB_SETTLE_MS=60000 PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    "$(call 3 pi_agent '{"name":"dd","prompt":"one","turn_timeout_ms":800}')" "WAIT_FOR \"id\":3 10" \
    "WAIT_FOR \"event\":\"failed\" 10" "SLEEP 0.5" "SH [ -e '$LOCK' ] && echo locked > '$ST' || echo free > '$ST'" \
    "$(call 4 pi_send_message '{"to":"dd","message":"two"}')" "WAIT_FOR \"id\":4 10"
  grep -q 'FAILED turn 1 (timeout)' "$OUT" && pass "D: failed{timeout} pushed" || fail "D: no timeout push"
  [ "$(cat "$ST")" = free ] && pass "D: lifetime lock released with the killed child" || fail "D: lock $(cat "$ST")"
  [ "$(field_of "$(J "$OUT" 4)" delivered)" = resumed ] && [ "$(wc -l < "$PIDS" | tr -d ' ')" = 2 ] && pass "D: pi_send_message resumed it (new process)" || fail "D: id4 ($(J "$OUT" 4))"
} || true

finish
