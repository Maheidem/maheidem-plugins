# Agentic Mode - Quick Start

## 30-Second Setup

```bash
# 1. Install plugin
cd /Users/maheidem/Documents/dev/claude-code-management/plugin-development/maheidem-plugins
claude plugins build plugins/agentic-mode
claude plugins install plugins/agentic-mode/.claude-plugin

# 2. Enable in your project
cd /path/to/your/project
mkdir -p .claude
cp ~/.claude/plugins/agentic-mode/templates/agentic-mode.local.md .claude/

# 3. Start Claude
claude
```

## What Just Happened?

Claude can now only delegate to agents - it cannot directly:
- Edit files
- Write files
- Run bash commands
- Edit notebooks

Instead, it MUST use: `Task("agent-name", "task description")`

## Example Session

```
You: "Create a new file README.md with project documentation"

Claude: ❌ Cannot use Write tool directly
        ✅ Must delegate: Task("general-programmer-agent", "Create README.md...")

Result: Subagent creates the file (has full tool access)
```

## Quick Config

**Enable/Disable:**
```yaml
# .claude/agentic-mode.local.md
---
enabled: true   # Set to false to disable
---
```

**Customize Blocked Tools:**
```yaml
---
enabled: true
blocked_tools:
  - Edit
  - Write
  - Bash
  - NotebookEdit
  - Read  # Add this to also block reading
---
```

## Available Agents

| Task Type | Agent |
|-----------|-------|
| Code changes | general-programmer-agent |
| Documentation | project-docs-writer |
| Data analysis | data-scientist-agent |
| Notebooks | jupyter-notebook-agent |
| Research | deep-research-agent |
| MCP config | mcp-manager-agent |
| Multi-agent coordination | main-orchestrator-agent |

## Verify It Works

```bash
cd /path/to/your/project
claude
```

Try: `"Create a file test.txt with 'hello'"`

**Expected:** Hook blocks Write, suggests using general-programmer-agent

## Troubleshooting

**Tools not blocked?**
- Check config exists: `cat .claude/agentic-mode.local.md`
- Verify enabled: `grep "enabled:" .claude/agentic-mode.local.md`

**Subagents also blocked?**
- Restart Claude
- Check plugin installed: `claude plugins list | grep agentic`

**Need help?**
- Read full docs: [README.md](./README.md)
- See tests: [TESTING.md](./TESTING.md)

## Disable Quickly

```bash
# Method 1: Edit config
echo "---
enabled: false
---" > .claude/agentic-mode.local.md

# Method 2: Remove config
rm .claude/agentic-mode.local.md

# Method 3: Uninstall plugin
claude plugins uninstall agentic-mode
```

## Next Steps

1. Read [README.md](./README.md) for deep dive
2. Review [TESTING.md](./TESTING.md) for test examples
3. Customize `.claude/agentic-mode.local.md` for your workflow
4. Check handoffs in `.scratchpad/handoffs/` after agent runs
