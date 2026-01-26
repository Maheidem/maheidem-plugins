# maheidem-agent-suite

🤖 **6 specialized agents for Claude Code infrastructure management** with built-in handoff protocol enforcement.

## What's Included

### Agents (6 total)

| Agent | Purpose | Key Features |
|-------|---------|--------------|
| **agent-creation-expert** | Create & optimize Claude Code agents | 2026 best practices, YAML validation, security patterns |
| **claude-md-manager** | Manage CLAUDE.MD files | Analyze, optimize, audit, split, learn modes |
| **command-creator** | Create slash commands | Workflow automation, security validation, test generation |
| **deep-research-agent** | Technical research | Web search, documentation, source citation |
| **hook-creator** | Create lifecycle hooks | All 9 event types, Python/Bash templates, testing |
| **mcp-manager-agent** | MCP server management | CLI-first approach, three-layer validation |

### Skills

| Skill | Purpose |
|-------|---------|
| **handoff-protocol** | Documents the standardized handoff protocol for context preservation |

### Hooks

| Hook | Event | Purpose |
|------|-------|---------|
| **handoff-validator** | SubagentStop | Validates handoff document creation after agent tasks |

## The Handoff Protocol

All agents in this suite create **handoff documents** when completing tasks:

```
.scratchpad/handoffs/{agent-name}-YYYY-MM-DD-HH-mm-SS-{SUCCESS|FAIL}.md
```

**Benefits:**
- 📋 Context preservation across multi-agent workflows
- 🧠 Decision history for future reference
- ⚠️ Error prevention through documented learnings
- 🔄 Continuity when resuming work

## Installation

### From Marketplace (Recommended)

```bash
# Add the marketplace (if not already added)
/plugin marketplace add maheidem/maheidem-plugins

# Install the plugin user-wide
/plugin install maheidem-agent-suite@maheidem-plugins --scope user

# Verify installation
/agents
```

### Local Installation (Development)

```bash
# Enable plugin from local path
claude --plugin-dir ./plugin-development/maheidem-plugins/plugins/maheidem-agent-suite
```

## Usage

### Using Agents

After installation, agents appear in your agent list and can be invoked via the Task tool:

```markdown
Task(subagent_type="agent-creation-expert", prompt="Create a new agent for...")
Task(subagent_type="claude-md-manager", prompt="Analyze my CLAUDE.MD")
Task(subagent_type="deep-research-agent", prompt="Research best practices for...")
```

### Verifying Handoffs

After any agent completes, check for handoff documents:

```bash
ls .scratchpad/handoffs/
```

Read the most recent handoff for context:

```bash
cat .scratchpad/handoffs/{latest-handoff}.md
```

## Priority & Overrides

Plugin agents have **lowest priority (4)**. This means:

- Your `~/.claude/agents/` agents take precedence
- Project `.claude/agents/` override plugin agents
- You can customize any agent by creating one with the same name

## Optional: CLAUDE.md Integration

Add this to your project's CLAUDE.md for handoff validation reminders:

```markdown
## Handoff Validation

After ANY agent completes:
1. **Check**: `{PROJECT_DIR}/.scratchpad/handoffs/{agent-name}-*-{SUCCESS|FAIL}.md`
2. **Read**: Extract findings, decisions, and recommendations
3. **Apply**: Use context when planning next steps
4. **Missing?**: Warn user - context may be lost
```

## Updates

```bash
# Update to latest version
/plugin update maheidem-agent-suite
```

## Requirements

- Claude Code v2.0.30+ (for `disallowedTools` support)
- For SubagentStop hooks: v2.0.42+

## License

MIT

## Author

**maheidem** - [GitHub](https://github.com/maheidem)
