#!/usr/bin/env bash
# _state.py: config parsing, lookup, matching helpers, status CLI.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/helpers.sh"

check() {
  total=$((total+1))
  if PYTHONPATH="$PLUGIN_ROOT/hooks" python3 -c "import _state as s
$2" >"$ROOT/out" 2>&1; then
    echo "PASS: $1"; pass=$((pass+1))
  else
    echo "FAIL: $1"; cat "$ROOT/out"; fail=$((fail+1))
  fi
}

check "legacy: bare mode" "assert s._parse_legacy('on\n', 'f')['mode'] == 'on'"
check "legacy: spaced model list kept whole" \
  "assert s._parse_legacy('wf allowed-models=opus, sonnet haiku', 'f')['allowed_models'] == ['opus','sonnet','haiku']"
check "legacy: garbage token raises" "
try: s._parse_legacy('banana', 'f')
except ValueError: pass
else: raise SystemExit('no error')"
check "json: defaults and lowercasing" "
c = s._parse_json('{\"mode\":\"PI\",\"allowed-models\":[\"Opus\"]}', 'f')
assert c == {'mode':'pi','allowed_models':['opus'],'main_allow':[]}, c"
check "json: unknown key warns, doesn't fail" "
import io, sys; sys.stderr = io.StringIO()
assert s._parse_json('{\"mode\":\"on\",\"main_allow\":[]}', 'f')['mode'] == 'on'
assert 'main_allow' in sys.stderr.getvalue()"
check "json: bad mode raises" "
try: s._parse_json('{\"mode\":\"yes\"}', 'f')
except ValueError: pass
else: raise SystemExit('no error')"
check "matches: exact vs trailing *" "
assert s.matches('mcp__a__b', ['mcp__a__*']) and s.matches('X', ['X'])
assert not s.matches('mcp__a__bc', ['mcp__a__b']) and not s.matches('mcp__ab', ['mcp__a__*'])"
check "model_allowed: family token, boundary prefix, never substring" "
assert s.model_allowed('claude-sonnet-5', ['sonnet'])
assert s.model_allowed('us.anthropic.claude-haiku-4-5', ['haiku'])
assert s.model_allowed('claude-opus-5-5[1m]', ['claude-opus-5-5'])
assert not s.model_allowed('opus', ['o']) and not s.model_allowed('sonnetx', ['sonnet'])"
check "pi mode tools derive from base (Artifact/ReportFindings present, Monitor absent)" "
assert {'Artifact','ReportFindings'} <= s.MODE_TOOLS['pi']
assert 'Monitor' not in s.BASE_TOOLS and not ({'Task','Agent','Workflow'} & s.MODE_TOOLS['pi'])
assert s.MODE_TOOLS['wf'] - s.MODE_TOOLS['pi'] == {'Workflow'}"
check "slug: short path, and hashed past 200 chars" "
assert s.project_slug('/a/b_c.d') == '-a-b-c-d'
long = s.project_slug('/' + 'x' * 300)
assert len(long) > 200 and long[:201] == ('-' + 'x' * 199) + '-', long"

new_proj '{"mode":"wf","main-allow":["mcp__p__*"]}'
mkdir -p "$PROJ/deep/er"
printf '{"main-allow":["mcp__g__*"]}' > "$CFG/orchestrator-mode.json"
check "get_config: walk-up + user-wide layer" "
c = s.get_config({'cwd': '$PROJ/deep/er'})
assert c['mode'] == 'wf' and c['main_allow'] == ['mcp__p__*'] and c['global_allow'] == ['mcp__g__*'], c"
total=$((total+1))
if (cd "$PROJ/deep/er" && python3 "$PLUGIN_ROOT/hooks/_state.py" status) | python3 -c "
import json, sys; e = json.load(sys.stdin)
assert e['mode'] == 'wf' and e['project-main-allow'] == ['mcp__p__*'] and e['global-main-allow'] == ['mcp__g__*']
assert 'Workflow' in e['core-tools'] and 'Task' not in e['core-tools']"; then
  echo "PASS: status CLI prints effective config"; pass=$((pass+1))
else
  echo "FAIL: status CLI"; fail=$((fail+1))
fi

# --- pi pin + catalog ---------------------------------------------------------
new_proj '{"mode":"on"}'
mkdir -p "$PROJ/.claude"
check "read_pin: no file -> None" "assert s.read_pin({'cwd': '$PROJ'}) is None"
printf -- '---\nprovider: "zai"\nmodel: glm-5.3\n---\nbody\n' > "$PROJ/.claude/pi-delegate.local.md"
check "read_pin: quoted provider, plain model" "
assert s.read_pin({'cwd': '$PROJ'}) == {'provider':'zai','model':'glm-5.3'}, s.read_pin({'cwd': '$PROJ'})
assert s.pin_label({'provider':'zai','model':'glm-5.3'}) == 'zai/glm-5.3'"
printf -- '---\nprovider: zai\nmodel: -bad value\n' > "$PROJ/.claude/pi-delegate.local.md"
check "read_pin: unterminated block -> None (like pi-companion)" "assert s.read_pin({'cwd': '$PROJ'}) is None"
printf -- '---\nprovider: zai\nmodel: -rf\n---\n' > "$PROJ/.claude/pi-delegate.local.md"
check "read_pin: unsafe value dropped" "assert s.read_pin({'cwd': '$PROJ'}) == {'provider':'zai'}"
check "_resolve_scope: exact, @suffix, bare model, glob, :thinking, case fallback, unmatched" "
cat = {'mac-m3': ['qwen3.8-flash', 'qwen3.8-flash@adaptive'], 'zai': ['glm-5.2', 'glm-5.3'], 'hf': ['Qwen/Qwen3-32B']}
r = s._resolve_scope
assert r('mac-m3/qwen3.8-flash@adaptive', cat) == [('mac-m3','qwen3.8-flash@adaptive')]
assert r('glm-5.3', cat) == [('zai','glm-5.3')]
assert r('zai/glm-*', cat) == [('zai','glm-5.2'),('zai','glm-5.3')]
assert r('zai/glm-5.2:high', cat) == [('zai','glm-5.2')]
assert r('hf/Qwen/Qwen3-32B', cat) == [('hf','Qwen/Qwen3-32B')]
assert r('MAC-M3/QWEN3.8-FLASH', cat) == [('mac-m3','qwen3.8-flash')]
assert r('nope/x', cat) == []"

