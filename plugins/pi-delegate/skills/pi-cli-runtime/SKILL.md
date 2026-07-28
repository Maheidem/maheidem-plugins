---
name: pi-cli-runtime
description: Internal helper contract for calling the pi-companion runtime from Claude Code
user-invocable: false
---

# pi Runtime

Use this skill only inside the `pi-delegate:delegate` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/pi-companion.mjs" task "<task text>" --json`

## Invocation shape

The helper shells out to the local `pi` CLI (pi.dev's `pi-coding-agent`) as:

```
pi -p --mode json --no-session "<the task text>"
```

plus, only when the caller explicitly names them:

```
--provider <name>
--model <pattern>
--thinking <off|minimal|low|medium|high|xhigh>
--tools <t1,t2,...>
--exclude-tools <t1,t2,...>
```

If the caller does not name a provider/model/thinking/tools setting, omit that
flag entirely so pi's own configured default (from `~/.pi/agent/settings.json`)
applies. Never hardcode a specific provider or model as a default in the
wrapper or in this subagent's behavior.

## Per-project provider/model pin

`pi-companion.mjs` also reads an optional per-project config file,
`<project>/.claude/pi-delegate.local.md`, with YAML frontmatter:

```markdown
---
provider: zai
model: glm-4.5-air
---
```

Both keys are optional. Precedence for `provider`/`model` on every `task` call
is three-tier:

1. An explicit `--provider`/`--model` flag passed to that specific `task` call
   (highest).
2. This project config file, if present.
3. pi's own global default from `~/.pi/agent/settings.json` (lowest — used
   when neither of the above is set).

The config file is managed through `/pi-delegate:setup`, which is the primary
interface for viewing, setting, or clearing this pin — it drives a picker
built from `pi --list-models` so the provider/model always come from a real,
validated combination rather than free-typed text (a mistyped provider name
silently falls through to the default; a mistyped model name hard-fails pi at
run time). The same functionality is exposed as three `pi-companion.mjs`
subcommands, mainly for scripting/debugging rather than everyday use:

- `list-models --json` — enumerate real provider/model combinations available
  on this machine, via `pi --list-models`.
- `write-config --provider <name> --model <name> --json` — write/overwrite
  the project config file (creates `.claude/` if needed). Arguments are
  strict: only `--provider`, `--model`, and `--json` are accepted (anything
  else exits 2), and values are validated — no whitespace, no leading `-`,
  no newlines/`---`, only `[A-Za-z0-9._/:@-]`. Invalid values are rejected
  with `ok: false` rather than written. The same validation is applied when
  *reading* provider/model from the project config: an unsafe value is
  ignored (with a stderr warning) instead of being passed to `pi`.
- `remove-config --json` — delete the project config file if present.

`setup --json` also reports the current pin state via `projectConfigPath` /
`projectConfigFound` / `projectConfigProvider` / `projectConfigModel`.

`pi` has no `--cwd` flag. The working directory is resolved from the
`CLAUDE_PROJECT_DIR` environment variable (falling back to `process.cwd()`
if unset) and passed to Node's `spawn` as `cwd`; stdin is piped (the helper
writes RPC command lines to it), stdout/stderr are captured.

## Execution model

- Foreground only. The helper uses an async `spawn` (`await`ed to completion,
  not backgrounded), one process per `task` call, and returns only after pi
  settles or the timeout fires. It deliberately does NOT use `spawnSync`: that
  imposes a fixed `maxBuffer` ceiling on captured stdout, and pi's RPC event
  stream (`message_update` deltas re-emitting accumulated text) can grow well
  past any static cap on large tasks; the async version accumulates stdout as
  JS-memory chunks instead, with a 10KB tail kept in the result.
- Default timeout is 600000 ms (600s). Callers may override with `--timeout <ms>`.
  The value is validated strictly: anything that isn't a finite positive
  integer (`0`, `-5`, `abc`, …) makes the helper print a usage error and exit
  with status 2 rather than silently falling back to the default.
- **Timeout kill semantics**: `pi` is spawned `detached` in its own process
  group. On timeout the helper sends `SIGTERM` to the whole group, then
  escalates to `SIGKILL` after 5 seconds if the group hasn't exited. The
  helper resolves on the child's `exit` event (with a short grace window for
  stdio to flush), so a grandchild holding the pipes open can never hang the
  helper.

- **Background execution, job tracking, and `status`/`result`/`cancel`
  subcommands do not exist in this version.** That is a v2 idea, not built
  now — do not imply it exists or try to invoke it.

## Result contract

`task --json` always prints one stable JSON shape, on every path (success,
failure, ENOENT, timeout, spawn error):

