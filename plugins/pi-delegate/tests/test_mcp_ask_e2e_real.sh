#!/usr/bin/env bash
# REAL pi through the MCP server (no stubs): a lean child loads the pi-side
# @maheidem/pi-delegate package, calls ask_parent for a secret word, gets the
# answer via pi_answer, and must reply with exactly that word.
# Skips (exit 0) only when the pi CLI or the pi-side package is absent; any
# failure after that is a real FAIL. Model: PI_E2E_PROVIDER / PI_E2E_MODEL
# (default mac-m3 / qwen3.8-flash@adaptive, the local default).
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/mcp.sh"
set +e  # every check below reports pass/fail itself

if ! command -v pi >/dev/null 2>&1; then echo "  SKIP: pi CLI not on PATH"; exit 0; fi
if [ ! -f "$HOME/.pi/agent/npm/node_modules/@maheidem/pi-delegate/package.json" ]; then
  echo "  SKIP: pi-side @maheidem/pi-delegate not installed"; exit 0
fi

PROJ="$(make_scratch)"
mkdir -p "$PROJ/.claude"
printf -- '---\nprovider: %s\nmodel: %s\n---\n' "${PI_E2E_PROVIDER:-mac-m3}" "${PI_E2E_MODEL:-qwen3.8-flash@adaptive}" > "$PROJ/.claude/pi-delegate.local.md"
pi_sessions_dir "$PROJ" >/dev/null   # register the real session dir for cleanup

TOKEN="ZEPHYR$RANDOM$RANDOM"
PROMPT='Before doing anything else, call the ask_parent tool with kind "question", topic "blocked" and text "What is the secret word?". When you get the answer, reply with ONLY the secret word and nothing else.'
OUT="$(make_scratch)/e2e.jsonl"
START=$(date +%s)
SEND_ARGS="$(node -e 'process.stdout.write(JSON.stringify({ name: "e2eask", prompt: process.argv[1], run_in_background: false }))' "$PROMPT")"
ANSWER_ARGS="$(json_obj to e2eask answer "$TOKEN")"
DIR="$(child_dir "$PROJ" e2eask)"
# Fallback wake (no channel): pi_agent holds the wake and returns on the
# question; pi_answer then holds it until the turn's DONE.
CLAUDE_PROJECT_DIR="$PROJ" FEED_TIMEOUT=600 feed "$OUT" \
  "$(call 2 pi_agent "$SEND_ARGS")" \
  "WAIT_FOR \"id\":2 240" "SH cp $DIR/meta.json $OUT.asked" \
  "$(call 4 pi_answer "$ANSWER_ARGS")" "WAIT_FOR \"id\":4 250" \
  "$(call 6 pi_read '{"name":"e2eask","what":"transcript","last":50}')" "WAIT_FOR \"id\":6 15"
ELAPSED=$(( $(date +%s) - START ))
# Event store read-back while the record still exists (forget deletes it).
TURNS="$(node -e 'console.log(require("fs").readFileSync(process.argv[1]+"/events.jsonl","utf8").trim().split("\n").map((l)=>{const e=JSON.parse(l);return e.type+"@"+e.turn}).join(","))' "$DIR")"
TYPES="$(event_types "$DIR")"; CUR="$(meta_of "$DIR" consumed_seq)"; DONESEQ="$(last_seq_of "$DIR" done)"
OUT_END="$(make_scratch)/e2e-end.jsonl"
CLAUDE_PROJECT_DIR="$PROJ" feed "$OUT_END" "$(call 7 pi_stop '{"name":"e2eask","forget":true}')" "WAIT_FOR \"id\":7 20"

