#!/usr/bin/env bash
# 0.11 S5 (stub pi): pi_list_agents, pi_read, owner-checked restart recovery,
# the lifetime lock across two live servers.
#   A pi_list_agents: header, rows newest first; unshown events of owned
#     children are inlined once (consumed: meta consumed_seq moves) and never
#     again; pi_read {what:"events"} consumes what it returns
#   B pi_list_agents {name} detail; pi_read result (latest / by turn / by gen),
#     transcript live (get_messages) and from disk, events; takeover keeps gen 1
#     readable; unknown names and bad args are errors; no pi is started
#   C two live servers: B's startup leaves A's running child alone; B lists it
#     read-only (no inline, nothing consumed) and every mutating tool refuses;
#     one pi process; A still gets its DONE
#   D restart recovery: a SIGKILLed server's child blocked in ask_parent is
#     pre-answered, killed and recorded failed{orphaned} before tools/list
#     answers; the event is pushed after notifications/initialized and inlined
#     by the next pi_list_agents; lock and ask dir are gone
#   E dead servers' lifetime locks are released at startup; a live one is kept
#   F pi_list_agents {doctor:true} reports the auto-background threshold
#   D2 restart across Claude sessions: session A's server is SIGKILLed with one
#     child done (unconsumed) and one blocked in ask_parent, which dies with it
#     (stdin EOF, as real pi does); session B's startup and lists record the
#     orphan for A without claiming, pushing or consuming anything; A's
#     reconnect delivers DONE, the expired question and failed{orphaned}
#   G lifetime-lock reclaim is atomic: two acquirers racing over one dead lock
#     never both win; a dead-lock sweep never deletes a lock a live server
#     just took
#   H every pi-delegate tool a command names exists in tools/list
#   I pi_read {what:"events"} and pi_list_agents {name} stay small: capped
#     event fields, last <= 100, no full result text in JSON
#   J a server that was ALREADY running when another session's server was
#     SIGKILLed recovers that orphan on its list, its resume and its stop:
#     question_expired{orphaned} + failed{orphaned} land in the journal before
#     anything else, and the resume's response carries them
#   K the lifetime lock is the ownership check: while another live server
#     holds a stopped child's lock, pi_stop {forget:true}, pi_send_message and
#     pi_agent all get the owner error and the session file stays
#   L orphan recovery's write into pi's session file: one toolResult appended
#     per dangling toolCall (parentId = the old leaf, fresh ids); a torn file,
#     or an orphan that would not die, leaves the file byte-identical; a resume
#     adds nothing more
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/lib/mcp.sh"

FAKE_PKG="$(make_scratch)/pi-delegate-pkg"
mkdir -p "$FAKE_PKG" && echo '{"name":"@maheidem/pi-delegate","version":"9.9.9"}' > "$FAKE_PKG/package.json"
export PI_DELEGATE_PI_PACKAGE="$FAKE_PKG"
use_stub pi-rpc-lab

res_json() { inner_for_id "$1" "$2" | tail -n 1; }
res_head() { inner_for_id "$1" "$2" | sed '$d'; }
cancel() { printf '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":%s}}' "$1"; }
lock_of() { echo "${TMPDIR:-/tmp}/pi-delegate-locks/$(pi_session_slug "$1")__$2.lock"; }
events_eval() {
  node -e 'let raw = ""; try { raw = require("fs").readFileSync(process.argv[1] + "/events.jsonl", "utf8"); } catch {}
    const evs = raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"
}
meta_eval() {
  node -e 'const m = JSON.parse(require("fs").readFileSync(process.argv[1] + "/meta.json", "utf8")); process.stdout.write(String(eval(process.argv[2])))' "$1" "$2" 2>/dev/null
}
pushes_of() { # pushes_of <out> <agent> <event> -> count of channel pushes
  node -e '
    let n = 0;
    for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
      try { const o = JSON.parse(l); if (o.method === "notifications/claude/channel" && o.params.meta.agent === process.argv[2] && o.params.meta.event === process.argv[3]) n++; } catch {}
    }
    process.stdout.write(String(n));' "$1" "$2" "$3"
}

# ---------------------------------------------------------------------------
# A. list, inline once, pi_read events consumes
# ---------------------------------------------------------------------------
{
  PA="$(make_scratch)"; OUT="$(make_scratch)/a.jsonl"; CA="$(child_dir "$PA" aa)"
  CLAUDE_PROJECT_DIR="$PA" PI_STUB_SETTLE_MS=1000 feed "$OUT" \
    "$(call 2 pi_agent '{"name":"aa","prompt":"one"}')" "SLEEP 0.5" "$(cancel 2)" "WAIT_FOR \"event\":\"done\" 10" "SLEEP 0.3" \
    "SH echo \$(meta_of '$CA' consumed_seq) \$(last_seq_of '$CA' done) > '$OUT.before'" \
    "$(call 3 pi_list_agents '{}')" "WAIT_FOR \"id\":3 10" \
    "SH echo \$(meta_of '$CA' consumed_seq) > '$OUT.after'" \
    "$(call 4 pi_list_agents '{}')" "WAIT_FOR \"id\":4 10" \
    "$(call 5 pi_agent '{"name":"bb","prompt":"two","run_in_background":false}')" "WAIT_FOR \"id\":5 10" \
    "$(call 6 pi_list_agents '{}')" "WAIT_FOR \"id\":6 10" \
    "$(call 7 pi_send_message '{"to":"aa","message":"again"}')" "SLEEP 0.5" "$(cancel 7)" "WAIT_FOR \"turn\":\"2\" 10" "SLEEP 0.3" \
    "$(call 8 pi_read '{"name":"aa","what":"events","last":2}')" "WAIT_FOR \"id\":8 10" \
    "SH echo \$(meta_of '$CA' consumed_seq) \$(last_seq_of '$CA' done) > '$OUT.read'" \
    "$(call 9 pi_list_agents '{}')" "WAIT_FOR \"id\":9 10"
  H3="$(res_head "$OUT" 3)"
  printf '%s\n' "$H3" | head -1 | grep -qE '^pi 0\.99\.1 · pin none · questions_per_turn 5 \(default\) · .* · wake fallback · live 1/4 · wait armed: no$' \
    && pass "A: header: pi version, pin, wake, live n/cap, wait armed" || fail "A: header ($(printf '%s' "$H3" | head -1))"
  printf '%s\n' "$H3" | grep -qE '^aa  idle  turn 1  gen 1  [0-9]+s  turn 1 done ok$' && pass "A: row for aa (idle, turn 1, gen 1, done ok)" || fail "A: row ($H3)"
  printf '%s\n' "$H3" | grep -qE '^\[pi:aa\] DONE turn 1 ok .*\(also pushed [0-9:]{8}\)$' && pass "A: the pushed-but-unconfirmed DONE is inlined, marked (also pushed)" || fail "A: inline ($H3)"
  read -r B_CUR B_DONE < "$OUT.before"
  [ "$B_CUR" != "$B_DONE" ] && [ "$(cat "$OUT.after")" = "$B_DONE" ] && pass "A: inlining consumed it (consumed_seq $B_CUR -> $B_DONE)" || fail "A: consumed $(cat "$OUT.before") -> $(cat "$OUT.after")"
  [ "$(field_of "$(res_json "$OUT" 3)" 'events[0].type')" = done ] && pass "A: JSON carries the inlined event" || fail "A: json ($(res_json "$OUT" 3))"
  res_head "$OUT" 4 | grep -qF '[pi:aa] DONE' && fail "A: a second list repeated the DONE" || pass "A: a second list does not repeat it"
  H6="$(res_head "$OUT" 6)"
  [ "$(printf '%s\n' "$H6" | sed -n '2p;3p' | cut -d' ' -f1 | tr '\n' ',')" = "bb,aa," ] && pass "A: rows newest first (bb, aa)" || fail "A: order ($H6)"
  printf '%s\n' "$H6" | head -1 | grep -qF 'live 2/4' && pass "A: live 2/4 with two children" || fail "A: live count ($H6)"
  read -r R_CUR R_DONE < "$OUT.read"
  res_head "$OUT" 8 | grep -qE '^#[0-9]+ [0-9:]{8} gen 1 turn 2 done ok "reply-2' && [ "$R_CUR" = "$R_DONE" ] \
    && pass "A: pi_read events returns turn 2's DONE and consumes it" || fail "A: pi_read events ($(inner_for_id "$OUT" 8)) consumed $R_CUR done $R_DONE"
  res_head "$OUT" 9 | grep -qF '[pi:aa] DONE turn 2' && fail "A: list repeated what pi_read returned" || pass "A: list does not repeat what pi_read returned"
} || true

