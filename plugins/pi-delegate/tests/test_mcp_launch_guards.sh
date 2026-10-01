#!/usr/bin/env bash
# 0.11 S1 launch guards (stub pi):
#   A env scrub: CLAUDE_CODE_MESSAGING_* / CLAUDE_CODE_SESSION* / CLAUDECODE /
#     CLAUDE_PLUGIN_* / CLAUDE_CODE_OAUTH_TOKEN never reach a child; ANTHROPIC_*
#     is dropped unless the effective provider is anthropic
#     plus secret-shaped CLAUDE_CODE_* (refresh/gateway tokens) and remote
#     session plumbing; numeric knobs (CLAUDE_CODE_MAX_OUTPUT_TOKENS) pass
#   B anthropic pin keeps ANTHROPIC_* (pi reads the key itself), still scrubs the rest
#   B2 model-only pin "anthropic/<id>" keeps ANTHROPIC_* (provider from the prefix)
#   B3 model-only pin "mac-m3/<id>" drops ANTHROPIC_* even if pi's default is anthropic
#   B4 no pin: pi's project .pi/settings.json defaultProvider anthropic keeps ANTHROPIC_*
#   B5 bare model pattern (no provider, no prefix) is ambiguous: ANTHROPIC_* kept
#   B6 task verb with --model anthropic/<id> keeps ANTHROPIC_*
#   C version gate: pi < 0.99.0 refuses to launch (conversation + task), no rpc child
#   D version gate boundary: exactly 0.99.0 launches
#   E any toolCallId routes: "call_x|fc_y" and nested "a/1" both get answered
#   F traversal / absolute ids are refused with a visible failed{question_unroutable}
#   F2 blocking send + unroutable id returns at once (not after the ask budget),
#      the turn clock is paused (channel not killed), turn ends with done
#   G piSessionsDir honours PI_CODING_AGENT_DIR (read finds the session there)
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/mcp.sh"

FAKE_PKG="$(make_scratch)/pi-delegate-pkg"
mkdir -p "$FAKE_PKG" && echo '{"name":"@maheidem/pi-delegate"}' > "$FAKE_PKG/package.json"
export PI_DELEGATE_PI_PACKAGE="$FAKE_PKG"

pin() { # pin <proj> <provider> <model>
  mkdir -p "$1/.claude"
  printf -- '---\nprovider: %s\nmodel: %s\n---\n' "$2" "$3" > "$1/.claude/pi-delegate.local.md"
}
pin_model() { # pin_model <proj> <model>   (no provider line)
  mkdir -p "$1/.claude"
  printf -- '---\nmodel: %s\n---\n' "$2" > "$1/.claude/pi-delegate.local.md"
}
agent_dir() { # agent_dir <defaultProvider> -> a PI_CODING_AGENT_DIR with that global default
  local d; d="$(make_scratch)/agent"; mkdir -p "$d"
  printf '{"defaultProvider":"%s","defaultModel":"m"}' "$1" > "$d/settings.json"
  echo "$d"
}
# env_case <label> <proj> <agent-dir> -> args.json path (one blocking send under LEAK_ENV)
env_case() {
  local args out
  args="$(make_scratch)/args.json"; out="$(make_scratch)/out.jsonl"
  ( export "${LEAK_ENV[@]}"; CLAUDE_PROJECT_DIR="$2" PI_CODING_AGENT_DIR="$3" PI_STUB_ARGS_FILE="$args" feed "$out" \
    "$(call 2 pi_agent '{"name":"env'"$1"'","prompt":"go","run_in_background":false}')" "WAIT_FOR \"id\":2 10" )
  echo "$args"
}
SCRUB_RE='/^CLAUDE_CODE_MESSAGING_|^CLAUDE_CODE_SESSION|^CLAUDECODE$|^CLAUDE_PLUGIN_|^CLAUDE_CODE_OAUTH_TOKEN$|^CLAUDE_CODE_OAUTH_REFRESH_TOKEN$|^CLAUDE_CODE_GATEWAY_TOKEN$|^CLAUDE_CODE_REMOTE_/'

