#!/usr/bin/env bash
# MCP registry tests — ADR-002 D5-B: keep-alive reuse, TTL reap + respawn,
# dead-child respawn, parallel names.
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

SERVER="$PLUGIN_ROOT/scripts/pi-mcp-server.mjs"
CLIENT="$TESTS_DIR/lib/mcp-client.mjs"

# ---------------------------------------------------------------------------
# Shared setup per case: own scratch dir, own PID file, own use_stub.
# ---------------------------------------------------------------------------

pid_line_count() {
  local pf="$1"
  if [ -f "$pf" ]; then wc -l < "$pf" | tr -d ' '; else echo 0; fi
}

# ---------------------------------------------------------------------------
# A. Keep-alive reuse — one child serves both turns; pid file has EXACTLY 1 line.
# ---------------------------------------------------------------------------
{
  SCRATCH_A="$(make_scratch)"
  PIDFILE_A="$SCRATCH_A/pidfile"
  touch "$PIDFILE_A"
  use_stub pi-rpc-pidfile
  export PI_STUB_PID_FILE="$PIDFILE_A"

  OUT_A="$(make_scratch)/reg_a.json"
  timeout 90 node "$CLIENT" "$SERVER" \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"ra","message":"one"}}}' \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"ra","message":"two"}}}' \
    > "$OUT_A" 2>&1 || true

  # Extract ok:true from both tool responses (lines 2 and 3 of output)
  LINES_A="$(wc -l < "$OUT_A" | tr -d ' ')"
  OK1_A="$(sed -n '2p' "$OUT_A" | grep -c 'ok.*true' || true)"
  OK2_A="$(sed -n '3p' "$OUT_A" | grep -c 'ok.*true' || true)"
  PIDCOUNT_A="$(pid_line_count "$PIDFILE_A")"

  if [ "$OK1_A" -gt 0 ]; then pass "A: send #1 ok:true"; else fail "A: send #1 ok:true (lines=$LINES_A, pidcount=$PIDCOUNT_A)"; fi
  if [ "$OK2_A" -gt 0 ]; then pass "A: send #2 ok:true"; else fail "A: send #2 ok:true (lines=$LINES_A, pidcount=$PIDCOUNT_A)"; fi
  if [ "$PIDCOUNT_A" -eq 1 ]; then pass "A: pid file has exactly 1 line"; else fail "A: pid file has $PIDCOUNT_A lines (expected 1, D5-B proof)"; fi
} || true

# ---------------------------------------------------------------------------
# B. TTL reap + respawn — server with PI_MCP_TTL_MS=1500, REAP_INTERVAL_MS=500.
#    Two sends separated by sleep 4 (well past TTL). Pid file has EXACTLY 2 lines.
# ---------------------------------------------------------------------------
{
  SCRATCH_B="$(make_scratch)"
  PIDFILE_B="$SCRATCH_B/pidfile"
  touch "$PIDFILE_B"
  use_stub pi-rpc-pidfile
  export PI_STUB_PID_FILE="$PIDFILE_B"

  OUT_B="$(make_scratch)/reg_b.json"
  {
    printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n'
    printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"rb","message":"one"}}}\n'
    sleep 4
    printf '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"rb","message":"two"}}}\n'
    sleep 2
  } | timeout 90 env PI_MCP_TTL_MS=1500 PI_MCP_REAP_INTERVAL_MS=500 node "$SERVER" > "$OUT_B" 2>&1 || true

  LINES_B="$(wc -l < "$OUT_B" | tr -d ' ')"
  OK1_B="$(sed -n '2p' "$OUT_B" | grep -c 'ok.*true' || true)"
  OK2_B="$(sed -n '3p' "$OUT_B" | grep -c 'ok.*true' || true)"
  PIDCOUNT_B="$(pid_line_count "$PIDFILE_B")"

  if [ "$OK1_B" -gt 0 ]; then pass "B: send #1 ok:true"; else fail "B: send #1 ok:true (lines=$LINES_B, pidcount=$PIDCOUNT_B)"; fi
  if [ "$OK2_B" -gt 0 ]; then pass "B: send #2 ok:true"; else fail "B: send #2 ok:true (lines=$LINES_B, pidcount=$PIDCOUNT_B)"; fi
  if [ "$PIDCOUNT_B" -eq 2 ]; then pass "B: pid file has exactly 2 lines (TTL reap + respawn)"; else fail "B: pid file has $PIDCOUNT_B lines (expected 2, TTL reap + respawn)"; fi
} || true

