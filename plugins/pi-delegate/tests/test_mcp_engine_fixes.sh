#!/usr/bin/env bash
# Regression tests for the engine review findings (stub pi, real server).
# Each section fails on the server before its fix and passes after it.
#   A  (1)  a prompt ack slower than 15s: the turn stays tracked and ends DONE;
#           A2: a prompt refused after 15s ends the turn failed{prompt_rejected}
#   M  (16) a prompt refused while pi compacts is sent again until pi takes it
#   B  (3)  the turn clock pauses while a question waits for its answer
#   C  (6)  pi_wait resolves "pi:c" and "C" like every other by-name tool
#   D  (2)  pi dies while a daemon it started holds its stdout: seen as dead
#   E  (4)  an answer that names a pushed question (the agents pane reads ids
#           from disk) does not confirm push wake
#   F  (5)  a parked extension dialog: a dialog event (with the confirm
#           message) wakes the call, pi_answer holds the wake, the clock pauses
#   G  (7)  a question nobody is shown expires on the backstop
#   H  (9)  a response to a command nobody sent (other id) is not taken
#   I  (10) pi_stop returns the events nobody was shown, never drops them
#   J  (11) pi_answer cancelled during its pickup wait holds no wake
#   K  (12) a detached pi_agent leaves no progress token on the child
#   L  (14) a handler that throws gives an isError tool result
#   N  (15) a pin with an inline comment applies; unknown keys and a dropped
#           pin value are warnings
#   O       the agents pane's calls (hold:false) in fallback return at once
#           and leave the next event queued for Claude (pi_wait, a list)
#   P       a dead pi's process group is killed: its daemon does not stay
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/mcp.sh"
unset PI_DELEGATE_WAKE

FAKE_PKG="$(make_scratch)/pi-delegate-pkg"
mkdir -p "$FAKE_PKG" && echo '{"name":"@maheidem/pi-delegate"}' > "$FAKE_PKG/package.json"
export PI_DELEGATE_PI_PACKAGE="$FAKE_PKG"
use_stub pi-rpc-lab

res_json() { inner_for_id "$1" "$2" | tail -n 1; }
res_head() { inner_for_id "$1" "$2" | sed '$d'; }
cancel() { printf '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":%s}}' "$1"; }
# wait_text <out> <fixed text> <secs>: a feed step that waits for text (spaces allowed)
wait_text() { echo "SH for _i in \$(seq 1 $(( $3 * 10 ))); do grep -qF '$2' '$1' 2>/dev/null && break; sleep 0.1; done"; }
# pushes <out> <fixed text> -> channel pushes whose content has that text
pushes() { { grep -F 'notifications/claude/channel' "$1" 2>/dev/null || true; } | { grep -cF "$2" || true; }; }
# shimmed <stub> -> a bin dir whose pi runs tests/stubs/<stub> behind lib/pi-rpc-shim.mjs
shimmed() {
  local bin; bin="$(make_scratch)/bin"; mkdir -p "$bin"
  cp "$TESTS_DIR/stubs/$1" "$bin/pi-stub"; chmod +x "$bin/pi-stub"
  cat > "$bin/pi" <<WRAP
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo 0.99.1; exit 0; fi
exec node "$TESTS_DIR/lib/pi-rpc-shim.mjs" "$bin/pi-stub" "\$@"
WRAP
  chmod +x "$bin/pi"; echo "$bin"
}
# An SH step: a tools/call whose question_id is the newest question (or
# dialog) id in a child's events.jsonl, read from disk as the agents pane does.
QHELPER="$(make_scratch)/qid.js"
cat > "$QHELPER" <<'JS'
const [dir, id, tool, json, type] = process.argv.slice(2);
let qid = null;
try {
  for (const l of require("fs").readFileSync(dir + "/events.jsonl", "utf8").split("\n")) {
    try { const e = JSON.parse(l); if (e.type === (type || "question")) qid = e.data.question_id; } catch {}
  }
} catch {}
process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: Number(id), method: "tools/call", params: { name: tool, arguments: { ...JSON.parse(json), question_id: qid } } }) + "\n");
JS
answer_from_disk() { echo "SH node '$QHELPER' '$1' $2 $3 '$4' ${5:-}"; }
DIALOG_ID="$(node -e 'process.stdout.write("d_" + require("crypto").createHash("sha1").update("q1").digest("hex").slice(0, 6))')"

