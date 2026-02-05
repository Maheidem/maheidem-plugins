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

# Tool-to-agent mapping (looked up by tool name)
# When a tool is blocked, the suggestion from this map is shown
agent_suggestions:
  Edit: general-programmer-agent
  Write: general-programmer-agent
  Bash: general-programmer-agent
  NotebookEdit: jupyter-notebook-agent
  Read: deep-research-agent

# Bash commands that bypass blocking (regex patterns matched against command start)
# Only applies when Bash is in blocked_tools
bash_whitelist:
  - "git status"
  - "git diff"
  - "git log"
  - "ls"
  - "pwd"
  - "which"

# Message verbosity: minimal, standard, verbose
message_verbosity: standard
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

## Debug Mode

Set `AGENTIC_DEBUG=true` environment variable to see detailed hook decisions in stderr.
