#!/usr/bin/env bash
# Drives `conversation read` directly against a hand-built fixture jsonl (no
# `pi` stub needed -- readConversation is lock-free and never spawns anything).
# Proves: strict file-order rendering (NOT timestamp-sort), --json structure,
# --last N slicing, and that a mid-turn tool call with no result yet renders
# as "(pending)" instead of throwing.
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"
name="convtest-read-$$"

sess_dir="$(pi_sessions_dir "$scratch")"
mkdir -p "$sess_dir"
sess_file="$sess_dir/2026-07-28T00-00-00_${name}.jsonl"
cp "$TESTS_DIR/fixtures/session_read_sample.jsonl" "$sess_file"

# --- text mode: full read ---
out_text="$scratch/read_text.json"
node "$COMPANION" conversation read "$name" --json > "$out_text"
rc=$?
check "read: exit code 0" test "$rc" -eq 0
assert_json "read: ok:true" "$out_text" 'r.ok === true'

# --- json structure ---
assert_json "read: 6 renderable entries" "$out_text" \
  'JSON.parse(r.summary).entries.length === 6'
assert_json "read: truncatedLines counts the malformed line" "$out_text" \
  'JSON.parse(r.summary).truncatedLines === 1'
assert_json "read: sessionFile is the chosen file" "$out_text" \
  "JSON.parse(r.summary).sessionFile === \"$sess_file\""

# --- file-order proof: the steer entry (timestamp 2500, LAST in the file) must
# render AFTER the pending-toolCall entry (timestamp 4000, second-to-last in
# the file) -- if the implementation ever sorts by timestamp instead of file
# order, this flips and the test catches it.
assert_json "read: file-order (steer entry is index 5, not timestamp-sorted)" "$out_text" '
  (() => {
    const entries = JSON.parse(r.summary).entries;
    const last = entries[entries.length - 1];
    const secondLast = entries[entries.length - 2];
    return last.gist.includes("GAMMA") && last.timestamp === 2500 &&
      secondLast.timestamp === 4000 && last.timestamp < secondLast.timestamp;
  })()
'

# --- pending tool call renders without throwing ---
assert_json "read: pending toolCall entry has no toolResult gist crash" "$out_text" '
  (() => {
    const entries = JSON.parse(r.summary).entries;
    const pendingEntry = entries.find(e => e.gist.includes("sleep 5"));
    return !!pendingEntry && !pendingEntry.gist.includes("undefined");
  })()
'

# --- toolResult with output renders correctly ---
assert_json "read: toolResult entry gist contains its output" "$out_text" '
  JSON.parse(r.summary).entries.some(e => e.gist.includes("file1"))
'

# --- --last N slicing ---
out_last="$scratch/read_last.json"
node "$COMPANION" conversation read "$name" --json --last 2 > "$out_last"
rc=$?
check "read --last 2: exit code 0" test "$rc" -eq 0
assert_json "read --last 2: exactly 2 entries" "$out_last" \
  'JSON.parse(r.summary).entries.length === 2'
assert_json "read --last 2: keeps the LAST two in file order" "$out_last" '
  (() => {
    const entries = JSON.parse(r.summary).entries;
    return entries[0].timestamp === 4000 && entries[1].timestamp === 2500;
  })()
'

# --- text mode (no --json): line order in stdout matches file order.
# printTaskResult's text branch prints result.finalText raw (no JSON envelope
# in this mode), so read the plain-text output directly.
out_plain="$scratch/read_plain.txt"
node "$COMPANION" conversation read "$name" > "$out_plain"
rc=$?
check "read (text mode): exit code 0" test "$rc" -eq 0
if node -e '
  const fs = require("fs");
  const lines = fs.readFileSync(process.argv[1], "utf8").split("\n");
  const gammaIdx = lines.findIndex(l => l.includes("GAMMA"));
  const sleepIdx = lines.findIndex(l => l.includes("sleep 5"));
  process.exit(gammaIdx > sleepIdx && sleepIdx !== -1 ? 0 : 1);
' "$out_plain"; then
  pass "read (text mode): line order is file order, not timestamp order"
else
  fail "read (text mode): line order is file order, not timestamp order"
  cat "$out_plain" >&2
fi

# --- missing session -> ok:false, clear error ---
out_missing="$scratch/read_missing.json"
rc=0
node "$COMPANION" conversation read "no-such-session-$$" --json > "$out_missing" || rc=$?
check "read missing session: exit code 1" test "$rc" -eq 1
assert_json "read missing session: ok:false" "$out_missing" 'r.ok === false'
assert_json "read missing session: errorMessage mentions the name" "$out_missing" \
  '/no session found/.test(r.errorMessage || "")'

finish