# ---------------------------------------------------------------------------
# A, A2 (finding 1): run in parallel, each needs > 15s
# ---------------------------------------------------------------------------
PA="$(make_scratch)"; OUT_A="$(make_scratch)/a.jsonl"; LOG_A="$(make_scratch)/a.log"
PA2="$(make_scratch)"; OUT_A2="$(make_scratch)/a2.jsonl"; SHIM_LAB="$(shimmed pi-rpc-lab)"
(
  CLAUDE_PROJECT_DIR="$PA" PI_DELEGATE_WAKE=channel PI_STUB_PROMPT_DELAY_MS=17000 PI_STUB_SETTLE_MS=300 PI_STUB_LOG_FILE="$LOG_A" feed "$OUT_A" \
    "$(call 2 pi_agent '{"name":"a","prompt":"one"}')" "$(wait_text "$OUT_A" "DONE turn 1" 10)" \
    "$(call 3 pi_send_message '{"to":"a","message":"two"}')" "WAIT_FOR \"id\":3 30" \
    "$(wait_text "$OUT_A" "DONE turn 2" 15)" "SLEEP 0.3"
) &
(
  PATH="$SHIM_LAB:$PATH" CLAUDE_PROJECT_DIR="$PA2" PI_DELEGATE_WAKE=channel PI_SHIM_LATE_REJECT_MS=16000 PI_STUB_SETTLE_MS=300 feed "$OUT_A2" \
    "$(call 2 pi_agent '{"name":"a2","prompt":"one"}')" "$(wait_text "$OUT_A2" "DONE turn 1" 10)" \
    "$(call 3 pi_send_message '{"to":"a2","message":"two"}')" "WAIT_FOR \"id\":3 30" \
    "$(wait_text "$OUT_A2" "FAILED turn 2" 10)" "SLEEP 0.3"
)
wait
[ "$(field_of "$(res_json "$OUT_A" 3)" ok)" = true ] && [ "$(field_of "$(res_json "$OUT_A" 3)" delivered)" = new_turn ] \
  && pass "A: a prompt acked after 17s is not refused (delivered new_turn)" || fail "A: id3 ($(inner_for_id "$OUT_A" 3))"
[ "$(pushes "$OUT_A" "DONE turn 2")" = 1 ] && pass "A: the slow-acked turn stays tracked and its DONE is pushed" || fail "A: DONE turn 2 pushes $(pushes "$OUT_A" "DONE turn 2")"
grep -qx 'prompt:two' "$LOG_A" && pass "A: pi ran the prompt" || fail "A: stub log ($(cat "$LOG_A" 2>/dev/null))"
[ "$(field_of "$(res_json "$OUT_A2" 3)" ok)" = true ] && [ "$(pushes "$OUT_A2" "FAILED turn 2 (prompt_rejected)")" = 1 ] \
  && pass "A2: a prompt refused after 16s ends the tracked turn failed{prompt_rejected}" || fail "A2: id3 ($(inner_for_id "$OUT_A2" 3)); pushes $(pushes "$OUT_A2" "FAILED turn 2")"

# ---------------------------------------------------------------------------
# M (finding 16): compaction in progress
# ---------------------------------------------------------------------------
{
  PM="$(make_scratch)"; OUT="$(make_scratch)/m.jsonl"
  PATH="$SHIM_LAB:$PATH" CLAUDE_PROJECT_DIR="$PM" PI_DELEGATE_WAKE=channel PI_SHIM_COMPACT_REJECTS=2 PI_STUB_SETTLE_MS=200 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"m","prompt":"one"}')" "WAIT_FOR \"id\":2 15" "$(wait_text "$OUT" "DONE turn 1" 10)"
  [ "$(field_of "$(res_json "$OUT" 2)" ok)" = true ] && [ "$(pushes "$OUT" "DONE turn 1 ok")" = 1 ] \
    && pass "M: two 'compaction is in progress' refusals, then the prompt runs (DONE)" || fail "M: id2 ($(inner_for_id "$OUT" 2))"
} || true