LEAK_ENV=(CLAUDE_CODE_MESSAGING_SOCKET=/tmp/leak CLAUDE_CODE_MESSAGING_TOKEN=leak CLAUDE_CODE_SESSION_ID=leak
  CLAUDE_CODE_SESSION_ACCESS_TOKEN=leak CLAUDECODE=1 CLAUDE_PLUGIN_ROOT=/leak CLAUDE_PLUGIN_DATA="$CLAUDE_PLUGIN_DATA"
  CLAUDE_CODE_OAUTH_TOKEN=leak CLAUDE_CODE_OAUTH_REFRESH_TOKEN=leak CLAUDE_CODE_GATEWAY_TOKEN=leak
  CLAUDE_CODE_REMOTE_SESSION_ID=leak CLAUDE_CODE_MAX_OUTPUT_TOKENS=1234
  ANTHROPIC_API_KEY=fake-not-a-key ANTHROPIC_BASE_URL=http://leak)

# ---------------------------------------------------------------------------
# A. non-anthropic pin
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  PROJ_A="$(make_scratch)"; pin "$PROJ_A" mac-m3 qwen3.8-flash@adaptive
  ARGS_A="$(make_scratch)/args.json"; OUT_A="$(make_scratch)/a.jsonl"
  ( export "${LEAK_ENV[@]}"; CLAUDE_PROJECT_DIR="$PROJ_A" PI_STUB_ARGS_FILE="$ARGS_A" feed "$OUT_A" \
    "$(call 2 pi_agent '{"name":"envx","prompt":"go","run_in_background":false}')" "WAIT_FOR \"id\":2 10" )
  [ "$(field_of "$(json_for_id "$OUT_A" 2)" status)" = "done" ] && pass "A: turn ran" || fail "A: turn (inner=$(inner_for_id "$OUT_A" 2))"
  assert_json "A: no CLAUDE_CODE_MESSAGING_* / SESSION* / CLAUDECODE / CLAUDE_PLUGIN_* / OAUTH / refresh+gateway tokens / REMOTE_* in child env" "$ARGS_A" \
    "!r.envKeys.some((k) => $SCRUB_RE.test(k))"
  assert_json "A: numeric knob CLAUDE_CODE_MAX_OUTPUT_TOKENS still passed" "$ARGS_A" 'r.envKeys.includes("CLAUDE_CODE_MAX_OUTPUT_TOKENS")'
  assert_json "A: ANTHROPIC_* dropped for a non-anthropic provider" "$ARGS_A" '!r.envKeys.some((k) => k.startsWith("ANTHROPIC_"))'
  assert_json "A: CLAUDE_PROJECT_DIR still passed" "$ARGS_A" 'r.envKeys.includes("CLAUDE_PROJECT_DIR")'
  assert_json "A: child-mode ask env still set" "$ARGS_A" 'r.env.PI_DELEGATE_CHILD === "1" && !!r.env.PI_DELEGATE_ASK_DIR'
} || true

# ---------------------------------------------------------------------------
# B. anthropic pin
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  PROJ_B="$(make_scratch)"; pin "$PROJ_B" anthropic claude-sonnet-4-5
  ARGS_B="$(make_scratch)/args.json"; OUT_B="$(make_scratch)/b.jsonl"
  ( export "${LEAK_ENV[@]}"; CLAUDE_PROJECT_DIR="$PROJ_B" PI_STUB_ARGS_FILE="$ARGS_B" feed "$OUT_B" \
    "$(call 2 pi_agent '{"name":"envy","prompt":"go","run_in_background":false}')" "WAIT_FOR \"id\":2 10" )
  assert_json "B: ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL kept for provider anthropic" "$ARGS_B" \
    'r.envKeys.includes("ANTHROPIC_API_KEY") && r.envKeys.includes("ANTHROPIC_BASE_URL")'
  assert_json "B: Claude session/messaging/credential vars still scrubbed" "$ARGS_B" \
    "!r.envKeys.some((k) => $SCRUB_RE.test(k))"
} || true

