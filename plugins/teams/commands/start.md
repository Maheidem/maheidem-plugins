---
name: teams:start
description: "Launch a team from a saved template. Usage: /teams:start <profile-name> <your request>"
---

# Start Team from Profile (Simple Launcher)

Your job is to launch a saved team profile quickly, with optional objective text.
Treat this command as a profile reference workflow, not a heavy orchestration framework.

## Parse Arguments

**Raw input:** `$ARGUMENTS`

Interpret as:

- **Profile name**: first token
- **Objective**: everything after profile name (optional)

### Case A: No arguments at all (`$ARGUMENTS` is empty or blank)

1. Use **Glob** to find all `.md` files in `${CLAUDE_PLUGIN_ROOT}/teams/`.
2. Read each file's YAML frontmatter to get `name` and `description`.
3. Use **AskUserQuestion** to let the user pick:
   - Question: "Which team profile do you want to launch?"
   - Header: "Team"
   - Options: one per template found, with label = name and description = template description
   - multiSelect: false
4. After selection, proceed with that profile name.
5. Since no objective was given, launch in standby mode.

### Case B: Profile name given but no objective

Launch in standby mode.

### Case C: Profile and objective provided

Launch team and seed tasks from the objective.

Standby objective text:
`STANDBY MODE: Team is assembled. Check in with team-lead, report ready, then wait for tasks.`

---

## Step 1: Resolve Profile

1. Use **Glob** on `${CLAUDE_PLUGIN_ROOT}/teams/` for `.md` files.
2. Read YAML frontmatter from each file for `name` and `description`.
3. If profile not provided or invalid, ask user to pick one.
4. Load `${CLAUDE_PLUGIN_ROOT}/teams/<profile-name>.md`.

If no profiles exist, tell the user to create `${CLAUDE_PLUGIN_ROOT}/teams/<name>.md`.

---

## Step 2: Parse Template

Template format:

```md
---
name: profile-name
description: What this team does
---

## agent-name
- type: <subagent_type>             (optional)
- model: <sonnet|haiku|opus>        (optional, default: opus)
- background: <true|false>          (optional, default: true)

Agent role/prompt text...
```

Parse each `## <agent-name>` block:

1. **name** = heading text (trimmed, lowercased)
2. **type** = from `- type:` (optional; default `general-purpose`)
3. **model** = from `- model:` (optional; default `opus`)
4. **background** = from `- background:` (optional; default `true`)
5. **prompt** = remaining text in that block

Validation:

- Require at least 1 agent block
- Require unique agent names
- If model is invalid, fallback to `opus`

---

## Step 3: Create Team

Call **TeamCreate**:

- `team_name`: profile name
- `description`: `<template description> : <objective or standby text>`

---

## Step 4: Seed Tasks (Only if Objective Provided)

If standby mode: skip task creation.

If objective provided:

- Create **1-5** high-level **TaskCreate** items from the objective.
- Keep tasks broad and outcome-based.
- Avoid over-slicing.

---

## Step 5: Spawn Profile Agents in Parallel

Spawn all template agents in one message using parallel **Task** calls.

For each agent:

- `name`: parsed agent name
- `subagent_type`: parsed type (or default `general-purpose`)
- `team_name`: `<profile-name>`
- `model`: parsed model (or default `opus`)
- `run_in_background`: parsed background (or default `true`)
- `mode`: `bypassPermissions`
- `prompt`: prefix + template prompt

Use this prefix:

```text
You are {agent-name} on the {team-name} team.

FIRST ACTIONS:
1. Call TaskList and inspect available work.
2. If there is a matching unclaimed task, claim it (TaskUpdate owner + in_progress) and execute.
3. If no matching tasks exist, message team-lead: "{agent-name} ready and standing by."
4. When a task is done, mark it completed and check TaskList again.
5. Escalate blockers quickly to team-lead with concrete unblock requests.

TEAM OBJECTIVE:
{objective-or-standby-text}

YOUR ROLE:
```

Then append the template block prompt.

---

## Step 6: Keep It Lightweight

- Do not introduce extra coordinator agents by default.
- Do not force PO-style governance unless user explicitly asks.
- Prefer short status updates to the user.
- Let profile prompts drive team behavior.

---

## Step 7: Shutdown and Cleanup

When work is complete or user asks to stop:

1. Ask active teammates to shut down.
2. After teammates are no longer active, call **TeamDelete**.
3. Return a concise final summary.

If cleanup fails due to active teammates, report which ones are still running and retry after shutdown.
