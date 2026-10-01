#!/usr/bin/env bash
# 0.11 S4 (stub pi): pi_send_message, pi_answer, pi_stop, server-owned ask
# expiry, the per-turn question budget, and the 0.10 names' renamed errors.
#   A tools/list has the 0.11 tools and none of the renamed ones; each old name
#     returns "renamed, use <new call>" (isError)
#   B running -> steer (returns at once, the turn's own call keeps the wake),
#     follow_up queues, idle -> new_turn (same pid) that blocks until done
#   C waiting + no interrupt -> refused with the full question, nothing
#     consumed; pi_answer relay_user -> picked up (askAnswered), blocks until
#     done; a late pi_answer -> already resolved (how, HH:MM)
#   D two questions: no question_id refused (lists both), the first answer
#     says "still blocked on <q2> (same batch)", the second holds the wake
#   E budget per turn (PI_MCP_ASK_MAX_PER_TURN=2): the 3rd question is answered
#     at once by the server, question_expired{budget} rides on DONE; the next
#     turn counts from 1 again; pi_stop on a waiting child pre-answers it
#   F expiry: the child gets the 4h hard cap / out-of-reach budget; the soft
#     timer starts only once the question is consumed, then the server answers
#     with the fallback text (model (timeout)); a late pi_answer is refused
#   G interrupt while blocked in ask: pre-answer, the old turn ends as
#     interrupted (no wake), the new prompt runs, all in < 15s; pi_stop
#     {forget:true} frees the name
#   H steer then interrupt: clear_queue drops the steer (dropped_queue), it
#     never reaches the child; the old turn's call returns "interrupted"
#   I a child that ignores abort is killed after 10s and respawned on the same
#     session (respawned:true)
#   J pi_stop keeps the session; pi_send_message resumes it (new pid, same
#     --session-id); unknown names list the known ones; task_id "pi:R" resolves
#   K a parked child (TTL) is resumed by pi_send_message
#   L confirmed channel: pi_answer and pi_send_message return at once
#   M another live session's child: pi_send_message / pi_answer / pi_stop refuse
#   N pi_stop {forget:true} deletes only the session ids the child recorded,
#     matched exactly: a sibling "y_x" and a child named "x-g1" keep theirs
#   O an orphaned pi (server SIGKILLed, the pi still running): pi_stop and a
#     resume kill it first (pre-answering its open question), never two pi on
#     one session; the dead server's lifetime lock is released
#   P a resume runs the get_state model handshake: another model -> killed,
#     nothing sent, failed{resume_model_mismatch}
#   Q a resume respects the live cap (all busy -> cap error; idle -> parked)
#   R pi_list_agents / pi_read use the 0.11 resolver
#   S fallback: an answer that expired before pickup still holds the wake (DONE)
#   T fallback: a pushed-only DONE (cancelled call) comes back inline on the next send
#   U a message sent between agent_settled and the turn's end runs as a new turn
#   V a resume after the pin changed reports pin drift
#   W heartbeats and descriptions warn that TaskStop only drops the wake
#   X fallback, the question expires unanswered: the QUESTION return says the
#     child goes on alone; a late pi_answer with no question_id says "already
#     resolved (expired (timeout), HH:MM)", takes the wake and carries the DONE
#   Y fallback, a second question after the first expired: the late pi_answer
#     carries it (with its text), and answering it holds the wake until DONE
#   Z a batch question read after the first one returned: the sibling answer
#     carries its topic and text and consumes it (its expiry clock starts)
# The stub titles itself "pi" like real pi, so O's orphan detection cannot rely on argv.
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/mcp.sh"

FAKE_PKG="$(make_scratch)/pi-delegate-pkg"
mkdir -p "$FAKE_PKG" && echo '{"name":"@maheidem/pi-delegate"}' > "$FAKE_PKG/package.json"
export PI_DELEGATE_PI_PACKAGE="$FAKE_PKG"
use_stub pi-rpc-lab

# A tool result is "<headline...>\n<json>": the JSON is the last line.
res_json() { inner_for_id "$1" "$2" | tail -n 1; }
res_head() { inner_for_id "$1" "$2" | sed '$d'; }
is_error() { # is_error <out> <id> -> true|false
  node -e '
    for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
      try { const o = JSON.parse(l); if (o.id === Number(process.argv[2]) && o.result) process.stdout.write(String(o.result.isError)); } catch {}
    }' "$1" "$2"
}
line_of_id() { # line number of the response with that id
  node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").split("\n");
    for (let i = 0; i < ls.length; i++) { try { const o = JSON.parse(ls[i]); if (o.id === Number(process.argv[2]) && o.result) { process.stdout.write(String(i)); break; } } catch {} }' "$1" "$2"
}
qid() { node -e 'process.stdout.write("q_" + require("crypto").createHash("sha1").update(process.argv[1]).digest("hex").slice(0, 6))' "$1"; }
events_eval() { # events_eval <child-dir> <js expr over evs>
  node -e 'let raw = ""; try { raw = require("fs").readFileSync(process.argv[1] + "/events.jsonl", "utf8"); } catch {}
    const evs = raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"
}
meta_eval() {
  node -e 'const m = JSON.parse(require("fs").readFileSync(process.argv[1] + "/meta.json", "utf8")); process.stdout.write(String(eval(process.argv[2])))' "$1" "$2" 2>/dev/null
}
lock_of() { echo "${TMPDIR:-/tmp}/pi-delegate-locks/$(pi_session_slug "$1")__$2.lock"; }
call_tok() { # call_tok <id> <tool> <args-json> <progress-token>
  printf '{"jsonrpc":"2.0","id":%s,"method":"tools/call","params":{"name":"%s","arguments":%s,"_meta":{"progressToken":"%s"}}}' "$1" "$2" "$3" "$4"
}
cancel() { printf '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":%s}}' "$1"; }
now_ms() { node -e 'process.stdout.write(String(Date.now()))'; }
export -f now_ms

# ---------------------------------------------------------------------------
# A. renamed tools
# ---------------------------------------------------------------------------
{
  PA="$(make_scratch)"; OUT="$(make_scratch)/a.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"
  CLAUDE_PROJECT_DIR="$PA" PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' "WAIT_FOR \"id\":2 5" \
    "$(call 3 pi_task '{"text":"x"}')" "$(call 4 pi_conversation_send '{"name":"a","message":"x"}')" \
    "$(call 5 pi_conversation_send_async '{"name":"a","message":"x"}')" "$(call 6 pi_conversation_steer '{"name":"a","message":"x"}')" \
    "$(call 7 pi_conversation_interrupt '{"name":"a","message":"x"}')" "$(call 8 pi_respond '{"name":"a","value":"x"}')" \
    "$(call 9 pi_conversation_end '{"name":"a"}')" \
    "$(call 10 pi_setup '{}')" "$(call 11 pi_conversation_status '{"name":"a"}')" "$(call 12 pi_conversation_read '{"name":"a"}')" "WAIT_FOR \"id\":12 5"
  NAMES="$(node -e '
    for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
      try { const o = JSON.parse(l); if (o.id === 2) process.stdout.write(o.result.tools.map((t) => t.name).sort().join(",")); } catch {}
    }' "$OUT")"
  [ "$NAMES" = "pi_agent,pi_answer,pi_list_agents,pi_read,pi_send_message,pi_stop,pi_wait" ] \
    && pass "A: tools/list = 0.11 tools (+ pi_wait until S6)" || fail "A: tools ($NAMES)"
  ok=1
  for pair in "3:pi_agent {prompt, run_in_background:false}" "6:pi_send_message {to, message}" "7:pi_send_message {to, message, interrupt:true}" \
              "8:pi_answer {to, question_id:\"d_...\", value | confirmed | cancelled}" "9:pi_stop {name, forget:true}" \
              "10:pi_list_agents {doctor:true}" "11:pi_list_agents {name}" "12:pi_read {name, what:\"transcript\"}"; do
    id="${pair%%:*}"; want="renamed, use ${pair#*:}"
    got="$(field_of "$(res_json "$OUT" "$id")" errorMessage)"
    [ "$got" = "$want" ] && [ "$(is_error "$OUT" "$id")" = true ] || { ok=0; echo "    id $id: $got" >&2; }
  done
  for id in 4 5; do case "$(field_of "$(res_json "$OUT" "$id")" errorMessage)" in "renamed, use pi_agent {name, prompt} for a new child, pi_send_message"*) ;; *) ok=0 ;; esac; done
  [ "$ok" = 1 ] && pass "A: every 0.10 name returns renamed, use <new call> (isError)" || fail "A: renamed errors"
  [ ! -s "$PIDS" ] && pass "A: no pi started by a renamed call" || fail "A: pi started"
} || true

