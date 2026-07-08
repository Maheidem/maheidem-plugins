---
description: Forward a coding task to the local pi CLI via the pi-delegate subagent
argument-hint: "<task description>"
allowed-tools: Agent
---

Invoke the `delegate` subagent via the `Agent` tool (`subagent_type: "pi-delegate:delegate"`), passing the raw task text as its prompt.

Raw task:
$ARGUMENTS

If `$ARGUMENTS` is empty, ask the user what task they want delegated to pi instead of invoking the subagent.

Report the subagent's result back to the user verbatim — do not paraphrase, summarize, or add commentary before or after it.