FAKEBIN="$ROOT/fakebin"; PIDIR="$ROOT/fakepi"
mkdir -p "$FAKEBIN" "$PIDIR"
cat > "$FAKEBIN/pi" <<'PI'
#!/bin/sh
echo "$@" >> "$(dirname "$0")/calls"
printf 'provider  model                   context  max-out  thinking  images\nmac-m3    qwen3.8-flash@adaptive  200K     32K      yes       yes\nzai       glm-5.3                 1M       131.1K   yes       no\n'
PI
chmod +x "$FAKEBIN/pi"
printf '{"enabledModels":["mac-m3/qwen3.8-flash@adaptive","zai/glm-*","gone/model"],"defaultProvider":"zai","defaultModel":"glm-5.3","apiKey":"SECRET-DO-NOT-PRINT"}' > "$PIDIR/settings.json"
printf -- '---\nprovider: zai\nmodel: glm-5.3\n---\n' > "$PROJ/.claude/pi-delegate.local.md"
status() { (cd "$PROJ" && PATH="$FAKEBIN:$PATH" PI_CODING_AGENT_DIR="$PIDIR" python3 "$PLUGIN_ROOT/hooks/_state.py" status "$@"); }
total=$((total+1))
if out=$(status /bin/zsh) && [ ! -e "$FAKEBIN/calls" ] && python3 -c "
import json, sys; e = json.loads(sys.argv[1]); assert 'pi' not in e and e['pi-pin'] == {'provider':'zai','model':'glm-5.3'}" "$out"; then
  echo "PASS: status without the pi verb never runs pi, still reports the pin"; pass=$((pass+1))
else
  echo "FAIL: status without pi verb"; echo "$out"; fail=$((fail+1))
fi
total=$((total+1))
if out=$(status allow) && [ ! -e "$FAKEBIN/calls" ] && out=$(status models) && [ ! -e "$FAKEBIN/calls" ]; then
  echo "PASS: 'allow' and 'models' outside pi mode don't run pi"; pass=$((pass+1))
else
  echo "FAIL: pi ran for a non-pi verb"; fail=$((fail+1))
fi
total=$((total+1))
if out=$(status PI) && grep -q -- '--list-models' "$FAKEBIN/calls" && ! grep -q SECRET <<<"$out" && python3 -c "
import json, sys; p = json.loads(sys.argv[1])['pi']
assert p['error'] is None and p['pin_valid'] and p['default'] == {'provider':'zai','model':'glm-5.3'}, p
assert p['scoped'] == [{'provider':'mac-m3','model':'qwen3.8-flash@adaptive'},{'provider':'zai','model':'glm-5.3'}], p['scoped']
assert p['unmatched'] == ['gone/model'] and p['all'] == {'mac-m3':['qwen3.8-flash@adaptive'],'zai':['glm-5.3']}" "$out"; then
  echo "PASS: status pi: validated scoped list, pin/default checked, no secrets echoed"; pass=$((pass+1))
else
  echo "FAIL: status pi"; echo "$out"; fail=$((fail+1))
fi
printf '{"mode":"pi"}' > "$PROJ/.orchestrator-mode.json"; rm -f "$FAKEBIN/calls"
total=$((total+1))
if out=$(status models) && grep -q -- '--list-models' "$FAKEBIN/calls"; then
  echo "PASS: 'models' while in pi mode fetches the pi catalog"; pass=$((pass+1))
else
  echo "FAIL: models in pi mode"; fail=$((fail+1))
fi
total=$((total+1))
if out=$(cd "$PROJ" && PATH="/usr/bin:/bin" PI_CODING_AGENT_DIR="$PIDIR" /usr/bin/python3 "$PLUGIN_ROOT/hooks/_state.py" status pi) && python3 -c "
import json, sys; p = json.loads(sys.argv[1])['pi']; assert 'not found' in p['error'] and p['scoped'] == []" "$out"; then
  echo "PASS: status pi without pi on PATH reports the error, doesn't crash"; pass=$((pass+1))
else
  echo "FAIL: pi missing"; echo "$out"; fail=$((fail+1))
fi

echo
echo "test_state.sh: $pass/$total passed"
[ "$fail" -eq 0 ]
