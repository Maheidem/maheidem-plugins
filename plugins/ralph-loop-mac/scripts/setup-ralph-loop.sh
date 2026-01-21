#!/usr/bin/env bash

# Ralph Loop Setup Script (Mac/Bash version) - v2.0.0
# Creates state file for in-session Ralph loop with session-ownership model
# Supports multiple concurrent loops via unique loop_id

set -e

# Parse arguments
PROMPT_PARTS=()
MAX_ITERATIONS=0
COMPLETION_PROMISE="null"

show_help() {
    cat << 'EOF'
Ralph Loop - Interactive self-referential development loop (v2.0.0)

USAGE:
  /ralph-loop [PROMPT...] [OPTIONS]

ARGUMENTS:
  PROMPT...    Initial prompt to start the loop (can be multiple words without quotes)

OPTIONS:
  --max-iterations <n>           Maximum iterations before auto-stop (default: unlimited)
  --completion-promise '<text>'  Promise phrase (USE QUOTES for multi-word)
  -h, --help                     Show this help message

DESCRIPTION:
  Starts a Ralph loop in your CURRENT session. The stop hook prevents
  exit and feeds your output back as input until completion or iteration limit.

  To signal completion, you must output: <promise>YOUR_PHRASE</promise>

  NEW IN v2.0.0: Session Ownership Model
  - Each loop gets a unique 8-character loop_id
  - Multiple sessions can run different loops simultaneously
  - Loops are claimed by the first session that encounters them
  - Journal files track progress across iterations

  Use this for:
  - Interactive iteration where you want to see progress
  - Tasks requiring self-correction and refinement
  - Learning how Ralph works

EXAMPLES:
  /ralph-loop Build a todo API --completion-promise 'DONE' --max-iterations 20
  /ralph-loop --max-iterations 10 Fix the auth bug
  /ralph-loop Refactor cache layer  (runs forever)
  /ralph-loop --completion-promise 'TASK COMPLETE' Create a REST API

STOPPING:
  Only by reaching --max-iterations or detecting --completion-promise
  No manual stop - Ralph runs infinitely by default!

MONITORING:
  # List all Ralph loops in project:
  /ralph-loop-mac:list

  # View current iteration for a specific loop:
  grep '^iteration:' .claude/ralph-loop-*.local.md

  # View full state:
  head -15 .claude/ralph-loop-*.local.md
EOF
    exit 0
}

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            show_help
            ;;
        --max-iterations)
            shift
            if [[ -z "$1" ]]; then
                echo "Error: --max-iterations requires a number argument" >&2
                echo "" >&2
                echo "   Valid examples:" >&2
                echo "     --max-iterations 10" >&2
                echo "     --max-iterations 50" >&2
                echo "     --max-iterations 0  (unlimited)" >&2
                echo "" >&2
                echo "   You provided: --max-iterations (with no number)" >&2
                exit 1
            fi
            if ! [[ "$1" =~ ^[0-9]+$ ]]; then
                echo "Error: --max-iterations must be a positive integer or 0, got: $1" >&2
                echo "" >&2
                echo "   Valid examples:" >&2
                echo "     --max-iterations 10" >&2
                echo "     --max-iterations 50" >&2
                echo "     --max-iterations 0  (unlimited)" >&2
                echo "" >&2
                echo "   Invalid: decimals (10.5), negative numbers (-5), text" >&2
                exit 1
            fi
            MAX_ITERATIONS="$1"
            shift
            ;;
        --completion-promise)
            shift
            if [[ -z "$1" ]]; then
                echo "Error: --completion-promise requires a text argument" >&2
                echo "" >&2
                echo "   Valid examples:" >&2
                echo "     --completion-promise 'DONE'" >&2
                echo "     --completion-promise 'TASK COMPLETE'" >&2
                echo "     --completion-promise 'All tests passing'" >&2
                echo "" >&2
                echo "   You provided: --completion-promise (with no text)" >&2
                echo "" >&2
                echo "   Note: Multi-word promises must be quoted!" >&2
                exit 1
            fi
            COMPLETION_PROMISE="$1"
            shift
            ;;
        *)
            # Non-option argument - collect as prompt part
            PROMPT_PARTS+=("$1")
            shift
            ;;
    esac
done

# Join all prompt parts with spaces
PROMPT="${PROMPT_PARTS[*]}"