# ---------------------------------------------------------------------------
# B. steer / follow_up / new turn
# ---------------------------------------------------------------------------
{
  PB="$(make_scratch)"; OUT="$(make_scratch)/b.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"; LOG="$(make_scratch)/stub.log"
  CLAUDE_PROJECT_DIR="$PB" PI_STUB_SETTLE_MS=1500 PI_STUB_PID_FILE="$PIDS" PI_STUB_LOG_FILE="$LOG" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"w","prompt":"one","run_in_background":false}')" "SLEEP 0.7" \
    "$(call 3 pi_send_message '{"to":"w","message":"S-TOKEN"}')" "WAIT_FOR \"id\":3 5" \
    "$(call 4 pi_send_message '{"to":"pi:W","message":"F-TOKEN","mode":"follow_up"}')" "WAIT_FOR \"id\":4 5" \
    "WAIT_FOR \"id\":2 10" \
    "$(call 5 pi_send_message '{"to":"w","message":"two"}')" "WAIT_FOR \"id\":5 10"
  case "$(res_head "$OUT" 3)" in "delivered steer to pi:w (turn 1); it reaches the child at its next step.") pass "B: running -> delivered steer" ;; *) fail "B: steer head ($(res_head "$OUT" 3))" ;; esac
  [ "$(field_of "$(res_json "$OUT" 4)" delivered)" = follow_up ] && pass "B: mode follow_up -> delivered follow_up (pi:W resolved)" || fail "B: follow_up ($(res_json "$OUT" 4))"
  [ "$(line_of_id "$OUT" 3)" -lt "$(line_of_id "$OUT" 2)" ] && pass "B: steer returned at once, before the turn's own call" || fail "B: steer order"
  case "$(res_head "$OUT" 2)" in *"DONE turn 1 ok"*) pass "B: the spawn call kept the wake (DONE turn 1)" ;; *) fail "B: id2 ($(res_head "$OUT" 2))" ;; esac
  grep -qx "steer:S-TOKEN" "$LOG" && grep -qx "follow_up:F-TOKEN" "$LOG" && pass "B: stub received the steer and the follow_up" || fail "B: stub log ($(cat "$LOG"))"
  J="$(res_json "$OUT" 5)"
  [ "$(field_of "$J" delivered)" = new_turn ] && [ "$(field_of "$J" turn)" = 2 ] && [ "$(field_of "$J" status)" = done ] \
    && pass "B: idle -> new_turn, turn 2, blocked until done" || fail "B: new turn ($J)"
  [ "$(wc -l < "$PIDS" | tr -d ' ')" = 1 ] && pass "B: same pi process for both turns" || fail "B: pids $(cat "$PIDS")"
} || true

# ---------------------------------------------------------------------------
# C. refuse while waiting, answer (relay_user), late answer
# ---------------------------------------------------------------------------
{
  PC="$(make_scratch)"; OUT="$(make_scratch)/c.jsonl"; CD="$(child_dir "$PC" q)"; S1="$(make_scratch)/s1"; S2="$(make_scratch)/s2"
  Q="$(qid call_1_1)"
  CLAUDE_PROJECT_DIR="$PC" PI_STUB_ASKS=1 PI_STUB_ASK_WAIT_MS=20000 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"q","prompt":"go","run_in_background":false}')" "WAIT_FOR \"id\":2 10" "SLEEP 0.3" \
    "SNAP $CD $S1" \
    "$(call 3 pi_send_message '{"to":"q","message":"hey"}')" "WAIT_FOR \"id\":3 5" "SLEEP 0.3" \
    "SNAP $CD $S2" \
    "$(call 4 pi_answer '{"to":"q","answer":"blue","relay_user":true}')" "WAIT_FOR \"id\":4 10" \
    "$(call 5 pi_answer "$(json_obj to q question_id "$Q" answer late)")" "WAIT_FOR \"id\":5 5"
  [ "$(field_of "$(res_json "$OUT" 2)" status)" = waiting ] && pass "C: spawn returned on the question" || fail "C: id2 ($(res_json "$OUT" 2))"
  E="$(field_of "$(res_json "$OUT" 3)" errorMessage)"
  [ "$E" = "pi:q is blocked on question $Q (blocked): \"question call_1_1?\". Use pi_answer, or pi_send_message {interrupt:true}." ] \
    && pass "C: send while waiting refused with the full question" || fail "C: refusal ($E)"
  [ "$(cat "$S1")" = "$(cat "$S2")" ] && pass "C: the refusal consumed nothing ($(cat "$S1"))" || fail "C: cursor moved $(cat "$S1") -> $(cat "$S2")"
  H="$(res_head "$OUT" 4)"
  case "$H" in "answered $Q for pi:q; picked up; it continues in the same session."*"DONE turn 1 ok"*) pass "C: picked up, then held the wake until DONE" ;; *) fail "C: answer head ($H)" ;; esac
  J="$(res_json "$OUT" 4)"
  [ "$(field_of "$J" answeredBy)" = "model (relaying user)" ] && [ "$(field_of "$J" pickup)" = "picked up" ] && [ "$(field_of "$J" status)" = done ] \
    && pass "C: relay_user recorded as model (relaying user)" || fail "C: answer json ($J)"
  case "$(field_of "$J" text)" in *"got:blue@model (relaying user)"*) pass "C: the child read the answer file" ;; *) fail "C: done text ($(field_of "$J" text))" ;; esac
  [ "$(events_eval "$CD" 'evs.filter((e) => e.type === "answered").map((e) => e.data.answeredBy + "|" + /call_1_1\.json$/.test(e.data.path)).join()')" = "model (relaying user)|true" ] \
    && pass "C: answered event records answeredBy and the answer path" || fail "C: answered event"
  case "$(field_of "$(res_json "$OUT" 5)" errorMessage)" in "question $Q already resolved (answered by model (relaying user), "[0-9][0-9]:[0-9][0-9]")") pass "C: late pi_answer refused" ;; *) fail "C: late ($(res_json "$OUT" 5))" ;; esac
} || true

# ---------------------------------------------------------------------------
# D. sibling questions
# ---------------------------------------------------------------------------
{
  PD="$(make_scratch)"; OUT="$(make_scratch)/d.jsonl"; Q1="$(qid call_1_1)"; Q2="$(qid call_1_2)"
  CLAUDE_PROJECT_DIR="$PD" PI_STUB_ASKS=2 PI_STUB_ASK_WAIT_MS=20000 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"s","prompt":"go","run_in_background":false}')" "WAIT_FOR \"id\":2 10" "SLEEP 0.3" \
    "$(call 3 pi_answer '{"to":"s","answer":"x"}')" "WAIT_FOR \"id\":3 5" \
    "$(call 4 pi_answer "$(json_obj to s question_id "$Q1" answer one)")" "WAIT_FOR \"id\":4 10" \
    "$(call 5 pi_answer "$(json_obj to s question_id "$Q2" answer two)")" "WAIT_FOR \"id\":5 10"
  case "$(field_of "$(res_json "$OUT" 3)" errorMessage)" in "2 questions pending on pi:s; pass question_id (one of: $Q1"*"$Q2"*) pass "D: no question_id with two pending refused, both listed" ;; *) fail "D: ($(res_json "$OUT" 3))" ;; esac
  [ "$(res_head "$OUT" 4)" = "answered $Q1 for pi:s; picked up; still blocked on $Q2 (blocked): \"question call_1_2?\" (same batch)." ] && pass "D: sibling still pending is named with its topic and text" || fail "D: id4 ($(res_head "$OUT" 4))"
  case "$(res_json "$OUT" 5)" in *'"status":"done"'*'got:one@model|got:two@model'*) pass "D: last answer held the wake until DONE" ;; *) fail "D: id5 ($(res_json "$OUT" 5))" ;; esac
} || true

# ---------------------------------------------------------------------------
# E. per-turn budget; pi_stop on a waiting child
# ---------------------------------------------------------------------------
{
  PE="$(make_scratch)"; OUT="$(make_scratch)/e.jsonl"; CD="$(child_dir "$PE" b)"; Q1="$(qid call_1_1)"; Q2="$(qid call_1_2)"; Q3="$(qid call_1_3)"
  CLAUDE_PROJECT_DIR="$PE" PI_MCP_ASK_MAX_PER_TURN=2 PI_STUB_ASKS=3 PI_STUB_ASK_WAIT_MS=20000 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"b","prompt":"go","run_in_background":false}')" "WAIT_FOR \"id\":2 10" "SLEEP 0.5" \
    "$(call 3 pi_answer "$(json_obj to b question_id "$Q1" answer one)")" "WAIT_FOR \"id\":3 10" \
    "$(call 4 pi_answer "$(json_obj to b question_id "$Q2" answer two)")" "WAIT_FOR \"id\":4 10" \
    "$(call 5 pi_send_message '{"to":"b","message":"again"}')" "WAIT_FOR \"id\":5 10" "SLEEP 0.3" \
    "$(call 6 pi_stop '{"name":"b"}')" "WAIT_FOR \"id\":6 15"
  case "$(res_head "$OUT" 2)" in *"QUESTION $Q1 (blocked, 1/2 this turn)"*"QUESTION $Q2 (blocked, 2/2 this turn)"*) pass "E: two questions shown with the per-turn count" ;; *) fail "E: id2 ($(res_head "$OUT" 2))" ;; esac
  case "$(res_head "$OUT" 2)" in *"$Q3"*) fail "E: the over-budget question woke the parent" ;; *) pass "E: the 3rd (over budget) never wakes the parent" ;; esac
  J="$(res_json "$OUT" 4)"
  case "$(field_of "$J" text)" in *"got:Question budget exhausted (2 per turn). No answer arrived within the budget. Proceed with your best judgment and state the assumption in your handoff.@model (budget)"*) pass "E: the server answered the 3rd with the budget text" ;; *) fail "E: done text ($(field_of "$J" text))" ;; esac
  case "$(field_of "$J" text)" in *"[question $Q3 expired: budget]"*) pass "E: question_expired{budget} rides on DONE" ;; *) fail "E: rider ($(field_of "$J" text))" ;; esac
  [ "$(events_eval "$CD" 'evs.filter((e) => e.type === "question_expired" && e.turn === 1).map((e) => e.data.question_id + ":" + e.data.reason).join()')" = "$Q3:budget" ] \
    && pass "E: question_expired{budget} logged" || fail "E: expired events"
  case "$(res_head "$OUT" 5)" in *"QUESTION $(qid call_2_1) (blocked, 1/2 this turn)"*) pass "E: next turn counts from 1 again" ;; *) fail "E: turn 2 ($(res_head "$OUT" 5))" ;; esac
  [ "$(res_head "$OUT" 6)" = 'stopped pi:b (was waiting). Session kept; pi_send_message {to:"b"} resumes it.' ] && pass "E: pi_stop on a waiting child" || fail "E: stop ($(res_head "$OUT" 6))"
  [ "$(field_of "$(res_json "$OUT" 6)" 'preAnswered.length')" -ge 1 ] && pass "E: stop pre-answered the open questions" || fail "E: preAnswered ($(res_json "$OUT" 6))"
  [ "$(meta_eval "$CD" m.state)" = stopped ] && pass "E: meta state stopped" || fail "E: state $(meta_eval "$CD" m.state)"
} || true

