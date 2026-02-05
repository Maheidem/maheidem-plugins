#!/bin/bash
# invoke-cli.sh - Safely invoke AI CLI tools with READ-ONLY enforcement
#
# Usage: invoke-cli.sh <tool> <prompt> <cwd> <timeout>
#
# CRITICAL SAFETY RULES:
# 1. ONLY READ-ONLY sandbox modes are used
# 2. NEVER pass --yolo, --dangerously-bypass-approvals-and-sandbox, --full-auto
# 3. All output is captured, no interactive mode
# 4. Strict timeout enforcement

set -e

# ============================================================================
# SAFETY: FORBIDDEN FLAGS - NEVER USE THESE
# ============================================================================
FORBIDDEN_FLAGS=(
    "--yolo"
    "-y"
    "--dangerously-bypass-approvals-and-sandbox"
    "--full-auto"
    "--auto-approve"
    "--no-sandbox"
    "--sandbox=write"
    "--sandbox=full"
)

# Check if prompt contains forbidden flags (injection attempt)
check_injection() {
    local prompt="$1"
    for flag in "${FORBIDDEN_FLAGS[@]}"; do
        # Use bash pattern matching (grep treats -- flags as options)
        if [[ "$prompt" == *"$flag"* ]]; then
            echo "ERROR: Potential injection detected - forbidden flag in prompt: $flag" >&2
            exit 1
        fi
    done
}

# ============================================================================
# ARGUMENT PARSING
# ============================================================================
TOOL="$1"
PROMPT="$2"
CWD="${3:-.}"
TIMEOUT="${4:-120}"

if [ -z "$TOOL" ] || [ -z "$PROMPT" ]; then
    echo "Usage: invoke-cli.sh <tool> <prompt> [cwd] [timeout]" >&2
    echo "  tool: codex|gemini|opencode|aider" >&2
    echo "  prompt: Question to ask (will be quoted)" >&2
    echo "  cwd: Working directory (default: .)" >&2
    echo "  timeout: Max seconds (default: 120)" >&2
    exit 1
fi

# Safety check
check_injection "$PROMPT"

# ============================================================================
# TOOL INVOCATION (READ-ONLY ONLY)
# ============================================================================
invoke_tool() {
    local tool="$1"
    local prompt="$2"
    local cwd="$3"
    local timeout_secs="$4"

    # Record start time
    local start_time=$(date +%s.%N)

    case "$tool" in
        codex)
            # SAFETY: -s read-only prevents all file writes
            # --skip-git-repo-check allows running outside git repos
            timeout "${timeout_secs}s" codex exec --skip-git-repo-check -s read-only -C "$cwd" "$prompt" 2>&1
            ;;

        gemini)
            # SAFETY: -p flag is prompt-only mode, no file access
            timeout "${timeout_secs}s" gemini -p "$prompt" 2>&1
            ;;

        opencode)
            # SAFETY: --format json produces output only, no modifications
            timeout "${timeout_secs}s" opencode run --format json "$prompt" 2>&1
            ;;

        aider)
            # SAFETY: --no-auto-commits --yes prevents modifications
            # Note: aider may still read files in cwd
            cd "$cwd" && timeout "${timeout_secs}s" aider --no-auto-commits --yes --message "$prompt" 2>&1
            ;;

        agent)
            # SAFETY: --mode ask is read-only (Q&A mode, no edits)
            # -p for non-interactive print mode
            timeout "${timeout_secs}s" agent --mode ask -p --output-format text "$prompt" 2>&1
            ;;

        *)
            echo "ERROR: Unknown tool: $tool" >&2
            echo "Supported tools: codex, gemini, opencode, aider, agent" >&2
            exit 1
            ;;
    esac

    local exit_code=$?
    local end_time=$(date +%s.%N)
    local duration=$(echo "$end_time - $start_time" | bc 2>/dev/null || echo "unknown")

    # Return timing info to stderr for parsing
    echo "TIMING:${duration}s" >&2

    return $exit_code
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

# Verify tool exists
if ! command -v "$TOOL" &>/dev/null; then
    echo "ERROR: Tool not found: $TOOL" >&2
    exit 1
fi

# Execute with safety constraints
invoke_tool "$TOOL" "$PROMPT" "$CWD" "$TIMEOUT"
