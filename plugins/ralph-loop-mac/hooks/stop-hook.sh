#!/usr/bin/env bash

# Ralph Wiggum Stop Hook (Mac/Bash version) - v2.1.0
# Session-ownership model: Claims unclaimed loops, handles only owned loops
# Prevents session exit when an owned ralph-loop is active
# Feeds Claude's output back as input to continue the loop
# NEW: Stuck detection - warns when no file changes between iterations

set -e

# Read hook input from stdin (advanced stop hook API)
HOOK_INPUT=$(cat)

# Get MY_SESSION from hook input using jq
if ! command -v jq &> /dev/null; then
    echo "Ralph loop: jq is required but not installed" >&2
    echo "   Install with: brew install jq" >&2
    exit 0
fi

MY_SESSION=$(echo "$HOOK_INPUT" | jq -r '.session_id // empty')

if [[ -z "$MY_SESSION" ]]; then
    # Fallback: try to extract from transcript path if session_id not in hook input
    TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // empty')
    if [[ -n "$TRANSCRIPT_PATH" ]]; then
        # Extract session ID from transcript path (format varies)
        # Try to use the transcript filename as a unique identifier
        MY_SESSION=$(basename "$TRANSCRIPT_PATH" .jsonl 2>/dev/null || echo "unknown-$$")
    else
        MY_SESSION="unknown-$$"
    fi
fi

# Scan all ralph-loop state files
RALPH_STATE_PATTERN='.claude/ralph-loop-*.local.md'
STATE_FILES=($(ls $RALPH_STATE_PATTERN 2>/dev/null || true))

