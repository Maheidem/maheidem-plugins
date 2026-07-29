---
description: Turn orchestrator-mode on/off/pi/wf or show its status for this project
argument-hint: "on | off | pi | wf [--allowed-models m1,m2,...] | status"
allowed-tools: Read, Write
---

You are managing **orchestrator-mode** for the current project. The state lives
in a plain-text file at `.orchestrator-mode.state` (at the project ROOT,
relative to the project root). The file contains a single line: `on`, `off`,
`pi`, or `wf`, optionally followed by ` allowed-models=<m1,m2,...>` (a model
allowlist for delegated agents).

- `on` means the main agent is read-only (only an allowlist of
  read/meta/delegation tools is permitted; everything else, including all MCP
  tools, is denied) and must delegate writes/execution to subagents.
- `pi` means the same read-only restriction PLUS the general delegation escape
  hatch is closed: Task/Agent is denied outright (no subagent target exists
  for this mode). Code changes go through the pi-delegate MCP tools directly
  (`mcp__pi-delegate__pi_task` etc., allowlisted by tool-name prefix) or via
  `/pi-delegate:delegate <task>`, which forwards the task to the local `pi`
  CLI. WebFetch/WebSearch remain available (research isn't a mutation).
- `wf` means the same read-only restriction PLUS the general delegation escape
  hatch is closed down to just the built-in read-only `Explore` scout:
  Task/Agent is only allowed when it targets `Explore`. All other substantive
  delegation must go through the `Workflow` tool (dynamic multi-agent
  workflows), which stays allowlisted -- setting this mode is the user's
  standing opt-in to the Workflow tool for this project.
- absent/`off` means normal behavior.

The requested action is: **$ARGUMENTS** (one of `on`, `off`, `pi`, `wf`,
`status`; if empty or unrecognized, treat it as `status`).

Parse an optional `--allowed-models <m1,m2,...>` flag (also accept
`--allowed-models=<m1,m2,...>`) AFTER the mode argument for `on`, `pi`, and
`wf`. When present, lowercase the comma-separated list, strip whitespace, and
constrain which models delegated agents and workflow scripts may explicitly
request. **When an `allowed-models` restriction is active, omitting the model
is NOT allowed** for delegated Task/Agent calls or `Workflow` `agent()` calls —
every delegated call must explicitly declare a model from the list, or it is
denied. Ignore the flag for `off` and `status`.

IMPORTANT: Do this work YOURSELF in the main thread using the Read and Write
tools. Do NOT delegate the toggle to a subagent, even if an orchestration-mode
reminder tells you to delegate writes. Before writing, determine the ABSOLUTE
project-root path (e.g. via the working directory or `CLAUDE_PROJECT_DIR` if
visible) and use that absolute path when writing `.orchestrator-mode.state`,
rather than a bare relative filename — this ensures the hook's path comparison
is unambiguous regardless of your actual cwd at write time. Writing this file
directly reaches the normal permission prompt even while the lock is active —
approve it when Claude Code asks. This is the only file you may write here.

Steps:

1. **status** -> Read `.orchestrator-mode.state`. The mode is the FIRST
   whitespace-separated token of its trimmed content (lowercased). If the
   file is missing or that token is not `on`, `pi`, or `wf`, report:
   `orchestrator-mode is OFF for this project.` If the token is `on`, report:
   `orchestrator-mode is ON for this project (main agent read-only; subagents
   may write).` If the token is `pi`, report: `orchestrator-mode is
   set to PI for this project (main agent read-only; code changes go through
   the pi-delegate MCP tools or /pi-delegate:delegate).` If the token is
   `wf`, report: `orchestrator-mode is set to WF for this project (main agent
   read-only; orchestrate via the Workflow tool; Task/Agent limited to the
   Explore scout).` If the line also contains an `allowed-models=<list>`
   option, append to the report: ` Model allowlist: <list>.` Do not write
   anything.

2. **on** -> Use the Write tool to write the file `.orchestrator-mode.state`
   with the single line `on` -- or, if `--allowed-models` was given, the
   single line `on allowed-models=<list>` (single space, lowercased
   comma-separated list, e.g. `on allowed-models=opus,haiku`). Then report:
   `orchestrator-mode ENABLED for this project. The main agent is now
   READ-ONLY -- delegate all writes and command execution to subagents via
   the Agent/Task tool.` If an allowlist was set, append: ` Delegated-agent
   model allowlist: <list>.`

3. **off** -> Use the Write tool to write the file `.orchestrator-mode.state`
   with the single line `off` (plain `off` -- this clears everything,
   including any allowed-models option). Then report: `orchestrator-mode
   DISABLED for this project. The main agent has full access again.`

4. **pi** -> Use the Write tool to write the file `.orchestrator-mode.state`
   with the single line `pi` -- or, if `--allowed-models` was given, the
   single line `pi allowed-models=<list>` (single space, lowercased list).
   Then report: `orchestrator-mode set to PI for
   this project. The main agent is now READ-ONLY and cannot delegate to any
   subagent -- code changes go through the pi-delegate MCP tools directly or
   via /pi-delegate:delegate <task>. Run /orchestrator-mode:mode off to
   exit.` If an allowlist was set, append: ` Delegated-agent model allowlist:
   <list>.`

5. **wf** -> Use the Write tool to write the file `.orchestrator-mode.state`
   with the single line `wf` -- or, if `--allowed-models` was given, the
   single line `wf allowed-models=<list>` (single space, lowercased list,
   e.g. `wf allowed-models=opus,sonnet,haiku`). Then report:
   `orchestrator-mode set to WF for
   this project. The main agent is now READ-ONLY and must orchestrate via the
   Workflow tool (dynamic workflows); Task/Agent is only allowed for the
   read-only Explore scout. Run /orchestrator-mode:mode off to exit.` If an
   allowlist was set, append: ` Delegated-agent model allowlist: <list>.`

Report only the single status/result line to the user. Keep it terse.
