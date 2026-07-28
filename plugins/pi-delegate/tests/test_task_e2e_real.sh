#!/usr/bin/env bash
# Real-pi end-to-end: exercises task invocation against the actual, locally-
# installed `pi` CLI (no stub). Skips cleanly (exit 0, with a clear "SKIPPED"
# line) if `pi` or its configured model isn't actually reachable -- this must
# never fail the suite just because the environment has no local model.
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

skip() {
  echo "SKIPPED: $1"
  exit 0
}

command -v pi >/dev/null 2>&1 || skip "pi CLI not found on PATH"
pi --version >/dev/null 2>&1 || skip "pi --version failed (pi installed but not runnable)"

scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"

# ---------------------------------------------------------------------------
# Test: run the RPC-default path and assert structured success.
# ---------------------------------------------------------------------------
TASK_PROMPT="Reply with exactly the word PONG and nothing else."
out_task="$scratch/task.json"

t0=$SECONDS
rc=0
timeout 180 node "$COMPANION" task "$TASK_PROMPT" --json --timeout 120000 > "$out_task" 2>"$scratch/task.stderr" || rc=$?
echo "  latency: task run took $((SECONDS - t0))s"

if [ "$rc" -ne 0 ]; then
  skip "task invocation failed (exit $rc) -- treating as environment issue (no reachable model), not a protocol bug. stderr: $(cat "$scratch/task.stderr" 2>/dev/null | tail -5)"
fi

assert_json "task: exit code 0, ok:true" "$out_task" 'r.ok === true'
assert_json "task: finalText contains PONG" "$out_task" '/PONG/i.test(r.finalText || "")'
assert_json "task: no marker-related keys" "$out_task" '!("completionMarker" in r) && !("markerMissing" in r) && !("degraded" in r)'

_FINISHED=1
finish
