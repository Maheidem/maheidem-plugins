#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

use_stub pi-marker-ok
scratch="$(make_scratch)"
export CLAUDE_PROJECT_DIR="$scratch"

for bad in 0 -5 abc 1.5; do
  out="$scratch/timeout-$bad.out"
  rc=0
  node "$COMPANION" task "do thing" --json --timeout "$bad" > "$out" || rc=$?
  check "--timeout $bad: exit 2" test "$rc" -eq 2
  check "--timeout $bad: validation message" grep -q "must be a positive integer" "$out"
  check "--timeout $bad: usage printed" grep -q "Usage:" "$out"
done

finish
