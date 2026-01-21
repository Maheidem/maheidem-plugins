---
description: "Explain Ralph Loop plugin and available commands"
---

# Ralph Loop Plugin Help (v2.0.0)

Please explain the following to the user:

## What is Ralph Loop?

Ralph Loop implements the Ralph Wiggum technique - an iterative development methodology based on continuous AI loops, pioneered by Geoffrey Huntley.

**Core concept:**
```bash
while :; do
  cat PROMPT.md | claude-code --continue
done
```

The same prompt is fed to Claude repeatedly. The "self-referential" aspect comes from Claude seeing its own previous work in the files and git history, not from feeding output back as input.

**Each iteration:**
1. Claude receives the SAME prompt
2. Works on the task, modifying files
3. Tries to exit
4. Stop hook intercepts and feeds the same prompt again
5. Claude sees its previous work in the files
6. Iteratively improves until completion

The technique is described as "deterministically bad in an undeterministic world" - failures are predictable, enabling systematic improvement through prompt tuning.

## What's New in v2.0.0

**Session Ownership Model** - Multiple Claude sessions can now run different Ralph loops simultaneously:

- Each loop gets a unique 8-character `loop_id`
- State files: `.claude/ralph-loop-{loop_id}.local.md`
- Journal files: `.claude/ralph-journal-{loop_id}.md` track progress
- Sessions "claim" unclaimed loops on first iteration
- Sessions ignore loops owned by other sessions

## Available Commands

### /ralph-loop-mac:ralph-loop <PROMPT> [OPTIONS]

Start a Ralph loop in your current session.

**Usage:**
```
/ralph-loop-mac:ralph-loop "Refactor the cache layer" --max-iterations 20
/ralph-loop-mac:ralph-loop "Add tests" --completion-promise "TESTS COMPLETE"
```

**Options:**
- `--max-iterations <n>` - Max iterations before auto-stop
- `--completion-promise <text>` - Promise phrase to signal completion

**How it works:**
1. Creates `.claude/ralph-loop-{loop_id}.local.md` state file
2. Creates `.claude/ralph-journal-{loop_id}.md` journal file
3. You work on the task
4. When you try to exit, stop hook intercepts
5. Hook claims the loop (fills in session_id)
6. Same prompt fed back
7. You see your previous work
8. Continues until promise detected or max iterations

---

### /ralph-loop-mac:start-loop <TASK>

Interactive wizard for setting up Ralph loops with best-practice prompts.

**Usage:**
```
/ralph-loop-mac:start-loop "Build a REST API for todos"
```

This guides you through:
- Defining measurable success criteria
- Setting iteration limits
- Building structured prompts

**Recommended for first-time users.**

---

### /ralph-loop-mac:list

List all Ralph loops in the current project.

**Usage:**
```
/ralph-loop-mac:list
```

Shows:
- Loop ID
- Status (ACTIVE or ORPHANED)
- Current iteration
- Max iterations
- Session owner
- Start time

---

### /ralph-loop-mac:cancel-ralph [loop_id]

Cancel Ralph loop(s).

**Usage:**
```
/ralph-loop-mac:cancel-ralph           # Cancel ALL loops
/ralph-loop-mac:cancel-ralph abc12345  # Cancel specific loop
```

**How it works:**
- Removes state file(s) `.claude/ralph-loop-*.local.md`
- Journal files are preserved for reference
- Reports cancellation with iteration count

---

## Key Concepts

### Session Ownership

In v2.0.0, each loop is "owned" by a session:
- When a loop is created, `session_id` is empty (unclaimed)
- When a session's stop hook encounters an unclaimed loop, it claims it
- Once claimed, only that session can continue the loop
- Other sessions ignore loops they don't own

This allows multiple terminals to run different Ralph loops without interference.

### Completion Promises

To signal completion, Claude must output a `<promise>` tag:

```
<promise>TASK COMPLETE</promise>
```

The stop hook looks for this specific tag. Without it (or `--max-iterations`), Ralph runs infinitely.

### Journal Files

Each loop has a journal file for tracking progress:
- Location: `.claude/ralph-journal-{loop_id}.md`
- Contains task description, start time, iteration log
- Claude is instructed to read journal at start and append findings

### Self-Reference Mechanism

The "loop" doesn't mean Claude talks to itself. It means:
- Same prompt repeated
- Claude's work persists in files
- Each iteration sees previous attempts
- Builds incrementally toward goal

## Example

### Interactive Bug Fix

```
/ralph-loop-mac:ralph-loop "Fix the token refresh logic in auth.ts. Output <promise>FIXED</promise> when all tests pass." --completion-promise "FIXED" --max-iterations 10
```

You'll see Ralph:
- Attempt fixes
- Run tests
- See failures
- Iterate on solution
- In your current session

## When to Use Ralph

**Good for:**
- Well-defined tasks with clear success criteria
- Tasks requiring iteration and refinement
- Iterative development with self-correction
- Greenfield projects

**Not good for:**
- Tasks requiring human judgment or design decisions
- One-shot operations
- Tasks with unclear success criteria
- Debugging production issues (use targeted debugging instead)

## Mac/Bash Requirements

This plugin requires:
- **bash** (4.0+) - included with macOS
- **jq** - JSON processor for parsing transcript files

If jq is not installed:
```bash
brew install jq
```

## Learn More

- Original technique: https://ghuntley.com/ralph/
- Ralph Orchestrator: https://github.com/mikeyobrien/ralph-orchestrator
