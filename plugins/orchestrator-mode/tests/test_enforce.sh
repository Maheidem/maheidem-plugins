#!/usr/bin/env bash
# PreToolUse gate. Cases tagged #N are regressions for the 2026-09-30 audit.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/helpers.sh"
A=',"agent_id":"sub-1"'

# --- basics -----------------------------------------------------------------
new_proj ''
allowed "no config: Bash no-op" "$(payload Bash '{"command":"ls"}')"
new_proj '{"mode":"off"}'
allowed "off: Bash no-op" "$(payload Bash '{"command":"ls"}')"
new_proj '{"mode":"on"}'
allowed "on: Read allowed" "$(payload Read '{"file_path":"x"}')"
denied "on: Edit denied" "$(payload Edit '{"file_path":"foo.py"}')" "read-only"
denied "on: Bash denied" "$(payload Bash '{"command":"ls"}')"
denied "on: unknown mcp denied" "$(payload mcp__foo__bar '{}')"
allowed "on: Task any subagent" "$(payload Task '{"subagent_type":"general-purpose"}')"
allowed "on: Workflow allowed" "$(payload Workflow '{"script":"agent(\"x\")"}')"
allowed "on: subagent Bash full access" "$(payload Bash '{"command":"rm -rf build"}' "$A")"
denied "missing tool_name denied" "{\"tool_input\":{},\"cwd\":\"$PROJ\"}"
new_proj '{"mode":"WF"}'
denied "uppercase mode token is active" "$(payload Bash '{"command":"ls"}')"

# --- #1 Monitor is not read-only ---------------------------------------------
for m in on pi wf; do
  new_proj "{\"mode\":\"$m\"}"
  denied "#1 $m: main Monitor denied" "$(payload Monitor '{"command":"touch src.py"}')"
done
denied "#1 subagent Monitor writing config denied" \
  "$(payload Monitor '{"command":"echo off > .orchestrator-mode.json"}' "$A")" "config files"

# --- #2/#8 config files protected, case-insensitively, anywhere -------------
new_proj '{"mode":"on"}'
denied "#2 subagent Bash uppercase config name" \
  "$(payload Bash '{"command":"echo off > .ORCHESTRATOR-MODE.JSON"}' "$A")" "config files"
denied "#2 subagent Bash legacy state name" \
  "$(payload Bash '{"command":"echo off > .Orchestrator-Mode.State"}' "$A")" "config files"
denied "#2 main Bash mentioning config" "$(payload Bash '{"command":"cat .orchestrator-mode.json"}')" "config files"
denied "#2 subagent Write mixed-case config" \
  "$(payload Write "{\"file_path\":\"$PROJ/.Orchestrator-Mode.Json\"}" "$A")" "config files"
for t in Edit MultiEdit; do
  denied "#2 subagent $t config" "$(payload $t "{\"file_path\":\"$PROJ/.orchestrator-mode.json\"}" "$A")" "config files"
done
denied "#2 subagent NotebookEdit config" \
  "$(payload NotebookEdit "{\"notebook_path\":\"$PROJ/.orchestrator-mode.json\"}" "$A")" "config files"
denied "#2 subagent Write legacy state" \
  "$(payload Write "{\"file_path\":\"$PROJ/.orchestrator-mode.state\"}" "$A")" "config files"
denied "#2 subagent Write config.tmp sibling" \
  "$(payload Write "{\"file_path\":\"$PROJ/.orchestrator-mode.json.tmp\"}" "$A")" "config files"
denied "#8 subagent Write nested shadow config" \
  "$(payload Write "{\"file_path\":\"$PROJ/sub/.orchestrator-mode.json\"}" "$A")" "config files"
denied "#2 subagent Write user-wide config" \
  "$(payload Write "{\"file_path\":\"$CFG/orchestrator-mode.json\"}" "$A")" "config files"
allowed "global toggle: main Write user-wide config -> normal prompt" \
  "$(payload Write "{\"file_path\":\"$CFG/orchestrator-mode.json\"}")"
