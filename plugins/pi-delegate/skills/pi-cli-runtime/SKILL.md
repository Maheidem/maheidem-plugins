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
  the project config file (creates `.claude/` if needed).
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
- **Background execution, job tracking, and `status`/`result`/`cancel`
  subcommands do not exist in this version.** That is a v2 idea, not built
  now — do not imply it exists or try to invoke it.

## Result contract

`pi --mode json` streams NDJSON (one JSON object per line), and the process
exits 0 even when pi hit an internal error — the failure only shows up inside
the stream. The helper already does the correct parsing for you:

1. Splits stdout on newlines, parses each non-empty line as JSON, and skips
   (does not throw on) any line that isn't valid JSON.
2. Finds the last `agent_end` event in the stream. If none is found (e.g. the
   process was killed mid-stream), that's a hard failure, not a silent success.
3. Takes the last message from `agent_end.messages`.
4. If that message's `stopReason` is `"error"`, the run failed — the helper
   surfaces `errorMessage` verbatim.
5. Otherwise the run succeeded — the helper's `finalText` is the concatenation
   of that message's `{"type":"text"}` content items.

The subagent should not re-parse pi's stdout itself; it only needs to run the
helper with `--json` and act on the structured result it returns.
