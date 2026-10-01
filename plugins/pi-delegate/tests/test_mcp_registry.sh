#!/usr/bin/env bash
# MCP registry tests — ADR-002 D5-B on the 0.11 tools: keep-alive reuse,
# TTL park + resume, dead-child resume, parallel names, no stale settle.
#   A one pi process serves pi_agent and the next pi_send_message
#   B TTL parks the idle child; pi_send_message resumes it (2 processes)
#   C an idle child killed with -9 is recorded failed{crash}; pi_send_message
#     resumes it
#   D two names in parallel both finish
#   E no stale settle on reuse (the two-turn regression, ADR-002 §5.2): turn 2
#     returns reply-2, never turn 1's settle
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/mcp.sh"
export PI_DELEGATE_PI_PACKAGE=/nonexistent

pid_line_count() { if [ -f "$1" ]; then wc -l < "$1" | tr -d ' '; else echo 0; fi; }
status_of() { field_of "$(json_for_id "$1" "$2")" status; }

# ---------------------------------------------------------------------------
# A. keep-alive reuse
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  PA="$(make_scratch)"; PIDS="$PA/pidfile"; : > "$PIDS"; OUT="$(make_scratch)/reg_a.jsonl"
  CLAUDE_PROJECT_DIR="$PA" PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"ra","prompt":"one","run_in_background":false}')" "WAIT_FOR \"id\":2 10" \
    "$(call 3 pi_send_message '{"to":"ra","message":"two"}')" "WAIT_FOR \"id\":3 10"
  [ "$(status_of "$OUT" 2)" = done ] && pass "A: pi_agent done" || fail "A: id2 ($(json_for_id "$OUT" 2))"
  [ "$(status_of "$OUT" 3)" = done ] && [ "$(field_of "$(json_for_id "$OUT" 3)" delivered)" = new_turn ] && pass "A: pi_send_message new_turn done" || fail "A: id3 ($(json_for_id "$OUT" 3))"
  [ "$(pid_line_count "$PIDS")" -eq 1 ] && pass "A: one pi process for both turns" || fail "A: pids $(pid_line_count "$PIDS")"
} || true

# ---------------------------------------------------------------------------
# B. TTL park + resume
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  PB="$(make_scratch)"; PIDS="$PB/pidfile"; : > "$PIDS"; OUT="$(make_scratch)/reg_b.jsonl"
  CLAUDE_PROJECT_DIR="$PB" PI_MCP_TTL_MS=1500 PI_MCP_REAP_INTERVAL_MS=500 PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"rb","prompt":"one","run_in_background":false}')" "WAIT_FOR \"id\":2 10" "SLEEP 4" \
    "$(call 3 pi_send_message '{"to":"rb","message":"two"}')" "WAIT_FOR \"id\":3 10"
  [ "$(status_of "$OUT" 3)" = done ] && [ "$(field_of "$(json_for_id "$OUT" 3)" delivered)" = resumed ] && pass "B: parked child resumed" || fail "B: id3 ($(json_for_id "$OUT" 3))"
  [ "$(pid_line_count "$PIDS")" -eq 2 ] && pass "B: two processes (TTL park + resume)" || fail "B: pids $(pid_line_count "$PIDS")"
} || true

# ---------------------------------------------------------------------------
# C. dead idle child: failed{crash}, then resumed
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  PC="$(make_scratch)"; PIDS="$PC/pidfile"; : > "$PIDS"; OUT="$(make_scratch)/reg_c.jsonl"; ST="$(make_scratch)/state"
  CLAUDE_PROJECT_DIR="$PC" PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"rc","prompt":"one","run_in_background":false}')" "WAIT_FOR \"id\":2 10" \
    "SH kill -9 \$(tail -1 '$PIDS'); sleep 0.5; meta_of '$(child_dir "$PC" rc)' state > '$ST'" \
    "$(call 3 pi_send_message '{"to":"rc","message":"two"}')" "WAIT_FOR \"id\":3 10"
  [ "$(cat "$ST")" = failed ] && pass "C: killed idle child recorded failed" || fail "C: state $(cat "$ST")"
  [ "$(status_of "$OUT" 3)" = done ] && [ "$(field_of "$(json_for_id "$OUT" 3)" delivered)" = resumed ] && pass "C: dead child resumed" || fail "C: id3 ($(json_for_id "$OUT" 3))"
  [ "$(pid_line_count "$PIDS")" -eq 2 ] && pass "C: two processes (original + resumed)" || fail "C: pids $(pid_line_count "$PIDS")"
} || true

# ---------------------------------------------------------------------------
# D. parallel names
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  PD="$(make_scratch)"; OUT="$(make_scratch)/reg_d.jsonl"
  CLAUDE_PROJECT_DIR="$PD" PI_STUB_SETTLE_MS=800 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"rd1","prompt":"hello","run_in_background":false}')" \
    "$(call 3 pi_agent '{"name":"rd2","prompt":"world","run_in_background":false}')" \
    "WAIT_FOR \"id\":2 10" "WAIT_FOR \"id\":3 10"
  [ "$(status_of "$OUT" 2)" = done ] && pass "D: rd1 done" || fail "D: rd1 ($(json_for_id "$OUT" 2))"
  [ "$(status_of "$OUT" 3)" = done ] && pass "D: rd2 done" || fail "D: rd2 ($(json_for_id "$OUT" 3))"
} || true

# ---------------------------------------------------------------------------
# E. no stale settle on reuse (pi-rpc-two-turns settles 0.4s after agent_start)
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-two-turns
  PE="$(make_scratch)"; OUT="$(make_scratch)/reg_e.jsonl"
  CLAUDE_PROJECT_DIR="$PE" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"re","prompt":"one","run_in_background":false}')" "WAIT_FOR \"id\":2 10" \
    "$(call 3 pi_send_message '{"to":"re","message":"two"}')" "WAIT_FOR \"id\":3 10"
  case "$(field_of "$(json_for_id "$OUT" 2)" text)" in *"reply-1"*) pass "E: turn 1 returns reply-1" ;; *) fail "E: id2 ($(json_for_id "$OUT" 2))" ;; esac
  case "$(field_of "$(json_for_id "$OUT" 3)" text)" in *"reply-2"*) pass "E: turn 2 returns reply-2 (no stale settle)" ;; *) fail "E: id3 ($(json_for_id "$OUT" 3))" ;; esac
} || true

finish
