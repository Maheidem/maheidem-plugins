# Agentic Mode Plugin

**Force delegation to specialized agents by blocking direct tool use in the main Claude session.**

## What It Does

This PreToolUse hook creates an "agentic-only mode" where the main Claude session cannot directly use write/execute tools (Edit, Write, Bash, NotebookEdit). Instead, Claude must delegate work to specialized agents via the Task tool.

## Key Features

1. **Selective Blocking** - Only blocks configured tools in main session
2. **Subagent Detection** - Path-based detection via `transcript_path` containing `/subagents/`
3. **Full Subagent Access** - Subagents spawned via Task have unrestricted tool access
4. **Project-Scoped Config** - Enable/disable per project via `.claude/agentic-mode.local.md`
5. **Helpful Messages** - Denial messages suggest appropriate agents for each task
6. **Bash Whitelist** - Allow specific bash commands (e.g., `git status`) while blocking others
7. **Config-Driven Suggestions** - Agent suggestions read from config with hardcoded fallback
8. **Debug Logging** - Set `AGENTIC_DEBUG=true` for verbose decision logging

## How It Works

```
Main Session (Restricted)
    |
    +- Read Tool -----------> ALLOWED (always)
    +- Task Tool -----------> ALLOWED (delegation mechanism)
    +- Edit Tool -----------> BLOCKED -> "Use general-programmer-agent"
    +- Write Tool ----------> BLOCKED -> "Use general-programmer-agent"
    +- Bash Tool -----------> BLOCKED (unless command matches whitelist)
    +- NotebookEdit Tool ---> BLOCKED -> "Use jupyter-notebook-agent"
         |
         +-> Task("general-programmer-agent", "Fix bug in app.py")
                  |
                  +-> Subagent Session (Unrestricted)
                        |
                        +- Edit Tool ------> ALLOWED
                        +- Write Tool -----> ALLOWED
                        +- Bash Tool ------> ALLOWED
                        +- All Tools ------> ALLOWED
```

## Subagent Detection Method

The plugin uses **path-based detection** - simple and reliable:

```bash
# If transcript_path contains /subagents/, this is a subagent call
if [[ "$TRANSCRIPT_PATH" == *"/subagents/"* ]]; then
  IS_SUBAGENT="true"
fi
```

**Why this works:**
- Main session transcript: `~/.claude/sessions/session-ABC123.jsonl`
- Subagent transcripts: `~/.claude/sessions/session-ABC123/subagents/agent-XYZ.jsonl`
- The `/subagents/` path component reliably distinguishes subagent calls

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
  Edit: general-programmer-agent
  Write: general-programmer-agent
  Bash: general-programmer-agent
  NotebookEdit: jupyter-notebook-agent
  Read: deep-research-agent

bash_whitelist:
  - "git status"
  - "git diff"
  - "git log"
  - "ls"
  - "pwd"
  - "which"

message_verbosity: standard
---
```

## Configuration Options

### YAML Frontmatter

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable agentic mode |
| `blocked_tools` | list | `[Edit, Write, Bash, NotebookEdit]` | Tools blocked in main session |
| `agent_suggestions` | map | See template | Tool-to-agent mapping (keyed by tool name) |
| `bash_whitelist` | list | `[]` | Regex patterns for allowed bash commands |
| `message_verbosity` | string | `standard` | Message detail level (reserved for future use) |

**Important:**
- `Read` tool is never blocked (needed for context gathering)
- `Task` tool is never blocked (the delegation mechanism)
- Subagents ignore all restrictions
- Empty `blocked_tools` with `enabled: true` blocks nothing

## Agent Suggestions

Agent suggestions are read from the `agent_suggestions` config map first. If no mapping exists for a tool, hardcoded defaults are used:

| Blocked Tool | Default Suggested Agent(s) |
|--------------|---------------------------|
| Edit, Write | general-programmer-agent, project-docs-writer |
| Bash | general-programmer-agent, data-scientist-agent |
| NotebookEdit | jupyter-notebook-agent |
| Read | deep-research-agent |

To customize, edit the `agent_suggestions` map in your config:

```yaml
agent_suggestions:
  Edit: my-custom-code-agent
  Bash: my-devops-agent
```

## Bash Whitelist

When Bash is in `blocked_tools`, you can still allow specific commands via `bash_whitelist`. Each entry is a regex pattern matched against the start of the command:

```yaml
bash_whitelist:
  - "git status"     # Allows: git status, git status --short
  - "git diff"       # Allows: git diff, git diff HEAD
  - "git log"        # Allows: git log, git log --oneline
  - "ls"             # Allows: ls, ls -la, ls /path
  - "pwd"            # Allows: pwd
  - "which"          # Allows: which jq, which python
```

Commands not matching any whitelist pattern are blocked as normal.

## Debug Logging

Set the `AGENTIC_DEBUG` environment variable to see detailed hook decisions:

```bash
# Enable debug output (goes to stderr)
export AGENTIC_DEBUG=true

# Test with a specific input
cat test-block-edit.json | ./hooks/enforce-delegation.sh

