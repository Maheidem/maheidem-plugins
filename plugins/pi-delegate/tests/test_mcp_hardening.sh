#!/usr/bin/env bash
# MCP server hardening regressions (2026-09-30 audit):
#   A spawn error (pi missing) -> ok:false, server stays alive
#   B idle reaper never kills a turn in flight
#   C status answers from the live child, no extra pi spawn; no spawn for an unknown name
#   D pi_stop {forget:true} mid-turn: aborts the turn, releases the lock, deletes session files
#   E live child's stderr is drained (a chatty child can't wedge on a full pipe)
#   F status/stop/read/answer/wait reject unsafe names
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/mcp.sh"

# ---------------------------------------------------------------------------
# A. pi not on PATH: the child's async 'error' used to be unhandled and crash
#    the whole server.
# ---------------------------------------------------------------------------
{
  EMPTY_BIN="$(make_scratch)/bin"; mkdir -p "$EMPTY_BIN"
  NODE_BIN="$(command -v node)"; TIMEOUT_BIN="$(command -v timeout)"
  OUT_A="$(make_scratch)/a.jsonl"
  {
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
    sleep 0.2
    printf '%s\n' "$(call 2 pi_agent '{"name":"ha","prompt":"hi","run_in_background":false}')"
    sleep 1.5
    printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}'
    printf '%s\n' "$(call 4 pi_agent '{"name":"hb","prompt":"hi"}')"
    sleep 1.5
  } | PATH="$EMPTY_BIN:/usr/bin:/bin" PI_DELEGATE_PROVIDER_EXTENSIONS=none "$TIMEOUT_BIN" 30 "$NODE_BIN" "$SERVER" > "$OUT_A" 2>/dev/null
  RC_A=$?
  IN_A2="$(json_for_id "$OUT_A" 2)"; IN_A4="$(json_for_id "$OUT_A" 4)"
  [ "$(field_of "$IN_A2" ok)" = "false" ] && pass "A: pi_agent ok:false" || fail "A: pi_agent ok:false (inner=$IN_A2)"
  case "$(field_of "$IN_A2" errorMessage)" in *"pi CLI not found"*|*"pi not found"*|*"not found on PATH"*) pass "A: pi_agent says pi is not found" ;; *) fail "A: pi_agent says pi CLI not found (inner=$IN_A2)" ;; esac
  grep -q '"id":3,"result":{"tools"' "$OUT_A" && pass "A: server still answers tools/list after the spawn error" || fail "A: server alive after spawn error (out=$(head -c 600 "$OUT_A"))"
  [ "$(field_of "$IN_A4" ok)" = "false" ] && pass "A: background pi_agent ok:false" || fail "A: background pi_agent ok:false (inner=$IN_A4)"
  case "$(field_of "$IN_A4" errorMessage)" in *"pi CLI not found"*|*"pi not found"*|*"not found on PATH"*) pass "A: background pi_agent says pi is not found" ;; *) fail "A: background pi_agent (inner=$IN_A4)" ;; esac
  [ "$RC_A" -eq 0 ] && pass "A: server exited cleanly (rc=0)" || fail "A: server exit rc=$RC_A"
} || true

# ---------------------------------------------------------------------------
# B. TTL 0.8s, reaper every 0.2s, a 3s turn: the reaper must not kill it.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  PIDFILE_B="$(make_scratch)/pids"; : > "$PIDFILE_B"
  OUT_B="$(make_scratch)/b.jsonl"
  PI_STUB_PID_FILE="$PIDFILE_B" PI_STUB_SETTLE_MS=3000 PI_MCP_TEST=1 PI_MCP_TTL_MS=800 PI_MCP_REAP_INTERVAL_MS=200 \
    feed "$OUT_B" "$(call 2 pi_agent '{"name":"hreap","prompt":"slow","run_in_background":false}')" "SLEEP 4"
  IN_B="$(json_for_id "$OUT_B" 2)"
  [ "$(field_of "$IN_B" status)" = "done" ] && pass "B: 3s turn survived a 0.8s TTL" || fail "B: turn survived reaper (inner=$IN_B)"
  case "$(field_of "$IN_B" text)" in *reply-1*) pass "B: result reply-1" ;; *) fail "B: result (inner=$IN_B)" ;; esac
  [ "$(wc -l < "$PIDFILE_B" | tr -d ' ')" -eq 1 ] && pass "B: exactly one child spawned" || fail "B: child spawns=$(wc -l < "$PIDFILE_B")"
} || true