# ---------------------------------------------------------------------------
# B (finding 3): turn_timeout_ms 3000, the answer comes after 5s, 2s more work
# ---------------------------------------------------------------------------
{
  PB="$(make_scratch)"; OUT="$(make_scratch)/b.jsonl"
  CLAUDE_PROJECT_DIR="$PB" PI_DELEGATE_WAKE=channel PI_STUB_ASKS=1 PI_STUB_SETTLE_MS=2000 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"b","prompt":"go","turn_timeout_ms":3000}')" "WAIT_FOR \"event\":\"question\" 10" "SLEEP 5" \
    "$(answer_from_disk "$(child_dir "$PB" b)" 3 pi_answer '{"to":"b","answer":"yes"}')" "WAIT_FOR \"id\":3 10" \
    "$(wait_text "$OUT" " turn 1 " 15)" "SLEEP 0.3"
  [ "$(pushes "$OUT" "DONE turn 1 ok")" = 1 ] && [ "$(pushes "$OUT" "FAILED turn 1")" = 0 ] \
    && pass "B: 5s blocked on a question did not count against a 3s turn timeout" || fail "B: pushes ($(grep -F 'turn 1' "$OUT" | head -c 600))"
} || true

# ---------------------------------------------------------------------------
# C (finding 6): pi_wait {name:"pi:c"} and {name:"C"}
# ---------------------------------------------------------------------------
{
  for spelled in 'pi:c' 'C'; do
    PC="$(make_scratch)"; OUT="$(make_scratch)/c.jsonl"
    CLAUDE_PROJECT_DIR="$PC" PI_DELEGATE_WAKE=fallback PI_STUB_SETTLE_MS=3000 feed "$OUT" \
      "$(call 2 pi_agent '{"name":"c","prompt":"x"}')" "SLEEP 1" "$(cancel 2)" "SLEEP 0.3" \
      "$(call 3 pi_wait "$(json_obj name "$spelled")")" "WAIT_FOR \"id\":3 15"
    J="$(res_json "$OUT" 3)"
    [ "$(field_of "$J" noLiveChildren)" = false ] && [ "$(field_of "$J" 'events[0].type')" = done ] \
      && pass "C: pi_wait {name:\"$spelled\"} waited for child c and returned its DONE" || fail "C: pi_wait $spelled ($J)"
  done
} || true

# ---------------------------------------------------------------------------
# D (finding 2): a daemon keeps pi's stdout open after pi dies
# ---------------------------------------------------------------------------
{
  DBIN="$(make_scratch)/bin"; mkdir -p "$DBIN"; DAEMONS="$(make_scratch)/daemons"; PIDS="$(make_scratch)/pids"
  cp "$TESTS_DIR/stubs/pi-rpc-lab" "$DBIN/pi-stub"; chmod +x "$DBIN/pi-stub"
  cat > "$DBIN/pi" <<WRAP
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo 0.99.1; exit 0; fi
sleep 25 &
echo \$! >> "$DAEMONS"
exec "$DBIN/pi-stub" "\$@"
WRAP
  chmod +x "$DBIN/pi"
  kill_daemons() { [ -f "$DAEMONS" ] && while read -r p; do kill "$p" 2>/dev/null || true; done < "$DAEMONS"; return 0; }
  add_cleanup kill_daemons
  PD="$(make_scratch)"; OUT="$(make_scratch)/d.jsonl"
  PATH="$DBIN:$PATH" CLAUDE_PROJECT_DIR="$PD" PI_DELEGATE_WAKE=channel PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"d","prompt":"one"}')" "$(wait_text "$OUT" "DONE turn 1" 10)" \
    "SH kill -9 \$(head -n 1 '$PIDS')" "SLEEP 1.5" \
    "$(call 3 pi_list_agents '{"name":"d"}')" "WAIT_FOR \"id\":3 5" \
    "$(call 4 pi_send_message '{"to":"d","message":"two"}')" "WAIT_FOR \"id\":4 20" "$(wait_text "$OUT" "DONE turn 2" 10)"
  [ "$(field_of "$(res_json "$OUT" 3)" state)" = failed ] && pass "D: pi's death is seen although its daemon holds stdout (state failed)" || fail "D: list ($(res_head "$OUT" 3 | head -n 2))"
  [ "$(field_of "$(res_json "$OUT" 4)" delivered)" = resumed ] && [ "$(pushes "$OUT" "DONE turn 2")" = 1 ] \
    && pass "D: pi_send_message respawned it and the turn ran" || fail "D: id4 ($(inner_for_id "$OUT" 4))"
  kill_daemons
} || true

