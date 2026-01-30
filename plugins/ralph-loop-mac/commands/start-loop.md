---
description: User-friendly wrapper to start ralph-loop with interactive setup
argument-hint: <task description>
allowed-tools: ["Bash(bash*)"]
---

# Start Loop - Interactive Ralph Loop Setup

This command helps you start a forced work loop with **properly structured prompts** based on best practices.

---

## Your Task

**"$ARGUMENTS"**

---

## Step 1: Success Criteria

Ralph loops work best with **measurable, testable** criteria.

**Good examples:** "All tests pass", "No lint errors", "Build succeeds", "API responds 200"

**Bad examples:** "Code is clean", "Feature works", "Performance improved"

**Please provide 2-4 success criteria.**

---

## Step 2: Iteration Limit

After criteria, I'll ask:
- **Recommended:** 15-30 iterations
- **Unlimited:** Only with very clear criteria

---

## Step 3: Confirmation & Execution

Once you confirm, I will build a structured prompt and execute:

```
TASK: [Your task]
SUCCESS CRITERIA: [Your criteria]
PROCESS: 1. Make smallest change 2. Validate 3. Fix failures 4. Repeat
OUTPUT: <promise>DONE</promise> when ALL criteria met
```

---

## MANDATORY EXECUTION RULE

**CLAUDE: You MUST execute this command after user confirms.**

When user says "yes", "confirm", "go", "start", or similar:

1. Sanitize task (remove special chars: # ` $ { } emojis, escape quotes)
2. Build single-line prompt with criteria
3. **IMMEDIATELY EXECUTE using Bash tool:**

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/setup-ralph-loop.sh" "TASK: [sanitized]. SUCCESS: [criteria]. PROCESS: smallest change, validate, fix, repeat. OUTPUT: DONE when complete" --max-iterations [N] --completion-promise "DONE"
```

**DO NOT just show the command. You MUST use the Bash tool to execute it.**

**If you do not execute the bash command, the loop will NOT work.**

---

## Quick Reference

| Task Type | Suggested Iterations |
|-----------|---------------------|
| Bug fix | 10-15 |
| New feature | 20-30 |
| Refactor | 15-25 |
| Migration | 25-50 |

---

## Cancel

Say "cancel" or "no" to abort setup.

---

**Ready! What are your success criteria for:** "$ARGUMENTS"
