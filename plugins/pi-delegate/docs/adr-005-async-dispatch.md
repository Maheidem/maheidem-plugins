# ADR-005: Async Conversation Dispatch + Progress Notifications

**Status:** Implemented, 2026-07-29.
**Owner:** maheidem
**Depends on:** ADR-002 (`adr-002-mcp-facade.md`) -- the MCP facade and
keep-alive conversation registry this builds on. Deferred by ADR-003
(`adr-003-mcp-only.md`) §5, which flagged the blocking problem but scoped a
fix out to its own ADR.

## 1. Context

`pi_conversation_send`'s MCP `tools/call` response is fully synchronous:
`handleToolCall` `await`s `channelSend`, which `await`s `waitSettle` before
replying -- holding the JSON-RPC response open for up to `timeout_ms`
(default 600000ms/10min) before the caller gets anything back. For a
long-running conversational turn, this ties up the calling agent's tool call
for the full duration, with no visibility into progress until it's done.

Two designs were evaluated:

1. **Poll-based async dispatch** -- a new `pi_conversation_send_async` tool
   that returns immediately after the prompt is accepted, with completion
   detected via new fields on the already-lock-free `pi_conversation_status`.
2. **MCP `notifications/progress`** -- investigated as an alternative, but
   ruled out as a *replacement*: the MCP spec requires progress
   notifications to carry no result and never terminate the originating
   request, so `pi_conversation_send` would still block regardless of
   whether progress notifications were added on top of it.

Only (1) actually stops the call from blocking. (2) survives as an
**additive visibility layer** on the still-blocking `pi_conversation_send`
-- useful on its own (e.g. steer/interrupt becoming visible mid-turn without
a poll), not as a fix for the blocking problem.

### Why hand-roll (2) instead of migrating to an MCP SDK first

Before implementing, we considered whether to migrate `pi-mcp-server.mjs`
off hand-rolled JSON-RPC onto an official MCP SDK, on the theory that an SDK
might make `notifications/progress` cheaper to add correctly. Two
independent research passes plus a live instrumentation check found:

- Neither `@modelcontextprotocol/sdk` (legacy, ~6-month fix-only runway) nor
  its GA successor `@modelcontextprotocol/server` v2 provide a
  `sendProgress()` convenience method -- both still require hand-building
  `{progressToken, progress, total, message}` and gating on
  `_meta.progressToken`. An SDK would only remove ~20-40 lines of framing
  already working here.
- The actual forcing function for a future SDK migration is MRTR (Multi
  Round-Trip Requests, from the MCP spec's 2026-07-28 revision), which
  replaces server-initiated `elicitation/create` with a stateless
  request/retry shape. `pi-mcp-server.mjs`'s hand-rolled `elicitation/create`
  + `outgoingWaiters` correlation (ADR-002 §7) is built on the mechanism
  being retired -- that rework is coming regardless of SDK adoption, and
  is a better-scoped trigger for migrating than progress-notification sugar
  that doesn't exist.
- Two veto-checks were run live and both passed: dispatch concurrency (a
  second `tools/call` -- e.g. `pi_conversation_steer` -- can still be
  serviced while a slow `pi_conversation_send` is in flight, verified
  against both SDK versions' source, matching this server's own
  never-await-the-handler dispatch loop) and whether Claude Code actually
  sends `_meta.progressToken` on `tools/call` (confirmed by temporarily
  logging incoming `_meta` during a real `pi_task` call: `_meta={"claudecode/
  toolUseId":"...","progressToken":2}`).

**Decision:** do not migrate to an MCP SDK in this pass. Hand-roll
`notifications/progress` (§3 below); revisit an SDK once the MRTR-driven
elicitation rework is designed deliberately, not bundled into a
progress-notification slice that doesn't need one.

## 2. Decision: poll-based async dispatch

`pi_conversation_send_async(name, message, timeout_ms)`:

- Validates the name, acquires the conversation's PID lockfile (same
  `acquireLock` as the synchronous path), gets or spawns the channel,
  generates a `turnId` (`crypto.randomUUID()`), sends the prompt RPC, and
  returns immediately once that prompt is acknowledged:
  - success: `{ok:true, dispatched:true, sessionName, turnId, dispatchedAt}`
  - immediate rejection (bad name, prompt not acknowledged, or the
    conversation already busy with another turn): `{ok:false,
    dispatched:false, sessionName, errorMessage}`. Busy is **not queued** --
    retry later, or use `pi_conversation_steer`/`pi_conversation_interrupt`
    on the in-flight turn instead.
- The settle/interrupt-reprompt loop then runs in the background
  (`awaitTurnCompletion`, shared with the synchronous path -- see below),
  releasing the lock and updating `channel.lastTurnId`/
  `channel.lastTurnSettledAt` once it finishes, whether it settled
  normally or timed out.
