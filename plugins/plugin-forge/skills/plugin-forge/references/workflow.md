# Plugin Forge Workflow

Complete 6-phase workflow for creating marketplace plugins.

## Phase 1: Intent Clarification

**Goal**: Understand what the user wants to create

**Actions**:

1. Use AskQuestion tool with options:
   - "Reflect on this session" - Analyze current conversation for patterns
   - "Evaluate past conversations" - Scan session history across all projects
   - "Create something new" - Build from scratch with description

2. If reflecting:
   - Scan conversation for error/retry patterns
   - Identify successful workflows
   - Note tools and skills used effectively
   - Ask: "What aspect of this session should become a plugin?"

3. If evaluating history:
   - Proceed to Phase 1.5 (see `references/history-analysis.md` for full procedure)
   - Run Tier 1 automated scan with session_analyzer.py
   - Present summary, let user choose deep-dive or forge from finding
   - If user chooses to forge → continue to Phase 2 with pre-populated context

4. If creating new:
   - Ask for plugin name (suggest kebab-case)
   - Ask for brief description of purpose
   - Ask for primary command name
   - Ask what problem it solves

**Output**: Clear understanding of plugin purpose and source material

## Phase 2: Marketplace Setup

**Goal**: Determine where to install the plugin

**Config file**: `~/.plugin-forge-config.json`

**Config format**:
```json
{
  "default_marketplace": "/path/to/marketplace",
  "last_used": "2024-01-15",
  "history": ["/previous/path1", "/previous/path2"]
}
```

**Actions**:

1. Read config for `default_marketplace` path:
   ```bash
   python ${CLAUDE_PLUGIN_ROOT}/scripts/config_manager.py get
   ```

2. Present to user with AskQuestion:
   - "Use marketplace at [path]?"
   - Options: "Yes, use this" | "No, specify different path"

3. If new path provided:
   - Validate it's a valid marketplace (has `.claude-plugin/marketplace.json`)
   - Update config with new default:
     ```bash
     python ${CLAUDE_PLUGIN_ROOT}/scripts/config_manager.py set "/new/path"
     ```

4. If no config exists:
   - Ask user for marketplace path
   - Save as new default

**Output**: Confirmed marketplace path for plugin installation

## Phase 3: Conflict Detection

**Goal**: Avoid duplicate or overlapping plugins

**Actions**:

1. Run marketplace scanner script:
   ```bash
   python ${CLAUDE_PLUGIN_ROOT}/scripts/marketplace_scanner.py "${MARKETPLACE_PATH}"
   ```

2. Check for conflicts with proposed name:
   ```bash
   python ${CLAUDE_PLUGIN_ROOT}/scripts/marketplace_scanner.py "${MARKETPLACE_PATH}" check "${PLUGIN_NAME}" "${DESCRIPTION}"
   ```

3. Interpret scanner output:
   - Exit code 0: No conflicts, proceed
   - Exit code 1: Similar plugins found (warning)
   - Exit code 2: Exact name match (conflict)

4. If conflict found, use AskQuestion with options:
   - "Update existing [name]" - Modify the existing plugin
   - "Create new plugin" - Use different name
   - "Merge into existing" - Combine functionality

5. If "Update existing" chosen:
   - Load existing plugin structure
   - Plan modifications rather than new creation

**Output**: Conflict resolution decision and final plugin name

## Phase 4: Plugin Planning

**Goal**: Design the plugin structure before generation

**Actions**:

1. **Invoke skill-creator skill**:
   - Gather concrete examples (from session or user input)
   - Plan SKILL.md structure
   - Ensure description field contains all trigger phrases
   - Follow 6-step skill creation process

2. **Invoke plugin-dev:plugin-structure skill**:
   - Determine required directories (commands/, skills/, scripts/)
   - Plan file layout
   - Identify scripts needed for automation

