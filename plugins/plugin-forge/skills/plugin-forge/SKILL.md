---
name: plugin-forge
description: |
  Create or update marketplace plugins from conversations and workflows.
  Use when: (1) "forge a plugin" or "package this", (2) "create a skill/plugin from this",
  (3) "make this reusable" or "save this workflow", (4) "turn this into a command",
  (5) creating something that should persist across sessions. Handles marketplace
  registration, conflict detection, and lesson extraction automatically.
---

# Plugin Forge Skill

Creates new marketplace plugins by reflecting on sessions or building from scratch.

## Quick Reference

- **Workflow**: See `references/workflow.md` for complete 6-phase process
- **Lesson Extraction**: See `references/reflection-patterns.md` for session analysis
- **Config**: `~/.plugin-forge-config.json` stores default marketplace
- **Scripts**: `${CLAUDE_PLUGIN_ROOT}/scripts/` contains config_manager.py and marketplace_scanner.py

## Core Workflow Overview

Execute the 6-phase workflow:

1. **Intent Clarification** - Determine reflect vs create new
2. **Marketplace Setup** - Configure target marketplace path
3. **Conflict Detection** - Scan for existing similar plugins
4. **Plugin Planning** - Design structure using skill-creator and plugin-dev skills
5. **Generation** - Create all files and register in marketplace
6. **Version Bump + Git Commit & Push** - Automatic semantic versioning + optional version control

## Key Operations

### Intent Detection

When triggered, determine if user wants to:
- **Reflect**: Extract patterns from current session
- **Create new**: Build plugin from description

Use AskQuestion with clear options to confirm intent.

### Marketplace Management

Config stored at: `~/.plugin-forge-config.json`

```bash
# Get current default
python ${CLAUDE_PLUGIN_ROOT}/scripts/config_manager.py get

# Set new default
python ${CLAUDE_PLUGIN_ROOT}/scripts/config_manager.py set "/path/to/marketplace"

# View history
python ${CLAUDE_PLUGIN_ROOT}/scripts/config_manager.py history
```

Always confirm marketplace path with user before proceeding.

### Conflict Resolution

```bash
# List all plugins
python ${CLAUDE_PLUGIN_ROOT}/scripts/marketplace_scanner.py "/path/to/marketplace"

# Check for conflicts
python ${CLAUDE_PLUGIN_ROOT}/scripts/marketplace_scanner.py "/path/to/marketplace" check "plugin-name" "description"
```

Present options if similar plugin exists:
- Update existing plugin
- Create new with different name
- Merge functionality

### Plugin Generation

Invoke these skills in order:

1. **skill-creator** - Design SKILL.md with proper frontmatter
   - Ensure description contains ALL trigger phrases
   - Keep body under 500 lines

2. **plugin-dev:plugin-structure** - Create directory layout
   - Standard structure with .claude-plugin/, commands/, skills/, scripts/

3. **plugin-dev:command-development** - Generate command files
   - YAML frontmatter with name and description
   - Markdown body with workflow steps

4. **plugin-dev:skill-development** - Generate skill files
   - SKILL.md with comprehensive description
   - Reference files for detailed procedures

### Lesson Extraction

When reflecting on a session, analyze for:

| Pattern | Look For | Extract As |
|---------|----------|------------|
| Errors | "Error:", "Failed:", exceptions | "DON'T: X BECAUSE: Y" |
| Retries | Same operation multiple times | "BEST PRACTICE: final approach" |
| Successes | Positive feedback, completed workflows | Reusable workflow steps |
| Edge Cases | Special handling, platform-specific | "WATCH OUT: condition" |

See `references/reflection-patterns.md` for detailed extraction patterns.

## Output Structure

Created plugin includes:

```
plugins/{plugin-name}/
├── .claude-plugin/
│   └── plugin.json          # Minimal: name, version, description
├── commands/
│   └── {command}.md         # YAML frontmatter + workflow steps
├── skills/
│   └── {skill-name}/
│       ├── SKILL.md         # Description-as-trigger pattern
│       └── references/      # Detailed procedures
└── scripts/                 # Helper utilities (if needed)
```

## Critical Rules

1. **Description is the trigger** - All "when to use" goes in SKILL.md frontmatter description
2. **Use ${CLAUDE_PLUGIN_ROOT}** - Never hardcode paths in markdown files
3. **kebab-case everywhere** - Directory names, file names, plugin names
4. **Minimal manifests** - Only required fields in plugin.json
5. **No README files** - Only SKILL.md for skills, command.md for commands
6. **Under 500 lines** - Keep SKILL.md body concise, use references/ for details
7. **Always confirm with user** - Use AskQuestion for key decisions