# ---------------------------------------------------------------------------
# F. server-owned expiry, starting at consumption
# ---------------------------------------------------------------------------
{
  PF="$(make_scratch)"; OUT="$(make_scratch)/f.jsonl"; CD="$(child_dir "$PF" x)"; ARGS="$(make_scratch)/args.json"; Q="$(qid call_1_1)"
  CLAUDE_PROJECT_DIR="$PF" PI_MCP_ASK_TIMEOUT_MS=1500 PI_STUB_ASKS=1 PI_STUB_ASK_DELAY_MS=1500 PI_STUB_ASK_WAIT_MS=30000 PI_STUB_ARGS_FILE="$ARGS" feed "$OUT" \
    "$(call_tok 2 pi_agent '{"name":"x","prompt":"go"}' t2)" "WAIT_FOR agent_start 10" \
    "$(cancel 2)" "WAIT_FOR \"event\":\"question\" 10" "SLEEP 2.5" \
    "SH grep -cE 'question_expired|answered' '$CD/events.jsonl' > '$PF/pre'" \
    "$(call 3 pi_wait '{"name":"x"}')" "WAIT_FOR \"id\":3 10" "SLEEP 2.5" \
    "$(call 4 pi_wait '{"name":"x"}')" "WAIT_FOR \"id\":4 10" \
    "$(call 5 pi_answer "$(json_obj to x question_id "$Q" answer late)")" "WAIT_FOR \"id\":5 5"
  assert_json "F: child launched with the 4h hard cap and an out-of-reach budget" "$ARGS" 'r.env.PI_DELEGATE_ASK_TIMEOUT_MS === "14400000" && r.env.PI_DELEGATE_ASK_MAX === "1000"'
  [ -z "$(inner_for_id "$OUT" 2 | tr -d '{}')" ] && pass "F: cancelled spawn sent no response" || fail "F: id2 responded"
  [ "$(cat "$PF/pre")" = 0 ] && pass "F: an unconsumed question does not expire (2.5s > 1.5s soft timer)" || fail "F: expired before consumption ($(cat "$PF/pre"))"
  case "$(inner_for_id "$OUT" 3)" in *"QUESTION $Q"*) pass "F: pi_wait delivered (consumed) the question" ;; *) fail "F: id3 ($(inner_for_id "$OUT" 3))" ;; esac
  J4="$(inner_for_id "$OUT" 4)"
  case "$J4" in *"got:No answer arrived within the budget. Proceed with your best judgment and state the assumption in your handoff.@model (timeout)"*) pass "F: after consumption + 1.5s the server answered with the fallback (model (timeout))" ;; *) fail "F: id4 ($J4)" ;; esac
  case "$J4" in *"[question $Q expired: timeout]"*) pass "F: question_expired{timeout} rides on DONE" ;; *) fail "F: rider" ;; esac
  case "$(field_of "$(res_json "$OUT" 5)" errorMessage)" in "question $Q already resolved (expired (timeout), "*) pass "F: late pi_answer refused (expired)" ;; *) fail "F: late ($(res_json "$OUT" 5))" ;; esac
} || true

# ---------------------------------------------------------------------------
# G. interrupt while blocked in ask; stop forget
# ---------------------------------------------------------------------------
{
  PG="$(make_scratch)"; OUT="$(make_scratch)/g.jsonl"; CD="$(child_dir "$PG" i)"; LOG="$(make_scratch)/stub.log"; T="$(make_scratch)/t"
  CLAUDE_PROJECT_DIR="$PG" PI_STUB_ASKS=1 PI_STUB_ASK_WAIT_MS=30000 PI_STUB_LOG_FILE="$LOG" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"i","prompt":"go","run_in_background":false}')" "WAIT_FOR \"id\":2 10" "SLEEP 0.3" \
    "SH now_ms > '$T.0'" \
    "$(call 3 pi_send_message '{"to":"i","message":"INT-TOKEN","interrupt":true}')" "WAIT_FOR \"id\":3 20" \
    "SH now_ms > '$T.1'" \
    "$(call 4 pi_stop '{"name":"i","forget":true}')" "WAIT_FOR \"id\":4 15" \
    "$(call 5 pi_send_message '{"to":"i","message":"x"}')" "WAIT_FOR \"id\":5 5"
  EL=$(( $(cat "$T.1") - $(cat "$T.0") ))
  [ "$EL" -lt 15000 ] && pass "G: interrupt during an ask returned in ${EL}ms (< 15s)" || fail "G: interrupt took ${EL}ms"
  J="$(res_json "$OUT" 3)"
  [ "$(field_of "$J" delivered)" = interrupt ] && [ "$(field_of "$J" turn)" = 2 ] && [ "$(field_of "$J" respawned)" = false ] \
    && pass "G: delivered interrupt, turn 2, same process" || fail "G: id3 ($J)"
  grep -qx "prompt:INT-TOKEN" "$LOG" && pass "G: the new prompt reached the child" || fail "G: log ($(cat "$LOG"))"
  case "$(res_head "$OUT" 4)" in "stopped pi:i (was waiting) and forgot it"*) pass "G: pi_stop forget" ;; *) fail "G: stop ($(res_head "$OUT" 4))" ;; esac
  [ ! -e "$CD" ] && pass "G: forget removed the child's record" || fail "G: record left"
  [ "$(field_of "$(res_json "$OUT" 5)" errorMessage)" = 'No pi agent named "i". Known: none.' ] && pass "G: the name is free (unknown afterwards)" || fail "G: id5 ($(res_json "$OUT" 5))"
} || true
{
  # the same, record kept: the pre-answer and the interrupted turn are logged
  PG2="$(make_scratch)"; OUT="$(make_scratch)/g2.jsonl"; CD="$(child_dir "$PG2" i)"
  CLAUDE_PROJECT_DIR="$PG2" PI_STUB_ASKS=1 PI_STUB_ASK_WAIT_MS=30000 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"i","prompt":"go","run_in_background":false}')" "WAIT_FOR \"id\":2 10" "SLEEP 0.3" \
    "$(call 3 pi_send_message '{"to":"i","message":"INT-TOKEN","interrupt":true}')" "WAIT_FOR \"id\":3 20"
  case "$(events_eval "$CD" 'evs.map((e) => e.type).join(",")')," in spawned,question,answered,interrupted,question,*) true ;; *) false ;; esac \
    && pass "G: events spawned,question,answered,interrupted,question (no done for the aborted turn)" || fail "G: events $(events_eval "$CD" 'evs.map((e) => e.type).join(",")')"
  [ "$(events_eval "$CD" 'evs.find((e) => e.type === "answered").data.answeredBy')" = model ] && pass "G: pre-answer by model" || fail "G: answeredBy"
  case "$(res_head "$OUT" 3)" in *"QUESTION $(qid call_2_1)"*) pass "G: the new turn's question came back on the interrupting call" ;; *) fail "G: id3 head ($(res_head "$OUT" 3))" ;; esac
} || true

# ---------------------------------------------------------------------------
# H. steer then interrupt: dropped_queue
# ---------------------------------------------------------------------------
{
  PH="$(make_scratch)"; OUT="$(make_scratch)/h.jsonl"; LOG="$(make_scratch)/stub.log"
  CLAUDE_PROJECT_DIR="$PH" PI_STUB_SETTLE_MS=3000 PI_STUB_LOG_FILE="$LOG" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"h","prompt":"one","run_in_background":false}')" "SLEEP 0.7" \
    "$(call 3 pi_send_message '{"to":"h","message":"STEER-2201"}')" "WAIT_FOR \"id\":3 5" \
    "$(call 4 pi_send_message '{"to":"h","message":"INT-2","interrupt":true}')" "WAIT_FOR \"id\":4 20" "WAIT_FOR \"id\":2 5"
  J="$(res_json "$OUT" 4)"
  [ "$(field_of "$J" 'dropped_queue.map((d) => d.kind + ":" + d.text).join()')" = "steer:STEER-2201" ] && pass "H: clear_queue dropped the steer (dropped_queue)" || fail "H: dropped ($J)"
  grep -q "steer:STEER-2201" "$LOG" && fail "H: the dropped steer reached the child" || pass "H: the dropped steer never reached the child"
  [ "$(field_of "$J" status)" = done ] && [ "$(field_of "$J" turn)" = 2 ] && grep -qx "prompt:INT-2" "$LOG" && pass "H: interrupt ran turn 2 to DONE" || fail "H: id4 ($J)"
  [ "$(field_of "$(res_json "$OUT" 2)" status)" = interrupted ] && pass "H: the old turn's call returned interrupted (no DONE)" || fail "H: id2 ($(inner_for_id "$OUT" 2))"
} || true

