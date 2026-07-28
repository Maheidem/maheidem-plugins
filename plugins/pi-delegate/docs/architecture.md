# pi-delegate: Post-RPC Architecture Decision Record

**Status:** Accepted, 2026-07-28. Revised 2026-07-28 (probe findings, v0.6.0 scope).
**Owner:** maheidem
**Scope:** `plugins/pi-delegate` (`pi-companion.mjs`, `delegate` agent, skills)

## 1. Verdict on the old design

The pre-RPC design used a marker-file contract: spawn `pi`, poll a progress log, wait for a
sentinel marker to appear, then read the result off disk. It worked but conflated three concerns
that RPC separates cleanly — completion detection, result retrieval, and conversational
continuity.

**Dies (scheduled, Phase 3):**
- Marker-file completion contract.
- Progress-log polling.
- "No session, force decomposition" guidance that told agents to avoid multi-turn work because
  there was no cheap way to resume a conversation.

**Survives, unchanged:**
- `spawnPi`'s process hygiene: group-kill on timeout, timeout enforcement itself.
- The Bash-subagent relay contract (how the `delegate` agent shells out and relays stdout/stderr).
- `isSafeArgValue` and existing config-precedence rules for building the `pi` invocation.
- The unified JSON result-contract shape (`finalText`, `errorMessage`, etc.) — RPC completion
  populates the same shape, it just stops needing a marker field to know when to populate it.
- The stub-test technique used in `tests/`.

**Why now:** pi 0.82.1's RPC mode (`--mode rpc`) gives a structured JSONL event stream
(`agent_start` → … → `agent_end` → `agent_settled`) plus `get_last_assistant_text`, which is a
strictly better completion/result signal than grepping for a marker string. Sessions already
persist to `~/.pi/agent/sessions/<cwd-slug>/*.jsonl` and `--session-id` creates-if-missing, so
conversational continuity is available for free without any new persistence layer.

## 2. Target architecture

**End goal:** a persistent, observable, steerable pi conversation where every interaction is a
crash-safe file operation — a session jsonl for history, a lockfile for mutual exclusion, and (for
the duration of a turn) a FIFO for steering. No daemon, no MCP server, no resident process; nothing
outlives its own Bash tool call except the FIFO, which lives only as long as the `send` call that
created it.

`pi-companion.mjs` gains a `conversation` verb family: `start | send | status | end`. Each `send`
is one spawn-to-exit roundtrip:

1. Spawn `pi --mode rpc --session-id <name>`.
2. Write `{"type":"prompt","message":...}` to its stdin.
3. Stream stdout JSONL, block until `agent_settled`.
4. Call `get_last_assistant_text`.
5. Exit the child cleanly.

Continuity lives entirely in pi's own session jsonl on disk — the plugin holds no state between
calls beyond the session name the caller supplies. `spawnPi`'s existing group-kill/timeout
machinery and the unified JSON result contract are reused as-is (no marker on this path;
`finalText` is populated straight from `get_last_assistant_text`).

**Locking:** one lockfile per conversation, opened with `wx` (exclusive create), containing the
holder's PID. A concurrent `send` against the same conversation name fails loud with a clear
`errorMessage` rather than queuing or blocking. Reclaim is PID-liveness only: if the PID in the
lockfile is dead, the lock is stale and is reclaimed; if it's alive, the new caller fails loud. No
wall-clock timeout on the lock. The lockfile is removed in a `finally` so normal completion and
thrown errors both clean up.

**Verb semantics:**
- `start`: create/validate the session (`--session-id` creates it if missing), optionally send a
  first message in the same call.
- `status`: `get_state` / `get_session_stats` roundtrip against the existing session — no new
  message sent.
- `end`: delete the session jsonl and the lockfile.

**Naming collisions:** two separate Claude Code sessions choosing the same conversation name is
accepted as a documented convention problem, not solved in code — namespace by project/task in the
name you pick.

**What's untouched in Phase 1:** the existing `task` path (marker contract, `delegate` agent's
non-conversational flow) is left exactly as-is. `conversation` is additive.

## 3. Roadmap

### Phase 1 — Conversations (this record's immediate scope)
Ship `pi-companion.mjs conversation start|send|status|end` as described in §2. Extend the
`delegate` agent in place with continue-conversation instructions, and extend the skills with the
new RPC vocabulary (`conversation start/send/status/end`, session naming convention). The `task`
verb and its marker contract are not touched.

### Phase 2 — `task` → RPC completion, default
Migrate the existing `task` verb to use RPC completion (`agent_settled` + `get_last_assistant_text`)
as the **default** completion mechanism, keeping the marker as a fallback flag for callers that
still need it during the transition. This is not measurement-gated — it ships regardless of
benchmark numbers — but latency numbers (spawn-to-`agent_settled` roundtrip, per model/backend)
must still be recorded for the record, following the same measurement pattern already used for
Phase-1 RPC verification (see §4).

