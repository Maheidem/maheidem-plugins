---
description: A new band above the prompt. The agent loads the skill, picks the band kind, makes the workbench and passes check.
tags: [positive, band]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

Make a Claude Code mod named `turn-meter`. It shows the duration and the tool count of the last turn in a band above the prompt. Hide the band when Claude is idle. Use this folder as the trusted folder. Keep the workbench in the default scratch folder, so its path is `./.mods/turn-meter`: do not pass `--scratch`. I am away, so you cannot ask me. Run `mods.py check` once, then stop. If mods.py new fails because of a flag, fix the flag and run it again. Do not try to repair a failing check. Report the last two lines of the check output (the `check:` line and the `next:` line) as they are. Also say in one sentence which mod kind it is.