# ---------------------------------------------------------------------------
# I. abort ignored -> kill after 10s, respawn the same generation
# ---------------------------------------------------------------------------
{
  PI_="$(make_scratch)"; OUT="$(make_scratch)/i.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"; ARGS="$(make_scratch)/args.json"
  CLAUDE_PROJECT_DIR="$PI_" PI_DELEGATE_WAKE=channel PI_STUB_IGNORE_ABORT=1 PI_STUB_SETTLE_MS=60000 PI_STUB_PID_FILE="$PIDS" PI_STUB_ARGS_FILE="$ARGS" FEED_TIMEOUT=90 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"k","prompt":"one"}')" "WAIT_FOR \"id\":2 10" "SLEEP 0.3" \
    "$(call 3 pi_send_message '{"to":"k","message":"K-INT","interrupt":true}')" "WAIT_FOR \"id\":3 30" \
    "$(call 4 pi_stop '{"name":"k"}')" "WAIT_FOR \"id\":4 20"
  J="$(res_json "$OUT" 3)"
  [ "$(field_of "$J" respawned)" = true ] && [ "$(field_of "$J" delivered)" = interrupt ] && pass "I: abort ignored -> killed and respawned" || fail "I: id3 ($J)"
  [ "$(wc -l < "$PIDS" | tr -d ' ')" = 2 ] && ! kill -0 "$(head -1 "$PIDS")" 2>/dev/null && pass "I: the first process is gone, a second runs the new turn" || fail "I: pids $(cat "$PIDS")"
  assert_json "I: respawned on the same session (--session-id k-g1)" "$ARGS" 'r.argv.join(" ").includes("--session-id k-g1")'
  case "$(res_head "$OUT" 4)" in "stopped pi:k (was running)."*) pass "I: stop of a child that ignores abort" ;; *) fail "I: stop ($(res_head "$OUT" 4))" ;; esac
  sleep 0.5; ! kill -0 "$(tail -1 "$PIDS")" 2>/dev/null && pass "I: stopped child's process gone" || fail "I: child alive"
} || true

# ---------------------------------------------------------------------------
# J. stop keeps the session, send resumes it; unknown names
# ---------------------------------------------------------------------------
{
  PJ="$(make_scratch)"; OUT="$(make_scratch)/j.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"; ARGS="$(make_scratch)/args.json"
  CD="$(child_dir "$PJ" r)"; LOCK="$(lock_of "$PJ" r)"; ST="$(make_scratch)/st"
  CLAUDE_PROJECT_DIR="$PJ" PI_DELEGATE_WAKE=channel PI_STUB_SETTLE_MS=20000 PI_STUB_PID_FILE="$PIDS" PI_STUB_ARGS_FILE="$ARGS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"r","prompt":"one"}')" "WAIT_FOR \"id\":2 10" "SLEEP 0.3" \
    "$(call 3 pi_stop '{"task_id":"pi:R"}')" "WAIT_FOR \"id\":3 15" \
    "SH P=\$(head -1 '$PIDS'); (kill -0 \$P 2>/dev/null && echo alive || echo dead; [ -e '$LOCK' ] && echo locked || echo unlocked) > '$ST'" \
    "$(call 4 pi_send_message '{"to":"pi:nope","message":"x"}')" "WAIT_FOR \"id\":4 5" \
    "$(call 5 pi_stop '{"name":"nope"}')" "WAIT_FOR \"id\":5 5" \
    "$(call 6 pi_send_message '{"to":"r","message":"back"}')" "WAIT_FOR \"id\":6 10" "SLEEP 0.3" \
    "SH tail -1 '$PIDS' > '$ST.pid2'; node -e 'process.stdout.write(String(JSON.parse(require(\"fs\").readFileSync(\"$CD/meta.json\",\"utf8\")).pid))' > '$ST.metapid'"
  [ "$(res_head "$OUT" 3)" = 'stopped pi:r (was running). Session kept; pi_send_message {to:"r"} resumes it.' ] && pass "J: pi_stop {task_id:\"pi:R\"} -> Session kept" || fail "J: stop ($(res_head "$OUT" 3))"
  [ "$(tr '\n' ' ' < "$ST")" = "dead unlocked " ] && pass "J: process group gone, lifetime lock released" || fail "J: after stop: $(cat "$ST")"
  case "$(events_eval "$CD" 'evs.map((e) => e.type).join(",")')," in spawned,stopped,spawned,*) true ;; *) false ;; esac && pass "J: events spawned,stopped,spawned (no done for the stopped turn)" || fail "J: events $(events_eval "$CD" 'evs.map((e) => e.type).join(",")')"
  [ "$(field_of "$(res_json "$OUT" 4)" errorMessage)" = 'No pi agent named "nope". Known: r (stopped).' ] && pass "J: unknown name lists the known ones" || fail "J: id4 ($(res_json "$OUT" 4))"
  case "$(field_of "$(res_json "$OUT" 5)" errorMessage)" in 'No pi agent named "nope".'*) pass "J: pi_stop of an unknown name" ;; *) fail "J: id5" ;; esac
  J6="$(res_json "$OUT" 6)"
  [ "$(field_of "$J6" delivered)" = resumed ] && [ "$(field_of "$J6" respawned)" = true ] && [ "$(field_of "$J6" turn)" = 2 ] && pass "J: send to a stopped child -> delivered resumed, turn 2" || fail "J: id6 ($J6)"
  [ "$(wc -l < "$PIDS" | tr -d ' ')" = 2 ] && [ "$(cat "$ST.pid2")" = "$(cat "$ST.metapid")" ] && pass "J: a new pid, recorded in meta" || fail "J: pids $(cat "$PIDS") meta $(cat "$ST.metapid")"
  assert_json "J: resumed with the same --session-id r-g1" "$ARGS" 'r.argv.join(" ").includes("--session-id r-g1")'
} || true

# ---------------------------------------------------------------------------
# K. parked by TTL, resumed
# ---------------------------------------------------------------------------
{
  PK="$(make_scratch)"; OUT="$(make_scratch)/k.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"; CD="$(child_dir "$PK" p)"
  CLAUDE_PROJECT_DIR="$PK" PI_MCP_TTL_MS=400 PI_MCP_REAP_INTERVAL_MS=200 PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"p","prompt":"one","run_in_background":false}')" "WAIT_FOR \"id\":2 10" "SLEEP 1.5" \
    "$(call 3 pi_send_message '{"to":"p","message":"two"}')" "WAIT_FOR \"id\":3 10"
  J="$(res_json "$OUT" 3)"
  [ "$(field_of "$J" delivered)" = resumed ] && [ "$(field_of "$J" status)" = done ] && pass "K: parked child resumed and ran to DONE" || fail "K: ($J)"
  case "$(events_eval "$CD" 'evs.map((e) => e.type).join(",")')" in spawned,done,parked,spawned,done*) pass "K: events spawned,done,parked,spawned,done" ;; *) fail "K: events $(events_eval "$CD" 'evs.map((e) => e.type).join(",")')" ;; esac
} || true

# ---------------------------------------------------------------------------
# L. confirmed channel: answer and send return at once
# ---------------------------------------------------------------------------
{
  PL="$(make_scratch)"; OUT="$(make_scratch)/l.jsonl"
  CLAUDE_PROJECT_DIR="$PL" PI_DELEGATE_WAKE=channel PI_STUB_ASKS=1 PI_STUB_ASK_WAIT_MS=20000 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"c","prompt":"one"}')" "WAIT_FOR \"event\":\"question\" 10" \
    "$(call 3 pi_answer '{"to":"c","answer":"ok"}')" "WAIT_FOR \"id\":3 10" "WAIT_FOR \"event\":\"done\" 10"
  [ "$(res_head "$OUT" 3)" = "answered $(qid call_1_1) for pi:c; picked up; it continues in the same session." ] && pass "L: channel: pi_answer returns after pickup" || fail "L: id3 ($(res_head "$OUT" 3))"
  [ "$(line_of_id "$OUT" 3)" -lt "$(grep -n '"event":"done"' "$OUT" | head -1 | cut -d: -f1)" ] && pass "L: ... before the DONE push" || fail "L: order"
  OUT="$(make_scratch)/l2.jsonl"
  CLAUDE_PROJECT_DIR="$PL" PI_DELEGATE_WAKE=channel PI_STUB_SETTLE_MS=1500 feed "$OUT" \
    "$(call 2 pi_send_message '{"to":"c","message":"two"}')" "WAIT_FOR \"id\":2 10" "WAIT_FOR \"event\":\"done\" 10"
  case "$(res_head "$OUT" 2)" in "delivered resumed to pi:c (turn 2); you will be notified when it finishes or asks something. Do not poll.") pass "L: channel: resumed send returns at once" ;; *) fail "L: send ($(res_head "$OUT" 2))" ;; esac
} || true

