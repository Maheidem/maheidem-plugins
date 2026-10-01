# ADR-006: pi children behave like Claude's own background agents

**Status:** Accepted 2026-10-01, targets 0.11.0 (unreleased; version not bumped yet).
**Owner:** maheidem
**Scope:** `scripts/pi-mcp-server.mjs`, `scripts/pi-companion.mjs`, `commands/delegate.md`,
orchestrator-mode's enforcer (lockstep change, see "Guardrails").
**Supersedes:** the tool surface of ADR-002 (MCP facade) and ADR-005 (async dispatch). The RPC
engine from ADR-001 (`architecture.md`) and the MCP-only decision of ADR-003 still hold.

## Context

0.10.0 exposed ten tools in two families: a one-shot `pi_task` and a `pi_conversation_*` set
(send, send_async, steer, interrupt, status, read, end), plus `pi_respond` and `pi_setup`.
Unreleased work after it added `pi_answer` / `pi_wait_event` for the ask channel. Claude
had to learn a vocabulary that matched nothing it already knows, poll or re-arm one shared
`pi_wait_event` to notice a finished turn, and a stop deleted the session. Claude Code already
has a model for this: named background agents (Agent, SendMessage, TaskStop, ListAgents,
task-notification wakes).

## Decision

Each pi child is a **named background agent owned by the Claude session that started it**. The
tool surface mirrors Claude's own primitives:

| Native | pi-delegate | Replaces |
|---|---|---|
| Agent `{name, prompt, run_in_background}` | `pi_agent` | `pi_task`, the first `pi_conversation_send[_async]` |
| SendMessage `{to, message}` | `pi_send_message` | later sends, `pi_conversation_steer`, `pi_conversation_interrupt` |
| reply to a background agent's question | `pi_answer` | `pi_answer`, `pi_respond` |
| TaskStop | `pi_stop` | `pi_conversation_end` |
| ListAgents | `pi_list_agents` | `pi_conversation_status`, `pi_setup` |
| TaskOutput | `pi_read` | `pi_conversation_read` |
| task-notification wake | channel push, or the call that handed the child control | `pi_wait_event` |
| (recovery only) | `pi_wait` | |

Clean break: the old names are not listed in `tools/list`. Calling one returns
`renamed, use <new call>`.

### Names, generations, ownership

- One resolver for every by-name tool: accepts `name`, `to` or `task_id`, strips a leading
  `pi:`, lowercases, validates `^[a-z][a-z0-9_-]{0,31}$`.
- Reusing a name that is idle or not live **takes it over** as a new generation. The old
  generation stays readable with `pi_read {name, gen}`. A name that is running or waiting is
  refused with a pointer to `pi_send_message`.
- The pi session id is `<name>-g<gen>-<store id>`. The store id is a stable random id per plugin
  data store, so two stores serving one project (installed copy and `--plugin-dir` copy, or two
  profiles) can't resume or forget each other's sessions.
- The lock is taken before launch and held for the process lifetime, recording
  `{serverPid, serverStart}`. Another Claude session gets an owner error from every mutating
  tool and sees the child read-only in `pi_list_agents`.
- State lives under `${CLAUDE_PLUGIN_DATA}/projects/<cwd-slug>/children/<name>/`:
  `meta.json` (tmp+rename, read back after every write), `events.jsonl` (append-only, per-child
  seq), `results/<gen>-<turn>.md`.

### Lifecycle

`spawning -> running <-> waiting -> idle`; idle children are parked after the TTL or by LRU at
the live cap (4); errors give `failed`; `pi_stop` gives `stopped`. `pi_send_message` to a
parked, stopped or failed child respawns it on its **recorded** launch (same session, same
model) and prompts it. `pi_stop` keeps the session; `pi_stop {forget:true}` deletes every
generation this store recorded and frees the name.

### Wake

- **Channel (confirmed).** The server declares `experimental['claude/channel']` and pushes
  `notifications/claude/channel` with meta `{agent, event, seq, gen, turn, instance,
  question_id?}`. Line 1 of the content is a terminal echo (`[pi:x] DONE turn 3 ok ...`), the
  `<pi-agent-event>` block below it carries the detail and `<controls>` hints. There is no
  `task-id` tag, so nothing invites the native TaskStop/SendMessage.
- **Confirmation.** On the first `pi_agent` of a server lifetime the server pushes a data-only
  probe (`[pi-delegate] push check <nonce>`). The server `instructions` tell Claude to answer
  with `pi_list_agents {confirm_push:<nonce>}`. A call carrying a seq or question id that only a
  push delivered also confirms. Confirmation is in memory only; every server start re-probes.
- **Unconfirmed, flag present (`wake channel?`).** When Claude's argv names this plugin's channel,
  a background `pi_agent` returns at once instead of blocking. Blocking would defeat the probe:
  Claude Code holds a push that arrives during a tool call until that call returns, and runs
  one server's tool calls one at a time, so `confirm_push` (even in the same message) waits
  behind the blocked call. The probe goes out before the result, so Claude sees it right after
  it. If no probe arrives (flag present but the channel gated), the result tells Claude to call
  `pi_wait {name}`; events are kept unconsumed until confirmed, so nothing is lost.
- **Fallback.** Until confirmed (no channel flag, `-p`, or not answered yet; for `pi_agent`, only without the flag) the call that hands
  a child control (`pi_agent`, a turn-starting `pi_send_message`, `pi_answer`) stays open until
  that child's next waking event, with progress every 20s. Claude Code moves it to the
  background after `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` (about 2 min by default) and wakes Claude
  with a native task-notification when it returns. One wait per child, nothing to re-arm.