# ---------------------------------------------------------------------------
# B2-B6. effective provider from the model string / pi's settings
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  AG_MAC="$(agent_dir mac-m3)"; AG_ANT="$(agent_dir anthropic)"
  P2="$(make_scratch)"; pin_model "$P2" anthropic/claude-sonnet-4-5
  A2="$(env_case b2 "$P2" "$AG_MAC")"
  assert_json "B2: model-only pin anthropic/<id> keeps ANTHROPIC_API_KEY" "$A2" 'r.envKeys.includes("ANTHROPIC_API_KEY")'
  assert_json "B2: --model anthropic/<id> passed, no --provider" "$A2" \
    'r.argv.join(" ").includes("--model anthropic/claude-sonnet-4-5") && !r.argv.includes("--provider")'
  assert_json "B2: credential vars still scrubbed" "$A2" "!r.envKeys.some((k) => $SCRUB_RE.test(k))"
  P3="$(make_scratch)"; pin_model "$P3" mac-m3/qwen3.8-flash@adaptive
  A3="$(env_case b3 "$P3" "$AG_ANT")"
  assert_json "B3: model-only pin mac-m3/<id> drops ANTHROPIC_* despite a global anthropic default" "$A3" '!r.envKeys.some((k) => k.startsWith("ANTHROPIC_"))'
  P4="$(make_scratch)"; mkdir -p "$P4/.pi"; printf '{"defaultProvider":"anthropic"}' > "$P4/.pi/settings.json"
  A4="$(env_case b4 "$P4" "$AG_MAC")"
  assert_json "B4: project .pi/settings.json defaultProvider anthropic keeps ANTHROPIC_API_KEY" "$A4" 'r.envKeys.includes("ANTHROPIC_API_KEY")'
  P4B="$(make_scratch)"
  A4B="$(env_case b4b "$P4B" "$AG_MAC")"
  assert_json "B4: no pin, mac-m3 default drops ANTHROPIC_*" "$A4B" '!r.envKeys.some((k) => k.startsWith("ANTHROPIC_"))'
  P5="$(make_scratch)"; pin_model "$P5" sonnet
  A5="$(env_case b5 "$P5" "$AG_MAC")"
  assert_json "B5: bare pattern is ambiguous, ANTHROPIC_API_KEY kept" "$A5" 'r.envKeys.includes("ANTHROPIC_API_KEY")'
  A6="$(make_scratch)/args.json"
  ( export "${LEAK_ENV[@]}"; CLAUDE_PROJECT_DIR="$(make_scratch)" PI_CODING_AGENT_DIR="$AG_MAC" PI_STUB_ARGS_FILE="$A6" \
    timeout 30 node "$COMPANION" task "hi" --model anthropic/claude-sonnet-4-5 --json > /dev/null 2>&1 )
  assert_json "B6: task --model anthropic/<id> keeps ANTHROPIC_API_KEY" "$A6" 'r.envKeys.includes("ANTHROPIC_API_KEY") && r.argv.includes("anthropic/claude-sonnet-4-5")'
  assert_json "B6: task child still scrubbed of credential vars" "$A6" "!r.envKeys.some((k) => $SCRUB_RE.test(k))"
} || true

