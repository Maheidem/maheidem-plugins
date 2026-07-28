#!/usr/bin/env bash
# Runs the full orchestrator-mode test suite. Non-zero exit on any failure.
# CRITICAL: every sub-suite operates only inside mktemp project dirs with
# CLAUDE_PROJECT_DIR overridden -- never touches the real repo's
# .orchestrator-mode.state.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

overall_fail=0

_run() {
  local suite="$1"
  echo "=== $suite ==="
  bash "$DIR/$suite"
  if [ $? -ne 0 ]; then
    overall_fail=1
  fi
  echo
}

_run test_state.sh
_run test_enforce.sh
_run test_reminder.sh

if [ "$overall_fail" -eq 0 ]; then
  echo "ALL SUITES PASSED"
else
  echo "SOME SUITES FAILED"
fi
exit "$overall_fail"