- `pi_conversation_status`'s `channel` object gained `turnInFlight`,
  `currentTurnId`, `lastTurnId`, `lastTurnSettledAt`, `steered`,
  `pendingInterrupt`. Poll contract: the turn is done once
  `channel.lastTurnId === turnId && channel.turnInFlight === false`. If
  `channel.alive` is false, or neither `currentTurnId` nor `lastTurnId`
  match the remembered `turnId`, the turn was lost (channel reaped, killed,
  or the server restarted) -- fall back to `pi_conversation_read`. The
  answer itself is fetched via `pi_conversation_read` once status confirms
  completion; it is not duplicated into the status response.

### Implementation shape

`channelSend`'s turn body was split into three pieces, so the synchronous
and async paths share the exact same prompt/settle/interrupt-loop logic and
neither could silently diverge:

- `sendPrompt(ch, message)` -- resets per-turn state, sends the prompt RPC
  only.
- `awaitTurnCompletion(ch, timeoutMs)` -- waits for settle, running the
  existing steer/interrupt reprompt loop; does not send the initial prompt.
- `runTurn(ch, name, message, timeoutMs)` -- `sendPrompt` +
  `awaitTurnCompletion`, used by the synchronous `channelSend`. Its
  behavior is byte-for-byte identical to the pre-ADR-005 implementation;
  all pre-existing conversation test suites pass unmodified as the
  regression proof.

`channelSendAsync` calls `sendPrompt` directly (so dispatch can return as
soon as the prompt is acknowledged) and then kicks off `awaitTurnCompletion`
in the background without awaiting it, under the same `pendingOps` counter
the server already uses to keep the process alive until in-flight async
work drains.

`channelSteer`/`channelInterrupt` needed **no changes** -- they already act
lock-free on the shared `ch` object gated on `ch.turnInFlight`, which is set
identically by both dispatch paths.

## 3. Decision: `notifications/progress` (additive layer)

Gated entirely on the client sending `_meta.progressToken` on the
originating `pi_conversation_send` `tools/call` (read as a sibling of
`arguments` in `params`, not inside it). If absent, zero notifications are
emitted -- no behavior change for existing callers.

- `sendNotification(method, params)` -- a distinct fire-and-forget JSON-RPC
  notification helper (no `id`), separate from `serverRequest`'s
  request/reply machinery (`outgoingWaiters`), since framing a notification
  as a request would be a protocol bug.
- `ch.progressToken`/`progressSeq`/`lastProgressAt` are set for the turn's
  duration and cleared in `channelSend`'s `finally`.
- Emission is gated on a whitelist of meaningful stdout event types
  (`agent_start`, `turn_start`, `turn_end`, `agent_end`, `auto_retry_end`)
  and coalesced to roughly one per second, since raw event volume would be
  too noisy otherwise.
- `pi_conversation_steer`/`pi_conversation_interrupt` each emit one
  **uncoalesced** notification when they act on a conversation with an
  active `progressToken` -- this is the highest-value part of this slice:
  today, steering is invisible to whoever is waiting on the blocked
  `pi_conversation_send` call until the turn ends.
- `notifications/cancelled` (client-to-server) stops further progress
  emission for that turn's request id. It is **not** mapped to
  `channelInterrupt` in this slice -- that would be a separate, more
  invasive decision.
- `waitSettle`/`ch.settleWaiter` (internal completion detection) and the PID
  lockfile's timing are unchanged -- progress notifications are a read-only
  side-channel on top of both.

## 4. Consequential fix: `initialize` protocol-version echo

Found in passing while researching MCP SDK versions: the server
unconditionally echoed its own pinned `PROTOCOL_VERSION` in the
`initialize` response without ever comparing against the client-offered
`msg.params.protocolVersion`. Fixed to echo the client's version back when
it matches what this server supports (currently a single pinned version),
falling back to the server's own pin -- signaling a mismatch -- otherwise.
Independent of every other decision in this ADR.

## 5. Testing

`tests/test_mcp_async_send.sh` (new): happy-path dispatch-then-poll-then-read,
busy-rejection on a second dispatch to the same name, steer/interrupt during
an async-dispatched turn, and timeout-kills-the-channel-and-releases-the-lock.
`tests/test_mcp_progress.sh` (new): no `id` field on progress notifications,
correct/matching `progressToken`, a steer-triggered notification, and the
negative case (no token supplied -> zero notifications). All pre-existing
suites (`test_conversation_happy.sh`, `test_conversation_timeout.sh`,
`test_mcp_steering.sh`, etc.) pass unmodified -- the acceptance bar proving
`pi_conversation_send`'s synchronous contract is untouched.

## 6. Deferred

The MRTR-driven elicitation rework (replacing `elicitation/create` +
`outgoingWaiters` with the stateless request/retry shape) is real future
scope, tracked here but not addressed -- it should drive any future MCP SDK
migration, once `@modelcontextprotocol/server` v2 has more runtime hours
behind it.
