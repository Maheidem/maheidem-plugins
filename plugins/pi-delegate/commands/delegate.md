---
description: Forward a coding task to the local pi CLI via the pi-delegate subagent
argument-hint: "<task description>"
allowed-tools: Agent
---

If `$ARGUMENTS` is empty, ask the user what task they want delegated to pi instead of invoking the subagent.

## Task sizing — decompose before dispatching

pi is often a smaller/local model. Small, narrowly-scoped tasks succeed far more
reliably than large, open-ended, multi-step ones — this is a known local-model
weakness, not a pi-specific limitation. Before invoking the subagent, assess
`$ARGUMENTS`:

- If it's a small, single-concern change (one function, one bug, one narrow
  question) — dispatch it as-is, one `Agent` call.
- If it describes substantial multi-step or multi-file work — do the planning
  yourself first (you have full read access even under orchestrator-mode's `pi`
  state), break it into an ordered sequence of small, independently-verifiable
  steps, and dispatch **one `Agent` call per step**, checking each step's
  result (now reliable, via the completion-marker contract in
  `pi-cli-runtime`) before dispatching the next. Do not bundle the whole
  breakdown into a single oversized task and hand it to one `Agent` call.

## Invocation

For each step (one step = one `Agent` call): invoke the `delegate` subagent via
the `Agent` tool (`subagent_type: "pi-delegate:delegate"`), passing that step's
task text as its prompt. Give each step enough standalone context to make
sense on its own — `pi` runs `--no-session` (stateless), so it has no memory of
prior steps except what's already on disk.

Raw task:
$ARGUMENTS

Report each step's result back to the user verbatim as it completes — do not
paraphrase, summarize, or add commentary before or after it. If a step fails,
stop and report the failure rather than continuing to the next step.
