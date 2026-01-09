---
description: "Cancel active Ralph Loop"
allowed-tools: ["Bash(pwsh -NoProfile -Command *)", "Read(.claude/ralph-loop.local.md)"]
---

# Cancel Ralph

To cancel the Ralph loop:

1. Check if `.claude/ralph-loop.local.md` exists using Bash: `pwsh -NoProfile -Command "if (Test-Path '.claude/ralph-loop.local.md') { 'EXISTS' } else { 'NOT_FOUND' }"`

2. **If NOT_FOUND**: Say "No active Ralph loop found."

3. **If EXISTS**:
   - Read `.claude/ralph-loop.local.md` to get the current iteration number from the `iteration:` field
   - Remove the file using Bash: `pwsh -NoProfile -Command "Remove-Item '.claude/ralph-loop.local.md' -Force"`
   - Report: "Cancelled Ralph loop (was at iteration N)" where N is the iteration value
