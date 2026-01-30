---
name: forge
description: "Forge a new plugin from your current session or from scratch"
---

# /forge - Plugin Forge

Create or update marketplace plugins from conversations and workflows.

## Dependencies

This command orchestrates these core skills:
1. **skill-creator** - For SKILL.md design and skill packaging
2. **plugin-dev:plugin-structure** - For plugin directory layout
3. **plugin-dev:skill-development** - For skill file generation
4. **plugin-dev:command-development** - For command file generation

## Workflow

### Phase 1: Intent Clarification

Use AskQuestion to determine user intent:
- **Options**: "Reflect on this session" | "Create something new"
- If **reflect**: Analyze current session transcript for patterns, lessons, reusable workflows
- If **new**: Ask for plugin description/purpose

Follow-up questions based on choice:
- For reflection: "What aspect of this session should become a plugin?"
- For new: "What should this plugin do? Give a brief description."

### Phase 2: Marketplace Setup

1. Check `~/.plugin-forge-config.json` for saved default marketplace path
2. Run: `python ${CLAUDE_PLUGIN_ROOT}/scripts/config_manager.py get`
3. Use AskQuestion: "Use marketplace at [saved path]?" with options:
   - "Yes, use this marketplace"
   - "No, specify a different path"
4. If user provides new path, update the config:
   ```bash
   python ${CLAUDE_PLUGIN_ROOT}/scripts/config_manager.py set "<new_path>"
   ```

### Phase 3: Conflict Detection

1. Run marketplace scanner to list existing plugins:
   ```bash
   python ${CLAUDE_PLUGIN_ROOT}/scripts/marketplace_scanner.py "<marketplace_path>"
   ```

2. Check for conflicts with proposed plugin name:
   ```bash
   python ${CLAUDE_PLUGIN_ROOT}/scripts/marketplace_scanner.py "<marketplace_path>" check "<plugin_name>" "<description>"
   ```

3. If similar plugin found, use AskQuestion:
   - **Options**: "Update existing plugin" | "Create new plugin with different name" | "Merge functionality into existing"

### Phase 4: Plugin Planning

1. **Load skill-creator skill** for SKILL.md design:
   - Follow 6-step skill creation process
   - Ensure description contains ALL trigger phrases

2. **Load plugin-dev:plugin-structure skill** for standard directory layout:
   - Determine required components (commands, skills, scripts)
   - Plan file structure

3. If reflecting on session, extract lessons using `references/reflection-patterns.md`:
   - Errors encountered -> "Don't do X because..."
   - Retries/fixes -> "Do Y instead of Z"
   - Successful patterns -> "Best practice: ..."
   - Edge cases handled -> "Watch out for..."

### Phase 5: Generation & Registration

1. Create plugin directory structure:
   ```
   ${MARKETPLACE_PATH}/plugins/{plugin-name}/
   ├── .claude-plugin/
   │   └── plugin.json
   ├── commands/
   │   └── {command}.md
   ├── skills/
   │   └── {skill-name}/
   │       ├── SKILL.md
   │       └── references/
   └── scripts/ (if needed)
   ```

2. Generate all files using `${CLAUDE_PLUGIN_ROOT}` for internal paths

3. Update marketplace.json with new plugin entry:
   ```json
   {
     "name": "{plugin-name}",
     "description": "{description}",
     "version": "1.0.0",
     "author": { "name": "{author}", "email": "{email}" },
     "source": "./plugins/{plugin-name}",
     "category": "{category}"
   }
   ```

4. Report completion with created files summary

### Phase 6: Git Commit & Push (Optional)

Use AskQuestion: "Would you like to commit and push the new plugin?"
- **Options**: "Yes, commit and push" | "Just commit locally" | "No, skip git operations"

If user chooses to commit:
1. Stage all new plugin files:
   ```bash
   git add "${MARKETPLACE_PATH}/plugins/{plugin-name}/"
   git add "${MARKETPLACE_PATH}/.claude-plugin/marketplace.json"
   ```

2. Create commit with descriptive message:
   ```bash
   git commit -m "feat(plugin-forge): add {plugin-name} plugin

   - Created by plugin-forge from {session/scratch}
   - Commands: {list}
   - Skills: {list}

   Co-Authored-By: Claude <noreply@anthropic.com>"
   ```

3. If push requested:
   ```bash
   git push origin HEAD
   ```

## Important Rules

- **No hardcoded paths** - Always use `${CLAUDE_PLUGIN_ROOT}` for plugin-internal paths
- **kebab-case naming** - For all directories and files
- **Minimal manifests** - Only required fields in plugin.json (name, version, description)
- **No README in skills** - Only SKILL.md and references/
- **Description as trigger** - Put all "when to use" info in SKILL.md frontmatter description
- **Under 500 lines** - Keep SKILL.md body concise, put details in references/
