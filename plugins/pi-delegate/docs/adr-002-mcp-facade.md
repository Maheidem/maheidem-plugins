# ADR-002: MCP Facade over the pi RPC Runtime (Phase 5)

**Status:** Planned, 2026-07-28. Owner decisions recorded below; build not started.
**Owner:** maheidem
**Depends on:** ADR-001 (`architecture.md`) Phases 1-3 — the RPC-only runtime shipped as 0.7.0 (`dee83eb`).

## 1. Context

The runtime is fully RPC-based: one unified result contract, spawn-to-exit
processes, pi's session jsonl as the only durable state, FIFO relay for
turn-scoped steering. It works, but its consumer interface is prose — two
skills, an agent, and a command that only Claude Code with this plugin loads.
Wrapping the runtime as an MCP server buys: (a) typed tool schemas usable from
any MCP client (Claude Desktop, claude.ai, other frameworks); (b) a
harness-managed resident process, which dissolves the constraint that forced
the FIFO design — the harness starts the server with the session and kills it
with the session, so the server may legitimately own live pi children; (c)
protocol-level validation replacing prompt-taught contracts.

## 2. Owner decisions (2026-07-28)

- **D5-A Implementation: hand-rolled stdio server, zero deps.** MCP over stdio
  is JSON-RPC 2.0 in LF-framed lines — the same machinery this plugin already
  ships for pi's RPC. ~200-300 lines. We own protocol conformance (scope in §6).
- **D5-B Residency: keep-alive children with TTL.** pi RPC children survive
  across sends for the same conversation, reaped after an idle TTL
  (default 300s, configurable). Instant follow-up turns, standing
  steerability. The session jsonl remains the durability layer: a dead or
  reaped child is transparently respawned with the same `--session-id` —
  reattach is respawn.
- **D5-C pi questions: MCP elicitation, with `pi_respond` fallback.** Servers
  raise pi's `extension_ui_request` dialogs as MCP elicitation requests where
  the client supports it; a `pi_respond` tool plus pending-question surfacing
  in `pi_conversation_status` covers clients that do not. Auto-cancel timeout
  stays as the terminal fallback.
- **D5-D Orchestrator-mode: allowlist `mcp__pi-delegate__*` under PI state.**
  PI mode's intent is "changes go through pi"; these tools are that path.
  Main-thread results are bounded by the 10KB raw tails. orchestrator-mode
  gets a minor bump for the allowlist change.

## 3. Architecture

Components (all inside `plugins/pi-delegate`, no new plugin):

- `scripts/pi-mcp-server.mjs` — hand-rolled stdio MCP server. Owns a
  **conversation registry**: `Map<sessionName, {child, state, lastUsedAt,
  pendingQuestion}>`. Registered in `.mcp.json` so Claude Code starts/stops it
  with the session.
- `scripts/pi-companion.mjs` — unchanged as CLI (tests, debugging, subagent
  fallback). Its core functions (`runTaskRpc`, `rpcRoundtrip`,
  `runConversation*`, config/lock helpers) gain `export` keywords so the MCP
  server imports them instead of duplicating logic. One engine, two facades.
- Cross-process safety: the existing PID lockfile stays, taken by whichever
  facade runs a turn — CLI and MCP server cannot interleave sends on the same
  conversation.

Lifecycle: server starts idle (no pi processes). First `pi_conversation_send`
for a name spawns `pi --mode rpc --session-id <name>` and registers it. Later
sends reuse the live child (skip spawn, write a fresh `prompt`). A reaper
timer kills children idle past TTL (SIGTERM, then the existing group-kill
escalation) and clears registry entries. Server shutdown (stdin EOF / SIGTERM
from the harness) kills all children via the same path. A send finding a dead
registered child (crash, external kill) unregisters it and respawns — the
session jsonl guarantees no context loss. `pi_task` remains stateless
spawn-to-exit (no registry, `--no-session`), unchanged semantics from 0.7.0.

## 4. Tool surface

All tools return the unified result contract from ADR-001 Phase 3 (`ok`,
`finalText`, `summary`, `errorMessage`, `warning`, `exitCode`, session fields,
`steered`, `interrupted`, raw 10KB tails). Input schemas are real JSON Schema —
the protocol validates what the skills used to teach.

| Tool | Args | Semantics |
|---|---|---|
| `pi_task` | `text` (req), `provider?`, `model?`, `thinking?`, `tools?`, `exclude_tools?`, `timeout_ms?` | Stateless one-shot; same as CLI `task`. |
| `pi_conversation_send` | `name` (req), `message` (req), `timeout_ms?` | Reuses/starts the registered child; blocks to `agent_settled`; emits MCP progress notifications from stream events while running. |
| `pi_conversation_read` | `name` (req), `last?` | Lock-free jsonl tail, file-order rendering (ADR-001 §6 rules). |
| `pi_conversation_status` | `name` (req) | `get_state`/`get_session_stats` + registry info (child alive? idle since? TTL remaining?) + `pendingQuestion` if any. |
| `pi_conversation_steer` | `name` (req), `message` (req) | Writes `{"type":"steer"}` to the LIVE child mid-turn; `ok:false` if idle. |
| `pi_conversation_interrupt` | `name` (req), `message` (req) | `abort` + fresh `prompt` on the live child; generation tracking per ADR-001. |
| `pi_conversation_end` | `name` (req) | Kills the registered child if alive, deletes session file(s) + lock. |
| `pi_respond` | `name` (req), `value?`, `confirmed?`, `cancelled?` | Answers a pending `extension_ui_request` (fallback path for D5-C). |
| `pi_setup` | — | Readiness report (pi version, provider/model pin, model list). |

