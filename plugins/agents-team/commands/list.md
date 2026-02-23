---
name: list
description: "List available team profiles. Usage: /agents-team:list"
---

# List Available Team Profiles

## Step 1: Find Templates

Use **Glob** to find all `.md` files in `${CLAUDE_PLUGIN_ROOT}/teams/`.

## Step 2: Read Each Template

For each file found, read just the YAML frontmatter to extract:
- **name**: Profile name
- **description**: What the team does

## Step 3: Display

Format as a clean table:

```
Available Team Profiles:

| Profile | Description | Agents | Command |
|---------|-------------|--------|---------|
| full-dev | Full stack dev team | 7 agents | /agents-team:start full-dev <request> |
```

If no templates found, tell the user they can create one at `${CLAUDE_PLUGIN_ROOT}/teams/<name>.md`.
