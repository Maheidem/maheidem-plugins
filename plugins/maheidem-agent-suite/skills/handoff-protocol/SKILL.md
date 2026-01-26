---
name: handoff-protocol
description: Standardized handoff document protocol for agent context preservation across multi-agent workflows
version: 1.0.0
---

# Handoff Protocol

This skill documents the standardized handoff protocol used by all agents in the maheidem-agent-suite to preserve context across multi-agent workflows.

## Why Handoffs Matter

1. **Context Preservation**: Orchestrators and future agents get complete task history
2. **Decision History**: Understanding WHY certain choices were made
3. **Error Prevention**: Documenting what worked, what didn't, and edge cases discovered
4. **Continuity**: Next agent has full context without re-investigation

## Handoff File Convention

### Location
```
{PROJECT_DIR}/.scratchpad/handoffs/
```

**Rules:**
- PROJECT_DIR is resolved at task START
- Create directory if missing: `mkdir -p {PROJECT_DIR}/.scratchpad/handoffs/`
- Each project gets its own handoff history

### Naming Pattern
```
{agent-name}-YYYY-MM-DD-HH-mm-SS-{SUCCESS|FAIL}.md
```

**Examples:**
- `agent-creation-expert-2025-10-01-14-30-45-SUCCESS.md`
- `deep-research-agent-2025-10-01-15-22-10-FAIL.md`
- `mcp-manager-agent-2025-10-01-16-45-33-SUCCESS.md`

**Status Rules:**
- `SUCCESS` = Primary objective completed
- `FAIL` = Blocking issues prevented completion (document what WAS accomplished in body)

## Handoff Template

```markdown
---
agent: {agent-name}
project_dir: {CURRENT_WORKING_DIR}
timestamp: YYYY-MM-DD HH:mm:SS
status: SUCCESS|FAIL
task_duration: X minutes
parent_agent: user|{parent-agent-name}
---

## 🎯 Mission Summary
[What task was performed - in one sentence]

## 📊 What Happened
[Detailed account of actions taken, validations performed, results achieved]

## 🧠 Key Decisions & Rationale
[Why certain approaches were chosen, trade-offs considered, alternatives rejected]

## 📁 Files Changed/Created
- /absolute/path/to/file.ext (created|modified|deleted)
- /another/absolute/path/file.md (created)

## ⚠️ Challenges & Solutions
[Problems encountered, how they were resolved, workarounds applied]

## 💡 Important Context for Next Agent
[Critical information the next agent/user needs to know, dependencies, warnings]

## 🔄 Recommended Next Steps
[What should happen next, testing needed, follow-up tasks]

## 📎 Related Context
- Related files in the project
- Dependencies or integration points
- Links to external resources used
```

## Critical Rules for Agents

### MUST DO:
- ✅ Create handoff BEFORE returning control
- ✅ Use ABSOLUTE paths for ALL file references
- ✅ Fill ALL fields with ACTUAL values (no placeholders)
- ✅ Document everything significant that happened
- ✅ Mark SUCCESS only if primary objective completed
- ✅ Mark FAIL if blocking issues occurred (still document what was done)

### MUST NOT:
- ❌ Skip the handoff - it's NOT optional
- ❌ Use placeholder values like "[agent-name]" or "[describe here]"
- ❌ Use relative paths without context
- ❌ Omit challenges or workarounds discovered
- ❌ Assume the next agent knows what you did

## Validating Handoffs

### After ANY Agent Completes:

1. **Check**: Look for file in `{PROJECT_DIR}/.scratchpad/handoffs/`
2. **Read**: Extract findings, decisions, and recommendations
3. **Apply**: Use context when planning next steps
4. **Missing?**: Warn user - context may be lost, consider re-running agent

### Handoff Validation Checklist:
- [ ] File exists in correct location
- [ ] Filename follows naming convention
- [ ] YAML frontmatter is valid
- [ ] All sections are populated
- [ ] Absolute paths are used
- [ ] Status accurately reflects outcome

## Integration with Agent Workflows

### Single Agent Task
```
User Request → Agent Works → Creates Handoff → Returns to User
```

### Multi-Agent Pipeline
```
User Request
    → Agent A Works → Creates Handoff A
    → Agent B Reads Handoff A → Works → Creates Handoff B
    → Agent C Reads Handoffs A+B → Works → Creates Handoff C
    → Returns to User
```

### Orchestrator Pattern
```
User Request → Orchestrator
    → Spawns Agent A → Reads Handoff A
    → Spawns Agent B → Reads Handoff B
    → Orchestrator Synthesizes → Creates Final Handoff
    → Returns to User
```

## Benefits of Following This Protocol

1. **Reproducibility**: Anyone can trace what happened and why
2. **Debugging**: Easy to identify where things went wrong
3. **Knowledge Capture**: Discoveries persist beyond individual sessions
4. **Team Collaboration**: Multiple users can understand agent history
5. **Context Recovery**: Resume work even after context loss
