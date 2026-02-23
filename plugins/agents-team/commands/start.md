---
name: start
description: "Launch a team from a saved template. Usage: /agents-team:start <profile-name> <your request>"
---

# Start Agent Team from Template

## Parse Arguments

**Raw input:** `$ARGUMENTS`

Split into:
- **Profile name**: First word (e.g., `full-dev`)
- **User request**: Everything after the first word

### Case A: No arguments at all (`$ARGUMENTS` is empty or blank)

1. Use **Glob** to find all `.md` files in `${CLAUDE_PLUGIN_ROOT}/teams/`
2. Read each file's YAML frontmatter to get `name` and `description`
3. Use **AskUserQuestion** to let the user pick:
   - Question: "Which team profile do you want to launch?"
   - Header: "Team"
   - Options: one per template found, with label = name and description = template description
   - multiSelect: false
4. After selection, proceed with that profile name
5. Since no request was given either, go to **Case B** below

### Case B: Profile name given but no request

This is **standby mode**. The team will spin up and wait for instructions.

- Set the user request to: `"STANDBY MODE: Team is assembled and awaiting instructions from team-lead. All agents should check in, report ready status, then wait for task assignments via TaskList."`
- Skip Step 3 (task creation) — the user will create tasks or give instructions after the team is live
- In Step 4, the PO prompt should end with the standby message instead of a specific request

### Case C: Both profile and request provided

Proceed normally with both values.

---

## Step 1: Read the Template

Read the file: `${CLAUDE_PLUGIN_ROOT}/teams/<profile-name>.md`

If not found, show available profiles and ask again.

### Template Format

Templates use this structure:

```
---
name: profile-name
description: What this team does
---

## agent-name
- type: <subagent_type>
- model: <sonnet|haiku|opus> (optional, defaults to sonnet)
- background: <true|false> (optional, defaults to true)

Agent system prompt goes here.
Everything after the metadata lines is the prompt.
```

Parse each `## heading` as an agent definition:
1. **name** = the heading text (lowercased, trimmed)
2. **type** = value from `- type:` line
3. **model** = value from `- model:` line (default: `sonnet`)
4. **background** = value from `- background:` line (default: `true`)
5. **prompt** = all remaining text after the metadata lines

---

## Step 2: Create the Team

Call **TeamCreate**:
- `team_name`: the profile name
- `description`: template description + `: <user request>`

---

## Step 3: Create Tasks from User Request

**If standby mode (Case B):** Skip this step entirely. No tasks to create yet — the user will provide instructions after the team is live.

**Otherwise:** Analyze the user's request and create **TaskCreate** entries for the work to be done. Don't over-slice — keep tasks at a meaningful granularity.

---

## Step 4: Spawn the PO (Always First)

The PO is **always included automatically** - never defined in templates.

Spawn via **Task** tool:
- `name`: `po`
- `subagent_type`: `general-purpose`
- `team_name`: `<profile-name>`
- `model`: `sonnet`
- `run_in_background`: `true`
- `mode`: `bypassPermissions`
- `prompt`: Use the PO prompt below, appending the user's full request at the end.

### PO System Prompt

```
You are the Product Owner (PO) — a CONTEXT DRIFT GUARDIAN.

## YOUR ONLY JOB
Ensure the team delivers exactly what was requested. Nothing more, nothing less.

## YOU NEVER DO
- Write, edit, or create code
- Run bash commands
- Do research or exploration
- Implement anything
- Create files of any kind

## YOU ALWAYS DO
- Read the task list (TaskList) to monitor progress
- Validate completed work matches the original request
- Flag context drift by messaging teammates who go off-track
- Message team-lead when all work is validated

## WORKFLOW
1. Check TaskList to see what tasks exist
2. Assign unassigned tasks to the right teammates (TaskUpdate with owner)
3. Monitor: periodically check TaskList for completed tasks
4. For each completed task: verify the work matches the original request
5. If a teammate drifts from scope, message them: "DRIFT DETECTED: <what drifted> vs <what was requested>"
6. When ALL tasks are completed and validated, message team-lead:
   "ALL WORK VALIDATED. Original request fully satisfied."

## RULES
- You are NOT a doer. You are a validator.
- If you catch yourself wanting to "help" by doing work, STOP. Delegate instead.
- Never mark a task completed yourself — only the agent doing the work marks it done.
- If a task is blocked, message team-lead explaining the blocker.

## THE ORIGINAL REQUEST
```

Then append the user's full request text after this prompt.

**WAIT** for PO's first message before spawning other agents. PO will confirm task assignments.

---

## Step 5: Spawn Template Agents in Parallel

After PO responds, spawn ALL agents from the template **in a single message with parallel Task calls**:

For each agent in the template:
- `name`: agent name from template
- `subagent_type`: type from template
- `team_name`: `<profile-name>`
- `model`: model from template (default sonnet)
- `run_in_background`: background from template (default true)
- `mode`: `bypassPermissions`
- `prompt`: The agent's prompt from the template, with this prefix:

```
You are {agent-name} on the {team-name} team.

FIRST ACTIONS:
1. Call TaskList to see available tasks
2. If tasks exist: claim one matching your role (TaskUpdate with owner: "{agent-name}"), set to in_progress, begin work
3. If NO tasks exist (standby mode): message team-lead "{agent-name} ready and standing by" then WAIT for messages
4. When done with a task, mark completed and check TaskList for more work
5. If no more tasks match your role, message team-lead: "No more tasks for my role."

YOUR ROLE:
```

Then append the template prompt.

---

## Step 6: Monitor and Report

- Relay messages between agents as needed
- Report progress to the user periodically
- When PO confirms all work is validated, proceed to shutdown

---

## Step 7: Shutdown

When PO confirms completion:
1. Compile final summary from task completions
2. Send `shutdown_request` to ALL agents (PO last)
3. Call **TeamDelete** to clean up
4. Present results to the user

---

## RULES

1. **PO validates, never implements** — if PO tries to do work, remind it to delegate
2. **Template agents do the work** — they self-organize via TaskList
3. **You are team-lead** — you spawn, monitor, relay, and report
4. **No scope creep** — only create tasks that serve the user's request
5. **Clean shutdown** — always TeamDelete when done
