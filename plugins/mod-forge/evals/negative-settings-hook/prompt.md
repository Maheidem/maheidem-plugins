---
description: A settings hook request. The claude-code-mods skill must not load.
tags: [negative]
max_turns: 15
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

Add a PreToolUse hook to the settings of this project (`.claude/settings.json`). It blocks every Bash command that contains `rm -rf` and writes each blocked command to `.claude/blocked.log`.
