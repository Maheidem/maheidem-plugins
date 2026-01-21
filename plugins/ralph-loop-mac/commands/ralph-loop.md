---
description: "Start Ralph Loop in current session (v2.0.0)"
argument-hint: "PROMPT [--max-iterations N] [--completion-promise TEXT]"
allowed-tools: ["Bash(bash *)"]
---

# Ralph Loop Command (v2.0.0)

Execute the setup script to initialize the Ralph loop:

```!
bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup-ralph-loop.sh" $ARGUMENTS
```

Please work on the task. When you try to exit, the Ralph loop will feed the SAME PROMPT back to you for the next iteration. You'll see your previous work in files and git history, allowing you to iterate and improve.

**v2.0.0 Features:**
- Each loop gets a unique loop_id
- State file: `.claude/ralph-loop-{loop_id}.local.md`
- Journal file: `.claude/ralph-journal-{loop_id}.md`
- Your session will claim this loop on first exit attempt
- Other sessions will ignore this loop

**JOURNAL INSTRUCTIONS:**
At the START of each iteration, read the journal file to see what was tried before.
At the END of each iteration, append what you tried and the result to the journal file.

CRITICAL RULE: If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE. Do not output false promises to escape the loop, even if you think you're stuck or should exit for other reasons. The loop is designed to continue until genuine completion.
