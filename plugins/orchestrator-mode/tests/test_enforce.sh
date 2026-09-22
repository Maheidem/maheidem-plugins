#!/usr/bin/env bash
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/helpers.sh"

# 1. mode off, Read -> no-op
new_proj "off"
run_case "off/Read no-op" enforce-orchestrator.py \
  "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"x\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

# 2. mode on, Read allowed
new_proj "on"
run_case "on/Read allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"x\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

# 3. mode on, Edit denied
new_proj "on"
run_case "on/Edit denied" enforce-orchestrator.py \
  "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"foo.py\"},\"cwd\":\"$TMP/proj\"}" \
  0 "deny" ""
run_case "on/Edit denied reason" enforce-orchestrator.py \
  "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"foo.py\"},\"cwd\":\"$TMP/proj\"}" \
  0 "read-only" ""

# 4. mode on, Bash denied
new_proj "on"
run_case "on/Bash denied" enforce-orchestrator.py \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls\"},\"cwd\":\"$TMP/proj\"}" \
  0 "deny" ""

# 5. mode on, mcp__x denied
new_proj "on"
run_case "on/mcp denied" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__foo__bar\",\"tool_input\":{},\"cwd\":\"$TMP/proj\"}" \
  0 "deny" ""

# 6. mode wf, Task Explore allowed
new_proj "wf"
run_case "wf/Task Explore allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"Task\",\"tool_input\":{\"subagent_type\":\"Explore\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

# 7. mode wf, Task non-Explore denied
new_proj "wf"
run_case "wf/Task non-Explore denied" enforce-orchestrator.py \
  "{\"tool_name\":\"Task\",\"tool_input\":{\"subagent_type\":\"general-purpose\"},\"cwd\":\"$TMP/proj\"}" \
  0 "Explore" ""

# 8. mode wf, Workflow allowed
new_proj "wf"
run_case "wf/Workflow allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"Workflow\",\"tool_input\":{\"script\":\"agent('x', model: \\\"sonnet\\\")\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

# 9. mode pi, Task denied outright (no subagent target exists anymore)
new_proj "pi"
run_case "pi/Task denied outright" enforce-orchestrator.py \
  "{\"tool_name\":\"Task\",\"tool_input\":{\"subagent_type\":\"pi-delegate:delegate\"},\"cwd\":\"$TMP/proj\"}" \
  0 "cannot delegate to any subagent" ""

# 10. mode pi, Task with any other subagent_type also denied
new_proj "pi"
run_case "pi/Task non-pi-delegate denied" enforce-orchestrator.py \
  "{\"tool_name\":\"Task\",\"tool_input\":{\"subagent_type\":\"Explore\"},\"cwd\":\"$TMP/proj\"}" \
  0 "deny" ""

# 11. mode pi, Workflow denied
new_proj "pi"
run_case "pi/Workflow denied" enforce-orchestrator.py \
  "{\"tool_name\":\"Workflow\",\"tool_input\":{\"script\":\"print(1)\"},\"cwd\":\"$TMP/proj\"}" \
  0 "deny" ""

# 12. subagent bypass full access
new_proj "on"
run_case "on/subagent full access" enforce-orchestrator.py \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"rm -rf /\"},\"agent_id\":\"sub-1\",\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

# 13. subagent Write to state file denied
new_proj "on"
run_case "on/subagent Write state file denied" enforce-orchestrator.py \
  "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$TMP/proj/.orchestrator-mode.state\"},\"agent_id\":\"sub-1\",\"cwd\":\"$TMP/proj\"}" \
  0 "subagents may not toggle" ""

# 14. D1: main-thread toggle Write -> silent no-op
new_proj "on"
run_case "on/D1 main-thread toggle Write no-op" enforce-orchestrator.py \
  "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$TMP/proj/.orchestrator-mode.state\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

# 15. D3 family match: matching substring model allowed
new_proj "on allowed-models=sonnet"
run_case "D3/family match allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"Task\",\"tool_input\":{\"subagent_type\":\"foo\",\"model\":\"claude-sonnet-5\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

# 16. D3: off-list model denied
new_proj "on allowed-models=sonnet"
run_case "D3/off-list model denied" enforce-orchestrator.py \
  "{\"tool_name\":\"Task\",\"tool_input\":{\"subagent_type\":\"foo\",\"model\":\"opus\"},\"cwd\":\"$TMP/proj\"}" \
  0 "sonnet" ""

