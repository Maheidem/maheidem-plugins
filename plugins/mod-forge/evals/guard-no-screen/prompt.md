---
description: A guard that draws nothing. The agent picks the guard kind and skips the design pass and the mockups.
tags: [positive, guard]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

Make a Claude Code mod named `env-guard`. It denies every Edit or Write to a `.env` file in this project and gives a reason. Use this folder as the trusted folder. I am away, so you cannot ask me. Do not run `mods.py mockups`. Run `mods.py check` once, then stop. If mods.py new fails because of a flag, fix the flag and run it again. Do not try to repair a failing check. Report the last two lines of the check output (the `check:` line and the `next:` line) as they are. Tell me why the mockups do not apply to this mod, and which review you use instead.
