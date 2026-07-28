#!/usr/bin/env bash
# Edge-case stubs + new-suite for pi-companion.mjs task.
# Covers: child exits early, garbage interleaved, child dies mid-stream,
# text-fail response, Unicode echo, empty task string.
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"

# ---------------------------------------------------------------------------
# A. exit-early: stub ignores stdin, exits 1 immediately.
#    Companion should return ok:false with a non-null errorMessage,
#    and must not hang (completes within 15s).
# ---------------------------------------------------------------------------
use_stub pi-rpc-exit-early
out_a="$scratch/edge-a.json"
start=$SECONDS
rc=0
timeout 30 node "$COMPANION" task "x" --json --timeout 10000 > "$out_a" 2>/dev/null || rc=$?
elapsed=$((SECONDS - start))

check "exit-early: nonzero exit or ok:false" test "$rc" -ne 0 || node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).ok ? 1 : 0)' "$out_a"
assert_json "exit-early: ok:false" "$out_a" 'r.ok === false'
check "exit-early: errorMessage non-null" test -n "$(json_get "$out_a" 'r.errorMessage')"
check "exit-early: completes within 15s (got ${elapsed}s)" test "$elapsed" -le 15

# ---------------------------------------------------------------------------
# B. garbage-mixed: stub interleaves invalid JSON + unknown events among
#    the valid flow. The RPC parser must tolerate and still complete.
# ---------------------------------------------------------------------------
use_stub pi-rpc-garbage-mixed
out_b="$scratch/edge-b.json"
rc=0
timeout 30 node "$COMPANION" task "say ok" --json --timeout 15000 > "$out_b" || rc=$?
check "garbage-mixed: ok:true" test "$rc" -eq 0 || node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).ok ? 0 : 1)' "$out_b"
assert_json "garbage-mixed: ok:true" "$out_b" 'r.ok === true'
assert_json "garbage-mixed: finalText non-empty" "$out_b" 'r.finalText && r.finalText.length > 0'

# ---------------------------------------------------------------------------
# C. die-midstream: stub emits response + agent_start then exits 1 (no settle).
#    Companion should detect child death and return ok:false.
#    IMPORTANT: must NOT wait for the full timeout — the child exiting should end it.
# ---------------------------------------------------------------------------
use_stub pi-rpc-die-midstream
out_c="$scratch/edge-c.json"
start=$SECONDS
rc=0
timeout 30 node "$COMPANION" task "x" --json --timeout 10000 > "$out_c" 2>/dev/null || rc=$?
elapsed=$((SECONDS - start))

check "die-midstream: ok:false" node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).ok ? 1 : 0)' "$out_c"
check "die-midstream: errorMessage mentions agent_settled or stream" node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).errorMessage && /agent_settled|stream|rpc invocation/i.test(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).errorMessage) ? 0 : 1)' "$out_c"
check "die-midstream: completes within 15s (got ${elapsed}s)" test "$elapsed" -le 15

# If it took >= timeout (10s) to complete, note the finding
if [ "$elapsed" -ge 10 ]; then
  echo "  FINDING: die-midstream took ${elapsed}s — may not be reacting to child death promptly" >&2
fi

# ---------------------------------------------------------------------------
# D. text-fail: normal flow through agent_settled, but get_last_assistant_text
#    returns success:false with error message.
# ---------------------------------------------------------------------------
use_stub pi-rpc-text-fail
out_d="$scratch/edge-d.json"
rc=0
timeout 30 node "$COMPANION" task "x" --json --timeout 15000 > "$out_d" || rc=$?
check "text-fail: ok:false" node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).ok ? 1 : 0)' "$out_d"
assert_json "text-fail: errorMessage contains 'no assistant text available'" "$out_d" 'r.errorMessage && r.errorMessage.includes("no assistant text available")'

# ---------------------------------------------------------------------------
# E. unicode: stub echoes the prompt message back verbatim via get_last_assistant_text.
#    finalText must exactly equal the prompt string (byte-for-byte).
# ---------------------------------------------------------------------------
use_stub pi-rpc-echo
unicode_task='héllo 🌍 ünïcode → ✓'
out_e="$scratch/edge-e.json"
rc=0
timeout 30 node "$COMPANION" task "$unicode_task" --json --timeout 15000 > "$out_e" || rc=$?
check "unicode: ok:true" test "$rc" -eq 0 || node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).ok ? 0 : 1)' "$out_e"
assert_json "unicode: finalText non-empty" "$out_e" 'r.finalText && r.finalText.length > 0'
# Byte-for-byte comparison via node (avoids bash locale mangling)
check "unicode: finalText exactly equals prompt" \
  node -e '
    const fs = require("fs");
    const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.exit(r.finalText === process.argv[2] ? 0 : 1);
  ' "$out_e" "$unicode_task"

# ---------------------------------------------------------------------------
# F. empty text: no stub interaction needed — runTaskRpc rejects immediately.
#    But we still need a valid `pi` on PATH so the harness works.
# ---------------------------------------------------------------------------
use_stub pi-rpc-exit-early   # any stub suffices; runTaskRpc returns before spawning
out_f="$scratch/edge-f.json"
rc=0
timeout 10 node "$COMPANION" task "" --json > "$out_f" 2>/dev/null || rc=$?
check "empty-text: ok:false" node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).ok ? 1 : 0)' "$out_f"
assert_json "empty-text: errorMessage 'no task text provided'" "$out_f" 'r.errorMessage && r.errorMessage.includes("no task text provided")'

finish
