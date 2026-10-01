#!/usr/bin/env bash
# 0.11 S3 pi_agent (stub pi):
#   A tools/list: provider/model in pi_agent's schema without a pin, gone with one
#   B pin: a mismatched provider/model is refused before any child starts
#     (pi_task is renamed in 0.11); the pinned value itself is accepted
#   C fallback spawn blocks until done: resolver ("Pi:Alpha" -> alpha),
#     --session-id alpha-g1-teststore, lifetime lock stamped {serverPid,serverStart}
#     while the child lives, meta.json launch record + read-back fields,
#     spawned/done events, compact headline
#   D tools: ask_parent appended to -t, one -xt list with handoff; excluding
#     ask_parent turns ask off (warning, no child-mode env)
#   E handshake: get_state model mismatch / no model / an id pi only knows as
#     a "custom model id" (absent from get_available_models) -> synchronous error,
#     nothing prompted, child killed, lock released, record failed
#   F a running name is refused (naming the tools to use); channel mode returns
#     at once with "Do not poll."
#   G takeover: an idle name becomes gen 2 (--session-id alpha-g2-teststore), gen 1 is
#     archived in meta.gens, a stopped{takeover} event is logged
#   H cap: all busy -> error listing them; an idle one is parked to make room
#   I another live server's lifetime lock -> owner error, no child
#   J name validation and aliases (task_id "pi:Beta")
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/mcp.sh"

FAKE_PKG="$(make_scratch)/pi-delegate-pkg"
mkdir -p "$FAKE_PKG" && echo '{"name":"@maheidem/pi-delegate"}' > "$FAKE_PKG/package.json"
export PI_DELEGATE_PI_PACKAGE="$FAKE_PKG"
use_stub pi-rpc-lab

pin() { # pin <proj> <provider> <model>
  mkdir -p "$1/.claude"
  printf -- '---\nprovider: %s\nmodel: %s\n---\n' "$2" "$3" > "$1/.claude/pi-delegate.local.md"
}
# A pi_agent result is "<headline>\n<json>": the JSON is the last line.
agent_json() { inner_for_id "$1" "$2" | tail -n 1; }
agent_head() { inner_for_id "$1" "$2" | sed '$d'; }
meta_eval() { # meta_eval <child-dir> <js expr over m>
  node -e 'const m = JSON.parse(require("fs").readFileSync(process.argv[1] + "/meta.json", "utf8")); process.stdout.write(String(eval(process.argv[2])))' "$1" "$2" 2>/dev/null
}
lock_of() { echo "${TMPDIR:-/tmp}/pi-delegate-locks/$(pi_session_slug "$1")__$2.lock"; }
tools_list() { printf '{"jsonrpc":"2.0","id":%s,"method":"tools/list","params":{}}' "$1"; }
schema_props() { # schema_props <out> <id> -> comma list of pi_agent properties
  node -e '
    const fs = require("fs");
    for (const l of fs.readFileSync(process.argv[1], "utf8").split("\n")) {
      try { const o = JSON.parse(l); if (o.id === Number(process.argv[2])) {
        const t = o.result.tools.find((x) => x.name === "pi_agent");
        process.stdout.write(Object.keys(t.inputSchema.properties).join(","));
      } } catch {}
    }' "$1" "$2"
}

# ---------------------------------------------------------------------------
# A. schema
# ---------------------------------------------------------------------------
{
  PA="$(make_scratch)"; OUT="$(make_scratch)/a.jsonl"
  CLAUDE_PROJECT_DIR="$PA" feed "$OUT" "$(tools_list 2)" "WAIT_FOR \"id\":2 5"
  case ",$(schema_props "$OUT" 2)," in *,provider,*model,*) pass "A: no pin -> provider/model in the schema" ;; *) fail "A: no pin schema ($(schema_props "$OUT" 2))" ;; esac
  pin "$PA" mac-m3 'qwen3.8-flash@adaptive'
  OUT="$(make_scratch)/a2.jsonl"
  CLAUDE_PROJECT_DIR="$PA" feed "$OUT" "$(tools_list 2)" "WAIT_FOR \"id\":2 5"
  P="$(schema_props "$OUT" 2)"
  case ",$P," in *,provider,*|*,model,*) fail "A: pin -> schema still has provider/model ($P)" ;; *,prompt,*) pass "A: pin -> provider/model hidden, prompt kept ($P)" ;; *) fail "A: schema ($P)" ;; esac
} || true

