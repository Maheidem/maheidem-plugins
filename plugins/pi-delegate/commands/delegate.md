---
description: Forward a coding task to the local pi CLI via the pi-delegate MCP tools
argument-hint: "<task description>"
allowed-tools: mcp__plugin_pi-delegate_pi-delegate__pi_task, mcp__plugin_pi-delegate_pi-delegate__pi_conversation_send, mcp__plugin_pi-delegate_pi-delegate__pi_conversation_read, mcp__plugin_pi-delegate_pi-delegate__pi_conversation_steer, mcp__plugin_pi-delegate_pi-delegate__pi_conversation_interrupt, mcp__plugin_pi-delegate_pi-delegate__pi_conversation_status, mcp__plugin_pi-delegate_pi-delegate__pi_conversation_end
---

If $ARGUMENTS is empty, ask the user what task they want delegated to pi instead of proceeding.

## Task sizing -- decompose before dispatching

pi is often a smaller/local model. Small, narrowly-scoped tasks succeed far more
reliably than large, open-ended, multi-step ones -- this is a known local-model
weakness, not a pi-specific limitation. Before calling any pi-delegate tool,
assess $ARGUMENTS:

- If it's a small, single-concern change (one function, one bug, one narrow
  question) -- dispatch it as-is, one `pi_task` call.
- If it describes substantial multi-step or multi-file work -- do the planning
  yourself first (you have full read access even under orchestrator-mode's pi
  state), break it into an ordered sequence of small, independently-verifiable
  steps, and dispatch one `pi_task` (or `pi_conversation_send`) call per step,
  checking each step's result against the actual files before dispatching the
  next. Do not bundle the whole breakdown into a single oversized task and hand
  it to one call.

Per-call phrasing guidance (what to include in the task text itself -- goal vs.
diff, scope, invariants, acceptance checks) now lives in the `pi_task` and
`pi_conversation_send` tool descriptions. Follow that guidance when writing
each step's task text; it is not repeated here.

## Continuing a conversation

For work that needs multiple related turns against the same pi session (rather
than independent one-shot steps), use `pi_conversation_send` with a chosen
conversation name instead of `pi_task`. The conversation is a keep-alive RPC
child, reused across sends and TTL-reaped when idle.

## Reading, steering, and interrupting

- `pi_conversation_read` -- inspect a conversation's transcript/state without
  sending a new turn.
- `pi_conversation_steer` -- adjust course on a conversation that's headed the
  wrong way, without waiting for it to finish.
- `pi_conversation_interrupt` -- stop an in-flight turn.
- `pi_conversation_status` -- check whether a named conversation is alive/busy.
- `pi_conversation_end` -- tear down a conversation you're done with.

Use these MCP tools directly; there is no subagent or Bash invocation involved
anymore.