```json
{
  "ok": true,
  "finalText": "...",
  "summary": null,
  "errorMessage": null,
  "warning": null,
  "exitCode": 0,
  "sessionName": null,
  "sessionId": null,
  "turnCount": null,
  "lockHeldByPid": null,
  "steered": [],
  "interrupted": false,
  "rawStdout": "...",
  "rawStderr": "...",
  "rawStdoutTruncated": false,
  "rawStderrTruncated": false
}
```
(session fields/`steered`/`interrupted` are populated on `conversation` results and defaulted on `task` results — same shape everywhere).

- `finalText` — pi's actual final assistant text, from the
  `get_last_assistant_text` RPC call.
- `summary` — metadata about the work; `finalText` *is* pi's answer.
- `rawStdout`/`rawStderr` — truncated to the **last 10KB** each, with the
  matching `*Truncated` flag set when truncation occurred. Full stdout is
  never emitted in `--json` output.

## Task completion (RPC)

The `task` verb now completes via the RPC path by default (`pi --mode rpc
--no-session`): prompt → `agent_settled` → `get_last_assistant_text`, with no
marker file involved. The
legacy marker contract was removed in 0.7.0 (Phase 3, docs/architecture.md §3);
passing `--marker` now exits 2 with a removal notice. Both RPC paths (`task` default and `conversation
send`) additionally guard against silently-failed turns: if the event stream
shows a final `stopReason:"error"` or an exhausted auto-retry
(`auto_retry_end` with `success:false`), the result is `ok:false` with
`errorMessage` prefixed `pi turn failed:` — even though the stream settles
cleanly and `get_last_assistant_text` succeeds with empty text.

### RPC event stream

Both verbs speak pi's RPC protocol over stdin/stdout as strict-LF JSONL. The
helper parses each line as JSON, tolerating and skipping any non-JSON or
unknown-event lines (garbage in the stream cannot break a run). `finalText`
comes from the `get_last_assistant_text` RPC call after `agent_settled` — never
from re-assembling stream deltas. Failure detection reads the events: a run
whose final assistant `stopReason` is "error", or whose auto-retry exhausts
(`auto_retry_end` with `success:false`), is reported `ok:false` (`pi turn
failed: ...`) even though the stream settles cleanly; a child that dies
mid-stream fails immediately (no timeout wait) with a stream-ended error.

The subagent should not re-parse pi's stdout itself; it only needs to run the
helper with `--json` and act on the structured result it returns.

## Conversation runtime (`conversation start|send|status|end`)

This is the stateful counterpart to `task`. `task` is stateless and
one-shot (`--no-session`); `conversation` gives you a **named, resumable**
pi session backed by pi's own on-disk session file
(`~/.pi/agent/sessions/<cwd-slug>/<timestamp>_<name>.jsonl`), driven over
`pi --mode rpc --session-id <name>`. Use `conversation` only when the
caller's request is explicitly an ongoing back-and-forth, not for
independent one-off asks — those stay on `task`.

```
node pi-companion.mjs conversation start <name> [--message "<text>"] [--json]
                                              [--provider <name>] [--model <pattern>]
                                              [--thinking <level>] [--timeout <ms>]
node pi-companion.mjs conversation send <name> "<message text>" [--json] [--timeout <ms>]
node pi-companion.mjs conversation status <name> [--json]
node pi-companion.mjs conversation end <name> [--json]
```

- **`start <name>`** — creates (or reuses, if `<name>` already exists) a
  session identified by `<name>`, optionally sending an initial `--message`.
  `--provider`/`--model`/`--thinking` follow the same three-tier precedence
  and `isSafeArgValue` validation as `task`.
- **`send <name> "<message>"`** — the main workhorse. Spawns pi fresh for
  this one turn (`--session-id <name>`), writes the prompt, waits for the
  turn to fully settle, asks pi for its last assistant text, then lets the
  child exit. Nothing stays resident between calls — continuity lives
  entirely in pi's session file on disk, not in a live process.
- **`status <name>`** — read-only session state/stats (model, message
  count, session id, etc.). Does not require or take the conversation lock,
  so it's safe to run even while a `send` is in flight.
- **`end <name>`** — deletes the session file and the conversation's
  lockfile. Use when the conversation is done.

### Naming convention

`<name>` is a caller-chosen string, not a generated UUID — pick something
namespaced and meaningful to the task (e.g. `refactor-auth`, not `session1`).
Names are scoped per project working directory, not globally: two different
projects can reuse the same conversation name without colliding, but two
unrelated conversations in the *same* project sharing a name is a real
collision — reusing a name resumes whatever session already has that name in
this project (or creates it, if new). Prefer conversation names that are
unlikely to be reused for a different purpose within the same project.