# ---------------------------------------------------------------------------
# B. pin rejection
# ---------------------------------------------------------------------------
{
  PB="$(make_scratch)"; pin "$PB" mac-m3 'qwen3.8-flash@adaptive'
  PIDS="$(make_scratch)/pids"; : > "$PIDS"; OUT="$(make_scratch)/b.jsonl"
  CLAUDE_PROJECT_DIR="$PB" PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"b1","prompt":"go","model":"glm-5.3"}')" "WAIT_FOR \"id\":2 10" \
    "$(call 3 pi_task '{"text":"go","provider":"zai"}')" "WAIT_FOR \"id\":3 10"
  E2="$(field_of "$(agent_json "$OUT" 2)" errorMessage)"
  case "$E2" in "model is pinned to mac-m3/qwen3.8-flash@adaptive for this project; omit provider/model"*) pass "B: pi_agent mismatched model refused ($E2)" ;; *) fail "B: pi_agent pin ($E2)" ;; esac
  E3="$(field_of "$(agent_json "$OUT" 3)" errorMessage)"
  case "$E3" in "renamed, use pi_agent {prompt, run_in_background:false}") pass "B: pi_task is renamed (S4)" ;; *) fail "B: pi_task ($E3)" ;; esac
  [ ! -s "$PIDS" ] && pass "B: no pi child started" || fail "B: child started: $(cat "$PIDS")"
  ARGS="$(make_scratch)/args.json"; OUT="$(make_scratch)/b2.jsonl"
  CLAUDE_PROJECT_DIR="$PB" PI_STUB_ARGS_FILE="$ARGS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"b2","prompt":"go","provider":"mac-m3","model":"qwen3.8-flash@adaptive","run_in_background":false}')" "WAIT_FOR \"id\":2 15"
  [ "$(field_of "$(agent_json "$OUT" 2)" status)" = "done" ] && pass "B: the pinned value itself is accepted" || fail "B: pinned value (inner=$(inner_for_id "$OUT" 2))"
  assert_json "B: child launched with the pin" "$ARGS" 'r.argv.join(" ").includes("--provider mac-m3 --model qwen3.8-flash@adaptive")'
} || true

