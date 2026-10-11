---
description: A redesign of an existing pane. The audit of the old pane runs before the new prototype.
tags: [positive, redesign]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

Redesign the pane of the Claude Code mod in `./old-mod`. Keep its data source. Use this folder as the trusted folder. I am away, so you cannot ask me. Run `mods.py audit-existing`, then `mods.py new`, then `mods.py check` once, then stop. If mods.py new fails because of a flag, fix the flag and run it again. Do not try to repair a failing check. Report the last two lines of the check output (the `check:` line and the `next:` line) as they are. Tell me which data source of the old mod the new prototype must keep.