# ---------------------------------------------------------------------------
# E (finding 4): an answer like the pane's (id read from disk,
# relay_user:true, but no hold:false) to a question that went out only as a
# push confirms nothing
# ---------------------------------------------------------------------------
{
  PE="$(make_scratch)"; OUT="$(make_scratch)/e.jsonl"
  CLAUDE_PROJECT_DIR="$PE" PI_STUB_ASKS=1 PI_STUB_ASK_DELAY_MS=1500 PI_STUB_SETTLE_MS=1500 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"e","prompt":"one"}')" "SLEEP 0.8" "$(cancel 2)" "WAIT_FOR \"event\":\"question\" 10" "SLEEP 0.3" \
    "$(answer_from_disk "$(child_dir "$PE" e)" 3 pi_answer '{"to":"e","answer":"yes","relay_user":true}')" "WAIT_FOR \"id\":3 15" \
    "$(call 4 pi_list_agents '{"doctor":true}')" "WAIT_FOR \"id\":4 5"
  res_head "$OUT" 4 | grep -qE '^wake: fallback' && pass "E: the answer did not confirm push wake" || fail "E: doctor ($(res_head "$OUT" 4 | grep wake))"
  [ "$(field_of "$(res_json "$OUT" 3)" status)" = done ] && pass "E: the answer held the wake and returned the DONE (nothing lost to a dead push)" || fail "E: id3 ($(res_json "$OUT" 3))"
} || true

# ---------------------------------------------------------------------------
# F (finding 5): extension dialogs (pi-rpc-dialog behind the shim: a confirm
# dialog "Clear session?" / "All messages will be lost.")
# ---------------------------------------------------------------------------
{
  SHIM_DLG="$(shimmed pi-rpc-dialog)"
  PF="$(make_scratch)"; OUT="$(make_scratch)/f1.jsonl"
  PATH="$SHIM_DLG:$PATH" CLAUDE_PROJECT_DIR="$PF" PI_DELEGATE_WAKE=fallback PI_SHIM_DIALOG_CONFIRM=1 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"fa","prompt":"go","turn_timeout_ms":60000}')" "WAIT_FOR \"id\":2 10" \
    "$(call 3 pi_list_agents '{"name":"fa"}')" "WAIT_FOR \"id\":3 5" \
    "$(call 4 pi_answer "$(node -e 'process.stdout.write(JSON.stringify({to:"fa",question_id:process.argv[1],confirmed:true}))' "$DIALOG_ID")")" "WAIT_FOR \"id\":4 10"
  J2="$(res_json "$OUT" 2)"
  [ "$(field_of "$J2" status)" = waiting ] && [ "$(field_of "$J2" 'events[0].type')" = dialog ] && [ "$(field_of "$J2" 'events[0].dialog_id')" = "$DIALOG_ID" ] \
    && pass "F1: the dialog woke the blocking pi_agent (status waiting, dialog event)" || fail "F1: id2 ($J2)"
  res_head "$OUT" 2 | grep -qF "DIALOG $DIALOG_ID (confirm): Clear session?: All messages will be lost." && pass "F1: the confirm message is forwarded" || fail "F1: head ($(res_head "$OUT" 2))"
  res_head "$OUT" 3 | grep -qF "dialog $DIALOG_ID (confirm): Clear session?: All messages will be lost." && pass "F1: pi_list_agents {name} shows the dialog with its message" || fail "F1: list ($(res_head "$OUT" 3))"
  J4="$(res_json "$OUT" 4)"
  [ "$(field_of "$J4" status)" = done ] && case "$(field_of "$J4" text)" in *picked:confirmed-true*) true ;; *) false ;; esac \
    && pass "F1: pi_answer {d_*, confirmed} held the wake and returned the DONE" || fail "F1: id4 ($J4)"

  # Channel: the dialog is pushed; a 2s turn timeout does not run while it waits 4s.
  OUT="$(make_scratch)/f2.jsonl"
  PATH="$SHIM_DLG:$PATH" CLAUDE_PROJECT_DIR="$PF" PI_DELEGATE_WAKE=channel PI_SHIM_DIALOG_CONFIRM=1 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"fb","prompt":"go","turn_timeout_ms":2000}')" "WAIT_FOR \"event\":\"dialog\" 10" "SLEEP 4" \
    "$(call 3 pi_answer "$(node -e 'process.stdout.write(JSON.stringify({to:"fb",question_id:process.argv[1],confirmed:false}))' "$DIALOG_ID")")" "WAIT_FOR \"id\":3 10" \
    "$(wait_text "$OUT" " turn 1 " 10)" "SLEEP 0.3"
  grep -F 'notifications/claude/channel' "$OUT" | grep -F '"event":"dialog"' | grep -F "\"question_id\":\"$DIALOG_ID\"" | grep -qF 'All messages will be lost.' \
    && pass "F2: the dialog is pushed (event dialog, question_id d_*, message)" || fail "F2: dialog push"
  [ "$(pushes "$OUT" "DONE turn 1 ok")" = 1 ] && [ "$(pushes "$OUT" "FAILED turn 1")" = 0 ] \
    && pass "F2: 4s on an open dialog did not count against a 2s turn timeout" || fail "F2: turn end ($(grep -F 'turn 1' "$OUT" | grep -F channel | head -c 400))"
} || true

