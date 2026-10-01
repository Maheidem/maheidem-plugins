#!/usr/bin/env bash
# REAL pi through the MCP server (no stubs), 0.11 S4 verify (spec §9, T5.1):
# a child blocked in ask_parent is interrupted with pi_send_message
# {interrupt:true}. The interrupt call returns in < 15s (confirmed channel, so
# the call does not also wait for the new turn), the same session file shows
# the "[parent interrupted the task: ...]" tool result and then the new
# prompt, every toolCall has a toolResult, and the new turn writes int.txt.
# Then pi_stop keeps the session and pi_send_message resumes it (same
# --session-id, new process). Then a real pi recorded as orphaned (titled
# "pi", so ps has no --session-id) is found and killed by the next resume,
# leaving exactly one pi on the session. Skips (exit 0) only when the pi CLI or the
# pi-side package is absent. Model: PI_E2E_PROVIDER / PI_E2E_MODEL (default
# mac-m3 / qwen3.8-flash@adaptive).
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/mcp.sh"
set +e

if ! command -v pi >/dev/null 2>&1; then echo "  SKIP: pi CLI not on PATH"; exit 0; fi
if [ ! -f "$HOME/.pi/agent/npm/node_modules/@maheidem/pi-delegate/package.json" ]; then
  echo "  SKIP: pi-side @maheidem/pi-delegate not installed"; exit 0
fi

PROJ="$(make_scratch)"
mkdir -p "$PROJ/.claude"
printf -- '---\nprovider: %s\nmodel: %s\n---\n' "${PI_E2E_PROVIDER:-mac-m3}" "${PI_E2E_MODEL:-qwen3.8-flash@adaptive}" > "$PROJ/.claude/pi-delegate.local.md"
SESS="$(pi_sessions_dir "$PROJ")"   # registered for cleanup
TOKEN="INT-TOKEN-$RANDOM$RANDOM"
TOKEN2="RESUME-TOKEN-$RANDOM$RANDOM"
DIR="$(child_dir "$PROJ" int)"
OUT="$(make_scratch)/send.jsonl"; T="$(make_scratch)/t"; PS1F="$(make_scratch)/ps1"; PS2F="$(make_scratch)/ps2"
now_ms() { node -e 'process.stdout.write(String(Date.now()))'; }
export -f now_ms
jarg() { node -e 'const a = process.argv.slice(1); const o = {}; for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1] === "true" ? true : a[i + 1] === "false" ? false : a[i + 1]; process.stdout.write(JSON.stringify(o))' "$@"; }

ASK_PROMPT='Call the ask_parent tool with kind "question", topic "blocked" and text "Which file name should I use?". Wait for the answer, then create that file.'
INT_MSG="Stop waiting for that answer. Create the file int.txt in the current directory containing exactly $TOKEN and nothing else, then reply DONE."
RES_MSG="Append a second line containing exactly $TOKEN2 to int.txt, then reply DONE."
START=$(date +%s)
CLAUDE_PROJECT_DIR="$PROJ" PI_DELEGATE_WAKE=channel FEED_TIMEOUT=900 feed "$OUT" \
  "$(call 2 pi_agent "$(jarg name int prompt "$ASK_PROMPT")")" "WAIT_FOR \"id\":2 30" \
  "WAIT_FOR \"event\":\"question\" 240" "SLEEP 0.5" \
  "SH now_ms > '$T.0'" \
  "$(call 3 pi_send_message "$(jarg to int message "$INT_MSG" interrupt true)")" "WAIT_FOR \"id\":3 60" \
  "SH now_ms > '$T.1'; ps -o pid=,args= -p \$(node -e 'process.stdout.write(String(JSON.parse(require(\"fs\").readFileSync(\"$DIR/meta.json\",\"utf8\")).pid))') > '$PS1F'" \
  "WAIT_FOR \"turn\":\"2\",\"instance\" 300" "SLEEP 1" \
  "$(call 4 pi_stop '{"name":"int"}')" "WAIT_FOR \"id\":4 30" \
  "$(call 5 pi_send_message "$(jarg to int message "$RES_MSG")")" "WAIT_FOR \"id\":5 60" \
  "SH ps -o pid=,args= -p \$(node -e 'process.stdout.write(String(JSON.parse(require(\"fs\").readFileSync(\"$DIR/meta.json\",\"utf8\")).pid))') > '$PS2F'" \
  "WAIT_FOR \"turn\":\"3\",\"instance\" 300" "SLEEP 1"
ELAPSED=$(( $(date +%s) - START ))
EL=$(( $(cat "$T.1" 2>/dev/null || echo 0) - $(cat "$T.0" 2>/dev/null || echo 0) ))
SFILE="$(ls "$SESS"/*_int-g1-teststore.jsonl 2>/dev/null | head -1)"
TYPES="$(event_types "$DIR")"
echo "  (elapsed ${ELAPSED}s; interrupt call ${EL}ms; session $SFILE)"
echo "  events.jsonl: $TYPES"
echo "  interrupt: $(head_for_id "$OUT" 3)"