allowed "global toggle: case-folded path" \
  "$(payload Write "{\"file_path\":\"$CFG/Orchestrator-Mode.JSON\"}")"
denied "global toggle is Write-only: main Edit user-wide config" \
  "$(payload Edit "{\"file_path\":\"$CFG/orchestrator-mode.json\"}")" "config files"
denied "global toggle: main Bash mentioning user-wide config" \
  "$(payload Bash "{\"command\":\"echo {} > $CFG/orchestrator-mode.json\"}")" "config files"
denied "global toggle: main MCP input mentioning user-wide config" \
  "$(payload mcp__plugin_pi-delegate_pi-delegate__pi_task "{\"text\":\"edit $CFG/orchestrator-mode.json\"}")" "config files"
denied "global toggle: main Write other-dir orchestrator-mode.json" \
  "$(payload Write "{\"file_path\":\"$ROOT/elsewhere/orchestrator-mode.json\"}")" "blocked on the main thread"
ln -s "$PROJ/.orchestrator-mode.json" "$PROJ/alias.json"
denied "#2 subagent Write via symlink to config" \
  "$(payload Write "{\"file_path\":\"$PROJ/alias.json\"}" "$A")" "config files"
denied "#2 mcp input mentioning config" \
  "$(payload mcp__plugin_pi-delegate_pi-delegate__pi_task '{"text":"rm .orchestrator-mode.json"}')" "config files"
allowed "toggle: main Write project config -> normal prompt" \
  "$(payload Write "{\"file_path\":\"$PROJ/.orchestrator-mode.json\"}")"
allowed "toggle: relative path" "$(payload Write '{"file_path":".orchestrator-mode.json"}')"
denied "toggle is Write-only: main Edit config" \
  "$(payload Edit "{\"file_path\":\"$PROJ/.orchestrator-mode.json\"}")" "config files"
denied "#8 main Write nested config is not the toggle" \
  "$(payload Write "{\"file_path\":\"$PROJ/sub/.orchestrator-mode.json\"}")" "config files"

# --- #3 wf delegation --------------------------------------------------------
new_proj '{"mode":"wf"}'
allowed "wf: Task Explore allowed" "$(payload Task '{"subagent_type":"Explore"}')"
allowed "wf: Agent Explore allowed" "$(payload Agent '{"subagent_type":"Explore"}')"
denied "wf: Task general-purpose denied" "$(payload Task '{"subagent_type":"general-purpose"}')" "Explore"
denied "wf: Agent missing subagent_type denied" "$(payload Agent '{}')" "Explore"
allowed "wf: Workflow allowed" "$(payload Workflow '{"script":"agent(\"x\")"}')"

# --- #4 #5 model allowlist reaches subagents and forks -----------------------
new_proj '{"mode":"on","allowed-models":["haiku"]}'
denied "#4 subagent Agent opus denied" "$(payload Agent '{"subagent_type":"x","model":"opus"}' "$A")" "not in the allowlist"
allowed "#4 subagent Agent haiku allowed" "$(payload Agent '{"subagent_type":"x","model":"haiku"}' "$A")"
denied "#4 subagent Workflow missing model denied" "$(payload Workflow '{"script":"agent(\"a\")"}' "$A")" "must set model"
denied "#5 fork denied under allowlist" "$(payload Agent '{"subagent_type":"fork","model":"haiku"}')" "fork"
denied "D4 main Task omitted model denied" "$(payload Task '{"subagent_type":"x"}')" "declare"
new_proj '{"mode":"on"}'
allowed "#5 fork allowed without allowlist" "$(payload Agent '{"subagent_type":"fork"}')"
new_proj '{"mode":"wf","allowed-models":["sonnet"]}'
denied "wf: Explore must declare model too" "$(payload Task '{"subagent_type":"Explore"}')" "declare"
allowed "wf: Explore with allowed model" "$(payload Task '{"subagent_type":"Explore","model":"sonnet"}')"