# ---------------------------------------------------------------------------
# C. pi_list_agents {name}: numbers from the live child (no extra spawn); an
#    unknown name is an error listing the known ones, and still spawns nothing.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  PIDFILE_C="$(make_scratch)/pids"; : > "$PIDFILE_C"
  OUT_C="$(make_scratch)/c.jsonl"
  PI_STUB_PID_FILE="$PIDFILE_C" feed "$OUT_C" \
    "$(call 2 pi_agent '{"name":"hstat","prompt":"one","run_in_background":false}')" "SLEEP 1" \
    "$(call 3 pi_list_agents '{"name":"hstat"}')" \
    "$(call 4 pi_list_agents '{"name":"hnever-started-xyz"}')" "SLEEP 1"
  IN_C3="$(json_for_id "$OUT_C" 3)"; IN_C4="$(json_for_id "$OUT_C" 4)"
  [ "$(field_of "$IN_C3" ok)" = "true" ] && pass "C: live status ok:true" || fail "C: live status ok:true (inner=$IN_C3)"
  [ "$(field_of "$IN_C3" sessionId)" = "hstat-g1-teststore" ] && pass "C: live status sessionId = the generation's session" || fail "C: sessionId (inner=$IN_C3)"
  [ "$(field_of "$IN_C3" turnCount)" = "1" ] && pass "C: live status turnCount 1" || fail "C: turnCount (inner=$IN_C3)"
  [ "$(field_of "$IN_C3" usage.inputTokens)" = "1000" ] && pass "C: live status reports usage.inputTokens" || fail "C: usage (inner=$IN_C3)"
  case "$(field_of "$IN_C4" errorMessage)" in 'No pi agent named "hnever-started-xyz". Known: '*'hstat (idle)'*) pass "C: unknown name: error listing the known children" ;; *) fail "C: unknown-name (inner=$IN_C4)" ;; esac
  [ "$(wc -l < "$PIDFILE_C" | tr -d ' ')" -eq 1 ] && pass "C: statuses spawned no extra pi" || fail "C: pi spawns=$(wc -l < "$PIDFILE_C") (expected 1)"
} || true