3. **Invoke plugin-dev:command-development skill** (if commands needed):
   - Design command frontmatter
   - Plan workflow steps
   - Identify user interaction points (AskQuestion)

4. **Invoke plugin-dev:skill-development skill** (if skills needed):
   - Design skill description (trigger-focused)
   - Plan reference documents
   - Ensure under 500 lines

5. **Extract auto-lessons** (if reflecting):
   - Parse session for `Error:` or `Failed:` patterns
   - Identify retry sequences (same operation multiple times)
   - Document what worked (successful tool sequences)
   - See `references/reflection-patterns.md` for detailed patterns

**Output**: Complete plugin design ready for generation

## Phase 5: Generation & Registration

**Goal**: Create all files and register plugin

**Actions**:

1. Create directory structure:
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
   │           └── {reference}.md
   └── scripts/
       └── {script}.py (if needed)
   ```

2. Generate plugin.json (minimal):
   ```json
   {
     "name": "{plugin-name}",
     "version": "1.0.0",
     "description": "{brief description}"
   }
   ```

3. Generate SKILL.md with:
   - Comprehensive description in frontmatter (all triggers)
   - Concise body (<500 lines)
   - References to detailed procedures

4. Generate command files with:
   - YAML frontmatter (name, description)
   - Clear workflow phases
   - Script invocations using `${CLAUDE_PLUGIN_ROOT}`

5. Generate reference documents with:
   - Detailed procedures
   - Examples and patterns
   - Edge case handling

6. Generate scripts with:
   - Clear docstrings
   - CLI interface (`if __name__ == "__main__"`)
   - Error handling

7. Update marketplace.json:
   ```json
   {
     "name": "{plugin-name}",
     "description": "{description}",
     "version": "1.0.0",
     "author": {
       "name": "{author}",
       "email": "{email}"
     },
     "source": "./plugins/{plugin-name}",
     "category": "{category}"
   }
   ```

8. Report completion:
   - List all created files with paths
   - Confirm marketplace registration
   - Suggest testing: "Try `/forge` or mention trigger phrases"

**Output**: Complete plugin installed and registered

## Phase 6: Git Commit & Push (Optional)

**Goal**: Version control the new plugin

**Actions**:

1. Use AskQuestion to confirm git operations:
   - "Would you like to commit and push the new plugin?"
   - Options: "Yes, commit and push" | "Just commit locally" | "No, skip git"

2. If user declines, skip this phase entirely

3. If committing:
   - Stage new plugin files:
     ```bash
     git add "${MARKETPLACE_PATH}/plugins/{plugin-name}/"
     git add "${MARKETPLACE_PATH}/.claude-plugin/marketplace.json"
     ```

   - Create descriptive commit:
     ```bash
     git commit -m "feat(plugin-forge): add {plugin-name} plugin

     - Created by plugin-forge from {session reflection|scratch}
     - Commands: {command-list}
     - Skills: {skill-list}

     Co-Authored-By: Claude <noreply@anthropic.com>"
     ```

4. If pushing:
   - Confirm current branch
   - Push to remote:
     ```bash
     git push origin HEAD
     ```

5. Report git status:
   - Commit hash
   - Branch name
   - Push result (if applicable)

**Output**: Plugin committed and optionally pushed to remote

## Error Handling

### Common Issues

1. **Invalid marketplace path**
   - Symptom: Scanner returns error
   - Solution: Ask user for correct path, validate before saving

2. **Conflict with existing plugin**
   - Symptom: Scanner exit code 2
   - Solution: Offer update/rename/merge options

3. **Permission denied on file creation**
   - Symptom: Write fails
   - Solution: Report error, suggest checking permissions

4. **Git operations fail**
   - Symptom: Commit or push error
   - Solution: Report error, suggest manual git operations

### Recovery

If any phase fails:
1. Report what was completed
2. Report what failed
3. Suggest manual steps to complete
4. Do not leave partial state (clean up if possible)
