# Ralph Loop (Mac)

A Mac-compatible Bash implementation of the Ralph Loop plugin for Claude Code.

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

### Cancel an Active Loop

```
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

## How It Works

1. `/ralph-loop` creates a state file at `.claude/ralph-loop.local.md`
2. You work on the task normally
3. When you try to exit, the stop hook intercepts
4. The **same prompt** is fed back to Claude
5. Claude sees its previous work in files
6. Loop continues until:
   - Max iterations reached
   - Completion promise detected
   - State file manually deleted

### Completion Promises

To signal genuine completion, Claude outputs:

```
<promise>YOUR_PHRASE</promise>
```

The stop hook detects this tag and allows the session to end.

**Important:** The promise should only be output when the statement is genuinely TRUE. The loop is designed to continue until real completion.

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

### State File Format

`.claude/ralph-loop.local.md`:
```yaml
---
active: true
iteration: 1
max_iterations: 20
completion_promise: "DONE"
started_at: "2025-01-21T12:00:00Z"
---

Your prompt text here
```

### Stop Hook Behavior

The stop hook (`hooks/stop-hook.sh`):
1. Checks for active state file
2. Parses YAML frontmatter
3. Checks iteration count
4. Reads transcript for `<promise>` tags using `jq`
5. Either allows exit or blocks with same prompt

### Directory Structure

```
ralph-loop-mac/
├── .claude-plugin/
│   └── plugin.json
├── commands/
│   ├── ralph-loop.md
│   ├── start-loop.md
│   ├── cancel-ralph.md
│   └── help.md
├── hooks/
│   ├── hooks.json
│   └── stop-hook.sh
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
cat .claude/ralph-loop.local.md  # Inspect the file
rm .claude/ralph-loop.local.md   # Remove and start fresh
```

## Credits

- Original Ralph Wiggum technique: [Geoffrey Huntley](https://ghuntley.com/ralph/)
- Ralph Orchestrator: [mikeyobrien/ralph-orchestrator](https://github.com/mikeyobrien/ralph-orchestrator)
- Mac port: maheidem