# Debug output shows:
# [agentic-mode] Tool=Edit, TranscriptPath=..., CWD=...
# [agentic-mode] IS_SUBAGENT=false
# [agentic-mode] Config found: .claude/agentic-mode.local.md
# [agentic-mode] Enabled=true, BlockedTools=Edit|Write|Bash|NotebookEdit
# [agentic-mode] Blocking 'Edit' with suggestion: ...
```

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
4. Write tool allowed for subagent (path-based detection)

### Manual Testing

**Test 1: Block Edit in main session**
```bash
cat plugins/agentic-mode/.claude-plugin/test-block-edit.json | \
  plugins/agentic-mode/hooks/enforce-delegation.sh
```

**Test 2: Allow Task tool**
```bash
cat plugins/agentic-mode/.claude-plugin/test-allow-task.json | \
  plugins/agentic-mode/hooks/enforce-delegation.sh
```
Expected: Exit 0 (silent allow)

**Test 3: Debug mode**
```bash
AGENTIC_DEBUG=true cat plugins/agentic-mode/.claude-plugin/test-block-edit.json | \
  plugins/agentic-mode/hooks/enforce-delegation.sh
```
Expected: Debug output on stderr + deny JSON on stdout

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

4. **Enable debug logging:**
   ```bash
   export AGENTIC_DEBUG=true
   # Then use Claude - check stderr for decision traces
   ```

### Subagents still blocked

Enable debug logging (`AGENTIC_DEBUG=true`) and check that `IS_SUBAGENT` shows `true`. The hook detects subagents by checking if `transcript_path` contains `/subagents/`.

### Bash commands blocked unexpectedly

If a whitelisted command is still blocked:
1. Verify the pattern is in `bash_whitelist` in your config
2. Patterns match the **start** of the command (regex `^pattern`)
3. Enable debug logging to see the whitelist check

### Tools blocked unexpectedly

1. **Disable temporarily:**
   ```yaml
   enabled: false
   ```

2. **Check jq is installed:**
   ```bash
   which jq || brew install jq
   ```

3. **Enable debug logging** to trace the exact decision path

## File Structure

```
agentic-mode/
+-- plugin.json                      # Plugin metadata
+-- hooks/
|   +-- hooks.json                   # Hook configuration
|   +-- enforce-delegation.sh        # PreToolUse hook script
+-- templates/
|   +-- agentic-mode.local.md        # Config template for projects
+-- .claude-plugin/                  # Built plugin (post build)
|   +-- plugin.json
|   +-- run-tests.sh                 # Test runner
|   +-- test-allow-task.json         # Test: Task always passes
|   +-- test-block-edit.json         # Test: Edit blocked
|   +-- test-allow-disabled.json     # Test: Tools pass when disabled
|   +-- test-subagent-write.json     # Test: Subagent detection
|   +-- test-config/                 # Test config directory
|       +-- .claude/
|           +-- agentic-mode.local.md
+-- README.md                        # This file
```

## Performance

- **jq calls:** 2 per invocation (input parse + output generation; down from 4 in v0.3.0)
- **Bash whitelist:** adds 1 extra jq call only when Bash is blocked and whitelist exists
- **Overhead:** ~10-30ms per tool use
- **Timeout:** 5000ms (can increase if needed)
- **Fail-open:** If jq is missing, hook exits 0 (allows everything)

## Version History

### 0.4.0 (2026-02-05)
- **Fixed:** `blocked_tools` parsing (was concatenating without delimiters)
- **Fixed:** Subagent detection - switched from grep-based to path-based (`/subagents/` in transcript path)
- **Fixed:** Empty `blocked_tools` with `enabled: true` no longer blocks everything
- **Fixed:** YAML frontmatter extraction limited to first `---` block
- **Fixed:** JSON output uses `jq` for proper escaping
- **Fixed:** Test runner stale variable between iterations
- **Added:** Bash whitelist - allow specific commands while Bash is blocked
- **Added:** Config-driven agent suggestions (with hardcoded fallback)
- **Added:** Debug logging via `AGENTIC_DEBUG=true` environment variable
- **Added:** jq dependency guard (fail-open if missing)
- **Added:** Automated subagent detection test
- **Improved:** Consolidated 4 jq calls to 1 for input parsing
- **Breaking:** `agent_suggestions` keys changed from task-type to tool-name

### 0.3.0 (2026-01-28)
- Added project-scoped configuration
- Improved subagent detection

### 0.1.0 (2026-01-26)
- Initial release
- PreToolUse hook with subagent detection
- Project-scoped configuration
- Comprehensive test suite

## Security Considerations

1. **Hook Execution Context** - Runs with user's shell permissions
2. **Config File Trust** - Loads config from project `.claude/` directory (trust your projects)
3. **Subagent Detection** - Relies on transcript path structure (could break with Claude Code updates)
4. **jq Dependency** - Requires `jq` for operation; fails open if missing
5. **Bash Whitelist** - Regex patterns; ensure patterns are specific enough

## License

Same as maheidem-plugins repository

## Author

**maheidem**

## Related

- [Claude Code Hooks Guide](https://docs.anthropic.com/claude/docs/hooks)
- [Agent Best Practices](../../../guides/agents/agent-best-practices.md)