### Locking

Every `start`, `send`, and `end` call acquires a per-conversation, per-project
lockfile before touching the session, and releases it when done. Locking
policy is **PID-liveness only**: a lock held by a process that's still alive
fails loud immediately (no wait, no retry, no wall-clock timeout); a lock left
behind by a dead process is detected and reclaimed automatically. There is no
"steal a live lock" path.

If a call fails due to lock contention, the result carries `lockHeldByPid`
set to the PID that holds it — see `pi-result-handling` for how to present
that to the user. `status` never takes the lock, so it can always report
state even while another call is mid-turn.

### Reading, steering, and interrupting a live conversation

Three more verbs, alongside `start`/`send`/`status`/`end`:

```
node pi-companion.mjs conversation read <name> [--last N] [--json]
node pi-companion.mjs conversation steer <name> "<message>" [--json]
node pi-companion.mjs conversation interrupt <name> "<message>" [--json]
```

**`read <name> [--last N]`** — renders the session's jsonl transcript.
Lock-free, like `status`: it only reads the file off disk, so it works
whether or not a `send` is currently mid-turn for that name, and never
contends with one.

- Resolves the session file the same way `end` does (glob for
  `*_<name>.jsonl` in the project's session dir); if more than one file
  matches, picks the most recently modified one and adds a `warning` noting
  the ambiguity rather than silently guessing.
- Parses the jsonl tolerantly — an unparseable/torn trailing line (the file
  can be mid-flush during a live turn) is skipped and counted, not thrown on.
- **Renders strictly in file order, never re-sorted by timestamp.** A
  steered message is timestamped at the moment it was enqueued but lands in
  the file at its actual delivery point, later in the stream — sorting by
  timestamp would show it out of the order it actually took effect in. This
  is the single most load-bearing rendering rule; do not "fix" the order.
- Each entry renders as `HH:MM:SS role: gist` (role/content come from
  `message.role`/`message.content` — the jsonl's own `entry.type` is always
  `"message"` and is not a role marker). Tool calls render as
  `[tool:NAME args-gist]`, with a gist of the tool result appended when
  present. A tool call with **no result yet** (mid-turn) renders as
  `(pending)`, not an error — this is expected while a turn is in flight, not
  a stall signal.
- `--json` returns full structured entries (`{timestamp, role, gist, raw}`)
  instead of the gisted text form; `--last N` slices to the last N entries
  either way, applied after the full parse.

**`steer <name> "<message>"`** — injects a message into a `send` that is
currently mid-turn for that conversation name, without waiting for delivery.
Returns immediately (`ok:true, queued:true`). The message is only actually
delivered to the model at the next turn boundary — after any in-flight tool
call finishes — not instantly; don't expect it to interrupt a running tool.
If no `send` is in flight for that name (no live FIFO/lock), it returns
`ok:false` with `"conversation is idle — use send"` rather than silently
succeeding into a pipe nobody reads.

**`interrupt <name> "<message>"`** — aborts the in-flight turn (~150ms,
confirmed against real pi) and immediately starts a new turn with the given
message on the same running `send`. The eventual `send` result's `finalText`
reflects the **new** turn, not the aborted one. Same idle behavior as `steer`
when nothing is running for that name.

Both `steer` and `interrupt` validate the message (non-empty, bounded size)
and check the owning `send`'s liveness via its lockfile PID before writing —
existence of a FIFO file alone is not treated as liveness (a crashed `send`
can leave one behind with no reader).

### Result contract (extends `task`'s shape)

`conversation` calls reuse the exact same JSON result shape as `task`
(`ok`, `finalText`, `errorMessage`, `exitCode`, `rawStdout`/`rawStderr`,
etc.), plus these additional fields, which are always present but only
populated on the conversation path:

- `sessionName` — the conversation name passed in.
- `sessionId` — pi's own reported session id, once known (a direct
  passthrough of `get_state.data.sessionId`, which is literally the
  `--session-id` value used, not a derived UUID).
- `turnCount` — number of user turns so far, mapped from
  `get_session_stats.data.userMessages` when available (there is no
  `turnCount` field in pi's own RPC responses — this is derived, not
  passed through).
- `lockHeldByPid` — set only when a call failed due to lock contention,
  otherwise `null`.
- `steered` — array of messages relayed into that turn via `steer` (only
  populated on `send`'s result; empty otherwise).
- `interrupted` — `true` if that `send` call had its turn interrupted and
  restarted via `interrupt`; `false` otherwise.