# ---------------------------------------------------------------------------
# M. another live session's child
# ---------------------------------------------------------------------------
{
  PM="$(make_scratch)"; OUT="$(make_scratch)/m.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"
  sleep 60 & OWNER=$!; sleep 60 & KID=$!
  CD="$(child_dir "$PM" own)"; mkdir -p "$CD"
  printf '{"name":"own","gen":1,"state":"running","pid":%s,"ownerServerPid":%s,"ownerServerStart":"%s","launch":{"sessionId":"own-g1"}}' \
    "$KID" "$OWNER" "$(LC_ALL=C ps -o lstart= -p "$OWNER" | sed 's/^ *//;s/ *$//')" > "$CD/meta.json"
  CLAUDE_PROJECT_DIR="$PM" PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    "$(call 2 pi_send_message '{"to":"own","message":"x"}')" "$(call 3 pi_answer '{"to":"own","answer":"x"}')" "$(call 4 pi_stop '{"name":"own","forget":true}')" \
    "WAIT_FOR \"id\":4 10"
  ok=1; for id in 2 3 4; do case "$(field_of "$(res_json "$OUT" "$id")" errorMessage)" in "pi:own is owned by another Claude session (server pid $OWNER, since "*) ;; *) ok=0; echo "    id $id: $(res_json "$OUT" "$id")" >&2 ;; esac; done
  [ "$ok" = 1 ] && pass "M: send/answer/stop refuse another session's child" || fail "M: owner errors"
  [ ! -s "$PIDS" ] && [ -f "$CD/meta.json" ] && kill -0 "$KID" 2>/dev/null && pass "M: no pi started, its record and process untouched" || fail "M: side effects"
  kill "$OWNER" "$KID" 2>/dev/null; wait "$OWNER" "$KID" 2>/dev/null
} || true

# ---------------------------------------------------------------------------
# N. forget deletes only this child's own sessions: exact ids, never by suffix
# (a sibling "y_x" or a child named "x-g1" keeps its files)
# ---------------------------------------------------------------------------
{
  PN="$(make_scratch)"; AG="$(make_scratch)/agent"; OUT="$(make_scratch)/n.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"
  SD="$AG/sessions/$(pi_session_slug "$PN")"; mkdir -p "$SD"
  plant() { # plant <name> <sessionId>
    local d; d="$(child_dir "$PN" "$1")"; mkdir -p "$d"
    printf '{"name":"%s","gen":1,"state":"stopped","pid":null,"sessionId":"%s","launch":{"sessionId":"%s"},"gens":[]}' "$1" "$2" "$2" > "$d/meta.json"
  }
  plant x x-g1; plant y_x y_x-g1; plant x-g1 x-g1-g1
  for f in 2026-10-01T00-00-00-000Z_x-g1 2026-10-01T00-00-01-000Z_y_x-g1 2026-10-01T00-00-02-000Z_x-g1-g1 2026-10-01T00-00-03-000Z_x; do : > "$SD/$f.jsonl"; done
  CLAUDE_PROJECT_DIR="$PN" PI_CODING_AGENT_DIR="$AG" PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    "$(call 2 pi_stop '{"name":"x","forget":true}')" "WAIT_FOR \"id\":2 10" \
    "SH ls '$SD' | tr '\n' ' ' > '$OUT.after1'" \
    "$(call 3 pi_stop '{"name":"x-g1","forget":true}')" "WAIT_FOR \"id\":3 10" \
    "SH ls '$SD' | tr '\n' ' ' > '$OUT.after2'"
  case "$(res_head "$OUT" 2)" in *,*) fail "N: id2 removed more than one file ($(res_head "$OUT" 2))" ;; "stopped pi:x (was stopped) and forgot it: removed session file(s): /"*"/sessions/$(pi_session_slug "$PN")/2026-10-01T00-00-00-000Z_x-g1.jsonl. The name is free.") pass "N: forget x removed only x-g1's file" ;; *) fail "N: id2 ($(res_head "$OUT" 2))" ;; esac
  [ "$(cat "$OUT.after1")" = "2026-10-01T00-00-01-000Z_y_x-g1.jsonl 2026-10-01T00-00-02-000Z_x-g1-g1.jsonl 2026-10-01T00-00-03-000Z_x.jsonl " ] \
    && pass "N: sibling y_x's session and child x-g1's session survive forgetting x" || fail "N: after forget x: $(cat "$OUT.after1")"
  [ "$(cat "$OUT.after2")" = "2026-10-01T00-00-01-000Z_y_x-g1.jsonl 2026-10-01T00-00-03-000Z_x.jsonl " ] \
    && pass "N: forgetting x-g1 removed only x-g1-g1 (never x's gen-1 file)" || fail "N: after forget x-g1: $(cat "$OUT.after2")"
  [ -f "$(child_dir "$PN" y_x)/meta.json" ] && [ ! -e "$(child_dir "$PN" x)" ] && pass "N: y_x's record kept, x's removed" || fail "N: records"
  [ ! -s "$PIDS" ] && pass "N: no pi started" || fail "N: pi started"
} || true