# ---------------------------------------------------------------------------
# D. pi_stop {forget:true} while a turn is in flight: aborts it, releases the
#    lifetime lock and deletes the generation's session file, quickly.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  PROJ_D="$(make_scratch)"
  SESS_D="$(pi_sessions_dir "$PROJ_D")"; mkdir -p "$SESS_D"
  echo '{}' > "$SESS_D/2026-09-30T00-00-00_hend-g1-teststore.jsonl"
  LOCK_D="$(pi_lock_path "$PROJ_D" hend)"
  OUT_D="$(make_scratch)/d.jsonl"
  START_D=$(date +%s)
  CLAUDE_PROJECT_DIR="$PROJ_D" PI_DELEGATE_WAKE=channel PI_STUB_SETTLE_MS=30000 feed "$OUT_D" \
    "$(call 2 pi_agent '{"name":"hend","prompt":"long"}')" "SLEEP 1" \
    "$(call 3 pi_stop '{"name":"hend","forget":true}')" "WAIT_FOR \"id\":3 15" \
    "$(call 4 pi_list_agents '{"name":"hend"}')" "SLEEP 1"
  ELAPSED_D=$(( $(date +%s) - START_D ))
  IN_D2="$(json_for_id "$OUT_D" 2)"; IN_D3="$(json_for_id "$OUT_D" 3)"; IN_D4="$(json_for_id "$OUT_D" 4)"
  [ "$(field_of "$IN_D2" status)" = "running" ] && pass "D: turn dispatched (channel mode)" || fail "D: dispatch (inner=$IN_D2)"
  [ "$(field_of "$IN_D3" ok)" = "true" ] && pass "D: stop forget mid-turn ok:true" || fail "D: stop ok:true (inner=$IN_D3)"
  case "$(head_for_id "$OUT_D" 3)" in "stopped pi:hend (was running) and forgot it: removed session file"*) pass "D: stop reports the turn and the file removal" ;; *) fail "D: stop head ($(head_for_id "$OUT_D" 3))" ;; esac
  [ ! -e "$SESS_D/2026-09-30T00-00-00_hend-g1-teststore.jsonl" ] && pass "D: session file deleted" || fail "D: session file still present"
  [ ! -e "$LOCK_D" ] && pass "D: lock released" || fail "D: lock still present at $LOCK_D"
  case "$(field_of "$IN_D4" errorMessage)" in 'No pi agent named "hend"'*) pass "D: forgotten child is gone from pi_list_agents" ;; *) fail "D: list after forget (inner=$IN_D4)" ;; esac
  [ "$ELAPSED_D" -lt 15 ] && pass "D: finished in ${ELAPSED_D}s (turn was 30s)" || fail "D: took ${ELAPSED_D}s"
} || true

# ---------------------------------------------------------------------------
# E. 512 KB of stderr per turn: without draining, the child blocks on a full
#    pipe and the turn never settles.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  OUT_E="$(make_scratch)/e.jsonl"
  PI_STUB_STDERR_KB=512 feed "$OUT_E" \
    "$(call 2 pi_agent '{"name":"hnoisy","prompt":"x","run_in_background":false}')" "WAIT_FOR \"id\":2 15" \
    "$(call 3 pi_send_message '{"to":"hnoisy","message":"y"}')" "WAIT_FOR \"id\":3 15"
  IN_E2="$(json_for_id "$OUT_E" 2)"; IN_E3="$(json_for_id "$OUT_E" 3)"
  [ "$(field_of "$IN_E2" status)" = "done" ] && pass "E: noisy turn 1 settled" || fail "E: noisy turn 1 (inner=$(echo "$IN_E2" | head -c 300))"
  [ "$(field_of "$IN_E3" delivered)" = "new_turn" ] && case "$(field_of "$IN_E3" text)" in *reply-2*) true ;; *) false ;; esac && pass "E: noisy turn 2 settled on the same child" || fail "E: noisy turn 2 (inner=$(echo "$IN_E3" | head -c 300))"
} || true

# ---------------------------------------------------------------------------
# F. Unsafe names never reach lock paths / pi argv.
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  OUT_F="$(make_scratch)/f.jsonl"
  feed "$OUT_F" \
    "$(call 2 pi_list_agents '{"name":"-x"}')" \
    "$(call 3 pi_stop '{"name":"a b"}')" \
    "$(call 4 pi_read '{"name":""}')" \
    "$(call 5 pi_answer '{"name":"-y","answer":"z"}')" \
    "$(call 6 pi_wait '{"name":"a b","timeout_ms":100}')"
  for id in 2 3 4 5 6; do
    IN_F="$(json_for_id "$OUT_F" "$id")"
    # an empty name (id 4) is missing, not unsafe: the 0.11 resolver says "name is required"
    case "$id:$(field_of "$IN_F" errorMessage)" in *"invalid conversation name"*|[0-9]:"invalid name"*|"4:name is required") pass "F: id $id rejects the unsafe name" ;; *) fail "F: id $id (inner=$IN_F)" ;; esac
  done
} || true

finish
