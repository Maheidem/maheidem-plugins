#!/usr/bin/env bash

# Ralph Wiggum Stop Hook (Mac/Bash version)
# Prevents session exit when a ralph-loop is active
# Feeds Claude's output back as input to continue the loop

set -e

# Read hook input from stdin (advanced stop hook API)
HOOK_INPUT=$(cat)

# Check if ralph-loop is active
RALPH_STATE_FILE='.claude/ralph-loop.local.md'

if [[ ! -f "$RALPH_STATE_FILE" ]]; then
    # No active loop - allow exit
    exit 0
fi

# Read state file
STATE_CONTENT=$(cat "$RALPH_STATE_FILE")

# Parse markdown frontmatter (YAML between ---)
# Extract content between first and second ---
if ! echo "$STATE_CONTENT" | grep -q '^---'; then
    echo "Ralph loop: State file has invalid format" >&2
    rm -f "$RALPH_STATE_FILE"
    exit 0
fi

# Extract frontmatter (lines between first and second ---)
FRONTMATTER=$(echo "$STATE_CONTENT" | sed -n '/^---$/,/^---$/p' | sed '1d;$d')

if [[ -z "$FRONTMATTER" ]]; then
    echo "Ralph loop: State file has invalid format" >&2
    rm -f "$RALPH_STATE_FILE"
    exit 0
fi

# Parse YAML values from frontmatter
ITERATION=0
MAX_ITERATIONS=0
COMPLETION_PROMISE="null"

while IFS= read -r line; do
    if [[ "$line" =~ ^iteration:[[:space:]]*([0-9]+) ]]; then
        ITERATION="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^max_iterations:[[:space:]]*([0-9]+) ]]; then
        MAX_ITERATIONS="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^completion_promise:[[:space:]]*\"?([^\"]*)\"? ]]; then
        COMPLETION_PROMISE="${BASH_REMATCH[1]}"
        # Handle null value
        if [[ "$COMPLETION_PROMISE" == "null" ]]; then
            COMPLETION_PROMISE="null"
        fi
    fi
done <<< "$FRONTMATTER"

# Validate numeric fields
if [[ "$ITERATION" -eq 0 ]] && ! echo "$STATE_CONTENT" | grep -q 'iteration:[[:space:]]*0'; then
    echo "Ralph loop: State file corrupted" >&2
    echo "   File: $RALPH_STATE_FILE" >&2
    echo "   Problem: 'iteration' field is not a valid number" >&2
    echo "" >&2
    echo "   This usually means the state file was manually edited or corrupted." >&2
    echo "   Ralph loop is stopping. Run /ralph-loop again to start fresh." >&2
    rm -f "$RALPH_STATE_FILE"
    exit 0
fi

# Check if max iterations reached
if [[ "$MAX_ITERATIONS" -gt 0 && "$ITERATION" -ge "$MAX_ITERATIONS" ]]; then
    echo "Ralph loop: Max iterations ($MAX_ITERATIONS) reached."
    rm -f "$RALPH_STATE_FILE"
    exit 0
fi

# Get transcript path from hook input using jq
if ! command -v jq &> /dev/null; then
    echo "Ralph loop: jq is required but not installed" >&2
    echo "   Install with: brew install jq" >&2
    rm -f "$RALPH_STATE_FILE"
    exit 0
fi

TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // empty')

if [[ -z "$TRANSCRIPT_PATH" ]]; then
    echo "Ralph loop: Failed to parse hook input JSON" >&2
    rm -f "$RALPH_STATE_FILE"
    exit 0
fi

if [[ ! -f "$TRANSCRIPT_PATH" ]]; then
    echo "Ralph loop: Transcript file not found" >&2
    echo "   Expected: $TRANSCRIPT_PATH" >&2
    echo "   This is unusual and may indicate a Claude Code internal issue." >&2
    echo "   Ralph loop is stopping." >&2
    rm -f "$RALPH_STATE_FILE"
    exit 0
fi

# Read transcript (JSONL format - one JSON per line)
# Find assistant messages that contain text content (not just tool_use or thinking)
ASSISTANT_WITH_TEXT=$(grep '"role"[[:space:]]*:[[:space:]]*"assistant"' "$TRANSCRIPT_PATH" | grep '"type":"text"' || true)

if [[ -z "$ASSISTANT_WITH_TEXT" ]]; then
    echo "Ralph loop: No assistant messages with text content found in transcript" >&2
    echo "   Transcript: $TRANSCRIPT_PATH" >&2
    echo "   This may happen if the last response was only tool calls" >&2
    echo "   Ralph loop is stopping." >&2
    rm -f "$RALPH_STATE_FILE"
    exit 0
fi

# Get last assistant message with text
LAST_LINE=$(echo "$ASSISTANT_WITH_TEXT" | tail -n 1)

