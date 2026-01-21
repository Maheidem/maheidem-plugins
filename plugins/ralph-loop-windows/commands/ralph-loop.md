---
description: "Start Ralph Loop in current session"
argument-hint: "PROMPT [--max-iterations N] [--completion-promise TEXT]"
allowed-tools: ["Bash(pwsh -NoProfile -File *)"]
---

# Ralph Loop Command (v2.0.0)

Execute the setup script to initialize the Ralph loop:

```!
pwsh -NoProfile -File "${CLAUDE_PLUGIN_ROOT}/scripts/setup-ralph-loop.ps1" $ARGUMENTS
```

Please work on the task. When you try to exit, the Ralph loop will feed the SAME PROMPT back to you for the next iteration. You'll see your previous work in files and git history, allowing you to iterate and improve.

## Session Ownership (v2.0.0)

This loop will be assigned a unique ID and stored at `.claude/ralph-loop-{loop_id}.local.md`.
A journal file will track iterations at `.claude/ralph-journal-{loop_id}.md`.

The first session to try to exit will claim ownership of this loop. Only the owning session's stop hook will block exit - other sessions can exit freely.

## Important Rules

CRITICAL RULE: If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE. Do not output false promises to escape the loop, even if you think you're stuck or should exit for other reasons. The loop is designed to continue until genuine completion.

JOURNAL RULE: At the start of each iteration after the first:
1. Read the journal file to see what was tried in previous iterations
2. At the end of your work, consider what you accomplished for the next iteration

## Monitoring Commands

- List all loops: `/ralph-loop-windows:list`
- Cancel this loop: `/ralph-loop-windows:cancel-ralph <loop_id>`
