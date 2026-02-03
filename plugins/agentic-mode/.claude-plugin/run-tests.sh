#!/bin/bash
# Test runner for agentic-mode hook
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="${SCRIPT_DIR}/../hooks/enforce-delegation.sh"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "======================================"
echo "Agentic Mode Hook Test Suite"
echo "======================================"
echo ""

test_count=0
pass_count=0
fail_count=0

run_test() {
  local test_name="$1"
  local test_file="$2"
  local expected_exit="$3"
  local expected_decision="$4" # "allow", "deny", or "any"

  test_count=$((test_count + 1))

  echo -n "Test $test_count: $test_name ... "

  # Modify test file to use test config directory if needed
  local test_input
  if [[ "$test_name" == *"blocked"* ]]; then
    # Update cwd to point to test config directory
    test_input=$(jq --arg dir "$SCRIPT_DIR/test-config" '.cwd = $dir' "$test_file")
  else
    test_input=$(cat "$test_file")
  fi

  # Run the hook
  output=$(echo "$test_input" | "$HOOK_SCRIPT" 2>&1) || hook_exit=$?
  hook_exit=${hook_exit:-0}

  # Check exit code
  if [[ "$hook_exit" -ne "$expected_exit" ]]; then
    echo -e "${RED}FAIL${NC}"
    echo "  Expected exit code: $expected_exit, got: $hook_exit"
    echo "  Output: $output"
    fail_count=$((fail_count + 1))
    return
  fi

  # Check decision if specified
  if [[ "$expected_decision" != "any" ]]; then
    decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision // "none"' 2>/dev/null || echo "parse_error")

    if [[ "$expected_decision" == "allow" ]] && [[ -z "$output" ]]; then
      # Empty output = silent allow (exit 0 without JSON)
      decision="allow"
    fi

    if [[ "$decision" != "$expected_decision" ]]; then
      echo -e "${RED}FAIL${NC}"
      echo "  Expected decision: $expected_decision, got: $decision"
      echo "  Output: $output"
      fail_count=$((fail_count + 1))
      return
    fi
  fi

  echo -e "${GREEN}PASS${NC}"
  pass_count=$((pass_count + 1))
}

# Test 1: Task tool always allowed
run_test "Task tool always allowed" \
  "$SCRIPT_DIR/test-allow-task.json" \
  0 \
  "allow"

# Test 2: Edit blocked when config enabled
run_test "Edit blocked in main session" \
  "$SCRIPT_DIR/test-block-edit.json" \
  0 \
  "deny"

# Test 3: Tools allowed when config missing
run_test "Bash allowed without config" \
  "$SCRIPT_DIR/test-allow-disabled.json" \
  0 \
  "allow"

echo ""
echo "======================================"
echo "Test Results"
echo "======================================"
echo "Total: $test_count"
echo -e "${GREEN}Passed: $pass_count${NC}"
echo -e "${RED}Failed: $fail_count${NC}"

if [[ $fail_count -eq 0 ]]; then
  echo ""
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo ""
  echo -e "${RED}Some tests failed.${NC}"
  exit 1
fi