### Phase 3 — Marker deletion + contract unification
Delete the marker-file machinery entirely (no fallback flag left) and unify the result contract
across `task` and `conversation` in the skills layer, so callers see one consistent completion/
result shape regardless of which verb they used.

### Phase 4 — DISSOLVED: steering via resident RPC (superseded 2026-07-28)
The original Phase 4 proposed a resident RPC process a caller could `steer`, `follow_up`, or
`abort` mid-run, gated behind an unresolved supervisor/reattach/UI-forwarding lifecycle design.
The 2026-07-28 probe (see §5) found none of that lifecycle is needed: `send` already spawns a
process that lives for the duration of one turn, and pi's own jsonl already flushes per completed
message while that turn runs. Steering and interrupting are turn-scoped operations, not
cross-invocation ones — a FIFO opened by `send` for its own lifetime and torn down at
`agent_settled` covers the entire use case with zero new supervision, reattachment, or persistence
machinery. Phase 4 as originally scoped is dissolved; its three open questions (supervisor,
reattach, `extension_ui_request` forwarding) are moot because there is no resident process to
supervise, reattach to, or forward through. It is replaced by Phase 4' below.

### Phase 4' — Turn-scoped FIFO steering, read, and interrupt (v0.6.0, this build)
Ships in this version, grounded in the 2026-07-28 probe (§5):

- **`conversation read <name> [--last N] [--json]`**: renders the session jsonl tail using the
  probe-validated rendering rules — strict file order (never re-sort by timestamp, since steer
  messages are stamped at enqueue time but positioned at delivery point), one line per entry as
  `HH:MM:SS role: gist` from `message.role`/`message.content`, with `[tool:NAME args-gist]` and a
  toolResult gist appended where present. Human text by default; `--json` returns the same entries
  structured. Lock-free, like `status` — it only reads the jsonl off disk, so it works mid-turn
  without contending with an in-flight `send`.
- **`conversation send`** additionally `mkfifo`s a control FIFO next to the lockfile for the
  duration of the turn, and poll-reads it between/while streaming RPC events.
- **`conversation steer <name> "<msg>"`** validates the message (non-empty, bounded size) and
  writes an envelope line to that FIFO, returning immediately (`ok:true`, queued) without waiting
  for delivery. The owning `send` process relays the line as `{"type":"steer","message":...}` to
  the RPC child and continues blocking toward the current turn's `agent_settled`. If no FIFO exists
  (no `send` in flight for that name), `steer` returns `ok:false` — `"conversation is idle — use
  send"`.
- **`conversation interrupt <name> "<msg>"`** uses the same FIFO transport with envelope
  `{"kind":"interrupt",...}`; the owning `send` process issues `{"type":"abort"}` to the RPC child,
  then `{"type":"prompt","message":...}` to start a new turn on the same child, and continues to
  settle that new turn instead. The result's `finalText` reflects the interrupt's outcome, not the
  aborted turn's. Idle behaves identically to `steer` (`ok:false`, same message).
- **Result contract:** `send`'s result JSON gains `steered: [...]` (messages relayed during that
  turn) and `interrupted: bool` (default `false`), both empty/false when no steer/interrupt
  occurred.

No daemon, no cross-invocation state: the FIFO's lifetime is bound to one `send` call, matching
§2's "nothing outlives a single Bash call" invariant for the `send` process itself, while
`steer`/`interrupt`/`read` are short-lived callers that touch the FIFO or jsonl and exit.

## 4. Owner decisions (2026-07-28, history — preserved as originally recorded)

- **D-A Steering:** resume-based conversations ship now (Phase 1). True steering (resident RPC
  process, `steer`/`follow_up`/`abort`) stays on the roadmap as Phase 4, not rejected — gated on
  the lifecycle design in §3.
  *(Superseded by the 2026-07-28 probe: Phase 4 dissolved, replaced by turn-scoped FIFO steering
  in Phase 4' — see §3 and §6. No resident process shipped; none of D-A's original gating
  questions applied once the resident-process premise was dropped.)*
- **D-B Lock policy:** PID-liveness only (dead PID = stale/reclaim, alive PID = fail loud). No
  wall-clock timeout. This is an owner-default because the question went unanswered during review
  — treat it as revisitable, not settled doctrine.
- **D-C RPC everywhere:** committed. The marker contract is scheduled for retirement, not
  measurement-gated. Phase 2 migrates `task` to RPC completion as default with marker-as-fallback;
  Phase 3 deletes the marker machinery and unifies the result contract in skills. Phase 2 still
  records latency numbers for the record even though it isn't gated on them.