# ---------------------------------------------------------------------------
# O. an orphan pi (its server SIGKILLed mid-turn, still running like real pi
# after stdin EOF): the next server's restart recovery (0.11 §4.4) kills it
# before any tool runs and records failed{orphaned}; pi_stop and a resume then
# find no second process; a waiting orphan is pre-answered first
# ---------------------------------------------------------------------------
orphan_run() { # orphan_run <project> <out> <pids> <log> [extra env...] : spawn o, SIGKILL the server mid-turn
  local proj="$1" out="$2" pids="$3" log="$4"; shift 4
  ( [ $# -gt 0 ] && export "$@"
    CLAUDE_PROJECT_DIR="$proj" PI_DELEGATE_WAKE=channel PI_STUB_EOF_FINISH=1 PI_STUB_SETTLE_MS=30000 PI_STUB_PID_FILE="$pids" PI_STUB_LOG_FILE="$log" feed "$out" \
      "$(call 2 pi_agent '{"name":"o","prompt":"long work"}')" "WAIT_FOR \"id\":2 10" "SLEEP 0.5" \
      "SH kill -9 \$(ps -o ppid= -p \$(head -1 '$pids'))" )
}
{
  PO="$(make_scratch)"; OUT="$(make_scratch)/o1.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"; LOG="$(make_scratch)/stub.log"; CD="$(child_dir "$PO" o)"; ST="$(make_scratch)/st"
  orphan_run "$PO" "$OUT" "$PIDS" "$LOG"
  ORPH="$(head -1 "$PIDS")"
  kill -0 "$ORPH" 2>/dev/null && [ "$(meta_eval "$CD" 'm.state + " " + m.pid')" = "running $ORPH" ] && pass "O: orphan $ORPH alive after its server's SIGKILL, meta running" || fail "O: setup ($(meta_eval "$CD" 'm.state + " " + m.pid'))"
  OUT="$(make_scratch)/o2.jsonl"
  CLAUDE_PROJECT_DIR="$PO" PI_DELEGATE_WAKE=channel PI_STUB_EOF_FINISH=1 PI_STUB_SETTLE_MS=500 PI_STUB_PID_FILE="$PIDS" PI_STUB_LOG_FILE="$LOG" feed "$OUT" \
    "$(call 2 pi_stop '{"name":"o"}')" "WAIT_FOR \"id\":2 15" \
    "SH (kill -0 $ORPH 2>/dev/null && echo alive || echo dead) > '$ST'; [ -e '$(lock_of "$PO" o)' ] && echo locked > '$ST.lock' || echo unlocked > '$ST.lock'" \
    "$(call 3 pi_send_message '{"to":"o","message":"resumed turn"}')" "WAIT_FOR \"id\":3 10" "WAIT_FOR \"event\":\"done\" 10" \
    "$(call 4 pi_stop '{"name":"o"}')" "WAIT_FOR \"id\":4 10"
  [ "$(cat "$ST")" = dead ] && pass "O: the orphan is dead by the time pi_stop returns" || fail "O: orphan $(cat "$ST") after stop ($(res_head "$OUT" 2))"
  [ "$(cat "$ST.lock")" = unlocked ] && pass "O: the dead server's lifetime lock is released (restart recovery / pi_stop)" || fail "O: lock $(cat "$ST.lock") after stop"
  [ "$(events_eval "$CD" 'evs.filter((e) => e.type === "failed" && e.data.reason === "orphaned")[0].data.orphanKilled')" = "$ORPH" ] \
    && [ "$(events_eval "$CD" 'evs.map((e) => e.type).join(",")')" = "spawned,orphan_killed,failed,stopped,spawned,done,stopped" ] \
    && pass "O: restart recovery killed the orphan (failed{orphaned}, orphanKilled) before pi_stop" || fail "O: events $(events_eval "$CD" 'JSON.stringify(evs.map((e) => [e.type, e.data && e.data.reason]))')"
  [ "$(field_of "$(res_json "$OUT" 3)" delivered)" = resumed ] && [ "$(wc -l < "$PIDS" | tr -d ' ')" = 2 ] && pass "O: the resume ran on one new process" || fail "O: resume ($(res_json "$OUT" 3)) pids $(cat "$PIDS")"
  kill $(cat "$PIDS") 2>/dev/null
} || true
{
  PO="$(make_scratch)"; OUT="$(make_scratch)/o3.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"; LOG="$(make_scratch)/stub.log"; ST="$(make_scratch)/st"
  orphan_run "$PO" "$OUT" "$PIDS" "$LOG"
  ORPH="$(head -1 "$PIDS")"
  OUT="$(make_scratch)/o4.jsonl"
  CLAUDE_PROJECT_DIR="$PO" PI_DELEGATE_WAKE=channel PI_STUB_EOF_FINISH=1 PI_STUB_SETTLE_MS=500 PI_STUB_PID_FILE="$PIDS" PI_STUB_LOG_FILE="$LOG" feed "$OUT" \
    "$(call 2 pi_send_message '{"to":"o","message":"resumed turn"}')" "WAIT_FOR \"id\":2 15" \
    "SH (kill -0 $ORPH 2>/dev/null && echo alive || echo dead; for p in \$(cat '$PIDS'); do kill -0 \$p 2>/dev/null && echo \$p; done | wc -l | tr -d ' ') > '$ST'" \
    "WAIT_FOR \"event\":\"done\" 10" "$(call 3 pi_stop '{"name":"o"}')" "WAIT_FOR \"id\":3 10"
  [ "$(field_of "$(res_json "$OUT" 2)" delivered)" = resumed ] && [ "$(tr '\n' ' ' < "$ST")" = "dead 1 " ] \
    && pass "O: a resume killed the orphan first: one live process on --session-id o-g1" || fail "O: resume over orphan ($(res_json "$OUT" 2)) state $(tr '\n' ' ' < "$ST")"
  kill $(cat "$PIDS") 2>/dev/null
} || true
{
  PO="$(make_scratch)"; OUT="$(make_scratch)/o5.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"; LOG="$(make_scratch)/stub.log"; CD="$(child_dir "$PO" o)"; ST="$(make_scratch)/st"
  orphan_run "$PO" "$OUT" "$PIDS" "$LOG" PI_STUB_ASKS=1 PI_STUB_ASK_WAIT_MS=60000
  ORPH="$(head -1 "$PIDS")"
  [ "$(meta_eval "$CD" 'm.state')" = waiting ] && pass "O: orphan blocked in ask_parent (meta waiting)" || fail "O: waiting setup ($(meta_eval "$CD" 'm.state'))"
  OUT="$(make_scratch)/o6.jsonl"
  CLAUDE_PROJECT_DIR="$PO" PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    "$(call 2 pi_stop '{"name":"o"}')" "WAIT_FOR \"id\":2 15" "SH (kill -0 $ORPH 2>/dev/null && echo alive || echo dead) > '$ST'"
  [ "$(events_eval "$CD" 'const a = evs.find((e) => e.type === "answered"); a ? a.data.answeredBy + "|" + a.data.toolCallId : "none"')" = "model|call_1_1" ] \
    && pass "O: the orphan's open question was pre-answered from events.jsonl" || fail "O: pre-answer $(events_eval "$CD" 'evs.map((e) => e.type).join()')"
  [ "$(cat "$ST")" = dead ] && [ "$(meta_eval "$CD" 'm.state')" = stopped ] && pass "O: then killed, record stopped" || fail "O: $(cat "$ST") $(meta_eval "$CD" 'm.state')"
  kill $(cat "$PIDS") 2>/dev/null
} || true

# ---------------------------------------------------------------------------
# P. a resume runs the get_state model handshake: a child that comes back on
# another model is killed, nothing is sent, failed{resume_model_mismatch}
# ---------------------------------------------------------------------------
{
  PP="$(make_scratch)"; OUT="$(make_scratch)/p.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"; LOG="$(make_scratch)/stub.log"; MF="$(make_scratch)/model"
  CD="$(child_dir "$PP" m)"; LOCK="$(lock_of "$PP" m)"; ST="$(make_scratch)/st"
  CLAUDE_PROJECT_DIR="$PP" PI_STUB_MODEL_FILE="$MF" PI_STUB_PID_FILE="$PIDS" PI_STUB_LOG_FILE="$LOG" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"m","prompt":"one","run_in_background":false}')" "WAIT_FOR \"id\":2 10" \
    "$(call 3 pi_stop '{"name":"m"}')" "WAIT_FOR \"id\":3 10" \
    "SH echo rogue/other-model > '$MF'" \
    "$(call 4 pi_send_message '{"to":"m","message":"two"}')" "WAIT_FOR \"id\":4 20" "SLEEP 0.5" \
    "SH (kill -0 \$(tail -1 '$PIDS') 2>/dev/null && echo alive || echo dead; [ -e '$LOCK' ] && echo locked || echo unlocked) > '$ST'"
  E="$(field_of "$(res_json "$OUT" 4)" errorMessage)"
  case "$E" in "pi:m could not be resumed: pi:m did not come back on its recorded model: pi is running rogue/other-model, not provider stub. Nothing was sent to it.") pass "P: resume on another model refused" ;; *) fail "P: id4 ($E)" ;; esac
  [ "$(meta_eval "$CD" 'm.state + " " + m.reason')" = "failed resume_model_mismatch" ] && pass "P: record failed{resume_model_mismatch}" || fail "P: meta $(meta_eval "$CD" 'm.state + " " + m.reason')"
  [ "$(wc -l < "$PIDS" | tr -d ' ')" = 2 ] && [ "$(tr '\n' ' ' < "$ST")" = "dead unlocked " ] && pass "P: the mismatched process killed, lock released" || fail "P: $(tr '\n' ' ' < "$ST") pids $(cat "$PIDS")"
  [ "$(grep -c '^prompt:' "$LOG")" = 1 ] && pass "P: no prompt sent to the mismatched child" || fail "P: log $(cat "$LOG")"
} || true

# ---------------------------------------------------------------------------
# Q. a resume respects the live cap: all busy -> the cap error, nothing
# spawned; an idle other child is parked to make room
# ---------------------------------------------------------------------------
{
  PQ="$(make_scratch)"; OUT="$(make_scratch)/q.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"; CB="$(child_dir "$PQ" b)"
  CLAUDE_PROJECT_DIR="$PQ" PI_MCP_REGISTRY_CAP=1 PI_DELEGATE_WAKE=channel PI_STUB_SETTLE_MS=8000 PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"b","prompt":"one"}')" "WAIT_FOR \"id\":2 10" \
    "$(call 3 pi_stop '{"name":"b"}')" "WAIT_FOR \"id\":3 10" \
    "$(call 4 pi_agent '{"name":"a","prompt":"long"}')" "WAIT_FOR \"id\":4 10" \
    "$(call 5 pi_send_message '{"to":"b","message":"two"}')" "WAIT_FOR \"id\":5 10" \
    "$(call 6 pi_stop '{"name":"a"}')" "WAIT_FOR \"id\":6 10"
  E="$(field_of "$(res_json "$OUT" 5)" errorMessage)"
  [ "$E" = "pi:b could not be resumed: 1 pi children are live (cap 1) and all are busy: a (running). Wait for one to finish or stop one." ] && pass "Q: resume at the cap, all busy -> the cap error" || fail "Q: id5 ($E)"
  [ "$(event_types "$CB")" = "spawned,stopped" ] && [ "$(meta_eval "$CB" 'm.state')" = stopped ] && [ "$(wc -l < "$PIDS" | tr -d ' ')" = 2 ] \
    && pass "Q: b not spawned or parked (events spawned,stopped)" || fail "Q: b events $(event_types "$CB") state $(meta_eval "$CB" 'm.state') pids $(wc -l < "$PIDS")"
  OUT="$(make_scratch)/q2.jsonl"; PQ2="$(make_scratch)"; CA="$(child_dir "$PQ2" a)"
  CLAUDE_PROJECT_DIR="$PQ2" PI_MCP_REGISTRY_CAP=1 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"b","prompt":"one","run_in_background":false}')" "WAIT_FOR \"id\":2 10" \
    "$(call 3 pi_stop '{"name":"b"}')" "WAIT_FOR \"id\":3 10" \
    "$(call 4 pi_agent '{"name":"a","prompt":"one","run_in_background":false}')" "WAIT_FOR \"id\":4 10" \
    "$(call 5 pi_send_message '{"to":"b","message":"two"}')" "WAIT_FOR \"id\":5 10"
  J="$(res_json "$OUT" 5)"
  [ "$(field_of "$J" delivered)" = resumed ] && [ "$(field_of "$J" status)" = done ] && [ "$(event_types "$CA")" = "spawned,done,parked" ] \
    && pass "Q: resume at the cap parks the idle other child and runs" || fail "Q: id5 ($J) a events $(event_types "$CA")"
} || true

