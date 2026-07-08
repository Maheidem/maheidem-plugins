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
  `~/.pi/agent/settings.json`, and optionally offers to install it
  (`npm install -g @earendil-works/pi-coding-agent`) after confirmation.

## How it works

`scripts/pi-companion.mjs` is a dependency-free Node ESM script with two
subcommands, `task` and `setup`. `task` runs `pi` via `spawnSync`, parses its
NDJSON output stream, and returns a structured result — because `pi` exits 0
even on internal errors, the script never trusts the exit code alone; it
inspects the last `agent_end` event's final message for `stopReason: "error"`.
See `skills/pi-cli-runtime/SKILL.md` for the full invocation contract and
`skills/pi-result-handling/SKILL.md` for how results and failures are
presented.

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
