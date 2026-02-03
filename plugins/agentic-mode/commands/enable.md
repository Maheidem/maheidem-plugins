---
description: Enable agentic-only mode for this project
allowed-tools: Read, Write, AskUserQuestion
argument-hint: [tool-blocking-preset]
---

Enable agentic mode to enforce delegation to specialized agents in this project.

## Workflow

1. **Check existing configuration**
   - Look for `.claude/agentic-mode.local.md` in current project
   - If exists and enabled=true, inform user it's already enabled

2. **Interactive configuration** (if not already enabled)
   - Use AskUserQuestion to ask which tools to block:

     **Options:**
     - `all-write` (recommended): Block Edit, Write, Bash, NotebookEdit
     - `include-read`: Block Edit, Write, Bash, NotebookEdit, Read
     - `custom`: Let user specify custom tool list

   - Accept argument $1 as preset: `/project:agentic:enable all-write`

3. **Create configuration file**
   - Create `.claude/` directory if missing
   - Copy from template: `${CLAUDE_PLUGIN_ROOT}/templates/agentic-mode.local.md`
   - Update `enabled: true` in YAML frontmatter
   - Update `blocked_tools:` list based on user selection

4. **Confirm activation**
   - Display success message with:
     - Path to config file
     - List of blocked tools
     - Available agents
     - How to disable: `/project:agentic:disable`

## Tool Blocking Presets

**all-write** (recommended):
```yaml
blocked_tools:
  - Edit
  - Write
  - Bash
  - NotebookEdit
```

**include-read** (strict mode):
```yaml
blocked_tools:
  - Edit
  - Write
  - Bash
  - NotebookEdit
  - Read
```

**custom**: Prompt user for specific tools to block

## Input Validation

- If $1 provided, validate it's one of: `all-write`, `include-read`, `custom`
- If invalid, reject and show valid options
- Tool names must be exact: Edit, Write, Bash, NotebookEdit, Read

## Error Handling

**If template file not found:**
- Report: "Template file not found at plugin templates directory"
- Suggest: "Reinstall agentic-mode plugin: claude plugins install"
- STOP execution

**If .claude/ directory creation fails:**
- Report: Full error message
- Suggest: "Check write permissions in current directory"
- STOP execution

**If config write fails:**
- Report: Specific error
- Suggest: "Verify disk space and permissions"
- STOP execution

## Expected Output

**Success message:**
```
✓ Agentic mode ENABLED for this project

Configuration: /path/to/project/.claude/agentic-mode.local.md

Blocked tools in main session:
  - Edit
  - Write
  - Bash
  - NotebookEdit

Main session can only delegate via Task tool to:
  - general-programmer-agent (code changes)
  - project-docs-writer (documentation)
  - jupyter-notebook-agent (notebooks)
  - data-scientist-agent (data analysis)
  - deep-research-agent (research)
  - mcp-manager-agent (MCP configuration)
  - main-orchestrator-agent (multi-agent coordination)

To disable: /project:agentic:disable
To check status: /project:agentic:status
```

## Requirements

- DO NOT create config if already enabled (inform user instead)
- Always create .claude/ directory if missing
- Preserve existing config content if updating
- Use exact template structure from plugin
- Validate YAML syntax before writing