# 17. D4a: Task omitting model while allowlist active -> denied
new_proj "on allowed-models=sonnet"
run_case "D4a/omitted model denied" enforce-orchestrator.py \
  "{\"tool_name\":\"Task\",\"tool_input\":{\"subagent_type\":\"foo\"},\"cwd\":\"$TMP/proj\"}" \
  0 "Declare model" ""

# 18. D4b: Workflow script, agent() calls without model -> denied
new_proj "wf allowed-models=sonnet"
run_case "D4b/agent() missing model denied" enforce-orchestrator.py \
  "{\"tool_name\":\"Workflow\",\"tool_input\":{\"script\":\"agent('a'); agent('b')\"},\"cwd\":\"$TMP/proj\"}" \
  0 "deny" ""

# 19. D4b: zero agent() calls -> not denied
new_proj "wf allowed-models=sonnet"
run_case "D4b/zero agent() calls allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"Workflow\",\"tool_input\":{\"script\":\"print('hi')\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

# 20. D4b: all agent() calls declare model -> allowed
new_proj "wf allowed-models=sonnet"
run_case "D4b/agent() with model allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"Workflow\",\"tool_input\":{\"script\":\"agent('a', model: \\\"sonnet\\\")\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

# 21. T5: corrupted state file garbage token -> fail open, stderr warning
new_proj "banana"
run_case "T5/garbage token fail-open" enforce-orchestrator.py \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" "unrecognized state-file mode token"

# 22. state file explicit off -> no warning
new_proj "off"
run_case "T5/explicit off no warning" enforce-orchestrator.py \
  "{\"tool_name\":\"Read\",\"tool_input\":{},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" "__EMPTY__"

# 23. missing state file -> no warning
TMP="$(mktemp -d)"
mkdir -p "$TMP/proj"
export CLAUDE_PROJECT_DIR="$TMP/proj"
run_case "T5/missing state file no warning" enforce-orchestrator.py \
  "{\"tool_name\":\"Read\",\"tool_input\":{},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" "__EMPTY__"

# 24. D2: subagent Bash containing state-file path denied
new_proj "on"
run_case "D2/subagent Bash state-file path denied" enforce-orchestrator.py \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat .orchestrator-mode.state\"},\"agent_id\":\"sub-1\",\"cwd\":\"$TMP/proj\"}" \
  0 "state-file changes go through" ""

# 25. D2: main-thread Bash containing state-file path denied (specific D2 reason)
new_proj "on"
run_case "D2/main-thread Bash state-file path denied" enforce-orchestrator.py \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"echo off > .orchestrator-mode.state\"},\"cwd\":\"$TMP/proj\"}" \
  0 "state-file changes go through" ""

# 25b. D2 is checked before the general subagent bypass: a subagent Bash call
# that would otherwise be granted full access (step 5) is still denied here
# because D2 (step 3) runs first and is the only reason it's denied.
new_proj "on"
run_case "D2/subagent Bash state-file path denied before subagent bypass" enforce-orchestrator.py \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"cat .orchestrator-mode.state\"},\"agent_id\":\"sub-2\",\"cwd\":\"$TMP/proj\"}" \
  0 "state-file changes go through" ""

# 26. D2: mcp__* tool with state-file substring in tool_input denied
new_proj "on"
run_case "D2/mcp state-file substring denied" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__nextcloud__nc_webdav_write_file\",\"tool_input\":{\"path\":\"/x/.orchestrator-mode.state\"},\"agent_id\":\"sub-1\",\"cwd\":\"$TMP/proj\"}" \
  0 "state-file changes go through" ""

# 27. D3 malformed allowlist -> discarded, fail open, stderr warning
new_proj "on allowed-models=opus, haiku"
run_case "D3/malformed allowlist discarded" enforce-orchestrator.py \
  "{\"tool_name\":\"Task\",\"tool_input\":{\"subagent_type\":\"foo\",\"model\":\"gpt-4\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" "malformed allowed-models"

# 28. malformed allowlist + omitted model still allowed (D4 doesn't fire)
new_proj "on allowed-models=opus, haiku"
run_case "D3/malformed allowlist + omitted model allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"Task\",\"tool_input\":{\"subagent_type\":\"foo\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" "malformed allowed-models"

