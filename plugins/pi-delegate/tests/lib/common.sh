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
trap cleanup_scratch EXIT

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
