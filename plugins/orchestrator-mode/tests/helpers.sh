#!/usr/bin/env bash
# Shared test harness for orchestrator-mode hook tests. Every case runs in a
# project dir under one mktemp root (removed on exit) with CLAUDE_CONFIG_DIR
# pointed at a scratch dir, so neither the real repo config nor the real
# user-wide config is ever read or written.

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

pass=0
fail=0
total=0
nproj=0

# run_case name script payload expect_exit expect_stdout expect_stderr
# expect_* may be "__EMPTY__" (must be empty), a substring, or "" (skip).
run_case() {
  local name="$1" script="$2" payload="$3" expect_exit="$4" want_out="$5" want_err="$6"
  local out err rc ok=1
  total=$((total+1))
  out=$(printf '%s' "$payload" | python3 "$PLUGIN_ROOT/hooks/$script" 2>"$ROOT/err")
  rc=$?
  err=$(cat "$ROOT/err")
  [ "$rc" = "$expect_exit" ] || { echo "FAIL $name: exit $rc != $expect_exit"; ok=0; }
  for pair in "out:$want_out" "err:$want_err"; do
    local which="${pair%%:*}" want="${pair#*:}" got
    [ "$which" = out ] && got="$out" || got="$err"
    if [ "$want" = "__EMPTY__" ] && [ -n "$got" ]; then
      echo "FAIL $name: expected empty std$which, got: $got"; ok=0
    elif [ -n "$want" ] && [ "$want" != "__EMPTY__" ] && ! grep -qF -- "$want" <<<"$got"; then
      echo "FAIL $name: std$which missing '$want' (got: $got)"; ok=0
    fi
  done
  if [ "$ok" = 1 ]; then echo "PASS: $name"; pass=$((pass+1)); else fail=$((fail+1)); fi
}

# new_proj '<config text>' [legacy]: fresh $PROJ (with $CFG as the isolated
# CLAUDE_CONFIG_DIR). Text goes to .orchestrator-mode.json, or to the legacy
# .orchestrator-mode.state with "legacy". Empty text -> no config file.
new_proj() {
  nproj=$((nproj+1))
  PROJ="$ROOT/p$nproj/proj"
  CFG="$ROOT/p$nproj/cfg"
  mkdir -p "$PROJ" "$CFG"
  if [ "${2:-}" = legacy ]; then
    printf '%s' "$1" > "$PROJ/.orchestrator-mode.state"
  elif [ -n "$1" ]; then
    printf '%s' "$1" > "$PROJ/.orchestrator-mode.json"
  fi
  export CLAUDE_PROJECT_DIR="$PROJ" CLAUDE_CONFIG_DIR="$CFG"
}

# payload tool '<tool_input json>' [extra json members, e.g. ,"agent_id":"a"]
payload() {
  printf '{"tool_name":"%s","tool_input":%s,"cwd":"%s"%s}' "$1" "$2" "$PROJ" "${3:-}"
}

allowed() { run_case "$1" enforce-orchestrator.py "$2" 0 "__EMPTY__" ""; }
DENY_MARK='"permissionDecision": "deny"'
denied() { run_case "$1" enforce-orchestrator.py "$2" 0 "${3:-$DENY_MARK}" ""; }
