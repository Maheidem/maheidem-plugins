---
description: "List all Ralph loops in this project"
allowed-tools: ["Bash(bash -c *)", "Read(.claude/ralph-loop-*.local.md)"]
---

# List Ralph Loops

Display all Ralph loops in this project with their status.

## Instructions

1. First, run this command to find all Ralph loop state files:

```!
bash -c "ls -la .claude/ralph-loop-*.local.md 2>/dev/null || echo 'NO_LOOPS_FOUND'"
```

2. **If NO_LOOPS_FOUND**: Report "No active Ralph loops in this project."

3. **If files exist**: For each file found, read it and extract:
   - `loop_id` - The unique identifier
   - `session_id` - Which session owns it (empty = unclaimed/orphaned)
   - `iteration` - Current iteration number
   - `max_iterations` - Limit (0 = unlimited)
   - `completion_promise` - The phrase to complete
   - `started_at` - When started

4. Then display in a formatted table:

```
RALPH LOOPS IN PROJECT
======================

Loop ID   | Status    | Iteration | Max  | Session Owner          | Started
----------|-----------|-----------|------|------------------------|--------------------
abc12345  | ACTIVE    | 5         | 20   | transcript-xyz.jsonl   | 2026-01-21T12:00:00Z
def67890  | ORPHANED  | 3         | 10   | (unclaimed)            | 2026-01-21T11:30:00Z

Status Legend:
  ACTIVE   - Loop has an owning session
  ORPHANED - No session owns this loop (will be claimed by next session that runs)
```

5. Additionally, show if any loops appear to be MINE (matching current session) - though this is harder to determine without the hook context.

## Status Determination

- **ACTIVE**: `session_id` is non-empty
- **ORPHANED**: `session_id` is empty (unclaimed)

## Example Output

```
RALPH LOOPS IN PROJECT
======================

Found 2 loops:

1. Loop: abc12345
   Status: ACTIVE (owned by session)
   Iteration: 5 of 20
   Promise: "DONE"
   Started: 2026-01-21T12:00:00Z
   State file: .claude/ralph-loop-abc12345.local.md
   Journal: .claude/ralph-journal-abc12345.md

2. Loop: def67890
   Status: ORPHANED (unclaimed - will be picked up by next session)
   Iteration: 3 of 10
   Promise: "TASK COMPLETE"
   Started: 2026-01-21T11:30:00Z
   State file: .claude/ralph-loop-def67890.local.md
   Journal: .claude/ralph-journal-def67890.md

Commands:
  /ralph-loop-mac:cancel-ralph abc12345  - Cancel specific loop
  /ralph-loop-mac:cancel-ralph           - Cancel loop owned by current session
```
