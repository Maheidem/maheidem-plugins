---
description: "Cancel active Ralph Loop"
allowed-tools: ["Bash(bash -c *)", "Read(.claude/ralph-loop.local.md)"]
---

# Cancel Ralph

To cancel the Ralph loop:

1. Check if `.claude/ralph-loop.local.md` exists using Bash: `bash -c "if [ -f '.claude/ralph-loop.local.md' ]; then echo 'EXISTS'; else echo 'NOT_FOUND'; fi"`

2. **If NOT_FOUND**: Say "No active Ralph loop found."

3. **If EXISTS**:
   - Read `.claude/ralph-loop.local.md` to get the current iteration number from the `iteration:` field
   - Remove the file using Bash: `bash -c "rm -f '.claude/ralph-loop.local.md'"`
   - Report: "Cancelled Ralph loop (was at iteration N)" where N is the iteration value
