---
description: Turn orchestrator-mode on/off or show its status for this project
argument-hint: "on | off | status"
allowed-tools: Read, Write
---

You are managing **orchestrator-mode** for the current project. The state lives
in a plain-text file at `.orchestrator-mode.state` (at the project ROOT,
relative to the project root). The file contains exactly `on` or `off`. ON
means the main agent is read-only (only an allowlist of read/meta/delegation
tools is permitted; everything else, including all MCP tools, is denied) and
must delegate writes/execution to subagents; absent/`off` means normal behavior.

The requested action is: **$ARGUMENTS** (one of `on`, `off`, `status`; if empty
or unrecognized, treat it as `status`).

IMPORTANT: Do this work YOURSELF in the main thread using the Read and Write
tools. Do NOT delegate the toggle to a subagent, even if an orchestration-mode
reminder tells you to delegate writes. The PreToolUse hook specifically exempts
writes to `.orchestrator-mode.state`, so writing this one file directly is
allowed even while the lock is active. This is the only file you may write here.

Steps:

1. **status** -> Read `.orchestrator-mode.state`. If it is missing or its
   trimmed content is not `on`, report: `orchestrator-mode is OFF for this
   project.` If its trimmed content is `on`, report: `orchestrator-mode is ON
   for this project (main agent read-only; subagents may write).` Do not write
   anything.

2. **on** -> Use the Write tool to write the file `.orchestrator-mode.state`
   with the single line `on`. Then report: `orchestrator-mode ENABLED for this
   project. The main agent is now READ-ONLY -- delegate all writes and command
   execution to subagents via the Agent/Task tool.`

3. **off** -> Use the Write tool to write the file `.orchestrator-mode.state`
   with the single line `off`. Then report: `orchestrator-mode DISABLED for this
   project. The main agent has full access again.`

Report only the single status/result line to the user. Keep it terse.