# ---------------------------------------------------------------------------
# C. fallback spawn, lifetime lock, meta
# ---------------------------------------------------------------------------
{
  PC="$(make_scratch)"; pin "$PC" mac-m3 'qwen3.8-flash@adaptive'
  ARGS="$(make_scratch)/args.json"; OUT="$(make_scratch)/c.jsonl"; LOCK="$(lock_of "$PC" alpha)"; LSNAP="$(make_scratch)/lock.txt"
  CLAUDE_PROJECT_DIR="$PC" PI_STUB_ARGS_FILE="$ARGS" PI_STUB_SETTLE_MS=1500 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"Pi:Alpha","prompt":"go","description":"first agent"}')" \
    "SLEEP 0.8" "SH cat '$LOCK' > '$LSNAP' 2>/dev/null" \
    "WAIT_FOR \"id\":2 15" "SH sleep 0.3; cat '$LOCK' > '$LSNAP.after' 2>/dev/null"
  J="$(agent_json "$OUT" 2)"; H="$(agent_head "$OUT" 2)"
  [ "$(field_of "$J" name)" = "alpha" ] && [ "$(field_of "$J" gen)" = "1" ] && [ "$(field_of "$J" status)" = "done" ] \
    && pass "C: Pi:Alpha resolved to alpha, gen 1, blocked until done" || fail "C: result ($J)"
  case "$H" in "pi:alpha (gen 1, model mac-m3/qwen3.8-flash@adaptive, ask on, wake: fallback)"*"DONE turn 1 ok"*) pass "C: headline + compact DONE" ;; *) fail "C: headline ($H)" ;; esac
  assert_json "C: --session-id alpha-g1-teststore, lean flags, -xt handoff" "$ARGS" \
    'r.argv.join(" ").includes("--session-id alpha-g1-teststore") && r.argv.includes("--no-extensions") && r.argv.join(" ").includes("--exclude-tools handoff") && !r.argv.includes("--tools")'
  node -e 'const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.exit(s.serverPid > 0 && /\d{2}:\d{2}:\d{2}/.test(s.serverStart) && s.name === "alpha" && s.gen === 1 ? 0 : 1)' "$LSNAP" \
    && pass "C: lifetime lock held mid-turn, stamped {serverPid, serverStart, name, gen}" || fail "C: lock mid-turn ($(cat "$LSNAP" 2>/dev/null))"
  node -e 'const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.exit(s.gen === 1 ? 0 : 1)' "$LSNAP.after" \
    && pass "C: lock still held after the turn ended (process lifetime, not per turn)" || fail "C: lock after turn ($(cat "$LSNAP.after" 2>/dev/null))"
  [ ! -e "$LOCK" ] && pass "C: lock released when the server shut the child down" || fail "C: lock left behind"
  CD="$(child_dir "$PC" alpha)"
  [ "$(meta_eval "$CD" 'm.launch.sessionId + "|" + m.launch.provider + "|" + m.launch.model + "|" + m.gen + "|" + m.description')" = "alpha-g1-teststore|mac-m3|qwen3.8-flash@adaptive|1|first agent" ] \
    && pass "C: meta.json launch record" || fail "C: meta ($(cat "$CD/meta.json"))"
  [ "$(meta_eval "$CD" 'm.model + "|" + m.askEnabled + "|" + (m.pgid === m.pid) + "|" + !!m.procStart')" = "qwen3.8-flash@adaptive|true|true|true" ] \
    && pass "C: meta records resolved model, ask, pgid, procStart" || fail "C: meta fields"
  case "$(event_types "$CD")" in spawned,done,*) pass "C: events spawned,done ($(event_types "$CD"))" ;; *) fail "C: events ($(event_types "$CD"))" ;; esac
} || true

# ---------------------------------------------------------------------------
# D. tools / exclude_tools vs ask_parent
# ---------------------------------------------------------------------------
{
  PD="$(make_scratch)"
  ARGS="$(make_scratch)/args.json"; OUT="$(make_scratch)/d.jsonl"
  CLAUDE_PROJECT_DIR="$PD" PI_STUB_ARGS_FILE="$ARGS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"tl","prompt":"go","tools":["read","bash"],"exclude_tools":["write"]}')" "WAIT_FOR \"id\":2 15"
  assert_json "D: -t read,bash,ask_parent" "$ARGS" 'r.argv[r.argv.indexOf("--tools") + 1] === "read,bash,ask_parent"'
  assert_json "D: one -xt list write,handoff" "$ARGS" 'r.argv.filter((a) => a === "--exclude-tools").length === 1 && r.argv[r.argv.indexOf("--exclude-tools") + 1] === "write,handoff"'
  [ "$(field_of "$(agent_json "$OUT" 2)" ask)" = "true" ] && pass "D: ask on" || fail "D: ask ($(agent_json "$OUT" 2))"
  ARGS="$(make_scratch)/args.json"; OUT="$(make_scratch)/d2.jsonl"
  CLAUDE_PROJECT_DIR="$PD" PI_STUB_ARGS_FILE="$ARGS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"nx","prompt":"go","tools":["read"],"exclude_tools":["ask_parent"]}')" "WAIT_FOR \"id\":2 15"
  J="$(agent_json "$OUT" 2)"
  [ "$(field_of "$J" ask)" = "false" ] && pass "D: exclude ask_parent -> ask off" || fail "D: ask off ($J)"
  case "$(field_of "$J" warnings)" in *"ask is off"*) pass "D: warning says so" ;; *) fail "D: warning ($(field_of "$J" warnings))" ;; esac
  assert_json "D: no ask_parent added, no child-mode env, no handoff exclusion" "$ARGS" \
    'r.argv[r.argv.indexOf("--tools") + 1] === "read" && r.env.PI_DELEGATE_CHILD === null && r.argv[r.argv.indexOf("--exclude-tools") + 1] === "ask_parent"'
  [ "$(field_of "$(agent_json "$OUT" 2)" status)" = "done" ] && pass "D: ask-off child still runs" || fail "D: status"
} || true