# ---------------------------------------------------------------------------
# C. Dead-child respawn — like A but kill -9 the recorded pid between sends.
#    Pid file should have 2 lines (original + respawned).
# ---------------------------------------------------------------------------
{
  SCRATCH_C="$(make_scratch)"
  PIDFILE_C="$SCRATCH_C/pidfile"
  touch "$PIDFILE_C"
  use_stub pi-rpc-pidfile
  export PI_STUB_PID_FILE="$PIDFILE_C"

  OUT_C="$(make_scratch)/reg_c.json"

  # Write a small helper script that feeds the server and kills the child mid-stream.
  FEEDER_C="$SCRATCH_C/feeder.sh"
  cat > "$FEEDER_C" << 'FEEDER_EOF'
#!/usr/bin/env bash
set -uo pipefail
PIDFILE="$1"
SERVER="$2"
OUTFILE="$3"

{
  printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n'
  printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"rc","message":"one"}}}\n'
  sleep 2
  # Kill the child stub process recorded in pidfile
  if [ -f "$PIDFILE" ] && [ -s "$PIDFILE" ]; then
    KILL_PID="$(tail -1 "$PIDFILE")"
    if [ -n "$KILL_PID" ]; then
      kill -9 "$KILL_PID" 2>/dev/null || true
    fi
  fi
  sleep 1
  printf '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"rc","message":"two"}}}\n'
  sleep 3
} | timeout 90 node "$SERVER" > "$OUTFILE" 2>&1 || true
FEEDER_EOF
  chmod +x "$FEEDER_C"

  bash "$FEEDER_C" "$PIDFILE_C" "$SERVER" "$OUT_C"

  LINES_C="$(wc -l < "$OUT_C" | tr -d ' ')"
  OK1_C="$(sed -n '2p' "$OUT_C" | grep -c 'ok.*true' || true)"
  OK2_C="$(sed -n '3p' "$OUT_C" | grep -c 'ok.*true' || true)"
  PIDCOUNT_C="$(pid_line_count "$PIDFILE_C")"

  if [ "$OK1_C" -gt 0 ]; then pass "C: send #1 ok:true"; else fail "C: send #1 ok:true (lines=$LINES_C, pidcount=$PIDCOUNT_C)"; fi
  if [ "$OK2_C" -gt 0 ]; then pass "C: send #2 ok:true (dead-child respawn)"; else fail "C: send #2 ok:true (lines=$LINES_C, pidcount=$PIDCOUNT_C)"; fi
  if [ "$PIDCOUNT_C" -eq 2 ]; then pass "C: pid file has exactly 2 lines (dead-child respawn)"; else fail "C: pid file has $PIDCOUNT_C lines (expected 2, dead-child respawn)"; fi
} || true

