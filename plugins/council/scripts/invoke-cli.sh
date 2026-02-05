#!/bin/bash
# invoke-cli.sh - Safely invoke AI CLI tools with READ-ONLY enforcement
#
# Usage: invoke-cli.sh <tool> <prompt> <cwd> <timeout> [mode] [round] [context] [enabled_bash_tools] [bash_timeout]
#
# CRITICAL SAFETY RULES:
# 1. ONLY READ-ONLY sandbox modes are used
# 2. NEVER pass --yolo, --dangerously-bypass-approvals-and-sandbox, --full-auto
# 3. All output is captured, no interactive mode
# 4. Strict timeout enforcement
# 5. Bash tools only from validated allowlist
# 6. Dangerous commands always blocked

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

# ============================================================================
# SAFETY: BLOCKED BASH COMMANDS - NEVER ALLOW THESE
# ============================================================================
BLOCKED_BASH_COMMANDS=(
    "rm"
    "sudo"
    "chmod"
    "chown"
    "mkfs"
    "dd"
    "format"
    "fdisk"
    "kill"
    "pkill"
    "shutdown"
    "reboot"
    "mv"          # Can overwrite files
    "cp"          # Can overwrite files
    "wget"        # Can download arbitrary files
    "curl"        # Can download/upload (when used with -o or POST)
    "eval"        # Arbitrary code execution
    "exec"        # Arbitrary code execution
    "source"      # Can source malicious scripts
    ">"           # Redirect/overwrite
    ">>"          # Redirect/append
    "|"           # Pipe (could be dangerous in context)
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
# BASH TOOL ACCESS CONTROL
# ============================================================================

# Validate that requested bash tools are in the allowlist
# Returns 0 if all valid, 1 if any invalid
validate_bash_tools() {
    local enabled_tools="$1"
    local config_path="${2:-$HOME/.claude/council.local.md}"

    # If no tools requested, nothing to validate
    if [[ -z "$enabled_tools" ]]; then
        return 0
    fi

    # Parse allowlist from config file
    local allowlist=""
    if [[ -f "$config_path" ]]; then
        # Extract allowlist items between bash_tools: and next section
        allowlist=$(sed -n '/^bash_tools:/,/^[a-z_]*:/{/allowlist:/,/^[[:space:]]*[a-z]/p}' "$config_path" 2>/dev/null | \
                    grep -E '^[[:space:]]*-' | \
                    sed 's/^[[:space:]]*-[[:space:]]*//' | \
                    sed 's/#.*//' | \
                    tr -d '[:space:]' | \
                    tr '\n' ',' || echo "")
    fi

    # Default allowlist if none in config
    if [[ -z "$allowlist" ]]; then
        allowlist="gh,git,az,npm,docker,kubectl,yarn,pnpm,cargo,pip"
    fi

    # Check each requested tool
    IFS=',' read -ra TOOLS <<< "$enabled_tools"
    for tool in "${TOOLS[@]}"; do
        tool=$(echo "$tool" | tr -d '[:space:]')

        # Check against blocked commands (always blocked regardless of allowlist)
        for blocked in "${BLOCKED_BASH_COMMANDS[@]}"; do
            if [[ "$tool" == "$blocked" ]]; then
                echo "ERROR: Blocked command requested: $tool" >&2
                return 1
            fi
        done

        # Check against allowlist
        if [[ ",$allowlist," != *",$tool,"* ]]; then
            echo "ERROR: Bash tool not in allowlist: $tool" >&2
            echo "Allowed tools: $allowlist" >&2
            return 1
        fi
    done

    return 0
}

# Generate bash tool context for the prompt
generate_bash_tool_context() {
    local enabled_tools="$1"
    local bash_timeout="${2:-30}"

    # If no tools enabled, return empty
    if [[ -z "$enabled_tools" ]]; then
        echo ""
        return
    fi

    # Build the tool context
    cat << EOF

AVAILABLE BASH TOOLS: ${enabled_tools}
BASH TIMEOUT: ${bash_timeout} seconds

You may use these commands when helpful for your analysis.
To execute a command, clearly indicate the command you want to run.
Example: "Let me check the git status: \`git status\`"

RESTRICTIONS:
- Only the listed tools are available
- Commands will timeout after ${bash_timeout} seconds
- No file modifications allowed (read-only operations only)
- No piping to dangerous commands
- No shell redirects (>, >>)

Use these tools to gather real data that supports your analysis.
EOF
}

# Log which tools were enabled for this session
log_tool_usage() {
    local tool="$1"
    local enabled_bash_tools="$2"
    local log_file="${HOME}/.claude/council-tool-usage.log"

    # Create log directory if needed
    mkdir -p "$(dirname "$log_file")"

    # Append log entry
    echo "$(date -Iseconds) | AI_TOOL=$tool | BASH_TOOLS=${enabled_bash_tools:-none}" >> "$log_file"
}

# ============================================================================
# PERSONA LOADING (Configurable Personas with Precedence)
# ============================================================================
# Precedence: project > user > default > fallback
#   1. ${CWD}/.claude/council-personas/${tool}.persona.md  (project-local)
#   2. ${HOME}/.claude/council-personas/${tool}.persona.md (user-wide)
#   3. ${CLAUDE_PLUGIN_ROOT}/personas/${tool}.persona.md   (default)
#   4. Generic fallback (hardcoded safety net)
# ============================================================================

# Validate persona file for safety
validate_persona_file() {
    local file="$1"

    # Check file exists and is readable
    if [[ ! -f "$file" ]] || [[ ! -r "$file" ]]; then
        return 1
    fi

    # Check for forbidden flags in persona content
    for flag in "${FORBIDDEN_FLAGS[@]}"; do
        if grep -qF "$flag" "$file" 2>/dev/null; then
            echo "ERROR: Forbidden flag in persona file: $flag" >&2
            return 1
        fi
    done

    # Check file size (max 10KB to prevent abuse)
    local size
    size=$(wc -c < "$file" 2>/dev/null || echo "0")
    if [[ "$size" -gt 10240 ]]; then
        echo "ERROR: Persona file too large (max 10KB): $file" >&2
        return 1
    fi

    return 0
}

# Parse YAML frontmatter from persona file
parse_persona_frontmatter() {
    local file="$1"
    local key="$2"

    # Extract value between --- markers
    sed -n '/^---$/,/^---$/p' "$file" | grep "^${key}:" | sed "s/^${key}:[[:space:]]*//" | sed 's/^"//' | sed 's/"$//'
}

# Parse response_guidelines array from persona file
parse_response_guidelines() {
    local file="$1"

    # Extract lines between response_guidelines: and next top-level key (or ---)
    sed -n '/^---$/,/^---$/p' "$file" | \
        sed -n '/^response_guidelines:/,/^[a-z_]*:/p' | \
        grep '^[[:space:]]*-' | \
        sed 's/^[[:space:]]*-[[:space:]]*/- /' | \
        sed 's/^"//' | sed 's/"$//'
}

# Load persona from file with precedence
# Sets: PERSONA_ROLE, PERSONA_CONTEXT, PERSONA_GUIDELINES, PERSONA_SCOPE
load_persona() {
    local tool="$1"
    local cwd="$2"
    local plugin_root="${CLAUDE_PLUGIN_ROOT:-}"

    # Determine paths with precedence
    local project_persona="${cwd}/.claude/council-personas/${tool}.persona.md"
    local user_persona="${HOME}/.claude/council-personas/${tool}.persona.md"
    local default_persona="${plugin_root}/personas/${tool}.persona.md"

    local persona_file=""
    PERSONA_SCOPE="fallback"

    # Check precedence: project > user > default
    if [[ -f "$project_persona" ]] && validate_persona_file "$project_persona"; then
        persona_file="$project_persona"
        PERSONA_SCOPE="project"
    elif [[ -f "$user_persona" ]] && validate_persona_file "$user_persona"; then
        persona_file="$user_persona"
        PERSONA_SCOPE="user"
    elif [[ -n "$plugin_root" ]] && [[ -f "$default_persona" ]] && validate_persona_file "$default_persona"; then
        persona_file="$default_persona"
        PERSONA_SCOPE="default"
    fi

    if [[ -n "$persona_file" ]]; then
        # Parse persona from file
        local name role context
        name=$(parse_persona_frontmatter "$persona_file" "name")
        role=$(parse_persona_frontmatter "$persona_file" "role")
        context=$(parse_persona_frontmatter "$persona_file" "context")

        PERSONA_NAME="${name:-$tool}"
        PERSONA_ROLE="${role:-AI Assistant}"
        PERSONA_CONTEXT="${context:-You are an AI assistant participating in a multi-AI council consultation.}"
        PERSONA_GUIDELINES=$(parse_response_guidelines "$persona_file")

        return 0
    else
        # Fallback: generic persona (safety net)
        PERSONA_NAME="$tool"
        PERSONA_ROLE="AI Assistant"
        PERSONA_CONTEXT="You are an AI assistant participating in a multi-AI council consultation."
        PERSONA_GUIDELINES="- Provide thoughtful, well-reasoned responses
- Consider multiple perspectives
- Be specific and actionable"
        return 1
    fi
}

# Generate structured prompt based on tool and mode
generate_structured_prompt() {
    local tool="$1"
    local raw_prompt="$2"
    local mode="$3"
    local round="$4"
    local context="$5"
    local cwd="$6"

    # Load persona from file (with precedence logic)
    load_persona "$tool" "$cwd"

    # Build role definition from loaded persona
    ROLE_DEF="You are ${PERSONA_NAME}, a ${PERSONA_ROLE}, participating in a multi-AI council consultation.

CONTEXT: ${PERSONA_CONTEXT}"
    RESPONSE_GUIDELINES="${PERSONA_GUIDELINES}"

    # Mode-specific additions
    case "$mode" in
        quick)
            MODE_CONTEXT="IMPORTANT: This is a QUICK consultation - provide your best immediate recommendation with key reasoning. Focus on clarity and actionable insights."
            ;;
        thorough)
            if [ "$round" -eq 1 ]; then
                MODE_CONTEXT="IMPORTANT: This begins a THOROUGH consultation. Provide your initial analysis comprehensively, anticipating that other tools may challenge or build upon your recommendations."
            else
                MODE_CONTEXT="CONTEXT UPDATE: In previous rounds of this consultation:
${context}

IMPORTANT: This is round ${round} of a thorough consultation. Address the points raised by other council members. Do you maintain your original position, or has your perspective evolved?"
            fi
            ;;
    esac

    # Quality requirements (common to all)
    QUALITY_REQUIREMENTS="QUALITY REQUIREMENTS:
- Think step-by-step before answering
- Be specific and concrete - avoid vague generalizations
- Support recommendations with reasoning or evidence
- Mention alternative approaches and their trade-offs
- Keep your response concise (under 500 words)
- Consider real-world constraints and limitations

OUTPUT FORMAT:
Please structure your response as:
- **Confidence**: [High/Medium/Low] - how confident are you in this recommendation?
- **Main Recommendation**: [1-2 sentences] - your key advice
- **Reasoning**: [Key points] - why you recommend this
- **Unique Insight**: [What others might miss] - your distinctive perspective"

    # Assemble the full structured prompt
    cat << EOF
${ROLE_DEF}

QUESTION: ${raw_prompt}

RESPONSE GUIDELINES:
${RESPONSE_GUIDELINES}

${MODE_CONTEXT}

${QUALITY_REQUIREMENTS}
EOF
}

# ============================================================================
# ARGUMENT PARSING
# ============================================================================
TOOL="$1"
RAW_PROMPT="$2"
CWD="${3:-.}"
TIMEOUT="${4:-120}"
MODE="${5:-quick}"  # quick or thorough
ROUND="${6:-1}"     # Round number for thorough mode
CONTEXT="${7:-}"    # Additional context for cross-examination
ENABLED_BASH_TOOLS="${8:-}"  # Comma-separated list of enabled bash tools
BASH_TIMEOUT="${9:-30}"      # Timeout for bash operations