# ---------------------------------------------------------------------------
# E. handshake
# ---------------------------------------------------------------------------
{
  PE="$(make_scratch)"; pin "$PE" mac-m3 'qwen3.8-flash@adaptive'
  PIDS="$(make_scratch)/pids"; : > "$PIDS"; OUT="$(make_scratch)/e.jsonl"; LOCK="$(lock_of "$PE" hs)"; LS="$(make_scratch)/lockstate"
  CLAUDE_PROJECT_DIR="$PE" PI_STUB_MODEL=other/fallback-model PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"hs","prompt":"go"}')" "WAIT_FOR \"id\":2 15" \
    "SH sleep 0.5; [ -e '$LOCK' ] && echo held > '$LS' || echo free > '$LS'"
  E="$(field_of "$(agent_json "$OUT" 2)" errorMessage)"
  case "$E" in *"did not start on the expected model: pi is running other/fallback-model, not provider mac-m3"*) pass "E: model mismatch is a synchronous error" ;; *) fail "E: mismatch ($E)" ;; esac
  [ "$(cat "$LS")" = free ] && pass "E: lock released" || fail "E: lock $(cat "$LS")"
  CD="$(child_dir "$PE" hs)"
  [ "$(meta_of "$CD" state)" = failed ] && pass "E: record failed" || fail "E: state $(meta_of "$CD" state)"
  case "$(event_types "$CD")" in spawn_failed) pass "E: only spawn_failed logged (no spawned, nothing prompted)" ;; *) fail "E: events $(event_types "$CD")" ;; esac
  P1="$(head -1 "$PIDS")"; sleep 0.5
  kill -0 "$P1" 2>/dev/null && fail "E: child $P1 still alive" || pass "E: child killed"
  OUT="$(make_scratch)/e2.jsonl"
  CLAUDE_PROJECT_DIR="$PE" PI_STUB_MODEL=none feed "$OUT" "$(call 2 pi_agent '{"name":"hs2","prompt":"go"}')" "WAIT_FOR \"id\":2 15"
  case "$(field_of "$(agent_json "$OUT" 2)" errorMessage)" in *"no model"*) pass "E: get_state without a model refused" ;; *) fail "E: no model ($(agent_json "$OUT" 2))" ;; esac
  PIDS="$(make_scratch)/pids"; : > "$PIDS"; OUT="$(make_scratch)/e3.jsonl"
  CLAUDE_PROJECT_DIR="$PE" PI_STUB_UNKNOWN_MODEL=1 PI_STUB_PID_FILE="$PIDS" feed "$OUT" "$(call 2 pi_agent '{"name":"hs3","prompt":"go"}')" "WAIT_FOR \"id\":2 15"
  case "$(field_of "$(agent_json "$OUT" 2)" errorMessage)" in *"mac-m3/qwen3.8-flash@adaptive is not a model pi has configured"*) pass "E: unknown id (pi's custom-model fallback) refused" ;; *) fail "E: unknown id ($(agent_json "$OUT" 2))" ;; esac
  case "$(event_types "$(child_dir "$PE" hs3)")" in spawn_failed) pass "E: unknown id: nothing prompted" ;; *) fail "E: unknown id events $(event_types "$(child_dir "$PE" hs3)")" ;; esac
} || true