## 5. Concurrency model

The server is a single Node process with async handlers — it MUST NOT
serialize all tool calls behind one in-flight `send`, or steering becomes
impossible. Per-conversation serialization only: one turn at a time per name
(in-process queue + the on-disk PID lockfile for cross-process exclusion);
different names run fully parallel; `read`/`status`/`steer`/`interrupt`/
`pi_respond` are never queued behind a send. A steer arriving with no turn in
flight fails `ok:false` ("conversation is idle") — same contract as 0.7.0.

## 6. Protocol conformance scope (hand-rolled, D5-A)

Implemented: JSON-RPC 2.0 over stdio, strict-LF framing; `initialize` (declare
`tools` + `elicitation` capabilities, protocol version negotiation);
`tools/list` (static schemas); `tools/call` (async, isError mapping from
`ok:false`); `notifications/progress` during sends; server-initiated
`elicitation/create` for pi questions; graceful shutdown on stdin EOF.
Explicitly NOT implemented: resources, prompts, sampling, HTTP/SSE transport,
pagination. Conformance is guarded by a test-suite MCP client (§8), and the
protocol version we implement is pinned in one constant with a comment citing
the spec revision.

## 7. Elicitation flow (D5-C)

pi `extension_ui_request` (select/confirm/input) during a turn →  server maps
it to `elicitation/create` with a matching requested-schema; the client answer
is written back as pi's `extension_ui_response`. If the client rejects or
lacks elicitation, the question parks as `pendingQuestion` (surfaced by
`pi_conversation_status`, answerable via `pi_respond`); pi's own dialog
timeout auto-cancel remains the terminal fallback, unchanged. Fire-and-forget
UI events (`setStatus` etc.) stay ignored.

## 8. Testing / Definition of Done

- New `tests/lib/mcp-client.mjs`: a minimal stdio MCP client (same hand-rolled
  JSONL machinery) used by suites to drive the REAL server process.
- Stub suites: initialize/handshake; tools/list schema snapshot; task happy +
  error-turn; send/reuse (registry hit — SAME child pid across two sends);
  TTL reaping (short TTL, assert child gone + respawn works); dead-child
  reattach (kill -9 the child, next send succeeds); steer-mid-turn;
  elicitation round-trip (stub pi raises a dialog; test client answers);
  pi_respond fallback; concurrent sends on two names; idle-steer failure.
- Real-pi e2e: send → send (same child, faster second turn — record the
  latency delta vs 0.7.0 spawn-per-send for the ADR record), steer lands
  (GAMMA pattern), end cleans up. Suite wired into run_all.sh, all
  timeout-bounded per the Delegation Contract.
- DoD: full suite exit 0 with real-pi e2es RUN (not skipped), `claude plugin
  validate .` clean, and one live session from Claude Code itself exercising
  the MCP tools end-to-end before publish.

## 9. Build plan

- **5.1** Export core functions from pi-companion.mjs (no behavior change;
  suite green) — then server skeleton: handshake + `tools/list` + `pi_task` +
  `pi_setup`; mcp-client test lib; `.mcp.json` registration.
- **5.2** Conversation tools + registry + TTL reaper + dead-child reattach
  (send/read/status/end).
- **5.3** Steering: in-process steer/interrupt (FIFO retired server-side; CLI
  keeps its FIFO for standalone use), elicitation + `pi_respond`.
- **5.4** orchestrator-mode 0.6.1 -> 0.7.0: PI-state allowlist for
  `mcp__pi-delegate__*` (+ tests); skills/agent/README updates for the MCP-first
  surface; ADR-001 cross-reference.
- **5.5** Gate (full suites + live-session e2e + latency record), pi-delegate
  0.7.0 -> 0.8.0, publish.

## 10. Risks and open questions

- Hand-rolled conformance drift as the MCP spec evolves — pinned version +
  client-lib tests mitigate; revisit SDK adoption if the surface grows.
- TTL children hold local-model memory while warm; the reaper and a
  registry cap (default: 4 concurrent conversations, oldest-idle evicted)
  bound it. Cap + TTL are config knobs in `.claude/pi-delegate.local.md`.
- Elicitation client support is uneven — fallback path is first-class, not an
  afterthought (both paths tested).
- Claude Code restarts the MCP server on `/reload-plugins`; children die with
  it by design — reattach-is-respawn covers the continuity.
- OPEN: whether `pi_task` should also accept a `session` arg someday
  (blurring task/conversation) — deliberately excluded from 5.x scope.
- OPEN: exposing `pi_conversation_list` (enumerate sessions on disk) — small,
  deferred until needed.