if [ -z "$TOOL" ] || [ -z "$RAW_PROMPT" ]; then
    echo "Usage: invoke-cli.sh <tool> <prompt> [cwd] [timeout] [mode] [round] [context] [enabled_bash_tools] [bash_timeout]" >&2
    echo "  tool: codex|gemini|opencode|aider|agent" >&2
    echo "  prompt: Question to ask (will be quoted)" >&2
    echo "  cwd: Working directory (default: .)" >&2
    echo "  timeout: Max seconds for AI tool (default: 120)" >&2
    echo "  mode: quick|thorough (default: quick)" >&2
    echo "  round: Round number for thorough mode (default: 1)" >&2
    echo "  context: Additional context for cross-examination" >&2
    echo "  enabled_bash_tools: Comma-separated bash tools to enable (from allowlist)" >&2
    echo "  bash_timeout: Timeout for bash operations (default: 30)" >&2
    exit 1
fi

# Safety check on raw prompt
check_injection "$RAW_PROMPT"

# Validate bash tools against allowlist
if [[ -n "$ENABLED_BASH_TOOLS" ]]; then
    if ! validate_bash_tools "$ENABLED_BASH_TOOLS" "$HOME/.claude/council.local.md"; then
        echo "ERROR: Invalid bash tools requested" >&2
        exit 1
    fi
fi

# Log tool usage for audit
log_tool_usage "$TOOL" "$ENABLED_BASH_TOOLS"

# Generate bash tool context if tools are enabled
BASH_TOOL_CONTEXT=$(generate_bash_tool_context "$ENABLED_BASH_TOOLS" "$BASH_TIMEOUT")

# Generate structured prompt (includes persona loading with CWD for precedence)
PROMPT=$(generate_structured_prompt "$TOOL" "$RAW_PROMPT" "$MODE" "$ROUND" "$CONTEXT" "$CWD")

# Append bash tool context if present
if [[ -n "$BASH_TOOL_CONTEXT" ]]; then
    PROMPT="${PROMPT}

${BASH_TOOL_CONTEXT}"
fi

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
