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
┌─────────────────────────────────────────────────────┐
│  🤖 AGENTIC MODE: ENABLED ✓                         │
│  Config: .claude/agentic-mode.local.md              │
└─────────────────────────────────────────────────────┘

BLOCKED (main session):
  ✗ Edit, Write, Bash, NotebookEdit

ALLOWED (main session):
  ✓ Read, Task, Glob, Grep, WebSearch, WebFetch

DELEGATE VIA TASK TOOL TO:
  • general-programmer-agent   → code changes
  • project-docs-writer        → documentation
  • jupyter-notebook-agent     → notebooks
  • data-scientist-agent       → statistics
  • deep-research-agent        → research
  • mcp-manager-agent          → MCP config

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Commands: /project:agentic:disable | /project:agentic:status
```

**Note:** If `Read` is also blocked (include-read preset), show it in BLOCKED section instead.
Update ALLOWED section accordingly.

### When Configured but Disabled

```
┌─────────────────────────────────────────────────────┐
│  🤖 AGENTIC MODE: DISABLED                          │
│  Config: .claude/agentic-mode.local.md (exists)     │
└─────────────────────────────────────────────────────┘

All tools available - no delegation enforced.

Would block when enabled: Edit, Write, Bash, NotebookEdit

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Commands: /project:agentic:enable | /project:agentic:status
```

### When Not Configured

```
┌─────────────────────────────────────────────────────┐
│  🤖 AGENTIC MODE: NOT CONFIGURED                    │
└─────────────────────────────────────────────────────┘

No config found at: .claude/agentic-mode.local.md

WHAT IS IT?
Forces delegation to specialized agents (Task tool) by blocking
direct use of Edit, Write, Bash in the main session.

BENEFITS:
  ✓ Leverages specialized agent expertise
  ✓ Prevents accidental direct edits
  ✓ Enforces proper delegation workflow

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Get started: /project:agentic:enable
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
