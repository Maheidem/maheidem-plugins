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

## Phase 2: Read Role Prompts & Discover Available Agents

### Step 2a: Read role prompts
**Read** the agent roles reference file:
`${CLAUDE_PLUGIN_ROOT}/skills/agents-team/references/agent-roles.md`

This contains the system prompts for all 10 agents. Use these prompts VERBATIM when spawning each agent.

### Step 2b: Inventory available agent types
Review the `subagent_type` options listed in your **Task tool description**. These are the agent types you can spawn. Note their names, descriptions, and tool access.

You will use this inventory in Phase 4 to dynamically match roles to the best agent type.

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

## Phase 4: Spawn Requested Specialists (Dynamic Agent Matching)

Based on PO's analysis, spawn the requested agents **in parallel** (single message, multiple Task calls).

### For each agent, determine `subagent_type` dynamically:

1. Check the agent inventory from Step 2b
2. Match the role to the **best available agent type** using the guide below
3. If no specialized match exists, use `general-purpose`
4. **Always include the role-specific prompt from agent-roles.md** regardless of which type is selected

### Agent Matching Guide

For each role, search available agent type names and descriptions for these keywords. Pick the **first match** found; if none match, use the default.

| Role | Search Keywords | Required Capabilities | Default Fallback |
|------|----------------|----------------------|-----------------|
| `architect` | "plan", "architect" | Read, analysis, design | general-purpose |
| `frontend` | "programmer", "frontend", "code" | Read, Write, Edit | general-purpose |
| `backend` | "programmer", "backend", "code" | Read, Write, Edit, Bash | general-purpose |
| `qa` | "programmer", "test", "qa" | Read, Write, Edit, Bash | general-purpose |
| `librarian` | "explore", "docs", "documentation" | Read, Grep, Glob | general-purpose |
| `data-eng` | "data-scientist", "data" | All tools | general-purpose |
| `devops` | "ci-cd", "devops", "deploy" | All tools | general-purpose |
| `security` | "security" | All tools | general-purpose |
| `research` | "research", "deep-research" | Web search, Read | general-purpose |

### IMPORTANT RULES:
- **The role prompt defines behavior** — it tells the agent what to do and how to act
- **The subagent_type determines capabilities** — it controls available tools and base expertise
- A `general-programmer-agent` spawned with the `backend` role prompt becomes a backend specialist with full code editing tools
- A `ci-cd-agent` spawned with the `devops` role prompt gets CI/CD expertise PLUS the team coordination behavior
- **Never use a read-only agent type** (like `Explore` or `Plan`) for roles that need to write code (frontend, backend, qa, data-eng, devops, security)
- **PO is always `general-purpose`** — it needs task management tools, not code tools

### Spawn parameters:
- `name`: role name from roster below
- `subagent_type`: **matched dynamically** (see guide above)
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

| Name | Role | Writes Code? |
|------|------|-------------|
| `po` | Product Owner — coordinator & entry point | No (always `general-purpose`) |
| `architect` | Software Architect — system design & patterns | Sometimes |
| `frontend` | Frontend Developer — UI/UX & client code | Yes |
| `backend` | Backend Developer — APIs & server logic | Yes |
| `qa` | QA Engineer — testing & quality gates | Yes |
| `librarian` | Librarian — docs, knowledge & codebase intel | Sometimes |
| `data-eng` | Data Engineer — data pipelines & modeling | Yes |
| `devops` | DevOps Engineer — CI/CD, Docker & infra | Yes |
| `security` | Security Specialist — vuln review & hardening | Yes |
| `research` | Deep Researcher — web research & tech eval | No |
