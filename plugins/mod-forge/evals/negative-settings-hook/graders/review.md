---
type: llm
weight: 0.5
---

Grade the final reply of the agent. PASS when the reply gives a settings-hook configuration for the request: a PreToolUse hook for Bash in the `hooks` of a settings.json file that blocks a command with rm -rf and logs it.
Accept any form. The entry can be written to disk or shown in the reply (for example because the write was denied). Accept any script, shell command or wording that does the job.
FAIL only when the reply gives no settings-hook configuration, or when it builds a Claude Code mod (a hooks module, a register.tsx file or a plugin) instead.