- **D-D Doc first:** this architecture record is written into the repo before any Phase 1 code
  lands.

## 5. Verified pi 0.82.1 facts (grounding for §2–3)

- RPC event ordering observed live: `agent_start` → … → `agent_end` → `agent_settled`.
- Measured PONG roundtrip on local Qwen: ~1.5–2.7s.
- Prompt acceptance (stdin write to first ack): ~10ms.
- Sessions persist as jsonl on disk under `~/.pi/agent/sessions/<cwd-slug>/`.
- `--session-id <name>` creates the session if it doesn't already exist.
- pi RPC docs: https://pi.dev/docs/latest/rpc

## 6. Probe findings, 2026-07-28 (evidence base for §2–4, v0.6.0 scope)

Live probe against pi 0.82.1, all facts confirmed from raw process output — this is the evidence
base that dissolved Phase 4 and produced the Phase 4' design:

- **jsonl flushes per completed message, mid-turn.** A tool result was on disk at t=4s during a
  25s `sleep` tool call. `read` is therefore just a jsonl tail and works correctly even while a
  turn is in flight. A long single tool call producing 15–20s+ with no new lines is expected
  behavior, not a stall — `read`/monitoring logic must not treat it as one.
- **Render strictly in file order, never re-sort by timestamp.** Steer user-messages are
  timestamped at enqueue time but land in the file at their delivery point, later in the stream.
  Sorting by timestamp would show them out of the order they actually took effect in.
- **Working render recipe:** per entry, `HH:MM:SS role: gist`, sourced from `message.role` /
  `message.content` (`entry.type` is uselessly `"message"` for everything, not a role marker).
  Append `[tool:NAME args-gist]` for tool calls and a short gist of the tool result where present.
- **Steer semantics observed:** the internal queue update fires immediately, but the message is
  only delivered to the model after the in-flight tool call finishes, at the turn boundary — then
  it's acted on (confirmed via a GAMMA marker appended to the transcript in the probe run).
- **Abort semantics observed:** `{"type":"abort"}` cuts a running bash tool call in ~150ms,
  producing `stopReason:"aborted"`; the session remains usable for the next prompt immediately
  after.
- **RPC envelope is strict.** `prompt`/`steer` require exactly `{"type":..., "message":...}` — a
  wrong field name (e.g. `text` instead of `message`) produces an unhelpful internal `TypeError`
  rather than a validation error. Both `send` and `steer`/`interrupt` must validate the envelope
  shape before writing to the child's stdin.
- **`conversation status` takes no lock.** It is safe to call concurrently with a busy `send`.
  Distinct conversation names run fully in parallel; a second `send` against the same name still
  fails loud with `lockHeldByPid`, unchanged from §2.
- **RPC child exits cleanly** ~150–200ms after `stdin.end()` following `agent_settled` — confirms
  the "nothing outlives its own Bash call" invariant holds for the child process itself, with the
  FIFO as the only artifact whose lifetime is deliberately scoped to the `send` call that owns it.

**Bugs found and fixed in this build (not architectural, but recorded for the change record):**
- **BUG1:** `sessionId` was correctly wired on `status`/`start` but never populated on `send`
  (no `get_state`/`get_session_stats` roundtrip existed on that path at all), and `turnCount` was
  wrong everywhere it *was* computed — the old code fell back to `get_state`'s `messageCount`
  (user+assistant combined), which isn't a turn count. Fixed by adding a `get_state` (and
  `get_session_stats`) roundtrip to `send`, and by mapping `turnCount` from
  `get_session_stats.data.userMessages` directly (one user message per turn in this protocol),
  dropping the `messageCount` fallback entirely rather than silently substituting a different
  metric.
- **BUG2:** `conversation end`'s deletion logic already existed and worked correctly for the
  single-file-per-name case (confirmed live against real pi before this build) — the actual defect
  was `entries.find(...)` picking only the *first* jsonl matching `*_<name>.jsonl`, which silently
  drops any additional files left behind after crash/stale-lock-reclaim recovery (unverified live
  but plausible, and the code could not have handled it either way). Fixed by extracting a shared
  `findSessionFiles` helper (also used by `read`) and switching `end` to `entries.filter(...)`,
  deleting every match and reporting the full list in the summary. The e2e test's "session file
  gone after end" assertion remains vacuous as written (it can pass on "zero files ever matched" as
  easily as on "deletion happened") — a before/after file-count pair and a stub test planting two
  matching files are still open test-debt, not yet added; tracked as follow-up, not claimed done
  here.
