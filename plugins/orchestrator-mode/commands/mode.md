---
description: Turn orchestrator-mode on/off/pi/wf or show its status for this project
argument-hint: "on | off | pi | wf | status"
allowed-tools: Read, Write
---

You are managing **orchestrator-mode** for the current project. The state lives
in a plain-text file at `.orchestrator-mode.state` (at the project ROOT,
relative to the project root). The file contains exactly `on`, `off`, `pi`, or
`wf`.

- `on` means the main agent is read-only (only an allowlist of
  read/meta/delegation tools is permitted; everything else, including all MCP
  tools, is denied) and must delegate writes/execution to subagents.
- `pi` means the same read-only restriction PLUS the general delegation escape
  hatch is closed: Task/Agent is only allowed when it targets the exact
  `pi-delegate:delegate` subagent. The only way to get code changes made is
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

IMPORTANT: Do this work YOURSELF in the main thread using the Read and Write
tools. Do NOT delegate the toggle to a subagent, even if an orchestration-mode
reminder tells you to delegate writes. The PreToolUse hook specifically exempts
writes to `.orchestrator-mode.state`, so writing this one file directly is
allowed even while the lock is active. This is the only file you may write here.

Steps:

1. **status** -> Read `.orchestrator-mode.state`. If it is missing or its
   trimmed content is not `on`, `pi`, or `wf`, report: `orchestrator-mode is
   OFF for this project.` If its trimmed content is `on`, report:
   `orchestrator-mode is ON for this project (main agent read-only; subagents
   may write).` If its trimmed content is `pi`, report: `orchestrator-mode is
   set to PI for this project (main agent read-only; only
   /pi-delegate:delegate can make code changes).` If its trimmed content is
   `wf`, report: `orchestrator-mode is set to WF for this project (main agent
   read-only; orchestrate via the Workflow tool; Task/Agent limited to the
   Explore scout).` Do not write anything.

2. **on** -> Use the Write tool to write the file `.orchestrator-mode.state`
   with the single line `on`. Then report: `orchestrator-mode ENABLED for this
   project. The main agent is now READ-ONLY -- delegate all writes and command
   execution to subagents via the Agent/Task tool.`

3. **off** -> Use the Write tool to write the file `.orchestrator-mode.state`
   with the single line `off`. Then report: `orchestrator-mode DISABLED for this
   project. The main agent has full access again.`

4. **pi** -> Use the Write tool to write the file `.orchestrator-mode.state`
   with the single line `pi`. Then report: `orchestrator-mode set to PI for
   this project. The main agent is now READ-ONLY and cannot delegate to any
   subagent except pi-delegate -- use /pi-delegate:delegate <task> to get code
   changes made. Run /orchestrator-mode:mode off to exit.`

5. **wf** -> Use the Write tool to write the file `.orchestrator-mode.state`
   with the single line `wf`. Then report: `orchestrator-mode set to WF for
   this project. The main agent is now READ-ONLY and must orchestrate via the
   Workflow tool (dynamic workflows); Task/Agent is only allowed for the
   read-only Explore scout. Run /orchestrator-mode:mode off to exit.`

Report only the single status/result line to the user. Keep it terse.