# ---------------------------------------------------------------------------
# G (finding 7): question_wait 1s -> backstop 3s; the question is never shown
# (the blocking call was cancelled, and in fallback a push shows nothing)
# ---------------------------------------------------------------------------
{
  PG="$(make_scratch)"; OUT="$(make_scratch)/g.jsonl"
  CLAUDE_PROJECT_DIR="$PG" PI_MCP_TEST=1 PI_MCP_ASK_TIMEOUT_MS=1000 PI_STUB_ASKS=1 PI_STUB_ASK_DELAY_MS=1000 PI_STUB_SETTLE_MS=300 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"g","prompt":"one"}')" "SLEEP 0.5" "$(cancel 2)" "SLEEP 7" \
    "$(call 3 pi_wait '{"name":"g","timeout_ms":5000}')" "WAIT_FOR \"id\":3 8"
  J="$(res_json "$OUT" 3)"
  node -e '
    const r = JSON.parse(process.argv[1]); const d = (r.events || []).find((e) => e.type === "done");
    process.exit(d && /@model \(timeout\)/.test(d.result) && /expired: never shown/.test(r.text) ? 0 : 1);' "$J" \
    && pass "G: the unshown question expired on the backstop (never shown) and the turn ended" || fail "G: pi_wait ($J)"
} || true

# ---------------------------------------------------------------------------
# H (finding 9): a get_state response with a foreign id comes first
# ---------------------------------------------------------------------------
{
  PH="$(make_scratch)"; OUT="$(make_scratch)/h.jsonl"
  PATH="$SHIM_LAB:$PATH" CLAUDE_PROJECT_DIR="$PH" PI_DELEGATE_WAKE=channel PI_SHIM_STRAY_STATE=1 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"h","prompt":"one"}')" "WAIT_FOR \"id\":2 10"
  [ "$(field_of "$(res_json "$OUT" 2)" model)" = stub/stub-model ] && pass "H: the handshake took the reply with its own id, not the stray one" || fail "H: id2 ($(inner_for_id "$OUT" 2))"
} || true

# ---------------------------------------------------------------------------
# I (finding 10): pi_stop shows the DONE nobody was shown
# ---------------------------------------------------------------------------
{
  PI_="$(make_scratch)"; OUT="$(make_scratch)/i.jsonl"
  CLAUDE_PROJECT_DIR="$PI_" PI_STUB_SETTLE_MS=1000 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"i","prompt":"one"}')" "SLEEP 0.5" "$(cancel 2)" "WAIT_FOR \"event\":\"done\" 10" "SLEEP 0.3" \
    "$(call 3 pi_stop '{"name":"i"}')" "WAIT_FOR \"id\":3 10" \
    "$(call 4 pi_list_agents '{}')" "WAIT_FOR \"id\":4 5"
  res_head "$OUT" 3 | grep -qF 'earlier events of pi:i not shown before' && res_head "$OUT" 3 | grep -qF '[pi:i] DONE turn 1 ok' \
    && pass "I: pi_stop's response carries the unshown DONE" || fail "I: stop ($(res_head "$OUT" 3))"
  res_head "$OUT" 4 | grep -qF '[pi:i] DONE' && fail "I: the DONE was shown twice" || pass "I: and it counts as handled (a later list does not repeat it)"
} || true