# ---------------------------------------------------------------------------
# C. pi too old
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  PROJ_C="$(make_scratch)"; PIDS_C="$(make_scratch)/pids"; : > "$PIDS_C"; OUT_C="$(make_scratch)/c.jsonl"
  CLAUDE_PROJECT_DIR="$PROJ_C" PI_STUB_VERSION=0.98.9 PI_STUB_PID_FILE="$PIDS_C" feed "$OUT_C" \
    "$(call 2 pi_agent '{"name":"old","prompt":"go","run_in_background":false}')" "WAIT_FOR \"id\":2 10" \
    "$(call 3 pi_agent '{"name":"old2","prompt":"go"}')" "WAIT_FOR \"id\":3 10"
  for id in 2 3; do
    case "$(field_of "$(json_for_id "$OUT_C" $id)" errorMessage)" in
      *"0.98.9"*"0.99.0"*) pass "C: call $id refused with the version gate" ;;
      *) fail "C: call $id version gate (inner=$(inner_for_id "$OUT_C" $id))" ;;
    esac
  done
  [ ! -s "$PIDS_C" ] && pass "C: no rpc child was started" || fail "C: rpc child started: $(cat "$PIDS_C")"
  OUT_CT="$(make_scratch)/ct.json"
  CLAUDE_PROJECT_DIR="$PROJ_C" PI_STUB_VERSION=0.98.9 node "$COMPANION" task "hi" --json > "$OUT_CT" 2>/dev/null
  assert_json "C: task verb refused with the version gate" "$OUT_CT" 'r.ok === false && /0\.99\.0/.test(r.errorMessage)'
} || true

# ---------------------------------------------------------------------------
# D. exactly the minimum
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  OUT_D="$(make_scratch)/d.jsonl"
  CLAUDE_PROJECT_DIR="$(make_scratch)" PI_STUB_VERSION=0.99.0 feed "$OUT_D" \
    "$(call 2 pi_agent '{"name":"minv","prompt":"go","run_in_background":false}')" "WAIT_FOR \"id\":2 10"
  case "$(field_of "$(json_for_id "$OUT_D" 2)" text)" in *reply-1*) true ;; *) false ;; esac && pass "D: pi 0.99.0 launches" || fail "D: (inner=$(inner_for_id "$OUT_D" 2))"
} || true

# ---------------------------------------------------------------------------
# E. codex-style and nested toolCallIds
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  ARGS_E="$(make_scratch)/args.json"; OUT_E="$(make_scratch)/e.jsonl"
  A1="$(json_obj name ids answer ANS-PIPE toolCallId 'call_x|fc_y')"
  A2="$(json_obj name ids answer ANS-NESTED toolCallId 'a/1')"
  CLAUDE_PROJECT_DIR="$(make_scratch)" PI_STUB_ASK_IDS='call_x|fc_y,a/1' PI_STUB_ARGS_FILE="$ARGS_E" feed "$OUT_E" \
    "$(call 2 pi_agent '{"name":"ids","prompt":"go","run_in_background":false}')" "WAIT_FOR a/1 10" "SLEEP 0.3" \
    "$(call 3 pi_list_agents '{"name":"ids"}')" \
    "$(call 4 pi_answer "$A1")" "WAIT_FOR \"id\":4 8" "$(call 5 pi_answer "$A2")" "WAIT_FOR \"id\":5 12"
  IN_E3="$(json_for_id "$OUT_E" 3)"
  node -e 'const d=JSON.parse(process.argv[1]);const ids=(d.pendingAsks||[]).map((a)=>a.toolCallId).sort();process.exit(JSON.stringify(ids)===JSON.stringify(["a/1","call_x|fc_y"])?0:1)' "$IN_E3" \
    && pass "E: both ids routed as pending questions" || fail "E: pending (inner=$IN_E3)"
  [ "$(field_of "$(json_for_id "$OUT_E" 4)" pickup)" = "picked up" ] && pass "E: pi_answer for call_x|fc_y picked up" || fail "E: answer pipe (inner=$(inner_for_id "$OUT_E" 4))"
  [ "$(field_of "$(json_for_id "$OUT_E" 5)" pickup)" = "picked up" ] && pass "E: pi_answer for nested a/1 picked up" || fail "E: answer nested (inner=$(inner_for_id "$OUT_E" 5))"
  node -e '
    const d = JSON.parse(process.argv[1]);
    const done = (d.events || []).find((e) => e.type === "done");
    process.exit(done && done.result === "got:ANS-PIPE@model|got:ANS-NESTED@model" ? 0 : 1);
  ' "$(json_for_id "$OUT_E" 5)" && pass "E: child read both answers from <askDir>/<id>.json" || fail "E: done (inner=$(inner_for_id "$OUT_E" 5))"
  grep -F 'notifications/claude/channel' "$OUT_E" | grep -F '"event":"question"' | grep -qF 'question a/1?' && pass "E: nested id pushed as a question event" || fail "E: nested id channel event"
} || true

