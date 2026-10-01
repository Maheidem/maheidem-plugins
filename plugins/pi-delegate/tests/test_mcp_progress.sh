#!/usr/bin/env bash
# MCP notifications/progress tests -- ADR-005 §B: the visibility layer on a
# call that holds a child's wake (pi_agent in fallback mode), gated on the
# client sending _meta.progressToken on the originating tools/call.
#   A with a token: no id field, the same token, strictly increasing progress,
#     a steer-forced message; the final response is unaffected
#   B without a token: no progress at all
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/mcp.sh"
export PI_DELEGATE_PI_PACKAGE=/nonexistent
use_stub pi-rpc-lab

progress_lines() {
  node -e '
    for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
      let o; try { o = JSON.parse(l); } catch { continue; }
      if (o && o.method === "notifications/progress") console.log(JSON.stringify(o));
    }' "$1"
}

# ---------------------------------------------------------------------------
# A. token
# ---------------------------------------------------------------------------
{
  PA="$(make_scratch)"; OUT="$(make_scratch)/progress_a.jsonl"
  CLAUDE_PROJECT_DIR="$PA" PI_STUB_SETTLE_MS=1500 feed "$OUT" \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_agent","arguments":{"name":"pa","prompt":"one","run_in_background":false},"_meta":{"progressToken":7}}}' \
    'WAIT_FOR "progressToken":7 10' \
    "$(call 4 pi_send_message '{"to":"pa","message":"extra"}')" "WAIT_FOR \"id\":3 10"
  P="$(make_scratch)/p.jsonl"; progress_lines "$OUT" > "$P"
  N="$(wc -l < "$P" | tr -d ' ')"
  [ "$N" -ge 1 ] && pass "A: progress notifications emitted ($N)" || fail "A: no progress"
  node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
    let last = -Infinity;
    for (const l of ls) { const o = JSON.parse(l); if ("id" in o || o.params.progressToken !== 7 || !(o.params.progress > last)) process.exit(1); last = o.params.progress; }
    process.exit(ls.length ? 0 : 1);' "$P" && pass "A: no id field, progressToken 7, strictly increasing" || fail "A: progress shape ($(cat "$P"))"
  grep -q '"message":"steer: extra"' "$P" && pass "A: steer-forced progress message" || fail "A: steer message ($(cat "$P"))"
  node -e '
    for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) { try { const o = JSON.parse(l); if (o.id === 3 && o.result) process.exit(o.result.isError === false ? 0 : 1); } catch {} }
    process.exit(1);' "$OUT" && pass "A: final response isError:false" || fail "A: final response"
  [ "$(field_of "$(json_for_id "$OUT" 3)" status)" = done ] && pass "A: pi_agent still returns done" || fail "A: id3 ($(json_for_id "$OUT" 3))"
} || true

# ---------------------------------------------------------------------------
# B. no token
# ---------------------------------------------------------------------------
{
  PB="$(make_scratch)"; OUT="$(make_scratch)/progress_b.jsonl"
  CLAUDE_PROJECT_DIR="$PB" feed "$OUT" "$(call 3 pi_agent '{"name":"pb","prompt":"one","run_in_background":false}')" "WAIT_FOR \"id\":3 10"
  [ -z "$(progress_lines "$OUT")" ] && pass "B: zero progress without a token" || fail "B: progress without a token"
  [ "$(field_of "$(json_for_id "$OUT" 3)" status)" = done ] && pass "B: pi_agent done" || fail "B: id3"
} || true

finish
