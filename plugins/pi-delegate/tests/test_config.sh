#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

use_stub pi-marker-ok

run_task_with_fixture() {
  # run_task_with_fixture <fixture-or-empty> <argsout>
  local fixture="$1" argsout="$2" scratch
  scratch="$(make_scratch)"
  mkdir -p "$scratch/.claude"
  if [ -n "$fixture" ]; then
    cp "$TESTS_DIR/fixtures/$fixture" "$scratch/.claude/pi-delegate.local.md"
  fi
  CLAUDE_PROJECT_DIR="$scratch" PI_ARGS_OUT="$argsout" \
    node "$COMPANION" task "do thing" --json --timeout 30000 > "$scratch/result.json" 2> "$scratch/stderr.txt"
  echo "$scratch"
}

# --- quoted fixture: quotes stripped, values reach pi argv ---
args="$(make_scratch)/args.txt"
scratch="$(run_task_with_fixture frontmatter-quoted.md "$args")"
check "quoted: --provider zai in argv" grep -qx -- 'zai' "$args"
check "quoted: --model glm-4.5-air in argv" grep -qx -- 'glm-4.5-air' "$args"
check "quoted: no literal quotes leaked" bash -c "! grep -q '\"zai\"' '$args'"

# --- unterminated frontmatter: ignored entirely ---
args="$(make_scratch)/args.txt"
scratch="$(run_task_with_fixture frontmatter-unterminated.md "$args")"
check "unterminated: no --provider in argv" bash -c "! grep -qx -- '--provider' '$args'"
check "unterminated: ghost value absent" bash -c "! grep -qx -- 'ghost' '$args'"

# --- hostile values: rejected with stderr warning ---
args="$(make_scratch)/args.txt"
scratch="$(run_task_with_fixture frontmatter-hostile.md "$args")"
check "hostile: --evil not in argv" bash -c "! grep -qx -- '--evil' '$args'"
check "hostile: spaced model not in argv" bash -c "! grep -q 'has spaces in it' '$args'"
check "hostile: stderr warning emitted" grep -q "ignoring invalid" "$scratch/stderr.txt"

# --- write-config round trip ---
scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"
node "$COMPANION" write-config --provider zai --model glm-4.5-air --json > "$scratch/wc.json"
assert_json "write-config ok" "$scratch/wc.json" 'r.ok === true'
check "config file written" test -f "$scratch/.claude/pi-delegate.local.md"
args="$scratch/args.txt"
PI_ARGS_OUT="$args" node "$COMPANION" task "do thing" --json --timeout 30000 > "$scratch/task.json"
check "round-trip: provider picked up by task" grep -qx -- 'zai' "$args"
check "round-trip: model picked up by task" grep -qx -- 'glm-4.5-air' "$args"

# --- write-config rejections ---
rc=0; node "$COMPANION" write-config --provider zai --tpyo x --json > "$scratch/unknown.out" || rc=$?
check "unknown flag: exit 2" test "$rc" -eq 2

rc=0; node "$COMPANION" write-config --provider --evil --json > "$scratch/evil.json" || rc=$?
check "leading-dash value: nonzero exit" test "$rc" -ne 0
assert_json "leading-dash value: ok:false" "$scratch/evil.json" 'r.ok === false'

rc=0; node "$COMPANION" write-config --provider "$(printf 'a\nb')" --json > "$scratch/nl.json" || rc=$?
check "newline value: nonzero exit" test "$rc" -ne 0
assert_json "newline value: ok:false" "$scratch/nl.json" 'r.ok === false'

rc=0; node "$COMPANION" write-config --model "a---b" --json > "$scratch/dashes.json" || rc=$?
check "'---' value: nonzero exit" test "$rc" -ne 0
assert_json "'---' value: ok:false" "$scratch/dashes.json" 'r.ok === false'

# --- remove-config ---
node "$COMPANION" remove-config --json > "$scratch/rm.json"
assert_json "remove-config ok" "$scratch/rm.json" 'r.ok === true'
check "config file removed" bash -c "! test -f '$scratch/.claude/pi-delegate.local.md'"

finish