# ---------------------------------------------------------------------------
# F/G. refusal while running (channel mode returns at once), takeover
# ---------------------------------------------------------------------------
{
  PF="$(make_scratch)"
  ARGS="$(make_scratch)/args.json"; OUT="$(make_scratch)/f.jsonl"
  CLAUDE_PROJECT_DIR="$PF" PI_DELEGATE_WAKE=channel PI_STUB_SETTLE_MS=2500 PI_STUB_ARGS_FILE="$ARGS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"alpha","prompt":"one"}')" "WAIT_FOR \"id\":2 10" \
    "$(call 3 pi_agent '{"name":"alpha","prompt":"two"}')" "WAIT_FOR \"id\":3 10" \
    "WAIT_FOR \"event\":\"done\" 10" \
    "$(call 4 pi_agent '{"name":"ALPHA","prompt":"three","run_in_background":false}')" "WAIT_FOR \"id\":4 15"
  H="$(agent_head "$OUT" 2)"
  case "$H" in "spawned pi:alpha (gen 1, model stub/stub-model, ask on, wake: channel). You will be notified when it finishes or asks something. Do not poll.") pass "F: channel spawn returns at once" ;; *) fail "F: headline ($H)" ;; esac
  E="$(field_of "$(agent_json "$OUT" 3)" errorMessage)"
  case "$E" in 'pi:alpha is running (turn 1). Talk to it with pi_send_message {to:"alpha"}, or pi_stop it first.') pass "F: running name refused, names the tools" ;; *) fail "F: refusal ($E)" ;; esac
  J="$(agent_json "$OUT" 4)"
  [ "$(field_of "$J" gen)" = "2" ] && [ "$(field_of "$J" sessionId)" = "alpha-g2-teststore" ] && [ "$(field_of "$J" status)" = "done" ] \
    && pass "G: idle alpha taken over as gen 2" || fail "G: takeover ($J)"
  assert_json "G: gen 2 launched with --session-id alpha-g2-teststore" "$ARGS" 'r.argv.join(" ").includes("--session-id alpha-g2-teststore")'
  CD="$(child_dir "$PF" alpha)"
  [ "$(meta_eval "$CD" 'm.gens.map((g) => g.gen + ":" + g.sessionId).join(",") + "|" + m.gen + "|" + m.launch.sessionId')" = "1:alpha-g1-teststore|2|alpha-g2-teststore" ] \
    && pass "G: gen 1 archived in meta.gens" || fail "G: gens ($(meta_of "$CD" gens))"
  case "$(event_types "$CD")" in spawned,done,stopped,spawned,done*) pass "G: stopped{takeover} between the generations" ;; *) fail "G: events $(event_types "$CD")" ;; esac
  [ -f "$CD/results/1-1.md" ] && [ -f "$CD/results/2-1.md" ] && pass "G: results per generation (1-1, 2-1)" || fail "G: results $(ls "$CD/results")"
} || true

# ---------------------------------------------------------------------------
# H. cap
# ---------------------------------------------------------------------------
{
  PH="$(make_scratch)"; PIDS="$(make_scratch)/pids"; : > "$PIDS"; OUT="$(make_scratch)/h.jsonl"
  CLAUDE_PROJECT_DIR="$PH" PI_DELEGATE_WAKE=channel PI_MCP_REGISTRY_CAP=1 PI_STUB_SETTLE_MS=2000 PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"busy","prompt":"one"}')" "WAIT_FOR \"id\":2 10" \
    "$(call 3 pi_agent '{"name":"other","prompt":"two"}')" "WAIT_FOR \"id\":3 10" \
    "WAIT_FOR \"event\":\"done\" 10" \
    "$(call 4 pi_agent '{"name":"other","prompt":"three"}')" "WAIT_FOR \"id\":4 10" "SLEEP 0.5"
  E="$(field_of "$(agent_json "$OUT" 3)" errorMessage)"
  case "$E" in "1 pi children are live (cap 1) and all are busy: busy (running)"*) pass "H: all busy -> error listing them" ;; *) fail "H: busy cap ($E)" ;; esac
  [ "$(field_of "$(agent_json "$OUT" 4)" ok)" = "true" ] && pass "H: idle child parked to make room" || fail "H: park ($(agent_json "$OUT" 4))"
  [ "$(meta_of "$(child_dir "$PH" busy)" state)" = parked ] && pass "H: busy -> parked" || fail "H: state $(meta_of "$(child_dir "$PH" busy)" state)"
  [ "$(wc -l < "$PIDS" | tr -d ' ')" = 2 ] && pass "H: exactly two children ever started" || fail "H: pids $(cat "$PIDS")"
} || true