# 29. mode wf, CronCreate allowed (scheduling/loop meta-tool, added 2026-07-28)
new_proj "wf"
run_case "wf/CronCreate allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"CronCreate\",\"tool_input\":{\"schedule\":\"* * * * *\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

# 30. mode on, Monitor allowed (read-only/introspection tool)
new_proj "on"
run_case "on/Monitor allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"Monitor\",\"tool_input\":{},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

# pi mode: pi-delegate MCP tools allowed by prefix (D5-D, pi-delegate ADR-002)
new_proj "pi"
run_case "pi/mcp pi-delegate allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__pi-delegate__pi_conversation_send\",\"tool_input\":{\"name\":\"x\",\"message\":\"hi\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

# pi mode: plugin-qualified runtime name (as Claude Code actually exposes it)
new_proj "pi"
run_case "pi/mcp pi-delegate plugin-qualified allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__plugin_pi-delegate_pi-delegate__pi_task\",\"tool_input\":{\"text\":\"hi\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

# pi mode: other MCP tools still denied
new_proj "pi"
run_case "pi/mcp other denied" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__foo__bar\",\"tool_input\":{},\"cwd\":\"$TMP/proj\"}" \
  0 "deny" ""

# presales-toolkit MCP carve-out (0.9.2): plugin-qualified prefix allowed
# under all three active modes, for both a read tool and a write tool.
new_proj "on"
run_case "on/mcp presales-toolkit read allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__plugin_presales-toolkit_db__stakeholder_list\",\"tool_input\":{\"client\":\"x\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

new_proj "wf"
run_case "wf/mcp presales-toolkit read allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__plugin_presales-toolkit_db__stakeholder_list\",\"tool_input\":{\"client\":\"x\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

new_proj "pi"
run_case "pi/mcp presales-toolkit read allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__plugin_presales-toolkit_db__stakeholder_list\",\"tool_input\":{\"client\":\"x\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

new_proj "on"
run_case "on/mcp presales-toolkit write allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__plugin_presales-toolkit_db__stakeholder_upsert\",\"tool_input\":{\"client\":\"x\",\"name\":\"y\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

new_proj "wf"
run_case "wf/mcp presales-toolkit write allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__plugin_presales-toolkit_db__stakeholder_upsert\",\"tool_input\":{\"client\":\"x\",\"name\":\"y\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

new_proj "pi"
run_case "pi/mcp presales-toolkit write allowed" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__plugin_presales-toolkit_db__stakeholder_upsert\",\"tool_input\":{\"client\":\"x\",\"name\":\"y\"},\"cwd\":\"$TMP/proj\"}" \
  0 "__EMPTY__" ""

# The carve-out is a specific prefix allowlist, not a blanket mcp__* pass: a
# non-allowlisted MCP tool is still denied under all three active modes.
new_proj "on"
run_case "on/mcp non-allowlisted denied" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__claude_ai_Slack__slack_send_message\",\"tool_input\":{},\"cwd\":\"$TMP/proj\"}" \
  0 "deny" ""

new_proj "wf"
run_case "wf/mcp non-allowlisted denied" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__claude_ai_Slack__slack_send_message\",\"tool_input\":{},\"cwd\":\"$TMP/proj\"}" \
  0 "deny" ""

new_proj "pi"
run_case "pi/mcp non-allowlisted denied" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__claude_ai_Slack__slack_send_message\",\"tool_input\":{},\"cwd\":\"$TMP/proj\"}" \
  0 "deny" ""

# D2 still wins over the presales-toolkit carve-out: an allowlisted-prefix
# MCP call whose tool_input mentions the state file is denied regardless.
new_proj "on"
run_case "D2/mcp presales-toolkit state-file substring denied" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__plugin_presales-toolkit_db__misc_add\",\"tool_input\":{\"note\":\"see /x/.orchestrator-mode.state\"},\"cwd\":\"$TMP/proj\"}" \
  0 "state-file changes go through" ""

