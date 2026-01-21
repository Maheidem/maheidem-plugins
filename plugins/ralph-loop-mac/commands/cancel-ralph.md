---
description: "Cancel active Ralph Loop(s)"
argument-hint: "[loop_id]"
allowed-tools: ["Bash(bash -c *)", "Read(.claude/ralph-loop-*.local.md)"]
---

# Cancel Ralph

Cancel a Ralph loop. Can cancel a specific loop by ID, or cancel all loops.

## Usage

- `/ralph-loop-mac:cancel-ralph` - Cancel ALL Ralph loops in this project
- `/ralph-loop-mac:cancel-ralph <loop_id>` - Cancel a specific loop by its 8-character ID

## Instructions

### If a loop_id argument is provided ($ARGUMENTS is non-empty):

1. Check if the specific state file exists:
   ```bash
   bash -c "if [ -f '.claude/ralph-loop-$ARGUMENTS.local.md' ]; then echo 'EXISTS'; else echo 'NOT_FOUND'; fi"
   ```

2. **If NOT_FOUND**: Say "No Ralph loop found with ID: $ARGUMENTS"
   - Suggest running `/ralph-loop-mac:list` to see available loops

3. **If EXISTS**:
   - Read `.claude/ralph-loop-$ARGUMENTS.local.md` to get the current iteration number
   - Remove the state file: `bash -c "rm -f '.claude/ralph-loop-$ARGUMENTS.local.md'"`
   - Report: "Cancelled Ralph loop $ARGUMENTS (was at iteration N)"
   - Note: The journal file `.claude/ralph-journal-$ARGUMENTS.md` is preserved for reference

### If no argument provided ($ARGUMENTS is empty):

1. Find all Ralph loop state files:
   ```bash
   bash -c "ls .claude/ralph-loop-*.local.md 2>/dev/null || echo 'NO_LOOPS'"
   ```

2. **If NO_LOOPS**: Say "No active Ralph loops found."

3. **If loops exist**:
   - Read each state file to get loop_id and iteration
   - Remove all state files: `bash -c "rm -f .claude/ralph-loop-*.local.md"`
   - Report the number of loops cancelled and their IDs
   - Example: "Cancelled 2 Ralph loops: abc12345 (iteration 5), def67890 (iteration 3)"

## Examples

**Cancel specific loop:**
```
> /ralph-loop-mac:cancel-ralph abc12345
Cancelled Ralph loop abc12345 (was at iteration 5)
Journal preserved: .claude/ralph-journal-abc12345.md
```

**Cancel all loops:**
```
> /ralph-loop-mac:cancel-ralph
Cancelled 2 Ralph loops:
  - abc12345 (was at iteration 5)
  - def67890 (was at iteration 3)
Journals preserved in .claude/ralph-journal-*.md
```

**No loops found:**
```
> /ralph-loop-mac:cancel-ralph xyz99999
No Ralph loop found with ID: xyz99999
Run /ralph-loop-mac:list to see available loops.
```

## Notes

- Journal files are intentionally NOT deleted - they contain valuable history
- To clean up journals: `rm .claude/ralph-journal-*.md`
- Cancelling a loop owned by another session is allowed (useful for cleanup)
