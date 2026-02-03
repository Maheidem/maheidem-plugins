# Agentic Mode Plugin

**Force delegation to specialized agents by blocking direct tool use in the main Claude session.**

## What It Does

This PreToolUse hook creates an "agentic-only mode" where the main Claude session cannot directly use write/execute tools (Edit, Write, Bash, NotebookEdit). Instead, Claude must delegate work to specialized agents via the Task tool.

## Key Features

1. **Selective Blocking** - Only blocks configured tools in main session
2. **Subagent Detection** - Uses Beads Orchestration method to detect subagents via `tool_use_id` matching
3. **Full Subagent Access** - Subagents spawned via Task have unrestricted tool access
4. **Project-Scoped Config** - Enable/disable per project via `.claude/agentic-mode.local.md`
5. **Helpful Messages** - Denial messages suggest appropriate agents for each task

## How It Works

```
Main Session (Restricted)
    │
    ├─ Read Tool ────────────> ✅ Always Allowed
    ├─ Task Tool ────────────> ✅ Always Allowed (delegation mechanism)
    ├─ Edit Tool ────────────> ❌ BLOCKED → "Use general-programmer-agent"
    ├─ Write Tool ───────────> ❌ BLOCKED → "Use general-programmer-agent"
    ├─ Bash Tool ────────────> ❌ BLOCKED → "Use general-programmer-agent"
    └─ NotebookEdit Tool ────> ❌ BLOCKED → "Use jupyter-notebook-agent"
         │
         └─> Task("general-programmer-agent", "Fix bug in app.py")
                  │
                  └─> Subagent Session (Unrestricted)
                        │
                        ├─ Edit Tool ──────> ✅ Allowed
                        ├─ Write Tool ─────> ✅ Allowed
                        ├─ Bash Tool ──────> ✅ Allowed
                        └─ All Tools ──────> ✅ Allowed
```

## Subagent Detection Method

The plugin uses the **Beads Orchestration** approach to reliably detect subagents:

```bash
# Extract transcript session directory
SESSION_DIR="${TRANSCRIPT_PATH%.jsonl}"
SUBAGENTS_DIR="$SESSION_DIR/subagents"

# Search for current tool_use_id in subagent transcripts
MATCHING=$(grep -l "\"id\":\"$TOOL_USE_ID\"" "$SUBAGENTS_DIR"/agent-*.jsonl 2>/dev/null | head -1)

# If found, this is a subagent execution
[[ -n "$MATCHING" ]] && IS_SUBAGENT="true"
```

**Why this works:**
- Main session transcript: `~/.claude/sessions/session-ABC123.jsonl`
- Subagent transcripts: `~/.claude/sessions/session-ABC123/subagents/agent-XYZ.jsonl`
- Each tool use has a unique `tool_use_id` in the transcript
- If the current `tool_use_id` exists in a subagent transcript, it's a subagent call

## Installation

### 1. Build Plugin (if not already built)

```bash
cd /Users/maheidem/Documents/dev/claude-code-management/plugin-development/maheidem-plugins
claude plugins build plugins/agentic-mode
```

### 2. Install Plugin

```bash
claude plugins install plugins/agentic-mode/.claude-plugin
```

### 3. Enable Per Project

Copy the config template to your project:

```bash
cd /path/to/your/project
mkdir -p .claude
cp ~/.claude/plugins/agentic-mode/templates/agentic-mode.local.md .claude/
```

**Edit `.claude/agentic-mode.local.md`:**

```yaml
---
enabled: true  # Set to false to disable

blocked_tools:
  - Edit
  - Write
  - Bash
  - NotebookEdit

agent_suggestions:
  code_changes: general-programmer-agent
  documentation: project-docs-writer
  notebooks: jupyter-notebook-agent
  data_analysis: data-scientist-agent
  research: deep-research-agent
  mcp_config: mcp-manager-agent
  multi_agent: main-orchestrator-agent
---
```

## Configuration Options

### YAML Frontmatter

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable agentic mode |
| `blocked_tools` | list | `[Edit, Write, Bash, NotebookEdit]` | Tools blocked in main session |
| `agent_suggestions` | map | See template | Reference map for agent recommendations |

**Important:**
- `Read` tool is never blocked (needed for context gathering)
- `Task` tool is never blocked (the delegation mechanism)
- Subagents ignore all restrictions

## Agent Suggestions

The hook provides context-aware suggestions when blocking tools:

| Blocked Tool | Suggested Agent(s) |
|--------------|-------------------|
| Edit, Write | general-programmer-agent, project-docs-writer |
| Bash | general-programmer-agent, data-scientist-agent, mcp-manager-agent |
| NotebookEdit | jupyter-notebook-agent |

## Testing

Run the included test suite:

```bash
cd plugins/agentic-mode/.claude-plugin
bash run-tests.sh
```

