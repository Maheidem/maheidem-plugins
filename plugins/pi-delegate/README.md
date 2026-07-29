# pi-delegate

Forward a coding task from Claude Code to the locally-installed `pi` CLI
(pi.dev's `pi-coding-agent`), so the work runs on a local model instead of
Claude doing it directly. One RPC engine, a zero-dependency stdio MCP server
(keep-alive conversations, mid-turn steering, elicitation; see "MCP server"
below) is the sole facade, plus a `/pi-delegate:delegate` command that helps
size/decompose a task before dispatching it through those MCP tools.

## Commands

- `/pi-delegate:delegate <task>` — helps decompose `<task>` into
  independently-verifiable steps and dispatches each one via the
  `pi_task`/`pi_conversation_send` MCP tools, returning pi's result verbatim.
  For substantial multi-step work, prefer issuing several small MCP calls in
  sequence over one large task — `pi` is often a smaller/local model, and
  narrow, well-scoped tasks succeed far more reliably than open-ended ones.
  See `commands/delegate.md`'s "Task sizing" section. In most cases you can
  also call the MCP tools directly without going through this command.
- `/pi-delegate:setup` — checks that `pi` is on PATH, reports its version and
  the configured `defaultProvider`/`defaultModel` from
  `~/.pi/agent/settings.json`, optionally offers to install it
  (`npm install -g @earendil-works/pi-coding-agent`) after confirmation, and
  (once pi is installed) lets you view, set, or clear a per-project
  provider/model pin.

## MCP server (ADR-002)

`scripts/pi-mcp-server.mjs` is a hand-rolled, zero-dependency stdio MCP
server registered in `.mcp.json`, exposing the same runtime as typed tools:

| Tool | Purpose |
|---|---|
| `pi_task` | Stateless one-shot task (same as the CLI `task` verb). |
| `pi_conversation_send` | Send to a named keep-alive conversation (live `pi --mode rpc` child, reused across sends, TTL-reaped when idle, respawned transparently if dead). |
| `pi_conversation_read` / `pi_conversation_status` | Lock-free transcript tail / session state plus registry info and any pending question. |
| `pi_conversation_steer` / `pi_conversation_interrupt` | Mid-turn steering / abort-and-reprompt on the live child; both fail `ok:false` when the conversation is idle. |
| `pi_conversation_end` | Kill the live child, delete session file(s) and lock. |
| `pi_respond` | Answer a parked pi dialog when the client lacks elicitation support. |

pi questions (`extension_ui_request`) are raised as MCP elicitation requests
when the client declares the capability; otherwise they park as
`pendingQuestion` (surfaced by `pi_conversation_status`, answerable via
`pi_respond`), with pi's own dialog auto-cancel as the terminal fallback.
Env tunables: `PI_MCP_TTL_MS` (default 300000), `PI_MCP_REGISTRY_CAP` (4),
`PI_MCP_REAP_INTERVAL_MS` (60000). Full design: `docs/adr-002-mcp-facade.md`
(building on ADR-001 in `docs/architecture.md`).

## Per-project provider/model pin

By default every delegated task uses pi's own global default provider/model.
A project can override that by pinning a provider/model in
`.claude/pi-delegate.local.md` (YAML frontmatter):

```markdown
---
provider: zai
model: glm-4.5-air
---
```

Precedence, highest to lowest: an explicit `--provider`/`--model` flag passed
to a specific `task` call, then this project config file, then pi's own
global default from `~/.pi/agent/settings.json`.

`/pi-delegate:setup` is the primary way to view, set, or remove this pin — it
builds its picker from the real provider/model combinations `pi` reports on
your machine (`pi --list-models`) so you can never pin a typo'd, nonexistent
combination. For providers with large catalogs the picker offers an optional
name filter before paging: type a substring, it narrows the validated list,
and the pin still always comes from that list. The underlying `pi-companion.mjs` subcommands
(`list-models --json`, `write-config --provider <name> --model <name> --json`,
`remove-config --json`) exist mainly for scripting/debugging — use the
command for everyday use.

## How it works

`scripts/pi-companion.mjs` is a dependency-free Node ESM script with five
subcommands: `task`, `setup`, `list-models`, `write-config`, and
`remove-config`. `task` runs `pi` via an async `spawn` (accumulating stdout in
JS memory rather than relying on a fixed OS/Node buffer, since `pi`'s NDJSON
stream can otherwise exceed any static `maxBuffer` on large tasks; stdin is
explicitly ignored so `pi` never blocks reading it). The NDJSON stream is
always parsed to supply `finalText` (pi's actual final answer). Timeouts kill
pi's whole process group (SIGTERM, then SIGKILL after 5s) and
surface a retained progress log path for diagnosis; `--timeout` must be a
positive integer or the helper exits 2. `--json` output truncates
`rawStdout`/`rawStderr` to their last 10KB (with truncation flags). See the
`pi_task`/`pi_conversation_send` MCP tool descriptions in
`scripts/pi-mcp-server.mjs` for the full invocation and phrasing contract
(including the per-project pin), and `docs/adr-003-mcp-only.md` for how
results and failures should be presented.

Since 0.6.0 the one-shot `task` path uses RPC completion by default
(measured ~40% faster than the legacy marker contract on the same workload —
see docs/architecture.md §3 Phase 2 for the recorded numbers); the legacy
marker contract was removed entirely in 0.7.0.

## Conversations (stateful, multi-turn)

Alongside the stateless `task` path, `pi-companion.mjs` supports a
`conversation start|send|status|end` verb family for ongoing, multi-turn
work with pi under a caller-chosen conversation name. Each `send` is still a
single spawn-to-exit process (`pi --mode rpc --session-id <name>`) — nothing
stays resident between calls — but continuity is preserved via pi's own
on-disk session file, so a later `send` can pick up where the last one left
off. A per-conversation lockfile (PID-liveness only: dead-holder locks are
reclaimed automatically, live-holder locks fail loud with no wait/retry)
prevents two callers from racing the same conversation; `status` is
read-only and doesn't take the lock. Mid-turn steering (interjecting into a
turn already in progress) is supported — see `read`/`steer`/`interrupt`
below.

Use `task` for independent one-off asks; use `conversation` only when the
request is explicitly an ongoing back-and-forth under a named session. See
the `pi_conversation_send` MCP tool description for the full contract
(naming convention, locking, result fields) and `docs/adr-003-mcp-only.md`
for how lock-contention failures should be presented.

`conversation` also has three verbs for peeking at and steering a session
while a `send` is in flight: `read <name> [--last N]` renders the session's
jsonl transcript in strict file order (lock-free, safe to run mid-turn),
`steer <name> "<msg>"` injects a message into a running turn (delivered at
the next turn boundary, not instantly), and `interrupt <name> "<msg>"` aborts
the current turn and starts a new one with the given message on the same
running `send`. Both `steer` and `interrupt` require a `send` already running
for that name — otherwise they return `ok:false`, "conversation is idle — use
send" — and are backed by a FIFO that only lives for the duration of the
owning `send` call, not a resident process. The typical pattern is a
backgrounded `send` (`run_in_background`) with `read`/`steer`/`interrupt`
issued from separate calls while it's outstanding; the task notification for
the backgrounded `send` is the completion signal. See the
`pi_conversation_read`/`pi_conversation_steer`/`pi_conversation_interrupt`
MCP tool descriptions for the full contract.

## Relationship to orchestrator-mode

This plugin has **zero knowledge of `orchestrator-mode`** and works
completely standalone. The coupling is one-directional and loose:
`orchestrator-mode`'s `pi` mode allowlists any tool name prefixed
`mcp__pi-delegate__` or `mcp__plugin_pi-delegate_` so that when
orchestrator-mode is active, the main thread can still delegate to pi
through these MCP tools directly. `pi-delegate` itself doesn't reference or
depend on `orchestrator-mode` in any way.

## Tests

```bash
bash plugins/pi-delegate/tests/run_all.sh
```

Bash-driven suite (no framework) that runs the real `pi-companion.mjs`
against stubbed `pi` executables; nonzero exit on any failure.

## Scope

Foreground, one-shot task execution only. Background/async pi execution
(job tracking, `status`/`result`/`cancel` subcommands) is out of scope for
this version — not built, may be revisited later.

## Docs

See [`docs/architecture.md`](./docs/architecture.md) for the post-RPC architecture decision record (target design, 4-phase roadmap, owner decisions).