if [[ ${#STATE_FILES[@]} -eq 0 ]]; then
    # No active loops - allow exit
    exit 0
fi

# Find a loop that belongs to us or is unclaimed
MY_LOOP_FILE=""
MY_LOOP_ID=""

for STATE_FILE in "${STATE_FILES[@]}"; do
    if [[ ! -f "$STATE_FILE" ]]; then
        continue
    fi

    # Read state file
    STATE_CONTENT=$(cat "$STATE_FILE")

    # Parse markdown frontmatter (YAML between ---)
    if ! echo "$STATE_CONTENT" | grep -q '^---'; then
        echo "Ralph loop: State file has invalid format: $STATE_FILE" >&2
        rm -f "$STATE_FILE"
        continue
    fi

    # Extract frontmatter (lines between first and second ---)
    FRONTMATTER=$(echo "$STATE_CONTENT" | sed -n '/^---$/,/^---$/p' | sed '1d;$d')

    if [[ -z "$FRONTMATTER" ]]; then
        echo "Ralph loop: State file has invalid format: $STATE_FILE" >&2
        rm -f "$STATE_FILE"
        continue
    fi

    # Parse YAML values from frontmatter
    LOOP_ID=""
    SESSION_ID=""
    ACTIVE=""

    while IFS= read -r line; do
        if [[ "$line" =~ ^loop_id:[[:space:]]*\"?([^\"]*)\"? ]]; then
            LOOP_ID="${BASH_REMATCH[1]}"
        elif [[ "$line" =~ ^session_id:[[:space:]]*\"?([^\"]*)\"? ]]; then
            SESSION_ID="${BASH_REMATCH[1]}"
        elif [[ "$line" =~ ^active:[[:space:]]*(true|false) ]]; then
            ACTIVE="${BASH_REMATCH[1]}"
        fi
    done <<< "$FRONTMATTER"

    # Skip inactive loops
    if [[ "$ACTIVE" != "true" ]]; then
        continue
    fi

    # Check ownership
    if [[ -z "$SESSION_ID" ]]; then
        # UNCLAIMED loop - claim it!
        echo "Ralph loop: Claiming unclaimed loop $LOOP_ID" >&2

        # Update state file with our session_id
        UPDATED_CONTENT=$(echo "$STATE_CONTENT" | sed "s/session_id:[[:space:]]*\"*\"*/session_id: \"$MY_SESSION\"/")
        echo -n "$UPDATED_CONTENT" > "$STATE_FILE"

        MY_LOOP_FILE="$STATE_FILE"
        MY_LOOP_ID="$LOOP_ID"
        break
    elif [[ "$SESSION_ID" == "$MY_SESSION" ]]; then
        # This is MY loop
        MY_LOOP_FILE="$STATE_FILE"
        MY_LOOP_ID="$LOOP_ID"
        break
    fi
    # else: belongs to another session, skip
done

if [[ -z "$MY_LOOP_FILE" ]]; then
    # No loop belongs to us - allow exit
    exit 0
fi

# Now handle our loop
STATE_CONTENT=$(cat "$MY_LOOP_FILE")
FRONTMATTER=$(echo "$STATE_CONTENT" | sed -n '/^---$/,/^---$/p' | sed '1d;$d')

# Parse all YAML values
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
        if [[ "$COMPLETION_PROMISE" == "null" ]]; then
            COMPLETION_PROMISE="null"
        fi
    fi
done <<< "$FRONTMATTER"

# Validate numeric fields
if [[ "$ITERATION" -eq 0 ]] && ! echo "$STATE_CONTENT" | grep -q 'iteration:[[:space:]]*0'; then
    echo "Ralph loop: State file corrupted ($MY_LOOP_ID)" >&2
    echo "   File: $MY_LOOP_FILE" >&2
    echo "   Problem: 'iteration' field is not a valid number" >&2
    echo "" >&2
    echo "   This usually means the state file was manually edited or corrupted." >&2
    echo "   Ralph loop is stopping. Run /ralph-loop again to start fresh." >&2
    rm -f "$MY_LOOP_FILE"
    exit 0
fi

# Check if max iterations reached
if [[ "$MAX_ITERATIONS" -gt 0 && "$ITERATION" -ge "$MAX_ITERATIONS" ]]; then
    echo "Ralph loop ($MY_LOOP_ID): Max iterations ($MAX_ITERATIONS) reached."
    rm -f "$MY_LOOP_FILE"
    exit 0
fi

# Get transcript path from hook input
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // empty')

if [[ -z "$TRANSCRIPT_PATH" ]]; then
    echo "Ralph loop: Failed to parse hook input JSON" >&2
    rm -f "$MY_LOOP_FILE"
    exit 0
fi

if [[ ! -f "$TRANSCRIPT_PATH" ]]; then
    echo "Ralph loop: Transcript file not found" >&2
    echo "   Expected: $TRANSCRIPT_PATH" >&2
    echo "   This is unusual and may indicate a Claude Code internal issue." >&2
    echo "   Ralph loop is stopping." >&2
    rm -f "$MY_LOOP_FILE"
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
    rm -f "$MY_LOOP_FILE"
    exit 0
fi

# Get last assistant message with text
LAST_LINE=$(echo "$ASSISTANT_WITH_TEXT" | tail -n 1)

if [[ -z "$LAST_LINE" ]]; then
    echo "Ralph loop: Failed to extract last assistant message" >&2
    echo "   Ralph loop is stopping." >&2
    rm -f "$MY_LOOP_FILE"
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
    rm -f "$MY_LOOP_FILE"
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
            echo "Ralph loop ($MY_LOOP_ID): Detected <promise>$COMPLETION_PROMISE</promise>"
            rm -f "$MY_LOOP_FILE"
            exit 0
        fi
    fi
fi

# === STUCK DETECTION ===
# Compute current state hash (what files changed since last commit)
CURRENT_HASH=$(git diff --stat 2>/dev/null | md5 || echo "no-git")

# Read previous hash and stuck count from state file
LAST_HASH=$(echo "$FRONTMATTER" | grep '^last_file_hash:' | sed 's/last_file_hash:[[:space:]]*//' | tr -d '"')
STUCK_COUNT=$(echo "$FRONTMATTER" | grep '^stuck_count:' | awk '{print $2}')
STUCK_COUNT=${STUCK_COUNT:-0}

# Compare hashes to detect stuck state
if [[ -n "$LAST_HASH" && "$CURRENT_HASH" == "$LAST_HASH" ]]; then
    STUCK_COUNT=$((STUCK_COUNT + 1))
else
    STUCK_COUNT=0  # Progress made, reset counter
fi

# Update state file with new stuck detection values
STATE_CONTENT=$(echo "$STATE_CONTENT" | sed "s/stuck_count:[[:space:]]*[0-9]*/stuck_count: $STUCK_COUNT/")
STATE_CONTENT=$(echo "$STATE_CONTENT" | sed "s/last_file_hash:[[:space:]]*\"[^\"]*\"/last_file_hash: \"$CURRENT_HASH\"/")

# Build stuck warning if threshold reached (2+ iterations with no changes)
STUCK_WARNING=""
if [[ $STUCK_COUNT -ge 2 ]]; then
    STUCK_WARNING=" | STUCK: No file changes for $STUCK_COUNT iterations - try a DIFFERENT approach!"
fi

# Not complete - continue loop with SAME PROMPT
NEXT_ITERATION=$((ITERATION + 1))

# Extract prompt (everything after the closing ---) - BSD sed compatible
PROMPT_TEXT=$(echo "$STATE_CONTENT" | awk '/^---$/{n++; next} n>=2{print}')

if [[ -z "${PROMPT_TEXT// }" ]]; then
    echo "Ralph loop: State file corrupted or incomplete ($MY_LOOP_ID)" >&2
    echo "   File: $MY_LOOP_FILE" >&2
    echo "   Problem: No prompt text found" >&2
    echo "" >&2
    echo "   This usually means:" >&2
    echo "     - State file was manually edited" >&2
    echo "     - File was corrupted during writing" >&2
    echo "" >&2
    echo "   Ralph loop is stopping. Run /ralph-loop again to start fresh." >&2
    rm -f "$MY_LOOP_FILE"
    exit 0
fi

# Trim leading/trailing whitespace from prompt
PROMPT_TEXT=$(echo "$PROMPT_TEXT" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

if [[ -z "$PROMPT_TEXT" ]]; then
    echo "Ralph loop: No prompt text found in state file" >&2
    rm -f "$MY_LOOP_FILE"
    exit 0
fi

# Update iteration in state file (STATE_CONTENT already has stuck_count and last_file_hash updated)
STATE_CONTENT=$(echo "$STATE_CONTENT" | sed "s/iteration:[[:space:]]*[0-9]*/iteration: $NEXT_ITERATION/")
echo -n "$STATE_CONTENT" > "$MY_LOOP_FILE"

# Append to journal file
JOURNAL_FILE=".claude/ralph-journal-${MY_LOOP_ID}.md"
TIMESTAMP=$(date -u +'%Y-%m-%dT%H:%M:%SZ')

if [[ -f "$JOURNAL_FILE" ]]; then
    cat >> "$JOURNAL_FILE" << EOF

### Iteration $ITERATION - $TIMESTAMP

**Status:** Continuing to iteration $NEXT_ITERATION

---

EOF
fi

# Build system message with iteration count, journal reference, completion promise info, and stuck warning
JOURNAL_INSTRUCTION="JOURNAL: Read .claude/ralph-journal-${MY_LOOP_ID}.md at start. At end of iteration, append what you tried and the result."

if [[ "$COMPLETION_PROMISE" != "null" && -n "$COMPLETION_PROMISE" ]]; then
    SYSTEM_MSG="Ralph iteration $NEXT_ITERATION (loop $MY_LOOP_ID) | To stop: output <promise>$COMPLETION_PROMISE</promise> (ONLY when statement is TRUE - do not lie to exit!) | $JOURNAL_INSTRUCTION$STUCK_WARNING"
else
    SYSTEM_MSG="Ralph iteration $NEXT_ITERATION (loop $MY_LOOP_ID) | No completion promise set - loop runs infinitely | $JOURNAL_INSTRUCTION$STUCK_WARNING"
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