IN2="$(json_for_id "$OUT" 2)"; IN4="$(json_for_id "$OUT" 4)"
IN6="$(inner_for_id "$OUT" 6)"; IN7="$(json_for_id "$OUT_END" 7)"
echo "  (elapsed ${ELAPSED}s, token $TOKEN)"
echo "  pi_agent: $(head_for_id "$OUT" 2 | head -c 400)"
[ "$(field_of "$IN2" status)" = "waiting" ] && pass "pi_agent returned on the question (status waiting)" || fail "pi_agent (inner=$(echo "$IN2" | head -c 500))"
[ "$(field_of "$IN2" ask)" = "true" ] && pass "child has the ask_parent channel" || fail "ask (inner=$IN2)"
node -e 'const d=JSON.parse(process.argv[1]);process.exit((d.extensions||[]).some((p)=>p.endsWith("@maheidem/pi-delegate"))?0:1)' "$IN2" \
  && pass "child loaded the pi-side package (lean + -e)" || fail "extensions (inner=$IN2)"
CHANNEL_LINE="$(grep -F '"method":"notifications/claude/channel"' "$OUT" | grep -F '"event":"question"' | head -1 || true)"
[ -n "$CHANNEL_LINE" ] && pass "question pushed as a claude/channel notification" || fail "no channel notification for the question"
echo "  channel: $(echo "$CHANNEL_LINE" | head -c 400)"
echo "  event turns: $TURNS"
case "$TURNS" in *"question@1,answered@1,done@1"*) pass "question, answer and done all belong to turn 1" ;; *) fail "event turns ($TURNS)" ;; esac
echo "$CHANNEL_LINE" | grep -q '"event":"question","seq":"[0-9]*","gen":"1","turn":"1"' && pass "question push meta carries turn 1" || fail "question push meta turn"
node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(m.turn===1&&m.state==="waiting"?0:1)' "$OUT.asked" \
  && pass "meta.json says waiting (turn 1) while the question is open" || fail "meta while asked ($(head -c 300 "$OUT.asked" 2>/dev/null))"
[ "$(field_of "$IN2" 'events[0].type')" = "question" ] && pass "the question came back on pi_agent" || fail "question event (inner=$(echo "$IN2" | head -c 500))"
echo "  question: $(field_of "$IN2" 'events[0].text')"
echo "  pi_answer: $(head_for_id "$OUT" 4 | head -1)"
[ "$(field_of "$IN4" pickup)" = "picked up" ] && pass "pi_answer: picked up (the real ask.ts reported askAnswered)" || fail "pi_answer pickup (inner=$(echo "$IN4" | head -c 500))"
FINAL="$(node -e 'const d=JSON.parse(process.argv[1]);const e=(d.events||[]).find((x)=>x.type==="done");process.stdout.write(e?String(e.result):"")' "$IN4")"
echo "  finalText: $FINAL"
case "$FINAL" in *"$TOKEN"*) pass "child's final answer, returned on pi_answer, contains the token (only the answer had it)" ;; *) fail "final text lacks the token (inner=$(echo "$IN4" | head -c 600))" ;; esac
grep -F 'notifications/claude/channel' "$OUT" | grep -qF '"event":"done"' && fail "done was pushed although pi_answer held the wake" || pass "done went back on pi_answer, not pushed"
echo "  events.jsonl: $TYPES (consumed_seq=$CUR, done seq=$DONESEQ)"
[ "$TYPES" = "spawned,question,answered,done,parked" ] && pass "events.jsonl read back: spawned,question,answered,done (+parked at EOF)" || fail "events.jsonl ($TYPES)"
[ -n "$DONESEQ" ] && [ "$CUR" = "$DONESEQ" ] && pass "meta.json consumed_seq = done seq (consumed by pi_answer's response)" || fail "consumed_seq=$CUR done=$DONESEQ"
printf '%s' "$IN6" | grep -qF 'parent answered · by model' && pass "pi_read transcript (e2eask-g1) shows the tool result [parent answered · by model]" || fail "transcript lacks the answered tool result"
case "$(head_for_id "$OUT_END" 7)" in "stopped pi:e2eask (was"*"and forgot it: removed session file"*) pass "pi_stop {forget:true} removed the session" ;; *) fail "stop (inner=$(inner_for_id "$OUT_END" 7))" ;; esac
[ ! -e "$DIR" ] && pass "forget removed the child's event store" || fail "child dir still at $DIR"

finish