# ---------------------------------------------------------------------------
# I. lock held by another live server
# ---------------------------------------------------------------------------
{
  PI_="$(make_scratch)"; PIDS="$(make_scratch)/pids"; : > "$PIDS"; OUT="$(make_scratch)/i.jsonl"
  sleep 60 & HOLDER=$!
  LOCK="$(lock_of "$PI_" owned)"; mkdir -p "$(dirname "$LOCK")"
  printf '{"serverPid":%s,"serverStart":"%s","name":"owned","gen":1}' "$HOLDER" "$(LC_ALL=C ps -o lstart= -p "$HOLDER" | sed 's/^ *//;s/ *$//')" > "$LOCK"
  CLAUDE_PROJECT_DIR="$PI_" PI_STUB_PID_FILE="$PIDS" feed "$OUT" "$(call 2 pi_agent '{"name":"owned","prompt":"go"}')" "WAIT_FOR \"id\":2 10"
  E="$(field_of "$(agent_json "$OUT" 2)" errorMessage)"
  case "$E" in "pi:owned is owned by another Claude session (server pid $HOLDER, since "*) pass "I: owner error ($E)" ;; *) fail "I: owner ($E)" ;; esac
  [ ! -s "$PIDS" ] && pass "I: no child started" || fail "I: child started"
  [ -e "$LOCK" ] && pass "I: the other server's lock left alone" || fail "I: lock removed"
  kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
  OUT="$(make_scratch)/i2.jsonl"
  CLAUDE_PROJECT_DIR="$PI_" feed "$OUT" "$(call 2 pi_agent '{"name":"owned","prompt":"go"}')" "WAIT_FOR \"id\":2 10"
  [ "$(field_of "$(agent_json "$OUT" 2)" status)" = "done" ] && pass "I: dead owner's lock reclaimed" || fail "I: reclaim ($(agent_json "$OUT" 2))"
  rm -f "$LOCK"
} || true

# ---------------------------------------------------------------------------
# J. names
# ---------------------------------------------------------------------------
{
  PJ="$(make_scratch)"; OUT="$(make_scratch)/j.jsonl"
  CLAUDE_PROJECT_DIR="$PJ" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"1bad","prompt":"go"}')" "WAIT_FOR \"id\":2 5" \
    "$(call 3 pi_agent '{"task_id":"pi:Beta","prompt":"go"}')" "WAIT_FOR \"id\":3 10" \
    "$(call 4 pi_agent '{"prompt":"go","description":"Fix the Login bug!"}')" "WAIT_FOR \"id\":4 10"
  case "$(field_of "$(agent_json "$OUT" 2)" errorMessage)" in 'invalid name "1bad"'*) pass "J: invalid name refused" ;; *) fail "J: 1bad ($(agent_json "$OUT" 2))" ;; esac
  [ "$(field_of "$(agent_json "$OUT" 3)" name)" = beta ] && pass "J: task_id alias + pi: prefix + case fold" || fail "J: alias ($(agent_json "$OUT" 3))"
  N="$(field_of "$(agent_json "$OUT" 4)" name)"
  [[ "$N" =~ ^fix-the-login-bug-[0-9a-f]{4}$ ]] && pass "J: generated name $N" || fail "J: generated ($N)"
} || true

