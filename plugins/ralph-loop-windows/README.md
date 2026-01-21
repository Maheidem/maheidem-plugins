# Ralph Loop (Windows) v2.0.0

A Windows-compatible PowerShell implementation of the Ralph Loop plugin for Claude Code.

## What's New in v2.0.0

**Session-Ownership Model**: Multiple Ralph loops can now coexist in the same project without interfering with each other.

- Each loop gets a unique 8-character ID
- Sessions claim unclaimed loops automatically
- New `/list` command shows all loops and their status
- Journal files track iteration history
- Improved `/cancel-ralph` with loop_id support

## What is Ralph Loop?

Ralph Loop implements the **Ralph Wiggum technique** - an iterative development methodology based on continuous AI loops, pioneered by [Geoffrey Huntley](https://ghuntley.com/ralph/).

The core concept:
```bash
while :; do
  cat PROMPT.md | claude-code --continue
done
```

The same prompt is fed to Claude repeatedly. The "self-referential" aspect comes from Claude seeing its own previous work in files and git history, not from feeding output back as input.

## Why Windows Version?

The official `ralph-wiggum` plugin uses bash scripts (`.sh` files) that don't work on Windows. This plugin provides equivalent functionality using PowerShell scripts.

### Key Differences from Original

| Original (bash) | Windows (PowerShell) |
|-----------------|----------------------|
| `setup-ralph-loop.sh` | `setup-ralph-loop.ps1` |
| `stop-hook.sh` | `stop-hook.ps1` |
| `grep`, `sed`, `awk` | PowerShell `-match`, `Select-String` |
| `jq` | `ConvertFrom-Json`/`ConvertTo-Json` |

## Installation

1. Add the marketplace:
   ```
   /plugin add maheidem/maheidem-plugins
   ```

2. Install the plugin:
   ```
   /plugin install ralph-loop-windows@maheidem-plugins
   ```

## Usage

### Interactive Setup (Recommended for Beginners)

```
/ralph-loop-windows:start-loop "Build a REST API for todos"
```

This launches an **interactive wizard** that:
- Guides you through defining success criteria
- Teaches GOOD vs BAD criteria examples
- Asks for iteration limit preferences
- Builds a structured, best-practice prompt
- Handles shell-safety validation

### Direct Execution (Power Users)

```
/ralph-loop-windows:ralph-loop "Build a REST API for todos" --max-iterations 20 --completion-promise "DONE"
```

**Options:**
- `--max-iterations <n>` - Maximum iterations before auto-stop (default: unlimited)
- `--completion-promise '<text>'` - Promise phrase to signal completion

### List All Loops

```
/ralph-loop-windows:list
```

Shows all Ralph loops in the project with their status:
- **ORPHANED**: No session owns this loop (will be claimed by next session)
- **OWNED**: Claimed by a session

### Cancel an Active Loop

```
/ralph-loop-windows:cancel-ralph
/ralph-loop-windows:cancel-ralph <loop_id>
```

Without arguments: cancels the only active loop (or shows list if multiple).
With loop_id: cancels that specific loop.

### Get Help

```
/ralph-loop-windows:help
```

## Which Command Should I Use?

| Command | Best For |
|---------|----------|
| `/ralph-loop-windows:start-loop` | Learning Ralph, first-time users, complex tasks needing structured prompts |
| `/ralph-loop-windows:ralph-loop` | Experienced users, quick tasks, scripted workflows |
| `/ralph-loop-windows:list` | Checking status of all loops in project |
| `/ralph-loop-windows:cancel-ralph` | Stopping a loop manually |

## How It Works

1. `/ralph-loop` creates a state file at `.claude/ralph-loop-{loop_id}.local.md`
2. A journal file is created at `.claude/ralph-journal-{loop_id}.md`
3. You work on the task normally
4. When you try to exit, the stop hook intercepts
5. The hook claims the loop (if unclaimed) or handles it (if owned by this session)
6. The **same prompt** is fed back to Claude
7. Claude sees its previous work in files
8. Loop continues until:
   - Max iterations reached
   - Completion promise detected
   - State file manually deleted

### Session Ownership Model (v2.0.0)

The new session-ownership model allows multiple Claude sessions to work in the same project without conflicts:

1. **Loop Creation**: When you start a loop, it gets a unique ID and `session_id` is left blank
2. **Claiming**: When a session's stop hook fires, it scans for unclaimed loops and claims one
3. **Ownership**: Once claimed, only that session's stop hook will block exit for that loop
4. **Other Sessions**: Loops owned by other sessions are ignored (exit is allowed)

This enables:
- Multiple developers working on the same codebase
- Multiple Claude sessions in different terminals
- Isolated loops that don't interfere with each other

### Completion Promises

To signal genuine completion, Claude outputs:

```
<promise>YOUR_PHRASE</promise>
```

The stop hook detects this tag and allows the session to end.

**Important:** The promise should only be output when the statement is genuinely TRUE. The loop is designed to continue until real completion.

### Journal Files

Each loop has an associated journal file that tracks iteration history:

- Location: `.claude/ralph-journal-{loop_id}.md`
- Contains timestamps for each iteration
- Preserved when loop completes (for reference)
- Can be used to track what was tried across iterations

## When to Use Ralph Loop

**Good for:**
- Well-defined tasks with clear success criteria
- Tasks requiring iteration and refinement
- Iterative development with self-correction
- Greenfield projects

**Not good for:**
- Tasks requiring human judgment or design decisions
- One-shot operations
- Tasks with unclear success criteria

## Technical Details

### State File Format (v2.0.0)

`.claude/ralph-loop-{loop_id}.local.md`:
```yaml
---
loop_id: "abc12345"
session_id: ""
active: true
iteration: 1
max_iterations: 20
completion_promise: "DONE"
started_at: "2025-01-09T12:00:00Z"
---

Your prompt text here
```

### Journal File Format

`.claude/ralph-journal-{loop_id}.md`:
```yaml
---
loop_id: "abc12345"
created_at: "2025-01-09T12:00:00Z"
---

# Ralph Loop Journal - abc12345

This file tracks the iteration history for this Ralph loop.

---

## Iteration 1 - 2025-01-09 12:05:00

_Iteration completed. Review files and continue with the task._

---
```

### Stop Hook Behavior

The stop hook (`hooks/stop-hook.ps1`):
1. Gets session_id from hook input JSON
2. Scans all `.claude/ralph-loop-*.local.md` files
3. For each loop:
   - If session_id is empty: claims it
   - If session_id matches: handles it
   - If session_id differs: skips it
4. For the claimed/owned loop:
   - Checks iteration count
   - Reads transcript for `<promise>` tags
   - Either allows exit or blocks with same prompt
5. Appends to journal file on each iteration

## Upgrading from v1.x

If you have existing v1.x loops (`.claude/ralph-loop.local.md`), they will not be detected by v2.0.0. Options:

1. **Manual migration**: Rename to `.claude/ralph-loop-{any-8-chars}.local.md` and add `loop_id` and `session_id` fields
2. **Start fresh**: Cancel old loops and create new ones with v2.0.0

## Credits

- Original Ralph Wiggum technique: [Geoffrey Huntley](https://ghuntley.com/ralph/)
- Ralph Orchestrator: [mikeyobrien/ralph-orchestrator](https://github.com/mikeyobrien/ralph-orchestrator)
- Windows port: maheidem