# ---------------------------------------------------------------------------
# B. detail, pi_read result / transcript / events, takeover keeps gen 1
# ---------------------------------------------------------------------------
{
  PB="$(make_scratch)"; AG="$(make_scratch)/agent"; OUT="$(make_scratch)/b.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"
  SD="$AG/sessions/$(pi_session_slug "$PB")"; mkdir -p "$SD"
  printf '%s\n' '{"type":"session","id":"dd-g1-teststore"}' \
    '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"DISK-TOKEN-1"}],"timestamp":1759300000000}}' \
    '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"disk reply"}],"timestamp":1759300001000}}' > "$SD/2026-10-01T00-00-00-000Z_dd-g1-teststore.jsonl"
  CLAUDE_PROJECT_DIR="$PB" PI_CODING_AGENT_DIR="$AG" PI_STUB_PID_FILE="$PIDS" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"dd","prompt":"one","run_in_background":false}')" "WAIT_FOR \"id\":2 10" \
    "$(call 3 pi_send_message '{"to":"dd","message":"two"}')" "WAIT_FOR \"id\":3 10" \
    "$(call 4 pi_read '{"name":"pi:dd"}')" "$(call 5 pi_read '{"to":"dd","turn":1}')" \
    "$(call 6 pi_read '{"name":"dd","what":"transcript"}')" "$(call 7 pi_list_agents '{"name":"dd"}')" "WAIT_FOR \"id\":7 10" \
    "SH wc -l < '$PIDS' | tr -d ' ' > '$OUT.pids'" \
    "$(call 8 pi_stop '{"name":"dd"}')" "WAIT_FOR \"id\":8 10" \
    "$(call 9 pi_read '{"name":"dd","what":"transcript"}')" "$(call 10 pi_list_agents '{"name":"dd"}')" "WAIT_FOR \"id\":10 10" \
    "SH wc -l < '$PIDS' | tr -d ' ' > '$OUT.pids2'" \
    "$(call 11 pi_agent '{"name":"dd","prompt":"three","run_in_background":false}')" "WAIT_FOR \"id\":11 10" \
    "$(call 12 pi_read '{"name":"dd","gen":1,"turn":2}')" "$(call 13 pi_read '{"name":"dd"}')" "$(call 14 pi_list_agents '{"name":"dd"}')" \
    "$(call 15 pi_read '{"name":"dd","gen":3}')" "$(call 16 pi_read '{"name":"nope"}')" "$(call 17 pi_read '{"name":"dd","what":"bogus"}')" \
    "$(call 18 pi_read '{"name":"dd","turn":9}')" "WAIT_FOR \"id\":18 10" \
    "$(call 19 pi_stop '{"name":"dd"}')" "WAIT_FOR \"id\":19 10"
  case "$(res_head "$OUT" 4)" in "pi:dd gen 1 turn 2 result (7 chars, "*"/results/1-2.md):"$'\n'"reply-2") pass "B: pi_read default = latest turn's full result" ;; *) fail "B: id4 ($(inner_for_id "$OUT" 4))" ;; esac
  case "$(res_head "$OUT" 5)" in *"turn 1 result"*"reply-1") pass "B: pi_read {turn:1}" ;; *) fail "B: id5 ($(inner_for_id "$OUT" 5))" ;; esac
  H6="$(res_head "$OUT" 6)"
  case "$H6" in "pi:dd gen 1 transcript (live; last 4 of 4 entries):"*"user: one"*"assistant: reply-1"*"user: two"*"assistant: reply-2") pass "B: live transcript via get_messages" ;; *) fail "B: id6 ($H6)" ;; esac
  H7="$(res_head "$OUT" 7)"; J7="$(res_json "$OUT" 7)"
  printf '%s\n' "$H7" | grep -qE '^last turn: gen 1 turn 2 ok · 2\.0k tok' && printf '%s\n' "$H7" | grep -qF "output: " && printf '%s\n' "$H7" | grep -qE '^launch: dd-g1-teststore · stub/stub-model · ask on$' \
    && pass "B: detail: last turn, output file, launch" || fail "B: detail ($H7)"
  [ "$(field_of "$J7" turnCount)" = 2 ] && [ "$(field_of "$J7" 'usage.inputTokens')" = 2000 ] && [ "$(field_of "$J7" 'lastTurn.turn')" = 2 ] && [ "$(field_of "$J7" sessionId)" = dd-g1-teststore ] \
    && pass "B: detail JSON: turnCount/usage from the live child, lastTurn, sessionId" || fail "B: detail json ($J7)"
  [ "$(cat "$OUT.pids")" = 1 ] && pass "B: reads and detail started no pi" || fail "B: pi spawns $(cat "$OUT.pids")"
  case "$(res_head "$OUT" 9)" in "pi:dd gen 1 transcript (disk /"*"/sessions/--"*"--/2026-10-01T00-00-00-000Z_dd-g1-teststore.jsonl; last 2 of 2 entries):"*"user: DISK-TOKEN-1"*"assistant: disk reply") pass "B: stopped child: transcript from disk (pi's session dir)" ;; *) fail "B: id9 ($(inner_for_id "$OUT" 9))" ;; esac
  res_head "$OUT" 10 | sed -n 2p | grep -qE '^dd  stopped  turn 2  gen 1  [0-9]+s  turn 2 done ok$' && [ "$(field_of "$(res_json "$OUT" 10)" channel)" = null ] \
    && pass "B: detail of a stopped child (no channel)" || fail "B: id10 ($(inner_for_id "$OUT" 10))"
  [ "$(cat "$OUT.pids2")" = 1 ] && pass "B: reading a stopped child started no pi" || fail "B: pi spawns after stop $(cat "$OUT.pids2")"
  case "$(res_head "$OUT" 12)" in "pi:dd gen 1 turn 2 result"*"reply-2") pass "B: after takeover, pi_read {gen:1, turn:2} still reads gen 1" ;; *) fail "B: id12 ($(inner_for_id "$OUT" 12))" ;; esac
  case "$(res_head "$OUT" 13)" in "pi:dd gen 2 turn 1 result"*"reply-1") pass "B: pi_read defaults to the new generation" ;; *) fail "B: id13 ($(inner_for_id "$OUT" 13))" ;; esac
  res_head "$OUT" 14 | grep -qE '^gen 1: dd-g1-teststore \(ended [0-9:]{8}; pi_read \{name:"dd", gen:1\}\)$' && [ "$(field_of "$(res_json "$OUT" 14)" 'gens[0].gen')" = 1 ] \
    && pass "B: detail lists past generations" || fail "B: id14 ($(inner_for_id "$OUT" 14))"
  [ "$(field_of "$(res_json "$OUT" 15)" errorMessage)" = "pi:dd has no gen 3 (current gen 2)" ] && pass "B: unknown gen refused" || fail "B: id15 ($(res_json "$OUT" 15))"
  case "$(field_of "$(res_json "$OUT" 16)" errorMessage)" in 'No pi agent named "nope". Known: dd ('*) pass "B: unknown name lists the known ones" ;; *) fail "B: id16 ($(res_json "$OUT" 16))" ;; esac
  [ "$(field_of "$(res_json "$OUT" 17)" errorMessage)" = "what must be result, transcript or events" ] && pass "B: bad what refused" || fail "B: id17 ($(res_json "$OUT" 17))"
  case "$(field_of "$(res_json "$OUT" 18)" errorMessage)" in "pi:dd has no result for gen 2 turn 9 yet (finished turns in gen 2: 1)"*) pass "B: missing turn says which exist" ;; *) fail "B: id18 ($(res_json "$OUT" 18))" ;; esac
} || true