# ---------------------------------------------------------------------------
# R. pi_list_agents / pi_read use the 0.11 resolver
# ---------------------------------------------------------------------------
{
  PR="$(make_scratch)"; OUT="$(make_scratch)/r.jsonl"
  CLAUDE_PROJECT_DIR="$PR" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"a","prompt":"one","run_in_background":false}')" "WAIT_FOR \"id\":2 10" \
    "$(call 3 pi_list_agents '{"name":"pi:A"}')" "WAIT_FOR \"id\":3 10" \
    "$(call 4 pi_read '{"task_id":"pi:a"}')" "WAIT_FOR \"id\":4 10" \
    "$(call 5 pi_list_agents '{"name":"bad name"}')" "WAIT_FOR \"id\":5 10" \
    "$(call 6 pi_stop '{"name":"a"}')" "WAIT_FOR \"id\":6 10"
  J="$(res_json "$OUT" 3)"
  [ "$(field_of "$J" name)" = a ] && [ "$(field_of "$J" 'channel.alive')" = true ] && pass "R: pi_list_agents {name:\"pi:A\"} resolves to the live child a" || fail "R: id3 ($J)"
  case "$(res_head "$OUT" 4)" in "pi:a gen 1 turn 1 result ("*"reply-1"*) pass "R: pi_read {task_id:\"pi:a\"} reads a's turn-1 result" ;; *) fail "R: id4 ($(inner_for_id "$OUT" 4))" ;; esac
  case "$(field_of "$(res_json "$OUT" 5)" errorMessage)" in 'invalid name "bad name"'*) pass "R: an invalid name gets the resolver's error" ;; *) fail "R: id5 ($(res_json "$OUT" 5))" ;; esac
} || true

# ---------------------------------------------------------------------------
# S. fallback: an answer that expired before pickup still holds the wake, so
# the turn's DONE comes back on pi_answer (nobody else holds it)
# ---------------------------------------------------------------------------
{
  PS_="$(make_scratch)"; OUT="$(make_scratch)/s.jsonl"; CD="$(child_dir "$PS_" ep)"; Q="$(qid call_1_1)"
  CLAUDE_PROJECT_DIR="$PS_" PI_STUB_ASKS=1 PI_STUB_ASK_END_EXPIRED=1 PI_STUB_SETTLE_MS=2000 PI_STUB_ASK_WAIT_MS=20000 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"ep","prompt":"go","run_in_background":false}')" "WAIT_FOR \"id\":2 10" "SLEEP 0.3" \
    "$(call 3 pi_answer '{"to":"ep","answer":"blue"}')" "WAIT_FOR \"id\":3 15"
  H="$(res_head "$OUT" 3)"
  case "$H" in "answered $Q for pi:ep; expired before pickup; the child proceeded on its own judgment. Send the correction with pi_send_message."*"DONE turn 1 ok"*) pass "S: expired before pickup, then held the wake until DONE" ;; *) fail "S: id3 head ($H)" ;; esac
  [ "$(field_of "$(res_json "$OUT" 3)" status)" = done ] && [ "$(field_of "$(res_json "$OUT" 3)" pickup)" = "expired before pickup" ] && pass "S: status done, pickup expired before pickup" || fail "S: id3 ($(res_json "$OUT" 3))"
  [ "$(meta_eval "$CD" 'm.consumed_seq === m.last_seq')" = true ] && pass "S: every event consumed (the DONE reached a tool response)" || fail "S: consumed $(meta_eval "$CD" 'm.consumed_seq + "/" + m.last_seq')"
} || true

# ---------------------------------------------------------------------------
# T. fallback: a DONE that was only pushed (its call was cancelled, no channel)
# is not consumed silently by the next send: it comes back inline
# ---------------------------------------------------------------------------
{
  PT="$(make_scratch)"; OUT="$(make_scratch)/t.jsonl"; CD="$(child_dir "$PT" lost)"
  CLAUDE_PROJECT_DIR="$PT" PI_STUB_SETTLE_MS=1500 feed "$OUT" \
    "$(call_tok 2 pi_agent '{"name":"lost","prompt":"p1"}' t2)" "WAIT_FOR agent_start 10" \
    "$(cancel 2)" "WAIT_FOR \"event\":\"done\" 10" "SLEEP 0.3" \
    "$(call 3 pi_send_message '{"to":"lost","message":"p2"}')" "WAIT_FOR \"id\":3 10" \
    "$(call 4 pi_wait '{"name":"lost"}')" "WAIT_FOR \"id\":4 10"
  [ -z "$(inner_for_id "$OUT" 2 | tr -d '{}')" ] && pass "T: cancelled pi_agent sent no response" || fail "T: id2 responded"
  H="$(res_head "$OUT" 3)"
  case "$H" in *"DONE turn 2 ok"*"reply-2"*"earlier events of pi:lost not shown before:"*"DONE turn 1 ok"*"(also pushed "*"reply-1"*) pass "T: the send carried turn 1's pushed-only DONE inline" ;; *) fail "T: id3 head ($H)" ;; esac
  [ "$(field_of "$(res_json "$OUT" 3)" 'earlierEvents.map((e) => e.type + e.turn).join()')" = done1 ] && pass "T: earlierEvents = [done turn 1]" || fail "T: earlierEvents ($(res_json "$OUT" 3))"
  [ "$(field_of "$(res_json "$OUT" 4)" 'events.length')" = 0 ] && [ "$(meta_eval "$CD" 'm.consumed_seq === m.last_seq')" = true ] && pass "T: nothing left owed afterwards, all consumed" || fail "T: id4 ($(res_json "$OUT" 4))"
} || true

# ---------------------------------------------------------------------------
# U. a message sent after the turn's agent_settled but before its end is
# recorded (slow get_last_assistant_text) is not stranded as a steer in an idle
# pi: the turn ends as it was, and the message runs as the next turn
# ---------------------------------------------------------------------------
{
  PU="$(make_scratch)"; OUT="$(make_scratch)/u.jsonl"; LOG="$(make_scratch)/stub.log"
  CLAUDE_PROJECT_DIR="$PU" PI_STUB_SETTLE_MS=300 PI_STUB_TEXT_DELAY_MS=3000 PI_STUB_LOG_FILE="$LOG" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"st","prompt":"p1","run_in_background":false}')" "SLEEP 1.5" \
    "$(call 3 pi_send_message '{"to":"st","message":"S1-steer"}')" "WAIT_FOR \"id\":3 15" "WAIT_FOR \"id\":2 10"
  case "$(res_head "$OUT" 2)" in *"DONE turn 1 ok"*) case "$(res_head "$OUT" 2)" in *S1-steer*) fail "U: turn 1 claims the late message" ;; *) pass "U: turn 1's DONE is its own" ;; esac ;; *) fail "U: id2 ($(res_head "$OUT" 2))" ;; esac
  J="$(res_json "$OUT" 3)"
  [ "$(field_of "$J" delivered)" = new_turn ] && [ "$(field_of "$J" turn)" = 2 ] && [ "$(field_of "$J" status)" = done ] && pass "U: the late message ran as turn 2 (delivered new_turn, DONE)" || fail "U: id3 ($J)"
  case "$(res_head "$OUT" 3)" in *"its previous turn had just ended, so this started a new turn"*) pass "U: the result says the steer became a new turn" ;; *) fail "U: id3 head ($(res_head "$OUT" 3))" ;; esac
  [ "$(tr '\n' ' ' < "$LOG")" = "prompt:p1 prompt:S1-steer " ] && pass "U: stub got prompt p1 then prompt S1-steer (no stranded steer)" || fail "U: stub log ($(tr '\n' ' ' < "$LOG"))"
} || true

# ---------------------------------------------------------------------------
# V. a resume after the project's pin changed runs the recorded model (spec
# §6.2) and says "pin drift" in the headline and the JSON
# ---------------------------------------------------------------------------
{
  PV="$(make_scratch)"; OUT="$(make_scratch)/v.jsonl"; ARGS="$(make_scratch)/args.json"; mkdir -p "$PV/.claude"
  CLAUDE_PROJECT_DIR="$PV" PI_STUB_ARGS_FILE="$ARGS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"drift","prompt":"one","model":"stub/old-model","run_in_background":false}')" "WAIT_FOR \"id\":2 10" \
    "$(call 3 pi_stop '{"name":"drift"}')" "WAIT_FOR \"id\":3 10" \
    "SH printf -- '---\nprovider: stub\nmodel: pinned-model\n---\n' > '$PV/.claude/pi-delegate.local.md'" \
    "$(call 4 pi_send_message '{"to":"drift","message":"two"}')" "WAIT_FOR \"id\":4 10"
  case "$(res_head "$OUT" 4)" in "delivered resumed to pi:drift (turn 2); pin drift: launched stub/old-model, pin stub/pinned-model (it resumed on its recorded model; pi_agent {name:\"drift\"} starts a new generation on the pin)"*) pass "V: resume reports pin drift in the headline" ;; *) fail "V: id4 head ($(res_head "$OUT" 4))" ;; esac
  [ "$(field_of "$(res_json "$OUT" 4)" pinDrift)" = "launched stub/old-model, pin stub/pinned-model" ] && pass "V: pinDrift in the JSON" || fail "V: id4 ($(res_json "$OUT" 4))"
  assert_json "V: resumed on the recorded model (--model stub/old-model)" "$ARGS" 'r.argv.join(" ").includes("--model stub/old-model")'
} || true

