---
description: Show agentic mode status for this project
allowed-tools: Read
context: fork
---

Display current agentic mode configuration and status for this project.

## Workflow

1. **Locate configuration file**
   - Check for `.claude/agentic-mode.local.md` in current project
   - Determine absolute path for display

2. **Read and parse configuration** (if exists)
   - Extract YAML frontmatter
   - Parse `enabled` field (true/false)
   - Parse `blocked_tools` list
   - Parse `agent_suggestions` map (optional)

3. **Display comprehensive status**
   - Configuration file path (exists or not)
   - Enabled/disabled status
   - List of blocked tools (if enabled)
   - Available agents and their purposes
   - Quick command references

## Output Format

### When Configured and Enabled

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  AGENTIC MODE STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Status: ENABLED ✓
Config: /absolute/path/to/project/.claude/agentic-mode.local.md

BLOCKED TOOLS IN MAIN SESSION:
  • Edit           → Use general-programmer-agent
  • Write          → Use general-programmer-agent
  • Bash           → Use general-programmer-agent
  • NotebookEdit   → Use jupyter-notebook-agent

ALWAYS ALLOWED:
  • Read           → Context gathering
  • Task           → Agent delegation (the whole point!)

AVAILABLE AGENTS:
  • general-programmer-agent   → Code changes, bug fixes, features
  • project-docs-writer        → README, documentation
  • jupyter-notebook-agent     → Notebook operations
  • data-scientist-agent       → Statistical analysis
  • deep-research-agent        → Web research, documentation
  • mcp-manager-agent          → MCP server configuration
  • main-orchestrator-agent    → Multi-agent coordination

QUICK COMMANDS:
  Disable:  /project:agentic:disable
  Status:   /project:agentic:status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### When Configured but Disabled

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  AGENTIC MODE STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Status: DISABLED
Config: /absolute/path/to/project/.claude/agentic-mode.local.md

All tools available for direct use in main session.

CONFIGURED BLOCKING (when enabled):
  • Edit
  • Write
  • Bash
  • NotebookEdit

QUICK COMMANDS:
  Enable:  /project:agentic:enable
  Status:  /project:agentic:status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### When Not Configured

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  AGENTIC MODE STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Status: NOT CONFIGURED

Config file not found at:
  .claude/agentic-mode.local.md

Agentic mode is not set up for this project.

WHAT IS AGENTIC MODE?

Forces Claude to delegate work to specialized agents instead of
performing direct edits in the main session. The main session is
blocked from using write tools (Edit, Write, Bash) and must use
the Task tool to spawn specialized agents.

BENEFITS:
  ✓ Better separation of concerns
  ✓ Leverages specialized agent expertise
  ✓ Prevents accidental direct edits
  ✓ Encourages proper delegation workflow

QUICK COMMANDS:
  Enable:  /project:agentic:enable
  Help:    See plugin README for details
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Error Handling

**If config file exists but is unreadable:**
- Report: "Config file exists but cannot be read"
- Show: Path to config file
- Suggest: "Check file permissions"

**If config has invalid YAML:**
- Report: "Config file has invalid YAML syntax"
- Show: Path to config file
- Suggest: "Fix YAML syntax or run /project:agentic:enable to regenerate"

**If config missing required fields:**
- Report: "Config file is missing required 'enabled' field"
- Suggest: "Run /project:agentic:enable to regenerate config"

## Implementation Notes

- Use Read tool only (no modifications)
- Parse YAML frontmatter carefully (avoid crashing on malformed files)
- Display absolute paths (resolve from cwd)
- Use box drawing characters for clean output
- Keep output concise but informative
- Always show quick command references

## Requirements

- DO NOT modify any files (read-only operation)
- Always show absolute path to config file
- Handle missing config gracefully (not an error)
- Display all blocked tools if enabled
- Show agent suggestions if available in config
- Use context: fork (don't pollute main conversation)