# ---------------------------------------------------------------------------
# J (finding 11): pi_answer cancelled during its pickup wait
# ---------------------------------------------------------------------------
{
  PJ="$(make_scratch)"; OUT="$(make_scratch)/j.jsonl"
  CLAUDE_PROJECT_DIR="$PJ" PI_STUB_ASKS=1 PI_STUB_ASK_END_DELAY_MS=3000 PI_STUB_SETTLE_MS=4000 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"j","prompt":"one"}')" "WAIT_FOR \"id\":2 10" \
    "$(answer_from_disk "$(child_dir "$PJ" j)" 3 pi_answer '{"to":"j","answer":"yes"}')" "SLEEP 1" "$(cancel 3)" "SLEEP 3" \
    "$(call 4 pi_list_agents '{}')" "WAIT_FOR \"id\":4 5" \
    "$(call 5 pi_wait '{"name":"j"}')" "WAIT_FOR \"id\":5 15"
  [ "$(field_of "$(res_json "$OUT" 2)" status)" = waiting ] || fail "J: setup (id2 $(res_json "$OUT" 2))"
  [ "$(inner_for_id "$OUT" 3)" = "{}" ] && pass "J: the cancelled pi_answer got no response" || fail "J: id3 answered"
  case "$(res_head "$OUT" 4 | head -n 1)" in *"wait armed: no") pass "J: after the pickup nothing holds the wake (wait armed: no)" ;; *) fail "J: header ($(res_head "$OUT" 4 | head -n 1))" ;; esac
  [ "$(field_of "$(res_json "$OUT" 5)" 'events[0].type')" = done ] && pass "J: pi_wait returns the turn's DONE" || fail "J: id5 ($(res_json "$OUT" 5))"
} || true

# ---------------------------------------------------------------------------
# K (finding 12): a detached pi_agent's progress token
# ---------------------------------------------------------------------------
{
  PK="$(make_scratch)"; OUT="$(make_scratch)/k.jsonl"
  CLAUDE_PROJECT_DIR="$PK" PI_DELEGATE_WAKE=channel PI_STUB_SETTLE_MS=1500 feed "$OUT" \
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"pi_agent","arguments":{"name":"k","prompt":"one"},"_meta":{"progressToken":"k1"}}}' \
    "WAIT_FOR \"id\":2 10" "$(wait_text "$OUT" "DONE turn 1" 10)" "SLEEP 0.3"
  AFTER="$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const r = ls.findIndex((o) => o.id === 2 && o.result);
    process.stdout.write(String(r < 0 ? -1 : ls.slice(r + 1).filter((o) => o.method === "notifications/progress" && o.params.progressToken === "k1").length));' "$OUT")"
  [ "$AFTER" = 0 ] && pass "K: no progress for the returned pi_agent's token" || fail "K: $AFTER progress notifications after the result"
} || true

# ---------------------------------------------------------------------------
# L (finding 14): a record that makes pi_list_agents {name} throw
# ---------------------------------------------------------------------------
{
  PL="$(make_scratch)"; OUT="$(make_scratch)/l.jsonl"; LD="$(child_dir "$PL" l)"
  mkdir -p "$LD" && echo '{"name":"l","state":"stopped","gens":[null]}' > "$LD/meta.json"
  CLAUDE_PROJECT_DIR="$PL" feed "$OUT" "$(call 2 pi_list_agents '{"name":"l"}')" "WAIT_FOR \"id\":2 5"
  node -e '
    const o = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((x) => x.id === 2);
    process.exit(o && o.result && o.result.isError === true && /failed inside the server/.test(o.result.content[0].text) ? 0 : 1);' "$OUT" \
    && pass "L: the exception is an isError tool result" || fail "L: id2 ($(grep -F '"id":2' "$OUT"))"
} || true