**Test scenarios:**
1. Task tool always passes (exit 0, no JSON)
2. Edit tool blocked with deny decision in main session
3. Bash tool allowed when config disabled/missing

### Manual Testing

**Test 1: Block Edit in main session**
```bash
cat plugins/agentic-mode/.claude-plugin/test-block-edit.json | \
  plugins/agentic-mode/hooks/enforce-delegation.sh
```

Expected output:
```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Agentic mode is enabled. Direct use of 'Edit' is blocked in the main session. Use 'general-programmer-agent' for code changes, or 'project-docs-writer' for documentation"}}
```

**Test 2: Allow Task tool**
```bash
cat plugins/agentic-mode/.claude-plugin/test-allow-task.json | \
  plugins/agentic-mode/hooks/enforce-delegation.sh
```

Expected: Exit 0 (silent allow)

## Troubleshooting

### Hook doesn't block tools

1. **Check config exists:**
   ```bash
   cat .claude/agentic-mode.local.md
   ```

2. **Verify enabled:**
   ```yaml
   enabled: true  # Not "yes" or "True"
   ```

3. **Check hook is installed:**
   ```bash
   claude plugins list | grep agentic-mode
   ```

### Subagents still blocked

This indicates subagent detection failed. Debug:

```bash
# Add to hook script for debugging:
echo "IS_SUBAGENT=$IS_SUBAGENT" >&2
echo "TRANSCRIPT_PATH=$TRANSCRIPT_PATH" >&2
echo "TOOL_USE_ID=$TOOL_USE_ID" >&2
echo "SUBAGENTS_DIR=$SUBAGENTS_DIR" >&2
```

**Common causes:**
- Transcript path not passed in hook input (older Claude Code version)
- Subagent transcripts in different location
- `tool_use_id` format changed

### Tools blocked unexpectedly

1. **Disable temporarily:**
   ```yaml
   enabled: false
   ```

2. **Check hook timeout:**
   Increase timeout in `hooks/hooks.json` if hook takes >5s

3. **Check jq is installed:**
   ```bash
   which jq || brew install jq
   ```

## File Structure

```
agentic-mode/
├── plugin.json                      # Plugin metadata
├── hooks/
│   ├── hooks.json                   # Hook configuration
│   └── enforce-delegation.sh        # PreToolUse hook script
├── templates/
│   └── agentic-mode.local.md        # Config template for projects
├── .claude-plugin/                  # Built plugin (post build)
│   ├── plugin.json
│   ├── run-tests.sh                 # Test runner
│   ├── test-allow-task.json         # Test: Task always passes
│   ├── test-block-edit.json         # Test: Edit blocked
│   ├── test-allow-disabled.json     # Test: Tools pass when disabled
│   ├── test-subagent-write.json     # Test: Subagent detection
│   └── test-config/                 # Test config directory
│       └── .claude/
│           └── agentic-mode.local.md
└── README.md                        # This file
```

## Advanced Usage

### Custom Blocked Tools

Want to also block Read? Edit config:

```yaml
blocked_tools:
  - Edit
  - Write
  - Bash
  - NotebookEdit
  - Read  # Add this
```

### Allow Specific Commands

The hook currently blocks ALL Bash commands. To allow specific patterns, modify the hook script:

```bash
# After line 35, before blocking:
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Allow safe commands
if echo "$COMMAND" | grep -qE '^(ls|cat|pwd|echo|git status)$'; then
  exit 0  # Allow these specific commands
fi
```

### Dynamic Configuration

Load config from environment variables:

```bash
# Add to hook script:
ENABLED="${AGENTIC_MODE_ENABLED:-$ENABLED}"

# Then set in shell:
export AGENTIC_MODE_ENABLED=true
claude  # Now agentic mode active
```

## Security Considerations

1. **Hook Execution Context** - Runs with user's shell permissions
2. **Config File Trust** - Loads config from project `.claude/` directory (trust your projects)
3. **Subagent Detection** - Relies on transcript file structure (could break with Claude Code updates)
4. **jq Dependency** - Requires `jq` installed system-wide

## Performance

- **Overhead:** ~10-50ms per tool use (jq parsing + file grep)
- **Timeout:** 5000ms (can increase if needed)
- **Disk I/O:** Reads config file + greps subagent transcripts
- **Impact:** Negligible for normal workflows

## Version History

### 0.1.0 (2026-01-26)
- Initial release
- PreToolUse hook with subagent detection
- Project-scoped configuration
- Comprehensive test suite

## License

Same as maheidem-plugins repository

## Author

**maheidem**

## Related

- [Beads Orchestration Plugin](../beads-orchestration/) - Multi-agent workflow orchestration
- [Claude Code Hooks Guide](https://docs.anthropic.com/claude/docs/hooks)
- [Agent Best Practices](../../../guides/agents/agent-best-practices.md)
