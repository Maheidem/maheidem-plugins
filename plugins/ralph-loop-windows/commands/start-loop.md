---
description: User-friendly wrapper to start ralph-loop with interactive setup
argument-hint: <task description>
allowed-tools: ["Bash(pwsh*)"]
---

# Start Loop - Interactive Ralph Loop Setup (v2.0.0)

This command helps you start a forced work loop with **properly structured prompts** based on best practices.

---

## CRITICAL: Shell-Safe Task Descriptions

**Before we proceed, the task description MUST be shell-safe.**

When executing the loop, the task gets passed to a shell script. These characters **WILL BREAK** the command:

| Character | Problem |
|-----------|---------|
| `#` | Shell comment |
| `` ` `` | Command substitution |
| `${}` | Variable expansion |
| Unbalanced `"` or `'` | Quote parsing fails |
| Emojis | Unicode issues |
| Newlines | Multi-line breaks |

**RULE:** When constructing the final ralph-loop command, you MUST:
1. Remove all markdown formatting (##, ###, backticks, bold, etc.)
2. Remove all emojis and special Unicode
3. Replace newlines with spaces
4. Escape or remove quotes
5. Keep it to a simple, single-line description

---

## What's New in v2.0.0

- **Multi-Instance Support**: Each loop gets a unique ID
- **Session Ownership**: Sessions claim loops automatically
- **Journal Files**: Track iteration history
- **List Command**: `/ralph-loop-windows:list` shows all loops

---

## Step 1: Analyze Your Task

**Your task:** "$ARGUMENTS"

I will sanitize this into a shell-safe version when executing.

---

## Step 2: Define Success Criteria

**This is the most important step!**

Ralph loops converge when success criteria are:
- **Measurable** (can verify objectively)
- **Specific** (no vague words like "clean", "good", "nice")
- **Testable** (can run a command to check)

### Examples of GOOD criteria:
- "All tests pass"
- "No lint errors"
- "Coverage > 80%"
- "Build succeeds"
- "API responds with 200"

### Examples of BAD criteria:
- "Code is clean" (what is clean?)
- "Feature works" (works how?)
- "Performance improved" (by how much?)

---

**Please provide 2-4 success criteria for your task.**

Format your response like:
```
1. All tests pass
2. No TypeScript errors
3. Build succeeds
```

Or describe in plain English and I'll help structure them.

---

## Step 3: Iteration Limit

After you provide criteria, I'll ask:
- **Do you want a limit?** (recommended: 15-30 iterations)
- **Or unlimited?** (use only with very clear criteria)

---

## What Happens After Setup

Once we confirm settings, I'll create a **structured prompt** following the optimal template:

```
TASK: [Your task]

SUCCESS CRITERIA:
- [Your criterion 1]
- [Your criterion 2]
- [Your criterion 3]

PROCESS:
1. Make the smallest change toward success
2. Run validation (tests, lint, build)
3. Fix any failures before proceeding
4. Repeat until ALL criteria are met

IF BLOCKED (after N iterations without progress):
1. Document what's blocking in a comment
2. List approaches attempted
3. Output <promise>BLOCKED: [reason]</promise>

OUTPUT: <promise>DONE</promise> only when ALL success criteria are met
```

---

## Processing Flow

### When you respond with success criteria:

I will:
1. Parse your criteria into a structured list
2. Ask if you want an iteration limit or unlimited
3. Show the full review with the structured prompt
4. Wait for final confirmation

### When you confirm 'yes':

I will:
1. **Sanitize** the task description (remove special chars, emojis, markdown)
2. **Build** the structured prompt with your criteria
3. **Execute** using the PowerShell setup script:

```bash
pwsh -NoProfile -File "${CLAUDE_PLUGIN_ROOT}/scripts/setup-ralph-loop.ps1" "TASK: [sanitized task]. SUCCESS CRITERIA: [criteria]. PROCESS: 1. Make smallest change 2. Validate 3. Fix failures 4. Repeat. IF BLOCKED: output BLOCKED. OUTPUT: DONE when complete" --max-iterations {limit} --completion-promise "DONE"
```

**Note:** The full structured template is condensed to a single line for shell safety.

### When you say 'no' or 'cancel':

Setup will be cancelled with no action taken.

---

## Quick Reference

| Task Type | Suggested Criteria | Suggested Iterations |
|-----------|-------------------|---------------------|
| Bug fix | Tests pass, no errors | 10-15 |
| New feature | Tests pass, feature works per spec | 20-30 |
| Refactor | Tests pass, lint clean, no regressions | 15-25 |
| Migration | All files migrated, tests pass | 25-50 |
| Test coverage | Coverage > X%, all tests pass | 15-25 |

---

## Important Notes

**About the Loop:**
- Claude sees previous work through modified files and git history
- Each iteration builds on the last
- The loop continues until `<promise>DONE</promise>` is output
- `<promise>BLOCKED</promise>` provides a safe exit when stuck

**Session Ownership (v2.0.0):**
- Each loop gets a unique 8-character ID
- The session that first tries to exit claims the loop
- Other sessions won't be blocked by your loop
- Use `/ralph-loop-windows:list` to see all loops

**Journal Files:**
- Each loop has a journal at `.claude/ralph-journal-{loop_id}.md`
- Tracks iteration timestamps
- Preserved when loop completes

**Cost Awareness:**
- Start conservative (15-20 iterations)
- Monitor API costs for large tasks
- Use `/ralph-loop-windows:cancel-ralph` to stop early if needed

---

**Ready! Please provide your success criteria for:**

"$ARGUMENTS"