# --- #6 pi mode ---------------------------------------------------------------
new_proj '{"mode":"pi","allowed-models":["qwen3-coder"]}'
PT=mcp__plugin_pi-delegate_pi-delegate__pi_task
denied "#6 pi_task off-list model denied" "$(payload $PT '{"text":"t","model":"opus"}')" "pi_task model"
allowed "#6 pi_task listed model allowed" "$(payload $PT '{"text":"t","model":"qwen3-coder"}')"
allowed "#6 pi_task omitted model uses pi config" "$(payload $PT '{"text":"t"}')"
new_proj '{"mode":"pi"}'
for t in Read SendMessage WebFetch Artifact ReportFindings; do
  allowed "#15 pi: $t allowed" "$(payload $t '{}')"
done
denied "pi: Task denied" "$(payload Task '{"subagent_type":"Explore"}')" "cannot spawn subagents"
denied "pi: Workflow denied" "$(payload Workflow '{"script":"1"}')"
allowed "pi: bare pi-delegate prefix allowed" "$(payload mcp__pi-delegate__pi_task '{"text":"t"}')"
denied "pi: other mcp denied" "$(payload mcp__discord__reply '{}')"

# --- #7 config lookup walks up ----------------------------------------------
new_proj '{"mode":"on"}'
mkdir -p "$PROJ/a/b"
CLAUDE_PROJECT_DIR="$PROJ/a/b" denied "#7 launch from subdir still locked" "$(payload Bash '{"command":"ls"}')"
CLAUDE_PROJECT_DIR="" denied "#7 no env var: walk up from payload cwd" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls\"},\"cwd\":\"$PROJ/a/b\"}"
printf '{"mode":"off"}' > "$PROJ/a/.orchestrator-mode.json"
CLAUDE_PROJECT_DIR="$PROJ/a/b" allowed "#7 nearest config wins" "$(payload Bash '{"command":"ls"}')"
new_proj 'on' legacy
denied "legacy .state still read" "$(payload Bash '{"command":"ls"}')"
printf '{"mode":"off"}' > "$PROJ/.orchestrator-mode.json"
allowed "JSON wins over legacy in the same dir" "$(payload Bash '{"command":"ls"}')"

# --- #9 memory exemption, symlinks ------------------------------------------
new_proj '{"mode":"wf"}'
mkdir -p "$PROJ/.remember" "$PROJ/src"
allowed "#9 real .remember write allowed" "$(payload Write "{\"file_path\":\"$PROJ/.remember/now.md\"}")"
denied "#9 .remember sibling denied" "$(payload Write "{\"file_path\":\"$PROJ/.remember-evil/x\"}")"
rm -rf "$PROJ/.remember" && ln -s "$PROJ/src" "$PROJ/.remember"
denied "#9 symlinked .remember denied" "$(payload Write "{\"file_path\":\"$PROJ/.remember/app.py\"}")"
denied "#9 target of the symlink denied" "$(payload Write "{\"file_path\":\"$PROJ/src/app.py\"}")"

new_proj '{"mode":"wf"}'
P2="$ROOT/my_proj.v2"; mkdir -p "$P2"; printf '{"mode":"wf"}' > "$P2/.orchestrator-mode.json"
SLUG="$(printf '%s' "$P2" | sed 's/[^A-Za-z0-9]/-/g')"
export CLAUDE_PROJECT_DIR="$P2"
allowed "mem: Write under CLAUDE_CONFIG_DIR memory" \
  "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$CFG/projects/$SLUG/memory/note.md\"},\"cwd\":\"$P2\"}"
allowed "mem: NotebookEdit under memory" \
  "{\"tool_name\":\"NotebookEdit\",\"tool_input\":{\"notebook_path\":\"$CFG/projects/$SLUG/memory/n.ipynb\"},\"cwd\":\"$P2\"}"
denied "mem: sibling of memory dir denied" \
  "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$CFG/projects/$SLUG/memory-evil/x.md\"},\"cwd\":\"$P2\"}"
denied "mem: old slug (only / replaced) denied" \
  "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$CFG/projects/$(printf '%s' "$P2" | tr / -)/memory/x.md\"},\"cwd\":\"$P2\"}"