# Validate prompt is non-empty
if [[ -z "${PROMPT// }" ]]; then
    echo "Error: No prompt provided" >&2
    echo "" >&2
    echo "   Ralph needs a task description to work on." >&2
    echo "" >&2
    echo "   Examples:" >&2
    echo "     /ralph-loop Build a REST API for todos" >&2
    echo "     /ralph-loop Fix the auth bug --max-iterations 20" >&2
    echo "     /ralph-loop --completion-promise 'DONE' Refactor code" >&2
    echo "" >&2
    echo "   For all options: /ralph-loop --help" >&2
    exit 1
fi

# Create state file directory
mkdir -p .claude

# Generate unique 8-character loop_id using /dev/urandom
LOOP_ID=$(head -c 4 /dev/urandom | xxd -p)

# Quote completion promise for YAML if it contains special chars or is not null
if [[ -n "$COMPLETION_PROMISE" && "$COMPLETION_PROMISE" != "null" ]]; then
    COMPLETION_PROMISE_YAML="\"$COMPLETION_PROMISE\""
else
    COMPLETION_PROMISE_YAML="null"
fi

# Get UTC timestamp
STARTED_AT=$(date -u +'%Y-%m-%dT%H:%M:%SZ')

# State file with loop_id in filename
STATE_FILE=".claude/ralph-loop-${LOOP_ID}.local.md"
JOURNAL_FILE=".claude/ralph-journal-${LOOP_ID}.md"

# Create state file with YAML frontmatter (session_id left blank for hook to claim)
cat > "$STATE_FILE" << EOF
---
loop_id: "$LOOP_ID"
session_id: ""
active: true
iteration: 1
max_iterations: $MAX_ITERATIONS
completion_promise: $COMPLETION_PROMISE_YAML
started_at: "$STARTED_AT"
---

$PROMPT
EOF

# Create empty journal file with header
cat > "$JOURNAL_FILE" << EOF
# Ralph Loop Journal - $LOOP_ID

Started: $STARTED_AT
Task: $PROMPT

---

## Iteration Log

EOF

# Output setup message
if [[ "$MAX_ITERATIONS" -gt 0 ]]; then
    MAX_ITERATIONS_DISPLAY="$MAX_ITERATIONS"
else
    MAX_ITERATIONS_DISPLAY="unlimited"
fi

if [[ "$COMPLETION_PROMISE" != "null" ]]; then
    COMPLETION_PROMISE_DISPLAY="${COMPLETION_PROMISE//\"/} (ONLY output when TRUE - do not lie!)"
else
    COMPLETION_PROMISE_DISPLAY="none (runs forever)"
fi

cat << EOF
Ralph loop activated in this session!

Loop ID: $LOOP_ID
Iteration: 1
Max iterations: $MAX_ITERATIONS_DISPLAY
Completion promise: $COMPLETION_PROMISE_DISPLAY

State file: $STATE_FILE
Journal file: $JOURNAL_FILE

The stop hook is now active. When you try to exit, the SAME PROMPT will be
fed back to you. You'll see your previous work in files, creating a
self-referential loop where you iteratively improve on the same task.

NEW IN v2.0.0: This loop will be claimed by your session on first iteration.
Other sessions will ignore this loop and vice versa.

To monitor: /ralph-loop-mac:list
To cancel: /ralph-loop-mac:cancel-ralph $LOOP_ID

WARNING: This loop cannot be stopped manually! It will run infinitely
    unless you set --max-iterations or --completion-promise.

EOF

# Output the initial prompt
if [[ -n "${PROMPT// }" ]]; then
    echo ""
    echo "$PROMPT"
fi

# Display completion promise requirements if set
if [[ "$COMPLETION_PROMISE" != "null" ]]; then
    cat << EOF

===============================================================
CRITICAL - Ralph Loop Completion Promise
===============================================================

To complete this loop, output this EXACT text:
  <promise>$COMPLETION_PROMISE</promise>

STRICT REQUIREMENTS (DO NOT VIOLATE):
  Use <promise> XML tags EXACTLY as shown above
  The statement MUST be completely and unequivocally TRUE
  Do NOT output false statements to exit the loop
  Do NOT lie even if you think you should exit

IMPORTANT - Do not circumvent the loop:
  Even if you believe you're stuck, the task is impossible,
  or you've been running too long - you MUST NOT output a
  false promise statement. The loop is designed to continue
  until the promise is GENUINELY TRUE. Trust the process.

  If the loop should stop, the promise statement will become
  true naturally. Do not force it by lying.

JOURNAL: At the end of each iteration, document what you tried
and the result in: $JOURNAL_FILE
===============================================================
EOF
fi
