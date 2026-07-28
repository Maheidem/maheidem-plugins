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
  result (now reliable, via the RPC completion path in
  `pi-cli-runtime`) before dispatching the next. Do not bundle the whole
  breakdown into a single oversized task and hand it to one `Agent` call.

If `$ARGUMENTS` describes ongoing, stateful back-and-forth with pi (continuing
a named conversation, sending a follow-up in the same session) rather than a
one-shot task, tell the `delegate` subagent to use the `conversation`
verbs instead of `task` — see the "Continuing a conversation" section in
`agents/delegate.md` and the `pi-cli-runtime` skill. This doesn't change the
task-sizing/decomposition guidance below, which still applies to `task` work.

If `$ARGUMENTS` asks to check in on, nudge, or interrupt a conversation that
may already be running in the background (e.g. "see what pi has said so far
in `<name>`", "tell pi to also check the tests while it's working", "stop
that and have it focus on X instead"), tell the subagent to use `conversation
read` / `conversation steer` / `conversation interrupt` respectively — see
`agents/delegate.md`'s corresponding section. A long-running `send` is
typically kicked off in the background (`run_in_background`) so the main
thread stays free to issue `read`/`steer`/`interrupt` calls against it while
it's still outstanding; the eventual task-notification for the backgrounded
`send` is the completion signal, not a `status` poll loop.

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

## The Delegation Contract

Delegate execution, never judgment:

1. **Spec to near-determinism.** Give pi exact content, exact anchor lines, exact
   commands — a template to fill, not a problem to solve. If a step needs design,
   do the design yourself and delegate the transcription.
2. **One atomic step per delegation.** Verify each result against the actual files
   before dispatching the next. Never batch dependent steps into one prompt.
3. **Ask for evidence, not conclusions.** Request command output, diffs, exit
   codes, file paths — raw material. Never ask pi to attribute causes, judge
   whether a failure is pre-existing, assess severity, or decide scope.
   Attribution and judgment stay with the orchestrator.
4. **Audit every claim independently.** pi saying "done", "verified", or
   "pre-existing" is a report, not a fact. Check it against evidence you hold or
   can read yourself; treat unverifiable claims as unknowns.
5. **Bound everything.** Any command that could block gets a hard `timeout`.
   A hang is a finding to diagnose, not a wait.