# ---------------------------------------------------------------------------
# F. unroutable ids are visible, never silent, and write nothing
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  PROJ_F="$(make_scratch)"; ARGS_F="$(make_scratch)/args.json"; OUT_F="$(make_scratch)/f.jsonl"
  CLAUDE_PROJECT_DIR="$PROJ_F" PI_STUB_ASK_IDS='../evil,/abs/id' PI_STUB_ARGS_FILE="$ARGS_F" PI_STUB_ASK_WAIT_MS=1500 feed "$OUT_F" \
    "$(call 2 pi_agent '{"name":"badid","prompt":"go","run_in_background":false}')" "WAIT_FOR \"id\":2 8" "SLEEP 0.3" \
    "$(call 3 pi_wait '{"name":"badid","timeout_ms":1000}')" "WAIT_FOR \"id\":3 8" \
    "$(call 4 pi_answer '{"name":"badid","answer":"x"}')" "WAIT_FOR \"id\":4 5" "SLEEP 2"
  node -e '
    const ev = [1, 2].flatMap((i) => { try { return JSON.parse(process.argv[i]).events || []; } catch { return []; } });
    const f = ev.filter((e) => e.type === "failed" && e.reason === "question_unroutable");
    process.exit(f.length === 2 && f.every((e) => typeof e.text === "string" && e.text.length) ? 0 : 1);
  ' "$(json_for_id "$OUT_F" 2)" "$(json_for_id "$OUT_F" 3)" && pass "F: both bad ids surfaced as failed{question_unroutable} events" || fail "F: events ($(json_for_id "$OUT_F" 2) / $(json_for_id "$OUT_F" 3))"
  [ "$(grep -F 'notifications/claude/channel' "$OUT_F" | grep -F '"event":"failed"' | grep -cF '(question_unroutable) · turn still running')" -eq 2 ] && pass "F: pushed as channel notifications" || fail "F: channel notifications"
  case "$(field_of "$(json_for_id "$OUT_F" 4)" errorMessage)" in "no pending question on pi:badid"*) pass "F: nothing answerable was registered" ;; *) fail "F: pi_answer (inner=$(inner_for_id "$OUT_F" 4))" ;; esac
  ASKDIR_F="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).env.PI_DELEGATE_ASK_DIR)' "$ARGS_F")"
  [ ! -e "$(dirname "$ASKDIR_F")/evil.json" ] && [ ! -e /abs/id.json ] && pass "F: no file written outside the ask dir" || fail "F: traversal wrote a file"
} || true

