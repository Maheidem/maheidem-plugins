#!/usr/bin/env bash
# Orchestrator for all deep-research test suites. Exits non-zero on any failure.
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

_run "test_validate_citations.sh" "bash $HERE/test_validate_citations.sh"

echo ""
if [ "$overall" -eq 0 ]; then
  echo "ALL TESTS PASSED"
else
  echo "ONE OR MORE SUITES FAILED"
fi
exit "$overall"
