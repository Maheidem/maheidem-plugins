#!/usr/bin/env bash
# BUG2 regression guard: after a crash/stale-lock-reclaim recovery, MORE THAN
# ONE session jsonl can match the same session name (different timestamp
# prefixes). `end` must delete every match, not just the first (the original
# `.find()` bug silently dropped orphans). No `pi` stub is needed -- `end`
# only touches the filesystem.
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"
name="convtest-multifile-$$"

sess_dir="$(pi_sessions_dir "$scratch")"
mkdir -p "$sess_dir"
file_a="$sess_dir/2026-07-28T00-00-00_${name}.jsonl"
file_b="$sess_dir/2026-07-28T00-05-00_${name}.jsonl"
file_c="$sess_dir/2026-07-28T00-10-00_other-session-name.jsonl" # must survive: different name
echo '{}' > "$file_a"
echo '{}' > "$file_b"
echo '{}' > "$file_c"

check "before end: file A exists" test -e "$file_a"
check "before end: file B exists" test -e "$file_b"
check "before end: unrelated file C exists" test -e "$file_c"

out_end="$scratch/end.json"
node "$COMPANION" conversation end "$name" --json --timeout 5000 > "$out_end"
rc=$?
check "end: exit code 0" test "$rc" -eq 0
assert_json "end: ok:true" "$out_end" 'r.ok === true'

check "end: file A deleted" test ! -e "$file_a"
check "end: file B deleted" test ! -e "$file_b"
check "end: unrelated file C untouched" test -e "$file_c"

assert_json "end: summary mentions both deleted files" "$out_end" \
  "r.summary.includes(\"$(basename "$file_a")\") && r.summary.includes(\"$(basename "$file_b")\")"
assert_json "end: summary does not mention the unrelated file" "$out_end" \
  "!r.summary.includes(\"$(basename "$file_c")\")"

finish
