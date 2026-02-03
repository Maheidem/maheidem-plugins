---
description: Disable agentic-only mode for this project
allowed-tools: Read, Edit
---

Disable agentic mode to restore full direct tool access in the main session.

## Workflow

1. **Check for configuration file**
   - Look for `.claude/agentic-mode.local.md` in current project
   - If not found, inform user: "Agentic mode is not configured for this project"

2. **Read existing configuration**
   - Extract current YAML frontmatter
   - Check current `enabled` value

3. **Update configuration**
   - Set `enabled: false` in YAML frontmatter
   - Preserve all other settings (blocked_tools, agent_suggestions)
   - Keep file content intact (only modify YAML)

4. **Confirm deactivation**
   - Display success message with:
     - Path to config file
     - Note that settings are preserved
     - How to re-enable: `/project:agentic:enable`

## YAML Update Logic

**Before:**
```yaml
---
enabled: true
blocked_tools:
  - Edit
  - Write
---
```

**After:**
```yaml
---
enabled: false
blocked_tools:
  - Edit
  - Write
---
```

## Error Handling

**If no config exists:**
- Report: "Agentic mode is not configured for this project"
- Suggest: "To enable, run: /project:agentic:enable"
- STOP execution (no error, just info)

**If config read fails:**
- Report: "Cannot read config file at .claude/agentic-mode.local.md"
- Suggest: "Check file permissions"
- STOP execution

**If config write fails:**
- Report: Specific error message
- Suggest: "Verify file permissions and disk space"
- STOP execution

**If already disabled:**
- Report: "Agentic mode is already disabled"
- Show: Current config path
- STOP execution (no changes needed)

## Expected Output

**Success message:**
```
✓ Agentic mode DISABLED for this project

Configuration preserved at: /path/to/project/.claude/agentic-mode.local.md

Direct tool access restored in main session. You can now use:
  - Edit
  - Write
  - Bash
  - NotebookEdit
  - All other tools directly

Your blocking preferences are saved. To re-enable with same settings:
  /project:agentic:enable

To check current status:
  /project:agentic:status
```

**Already disabled:**
```
ℹ Agentic mode is already disabled

Config: /path/to/project/.claude/agentic-mode.local.md
Status: enabled = false

To enable: /project:agentic:enable
```

**Not configured:**
```
ℹ Agentic mode is not configured for this project

No config file found at: .claude/agentic-mode.local.md

To set up agentic mode: /project:agentic:enable
```

## Requirements

- DO NOT delete config file (only disable)
- Preserve all YAML frontmatter fields
- Preserve file content below frontmatter
- Only modify `enabled` field value
- Use Edit tool to update (not Write, to preserve content)