# ---------------------------------------------------------------------------
# C. two live servers on one project
# ---------------------------------------------------------------------------
{
  PC="$(make_scratch)"; OA="$(make_scratch)/ca.jsonl"; OB="$(make_scratch)/cb.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"; CC="$(child_dir "$PC" own)"
  ( CLAUDE_PROJECT_DIR="$PC" PI_DELEGATE_WAKE=channel PI_STUB_SETTLE_MS=9000 PI_STUB_PID_FILE="$PIDS" FEED_TIMEOUT=60 feed "$OA" \
      "$(call 2 pi_agent '{"name":"own","prompt":"long"}')" "WAIT_FOR \"event\":\"done\" 30" "SLEEP 0.5" ) &
  FA=$!
  for _ in $(seq 1 100); do [ "$(meta_eval "$CC" 'm.state' 2>/dev/null)" = running ] && break; sleep 0.1; done
  KID="$(head -1 "$PIDS")"; APID="$(meta_eval "$CC" 'm.ownerServerPid')"
  CLAUDE_PROJECT_DIR="$PC" PI_STUB_PID_FILE="$PIDS" feed "$OB" \
    "$(call 2 pi_list_agents '{}')" "$(call 3 pi_list_agents '{"name":"own"}')" \
    "$(call 4 pi_send_message '{"to":"own","message":"x"}')" "$(call 5 pi_stop '{"name":"own"}')" \
    "$(call 6 pi_agent '{"name":"own","prompt":"x"}')" "$(call 7 pi_answer '{"to":"own","answer":"x"}')" \
    "$(call 8 pi_read '{"name":"own","what":"events"}')" "WAIT_FOR \"id\":8 10"
  ALIVE_AFTER_B=no; kill -0 "$KID" 2>/dev/null && ALIVE_AFTER_B=yes
  OWNER_AFTER_B="$(meta_eval "$CC" 'm.ownerServerPid')"
  wait "$FA" 2>/dev/null
  [ "$ALIVE_AFTER_B" = yes ] && [ "$OWNER_AFTER_B" = "$APID" ] && pass "C: B's startup left A's running child alone (pid $KID alive, owner still $APID)" || fail "C: alive=$ALIVE_AFTER_B owner=$OWNER_AFTER_B (A=$APID)"
  res_head "$OB" 2 | grep -qE "^own  running  turn 1  gen 1  [0-9]+s  \\(other session, server pid $APID\\)$" && [ "$(field_of "$(res_json "$OB" 2)" 'agents[0].readOnly')" = true ] \
    && pass "C: B lists A's child read-only (other session, server pid)" || fail "C: id2 ($(inner_for_id "$OB" 2))"
  ok=1; for id in 4 5 6 7; do case "$(field_of "$(res_json "$OB" "$id")" errorMessage)" in "pi:own is owned by another Claude session (server pid $APID, since "*) ;; *) ok=0; echo "    id $id: $(res_json "$OB" "$id")" >&2 ;; esac; done
  [ "$ok" = 1 ] && pass "C: send/stop/agent/answer from B get the owner error" || fail "C: owner errors"
  [ "$(field_of "$(res_json "$OB" 8)" ok)" = true ] && [ "$(field_of "$(res_json "$OB" 8)" 'events.length')" -ge 1 ] && pass "C: B can still read A's child's events" || fail "C: id8 ($(res_json "$OB" 8))"
  [ "$(wc -l < "$PIDS" | tr -d ' ')" = 1 ] && pass "C: one pi process in all" || fail "C: pi processes $(cat "$PIDS")"
  [ "$(pushes_of "$OA" own done)" = 1 ] && [ "$(meta_eval "$CC" 'm.consumed_seq')" = "$(last_seq_of "$CC" done)" ] \
    && pass "C: A still got its DONE (pushed, consumed by A)" || fail "C: A done pushes=$(pushes_of "$OA" own done) consumed=$(meta_eval "$CC" 'm.consumed_seq')"
  [ "$(count_pushes "$OB")" -eq 0 ] && pass "C: B pushed nothing for A's child" || fail "C: B pushed something"
} || true

# ---------------------------------------------------------------------------
# D. restart recovery of a child blocked in ask_parent
# ---------------------------------------------------------------------------
{
  PD="$(make_scratch)"; O1="$(make_scratch)/d1.jsonl"; O2="$(make_scratch)/d2.jsonl"; PIDS="$(make_scratch)/pids"; : > "$PIDS"
  ARGS="$(make_scratch)/args.json"; CD="$(child_dir "$PD" w)"; LOCK="$(lock_of "$PD" w)"
  ( CLAUDE_PROJECT_DIR="$PD" PI_STUB_ASKS=1 PI_STUB_EOF_FINISH=1 PI_STUB_ASK_WAIT_MS=30000 PI_STUB_PID_FILE="$PIDS" PI_STUB_ARGS_FILE="$ARGS" feed "$O1" \
      "$(call 2 pi_agent '{"name":"w","prompt":"go"}')" "WAIT_FOR \"id\":2 10" "SLEEP 0.3" \
      "SH kill -9 \$(ps -o ppid= -p \$(head -1 '$PIDS'))" ) 2>/dev/null
  KID="$(head -1 "$PIDS")"
  ASKDIR="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).env.PI_DELEGATE_ASK_DIR)' "$ARGS")"
  kill -0 "$KID" 2>/dev/null && [ "$(meta_eval "$CD" 'm.state')" = waiting ] && [ -e "$LOCK" ] \
    && pass "D: setup: child $KID blocked in ask_parent, its server SIGKILLed, lock left behind" || fail "D: setup (state $(meta_eval "$CD" 'm.state'), lock $([ -e "$LOCK" ] && echo yes))"
  # tools/list is answered at once (Claude Code waits <= 5s for always-loaded
  # tools); the first tools/call waits for recovery.
  CLAUDE_PROJECT_DIR="$PD" PI_STUB_PID_FILE="$PIDS" feed "$O2" \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' "WAIT_FOR \"id\":2 15" \
    "$(call 5 pi_read '{"name":"w","what":"result"}')" "WAIT_FOR \"id\":5 15" \
    "SH (kill -0 $KID 2>/dev/null && echo alive || echo dead; [ -e '$LOCK' ] && echo locked || echo unlocked; [ -e '$ASKDIR' ] && echo askdir || echo noaskdir) | tr '\n' ' ' > '$O2.state'" \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' "WAIT_FOR \"event\":\"failed\" 5" \
    "$(call 3 pi_list_agents '{}')" "WAIT_FOR \"id\":3 10" "$(call 4 pi_list_agents '{}')" "WAIT_FOR \"id\":4 10"
  [ "$(cat "$O2.state")" = "dead unlocked noaskdir " ] && pass "D: before the first tool call answered: orphan killed, lock released, ask dir removed" || fail "D: state at the first tool call: $(cat "$O2.state")"
  [ "$(events_eval "$CD" 'evs.map((e) => e.type).join(",")')" = "spawned,question,answered,orphan_killed,failed" ] \
    && [ "$(events_eval "$CD" 'evs.find((e) => e.type === "answered").data.answeredBy')" = model ] \
    && [ "$(events_eval "$CD" 'evs.find((e) => e.type === "failed").data.reason')" = orphaned ] \
    && pass "D: journal: question pre-answered, orphan_killed, failed{orphaned}" || fail "D: events $(events_eval "$CD" 'JSON.stringify(evs.map((e) => [e.type, e.data && (e.data.reason || e.data.answeredBy)]))')"
  [ "$(meta_eval "$CD" 'm.state + "|" + m.reason')" = "failed|orphaned: MCP server restarted" ] && pass "D: meta failed (orphaned: MCP server restarted)" || fail "D: meta $(meta_eval "$CD" 'm.state + "|" + m.reason')"
  node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    const i1 = ls.findIndex((o) => o.id === 1 && o.result);
    const ps = ls.map((o, i) => (o.method === "notifications/claude/channel" && o.params.meta.agent === "w" && o.params.meta.event === "failed" ? i : -1)).filter((i) => i >= 0);
    process.exit(i1 >= 0 && ps.length === 1 && ps[0] > i1 ? 0 : 1);
  ' "$O2" && pass "D: failed{orphaned} pushed once, only after initialize" || fail "D: push order ($(grep -n 'claude/channel\|"id":1' "$O2" | cut -c1-120))"
  H3="$(res_head "$O2" 3)"
  printf '%s\n' "$H3" | grep -qE '^w  failed  turn 1  gen 1  [0-9]+s  \(orphaned: MCP server restarted\)$' && printf '%s\n' "$H3" | grep -qE '^\[pi:w\] FAILED turn 1 \(orphaned\): .*\(also pushed' \
    && pass "D: pi_list_agents shows failed (orphaned) and inlines the unconfirmed push" || fail "D: id3 ($H3)"
  res_head "$O2" 4 | grep -qF '[pi:w] FAILED' && fail "D: inlined twice" || pass "D: inlined once"
} || true