# ---------------------------------------------------------------------------
# K. a takeover whose handshake fails keeps meta on one generation: gen 2's
#    launch record (never gen 1's) and no gen-1 sessionFile; a resume of that
#    never-started gen is refused (no child), and pi_agent starts gen 3
# ---------------------------------------------------------------------------
{
  PK="$(make_scratch)"; pin "$PK" mac-m3 'qwen3.8-flash@adaptive'
  OUT="$(make_scratch)/k1.jsonl"
  CLAUDE_PROJECT_DIR="$PK" feed "$OUT" "$(call 2 pi_agent '{"name":"t","prompt":"one","run_in_background":false}')" "WAIT_FOR \"id\":2 15"
  [ "$(field_of "$(agent_json "$OUT" 2)" sessionId)" = t-g1-teststore ] && pass "K: gen 1 started" || fail "K: gen 1 ($(agent_json "$OUT" 2))"
  OUT="$(make_scratch)/k2.jsonl"
  CLAUDE_PROJECT_DIR="$PK" PI_STUB_UNKNOWN_MODEL=1 feed "$OUT" "$(call 2 pi_agent '{"name":"t","prompt":"two"}')" "WAIT_FOR \"id\":2 15"
  case "$(field_of "$(agent_json "$OUT" 2)" errorMessage)" in *"did not start on the expected model"*) pass "K: gen 2 handshake fails" ;; *) fail "K: gen 2 ($(agent_json "$OUT" 2))" ;; esac
  CD="$(child_dir "$PK" t)"
  M="$(meta_eval "$CD" '[m.gen, m.state, m.sessionId, m.launch.sessionId, String(m.sessionFile), m.gens.map((g) => g.gen + ":" + g.sessionId).join(",")].join("|")')"
  [ "$M" = "2|failed|t-g2-teststore|t-g2-teststore|null|1:t-g1-teststore" ] && pass "K: meta stays on gen 2 (launch t-g2-teststore, no gen-1 sessionFile)" || fail "K: meta ($M)"
  PIDS="$(make_scratch)/pids"; : > "$PIDS"; OUT="$(make_scratch)/k3.jsonl"
  CLAUDE_PROJECT_DIR="$PK" PI_STUB_PID_FILE="$PIDS" feed "$OUT" "$(call 2 pi_send_message '{"to":"t","message":"resume"}')" "WAIT_FOR \"id\":2 15"
  case "$(inner_for_id "$OUT" 2)" in *'pi:t gen 2 never started (its launch failed). Call pi_agent {name:\"t\"}'*) pass "K: resume of a never-started gen refused" ;; *) fail "K: resume ($(inner_for_id "$OUT" 2))" ;; esac
  [ ! -s "$PIDS" ] && pass "K: no child spawned for the refused resume" || fail "K: resume spawned $(cat "$PIDS")"
  ARGS="$(make_scratch)/args.json"; OUT="$(make_scratch)/k4.jsonl"
  CLAUDE_PROJECT_DIR="$PK" PI_STUB_ARGS_FILE="$ARGS" feed "$OUT" "$(call 2 pi_agent '{"name":"t","prompt":"three","run_in_background":false}')" "WAIT_FOR \"id\":2 15"
  [ "$(field_of "$(agent_json "$OUT" 2)" sessionId)" = t-g3-teststore ] && pass "K: pi_agent starts gen 3" || fail "K: gen 3 ($(agent_json "$OUT" 2))"
  assert_json "K: gen 3 launched with --session-id t-g3-teststore" "$ARGS" 'r.argv.join(" ").includes("--session-id t-g3-teststore")'
  M="$(meta_eval "$CD" '[m.gen, m.launch.sessionId, m.gens.map((g) => g.gen + ":" + g.sessionId).join(",")].join("|")')"
  [ "$M" = "3|t-g3-teststore|1:t-g1-teststore,2:t-g2-teststore" ] && pass "K: gens 1 and 2 archived" || fail "K: gens ($M)"
} || true

# ---------------------------------------------------------------------------
# L. parallel spawns at the cap: the first reserves its slot before any await,
#    so the second gets the all-busy error and the first is never evicted
#    mid-handshake
# ---------------------------------------------------------------------------
{
  PL="$(make_scratch)"; PIDS="$(make_scratch)/pids"; : > "$PIDS"; OUT="$(make_scratch)/l.jsonl"
  CLAUDE_PROJECT_DIR="$PL" PI_DELEGATE_WAKE=channel PI_MCP_REGISTRY_CAP=1 PI_STUB_SETTLE_MS=3000 PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"aa","prompt":"one"}')" "$(call 3 pi_agent '{"name":"bb","prompt":"two"}')" \
    "WAIT_FOR \"id\":2 10" "WAIT_FOR \"id\":3 10" "SLEEP 0.5"
  [ "$(field_of "$(agent_json "$OUT" 2)" ok)" = true ] && pass "L: first parallel spawn succeeds" || fail "L: aa ($(inner_for_id "$OUT" 2))"
  case "$(field_of "$(agent_json "$OUT" 3)" errorMessage)" in "1 pi children are live (cap 1) and all are busy: aa ("*) pass "L: second gets the all-busy error naming aa" ;; *) fail "L: bb ($(inner_for_id "$OUT" 3))" ;; esac
  case "$(event_types "$(child_dir "$PL" aa)")" in spawned*) pass "L: aa logged spawned, never parked" ;; *) fail "L: aa events $(event_types "$(child_dir "$PL" aa)")" ;; esac
  [ "$(wc -l < "$PIDS" | tr -d ' ')" = 1 ] && pass "L: one child started" || fail "L: pids $(cat "$PIDS")"
} || true

finish