# ---------------------------------------------------------------------------
# N (finding 15): pin comments and warnings
# ---------------------------------------------------------------------------
{
  PN="$(make_scratch)"; OUT="$(make_scratch)/n.jsonl"; CFG="$(make_scratch)/profile"
  mkdir -p "$PN/.claude" "$CFG"
  printf -- '---\nprovider: stub # the local box\nmodel: "stub-model" # fast\nquestions_per_turn: 3 # per turn\nbogus_key: 1\n---\n' > "$PN/.claude/pi-delegate.local.md"
  echo '{"nonsense": 1}' > "$CFG/pi-delegate.json"
  CLAUDE_CONFIG_DIR="$CFG" CLAUDE_PROJECT_DIR="$PN" feed "$OUT" "$(call 2 pi_list_agents '{}')" "WAIT_FOR \"id\":2 5"
  H="$(res_head "$OUT" 2 | head -n 1)"
  case "$H" in *" · pin stub/stub-model · questions_per_turn 3 (project) · "*) pass "N: inline comments are stripped (pin and setting apply)" ;; *) fail "N: header ($H)" ;; esac
  case "$H" in *"Unknown project setting bogus_key; ignoring it"*"Unknown user setting nonsense; ignoring it"*) pass "N: unknown keys are warnings" ;; *) fail "N: warnings ($H)" ;; esac
  printf -- '---\nmodel: stub model\n---\n' > "$PN/.claude/pi-delegate.local.md"
  OUT="$(make_scratch)/n2.jsonl"
  CLAUDE_PROJECT_DIR="$PN" feed "$OUT" "$(call 2 pi_list_agents '{}')" "WAIT_FOR \"id\":2 5"
  case "$(res_head "$OUT" 2 | head -n 1)" in *" · pin none · "*'Invalid project pin model "stub model"; ignoring it'*) pass "N: a dropped pin value is a warning" ;; *) fail "N: header ($(res_head "$OUT" 2 | head -n 1))" ;; esac
} || true

# ---------------------------------------------------------------------------
# O: the agents pane's calls (hold:false), fallback wake
# ---------------------------------------------------------------------------
{
  PO="$(make_scratch)"; OUT="$(make_scratch)/o.jsonl"
  CLAUDE_PROJECT_DIR="$PO" PI_DELEGATE_WAKE=fallback PI_STUB_ASKS=1 PI_STUB_SETTLE_MS=2500 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"o","prompt":"one"}')" "WAIT_FOR \"id\":2 10" \
    "$(answer_from_disk "$(child_dir "$PO" o)" 3 pi_answer '{"to":"o","answer":"yes","relay_user":true,"hold":false}')" "WAIT_FOR \"id\":3 4" \
    "$(call 4 pi_wait '{"name":"o","timeout_ms":10000}')" "WAIT_FOR \"id\":4 12" \
    "$(call 5 pi_send_message '{"to":"o","message":"two","hold":false}')" "WAIT_FOR \"id\":5 4" \
    "$(call 6 pi_wait '{"name":"o","timeout_ms":10000}')" "WAIT_FOR \"id\":6 12"
  [ "$(field_of "$(res_json "$OUT" 2)" status)" = waiting ] || fail "O: setup (id2 $(res_json "$OUT" 2))"
  J3="$(res_json "$OUT" 3)"
  [ "$(field_of "$J3" answeredBy)" = "model (relaying user)" ] && [ "$(field_of "$J3" status)" != done ] && res_head "$OUT" 3 | grep -qF 'stays queued for pi_wait' \
    && pass "O: the pane's pi_answer returned at once (no DONE in it, relay_user kept)" || fail "O: id3 ($J3)"
  node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const a = ls.findIndex((o) => o.id === 3 && o.result), d = ls.findIndex((o) => o.method === "notifications/claude/channel" && /DONE turn 1/.test(o.params.content));
    process.exit(a >= 0 && d > a ? 0 : 1);' "$OUT" && pass "O: its response came before the child's DONE" || fail "O: order of id3 and DONE turn 1"
  J4="$(res_json "$OUT" 4)"
  [ "$(field_of "$J4" 'events[0].type')" = done ] && [ "$(field_of "$J4" 'events[0].turn')" = 1 ] \
    && pass "O: a later pi_wait returns the DONE (not consumed by the pane)" || fail "O: id4 ($J4)"
  J5="$(res_json "$OUT" 5)"
  [ "$(field_of "$J5" delivered)" = new_turn ] && [ "$(field_of "$J5" wake)" = queued ] \
    && pass "O: the pane's pi_send_message returned at once (wake queued)" || fail "O: id5 ($J5)"
  J6="$(res_json "$OUT" 6)"
  [ "$(field_of "$J6" 'events[0].type')" = question ] && [ "$(field_of "$J6" 'events[0].turn')" = 2 ] \
    && pass "O: a later pi_wait returns that turn's next event (its question)" || fail "O: id6 ($J6)"

  # pi_stop {hold:false} leaves the unshown DONE queued (compare I).
  OUT="$(make_scratch)/o2.jsonl"
  CLAUDE_PROJECT_DIR="$PO" PI_STUB_SETTLE_MS=1000 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"o2","prompt":"one"}')" "SLEEP 0.5" "$(cancel 2)" "WAIT_FOR \"event\":\"done\" 10" "SLEEP 0.3" \
    "$(call 3 pi_stop '{"name":"o2","hold":false}')" "WAIT_FOR \"id\":3 10" \
    "$(call 4 pi_list_agents '{}')" "WAIT_FOR \"id\":4 5"
  { res_head "$OUT" 3 | grep -qF 'earlier events'; } && fail "O: pane pi_stop took the DONE ($(res_head "$OUT" 3))" \
    || { res_head "$OUT" 4 | grep -qF '[pi:o2] DONE turn 1 ok' && pass "O: the pane's pi_stop left the DONE for a later list" || fail "O: list ($(res_head "$OUT" 4))"; }
} || true

