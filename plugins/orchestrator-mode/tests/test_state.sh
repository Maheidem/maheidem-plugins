#!/usr/bin/env bash
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$DIR/.." && pwd)"

pass=0
fail=0
total=0

check() {
  local name="$1" code="$2"
  total=$((total+1))
  if PYTHONPATH="$PLUGIN_ROOT/hooks" python3 -c "$code" >/tmp/state_test_out 2>/tmp/state_test_err; then
    echo "PASS: $name"
    pass=$((pass+1))
  else
    echo "FAIL: $name"
    cat /tmp/state_test_out /tmp/state_test_err
    fail=$((fail+1))
  fi
}

check "_parse('on') -> (on, {})" "
import _state
assert _state._parse('on') == ('on', {}), _state._parse('on')
"

check "_parse('off') -> (off, {}) no stderr" "
import sys, io, _state
buf = io.StringIO()
sys.stderr = buf
r = _state._parse('off')
assert r == ('off', {}), r
assert buf.getvalue() == '', repr(buf.getvalue())
"

check "_parse('') -> (off, {}) no stderr" "
import sys, io, _state
buf = io.StringIO()
sys.stderr = buf
r = _state._parse('')
assert r == ('off', {}), r
assert buf.getvalue() == '', repr(buf.getvalue())
"

check "_parse('banana') -> (off, {}) with stderr warning" "
import sys, io, _state
buf = io.StringIO()
sys.stderr = buf
r = _state._parse('banana')
assert r == ('off', {}), r
assert 'unrecognized state-file mode token' in buf.getvalue(), buf.getvalue()
"

check "_parse('on allowed-models=opus,sonnet')" "
import _state
mode, opts = _state._parse('on allowed-models=opus,sonnet')
assert mode == 'on', mode
assert opts == {'allowed-models': ['opus', 'sonnet']}, opts
"

check "_parse malformed allowed-models discards, warns" "
import sys, io, _state
buf = io.StringIO()
sys.stderr = buf
mode, opts = _state._parse('on allowed-models=opus, sonnet')
assert mode == 'on', mode
assert 'allowed-models' not in opts, opts
assert 'malformed allowed-models' in buf.getvalue(), buf.getvalue()
"

check "T6: discovery walks up to ancestor state file" "
import os, tempfile, _state
tmp = tempfile.mkdtemp()
proj = os.path.join(tmp, 'proj')
nested = os.path.join(proj, 'a', 'b')
os.makedirs(nested)
with open(os.path.join(proj, '.orchestrator-mode.state'), 'w') as f:
    f.write('on')
os.environ.pop('CLAUDE_PROJECT_DIR', None)
p = _state.state_file_path({'cwd': nested})
assert p == os.path.join(os.path.realpath(proj), '.orchestrator-mode.state'), p
"

check "T6: fallback to cwd when no state file anywhere" "
import os, tempfile, _state
tmp = tempfile.mkdtemp()
nested = os.path.join(tmp, 'x', 'y')
os.makedirs(nested)
os.environ.pop('CLAUDE_PROJECT_DIR', None)
p = _state.state_file_path({'cwd': nested})
assert p == os.path.join(nested, '.orchestrator-mode.state'), p
"

check "T6: CLAUDE_PROJECT_DIR set -> unchanged join, no walk" "
import os, tempfile, _state
tmp = tempfile.mkdtemp()
proj = os.path.join(tmp, 'proj')
os.makedirs(proj)
# a state file exists at an ancestor -- must NOT be picked up when env var set
with open(os.path.join(tmp, '.orchestrator-mode.state'), 'w') as f:
    f.write('on')
os.environ['CLAUDE_PROJECT_DIR'] = proj
p = _state.state_file_path({'cwd': proj})
assert p == os.path.join(proj, '.orchestrator-mode.state'), p
os.environ.pop('CLAUDE_PROJECT_DIR', None)
"

echo
echo "test_state.sh: $pass/$total passed"
[ "$fail" -eq 0 ]