[ "$(field_of "$(json_for_id "$OUT" 2)" wake)" = channel ] && pass "pi_agent returned at once (wake channel)" || fail "pi_agent ($(json_for_id "$OUT" 2))"
grep -F 'notifications/claude/channel' "$OUT" | grep -qF '"event":"question"' && pass "the real child asked (question pushed)" || fail "no question push"
[ "$EL" -gt 0 ] && [ "$EL" -lt 15000 ] && pass "interrupt during the ask returned in ${EL}ms (< 15s)" || fail "interrupt took ${EL}ms"
J3="$(json_for_id "$OUT" 3)"
[ "$(field_of "$J3" delivered)" = interrupt ] && [ "$(field_of "$J3" turn)" = 2 ] && pass "delivered interrupt, turn 2 (respawned: $(field_of "$J3" respawned))" || fail "id3 ($J3)"
case "$TYPES" in spawned,question,answered,interrupted,*done*) pass "events: question, pre-answer, interrupted, then the new turn's done" ;; *) fail "events ($TYPES)" ;; esac
[ "$(grep -c . "$PROJ/int.txt" 2>/dev/null)" -ge 1 ] && head -1 "$PROJ/int.txt" | grep -qx "$TOKEN" && pass "the new turn wrote int.txt with the token" || fail "int.txt: $(cat "$PROJ/int.txt" 2>/dev/null)"
[ -n "$SFILE" ] && [ "$(ls "$SESS"/*_int-g1-teststore.jsonl | wc -l | tr -d ' ')" = 1 ] && pass "one session file for gen 1" || fail "session files: $(ls "$SESS" 2>/dev/null)"
node -e '
  const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const msgs = ls.filter((e) => e.type === "message").map((e) => e.message);
  const calls = msgs.filter((m) => m.role === "assistant").flatMap((m) => (Array.isArray(m.content) ? m.content : []).filter((c) => c.type === "toolCall").map((c) => c.id));
  const results = new Set(msgs.filter((m) => m.role === "toolResult").map((m) => m.toolCallId));
  const orphan = calls.filter((id) => !results.has(id));
  const txt = (m) => JSON.stringify(m.content);
  const iRes = msgs.findIndex((m) => m.role === "toolResult" && txt(m).includes("[parent interrupted the task: "));
  const iUser = msgs.findIndex((m, i) => i > iRes && m.role === "user" && txt(m).includes(process.argv[2]));
  console.log(`  session: ${msgs.length} messages, ${calls.length} toolCalls, orphans=${JSON.stringify(orphan)}, interrupted-result@${iRes}, new-prompt@${iUser}`);
  process.exit(orphan.length === 0 && calls.length > 0 && iRes >= 0 && iUser > iRes ? 0 : 1);
' "$SFILE" "$TOKEN" && pass "session JSONL well-formed: every toolCall has a toolResult; [parent interrupted the task: ...] then the new prompt" || fail "session JSONL"
case "$(head_for_id "$OUT" 4)" in "stopped pi:int (was "*"). Session kept; pi_send_message {to:\"int\"} resumes it.") pass "pi_stop kept the session" ;; *) fail "stop ($(inner_for_id "$OUT" 4))" ;; esac
J5="$(json_for_id "$OUT" 5)"
[ "$(field_of "$J5" delivered)" = resumed ] && [ "$(field_of "$J5" respawned)" = true ] && pass "pi_send_message resumed the stopped child" || fail "id5 ($J5)"
P1="$(awk '{print $1}' "$PS1F")"; P2="$(awk '{print $1}' "$PS2F")"
# pi sets its process title to "pi", so ps cannot show the argv: the same
# session file continuing (below) is the evidence for --session-id int-g1-teststore.
[ -n "$P1" ] && [ -n "$P2" ] && [ "$P1" != "$P2" ] && ! kill -0 "$P1" 2>/dev/null \
  && pass "resumed on a new process $P2 (the stopped one, $P1, is gone)" || fail "ps: $(cat "$PS1F") | $(cat "$PS2F")"
grep -qx "$TOKEN2" "$PROJ/int.txt" && pass "the resumed turn appended its token" || fail "int.txt after resume: $(cat "$PROJ/int.txt" 2>/dev/null)"
[ "$(ls "$SESS"/*_int-g1-teststore.jsonl | wc -l | tr -d ' ')" = 1 ] && grep -qF "$TOKEN2" "$SFILE" && pass "resume continued the same session file" || fail "session after resume"
node -e '
  const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ms = new Set(ls.filter((e) => e.type === "model_change").map((e) => e.provider + "/" + e.modelId));
  console.log("  session models: " + [...ms].join(", "));
  process.exit(ms.size === 1 && ms.has(process.argv[2]) ? 0 : 1);
' "$SFILE" "${PI_E2E_PROVIDER:-mac-m3}/${PI_E2E_MODEL:-qwen3.8-flash@adaptive}" && pass "every model_change is the pinned model" || fail "models"