# ---------------------------------------------------------------------------
# P: pi starts a daemon (sleep 120 &) and dies (SIGKILL): its group is killed
# ---------------------------------------------------------------------------
{
  GBIN="$(make_scratch)/bin"; mkdir -p "$GBIN"; GDAEMON="$(make_scratch)/daemon"; GPIDS="$(make_scratch)/pids"; GSEEN="$(make_scratch)/seen"
  cp "$TESTS_DIR/stubs/pi-rpc-lab" "$GBIN/pi-stub"; chmod +x "$GBIN/pi-stub"
  cat > "$GBIN/pi" <<WRAP
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo 0.99.1; exit 0; fi
sleep 120 &
echo \$! > "$GDAEMON"
exec "$GBIN/pi-stub" "\$@"
WRAP
  chmod +x "$GBIN/pi"
  kill_gdaemon() { [ -f "$GDAEMON" ] && kill -9 "$(cat "$GDAEMON")" 2>/dev/null; return 0; }
  add_cleanup kill_gdaemon
  PP="$(make_scratch)"; OUT="$(make_scratch)/p.jsonl"
  PATH="$GBIN:$PATH" CLAUDE_PROJECT_DIR="$PP" PI_DELEGATE_WAKE=channel PI_STUB_PID_FILE="$GPIDS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"p","prompt":"one"}')" "$(wait_text "$OUT" "DONE turn 1" 10)" \
    "SH kill -0 \$(cat '$GDAEMON') 2>/dev/null && echo before:alive >> '$GSEEN'" \
    "SH kill -9 \$(head -n 1 '$GPIDS')" "SLEEP 1.5" \
    "SH kill -0 \$(cat '$GDAEMON') 2>/dev/null && echo after:alive >> '$GSEEN' || echo after:gone >> '$GSEEN'" \
    "$(call 3 pi_list_agents '{"name":"p"}')" "WAIT_FOR \"id\":3 5"
  grep -qx 'before:alive' "$GSEEN" && grep -qx 'after:gone' "$GSEEN" \
    && pass "P: the daemon was alive with pi and is gone after pi died (group killed)" || fail "P: daemon ($(tr '\n' ' ' < "$GSEEN" 2>/dev/null))"
  [ "$(field_of "$(res_json "$OUT" 3)" state)" = failed ] && pass "P: pi's death is still recorded (state failed)" || fail "P: list ($(res_head "$OUT" 3 | head -n 2))"
  kill_gdaemon
} || true

finish