# ---------------------------------------------------------------------------
# E. startup releases dead servers' lifetime locks, keeps a live one
# ---------------------------------------------------------------------------
{
  PE="$(make_scratch)"; OUT="$(make_scratch)/e.jsonl"; DEADL="$(lock_of "$PE" zdead)"; LIVEL="$(lock_of "$PE" zlive)"; LEGACY="$(lock_of "$PE" zturn)"
  sleep 60 & LIVE=$!
  mkdir -p "$(dirname "$DEADL")"
  printf '{"serverPid":999999,"serverStart":"Thu Jan  1 00:00:00 2026","name":"zdead","gen":1}' > "$DEADL"
  printf '{"serverPid":%s,"serverStart":"%s","name":"zlive","gen":1}' "$LIVE" "$(LC_ALL=C ps -o lstart= -p "$LIVE" | sed 's/^ *//;s/ *$//')" > "$LIVEL"
  echo "$LIVE" > "$LEGACY"
  CLAUDE_PROJECT_DIR="$PE" feed "$OUT" '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' "WAIT_FOR \"id\":2 10"
  [ ! -e "$DEADL" ] && [ -e "$LIVEL" ] && [ -e "$LEGACY" ] && pass "E: dead server's lock released; a live server's and a per-turn lock kept" || fail "E: dead=$([ -e "$DEADL" ] && echo kept) live=$([ -e "$LIVEL" ] && echo kept) legacy=$([ -e "$LEGACY" ] && echo kept)"
  kill "$LIVE" 2>/dev/null; wait "$LIVE" 2>/dev/null; rm -f "$LIVEL" "$LEGACY"
} || true

# ---------------------------------------------------------------------------
# F. doctor
# ---------------------------------------------------------------------------
{
  OUT="$(make_scratch)/f.jsonl"; OUT2="$(make_scratch)/f2.jsonl"
  CLAUDE_PROJECT_DIR="$(make_scratch)" CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=5000 feed "$OUT" "$(call 2 pi_list_agents '{"doctor":true}')" "WAIT_FOR \"id\":2 15"
  ( unset CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS; CLAUDE_PROJECT_DIR="$(make_scratch)" feed "$OUT2" "$(call 2 pi_list_agents '{"doctor":true}')" "WAIT_FOR \"id\":2 15" )
  H="$(res_head "$OUT" 2)"; J="$(res_json "$OUT" 2)"
  printf '%s\n' "$H" | grep -qxF 'CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS (as this server sees it): 5000 ms' && [ "$(field_of "$J" autoBackgroundMs)" = 5000 ] \
    && printf '%s\n' "$H" | grep -qxF 'pi 0.99.1' && printf '%s\n' "$H" | grep -qF "ask_parent package: $FAKE_PKG (9.9.9)" && printf '%s\n' "$H" | grep -qxF 'wake: fallback' \
    && pass "F: doctor: pi version, ask_parent package version, wake, auto-background threshold" || fail "F: doctor ($H)"
  res_head "$OUT2" 2 | grep -qxF "CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS (as this server sees it): unset (Claude Code's default, ~2 min)" \
    && pass "F: doctor: unset threshold reported as Claude Code's default" || fail "F: doctor unset ($(inner_for_id "$OUT2" 2))"
} || true

# ---------------------------------------------------------------------------
# D2. restart across Claude sessions: B never takes A's orphans or events
# ---------------------------------------------------------------------------
{
  PD="$(make_scratch)"; PIDS="$(make_scratch)/pids"; : > "$PIDS"
  OA1="$(make_scratch)/a1.jsonl"; OA2="$(make_scratch)/a2.jsonl"; OB="$(make_scratch)/b.jsonl"; OA3="$(make_scratch)/a3.jsonl"
  CV="$(child_dir "$PD" v)"; CW="$(child_dir "$PD" w)"
  # A1: v finishes a turn whose DONE nobody consumed, then A's server dies.
  ( CLAUDE_PROJECT_DIR="$PD" CLAUDE_CODE_SESSION_ID=sessA PI_STUB_SETTLE_MS=1000 PI_STUB_PID_FILE="$PIDS" feed "$OA1" \
      "$(call 2 pi_agent '{"name":"v","prompt":"one"}')" "SLEEP 0.5" "$(cancel 2)" "WAIT_FOR \"event\":\"done\" 10" "SLEEP 0.3" \
      "SH kill -9 \$(ps -o ppid= -p \$(tail -1 '$PIDS'))" ) 2>/dev/null
  # A2 (same session after a reconnect): w blocks in ask_parent, then the server
  # is SIGKILLed; the child exits on stdin EOF with it, as real pi does.
  ( CLAUDE_PROJECT_DIR="$PD" CLAUDE_CODE_SESSION_ID=sessA PI_STUB_ASKS=1 PI_STUB_ASK_WAIT_MS=30000 PI_STUB_PID_FILE="$PIDS" feed "$OA2" \
      "$(call 2 pi_agent '{"name":"w","prompt":"go"}')" "WAIT_FOR \"id\":2 10" "SLEEP 0.3" \
      "SH kill -9 \$(ps -o ppid= -p \$(tail -1 '$PIDS'))" ) 2>/dev/null
  sleep 0.5
  V_CONS="$(meta_eval "$CV" 'm.consumed_seq')"; W_CONS="$(meta_eval "$CW" 'm.consumed_seq')"
  [ "$(meta_eval "$CV" 'm.ownerClaudeSession')" = sessA ] && [ "$(meta_eval "$CW" 'm.state + "|" + m.ownerClaudeSession')" = "waiting|sessA" ] \
    && [ "$V_CONS" -lt "$(last_seq_of "$CV" done)" ] && ! kill -0 "$(tail -1 "$PIDS")" 2>/dev/null \
    && pass "D2: setup: session A's v has an unconsumed DONE, w was waiting and died with A's server" \
    || fail "D2: setup (v cons $V_CONS done $(last_seq_of "$CV" done), w $(meta_eval "$CW" 'm.state + "|" + m.ownerClaudeSession'))"
  # B: another Claude session starts in the project and lists.
  CLAUDE_PROJECT_DIR="$PD" CLAUDE_CODE_SESSION_ID=sessB feed "$OB" \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' "WAIT_FOR \"id\":2 15" \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' "SLEEP 0.5" \
    "$(call 3 pi_list_agents '{}')" "$(call 4 pi_list_agents '{"name":"w"}')" "$(call 5 pi_list_agents '{"name":"v"}')" \
    "$(call 6 pi_read '{"name":"w","what":"events"}')" "WAIT_FOR \"id\":6 10"
  [ "$(count_pushes "$OB")" -ne 0 ] && fail "D2: B pushed A's events ($(grep -F claude/channel "$OB" | cut -c1-160))" || pass "D2: B pushed nothing of A's"
  ok=1; for id in 3 4 5; do res_head "$OB" "$id" | grep -qF '[pi:' && { ok=0; echo "    id $id: $(res_head "$OB" "$id")" >&2; }; done
  [ "$ok" = 1 ] && pass "D2: B's lists (all, {name:w}, {name:v}) inline none of A's events" || fail "D2: B inlined A's events"
  [ "$(meta_eval "$CW" 'm.state + "|" + m.ownerClaudeSession + "|" + m.ownerServerPid + "|" + m.consumed_seq')" = "failed|sessA|null|$W_CONS" ] \
    && [ "$(meta_eval "$CV" 'm.ownerClaudeSession + "|" + m.consumed_seq')" = "sessA|$V_CONS" ] \
    && pass "D2: B recorded w failed but handed it back: still session A's, no server owns it, nothing consumed" \
    || fail "D2: meta after B: w $(meta_eval "$CW" 'm.state + "|" + m.ownerClaudeSession + "|" + m.ownerServerPid + "|" + m.consumed_seq') (was $W_CONS), v $(meta_eval "$CV" 'm.ownerClaudeSession + "|" + m.consumed_seq') (was $V_CONS)"
  [ "$(events_eval "$CW" 'evs.map((e) => e.type + (e.data && e.data.reason ? ":" + e.data.reason : "")).join(",")')" = "spawned,question,question_expired:orphaned,failed:orphaned" ] \
    && [ "$(events_eval "$CW" 'evs.find((e) => e.type === "failed").data.riders[0].reason')" = orphaned ] \
    && pass "D2: journal: the dead child's open question closed as question_expired{orphaned}, riding on failed{orphaned}" \
    || fail "D2: journal $(events_eval "$CW" 'JSON.stringify(evs.map((e) => [e.type, e.data && e.data.reason]))')"
  case "$(res_head "$OB" 3)" in *"w  failed  turn 1  gen 1"*"v  idle, no live process"*|*"v  "*"w  failed"*) pass "D2: B still lists A's children (read-only rows)" ;; *) fail "D2: B rows ($(res_head "$OB" 3))" ;; esac
  # A reconnects (/mcp keeps its session id): its first list delivers everything.
  CLAUDE_PROJECT_DIR="$PD" CLAUDE_CODE_SESSION_ID=sessA feed "$OA3" \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' "WAIT_FOR \"id\":2 15" \
    "$(call 3 pi_list_agents '{}')" "WAIT_FOR \"id\":3 10" "$(call 4 pi_list_agents '{}')" "WAIT_FOR \"id\":4 10"
  H3="$(res_head "$OA3" 3)"
  printf '%s\n' "$H3" | grep -qE '^\[pi:v\] DONE turn 1 ok' && printf '%s\n' "$H3" | grep -qE '^\[pi:w\] FAILED turn 1 \(orphaned\)' \
    && [ "$(field_of "$(res_json "$OA3" 3)" 'events.find((e) => e.agent === "w").notes[0].reason')" = orphaned ] \
    && pass "D2: A's reconnect inlines v's DONE and w's failed{orphaned}, which carries the expired question" || fail "D2: A3 list ($H3) $(res_json "$OA3" 3)"
  [ "$(meta_eval "$CW" 'm.consumed_seq')" = "$(events_eval "$CW" 'evs[evs.length - 1].seq')" ] && [ "$(meta_eval "$CV" 'm.consumed_seq')" = "$(last_seq_of "$CV" done)" ] \
    && [ "$(meta_eval "$CW" 'm.ownerClaudeSession')" = sessA ] && ! res_head "$OA3" 4 | grep -qF '[pi:' \
    && pass "D2: A consumed them (once)" || fail "D2: A consumption w $(meta_eval "$CW" 'm.consumed_seq') v $(meta_eval "$CV" 'm.consumed_seq')"
} || true