mkdir -p "$ROOT/home/.claude"
HOME="$ROOT/home" CLAUDE_CONFIG_DIR="" allowed "mem: empty CLAUDE_CONFIG_DIR means ~/.claude" \
  "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$ROOT/home/.claude/projects/$SLUG/memory/MEMORY.md\"},\"cwd\":\"$P2\"}"
denied "mem: other profile's memory denied" \
  "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$ROOT/home/.claude/projects/$SLUG/memory/x.md\"},\"cwd\":\"$P2\"}"
mkdir -p "$ROOT/elsewhere" "$CFG/projects/$SLUG" && ln -s "$ROOT/elsewhere" "$CFG/projects/$SLUG/memory"
denied "#9 symlinked memory dir denied" \
  "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$CFG/projects/$SLUG/memory/x.md\"},\"cwd\":\"$P2\"}"

# --- #10 #13 Workflow model lint -------------------------------------------
new_proj '{"mode":"wf","allowed-models":["sonnet"]}'
wf() { payload Workflow "$(python3 -c 'import json,sys; print(json.dumps({"script": sys.argv[1]}))' "$1")"; }
allowed "#13 every call declares an allowed model" "$(wf 'await agent("a (b)", {model: "sonnet"}); agent(`c`, {"model": "claude-sonnet-5"})')"
allowed "#13 subagent( is not an agent() call" "$(wf 'subagent("a")')"
allowed "#13 agent( inside a string is ignored" "$(wf 'log("agent(x)"); agent("y", {model: "sonnet"})')"
denied "#13 comment cannot supply the model" "$(wf $'// model: sonnet model: sonnet\nagent("a"); agent("b")')" "line 2"
denied "#13 model: inside the prompt string doesn't count" "$(wf 'agent("use model: \"sonnet\"")')" "must set model"
denied "#13 model from a variable denied" "$(wf 'const m = "sonnet"; agent("a", {model: m})')" "string literal"
denied "#13 off-list literal denied" "$(wf 'agent("a", {model: "opus"})')" "'opus'"
denied "#13 template literal with \${} denied" "$(wf 'agent("a", {model: `${x}`})')" "string literal"
denied "#13 named workflow can't be linted" "$(payload Workflow '{"name":"review"}')" "named/saved"
printf 'agent("a", {model: "sonnet"})' > "$PROJ/ok.js"
allowed "#13 scriptPath relative, regular file" "$(payload Workflow '{"scriptPath":"ok.js"}')"
denied "#10 scriptPath missing file denied" "$(payload Workflow '{"scriptPath":"nope.js"}')" "can't lint"
mkfifo "$PROJ/fifo.js"
start=$SECONDS
denied "#10 scriptPath FIFO denied without hanging" "$(payload Workflow '{"scriptPath":"fifo.js"}')" "regular file"
[ $((SECONDS-start)) -lt 3 ] || { echo "FAIL #10 FIFO took $((SECONDS-start))s"; fail=$((fail+1)); }
new_proj '{"mode":"on"}'
allowed "no allowlist: named workflow allowed" "$(payload Workflow '{"name":"review"}')"

# --- #11 fail closed on bad input, fail open on bad config ------------------
new_proj '{"mode":"on"}'
denied "#11 tool_input null (main Write) denied, no crash" "$(payload Write null)"
allowed "#11 tool_input null (subagent Edit) no crash" "$(payload Edit null "$A")"
denied "#11 tool_input string denied" "$(payload Write '"x"')"
denied "#11 non-object payload denied" '[1,2]'
denied "#11 internal error fails closed" "{\"tool_name\":[\"Bash\"],\"tool_input\":{},\"cwd\":\"$PROJ\"}" "internal error"
run_case "#11 unparseable stdin fails open" enforce-orchestrator.py 'not json' 0 "__EMPTY__" ""
new_proj '{"mode":"on",'
run_case "#11 malformed JSON config -> warn + off" enforce-orchestrator.py "$(payload Bash '{"command":"ls"}')" 0 "__EMPTY__" "treating as OFF"
new_proj '{"mode":"on","main-allow":"mcp__x__*"}'
run_case "#11 schema violation -> warn + off" enforce-orchestrator.py "$(payload Bash '{"command":"ls"}')" 0 "__EMPTY__" "list of non-empty strings"
new_proj 'banana' legacy
run_case "#11 garbage legacy token -> warn + off" enforce-orchestrator.py "$(payload Bash '{"command":"ls"}')" 0 "__EMPTY__" "unrecognized mode token"
new_proj '' legacy
run_case "empty legacy file -> off, silent" enforce-orchestrator.py "$(payload Bash '{"command":"ls"}')" 0 "__EMPTY__" "__EMPTY__"