# --- 0.9.4: exact-match send tool (ALLOWED_MCP_TOOLS) -----------------------
for m in on wf pi; do
  new_proj "$m"
  run_case "$m/mcp waha send_text exact allowed" enforce-orchestrator.py \
    "{\"tool_name\":\"mcp__waha-whatsapp__whatsapp_send_text\",\"tool_input\":{\"chatId\":\"x\",\"text\":\"hi\"},\"cwd\":\"$TMP/proj\"}" \
    0 "__EMPTY__" ""
  run_case "$m/mcp waha other tool still denied" enforce-orchestrator.py \
    "{\"tool_name\":\"mcp__waha-whatsapp__whatsapp_delete_message\",\"tool_input\":{},\"cwd\":\"$TMP/proj\"}" \
    0 "deny" ""
  run_case "$m/mcp waha send_text prefix-extension denied" enforce-orchestrator.py \
    "{\"tool_name\":\"mcp__waha-whatsapp__whatsapp_send_text_bulk\",\"tool_input\":{},\"cwd\":\"$TMP/proj\"}" \
    0 "deny" ""
done
new_proj "on"
run_case "on/mcp waha send_text state-file substring denied" enforce-orchestrator.py \
  "{\"tool_name\":\"mcp__waha-whatsapp__whatsapp_send_text\",\"tool_input\":{\"text\":\"/x/.orchestrator-mode.state\"},\"cwd\":\"$TMP/proj\"}" \
  0 "state-file changes go through" ""

# --- 0.9.4: auto-memory exemption follows CLAUDE_CONFIG_DIR + real slug rule --
# Project path with '_' and '.' (both become '-' in Claude Code's slug).
TMP="$(mktemp -d)"
PROJ="$TMP/my_proj.v2"
mkdir -p "$PROJ" && printf 'wf' > "$PROJ/.orchestrator-mode.state"
export CLAUDE_PROJECT_DIR="$PROJ"
SLUG="$(printf '%s' "$PROJ" | sed 's/[^A-Za-z0-9]/-/g')"
mkdir -p "$TMP/home/.claude" "$TMP/work"

(
  export HOME="$TMP/home"; unset CLAUDE_CONFIG_DIR
  run_case "mem/personal (CLAUDE_CONFIG_DIR unset) ~/.claude memory allowed" enforce-orchestrator.py \
    "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$TMP/home/.claude/projects/$SLUG/memory/note.md\",\"content\":\"x\"},\"cwd\":\"$PROJ\"}" \
    0 "__EMPTY__" ""
  run_case "mem/personal: work-profile memory path denied" enforce-orchestrator.py \
    "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$TMP/work/projects/$SLUG/memory/note.md\",\"content\":\"x\"},\"cwd\":\"$PROJ\"}" \
    0 "deny" ""
  run_case "mem/old slug (only / replaced) denied" enforce-orchestrator.py \
    "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$TMP/home/.claude/projects/$(printf '%s' "$PROJ" | tr / -)/memory/note.md\",\"content\":\"x\"},\"cwd\":\"$PROJ\"}" \
    0 "deny" ""
  export CLAUDE_CONFIG_DIR=""
  run_case "mem/empty CLAUDE_CONFIG_DIR treated as unset" enforce-orchestrator.py \
    "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$TMP/home/.claude/projects/$SLUG/memory/MEMORY.md\",\"old_string\":\"a\",\"new_string\":\"b\"},\"cwd\":\"$PROJ\"}" \
    0 "__EMPTY__" ""
  echo "$pass $fail $total" > "$TMP/counts"
)
read pass fail total < "$TMP/counts"
(
  export HOME="$TMP/home" CLAUDE_CONFIG_DIR="$TMP/work"
  run_case "mem/work (CLAUDE_CONFIG_DIR set) memory allowed" enforce-orchestrator.py \
    "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$TMP/work/projects/$SLUG/memory/note.md\",\"content\":\"x\"},\"cwd\":\"$PROJ\"}" \
    0 "__EMPTY__" ""
  run_case "mem/work: ~/.claude memory path denied" enforce-orchestrator.py \
    "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$TMP/home/.claude/projects/$SLUG/memory/note.md\",\"content\":\"x\"},\"cwd\":\"$PROJ\"}" \
    0 "deny" ""
  run_case "mem/work: sibling of memory dir denied" enforce-orchestrator.py \
    "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$TMP/work/projects/$SLUG/memory-evil/x.md\",\"content\":\"x\"},\"cwd\":\"$PROJ\"}" \
    0 "deny" ""
  echo "$pass $fail $total" > "$TMP/counts"
)
read pass fail total < "$TMP/counts"

echo
echo "test_enforce.sh: $pass/$total passed"
[ "$fail" -eq 0 ]
