#!/usr/bin/env bash
# MCP notifications/progress tests -- ADR-005 §B: additive visibility layer on
# top of the still-blocking pi_conversation_send, gated on the client sending
# _meta.progressToken on the originating tools/call.
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

# progress_lines <file> -> prints one JSON object per line for every
# notifications/progress message found (raw line parse, not id-keyed).
progress_lines() {
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
    for (const l of lines) {
      let o;
      try { o = JSON.parse(l); } catch { continue; }
      if (o && o.method === "notifications/progress") console.log(JSON.stringify(o));
    }
  ' "$1"
}

# ---------------------------------------------------------------------------
# A. Progress notifications during a send with _meta.progressToken -- no id
#    field, correct/matching progressToken, strictly increasing progress
#    (at least the steer-forced notification, which bypasses the ~1s
#    coalescing floor; a preceding agent_start ping may or may not survive
#    the floor depending on real scheduling latency, so we only require >=1,
#    not an exact count); final tools/call response unaffected.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-two-turns
  OUT_A="$(make_scratch)/progress_happy.jsonl"
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
    sleep 0.2
    printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"pa","message":"one","timeout_ms":20000},"_meta":{"progressToken":7}}}'
    sleep 0.15
    printf '%s\n' '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"pi_conversation_steer","arguments":{"name":"pa","message":"extra"}}}'
    sleep 1.0
  } | timeout 60 node "$SERVER" > "$OUT_A" 2>/dev/null || true

  PROGRESS_A="$(make_scratch)/progress_a.jsonl"
  progress_lines "$OUT_A" > "$PROGRESS_A"
  COUNT_A="$(wc -l < "$PROGRESS_A" | tr -d ' ')"
  [ "$COUNT_A" -ge 1 ] && pass "A: at least 1 progress notification emitted (got $COUNT_A)" || fail "A: at least 1 progress notification emitted (got $COUNT_A)"

  if node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
    if (lines.length === 0) process.exit(1);
    let lastProgress = -Infinity;
    for (const l of lines) {
      const o = JSON.parse(l);
      if ("id" in o) process.exit(1);
      if (o.params.progressToken !== 7) process.exit(1);
      if (!(o.params.progress > lastProgress)) process.exit(1);
      lastProgress = o.params.progress;
    }
    process.exit(0);
  ' "$PROGRESS_A"; then
    pass "A: no id field, progressToken:7, strictly increasing progress"
  else
    fail "A: no id field, progressToken:7, strictly increasing progress"
  fi

  grep -q '"message":"steered: extra"' "$PROGRESS_A" && pass "A: steer-triggered progress message present" || fail "A: steer-triggered progress message present (lines=$(cat "$PROGRESS_A"))"

  IN_A3="$(inner_for_id "$OUT_A" 3)"
  grep -q '"id":3,"result"' "$OUT_A" && pass "A: final tools/call response for id 3 present" || fail "A: final tools/call response for id 3 present"
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
    const msg = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).find(o => o && o.id === 3 && o.result);
    process.exit(msg && msg.result.isError === false ? 0 : 1);
  ' "$OUT_A" && pass "A: final response isError:false (unaffected by progress)" || fail "A: final response isError:false (unaffected by progress)"
  [ "$(field_of "$IN_A3" ok)" = "true" ] && pass "A: send still ok:true" || fail "A: send still ok:true (inner=$IN_A3)"
} || true

# ---------------------------------------------------------------------------
# B. Negative case -- no _meta.progressToken supplied -> zero progress lines.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-two-turns
  OUT_B="$(make_scratch)/progress_none.jsonl"
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
    sleep 0.2
    printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"pb","message":"one","timeout_ms":20000}}}'
    sleep 1.0
  } | timeout 60 node "$SERVER" > "$OUT_B" 2>/dev/null || true

  PROGRESS_B="$(make_scratch)/progress_b.jsonl"
  progress_lines "$OUT_B" > "$PROGRESS_B"
  COUNT_B="$(wc -l < "$PROGRESS_B" | tr -d ' ')"
  [ "$COUNT_B" -eq 0 ] && pass "B: zero progress notifications without progressToken" || fail "B: zero progress notifications without progressToken (got $COUNT_B)"

  IN_B3="$(inner_for_id "$OUT_B" 3)"
  [ "$(field_of "$IN_B3" ok)" = "true" ] && pass "B: send still ok:true" || fail "B: send still ok:true (inner=$IN_B3)"
} || true

finish