if [[ -z "$LAST_LINE" ]]; then
    echo "Ralph loop: Failed to extract last assistant message" >&2
    echo "   Ralph loop is stopping." >&2
    rm -f "$RALPH_STATE_FILE"
    exit 0
fi

# Parse JSON and extract text content
# The transcript may contain unescaped control characters in tool_use blocks
# Use tr to remove problematic chars, or fall back to regex extraction
LAST_OUTPUT=$(echo "$LAST_LINE" | tr -d '\000-\011\013-\037' | jq -r '
    .message.content[]? |
    select(.type == "text") |
    .text
' 2>/dev/null | tr '\n' ' ')

# Fallback: If jq fails, try regex extraction for text blocks
if [[ -z "${LAST_OUTPUT// }" ]]; then
    # Extract text from {"type":"text","text":"..."} patterns
    LAST_OUTPUT=$(echo "$LAST_LINE" | grep -oE '"type"[[:space:]]*:[[:space:]]*"text"[^}]*"text"[[:space:]]*:[[:space:]]*"[^"]*"' | \
        sed 's/.*"text"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' | tr '\n' ' ' || true)
fi

if [[ -z "${LAST_OUTPUT// }" ]]; then
    echo "Ralph loop: Assistant message contained no text content" >&2
    echo "   Ralph loop is stopping." >&2
    rm -f "$RALPH_STATE_FILE"
    exit 0
fi

# Check for completion promise (only if set)
if [[ "$COMPLETION_PROMISE" != "null" && -n "$COMPLETION_PROMISE" ]]; then
    # Extract text from <promise> tags using grep and sed
    # Look for <promise>...</promise> pattern
    if echo "$LAST_OUTPUT" | grep -q '<promise>'; then
        PROMISE_TEXT=$(echo "$LAST_OUTPUT" | sed -n 's/.*<promise>\([^<]*\)<\/promise>.*/\1/p' | head -n1)
        # Normalize whitespace for comparison
        PROMISE_TEXT=$(echo "$PROMISE_TEXT" | tr -s '[:space:]' ' ' | sed 's/^ *//;s/ *$//')

        # Literal string comparison
        if [[ "$PROMISE_TEXT" == "$COMPLETION_PROMISE" ]]; then
            echo "Ralph loop: Detected <promise>$COMPLETION_PROMISE</promise>"
            rm -f "$RALPH_STATE_FILE"
            exit 0
        fi
    fi
fi

# Not complete - continue loop with SAME PROMPT
NEXT_ITERATION=$((ITERATION + 1))

# Extract prompt (everything after the closing ---) - BSD sed compatible
PROMPT_TEXT=$(echo "$STATE_CONTENT" | awk '/^---$/{n++; next} n>=2{print}')

if [[ -z "${PROMPT_TEXT// }" ]]; then
    echo "Ralph loop: State file corrupted or incomplete" >&2
    echo "   File: $RALPH_STATE_FILE" >&2
    echo "   Problem: No prompt text found" >&2
    echo "" >&2
    echo "   This usually means:" >&2
    echo "     - State file was manually edited" >&2
    echo "     - File was corrupted during writing" >&2
    echo "" >&2
    echo "   Ralph loop is stopping. Run /ralph-loop again to start fresh." >&2
    rm -f "$RALPH_STATE_FILE"
    exit 0
fi

# Trim leading/trailing whitespace from prompt
PROMPT_TEXT=$(echo "$PROMPT_TEXT" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

if [[ -z "$PROMPT_TEXT" ]]; then
    echo "Ralph loop: No prompt text found in state file" >&2
    rm -f "$RALPH_STATE_FILE"
    exit 0
fi

# Update iteration in state file
UPDATED_CONTENT=$(echo "$STATE_CONTENT" | sed "s/iteration:[[:space:]]*[0-9]*/iteration: $NEXT_ITERATION/")
echo -n "$UPDATED_CONTENT" > "$RALPH_STATE_FILE"

# Build system message with iteration count and completion promise info
if [[ "$COMPLETION_PROMISE" != "null" && -n "$COMPLETION_PROMISE" ]]; then
    SYSTEM_MSG="Ralph iteration $NEXT_ITERATION | To stop: output <promise>$COMPLETION_PROMISE</promise> (ONLY when statement is TRUE - do not lie to exit!)"
else
    SYSTEM_MSG="Ralph iteration $NEXT_ITERATION | No completion promise set - loop runs infinitely"
fi

# Output JSON to block the stop and feed prompt back
# Use jq to properly escape the JSON strings
jq -n -c \
    --arg decision "block" \
    --arg reason "$PROMPT_TEXT" \
    --arg systemMessage "$SYSTEM_MSG" \
    '{decision: $decision, reason: $reason, systemMessage: $systemMessage}'

# Exit 0 for successful hook execution
exit 0
