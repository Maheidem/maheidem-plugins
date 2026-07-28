#!/usr/bin/env bash
# Orchestrator for all pi-delegate test suites. Exits non-zero on any failure.
# Drives the REAL scripts/pi-companion.mjs against stub `pi` executables.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
overall=0

_run() {
  echo ""
  echo "== $1 =="
  if bash -c "$2"; then
    echo "-- $1: OK"
  else
    echo "-- $1: FAILED"
    overall=1
  fi
}

for t in "$HERE"/test_*.sh; do
  name="$(basename "$t")"
  _run "$name" "bash $t"
done

echo ""
if [ "$overall" -eq 0 ]; then
  echo "ALL TESTS PASSED"
else
  echo "ONE OR MORE SUITES FAILED"
fi
exit "$overall"