# ---------------------------------------------------------------------------
# G. lifetime-lock reclaim is compare-and-swap
# ---------------------------------------------------------------------------
{
  GD="$(make_scratch)"; RACER="$GD/racer.mjs"
  cat > "$RACER" <<RACE
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { acquireLock, reclaimIfDead } from "$COMPANION";
const [mode, lockPath, go] = process.argv.slice(2);
const start = execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }).trim();
const stamp = { serverPid: process.pid, serverStart: start, name: "x", gen: 1 };
while (!fs.existsSync(go)) { /* spin: both racers leave together */ }
const out = mode === "acquire" ? { acquired: acquireLock(lockPath, stamp).acquired, raw: JSON.stringify(stamp) } : { reclaimed: reclaimIfDead(lockPath) };
fs.writeFileSync(go + "." + process.pid, JSON.stringify(out));
// Stay alive (a live owner) until the round has been checked.
while (!fs.existsSync(go + ".end")) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
process.stdout.write(JSON.stringify(out));
RACE
  settle() { for _ in $(seq 1 200); do [ "$(ls "$1".* 2>/dev/null | grep -vc '\.end$')" -ge 2 ] && break; sleep 0.05; done; }
  DEAD='{"serverPid":999999,"serverStart":"Thu Jan  1 00:00:00 2026","name":"x","gen":1}'
  both=0; stolen=0; rounds=40
  for r in $(seq 1 "$rounds"); do
    L="$GD/r$r.lock"; GO="$GD/go$r"; printf '%s' "$DEAD" > "$L"
    node "$RACER" acquire "$L" "$GO" > "$GD/a$r" & P1=$!
    node "$RACER" acquire "$L" "$GO" > "$GD/b$r" & P2=$!
    sleep 0.25; touch "$GO"; settle "$GO"
    [ "$(cat "$GO".[0-9]* | grep -o '"acquired":true' | wc -l | tr -d ' ')" = 2 ] && both=$((both + 1))
    touch "$GO.end"; wait "$P1" "$P2"
    # sw<r>, never go2<r>: go2<r> is also go<r'> for rounds 21-29 (go21 =
    # go2+1), whose racers then find a used barrier and .end already there,
    # exit at once, and the second one reclaims the first one's now-dead lock.
    L2="$GD/s$r.lock"; GO2="$GD/sw$r"; printf '%s' "$DEAD" > "$L2"
    node "$RACER" sweep "$L2" "$GO2" > "$GD/x$r" & P1=$!
    node "$RACER" acquire "$L2" "$GO2" > "$GD/y$r" & P2=$!
    sleep 0.25; touch "$GO2"; settle "$GO2"
    Y="$GO2.$P2"
    if grep -qF '"acquired":true' "$Y"; then
      [ "$(cat "$L2" 2>/dev/null)" = "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).raw)' "$Y")" ] || stolen=$((stolen + 1))
    fi
    touch "$GO2.end"; wait "$P1" "$P2"
  done
  [ "$both" = 0 ] && pass "G: two acquirers over one dead lock: never both acquired ($rounds rounds)" || fail "G: both acquired in $both / $rounds rounds"
  [ "$stolen" = 0 ] && pass "G: a dead-lock sweep never deleted a lock a live acquirer took ($rounds rounds)" || fail "G: live lock gone in $stolen / $rounds rounds"
  [ "$(cat "$GD"/s*.lock 2>/dev/null | grep -c 999999)" = 0 ] && pass "G: every sweep round ended with the dead stamp gone" || fail "G: a dead stamp survived a sweep round"
  ls "$GD" | grep -qF '.reclaim' && fail "G: a reclaim mutex was left behind" || pass "G: no reclaim mutex left behind"
} || true

