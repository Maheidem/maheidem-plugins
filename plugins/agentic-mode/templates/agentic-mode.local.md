---
# Agentic Mode Configuration
# Copy this file to: {project}/.claude/agentic-mode.local.md

# Enable/disable agentic mode enforcement
enabled: true

# Tools blocked in main session (subagents are never blocked)
# Default: Edit, Write, Bash, NotebookEdit
# Note: Read is always allowed, Task is always allowed
blocked_tools:
  - Edit
  - Write
  - Bash
  - NotebookEdit

# Agent suggestions by task type (for reference)
agent_suggestions:
  code_changes: general-programmer-agent
  documentation: project-docs-writer
  notebooks: jupyter-notebook-agent
  data_analysis: data-scientist-agent
  research: deep-research-agent
  mcp_config: mcp-manager-agent
  multi_agent: main-orchestrator-agent
---

# Agentic Mode

When enabled, this forces Claude to delegate work to specialized agents instead of
performing direct edits in the main session.

## How It Works

1. Main session is blocked from using Edit, Write, Bash, NotebookEdit
2. Main session MUST use Task tool to delegate to agents
3. Subagents (spawned via Task) have full tool access
4. Read tool is always allowed for context gathering

## Available Agents

| Agent | Use For |
|-------|---------|
| general-programmer-agent | Code changes, bug fixes, features |
| data-scientist-agent | Statistical analysis, hypothesis testing |
| deep-research-agent | Web research, documentation lookup |
| jupyter-notebook-agent | Notebook creation and editing |
| project-docs-writer | README, documentation files |
| main-orchestrator-agent | Complex multi-agent coordination |
| mcp-manager-agent | MCP server installation/config |

## Disable Temporarily

Set `enabled: false` in the YAML frontmatter above.