# ---------------------------------------------------------------------------
# D. Parallel names — initialize + send(name rd1) + send(name rd2) in one pipe.
#    Both ok:true.
# ---------------------------------------------------------------------------
{
  SCRATCH_D="$(make_scratch)"
  PIDFILE_D="$SCRATCH_D/pidfile"
  touch "$PIDFILE_D"
  use_stub pi-rpc-pidfile
  export PI_STUB_PID_FILE="$PIDFILE_D"

  OUT_D="$(make_scratch)/reg_d.json"
  timeout 90 node "$CLIENT" "$SERVER" \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"rd1","message":"hello"}}}' \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"rd2","message":"world"}}}' \
    > "$OUT_D" 2>&1 || true

  LINES_D="$(wc -l < "$OUT_D" | tr -d ' ')"
  OK1_D="$(sed -n '2p' "$OUT_D" | grep -c 'ok.*true' || true)"
  OK2_D="$(sed -n '3p' "$OUT_D" | grep -c 'ok.*true' || true)"

  if [ "$OK1_D" -gt 0 ]; then pass "D: send rd1 ok:true"; else fail "D: send rd1 ok:true (lines=$LINES_D)"; fi
  if [ "$OK2_D" -gt 0 ]; then pass "D: send rd2 ok:true"; else fail "D: send rd2 ok:true (lines=$LINES_D)"; fi
} || true

# ---------------------------------------------------------------------------
# E. No stale settle on reuse — the two-turn regression (ADR-002 §5.2).
#    pi-rpc-two-turns sleeps 0.4s before agent_settled, so on a reused
#    channel the previous turn's agent_settled would make waitSettle's
#    alreadySettled check return immediately for the next send. OP1
#    clears ch.events per turn to fix this.
# ---------------------------------------------------------------------------
{
  SCRATCH_E="$(make_scratch)"
  use_stub pi-rpc-two-turns

  OUT_E="$(make_scratch)/reg_e.json"
  timeout 90 node "$CLIENT" "$SERVER" \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"re","message":"one"}}}' \
    '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pi_conversation_send","arguments":{"name":"re","message":"two"}}}' \
    > "$OUT_E" 2>&1 || true

  # Both turns must succeed (ok:true) AND return correct distinct replies.
  LINES_E="$(wc -l < "$OUT_E" | tr -d ' ')"
  OK1_E="$(sed -n '2p' "$OUT_E" | grep -c 'ok.*true' || true)"
  OK2_E="$(sed -n '3p' "$OUT_E" | grep -c 'ok.*true' || true)"

  # Extract the finalText from each tool-call response.
  # Response lines: [0]=initialize(id=1), [1]=send#1(id=2,turn1), [2]=send#2(id=3,turn2).
  # JSON path: result.content[0].text → inner JSON → finalText field.
  TEXT3_E="$(node -e "
    const fs = require('fs');
    const lines = fs.readFileSync(process.argv[1], 'utf8').trim().split('\\n');
    const r = JSON.parse(lines[1]); // id=2 response → turn 1
    const inner = JSON.parse(r.result.content[0].text);
    process.stdout.write(inner.finalText || '');
  " "$OUT_E")"

  TEXT4_E="$(node -e "
    const fs = require('fs');
    const lines = fs.readFileSync(process.argv[1], 'utf8').trim().split('\\n');
    const r = JSON.parse(lines[2]); // id=3 response → turn 2
    const inner = JSON.parse(r.result.content[0].text);
    process.stdout.write(inner.finalText || '');
  " "$OUT_E")"

  if [ "$OK1_E" -gt 0 ]; then pass "E: send #1 ok:true"; else fail "E: send #1 ok:true (lines=$LINES_E)"; fi
  if [ "$OK2_E" -gt 0 ]; then pass "E: send #2 ok:true"; else fail "E: send #2 ok:true (lines=$LINES_E)"; fi
  if [ "$TEXT3_E" = "reply-1" ]; then pass "E: id-3 finalText contains 'reply-1' (got '$TEXT3_E')"; else fail "E: id-3 finalText contains 'reply-1' (got '$TEXT3_E')"; fi
  if [ "$TEXT4_E" = "reply-2" ]; then pass "E: id-4 finalText contains 'reply-2' (got '$TEXT4_E')"; else fail "E: id-4 finalText contains 'reply-2' (got '$TEXT4_E')"; fi
} || true

finish