# ---------------------------------------------------------------------------
# H. commands name only tools that exist
# ---------------------------------------------------------------------------
{
  OUT="$(make_scratch)/h.jsonl"
  CLAUDE_PROJECT_DIR="$(make_scratch)" feed "$OUT" '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' "WAIT_FOR \"id\":2 10"
  MISSING="$(node -e '
    const fs = require("fs"), path = require("path");
    let tools = [];
    for (const l of fs.readFileSync(process.argv[1], "utf8").split("\n")) { try { const o = JSON.parse(l); if (o.id === 2) tools = o.result.tools.map((t) => t.name); } catch {} }
    const dir = process.argv[2]; const bad = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      const named = new Set([...text.matchAll(/mcp__plugin_pi-delegate_pi-delegate__(\w+)/g)].map((m) => m[1]));
      for (const m of text.matchAll(/`(pi_[a-z_]+)/g)) named.add(m[1]);
      for (const n of named) if (!tools.includes(n)) bad.push(`${f}: ${n}`);
    }
    process.stdout.write(tools.length ? bad.join(", ") : "tools/list empty");
  ' "$OUT" "$PLUGIN_ROOT/commands")"
  [ -z "$MISSING" ] && pass "H: every pi tool named in commands/*.md is in tools/list" || fail "H: commands name missing/renamed tools: $MISSING"
  # Claude Code defers MCP tools behind ToolSearch unless a tool says
  # _meta["anthropic/alwaysLoad"]: the counterparts of Agent, SendMessage,
  # ListAgents and TaskOutput, and pi_answer, must be in context.
  LOADED="$(node -e '
    for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) { try { const o = JSON.parse(l); if (o.id === 2) process.stdout.write(o.result.tools.filter((t) => t._meta && t._meta["anthropic/alwaysLoad"] === true).map((t) => t.name).sort().join(",")); } catch {} }' "$OUT")"
  [ "$LOADED" = "pi_agent,pi_answer,pi_list_agents,pi_read,pi_send_message" ] && pass "H: always loaded: $LOADED" || fail "H: alwaysLoad tools: $LOADED"
} || true

# ---------------------------------------------------------------------------
# I. pi_read events / pi_list_agents {name}: bounded payloads
# ---------------------------------------------------------------------------
{
  PI_="$(make_scratch)"; OUT="$(make_scratch)/i.jsonl"; CI="$(child_dir "$PI_" big)"; mkdir -p "$CI/results"
  node -e '
    const fs = require("fs"); const dir = process.argv[1]; const big = "R".repeat(4000); const lines = [];
    for (let i = 1; i <= 120; i++) lines.push(JSON.stringify({ seq: i, ts: new Date().toISOString(), gen: 1, pid: null, turn: i, type: "done",
      data: { ok: true, result: big, resultChars: 9000, resultFile: dir + "/results/1-" + i + ".md", usage: { totalTokens: 1000 }, stderrTail: "E".repeat(2000), riders: [{ kind: "note", topic: "risk", text: "N".repeat(500) }] } }));
    fs.writeFileSync(dir + "/events.jsonl", lines.join("\n") + "\n");
    fs.writeFileSync(dir + "/meta.json", JSON.stringify({ name: "big", gen: 1, turn: 120, state: "stopped", last_seq: 120, consumed_seq: 120 }));
  ' "$CI"
  CLAUDE_PROJECT_DIR="$PI_" feed "$OUT" \
    "$(call 2 pi_read '{"name":"big","what":"events"}')" "$(call 3 pi_read '{"name":"big","what":"events","last":1000}')" \
    "$(call 4 pi_agent '{"name":"lv","prompt":"one","run_in_background":false}')" "WAIT_FOR \"id\":4 10" \
    "$(call 5 pi_list_agents '{"name":"lv"}')" "WAIT_FOR \"id\":5 10" "$(call 6 pi_stop '{"name":"lv"}')" "WAIT_FOR \"id\":6 10"
  T2="$(inner_for_id "$OUT" 2 | wc -c | tr -d ' ')"; T3="$(inner_for_id "$OUT" 3 | wc -c | tr -d ' ')"; J3="$(res_json "$OUT" 3)"; H3="$(res_head "$OUT" 3)"
  # Claude Code caps an MCP result at 25000 tokens by default: the text has a
  # 20000-char budget, the JSON only {seq, gen, turn, type} per event.
  NL3="$(printf '%s\n' "$H3" | grep -cE '^#[0-9]+ ')"
  [ "$T2" -lt 6000 ] && [ "$T3" -lt 26000 ] && [ "${#H3}" -lt 20400 ] && [ "$(field_of "$J3" 'events.length')" = "$NL3" ] && [ "$NL3" -lt 100 ] \
    && [ "$(field_of "$J3" total)" = 120 ] && printf '%s\n' "$H3" | tail -1 | grep -qxF "+$((120 - NL3)) earlier not shown; pi_read {name:\"big\", what:\"events\", turn:<t>} (or gen:<g>) narrows to one turn" \
    && printf '%s\n' "$H3" | grep -E '^#[0-9]+ ' | tail -1 | grep -qE '^#120 ' \
    && pass "I: pi_read events: default $T2 chars; last:1000 stays under budget ($T3 chars, newest $NL3 of 120 shown, pointer to the rest)" || fail "I: pi_read events sizes $T2 / $T3, head ${#H3}, lines $NL3, json $(field_of "$J3" 'events.length'), tail: $(printf '%s\n' "$H3" | tail -1)"
  [ "$(field_of "$J3" 'events.length && Object.keys(d.events[0]).sort().join()')" = "gen,seq,turn,type" ] && ! printf '%s' "$J3" | grep -qF 'RRRR' \
    && pass "I: each event once: a text line; the JSON has only seq/gen/turn/type" || fail "I: events JSON fields ($(field_of "$J3" 'events[0]'))"
  J5="$(res_json "$OUT" 5)"
  [ "$(field_of "$J5" ok)" = true ] && [ "$(field_of "$J5" header)" = null ] && [ "$(field_of "$J5" outputFile)" = null ] && [ "$(field_of "$J5" stderrTail)" = null ] \
    && [ "$(field_of "$J5" 'channel.lastTurnResult.finalText')" = null ] && [ "$(field_of "$J5" 'channel.lastTurnResult.resultChars')" = 7 ] \
    && [ "${#J5}" -lt 2500 ] && pass "I: pi_list_agents {name} JSON: no header/outputFile/stderrTail duplicates, no finalText (${#J5} chars)" || fail "I: detail JSON (${#J5}): $J5"
} || true


# ---------------------------------------------------------------------------
# J. a live peer server recovers an orphan (not only a starting server)
# ---------------------------------------------------------------------------
export -f events_eval meta_eval
types_of() { events_eval "$1" 'evs.map((e) => e.type + (e.data && e.data.reason ? ":" + e.data.reason : "")).join(",")'; }
export -f types_of
# peer_orphan <project> <tag> <B's entries...>: session B's server starts first
# and waits; session A's server spawns w, which blocks on a question, then A's
# server is SIGKILLed (w dies with it on stdin EOF, as real pi does). Only then
# do B's entries run. Leaves <tag>-b.jsonl (B's output) and <tag>.before (the
# journal right after the kill) in the scratch dir it prints.
peer_orphan() {
  local P="$1" tag="$2"; shift 2
  local D; D="$(make_scratch)"
  local OB="$D/$tag-b.jsonl" FLAG="$D/$tag-flag" PIDS="$D/$tag-pids"; : > "$PIDS"
  ( CLAUDE_PROJECT_DIR="$P" CLAUDE_CODE_SESSION_ID=sessB PI_STUB_PID_FILE="$PIDS" FEED_TIMEOUT=60 feed "$OB" \
      '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
      "SH for _i in \$(seq 1 300); do [ -f '$FLAG' ] && break; sleep 0.1; done" "$@" ) &
  local FB=$!
  for _ in $(seq 1 100); do grep -qF '"id":2' "$OB" 2>/dev/null && break; sleep 0.1; done
  ( CLAUDE_PROJECT_DIR="$P" CLAUDE_CODE_SESSION_ID=sessA PI_STUB_ASKS=1 PI_STUB_ASK_WAIT_MS=30000 PI_STUB_PID_FILE="$PIDS" feed "$D/$tag-a.jsonl" \
      "$(call 2 pi_agent '{"name":"w","prompt":"go"}')" "WAIT_FOR \"id\":2 10" "SLEEP 0.3" \
      "SH kill -9 \$(ps -o ppid= -p \$(head -1 '$PIDS'))" ) 2>/dev/null
  sleep 0.5
  local KID; KID="$(head -1 "$PIDS")"
  echo "$(types_of "$(child_dir "$P" w)")|$(meta_eval "$(child_dir "$P" w)" 'm.state + ":" + m.ownerClaudeSession')|$(kill -0 "$KID" 2>/dev/null && echo alive || echo dead)|$(kill -0 "$FB" 2>/dev/null && echo b-live || echo b-gone)" > "$D/$tag.before"
  touch "$FLAG"; wait "$FB" 2>/dev/null
  echo "$D"
}
{
  # J1: B lists, then resumes.
  PJ="$(make_scratch)"; CJ="$(child_dir "$PJ" w)"
  JD="$(peer_orphan "$PJ" j1 \
    "$(call 3 pi_list_agents '{}')" "WAIT_FOR \"id\":3 15" \
    "SH echo \"\$(types_of '$CJ')|\$(meta_eval '$CJ' 'm.state + \":\" + m.ownerClaudeSession + \":\" + m.ownerServerPid')\" > '$CJ.afterlist'" \
    "$(call 4 pi_send_message '{"to":"w","message":"again"}')" "WAIT_FOR \"id\":4 15")"
  OB="$JD/j1-b.jsonl"
  [ "$(cat "$JD/j1.before")" = "spawned,question|waiting:sessA|dead|b-live" ] \
    && pass "J1: setup: B already running; A's server SIGKILLed with w waiting; w died; journal still open" || fail "J1: setup $(cat "$JD/j1.before")"
  [ "$(cat "$CJ.afterlist")" = "spawned,question,question_expired:orphaned,failed:orphaned|failed:sessA:null" ] \
    && pass "J1: B's pi_list_agents recovered it: question_expired{orphaned} + failed{orphaned}, handed back to session A" || fail "J1: after B's list: $(cat "$CJ.afterlist")"
  res_head "$OB" 3 | grep -qE '^w  failed  turn 1  gen 1  [0-9]+s  \(orphaned: its MCP server exited\)' \
    && pass "J1: B's list shows w failed (orphaned), not 'waiting, no live process'" || fail "J1: B's list ($(res_head "$OB" 3))"
  [ "$(pushes_of "$OB" w failed)" = 0 ] && ! res_head "$OB" 3 | grep -qF '[pi:w]' && pass "J1: B neither pushed nor inlined session A's event" || fail "J1: B pushed/inlined A's event"
  H4="$(res_head "$OB" 4)"
  case "$H4" in "delivered resumed to pi:w (turn 2)"*"earlier events of pi:w not shown before:"*"[pi:w] FAILED turn 1 (orphaned)"*) pass "J1: B's resume says resumed and carries the orphaned turn's FAILED" ;; *) fail "J1: resume ($H4)" ;; esac
  # (B's exit then parks the resumed child: parked:claude_exit.)
  [ "$(types_of "$CJ")" = "spawned,question,question_expired:orphaned,failed:orphaned,spawned,done,parked:claude_exit" ] \
    && pass "J1: journal: the orphaned turn is closed before the resumed turn" || fail "J1: journal $(types_of "$CJ")"
} || true
{
  # J2: B resumes by name without listing first.
  PJ="$(make_scratch)"; CJ="$(child_dir "$PJ" w)"
  JD="$(peer_orphan "$PJ" j2 "$(call 3 pi_send_message '{"to":"w","message":"again"}')" "WAIT_FOR \"id\":3 15")"
  OB="$JD/j2-b.jsonl"
  [ "$(cut -d'|' -f1,3,4 "$JD/j2.before")" = "spawned,question|dead|b-live" ] && pass "J2: setup (B live, w dead, journal open)" || fail "J2: setup $(cat "$JD/j2.before")"
  [ "$(types_of "$CJ")" = "spawned,question,question_expired:orphaned,failed:orphaned,spawned,done,parked:claude_exit" ] \
    && [ "$(events_eval "$CJ" 'evs.find((e) => e.type === "failed").data.riders[0].reason')" = orphaned ] \
    && pass "J2: resume by name closed the orphaned turn first (question_expired rides on failed{orphaned})" || fail "J2: journal $(types_of "$CJ")"
  case "$(res_head "$OB" 3)" in "delivered resumed to pi:w (turn 2)"*"[pi:w] FAILED turn 1 (orphaned)"*) pass "J2: the resume's response carries the FAILED" ;; *) fail "J2: resume ($(res_head "$OB" 3))" ;; esac
  [ "$(meta_eval "$CJ" 'm.ownerClaudeSession')" = sessB ] && [ "$(meta_eval "$CJ" 'm.consumed_seq')" -ge "$(last_seq_of "$CJ" done)" ] \
    && pass "J2: B took the child over and consumed what it was shown" || fail "J2: meta $(meta_eval "$CJ" 'm.ownerClaudeSession + " " + m.consumed_seq')"
} || true
{
  # J3: B stops it without listing first.
  PJ="$(make_scratch)"; CJ="$(child_dir "$PJ" w)"
  JD="$(peer_orphan "$PJ" j3 "$(call 3 pi_stop '{"name":"w"}')" "WAIT_FOR \"id\":3 15")"
  OB="$JD/j3-b.jsonl"
  [ "$(types_of "$CJ")" = "spawned,question,question_expired:orphaned,failed:orphaned,stopped" ] && [ "$(meta_eval "$CJ" 'm.state')" = stopped ] \
    && case "$(res_head "$OB" 3)" in "stopped pi:w (was waiting). Session kept;"*) true ;; *) false ;; esac \
    && pass "J3: B's pi_stop closed the orphaned turn, then recorded stopped" || fail "J3: journal $(types_of "$CJ") head $(res_head "$OB" 3)"
} || true

# ---------------------------------------------------------------------------
# K. the lifetime lock is the ownership check for every mutating tool
# ---------------------------------------------------------------------------
{
  PK="$(make_scratch)"; AG="$(make_scratch)/agent"; OUT="$(make_scratch)/k.jsonl"; OUT2="$(make_scratch)/k2.jsonl"; OUT3="$(make_scratch)/k3.jsonl"
  CK="$(child_dir "$PK" asky)"; LK="$(lock_of "$PK" asky)"
  SD="$AG/sessions/$(pi_session_slug "$PK")"; mkdir -p "$SD"; SF="$SD/2026-10-01T12-41-50-263Z_asky-g1-teststore.jsonl"
  printf '%s\n' '{"type":"session","id":"asky-g1-teststore"}' > "$SF"
  CLAUDE_PROJECT_DIR="$PK" PI_CODING_AGENT_DIR="$AG" feed "$OUT" \
    "$(call 2 pi_agent '{"name":"asky","prompt":"one","run_in_background":false}')" "WAIT_FOR \"id\":2 10" \
    "$(call 3 pi_stop '{"name":"asky"}')" "WAIT_FOR \"id\":3 10"
  # Another live server resuming it: it holds the lock, meta still says stopped.
  sleep 60 & LIVE=$!
  printf '{"serverPid":%s,"serverStart":"%s","name":"asky","gen":1}' "$LIVE" "$(LC_ALL=C ps -o lstart= -p "$LIVE" | sed 's/^ *//;s/ *$//')" > "$LK"
  CLAUDE_PROJECT_DIR="$PK" PI_CODING_AGENT_DIR="$AG" feed "$OUT2" \
    "$(call 2 pi_stop '{"name":"asky","forget":true}')" "$(call 3 pi_send_message '{"to":"asky","message":"x"}')" \
    "$(call 4 pi_agent '{"name":"asky","prompt":"x"}')" "$(call 5 pi_stop '{"name":"asky"}')" "$(call 6 pi_list_agents '{}')" "WAIT_FOR \"id\":6 10"
  [ "$(meta_eval "$CK" 'm.state')" = stopped ] && pass "K: setup: asky stopped, lock held by live pid $LIVE" || fail "K: setup state $(meta_eval "$CK" 'm.state')"
  ok=1; for id in 2 3 4 5; do case "$(field_of "$(res_json "$OUT2" "$id")" errorMessage)" in "pi:asky is owned by another Claude session (server pid $LIVE, since "*) ;; *) ok=0; echo "    id $id: $(res_json "$OUT2" "$id")" >&2 ;; esac; done
  [ "$ok" = 1 ] && pass "K: stop {forget}, send, pi_agent and stop all get the owner error" || fail "K: owner errors"
  [ -f "$SF" ] && [ -f "$CK/meta.json" ] && [ "$(meta_eval "$CK" 'm.state')" = stopped ] && [ "$(types_of "$CK" | tr ',' '\n' | grep -c '^stopped$')" = 1 ] \
    && pass "K: session file, record and journal untouched" || fail "K: sf $([ -f "$SF" ] && echo kept) meta $(meta_eval "$CK" 'm.state') journal $(types_of "$CK")"
  res_head "$OUT2" 6 | grep -qE "^asky  stopped  turn 1  gen 1  [0-9]+s  \\(other session, server pid $LIVE\\)" && pass "K: the list shows it as the other session's" || fail "K: list ($(res_head "$OUT2" 6))"
  # The lock holder dies: the lock is stale and the stop goes through.
  kill "$LIVE" 2>/dev/null; wait "$LIVE" 2>/dev/null
  CLAUDE_PROJECT_DIR="$PK" PI_CODING_AGENT_DIR="$AG" feed "$OUT3" "$(call 2 pi_stop '{"name":"asky","forget":true}')" "WAIT_FOR \"id\":2 10"
  case "$(res_head "$OUT3" 2)" in "stopped pi:asky (was stopped) and forgot it: removed session file(s): "*"/2026-10-01T12-41-50-263Z_asky-g1-teststore.jsonl. The name is free.") [ ! -e "$SF" ] && [ ! -e "$CK" ] && [ ! -e "$LK" ] && pass "K: once the holder is dead, forget works and frees the lock" || fail "K: leftovers sf/ck/lk" ;; *) fail "K: forget after holder died ($(inner_for_id "$OUT3" 2))" ;; esac
} || true

# ---------------------------------------------------------------------------
# L. pairDanglingToolCalls: the one write into pi's own session file
# ---------------------------------------------------------------------------
# l_setup <project> <agent-dir> <name> <state> <session-file-content-file> [pid procStart]
l_setup() {
  local P="$1" AGD="$2" N="$3" ST="$4" SRC="$5" PID="${6:-}" PST="${7:-}"
  local SD; SD="$AGD/sessions/$(pi_session_slug "$P")"; mkdir -p "$SD"
  local SF="$SD/2026-10-01T10-00-00-000Z_$N-g1.jsonl"; cp "$SRC" "$SF"
  local C; C="$(child_dir "$P" "$N")"; mkdir -p "$C/results"
  node -e '
    const [dir, name, state, sf, pid, pst] = process.argv.slice(1);
    const meta = { name, gen: 1, turn: 1, state, sessionId: name + "-g1", sessionFile: sf, ownerServerPid: 999999, ownerServerStart: "Thu Jan  1 00:00:00 2026",
      ownerClaudeSession: null, last_seq: 2, consumed_seq: 2, instance: "l0000000",
      launch: { sessionId: name + "-g1", provider: "stub", model: "stub-model", ask: true, turnTimeoutMs: 60000 }, provider: "stub", model: "stub-model" };
    if (pid) Object.assign(meta, { pid: Number(pid), pgid: Number(pid), procStart: pst });
    require("fs").writeFileSync(dir + "/meta.json", JSON.stringify(meta));
    const t = new Date().toISOString();
    require("fs").writeFileSync(dir + "/events.jsonl", JSON.stringify({ seq: 1, ts: t, gen: 1, pid: null, turn: 0, type: "spawned", data: { sessionId: name + "-g1" } }) + "\n"
      + JSON.stringify({ seq: 2, ts: t, gen: 1, pid: null, turn: 1, type: "note", data: { topic: "risk", text: "x" } }) + "\n");
  ' "$C" "$N" "$ST" "$SF" "$PID" "$PST"
  echo "$SF"
}
{
  PL="$(make_scratch)"; AG="$(make_scratch)/agent"; LD="$(make_scratch)"; OUT="$(make_scratch)/l.jsonl"; OUT2="$(make_scratch)/l2.jsonl"
  # A session whose last assistant message made two calls; bash got its result,
  # ask_parent did not (the child died inside it).
  printf '%s\n' '{"type":"session","version":3,"id":"pr-g1","timestamp":"2026-10-01T10:00:00.000Z","cwd":"/x"}' \
    '{"type":"message","id":"a0000001","parentId":null,"timestamp":"2026-10-01T10:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"go"}],"timestamp":1}}' \
    '{"type":"message","id":"a0000002","parentId":"a0000001","timestamp":"2026-10-01T10:00:02.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"call_a","name":"bash","arguments":{}},{"type":"toolCall","id":"call_b|fc_1","name":"ask_parent","arguments":{}}],"timestamp":2}}' \
    '{"type":"message","id":"a0000003","parentId":"a0000002","timestamp":"2026-10-01T10:00:03.000Z","message":{"role":"toolResult","toolCallId":"call_a","toolName":"bash","content":[{"type":"text","text":"ok"}],"isError":false,"timestamp":3}}' > "$LD/good.jsonl"
  # The same, its last line torn mid-write.
  head -c "$(( $(wc -c < "$LD/good.jsonl") - 40 ))" "$LD/good.jsonl" > "$LD/torn.jsonl"
  SF1="$(l_setup "$PL" "$AG" pr running "$LD/good.jsonl")"
  SF2="$(l_setup "$PL" "$AG" tr waiting "$LD/torn.jsonl")"
  # An orphan that will not die: a recorded process (its argv names its
  # session) whose parent never reaps it, so TERM/KILL leave a zombie.
  ZP="$LD/zpid"
  perl -e 'my $p = fork; if (!$p) { setpgrp(0, 0); exec "perl", "-e", "sleep 60", "--", "--session-id", "zz-g1"; } open(F, ">", $ARGV[0]); print F "$p\n"; close F; sleep 60;' "$ZP" & ZPARENT=$!
  for _ in $(seq 1 50); do [ -s "$ZP" ] && break; sleep 0.1; done; ZPID="$(cat "$ZP")"
  SF3="$(l_setup "$PL" "$AG" zz running "$LD/good.jsonl" "$ZPID" "$(LC_ALL=C ps -o lstart= -p "$ZPID" | sed 's/^ *//;s/ *$//')")"
  CLAUDE_PROJECT_DIR="$PL" PI_CODING_AGENT_DIR="$AG" FEED_TIMEOUT=60 feed "$OUT" \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' "$(call 3 pi_read '{"name":"pr","what":"result"}')" "WAIT_FOR \"id\":3 20"
  node -e '
    const fs = require("fs");
    const before = fs.readFileSync(process.argv[2], "utf8"), after = fs.readFileSync(process.argv[1], "utf8");
    const ls = after.trim().split("\n").map((l) => JSON.parse(l));
    const add = ls.slice(4);
    const ids = ls.map((e) => e.id).filter(Boolean);
    const ok = after.startsWith(before) && add.length === 1 && add[0].type === "message" && add[0].parentId === "a0000003"
      && /^[0-9a-f]{8}$/.test(add[0].id) && new Set(ids).size === ids.length
      && add[0].message.role === "toolResult" && add[0].message.toolCallId === "call_b|fc_1" && add[0].message.toolName === "ask_parent"
      && add[0].message.isError === false && add[0].message.content[0].text === "[parent unavailable: MCP server restarted]";
    process.stdout.write(ok ? "ok" : JSON.stringify(add));
  ' "$SF1" "$LD/good.jsonl" > "$LD/l1"
  [ "$(cat "$LD/l1")" = ok ] && pass "L1: exactly one toolResult appended (the unanswered ask_parent), parentId = old leaf, unique 8-hex id, prefix unchanged" || fail "L1: appended $(cat "$LD/l1")"
  [ "$(events_eval "$(child_dir "$PL" pr)" 'JSON.stringify(evs.find((e) => e.type === "failed").data.pairedToolCalls)')" = '["call_b|fc_1"]' ] \
    && pass "L1: failed{orphaned} records the paired toolCall" || fail "L1: failed event $(events_eval "$(child_dir "$PL" pr)" 'JSON.stringify(evs.map((e) => e.type))')"
  cmp -s "$SF2" "$LD/torn.jsonl" && [ "$(types_of "$(child_dir "$PL" tr)")" = "spawned,note,failed:orphaned" ] \
    && pass "L2: a torn session file is left byte-identical (the orphan is still recorded failed)" || fail "L2: torn file changed or journal $(types_of "$(child_dir "$PL" tr)")"
  ZSTATE="$(LC_ALL=C ps -o stat= -p "$ZPID" | tr -d ' ')"
  cmp -s "$SF3" "$LD/good.jsonl" && [ "$(types_of "$(child_dir "$PL" zz)")" = "spawned,note" ] && [ "$(meta_eval "$(child_dir "$PL" zz)" 'm.state')" = running ] \
    && pass "L3: an orphan that would not die (stat $ZSTATE): session file, journal and record untouched" || fail "L3: zz file $(cmp -s "$SF3" "$LD/good.jsonl" && echo same || echo changed) journal $(types_of "$(child_dir "$PL" zz)") state $(meta_eval "$(child_dir "$PL" zz)" 'm.state')"
  kill "$ZPARENT" 2>/dev/null; wait "$ZPARENT" 2>/dev/null
  # Resume reads the session and pairs nothing more.
  cp "$SF1" "$LD/paired.jsonl"
  CLAUDE_PROJECT_DIR="$PL" PI_CODING_AGENT_DIR="$AG" feed "$OUT2" "$(call 2 pi_send_message '{"to":"pr","message":"again"}')" "WAIT_FOR \"id\":2 15" "$(call 3 pi_stop '{"name":"pr"}')" "WAIT_FOR \"id\":3 10"
  case "$(res_head "$OUT2" 2)" in "delivered resumed to pi:pr (turn 2)"*) cmp -s "$SF1" "$LD/paired.jsonl" && pass "L4: resume after pairing works and appends nothing more" || fail "L4: resume changed the file" ;; *) fail "L4: resume ($(inner_for_id "$OUT2" 2))" ;; esac
} || true

finish
