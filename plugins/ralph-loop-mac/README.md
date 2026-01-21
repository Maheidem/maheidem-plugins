# Ralph Loop (Mac) v2.0.0

A Mac-compatible Bash implementation of the Ralph Loop plugin for Claude Code.

## What's New in v2.0.0

**Session Ownership Model** - Multiple Claude sessions can now run different Ralph loops simultaneously without interfering with each other.

Key changes:
- Each loop gets a unique 8-character `loop_id`
- State files: `.claude/ralph-loop-{loop_id}.local.md`
- Journal files: `.claude/ralph-journal-{loop_id}.md` track progress
- Sessions "claim" unclaimed loops on first iteration
- Sessions ignore loops owned by other sessions

## What is Ralph Loop?

Ralph Loop implements the **Ralph Wiggum technique** - an iterative development methodology based on continuous AI loops, pioneered by [Geoffrey Huntley](https://ghuntley.com/ralph/).

The core concept:
```bash
while :; do
  cat PROMPT.md | claude-code --continue
done
```

The same prompt is fed to Claude repeatedly. The "self-referential" aspect comes from Claude seeing its own previous work in files and git history, not from feeding output back as input.

## Why Mac Version?

The Windows plugin (`ralph-loop-windows`) uses PowerShell scripts (`.ps1` files). This plugin provides equivalent functionality using native Bash scripts that work on macOS and Linux.

### Key Differences from Windows Version

| Windows (PowerShell) | Mac (Bash) |
|---------------------|------------|
| `setup-ralph-loop.ps1` | `setup-ralph-loop.sh` |
| `stop-hook.ps1` | `stop-hook.sh` |
| `Select-String` | `grep` |
| `ConvertFrom-Json`/`ConvertTo-Json` | `jq` |
| PowerShell regex | Bash `[[ =~ ]]` + `sed` |

## Requirements

- **bash** (4.0+) - included with macOS
- **jq** - JSON processor (required for transcript parsing)

Install jq if not present:
```bash
brew install jq
```

## Installation

1. Add the marketplace:
   ```
   /plugin add maheidem/maheidem-plugins
   ```

2. Install the plugin:
   ```
   /plugin install ralph-loop-mac@maheidem-plugins
   ```

## Usage

### Interactive Setup (Recommended for Beginners)

```
/ralph-loop-mac:start-loop "Build a REST API for todos"
```

This launches an **interactive wizard** that:
- Guides you through defining success criteria
- Teaches GOOD vs BAD criteria examples
- Asks for iteration limit preferences
- Builds a structured, best-practice prompt
- Handles shell-safety validation

### Direct Execution (Power Users)

```
/ralph-loop-mac:ralph-loop "Build a REST API for todos" --max-iterations 20 --completion-promise "DONE"
```

**Options:**
- `--max-iterations <n>` - Maximum iterations before auto-stop (default: unlimited)
- `--completion-promise '<text>'` - Promise phrase to signal completion

### List Active Loops

```
/ralph-loop-mac:list
```

Shows all Ralph loops in the project with their status (ACTIVE or ORPHANED).

### Cancel Loops

```
# Cancel a specific loop by ID
/ralph-loop-mac:cancel-ralph abc12345

# Cancel ALL loops in the project
/ralph-loop-mac:cancel-ralph
```

### Get Help

```
/ralph-loop-mac:help
```

## Which Command Should I Use?

| Command | Best For |
|---------|----------|
| `/ralph-loop-mac:start-loop` | Learning Ralph, first-time users, complex tasks needing structured prompts |
| `/ralph-loop-mac:ralph-loop` | Experienced users, quick tasks, scripted workflows |
| `/ralph-loop-mac:list` | See all active loops in a project |
| `/ralph-loop-mac:cancel-ralph` | Stop runaway loops or clean up |

## How It Works

1. `/ralph-loop` creates a state file at `.claude/ralph-loop-{loop_id}.local.md`
2. A journal file is created at `.claude/ralph-journal-{loop_id}.md`
3. The `session_id` field is left blank (unclaimed)
4. When you try to exit, the stop hook intercepts
5. If the loop is unclaimed, the hook **claims** it (fills in session_id)
6. If the loop belongs to your session, it continues
7. If the loop belongs to another session, it's ignored
8. The **same prompt** is fed back to Claude
9. Claude sees its previous work in files
10. Loop continues until:
    - Max iterations reached
    - Completion promise detected
    - State file manually deleted

### Session Ownership Model

```
Session A starts loop "abc123" → session_id: ""
Session A exits → hook claims it → session_id: "session-A"
Session A continues working...

Session B starts loop "def456" → session_id: ""
Session B exits → hook claims it → session_id: "session-B"
Session B continues working...

Both sessions work independently without interference!
```

### Completion Promises

To signal genuine completion, Claude outputs:

```
<promise>YOUR_PHRASE</promise>
```

The stop hook detects this tag and allows the session to end.

**Important:** The promise should only be output when the statement is genuinely TRUE. The loop is designed to continue until real completion.

### Journal Files

Each loop has a journal file (`.claude/ralph-journal-{loop_id}.md`) that tracks:
- Task description
- Start time
- Iteration transitions

Claude is instructed to read the journal at the start of each iteration and append what was tried and the result.

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
session_id: ""              # Empty until claimed by a session
active: true
iteration: 1
max_iterations: 20
completion_promise: "DONE"
started_at: "2026-01-21T12:00:00Z"
---

Your prompt text here
```

### Journal File Format

`.claude/ralph-journal-{loop_id}.md`:
```markdown
# Ralph Loop Journal - abc12345

Started: 2026-01-21T12:00:00Z
Task: Your prompt text here

---

## Iteration Log

### Iteration 1 - 2026-01-21T12:01:00Z

**Status:** Continuing to iteration 2

---

### Iteration 2 - 2026-01-21T12:05:00Z

**Status:** Continuing to iteration 3

---
```

### Stop Hook Behavior (v2.0.0)

The stop hook (`hooks/stop-hook.sh`):
1. Extracts session_id from hook input JSON
2. Scans all `.claude/ralph-loop-*.local.md` files
3. For each file:
   - If `session_id` is empty → **claims it** (fills in current session)
   - If `session_id` matches current session → **handles it**
   - If `session_id` doesn't match → **skips it**
4. Checks iteration count and max iterations
5. Reads transcript for `<promise>` tags
6. Either allows exit or blocks with same prompt
7. Appends to journal file on each iteration

### Directory Structure

```
ralph-loop-mac/
├── .claude-plugin/
│   └── plugin.json
├── commands/
│   ├── ralph-loop.md      # Direct loop execution
│   ├── start-loop.md      # Interactive wizard
│   ├── cancel-ralph.md    # Cancel loops
│   ├── list.md            # List all loops (NEW)
│   └── help.md            # Documentation
├── hooks/
│   ├── hooks.json
│   └── stop-hook.sh       # Session-aware stop hook
├── scripts/
│   └── setup-ralph-loop.sh
└── README.md
```

## Troubleshooting

### "jq is required but not installed"

Install jq:
```bash
brew install jq
```

### Loop doesn't stop when promise is output

Ensure your promise output exactly matches the configured phrase:
- Check for extra whitespace
- Verify case sensitivity
- Use exact XML tags: `<promise>EXACT TEXT</promise>`

### State file corruption

If the loop stops unexpectedly with "State file corrupted":
```bash
# List all loops
ls .claude/ralph-loop-*.local.md

# Inspect a specific loop
cat .claude/ralph-loop-abc12345.local.md

# Remove and start fresh
rm .claude/ralph-loop-abc12345.local.md
```

### Orphaned loops

If a session crashes or is terminated without completing, loops may become "orphaned" (no session owns them). These will be automatically claimed by the next session that runs.

To see orphaned loops:
```
/ralph-loop-mac:list
```

To clean up:
```
/ralph-loop-mac:cancel-ralph
```

### Multiple sessions interfering

This should not happen with v2.0.0. Each session claims and works on its own loop. If you're seeing interference:
1. Run `/ralph-loop-mac:list` to see all loops
2. Check the `session_id` field in each state file
3. Cancel specific loops that are problematic

## Migration from v1.x

The old state file `.claude/ralph-loop.local.md` is no longer used. If you have an active loop from v1.x:

1. The old loop will be ignored by the new hook
2. Delete the old file: `rm .claude/ralph-loop.local.md`
3. Start a fresh loop with `/ralph-loop-mac:ralph-loop`

## Credits

- Original Ralph Wiggum technique: [Geoffrey Huntley](https://ghuntley.com/ralph/)
- Ralph Orchestrator: [mikeyobrien/ralph-orchestrator](https://github.com/mikeyobrien/ralph-orchestrator)
- Mac port & v2.0.0 session model: maheidem
