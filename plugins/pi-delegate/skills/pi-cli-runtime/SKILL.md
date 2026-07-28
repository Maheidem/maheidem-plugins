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
if unset) and passed to Node's `spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })`.

## Execution model

- Foreground only. The helper uses an async `spawn` (`await`ed to completion,
  not backgrounded), one process per `task` call, and returns only after pi
  exits or the timeout fires. It deliberately does NOT use `spawnSync`: that
  imposes a fixed `maxBuffer` ceiling on captured stdout, and `pi`'s `--mode
  json` NDJSON stream re-emits the full accumulated assistant message on every
  `text_delta` event, so output size can grow well past any static cap on
  large/multi-step tasks. The async version accumulates stdout as JS-memory
  chunks instead, which has no such ceiling. Its `stdio` is explicitly
  `["ignore", "pipe", "pipe"]` — `pi` reads/checks stdin at startup, and
  `spawn()`'s default of an open, unfed stdin pipe makes it block forever;
  ignoring stdin is required, not stylistic.
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
- **Progress log**: during a run the helper appends one line per NDJSON
  event-type transition to `os.tmpdir()/pi-companion-progress-<pid>.log`. The
  file is deleted on normal exit but **retained on timeout**, and its path is
  surfaced in the result's `progressLogPath` field (and appended to the
  timeout `errorMessage`) so a stalled run can be diagnosed after the fact.
- **Background execution, job tracking, and `status`/`result`/`cancel`
  subcommands do not exist in this version.** That is a v2 idea, not built
  now — do not imply it exists or try to invoke it.

## Result contract

`task --json` always prints one stable JSON shape, on every path (success,
failure, ENOENT, timeout, spawn error):

```json
{
  "ok": true,
  "degraded": false,
  "markerMissing": false,
  "markerExitMismatch": false,
  "finalText": "...",
  "summary": "...",
  "nextSteps": [],
  "errorMessage": null,
  "exitCode": 0,
  "willRetry": null,
  "completionMarker": {},
  "progressLogPath": null,
  "rawStdout": "...",
  "rawStderr": "...",
  "rawStdoutTruncated": false,
  "rawStderrTruncated": false
}
```

Field meanings:

- `finalText` — pi's actual final assistant text, taken from the NDJSON
  stream when available (falls back to the marker's `summary` if the stream
  had no final text).
- `summary` / `nextSteps` — metadata from the completion marker (`summary` is
  `null` and `nextSteps` is `[]` when no marker was written). These describe
  the work; `finalText` *is* pi's answer.
- `degraded` — `true` when success was inferred without a clean completion
  marker (see decision matrix below). Treat as "completed, but verify".
- `markerMissing` — the marker file was absent or malformed.
- `markerExitMismatch` — the marker said `ok` but pi exited nonzero; the run
  is treated as a failure.
- `progressLogPath` — set only on timeout (see above); otherwise `null`.
- `rawStdout`/`rawStderr` — truncated to the **last 10KB** each, with the
  matching `*Truncated` flag set when truncation occurred. Full stdout is
  never emitted in `--json` output.

### Completion-marker contract (primary signal)

Every `task` invocation automatically appends a completion-marker instruction
to the task text, telling `pi` to write a JSON report file as its ABSOLUTE
LAST action. The helper treats this file as the PRIMARY success signal:

- **Path**: A unique, per-invocation path under `os.tmpdir()`:
  `/tmp/pi-delegate-result-<uuid>.json` (generated via `crypto.randomUUID()`
  so concurrent runs never collide).
- **Schema** (written by `pi`):
  ```json
  {
    "status": "ok" | "error",
    "summary": "one or two sentence description of what was done, or why it failed",
    "nextSteps": ["optional", "array", "of", "recommended", "follow-ups"]
  }
  ```
- **Resolution decision matrix** (done by the helper after `pi` exits; the
  NDJSON stream is always interpreted, not just on fallback):
  1. Marker valid, `status: "ok"`, exit code 0 → `ok: true, degraded: false`.
     `finalText` comes from the NDJSON stream's final assistant text when
     non-empty, else from `marker.summary`; `summary`/`nextSteps` forwarded.
  2. Marker valid, `status: "ok"`, but exit code nonzero → `ok: false,
     markerExitMismatch: true`. The exit code wins over the marker's claim;
     `finalText`/`summary` are kept as diagnostics only.
  3. Marker valid, `status: "error"` → `ok: false`, `errorMessage` =
     `marker.summary`.
  4. Marker missing/malformed, but the NDJSON stream shows a clean run and
     exit code is 0 → **degraded success**: `ok: true, degraded: true,
     markerMissing: true`, `finalText` from the stream, and a `warning` field
     carrying the marker-failure reason.
  5. Marker missing and the stream is not clean (or exit code nonzero) →
     `ok: false` with a combined marker-error + NDJSON-fallback message.
- The marker file is always deleted after each run, on **every** exit path
  (success, error, ENOENT, timeout).
- **Timeout caveat**: because the kill goes to the whole process group, pi may
  have written the marker just before dying. On timeout the helper still
  attempts to read it — the run stays `ok: false`, but if a marker was found
  its `status`/`summary` are surfaced in `completionMarker`/`summary` and the
  `errorMessage` notes it should be treated with caution.

### NDJSON stream parsing

The NDJSON stream is no longer "fallback only": it is interpreted on **every**
run. On marker success it supplies `finalText` (pi's real answer, richer than
the marker's one-line `summary`); on a missing/malformed marker it can upgrade
the run to degraded success (case 4 above) or provide failure diagnostics.
The interpretation:

1. Splits stdout on newlines, parses each non-empty line as JSON, and skips
   (does not throw on) any line that isn't valid JSON.
2. Finds the last `agent_end` event in the stream. If none is found (e.g. the
   process was killed mid-stream), that's a hard failure, not a silent success.
3. Takes the last message from `agent_end.messages`.
4. If that message's `stopReason` is `"error"`, the run failed — the helper
   surfaces `errorMessage` verbatim.
5. Otherwise the stream is "clean" — the helper's `finalText` is the
   concatenation of that message's `{"type":"text"}` content items.

The completion marker remains the primary *success* signal; the stream is the
primary source of `finalText` and the safety net when the marker is absent.

The subagent should not re-parse pi's stdout itself; it only needs to run the
helper with `--json` and act on the structured result it returns.
