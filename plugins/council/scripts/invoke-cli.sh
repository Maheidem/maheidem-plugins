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

# Generate structured prompt based on tool and mode
generate_structured_prompt() {
    local tool="$1"
    local raw_prompt="$2"
    local mode="$3"
    local round="$4"
    local context="$5"

    # Base role definitions
    case "$tool" in
        codex)
            ROLE_DEF="You are Codex, a PRACTICAL IMPLEMENTATION EXPERT, participating in a multi-AI council consultation.

CONTEXT: Multiple AI tools are being queried in parallel. Your response will be synthesized with others. Your strength is turning ideas into working solutions."
            RESPONSE_GUIDELINES="- Focus on practical, actionable implementation steps
- Include code examples or patterns where relevant
- Consider scalability, maintainability, and best practices
- Bring your implementation expertise to the discussion"
            ;;

        gemini)
            ROLE_DEF="You are Gemini, a RESEARCH & DOCUMENTATION SPECIALIST, participating in a multi-AI council consultation.

CONTEXT: Multiple AI tools are being queried in parallel. Your response will be synthesized with others. Your strength is deep research and thorough documentation."
            RESPONSE_GUIDELINES="- Provide well-researched, evidence-based recommendations
- Reference documentation, best practices, and standards
- Consider both current state and emerging trends
- Bring your research expertise to the discussion"
            ;;

        opencode)
            ROLE_DEF="You are OpenCode, an ARCHITECTURE & PATTERNS ANALYST, participating in a multi-AI council consultation.

CONTEXT: Multiple AI tools are being queried in parallel. Your response will be synthesized with others. Your strength is system design and architectural patterns."
            RESPONSE_GUIDELINES="- Analyze from an architectural perspective
- Consider design patterns and system structure
- Evaluate trade-offs between different approaches
- Bring your patterns expertise to the discussion"
            ;;

        aider)
            ROLE_DEF="You are Aider, a practical AI focused on implementation details, participating in a multi-AI council consultation.

CONTEXT: This is part of a collaborative analysis where multiple AI tools provide diverse perspectives. Your implementation expertise ensures realistic recommendations."
            RESPONSE_GUIDELINES="- Focus on practical implementation steps
- Consider resource requirements and constraints
- Address deployment and operational concerns
- Provide specific, executable guidance"
            ;;

        agent)
            ROLE_DEF="You are Agent, a USER EXPERIENCE & WORKFLOW ADVOCATE, participating in a multi-AI council consultation.

CONTEXT: Multiple AI tools are being queried in parallel. Your response will be synthesized with others. Your strength is user-centric thinking and workflow optimization."
            RESPONSE_GUIDELINES="- Consider the end-user experience and workflow
- Focus on usability and developer experience
- Address practical day-to-day usage concerns
- Bring your UX expertise to the discussion"
            ;;

        *)
            ROLE_DEF="You are an AI assistant participating in a multi-AI council consultation."
            RESPONSE_GUIDELINES="- Provide thoughtful, well-reasoned responses
- Consider multiple perspectives
- Be specific and actionable"
            ;;
    esac

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

if [ -z "$TOOL" ] || [ -z "$PROMPT" ]; then
    echo "Usage: invoke-cli.sh <tool> <prompt> [cwd] [timeout]" >&2
    echo "  tool: codex|gemini|opencode|aider" >&2
    echo "  prompt: Question to ask (will be quoted)" >&2
    echo "  cwd: Working directory (default: .)" >&2
    echo "  timeout: Max seconds (default: 120)" >&2
    exit 1
fi

# Safety check on raw prompt
check_injection "$RAW_PROMPT"

# Generate structured prompt
PROMPT=$(generate_structured_prompt "$TOOL" "$RAW_PROMPT" "$MODE" "$ROUND" "$CONTEXT")

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