# --- #12 model matching -------------------------------------------------------
new_proj '{"mode":"on","allowed-models":["o"]}'
denied "#12 entry 'o' does not allow opus" "$(payload Task '{"subagent_type":"x","model":"opus"}')"
new_proj '{"mode":"on","allowed-models":["sonnet","claude-opus-5"]}'
allowed "#12 family token match" "$(payload Task '{"subagent_type":"x","model":"claude-sonnet-5-5"}')"
allowed "#12 id prefix at boundary" "$(payload Task '{"subagent_type":"x","model":"claude-opus-5-5"}')"
denied "#12 id prefix mid-token denied" "$(payload Task '{"subagent_type":"x","model":"claude-opus-50"}')"
denied "#12 case-insensitive off-list" "$(payload Task '{"subagent_type":"x","model":"HAIKU"}')"
new_proj 'on allowed-models=opus, haiku' legacy
allowed "#12 legacy spaced list keeps haiku" "$(payload Task '{"subagent_type":"x","model":"haiku"}')"
denied "#12 legacy spaced list still restricts" "$(payload Task '{"subagent_type":"x","model":"sonnet"}')"

# --- #14 side effects and MCP patterns ---------------------------------------
new_proj '{"mode":"on","main-allow":["mcp__okto-neuron__*","mcp__x__read"]}'
allowed "#14 Artifact publish allowed" "$(payload Artifact '{"file_path":"a.html"}')"
denied "#14 Artifact delete denied" "$(payload Artifact '{"action":"delete","url":"u"}')" "irreversible"
allowed "#14 CronCreate session-only allowed" "$(payload CronCreate '{"durable":false}')"
denied "#14 CronCreate durable denied" "$(payload CronCreate '{"durable":true}')" "durable"
allowed "main-allow prefix pattern" "$(payload mcp__okto-neuron__ask '{}')"
allowed "main-allow exact pattern" "$(payload mcp__x__read '{}')"
denied "#14 exact pattern is not a prefix" "$(payload mcp__x__readwrite '{}')"
denied "#14 discord no longer hard-coded" "$(payload mcp__plugin_discord_discord__reply '{}')"
denied "#14 waha send no longer hard-coded" "$(payload mcp__waha-whatsapp__whatsapp_send_text '{}')"
allowed "core pi-delegate allowed in on mode" "$(payload mcp__plugin_pi-delegate_pi-delegate__pi_setup '{}')"
printf '{"main-allow":["mcp__waha-whatsapp__whatsapp_send_text"]}' > "$CFG/orchestrator-mode.json"
allowed "user-wide main-allow applies" "$(payload mcp__waha-whatsapp__whatsapp_send_text '{}')"
denied "user-wide exact entry is not a prefix" "$(payload mcp__waha-whatsapp__whatsapp_send_textx '{}')"
printf '{"main-allow":"oops"}' > "$CFG/orchestrator-mode.json"
run_case "broken user-wide config ignored (fewer tools)" enforce-orchestrator.py \
  "$(payload mcp__waha-whatsapp__whatsapp_send_text '{}')" 0 "$DENY_MARK" "ignored"

echo
echo "test_enforce.sh: $pass/$total passed"
[ "$fail" -eq 0 ]