# ---------------------------------------------------------------------------
# F2. blocking send + unroutable id: returns now, turn keeps running unkilled
# ---------------------------------------------------------------------------
{
  use_stub pi-rpc-lab
  OUT_F2="$(make_scratch)/f2.jsonl"; PROJ_F2="$(make_scratch)"
  # ask wait 6s > turn timeout 4s: an unpaused clock would kill the channel.
  CLAUDE_PROJECT_DIR="$PROJ_F2" PI_STUB_ASK_IDS='../evil' PI_STUB_ASK_WAIT_MS=6000 feed "$OUT_F2" \
    "$(call 2 pi_agent '{"name":"badsync","prompt":"go","run_in_background":false,"turn_timeout_ms":4000}')" "WAIT_FOR \"id\":2 3" \
    "$(call 3 pi_list_agents '{"name":"badsync"}')" "WAIT_FOR \"id\":3 3" \
    "$(call 4 pi_wait '{"name":"badsync","timeout_ms":15000}')" "WAIT_FOR \"id\":4 15" \
    "$(call 5 pi_wait '{"name":"badsync","timeout_ms":15000}')" "WAIT_FOR \"id\":5 15"
  node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    const i2 = ls.findIndex((o) => o.id === 2 && o.result), i3 = ls.findIndex((o) => o.id === 3 && o.result);
    process.exit(i2 >= 0 && i3 > i2 ? 0 : 1);
  ' "$OUT_F2" && pass "F2: blocking send returned before the next call (not after the 6s ask wait)" || fail "F2: send did not return early"
  IN_F22="$(json_for_id "$OUT_F2" 2)"
  node -e '
    const d = JSON.parse(process.argv[1]);
    const u = (d.events || [])[0] || {};
    process.exit(d.ok === true && d.status === "running" && u.reason === "question_unroutable" && /evil/.test(u.badToolCallId) && u.text ? 0 : 1);
  ' "$IN_F22" && pass "F2: result carries the question_unroutable event + the question" || fail "F2: result (inner=$IN_F22)"
  # The blocking send carried the failed event inline, so it was consumed
  # there: the waits see only the done. events.jsonl has both.
  node -e '
    const ev = [3, 4, 5].flatMap((id) => { try { return JSON.parse(process.argv[id - 2]).events || []; } catch { return []; } });
    const f = ev.find((e) => e.type === "failed");
    const t = ev.find((e) => e.type === "done");
    process.exit(!f && t && t.ok === true && t.result === "got:timeout" ? 0 : 1);
  ' "$(json_for_id "$OUT_F2" 3)" "$(json_for_id "$OUT_F2" 4)" "$(json_for_id "$OUT_F2" 5)" \
    && pass "F2: done ok returned (clock paused, channel not killed); failed not repeated" \
    || fail "F2: events (4=$(inner_for_id "$OUT_F2" 4) 5=$(inner_for_id "$OUT_F2" 5))"
  DIR_F2="$(child_dir "$PROJ_F2" badsync)"
  node -e '
    const ev = require("fs").readFileSync(process.argv[1] + "/events.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const f = ev.find((e) => e.type === "failed");
    process.exit(f && f.data.reason === "question_unroutable" && f.data.terminal === false && ev.some((e) => e.type === "done") ? 0 : 1);
  ' "$DIR_F2" && pass "F2: events.jsonl holds failed{question_unroutable, terminal:false} then done" || fail "F2: events.jsonl ($(event_types "$DIR_F2"))"
  ! grep -q "did not settle" "$OUT_F2" && pass "F2: no settle-timeout kill" || fail "F2: channel was killed"
} || true

# ---------------------------------------------------------------------------
# G. PI_CODING_AGENT_DIR is honoured for session lookup
# ---------------------------------------------------------------------------
{
  PROJ_G="$(make_scratch)"; AGENT_G="$(node -p 'require("path").resolve(process.argv[1])' "$(make_scratch)/agent")"
  SLUG_G="$(pi_session_slug "$PROJ_G")"
  mkdir -p "$AGENT_G/sessions/$SLUG_G"
  cp "$TESTS_DIR/fixtures/session_read_sample.jsonl" "$AGENT_G/sessions/$SLUG_G/2026-09-30T00-00-00_gread.jsonl"
  OUT_G="$(make_scratch)/g.json"
  CLAUDE_PROJECT_DIR="$PROJ_G" PI_CODING_AGENT_DIR="$AGENT_G" node "$COMPANION" conversation read gread --json > "$OUT_G"
  assert_json "G: read found the session under \$PI_CODING_AGENT_DIR/sessions" "$OUT_G" \
    "r.ok === true && JSON.parse(r.summary).sessionFile.startsWith(\"$AGENT_G/sessions/\")"
  OUT_G2="$(make_scratch)/g2.json"
  CLAUDE_PROJECT_DIR="$PROJ_G" PI_CODING_AGENT_DIR="$AGENT_G" node "$COMPANION" conversation end gread --json > "$OUT_G2"
  [ ! -e "$AGENT_G/sessions/$SLUG_G/2026-09-30T00-00-00_gread.jsonl" ] && pass "G: end removed the session from the same dir" || fail "G: end ($(cat "$OUT_G2"))"
} || true

finish