# ---------------------------------------------------------------------------
# W. a blocking call's heartbeat (sent at once, then every 20s) says that stopping it (TaskStop) does
# not stop the child; the three control tools' descriptions say so too
# ---------------------------------------------------------------------------
{
  PW="$(make_scratch)"; OUT="$(make_scratch)/w.jsonl"
  CLAUDE_PROJECT_DIR="$PW" PI_STUB_SETTLE_MS=500 feed "$OUT" \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' "WAIT_FOR \"id\":2 5" \
    "$(call_tok 3 pi_agent '{"name":"hb","prompt":"one"}' t3)" "WAIT_FOR \"id\":3 10"
  node -e '
    let beats = [], descs = {};
    for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
      try { const o = JSON.parse(l);
        if (o.method === "notifications/progress" && o.params.progressToken === "t3") beats.push(o.params.message);
        if (o.id === 2) for (const t of o.result.tools) descs[t.name] = t.description;
      } catch {}
    }
    const want = "stopping that task (TaskStop) only drops the wake; the child keeps running: use pi_stop {name}.";
    const okDesc = ["pi_agent", "pi_send_message", "pi_answer"].every((n) => (descs[n] || "").includes(want));
    const okBeat = beats.includes("pi:hb is working. This is only the wake listener; stopping it does NOT stop any pi child; use pi_stop {name}.");
    console.error("    progress: " + JSON.stringify(beats));
    process.exit(okDesc && okBeat ? 0 : 1);' "$OUT" && pass "W: heartbeat and descriptions warn that TaskStop only drops the wake" || fail "W: heartbeat/descriptions"
} || true

# ---------------------------------------------------------------------------
# X. fallback: once the QUESTION went back to Claude nobody holds the turn; the
# server's soft expiry answers for the child, which then finishes. The DONE is
# only pushed (reaches nobody without a channel) until a late pi_answer, the
# usual one with no question_id, is refused AND takes the wake: it carries the
# DONE and consumes it
# ---------------------------------------------------------------------------
{
  PX="$(make_scratch)"; OUT="$(make_scratch)/x.jsonl"; CD="$(child_dir "$PX" x)"; Q="$(qid call_1_1)"
  CLAUDE_PROJECT_DIR="$PX" PI_MCP_ASK_TIMEOUT_MS=1500 PI_STUB_ASKS=1 PI_STUB_ASK_WAIT_MS=30000 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"x","prompt":"go","run_in_background":false}')" "WAIT_FOR \"id\":2 10" "SLEEP 4" \
    "SNAP $CD $PX/snap" \
    "$(call 3 pi_answer '{"to":"x","answer":"late"}')" "WAIT_FOR \"id\":3 10" \
    "SNAP $CD $PX/snap2"
  case "$(res_head "$OUT" 2)" in *"QUESTION $Q"*'If unanswered within 2s, the child goes on alone on its best judgment; a later pi_answer {to:"x"} or pi_wait {name:"x"} then picks up its end.'*) pass "X: the fallback QUESTION says the child goes on alone after the soft timeout" ;; *) fail "X: id2 ($(res_head "$OUT" 2))" ;; esac
  read -r C1 D1 < "$PX/snap"
  [ "$D1" -gt 0 ] && [ "$C1" -lt "$D1" ] && pass "X: before the late call the DONE (seq $D1) is unconsumed (consumed_seq $C1)" || fail "X: snap ($C1 $D1)"
  H="$(res_head "$OUT" 3)"
  case "$H" in "question $Q already resolved (expired (timeout), "[0-9][0-9]:[0-9][0-9]"); the child proceeded on its own judgment. Send a correction with pi_send_message {to:\"x\"}"*) pass "X: late pi_answer without question_id says already resolved (expired (timeout), HH:MM)" ;; *) fail "X: id3 head ($H)" ;; esac
  case "$H" in *"DONE turn 1 ok"*"got:No answer arrived within the budget."*) pass "X: the late pi_answer carries the DONE inline" ;; *) fail "X: no DONE in id3 ($H)" ;; esac
  J="$(res_json "$OUT" 3)"
  [ "$(field_of "$J" ok)" = true ] && [ "$(field_of "$J" refused)" = "already resolved" ] && [ "$(field_of "$J" status)" = done ] && [ "$(is_error "$OUT" 3)" = false ] \
    && pass "X: ok:true, refused:already resolved, status done" || fail "X: id3 json ($J)"
  read -r C2 D2 < "$PX/snap2"
  [ "$C2" -ge "$D2" ] && pass "X: consumed_seq $C2 >= done seq $D2 after the response" || fail "X: snap2 ($C2 $D2)"
} || true

# ---------------------------------------------------------------------------
# Y. fallback, sequential asks: q1 expires, the child asks q2 in the same turn.
# q2 reaches Claude only on the late pi_answer to q1 (its text inline), whose
# expiry clock then starts; answering q2 holds the wake until DONE
# ---------------------------------------------------------------------------
{
  PY="$(make_scratch)"; OUT="$(make_scratch)/y.jsonl"; CD="$(child_dir "$PY" y)"; Q1="$(qid call_1_1)"; Q2="$(qid call_1_2)"
  CLAUDE_PROJECT_DIR="$PY" PI_MCP_ASK_TIMEOUT_MS=1500 PI_STUB_ASKS=2 PI_STUB_ASK_SEQ=1 PI_STUB_ASK_WAIT_MS=30000 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"y","prompt":"go","run_in_background":false}')" "WAIT_FOR \"id\":2 10" "SLEEP 4" \
    "$(call 3 pi_answer "$(json_obj to y question_id "$Q1" answer late)")" "WAIT_FOR \"id\":3 10" \
    "$(call 4 pi_answer '{"to":"y","answer":"second"}')" "WAIT_FOR \"id\":4 10"
  H="$(res_head "$OUT" 3)"
  case "$H" in "question $Q1 already resolved (expired (timeout), "*"QUESTION $Q2 (blocked, 2/5 this turn): question call_1_2?"*) pass "Y: the late pi_answer to q1 carries q2 with its text" ;; *) fail "Y: id3 ($H)" ;; esac
  [ "$(field_of "$(res_json "$OUT" 3)" status)" = waiting ] && pass "Y: status waiting" || fail "Y: id3 json ($(res_json "$OUT" 3))"
  case "$(res_json "$OUT" 4)" in *'"status":"done"'*'model (timeout)|got:second@model'*) pass "Y: answering q2 holds the wake until DONE" ;; *) fail "Y: id4 ($(res_json "$OUT" 4))" ;; esac
  [ "$(meta_eval "$CD" m.consumed_seq)" -ge "$(last_seq_of "$CD" done)" ] && pass "Y: DONE consumed" || fail "Y: consumed_seq $(meta_eval "$CD" m.consumed_seq)"
} || true

# ---------------------------------------------------------------------------
# Z. a batch whose second question arrives in a later stdout read than the
# one the blocking call returned on: the first answer's "still blocked on"
# carries q2's topic and text and consumes it (so its expiry clock runs)
# ---------------------------------------------------------------------------
{
  PZ="$(make_scratch)"; OUT="$(make_scratch)/z.jsonl"; CD="$(child_dir "$PZ" z)"; Q1="$(qid call_1_1)"; Q2="$(qid call_1_2)"
  CLAUDE_PROJECT_DIR="$PZ" PI_MCP_ASK_TIMEOUT_MS=30000 PI_STUB_ASKS=2 PI_STUB_ASK_GAP_MS=300 PI_STUB_ASK_WAIT_MS=30000 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"z","prompt":"go","run_in_background":false}')" "WAIT_FOR \"id\":2 10" "SLEEP 0.6" \
    "$(call 3 pi_answer "$(json_obj to z question_id "$Q1" answer a1)")" "WAIT_FOR \"id\":3 10" "SLEEP 0.3" \
    "SH meta_of '$CD' consumed_seq > '$PZ/mid'" \
    "$(call 4 pi_answer '{"to":"z","answer":"a2"}')" "WAIT_FOR \"id\":4 10"
  case "$(res_head "$OUT" 2)" in *"$Q2"*) fail "Z: q2 already in the spawn return (no gap; test is moot)" ;; *) pass "Z: the spawn returned on q1 alone" ;; esac
  [ "$(res_head "$OUT" 3 | head -n 1)" = "answered $Q1 for pi:z; picked up; still blocked on $Q2 (blocked): \"question call_1_2?\" (same batch)." ] && pass "Z: the sibling is listed with topic and text" || fail "Z: id3 head ($(res_head "$OUT" 3))"
  [ "$(field_of "$(res_json "$OUT" 3)" 'events.map((e) => e.question_id).join()')" = "$Q2" ] && pass "Z: q2's event rides on the response" || fail "Z: id3 events ($(res_json "$OUT" 3))"
  Q2SEQ="$(events_eval "$CD" 'evs.find((e) => e.type === "question" && e.data.question_id === "'"$Q2"'").seq')"
  [ "$(cat "$PZ/mid")" -ge "$Q2SEQ" ] && pass "Z: q2 (seq $Q2SEQ) consumed by that response (consumed_seq $(cat "$PZ/mid"))" || fail "Z: mid consumed_seq $(cat "$PZ/mid") < $Q2SEQ"
  case "$(res_json "$OUT" 4)" in *'"status":"done"'*'got:a1@model|got:a2@model'*) pass "Z: answering q2 holds the wake until DONE" ;; *) fail "Z: id4 ($(res_json "$OUT" 4))" ;; esac
} || true

finish
