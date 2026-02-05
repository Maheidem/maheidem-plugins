---
name: council
description: |
  Query multiple AI CLI tools (codex, gemini, opencode, aider) in parallel with READ-ONLY safety.
  Use when: (1) user says "consult the council" or "ask the council", (2) user wants multiple AI opinions,
  (3) user says "what would codex/gemini say", (4) user wants AI debate or consensus,
  (5) user says "get a second opinion", (6) user wants to compare AI responses,
  (7) user mentions "AI council" or "expert panel".
---

# Council Skill

Query your AI council - multiple AI CLI tools in parallel with automatic synthesis.

## Quick Usage

```
/council:debate "What's the best way to structure this React component?"
/council:debate --thorough "Should I use microservices or monolith?"
/council:debate --tools=codex,gemini "How do I optimize this query?"
```

## Available Commands

| Command | Description |
|---------|-------------|
| `/council:debate <question>` | Query all enabled tools, get synthesis |
| `/council:debate --thorough <q>` | Multi-round debate mode |
| `/council:setup` | Configure which AI tools to use |
| `/council:status` | View config, test connectivity |
| `/council:personas <use-case>` | Generate custom personas for a domain |
| `/council:personas:list` | View active personas and their scope |

## How It Works

1. **Parallel Task Agents**: Claude spawns one Task agent per CLI tool (true parallelism)
2. **READ-ONLY Safety**: Tools run in sandbox/query-only modes - no file modifications
3. **Long Timeout**: Default 300 seconds (5 minutes) per tool for complex queries
4. **Synthesis**: Claude mediates and combines the best insights
5. **Raw Access**: Full tool responses available in collapsible sections

## Supported Tools

| Tool | Status | Mode |
|------|--------|------|
| `codex` | ✅ Full Support | `--sandbox read-only` |
| `gemini` | ✅ Full Support | `-p` query mode |
| `opencode` | ✅ Full Support | `--format json` |
| `aider` | ✅ Limited | `--no-auto-commits` |
| `cursor` | ❌ Not Supported | No CLI mode |

## Modes

### Quick Mode (Default)
Single round - all tools queried once, Claude synthesizes immediately.
Best for straightforward questions with likely consensus.

### Thorough Mode (`--thorough`)
Multi-round debate:
1. Initial responses from all tools
2. Cross-examination rounds (tools respond to each other)
3. Convergence detection
4. Comprehensive synthesis

Best for complex decisions, architectural choices, or contentious topics.

## Custom Personas

Each AI tool has a configurable "persona" that defines its role and expertise.

### Persona Precedence
1. **📂 Project-local**: `.claude/council-personas/<tool>.persona.md`
2. **👤 User-wide**: `~/.claude/council-personas/<tool>.persona.md`
3. **🔧 Default**: Plugin bundled personas

### Generating Custom Personas
```
/council:personas "Frontend React with accessibility focus"
/council:personas "ML pipeline optimization"
/council:personas "DevOps infrastructure"
```

This generates specialized personas tailored to your domain, making council responses more relevant.

### Viewing Active Personas
```
/council:personas:list
```

Shows which personas are active and their scope (project/user/default).

## Safety

All council queries are **READ-ONLY**:
- No file modifications
- No dangerous flags allowed
- Timeout protection
- Injection detection

See `@references/safety-enforcement.md` for complete safety documentation.

## First-Time Setup

Run `/council:setup` to:
1. Detect available AI CLI tools
2. Select which tools to enable
3. Test connectivity
4. Create configuration

Configuration stored at: `~/.claude/council.local.md`

## Configuration Locations

| Type | Path | Purpose |
|------|------|---------|
| Council config | `~/.claude/council.local.md` | Enabled tools, settings |
| User personas | `~/.claude/council-personas/` | Custom personas (all projects) |
| Project personas | `.claude/council-personas/` | Custom personas (this project) |
| Default personas | `<plugin>/personas/` | Bundled default personas |
