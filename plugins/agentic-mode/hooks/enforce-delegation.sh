#!/bin/bash
# Agentic Mode - Enforce Delegation Hook
# Blocks direct tool use in main session, forcing delegation to subagents via Task tool

set -euo pipefail

# Read full input from stdin
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Always allow Task tool (the delegation mechanism)
[[ "$TOOL_NAME" == "Task" ]] && exit 0

# =============================================================================
# SUBAGENT DETECTION (Beads Orchestration Method)
# Subagents run from transcript subfolders - detect by matching tool_use_id
# =============================================================================
IS_SUBAGENT="false"
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
TOOL_USE_ID=$(echo "$INPUT" | jq -r '.tool_use_id // empty')

if [[ -n "$TRANSCRIPT_PATH" ]] && [[ -n "$TOOL_USE_ID" ]]; then
  # Session dir is transcript path without .jsonl extension
  SESSION_DIR="${TRANSCRIPT_PATH%.jsonl}"
  SUBAGENTS_DIR="$SESSION_DIR/subagents"

  if [[ -d "$SUBAGENTS_DIR" ]]; then
    # Search for tool_use_id in any subagent transcript (use -F for literal match)
    MATCHING=$(grep -Fl "\"id\":\"$TOOL_USE_ID\"" "$SUBAGENTS_DIR"/agent-*.jsonl 2>/dev/null | head -1 || true)
    [[ -n "$MATCHING" ]] && IS_SUBAGENT="true"
  fi
fi

# Subagents can use any tools - no restrictions
[[ "$IS_SUBAGENT" == "true" ]] && exit 0

# =============================================================================
# CONFIG LOADING
# Check for .claude/agentic-mode.local.md in working directory
# =============================================================================
WORKING_DIR=$(echo "$INPUT" | jq -r '.cwd // empty')
CONFIG_FILE="${WORKING_DIR}/.claude/agentic-mode.local.md"

# Default: disabled if no config exists
ENABLED="false"

if [[ -f "$CONFIG_FILE" ]]; then
  # Extract YAML frontmatter (between --- markers)
  FRONTMATTER=$(sed -n '/^---$/,/^---$/p' "$CONFIG_FILE" | sed '1d;$d')

  # Parse enabled flag
  ENABLED=$(echo "$FRONTMATTER" | grep -E '^enabled:' | sed 's/enabled:[[:space:]]*//' | tr -d '[:space:]' || echo "false")
fi

# If not enabled, allow all tools
[[ "$ENABLED" != "true" ]] && exit 0

# =============================================================================
# AGENT SUGGESTIONS
# Map blocked tools to recommended agents
# =============================================================================
get_agent_suggestion() {
  local tool="$1"
  case "$tool" in
    Edit|Write)
      echo "Use 'general-programmer-agent' for code changes, or 'project-docs-writer' for documentation"
      ;;
    Bash)
      echo "Use 'general-programmer-agent' for command execution, 'data-scientist-agent' for analysis, or 'mcp-manager-agent' for MCP tasks"
      ;;
    NotebookEdit)
      echo "Use 'jupyter-notebook-agent' for notebook operations"
      ;;
    *)
      echo "Delegate to an appropriate agent using the Task tool"
      ;;
  esac
}

SUGGESTION=$(get_agent_suggestion "$TOOL_NAME")

# =============================================================================
# BLOCK TOOL USE
# Return JSON deny response with helpful suggestion
# =============================================================================
REASON="Agentic mode is enabled. Direct use of '$TOOL_NAME' is blocked in the main session. $SUGGESTION"

cat << EOF
{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"$REASON"},"systemMessage":"Tool blocked by agentic-mode. Delegate to subagent."}
EOF

exit 0
