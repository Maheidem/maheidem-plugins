---
name: agent-handoff
description: >
  Creates standardized handoff documents when agents complete tasks.
  USE THIS SKILL when (1) finishing any agent task successfully,
  (2) encountering blocking issues that prevent completion,
  (3) making significant progress worth documenting, or
  (4) transferring work to another agent.
  Triggered by agents with skills agent-handoff in their frontmatter.
  Provides file location, naming convention, and template structure
  for context preservation across agent executions.
---

# Agent Handoff Protocol

**Create a handoff document BEFORE completing your task.**

## Location & Naming

**Directory**: `{CURRENT_WORKING_DIR}/.scratchpad/handoffs/`
- Resolve `{CURRENT_WORKING_DIR}` at task START
- Create if needed: `mkdir -p .scratchpad/handoffs/`

**Filename**: `{agent-name}-YYYY-MM-DD-HH-mm-SS-{SUCCESS|FAIL}.md`

**Status**:
- **SUCCESS**: Primary objective completed
- **FAIL**: Blocking issues (document what WAS accomplished)

## Template

```markdown
---
agent: {your-agent-name}
project_dir: {CURRENT_WORKING_DIR}
timestamp: YYYY-MM-DD HH:mm:SS
status: SUCCESS|FAIL
task_duration: {X} minutes
parent_agent: {calling-agent or "user"}
---

## Mission Summary
[One sentence: What task, what outcome?]

## What Happened
[Actions taken, decisions made, challenges encountered]

## Key Decisions & Rationale
[Why this approach? What alternatives considered?]

## Files Changed/Created
- path/to/file.ext (created|modified|deleted) - description
[Use project-relative paths]

## Domain-Specific Details
[Agent-specialty information:]
- Research: Sources, queries, findings
- CI/CD: Pipeline status, deployments, tests
- Code: Functions modified, architecture, coverage
- Data: Models, statistics, validation

## Challenges & Solutions
[Problems and resolutions/workarounds]

## Context for Next Agent
[Critical information successors MUST know]

## Recommended Next Steps
[Specific actionable recommendations]

## Related Context
- Related files/dependencies
- Version notes
- External resources
```

## Rules

**DO**:
- Create handoff BEFORE returning control
- Use project-relative paths
- Include specific details, not vague summaries
- Document both successes and failures

**DON'T**:
- Skip handoff - it's MANDATORY
- Use placeholder text
- Omit "obvious" context
