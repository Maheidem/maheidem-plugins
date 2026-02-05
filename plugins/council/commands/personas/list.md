---
description: Display active council personas with their scope and configuration
allowed-tools:
  - Read
  - Bash
  - Glob
---

# List Council Personas

Display all active council personas, showing which scope (project/user/default) each one comes from.

## Workflow

### Step 1: Detect Paths

```bash
# Plugin root for default personas
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"

# User-wide personas
USER_PERSONAS="${HOME}/.claude/council-personas"

# Project-local personas (current working directory)
PROJECT_PERSONAS="${CWD}/.claude/council-personas"
```

### Step 2: Read Council Config

Get the list of enabled tools from council configuration:

```bash
# Read enabled tools from config
CONFIG_FILE="${HOME}/.claude/council.local.md"
```

Default tools if no config: `codex`, `gemini`, `opencode`, `agent`

### Step 3: Build Persona Table

For each enabled tool, determine which persona file is active (using precedence):

1. Check `${PROJECT_PERSONAS}/<tool>.persona.md` (📂 project)
2. Check `${USER_PERSONAS}/<tool>.persona.md` (👤 user)
3. Check `${PLUGIN_ROOT}/personas/<tool>.persona.md` (🔧 default)
4. Fallback to generic (⚠️ fallback)

**Extract from each persona file:**
- `role` - From YAML frontmatter
- `use_case` - From YAML frontmatter (if present)

### Step 4: Display Table

Output a formatted table:

```
🎭 Active Council Personas

┌──────────┬────────────────┬──────────────────────────────────┬────────────────┐
│ Tool     │ Scope          │ Role                             │ Use Case       │
├──────────┼────────────────┼──────────────────────────────────┼────────────────┤
│ codex    │ 📂 project     │ FRONTEND ACCESSIBILITY EXPERT    │ React + a11y   │
│ gemini   │ 👤 user        │ RESEARCH & DOCS SPECIALIST       │ general        │
│ opencode │ 🔧 default     │ ARCHITECTURE & PATTERNS ANALYST  │ general        │
│ agent    │ 🔧 default     │ UX & WORKFLOW ADVOCATE           │ general        │
└──────────┴────────────────┴──────────────────────────────────┴────────────────┘

Legend:
  📂 project  = .claude/council-personas/ (this project only)
  👤 user     = ~/.claude/council-personas/ (all your projects)
  🔧 default  = Plugin default personas
  ⚠️ fallback = No persona file found, using generic
```

### Step 5: Show Paths

Display the persona file paths being used:

```
📁 Persona Paths:
  Project: .claude/council-personas/
  User:    ~/.claude/council-personas/
  Default: <plugin>/personas/
```

### Step 6: Customization Tips

```
💡 Tips:
  • Create custom personas: /council:personas "your use case"
  • Project personas override user personas
  • User personas override defaults
  • Edit persona files directly for fine-tuning
```

## Example Output

```
🎭 Active Council Personas

┌──────────┬────────────────┬────────────────────────────────────┬────────────────┐
│ Tool     │ Scope          │ Role                               │ Use Case       │
├──────────┼────────────────┼────────────────────────────────────┼────────────────┤
│ codex    │ 📂 project     │ ARIA IMPLEMENTATION SPECIALIST     │ A11y Focus     │
│ gemini   │ 📂 project     │ WCAG COMPLIANCE RESEARCHER         │ A11y Focus     │
│ opencode │ 🔧 default     │ ARCHITECTURE & PATTERNS ANALYST    │ general        │
│ agent    │ 🔧 default     │ USER EXPERIENCE & WORKFLOW ADVOCATE│ general        │
└──────────┴────────────────┴────────────────────────────────────┴────────────────┘

📁 Persona Paths:
  Project: /path/to/project/.claude/council-personas/ (2 files)
  User:    ~/.claude/council-personas/ (empty)
  Default: <plugin>/personas/ (5 files)

💡 To customize: /council:personas "your domain focus"
```

## Implementation Notes

To parse persona files, use:

```bash
# Extract role from YAML frontmatter
grep "^role:" file.persona.md | sed 's/^role:[[:space:]]*//' | sed 's/^"//' | sed 's/"$//'

# Extract use_case from YAML frontmatter
grep "^use_case:" file.persona.md | sed 's/^use_case:[[:space:]]*//' | sed 's/^"//' | sed 's/"$//'
```

When displaying, ensure:
- Truncate long roles to fit table width (max ~35 chars)
- Show "general" for use_case if not specified
- Handle missing directories gracefully
