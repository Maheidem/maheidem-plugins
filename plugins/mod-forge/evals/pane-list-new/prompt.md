---
description: A new list pane. The agent loads the skill, picks the pane-list kind, makes the workbench and passes check.
tags: [positive, pane-list]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

Make a Claude Code mod named `notes-pane`. It is a docked pane that lists my notes from `.notes/*.md` in this project. I can open a note, delete a note after a confirm, and add a note. Use this folder as the trusted folder. I am away, so you cannot ask me. Run `mods.py check` once, then stop. If mods.py new fails because of a flag, fix the flag and run it again. Do not try to repair a failing check. Report the last two lines of the check output (the `check:` line and the `next:` line) as they are. Also say in one sentence which mod kind it is.
