# pi-delegate

Forward a coding task from Claude Code to the locally-installed `pi` CLI
(pi.dev's `pi-coding-agent`), so the work runs on a local model instead of
Claude doing it directly. A thin, foreground-only, one-shot subprocess
wrapper — not a persistent broker, not a JSON-RPC server.

## Commands

- `/pi-delegate:delegate <task>` — forwards `<task>` to the `delegate`
  subagent, which runs it through `pi -p --mode json --no-session` and
  returns pi's result verbatim. For substantial multi-step work, prefer
  issuing several small, independently-verifiable `/pi-delegate:delegate`
  calls in sequence over one large task — `pi` is often a smaller/local
  model, and narrow, well-scoped tasks succeed far more reliably than
  open-ended ones. See `commands/delegate.md`'s "Task sizing" section.
- `/pi-delegate:setup` — checks that `pi` is on PATH, reports its version and
  the configured `defaultProvider`/`defaultModel` from
  `~/.pi/agent/settings.json`, optionally offers to install it
  (`npm install -g @earendil-works/pi-coding-agent`) after confirmation, and
  (once pi is installed) lets you view, set, or clear a per-project
  provider/model pin.

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
explicitly ignored so `pi` never blocks reading it), and uses a
**completion-marker contract** as the primary success signal: every task
automatically instructs `pi` to write a JSON report file (`/tmp/pi-delegate-result-<uuid>.json`)
as its last action. The marker (cross-checked against pi's exit code — a
marker that says "ok" but a nonzero exit is treated as failure) determines
success/failure, while the NDJSON stream is always parsed too: it supplies
`finalText` (pi's actual final answer) even on marker success, and when the
marker is missing but the stream shows a clean run, the result is a
**degraded success** (`ok: true, degraded: true` — completed, but verify).
Timeouts kill pi's whole process group (SIGTERM, then SIGKILL after 5s) and
surface a retained progress log path for diagnosis; `--timeout` must be a
positive integer or the helper exits 2. `--json` output truncates
`rawStdout`/`rawStderr` to their last 10KB (with truncation flags). See
`skills/pi-cli-runtime/SKILL.md` for the full invocation contract
(including the per-project pin and completion-marker schema) and
`skills/pi-result-handling/SKILL.md` for how results and failures are presented.

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
`skills/pi-cli-runtime/SKILL.md`'s "Conversation runtime" section for the
full contract (naming convention, locking, result fields) and
`skills/pi-result-handling/SKILL.md` for how lock-contention failures should
be presented.

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
the backgrounded `send` is the completion signal. See
`skills/pi-cli-runtime/SKILL.md`'s "Reading, steering, and interrupting a
live conversation" section for the full contract.

## Relationship to orchestrator-mode

This plugin has **zero knowledge of `orchestrator-mode`** and works
completely standalone. The coupling is one-directional: `orchestrator-mode`'s
`pi` mode allowlists the exact subagent_type `"pi-delegate:delegate"` so that
when orchestrator-mode is active, the main thread can still delegate to pi.
`pi-delegate` itself doesn't reference or depend on `orchestrator-mode` in
any way.

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
