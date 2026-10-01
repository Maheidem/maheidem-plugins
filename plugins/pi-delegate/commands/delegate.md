---
description: Forward a coding task to the local pi CLI via the pi-delegate MCP tools
argument-hint: "<task description>"
allowed-tools: mcp__plugin_pi-delegate_pi-delegate__pi_agent, mcp__plugin_pi-delegate_pi-delegate__pi_send_message, mcp__plugin_pi-delegate_pi-delegate__pi_answer, mcp__plugin_pi-delegate_pi-delegate__pi_stop, mcp__plugin_pi-delegate_pi-delegate__pi_wait, mcp__plugin_pi-delegate_pi-delegate__pi_list_agents, mcp__plugin_pi-delegate_pi-delegate__pi_read
---

If $ARGUMENTS is empty, ask the user what task they want delegated to pi instead of proceeding.

## Task sizing -- decompose before dispatching

pi is often a smaller/local model. Small, narrowly-scoped tasks succeed far more
reliably than large, open-ended, multi-step ones -- this is a known local-model
weakness, not a pi-specific limitation. Before calling any pi-delegate tool,
assess $ARGUMENTS:

- If it's a small, single-concern change (one function, one bug, one narrow
  question) -- dispatch it as-is, one `pi_agent` call.
- If it describes substantial multi-step or multi-file work -- do the planning
  yourself first (you have full read access even under orchestrator-mode's pi
  state), break it into an ordered sequence of small, independently-verifiable
  steps, and dispatch them one at a time (`pi_agent` for the first, then
  `pi_send_message` to the same child for the next), checking each step's
  result against the actual files before dispatching the next. Do not bundle
  the whole breakdown into a single oversized task and hand it to one call.

Per-call phrasing guidance (what to include in the task text itself -- goal vs.
diff, scope, invariants, acceptance checks) lives in the `pi_agent` tool
description. Follow that guidance when writing each step's task text; it is not
repeated here.

## A pi child

`pi_agent` starts a named pi child: a background agent with its own pi session.
`pi_send_message {to, message}` talks to it later: it steers a running turn,
starts a new turn when it is idle, and resumes it (same session, same model)
after it was parked or stopped. When channel events reach this session you are
notified when the child finishes or asks; otherwise the call that handed it
control stays open until then (Claude Code moves it to the background after a
couple of minutes), so end your turn after it backgrounds.

## When pi asks you something

A pi child calls `ask_parent` when it is genuinely blocked. Answer from what you
know of the task with `pi_answer {to, question_id, answer}` (don't do the work
yourself instead -- the child stays blocked until the answer lands or it
expires). For an approval or opinion that changes scope or is irreversible, ask
the user with AskUserQuestion first, then `pi_answer {relay_user:true}` (only
then: an answer the user already gave you in their prompt is yours, so leave
`relay_user` off). If you
genuinely can't answer, say so in the answer and give pi a safe default. A
message sent while it waits is refused; `pi_send_message {interrupt:true}`
abandons the question and starts over with your message.

## Reading and stopping

- `pi_list_agents` -- your children, their state and pending questions;
  `pi_list_agents {name}` for one child in detail. Call it after compaction or
  whenever you are unsure what your children are doing.
- `pi_read {name, what}` -- a child's output without sending a turn: `result`
  (default, the last turn's full text), `transcript` or `events`.
- `pi_stop {name}` -- stop a child (its session is kept; `pi_send_message`
  resumes it); `pi_stop {name, forget:true}` also deletes its sessions.

Use these MCP tools directly; there is no subagent or Bash invocation involved
anymore.