- `pi_wait` exists only for recovery (compaction, restart, a cancelled call), when a result or the
  `pi_list_agents` header says `wait armed: no`. One waiter per server; a newer one supersedes.
- `PI_DELEGATE_WAKE=channel|fallback` overrides detection.

### Delivery and consumption

Every event is appended to `events.jsonl` before any push. Consumption (`consumed_seq`) applies
to owned children only and advances when a confirmed push is written, when a tool response
carrying the event is written (commit-on-send), when `pi_answer` resolves a question, or when
`pi_send_message` delivers / `pi_stop` targets the child. Before confirmation a push does not
consume, so a fallback return may repeat it, marked `(also pushed HH:MM:SS)`. Pushes carry up to
4000 chars of result; fallback returns and `pi_wait` use a compact form (300 chars), and
`pi_read` has the rest.

### ask_parent

- Every child loads the pi-side `@maheidem/pi-delegate` package in child mode and gets
  `ask_parent`, unless `ask:false` (or `exclude_tools` drops it). When `tools` is given,
  `ask_parent` is appended to `-t`. `handoff` is always excluded.
- Any toolCallId routes; only absolute ids, `..` segments and NUL are rejected, and a rejected
  id becomes a visible `failed{question_unroutable}` event. Nested ids get nested answer dirs.
- `pi_answer` writes the answer file (tmp+rename, 0600, read back) with `answeredBy` `model`, or
  `model (relaying user)` with `relay_user:true`, which is only for the user's reply to an
  AskUserQuestion about that question (an answer the user dictated up front is the model's).
  The server never writes `user`. It then
  reports `picked up` only when the child's `tool_execution_end` says `askAnswered`, and lists
  sibling questions from the same batch that are still pending.
- **The server owns expiry.** Children get a 4h hard cap; the server's soft timer
  (`question_wait_minutes`, default 10 min) starts once the question is consumed, then writes the
  fallback answer itself (`model (timeout)`) and emits `question_expired`.
- **Budget per turn**, enforced by the server: `questions_per_turn`, default 5 (D5). The
  6th question in a turn gets an immediate budget answer.
- A message to a child blocked on a question is refused and shows the full question.
  `interrupt:true` pre-answers pending questions, sends `clear_queue`, aborts and prompts.

### Guardrails

- **Pin.** Enforced three times: orchestrator-mode's hook in pi mode; the server rejects a
  `provider`/`model` that differs from the pin; `tools/list` hides `provider`/`model` when a pin
  exists. Resume uses the model recorded at launch. A `get_state` handshake fails the spawn
  synchronously when pi silently fell back to another model.
- **Lean start.** `--no-extensions --no-skills --no-prompt-templates --no-context-files`, with
  `-e` only for the provider package, the pin's `extensions:` opt-ins and the child package.
  Needs pi >= 0.99.0, checked once per server.
- **Env scrub.** Claude's messaging, session, plugin and OAuth variables, secret-shaped and
  remote/bridge/host `CLAUDE_CODE_*` names never reach the child. `ANTHROPIC_*` is removed unless
  the child may run on the anthropic provider.
- **orchestrator-mode, shipped in lockstep.** The pi spawn predicate matches `pi_agent` (and the
  legacy `pi_task`); the pi-mode deny text names `pi_agent, pi_send_message, pi_answer,
  pi_list_agents`; the config-name check in MCP text only fires on path shapes, so a sentence
  ending in "orchestrator-mode." passes, and the deny says to paraphrase ("the pin file").

### Restart and crash

- On server start, records owned by a live server are skipped. For the rest, a still-running
  orphan of this store is killed, its open questions close as `question_expired{orphaned}`, and
  running/waiting records become `failed{orphaned}` (always pushed, so they reach Claude after
  re-confirmation or on the next listing).
- A `kill -9` of the server loses the child with it (pi 0.99 exits on stdin EOF). That is
  accepted. Recovery records the failure, any toolCall left without a toolResult is paired on
  disk before pi reloads the session, and the child resumes by name.
- On a clean shutdown owned children have pending asks pre-answered, running ones become
  `failed{claude_exit}`, idle ones `parked`.

## Owner decisions (2026-10-01)

| # | Question | Decision |
|---|---|---|
| D1 | MLflow tracing of pi-child LLM calls | Not needed for this work; no tracing added. |
| D2 | Version | 0.11.0 (not 1.0.0; channels are still a research preview). The bump is a separate step. |
| D3 | `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` | No settings change. `pi_list_agents {doctor:true}` reports the effective value and a recommendation. Revisit only if channels turn out to be unavailable. |
| D4 | Old generations and sessions on disk | Kept until `pi_stop {forget:true}`. No auto-delete in 0.11. |
| D5 | Per-turn question budget | 5 (configurable `questions_per_turn`; see README profile/project settings). |

Later binding decisions from the same review: a server `kill -9` loses the child (see above), and
two data stores in one project are kept apart by the store id in the session id.

## Cut from scope

A compatibility shim, journal rotation, results retention, adopting 0.10 conversation sessions,
auto-forget, pushing notes on their own, a watchdog footer, and `ask_user` elicitation. Notes ride
along on the next waking event instead.

## Consequences

- Claude's habits transfer: name a child, message it, stop it, list it. The instructions say
  plainly that native SendMessage/TaskStop/ListAgents can't see pi children.
- No polling in either wake mode. Fallback costs up to the auto-background threshold of
  main-thread blocking per hand-off.
- Sessions and generations accumulate on disk until forgotten (D4).
- 0.10 callers break loudly (`renamed`), which is acceptable because the user's own sessions are
  the only consumers.
- Residual risk: a child's bash could still run `claude` with the keychain, or use a kept
  `ANTHROPIC_*` key on an anthropic pin. Not detectable from here.
