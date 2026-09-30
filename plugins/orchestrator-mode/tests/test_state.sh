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

echo
echo "test_state.sh: $pass/$total passed"
[ "$fail" -eq 0 ]
