# pi-delegate

Forward a coding task from Claude Code to the locally-installed `pi` CLI
(pi.dev's `pi-coding-agent`), so the work runs on a local model instead of
Claude doing it directly. A thin, foreground-only, one-shot subprocess
wrapper — not a persistent broker, not a JSON-RPC server.

## Commands

- `/pi-delegate:delegate <task>` — forwards `<task>` to the `delegate`
  subagent, which runs it through `pi -p --mode json --no-session` and
  returns pi's result verbatim.
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
combination. The underlying `pi-companion.mjs` subcommands
(`list-models --json`, `write-config --provider <name> --model <name> --json`,
`remove-config --json`) exist mainly for scripting/debugging — use the
command for everyday use.

## How it works

`scripts/pi-companion.mjs` is a dependency-free Node ESM script with five
subcommands: `task`, `setup`, `list-models`, `write-config`, and
`remove-config`. `task` runs `pi` via an async `spawn` (accumulating stdout in
JS memory rather than relying on a fixed OS/Node buffer, since `pi`'s NDJSON
stream can otherwise exceed any static `maxBuffer` on large tasks; stdin is
explicitly ignored so `pi` never blocks reading it), parses the resulting
NDJSON output stream, and returns a structured result — because `pi` exits 0
even on internal errors, the script never trusts the exit code alone; it
inspects the last `agent_end` event's final message for `stopReason: "error"`.
See `skills/pi-cli-runtime/SKILL.md` for the full invocation contract
(including the per-project pin) and `skills/pi-result-handling/SKILL.md` for
how results and failures are presented.

## Relationship to orchestrator-mode

This plugin has **zero knowledge of `orchestrator-mode`** and works
completely standalone. The coupling is one-directional: `orchestrator-mode`'s
`pi` mode allowlists the exact subagent_type `"pi-delegate:delegate"` so that
when orchestrator-mode is active, the main thread can still delegate to pi.
`pi-delegate` itself doesn't reference or depend on `orchestrator-mode` in
any way.

## Scope

Foreground, one-shot task execution only. Background/async pi execution
(job tracking, `status`/`result`/`cancel` subcommands) is out of scope for
this version — not built, may be revisited later.