# Orphan identity (spec §4.4, real pi). pi titles itself "pi", so ps shows
# neither its argv nor --session-id; the server must recognise a recorded pi
# by lstart + pgid + comm. pi 0.99 exits on stdin EOF (rpc-mode.js), so a dead
# server's child normally goes with it; a recorded pi that did NOT exit (its
# stdin still held open here by a holder process) is the orphan case. The
# record is pointed at that real pi as a dead server would have left it; a new
# server's pi_send_message must kill it before resuming: one pi on the session.
RP="$(cd "$PROJ" && pwd -P)"
pis_in_proj() { for p in $(pgrep -x pi); do [ "$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" = "$RP" ] && echo "$p"; done | wc -l | tr -d ' '; }
export -f pis_in_proj; export RP
OST="$(make_scratch)/orph"; OUT_O="$(make_scratch)/orph.jsonl"
( cd "$PROJ" && exec node -e '
    const c = require("child_process").spawn("pi", ["--mode", "rpc", "--session-id", "int-g1-teststore", "--provider", process.argv[1], "--model", process.argv[2]], { detached: true, stdio: ["pipe", "ignore", "ignore"] });
    require("fs").writeFileSync(process.argv[3], String(c.pid)); setInterval(() => {}, 1e6);' \
    "${PI_E2E_PROVIDER:-mac-m3}" "${PI_E2E_MODEL:-qwen3.8-flash@adaptive}" "$OST.pid" ) &
HOLDER=$!
for _i in $(seq 1 50); do [ -s "$OST.pid" ] && [ "$(LC_ALL=C ps -o comm= -p "$(cat "$OST.pid")" 2>/dev/null)" = pi ] && break; sleep 0.2; done
ORPH="$(cat "$OST.pid")"
LC_ALL=C ps -o lstart=,pgid=,comm=,args= -p "$ORPH" > "$OST.ps"
echo "  orphan ps (lstart, pgid, comm, args): $(cat "$OST.ps")"
DEADSRV="$(node -e 'process.stdout.write(String(process.pid))')"   # a server pid that has exited
node -e '
  const fs = require("fs"); const f = process.argv[1] + "/meta.json"; const m = JSON.parse(fs.readFileSync(f, "utf8"));
  const pid = Number(process.argv[2]);
  const lstart = require("child_process").execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }).trim();
  Object.assign(m, { state: "running", pid, pgid: pid, procStart: lstart, ownerServerPid: Number(process.argv[3]), ownerServerStart: "gone" });
  fs.writeFileSync(f, JSON.stringify(m, null, 2));' "$DIR" "$ORPH" "$DEADSRV"
kill -0 "$ORPH" 2>/dev/null && [ "$(pis_in_proj)" = 1 ] && ! grep -q -- "--session-id" "$OST.ps" \
  && pass "orphan setup: real pi $ORPH on int-g1-teststore recorded as running under a dead server; ps has no --session-id" || fail "orphan setup ($ORPH, $(pis_in_proj) pi, ps: $(cat "$OST.ps"))"
CLAUDE_PROJECT_DIR="$PROJ" PI_DELEGATE_WAKE=channel FEED_TIMEOUT=300 feed "$OUT_O" \
  "$(call 8 pi_send_message "$(jarg to int message "Reply with exactly OK.")")" "WAIT_FOR \"id\":8 60" \
  "SH (kill -0 $ORPH 2>/dev/null && echo alive || echo dead; pis_in_proj) > '$OST.after'" \
  "WAIT_FOR \"turn\":\"4\",\"instance\" 300" "SLEEP 1"
kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null; kill -9 "$ORPH" 2>/dev/null
J8="$(json_for_id "$OUT_O" 8)"
echo "  resume over the orphan: $(head_for_id "$OUT_O" 8) | after: $(tr '\n' ' ' < "$OST.after")"
[ "$(field_of "$J8" delivered)" = resumed ] && [ "$(tr '\n' ' ' < "$OST.after")" = "dead 1 " ] \
  && pass "orphan: the resume killed the recorded real pi first; exactly one pi on the session" || fail "orphan: resume ($J8) after $(cat "$OST.after")"
OK_EV="$(node -e 'const evs = require("fs").readFileSync(process.argv[1] + "/events.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l)); const k = evs.find((e) => e.type === "orphan_killed"); process.stdout.write(k ? String(k.data.pid) : "none")' "$DIR")"
[ "$OK_EV" = "$ORPH" ] && pass "orphan: orphan_killed{pid $ORPH} logged" || fail "orphan: $OK_EV; events $(event_types "$DIR")"
grep -qF '"event":"done"' "$OUT_O" && pass "orphan: the resumed turn finished (done pushed)" || fail "orphan: no done"

OUT_END="$(make_scratch)/end.jsonl"
CLAUDE_PROJECT_DIR="$PROJ" feed "$OUT_END" "$(call 6 pi_stop '{"name":"int","forget":true}')" "WAIT_FOR \"id\":6 20"
[ "$(field_of "$(json_for_id "$OUT_END" 6)" forgotten)" = true ] && [ -z "$(ls "$SESS" 2>/dev/null)" ] && [ ! -e "$DIR" ] && pass "pi_stop {forget:true} removed the session and record" || fail "forget ($(inner_for_id "$OUT_END" 6))"

finish
