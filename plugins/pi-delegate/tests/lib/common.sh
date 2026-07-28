# Shared helpers for pi-delegate tests. Source from each test_*.sh.
set -euo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_ROOT="$(cd "$TESTS_DIR/.." && pwd)"
COMPANION="$PLUGIN_ROOT/scripts/pi-companion.mjs"

FAILS=0
PASSES=0

# Registry file survives command substitution subshells (unlike a bash array).
_SCRATCH_REGISTRY="$(mktemp "${TMPDIR:-/tmp}/pi-delegate-test-registry.XXXXXX")"
export _SCRATCH_REGISTRY

cleanup_scratch() {
  if [ -f "$_SCRATCH_REGISTRY" ]; then
    while IFS= read -r d; do
      case "$d" in
        */pi-delegate-test.*) rm -rf "$d" ;;
      esac
    done < "$_SCRATCH_REGISTRY"
    rm -f "$_SCRATCH_REGISTRY"
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Chained EXIT-trap registry. Bash keeps only the LAST `trap ... EXIT`
# registered, so any test that does `trap its_own_cleanup EXIT` silently
# overwrites this file's trap (and vice versa), leaking scratch/pi dirs.
# Callers (this file and individual test_*.sh) register cleanup functions
# with add_cleanup instead of calling `trap` directly; they all run on exit,
# in reverse registration order, each wrapped so one failing cleanup can't
# stop the rest from running.
# ---------------------------------------------------------------------------
_CLEANUP_FNS=()

add_cleanup() {
  _CLEANUP_FNS+=("$1")
}

_run_all_cleanups() {
  local idx fn
  for ((idx = ${#_CLEANUP_FNS[@]} - 1; idx >= 0; idx--)); do
    fn="${_CLEANUP_FNS[$idx]}"
    "$fn" || true
  done
}
trap _run_all_cleanups EXIT

add_cleanup cleanup_scratch

# make_scratch -> prints a fresh temp dir path (registered for cleanup)
make_scratch() {
  local d
  d="$(mktemp -d "${TMPDIR:-/tmp}/pi-delegate-test.XXXXXX")"
  echo "$d" >> "$_SCRATCH_REGISTRY"
  echo "$d"
}

# use_stub <stub-name> — installs stubs/<stub-name> as `pi` in a fresh bin dir
# and prepends it to PATH. Exports STUB_BIN.
use_stub() {
  local name="$1"
  STUB_BIN="$(make_scratch)/bin"
  mkdir -p "$STUB_BIN"
  cp "$TESTS_DIR/stubs/$name" "$STUB_BIN/pi"
  chmod +x "$STUB_BIN/pi"
  export PATH="$STUB_BIN:$PATH"
}

pass() {
  PASSES=$((PASSES + 1))
  echo "  ok: $1"
}

fail() {
  FAILS=$((FAILS + 1))
  echo "  FAIL: $1" >&2
}

check() {
  # check <description> <command...>
  local desc="$1"; shift
  if "$@"; then pass "$desc"; else fail "$desc"; fi
}

# json_get <file> <js-expr over `r`> — prints the value (JSON-encoded for non-strings)
json_get() {
  local file="$1" expr="$2"
  node -e '
    const fs = require("fs");
    const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const v = eval(process.argv[2]);
    process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));
  ' "$file" "$expr"
}

# assert_json <desc> <file> <js-boolean-expr over `r`>
assert_json() {
  local desc="$1" file="$2" expr="$3"
  if node -e '
    const fs = require("fs");
    const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.exit(eval(process.argv[2]) ? 0 : 1);
  ' "$file" "$expr"; then
    pass "$desc"
  else
    fail "$desc (expr: $expr; file: $file)"
    echo "  --- result json head ---" >&2
    head -c 1500 "$file" >&2 || true
    echo "" >&2
  fi
}

finish() {
  echo "  passes=$PASSES fails=$FAILS"
  [ "$FAILS" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Conversation-verb helpers -- mirror pi-companion.mjs's
# sessionSlugForCwd/piSessionsDir/lockPathFor exactly (see scripts/pi-companion.mjs).
# Real pi lands sessions under $HOME/.pi/agent/sessions/, so these still touch
# the real homedir -- but always inside a throwaway make_scratch cwd slug, never
# the real project's session history. Registered for cleanup.
# ---------------------------------------------------------------------------

# pi_session_slug <cwd> -> prints "--<cwd with leading slash stripped, / and : -> ->--"
pi_session_slug() {
  local resolved slug
  # -P: physical path (resolves symlinks), matching pi's fs.realpathSync --
  # on macOS /tmp and /var are symlinks into /private/..., so a logical
  # `pwd` here would predict a directory pi never actually uses.
  resolved="$(cd "$1" && pwd -P)"
  slug="${resolved#/}"
  slug="${slug//\//-}"
  slug="${slug//:/-}"
  echo "--${slug}--"
}

# pi_sessions_dir <cwd> -> prints the on-disk session directory for that cwd
pi_sessions_dir() {
  local dir
  dir="$HOME/.pi/agent/sessions/$(pi_session_slug "$1")"
  echo "$dir" >> "$_SCRATCH_REGISTRY.pi_dirs"
  echo "$dir"
}

# pi_lock_path <cwd> <session-name> -> prints the lockfile path pi-companion would use
pi_lock_path() {
  echo "${TMPDIR:-/tmp}/pi-delegate-locks/$(pi_session_slug "$1")__$2.lock"
}

# Clean up any real ~/.pi/agent/sessions/<slug> dirs this run created, on top
# of the normal make_scratch cleanup.
cleanup_pi_dirs() {
  if [ -f "${_SCRATCH_REGISTRY}.pi_dirs" ]; then
    while IFS= read -r d; do
      case "$d" in
        "$HOME/.pi/agent/sessions/"*) rm -rf "$d" ;;
      esac
    done < "${_SCRATCH_REGISTRY}.pi_dirs"
    rm -f "${_SCRATCH_REGISTRY}.pi_dirs"
  fi
  return 0
}
add_cleanup cleanup_pi_dirs
