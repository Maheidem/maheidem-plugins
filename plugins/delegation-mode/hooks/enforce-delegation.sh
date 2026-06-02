#!/bin/bash
# Agentic Mode - Enforce Delegation Hook (v0.4.0)
# Blocks direct tool use in main session, forcing delegation to subagents via Task tool

set -euo pipefail

# =============================================================================
# DEBUG LOGGING
# Set AGENTIC_DEBUG=true for verbose output to stderr
# =============================================================================
log_debug() {
  [[ "${AGENTIC_DEBUG:-false}" == "true" ]] && echo "[agentic-mode] $*" >&2 || true
}

# =============================================================================
# DEPENDENCY CHECK
# =============================================================================
command -v jq &>/dev/null || exit 0  # Fail open if jq missing

# =============================================================================
# INPUT PARSING (consolidated: 4 jq calls → 1)
# =============================================================================
INPUT=$(cat)
read -r TOOL_NAME TRANSCRIPT_PATH TOOL_USE_ID WORKING_DIR < <(
  echo "$INPUT" | jq -r '[
    (.tool_name // ""),
    (.transcript_path // ""),
    (.tool_use_id // ""),
    (.cwd // "")
  ] | @tsv' 2>/dev/null
) || exit 0

log_debug "Tool=$TOOL_NAME, TranscriptPath=$TRANSCRIPT_PATH, CWD=$WORKING_DIR"

# Always allow Task tool (the delegation mechanism)
[[ "$TOOL_NAME" == "Task" ]] && { log_debug "Task tool → ALLOW"; exit 0; }

# =============================================================================
# SUBAGENT DETECTION (path-based)
# If transcript_path contains /subagents/, this is a subagent call
# =============================================================================
IS_SUBAGENT="false"

if [[ -n "$TRANSCRIPT_PATH" ]] && [[ "$TRANSCRIPT_PATH" == *"/subagents/"* ]]; then
  IS_SUBAGENT="true"
fi

log_debug "IS_SUBAGENT=$IS_SUBAGENT"

# Subagents can use any tools - no restrictions
[[ "$IS_SUBAGENT" == "true" ]] && { log_debug "Subagent detected → ALLOW"; exit 0; }

# =============================================================================
# CONFIG LOADING
# Check for .claude/agentic-mode.local.md in working directory
# =============================================================================
CONFIG_FILE="${WORKING_DIR}/.claude/agentic-mode.local.md"

# Default: disabled if no config exists
ENABLED="false"
BLOCKED_TOOLS=""
BASH_WHITELIST=""
FRONTMATTER=""

if [[ -f "$CONFIG_FILE" ]]; then
  log_debug "Config found: $CONFIG_FILE"

  # Extract YAML frontmatter (first --- block only)
  FRONTMATTER=$(awk '/^---$/{if(++c==2) exit; next} c==1{print}' "$CONFIG_FILE")

  # Parse enabled flag
  ENABLED=$(echo "$FRONTMATTER" | grep -E '^enabled:' | sed 's/enabled:[[:space:]]*//' | tr -d '[:space:]' || echo "false")

  # Parse blocked_tools list (YAML list items under blocked_tools:)
  BLOCKED_TOOLS=$(awk '
    /^blocked_tools:/ { capture=1; next }
    /^[a-zA-Z_]/ { capture=0 }
    capture && /^[[:space:]]*-/ {
      sub(/^[[:space:]]*-[[:space:]]*/, "")
      gsub(/[[:space:]]/, "")
      if (result) result = result "|" $0
      else result = $0
    }
    END { print result }
  ' <<< "$FRONTMATTER")

  # Parse bash_whitelist (newline-separated patterns)
  BASH_WHITELIST=$(awk '
    /^bash_whitelist:/ { capture=1; next }
    /^[a-zA-Z_]/ { capture=0 }
    capture && /^[[:space:]]*-/ {
      sub(/^[[:space:]]*-[[:space:]]*/, "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      if (NF) print
    }
  ' <<< "$FRONTMATTER")

  log_debug "Enabled=$ENABLED, BlockedTools=$BLOCKED_TOOLS"
  [[ -n "$BASH_WHITELIST" ]] && log_debug "BashWhitelist loaded"
else
  log_debug "No config at $CONFIG_FILE → disabled"
fi

# If not enabled, allow all tools
[[ "$ENABLED" != "true" ]] && { log_debug "Not enabled → ALLOW"; exit 0; }

# =============================================================================
# EMPTY BLOCKED_TOOLS CHECK
# If enabled but no blocked_tools specified, nothing to block
# =============================================================================
[[ -z "$BLOCKED_TOOLS" ]] && { log_debug "No blocked_tools specified → ALLOW"; exit 0; }

# =============================================================================
# CONFIG-AWARE TOOL CHECK
# Only block tools that are in the user's blocked_tools list
# =============================================================================
if ! echo "$TOOL_NAME" | grep -qE "^($BLOCKED_TOOLS)$"; then
  # Tool not in blocked list, allow it
  log_debug "Tool '$TOOL_NAME' not in blocked list → ALLOW"
  exit 0
fi

# =============================================================================
# BASH WHITELIST CHECK
# If Bash is blocked but command matches a whitelisted pattern, allow it
# =============================================================================
if [[ "$TOOL_NAME" == "Bash" ]] && [[ -n "$BASH_WHITELIST" ]]; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
  if [[ -n "$COMMAND" ]]; then
    while IFS= read -r pattern; do
      if [[ -n "$pattern" ]] && [[ "$COMMAND" =~ ^$pattern ]]; then
        log_debug "Bash command matches whitelist pattern '$pattern' → ALLOW"
        exit 0
      fi
    done <<< "$BASH_WHITELIST"
  fi
fi

# =============================================================================
# AGENT SUGGESTIONS
# Map blocked tools to recommended agents (config first, hardcoded fallback)
# =============================================================================
get_agent_suggestion() {
  local tool="$1"

  # Try config first
  if [[ -n "$FRONTMATTER" ]]; then
    local suggestion
    suggestion=$(awk -v tool="$tool" '
      /^agent_suggestions:/ { capture=1; next }
      /^[a-zA-Z_]/ { if(capture) exit }
      capture && $0 ~ "^[[:space:]]+"tool":" {
        sub(/^[[:space:]]*[^:]+:[[:space:]]*/, ""); print; exit
      }
    ' <<< "$FRONTMATTER")
    if [[ -n "$suggestion" ]]; then
      echo "Use '$suggestion' via Task tool"
      return
    fi
  fi

  # Hardcoded fallback
  case "$tool" in
    Edit|Write)
      echo "Use 'general-programmer-agent' for code changes, or 'project-docs-writer' for documentation"
      ;;
    Bash)
      echo "Use 'general-programmer-agent' for command execution, or 'data-scientist-agent' for analysis"
      ;;
    NotebookEdit)
      echo "Use 'jupyter-notebook-agent' for notebook operations"
      ;;
    Read)
      echo "Use 'deep-research-agent' for file exploration"
      ;;
    *)
      echo "Delegate to an appropriate agent using the Task tool"
      ;;
  esac
}

SUGGESTION=$(get_agent_suggestion "$TOOL_NAME")
log_debug "Blocking '$TOOL_NAME' with suggestion: $SUGGESTION"

# =============================================================================
# BLOCK TOOL USE
# Return JSON deny response with helpful suggestion (jq for safe escaping)
# =============================================================================
REASON="Agentic mode is enabled. Direct use of '$TOOL_NAME' is blocked in the main session. $SUGGESTION"

jq -n --arg reason "$REASON" --arg msg "Tool blocked by agentic-mode. Delegate to subagent." \
  '{hookSpecificOutput:{permissionDecision:"deny",permissionDecisionReason:$reason},systemMessage:$msg}'

exit 0
