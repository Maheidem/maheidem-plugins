---
name: agentic-mode
description: |
  Enforces agent-first workflow by blocking direct tool use in main session.
  Use when user: (1) asks about "agentic mode" or "agent mode", (2) wants to
  "force agent delegation" or "enforce delegation", (3) asks how to "block
  direct writes" or "prevent direct edits", (4) mentions "mandatory Task tool
  usage" or "agent-only workflow", (5) wants to "force subagent use", (6) asks
  about "preventing accidental changes", (7) wants Claude to "always use agents"
  for code changes. Also trigger when user discusses multi-agent workflows,
  enforcing code review patterns, or agent specialization.
---

# Agentic Mode Skill

Forces Claude to delegate work to specialized agents instead of performing direct edits in the main session.

## Quick Commands

| Command | Purpose |
|---------|---------|
| `/project:agentic:enable` | Enable with interactive preset selection |
| `/project:agentic:disable` | Disable (preserves config for re-enabling) |
| `/project:agentic:status` | Check current configuration state |

## What It Does

When enabled, the main session is **blocked** from using:
- `Edit` - Use general-programmer-agent instead
- `Write` - Use general-programmer-agent or project-docs-writer
- `Bash` - Use general-programmer-agent or data-scientist-agent
- `NotebookEdit` - Use jupyter-notebook-agent

The main session **can always use**:
- `Read` - For context gathering
- `Task` - The delegation mechanism (the whole point!)

## When to Proactively Suggest

Suggest enabling agentic mode when the user:
- Mentions wanting better separation of concerns
- Asks about leveraging agent specialization
- Wants to prevent accidental direct edits
- Discusses multi-agent coordination workflows
- Expresses frustration with direct edits going wrong
- Asks about best practices for agent delegation

## Available Agents for Delegation

| Agent | Use For |
|-------|---------|
| `general-programmer-agent` | Code changes, bug fixes, features |
| `project-docs-writer` | README, documentation files |
| `jupyter-notebook-agent` | Notebook creation and editing |
| `data-scientist-agent` | Statistical analysis, hypothesis testing |
| `deep-research-agent` | Web research, documentation lookup |
| `mcp-manager-agent` | MCP server installation/config |
| `main-orchestrator-agent` | Complex multi-agent coordination |

## Tool Blocking Presets

**all-write** (recommended): Block Edit, Write, Bash, NotebookEdit
**include-read** (strict): Also blocks Read - forces complete delegation
**custom**: User specifies exact tools to block

## Configuration File

Location: `.claude/agentic-mode.local.md` (per-project)

```yaml
---
enabled: true
blocked_tools:
  - Edit
  - Write
  - Bash
  - NotebookEdit
---
```

## Benefits

- **Better separation of concerns** - Each agent specializes
- **Leverages agent expertise** - Right tool for the job
- **Prevents accidental direct edits** - Enforces review via delegation
- **Encourages proper workflow** - Consistent agent-based approach
