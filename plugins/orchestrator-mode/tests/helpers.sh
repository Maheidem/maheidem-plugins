#!/usr/bin/env bash
# Shared test harness for orchestrator-mode hook tests.
# Never touches the real marketplace repo's .orchestrator-mode.state --
# every case works inside a fresh mktemp project dir.

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pass=0
fail=0
total=0

# run_case name script payload expect_exit expect_stdout_substr expect_stderr_substr
# expect_stdout_substr / expect_stderr_substr may be "__EMPTY__" (must be empty)
# or a substring to grep for. Pass "" to skip that assertion.
run_case() {
  local name="$1" script="$2" payload="$3" expect_exit="$4" expect_stdout_substr="$5" expect_stderr_substr="$6"
  total=$((total+1))
  local out err rc errfile
  errfile="$(mktemp)"
  out=$(printf '%s' "$payload" | python3 "$PLUGIN_ROOT/hooks/$script" 2>"$errfile")
  rc=$?
  err=$(cat "$errfile")
  rm -f "$errfile"

  local ok=1
  if [ "$rc" != "$expect_exit" ]; then
    echo "FAIL $name: exit $rc != $expect_exit"
    ok=0
  fi
  if [ "$expect_stdout_substr" = "__EMPTY__" ]; then
    if [ -n "$out" ]; then
      echo "FAIL $name: expected empty stdout, got: $out"
      ok=0
    fi
  elif [ -n "$expect_stdout_substr" ]; then
    if ! grep -qF -- "$expect_stdout_substr" <<<"$out"; then
      echo "FAIL $name: stdout missing '$expect_stdout_substr' (got: $out)"
      ok=0
    fi
  fi
  if [ "$expect_stderr_substr" = "__EMPTY__" ]; then
    if [ -n "$err" ]; then
      echo "FAIL $name: expected empty stderr, got: $err"
      ok=0
    fi
  elif [ -n "$expect_stderr_substr" ]; then
    if ! grep -qF -- "$expect_stderr_substr" <<<"$err"; then
      echo "FAIL $name: stderr missing '$expect_stderr_substr' (got: $err)"
      ok=0
    fi
  fi

  if [ "$ok" = 1 ]; then
    echo "PASS: $name"
    pass=$((pass+1))
  else
    fail=$((fail+1))
  fi
}

# Set up a fresh project dir at $TMP/proj with an optional state-file content.
# Usage: new_proj "<state content or omit for no file>"
new_proj() {
  local content="$1"
  TMP="$(mktemp -d)"
  mkdir -p "$TMP/proj"
  if [ -n "$content" ] || [ "$2" = "empty" ]; then
    printf '%s' "$content" > "$TMP/proj/.orchestrator-mode.state"
  fi
  export CLAUDE_PROJECT_DIR="$TMP/proj"
}
