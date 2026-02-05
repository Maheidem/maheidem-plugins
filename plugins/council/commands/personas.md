---
description: Generate custom council personas tailored to your use case
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - AskUserQuestion
  - mcp__sequentialthinking__sequentialthinking
arguments:
  - name: use_case
    description: "Use case description (e.g., 'Frontend React with accessibility focus')"
    required: false
---

# Council Personas Generator

Generate custom AI council personas tailored to a specific use case or domain.

## Workflow

### Step 1: Gather Information

<details>
<summary>📋 Read Council Configuration</summary>

First, read the council configuration to know which tools are enabled:

```bash
cat ~/.claude/council.local.md 2>/dev/null || echo "No config found - using defaults"
```

Default tools if no config: `codex`, `gemini`, `opencode`, `agent`

</details>

### Step 2: Define Use Case

If `${use_case}` argument is provided, use it directly. Otherwise, ask the user:

**Ask the user**: "What type of project or domain are these personas for?"

Example use cases:
- "Frontend React with TypeScript and accessibility focus"
- "Machine learning pipeline optimization"
- "Backend API design with microservices"
- "DevOps and infrastructure automation"
- "Mobile app development (React Native)"

### Step 3: Generate Personas

Use `mcp__sequentialthinking__sequentialthinking` to design personas that:

1. **Maintain base tool strengths** (implementation, research, architecture, UX)
2. **Specialize for the use case** (domain-specific expertise)
3. **Create complementary roles** (no overlap, full coverage)
4. **Include actionable guidelines** (specific to the domain)

**For each enabled tool, generate:**
- `role`: Domain-specific role title (e.g., "REACT COMPONENT ARCHITECT")
- `context`: How this expertise applies to the use case
- `response_guidelines`: 4 specific guidelines for this domain

### Step 4: Preview & Confirm

Display the generated personas in a table format:

```
🎭 Generated Council Personas for: [USE CASE]

┌──────────┬────────────────────────────────────────┐
│ Tool     │ Role                                   │
├──────────┼────────────────────────────────────────┤
│ codex    │ REACT COMPONENT ARCHITECT              │
│ gemini   │ A11Y STANDARDS RESEARCHER              │
│ opencode │ STATE MANAGEMENT PATTERNS EXPERT       │
│ agent    │ USER INTERACTION FLOW DESIGNER         │
└──────────┴────────────────────────────────────────┘
```

**Show a preview** of each persona's guidelines.

### Step 5: Choose Scope

**Ask the user using AskUserQuestion:**

"Where should these personas be saved?"

Options:
1. **📂 Project-local** (`.claude/council-personas/`) - Only this project
2. **👤 User-wide** (`~/.claude/council-personas/`) - All your projects

### Step 6: Write Persona Files

Create the personas directory and write files:

**Project-local:**
```bash
mkdir -p "${CWD}/.claude/council-personas"
```

**User-wide:**
```bash
mkdir -p ~/.claude/council-personas
```

**Persona file format:**
```yaml
---
tool: <tool_name>
name: "<Display Name>"
role: "<SPECIALIZED ROLE TITLE>"
context: "<Domain-specific context explaining expertise>"
response_guidelines:
  - "<Specific guideline 1>"
  - "<Specific guideline 2>"
  - "<Specific guideline 3>"
  - "<Specific guideline 4>"
created_by: "user"
use_case: "<use_case_description>"
---

# <Tool Name> Persona

You are <Name>, a **<ROLE>**, participating in a multi-AI council consultation.

## Context
<context paragraph>

## Response Guidelines
- <guideline 1>
- <guideline 2>
- <guideline 3>
- <guideline 4>
```

### Step 7: Confirmation

Display success message:

```
✅ Custom personas created for: [USE CASE]

📂 Location: [path]

Use `/council:personas:list` to view active personas.
Use `/council "your question"` to try them out!
```

## Example Session

```
User: /council:personas "Frontend accessibility"

Claude: I'll generate specialized personas for frontend accessibility work.

🎭 Generated Council Personas for: Frontend Accessibility

┌──────────┬────────────────────────────────────────┐
│ Tool     │ Role                                   │
├──────────┼────────────────────────────────────────┤
│ codex    │ ARIA IMPLEMENTATION SPECIALIST         │
│ gemini   │ WCAG COMPLIANCE RESEARCHER             │
│ opencode │ ACCESSIBLE COMPONENT PATTERNS EXPERT   │
│ agent    │ ASSISTIVE TECHNOLOGY UX ADVOCATE       │
└──────────┴────────────────────────────────────────┘

Where should these personas be saved?
[ ] 📂 Project-local (only this project)
[ ] 👤 User-wide (all projects)

User: Project-local

Claude: ✅ Custom personas created!
📂 Location: .claude/council-personas/
```

## Safety Notes

- Persona files are validated before use
- Forbidden flags (--yolo, etc.) are rejected
- Max file size: 10KB per persona
- Generated personas maintain READ-ONLY safety requirements
