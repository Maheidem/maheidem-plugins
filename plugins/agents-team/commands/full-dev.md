---
name: full-dev
description: Assemble a 10-agent development team coordinated by the Product Owner. Usage: /agents-team:full-dev <your request>
---

# Full Development Team Assembly

## MANDATORY PROTOCOL — Follow EXACTLY

### The Request

**User wants:** $ARGUMENTS

If no request was provided (empty or blank), ask the user what the team should work on before proceeding. Do NOT create a team without a clear objective.

---

## Phase 1: Create Team

Call **TeamCreate**:
- `team_name`: `full-dev`
- `description`: `Full dev crack-shot team for: $ARGUMENTS`

---

## Phase 2: Read Agent Role Prompts

**Read** the agent roles reference file:
`${CLAUDE_PLUGIN_ROOT}/skills/agents-team/references/agent-roles.md`

This contains the system prompts for all 10 agents. Use these prompts VERBATIM when spawning each agent.

---

## Phase 3: Spawn the Product Owner FIRST

Use **Task** tool:
- `name`: `po`
- `subagent_type`: `general-purpose`
- `team_name`: `full-dev`
- `mode`: `bypassPermissions`
- `prompt`: PO system prompt from agent-roles.md — **append the full user request at the end**

**WAIT** for the PO's response. The PO will message you with:
1. Which specialists to spawn (not all 10 may be needed)
2. Initial task breakdown and assignments

---

## Phase 4: Spawn Requested Specialists

Based on PO's analysis, spawn the requested agents **in parallel** (single message, multiple Task calls):

For each agent:
- `name`: role name from roster below
- `subagent_type`: `general-purpose` (except `research` → `deep-research-agent`)
- `team_name`: `full-dev`
- `mode`: `bypassPermissions`
- `run_in_background`: `true`
- `prompt`: Use the corresponding prompt from agent-roles.md

---

## Phase 5: Activate

Once agents are spawned:
1. **Message PO** via SendMessage: `"All requested agents spawned and ready. Assign tasks."`
2. **Monitor** incoming messages from agents — relay cross-team needs
3. **Report** progress to user periodically

---

## Phase 6: Wrap Up

When PO confirms all work is complete:
1. Compile final results from all agents
2. Send `shutdown_request` to ALL agents
3. Call **TeamDelete** to clean up
4. Present the complete deliverable to the user

---

## RULES

1. **ALL work routes through PO** — never assign tasks directly to specialists
2. **PO decides** who works on what — respect the PO's distribution plan
3. **PO NEVER writes code** — if PO attempts to claim implementation tasks or doesn't request specialists, message PO to remind it to delegate. PO must request AT LEAST ONE specialist.
4. **Spawn only what PO requests** — don't spawn all 10 if only 3 are needed
5. **Agents coordinate** via TaskList and SendMessage — let them self-organize
6. **You are the team lead** — your job is spawning, relaying, and reporting

---

## Agent Roster

| Name | Role | Subagent Type |
|------|------|---------------|
| `po` | Product Owner — coordinator & entry point | general-purpose |
| `architect` | Software Architect — system design & patterns | general-purpose |
| `frontend` | Frontend Developer — UI/UX & client code | general-purpose |
| `backend` | Backend Developer — APIs & server logic | general-purpose |
| `qa` | QA Engineer — testing & quality gates | general-purpose |
| `librarian` | Librarian — docs, knowledge & codebase intel | general-purpose |
| `data-eng` | Data Engineer — data pipelines & modeling | general-purpose |
| `devops` | DevOps Engineer — CI/CD, Docker & infra | general-purpose |
| `security` | Security Specialist — vuln review & hardening | general-purpose |
| `research` | Deep Researcher — web research & tech eval | deep-research-agent |
