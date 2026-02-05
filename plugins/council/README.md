# Council Plugin

🤝 Query multiple AI CLI tools in parallel with READ-ONLY safety enforcement.

## Quick Start

```bash
# First-time setup
/council:setup

# Query your council
/council "What's the best way to structure this React component?"

# Deep dive with debate
/council --thorough "Should I use microservices or monolith?"
```

## Features

- **Parallel Queries**: All AI tools queried simultaneously
- **Claude Synthesis**: Intelligent mediation of diverse opinions
- **Multi-Round Debate**: Thorough mode for complex decisions
- **READ-ONLY Safety**: All tools run in sandbox/query-only modes
- **Flexible Tools**: Auto-detect and configure available AI CLIs

## Supported Tools

| Tool | Support Level | Safety Mode |
|------|---------------|-------------|
| Codex | ✅ Full | `--sandbox read-only` |
| Gemini | ✅ Full | `-p` (prompt-only) |
| OpenCode | ✅ Full | `--format json` |
| Aider | ✅ Limited | `--no-auto-commits` |
| Cursor | ❌ None | No CLI mode |

## Commands

| Command | Description |
|---------|-------------|
| `/council <question>` | Query all enabled tools |
| `/council --thorough <q>` | Multi-round debate mode |
| `/council --tools=a,b <q>` | Query specific tools only |
| `/council:setup` | Configure tools (first-run) |
| `/council:status` | View config, test connectivity |

## Modes

### Quick Mode (Default)
Single round - all tools queried once, Claude synthesizes immediately.

```
/council "Best testing framework for Node.js?"
```

### Thorough Mode
Multi-round debate with cross-examination:

```
/council --thorough "TypeScript vs JavaScript for new project?"
```

## Configuration

Stored at: `~/.claude/council.local.md`

```yaml
enabled_tools:
  codex:
    enabled: true
    timeout: 120
  gemini:
    enabled: true
    timeout: 120

default_mode: quick

thorough_settings:
  max_rounds: 3
```

## Safety

All council queries are **READ-ONLY**:

1. **CLI Flags**: Each tool uses its most restrictive mode
2. **Forbidden Flags**: Dangerous flags blocked at script level
3. **Timeout Protection**: Prevents hanging processes
4. **Injection Detection**: Blocks prompt injection attempts

See `skills/council/references/safety-enforcement.md` for details.

## Example Output

```
┌───────────────────────────────────────────────────────────┐
│  🤝 COUNCIL SYNTHESIS                                     │
│  Mode: quick | Tools: codex, gemini | Time: 4.2s          │
└───────────────────────────────────────────────────────────┘

For testing Node.js applications, **Jest** is the recommended choice.

**Agreement**: Both tools recommend Jest for zero-config setup and
excellent TypeScript support.

**Codex adds**: Consider Vitest for Vite-based projects.
**Gemini adds**: Pair with Supertest for API testing.

<details>
<summary>📜 Raw Response: Codex (2.1s)</summary>
[Full response...]
</details>
```

## Requirements

- At least 2 AI CLI tools installed
- Tools must support non-interactive mode
- Claude Code with skills support

## Installation

This plugin is part of the maheidem-plugins marketplace.

```bash
# Plugin is auto-discovered when marketplace is configured
# Run setup to initialize
/council:setup
```

## Author

maheidem (maheidem@users.noreply.github.com)

## License

MIT
