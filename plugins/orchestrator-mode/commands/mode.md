---
description: Set orchestrator-mode (off/on/pi/wf), manage the main-thread allowlist, or show status for this project
argument-hint: "on | off | pi | wf [--allowed-models m1,m2] | allow <pattern> | disallow <pattern> | status"
allowed-tools: Read, Write
---

You are managing **orchestrator-mode** for the current project.

Effective configuration right now, as the plugin's hooks compute it:

```json
!`python3 "${CLAUDE_PLUGIN_ROOT}/hooks/_state.py" status`
```

Fields: `mode`; `config` (the file the hooks read, `null` if none);
`global_config` (the user-wide file); `allowed-models`; `core-tools` (built-in
main-thread tools for this mode); `core-mcp` (always-allowed pi-delegate
patterns); `global-main-allow` and `project-main-allow` (extra main-thread
patterns).

The project config is `<project root>/.orchestrator-mode.json`, shaped as
`{"mode": <mode>, "allowed-models": [<model>...], "main-allow": [<pattern>...]}`
(both lists optional). That shape is a schema, not this project's values:
the only source of truth for current values is the computed JSON above, or
the file itself once you Read it.

- `on`: main agent read-only; delegates via Agent/Task or Workflow.
- `wf`: read-only; delegates via the Workflow tool; Agent/Task only for the
  Explore scout.
- `pi`: read-only; no subagents; code changes through the pi-delegate MCP
  tools or `/pi-delegate:delegate`.
- `off`: normal behavior.
- `main-allow`: extra tools the main thread may use in this project. Each
  entry is an exact tool name, or a prefix ending in `*`
  (`mcp__okto-neuron__*`). Additive to the user-wide file's `main-allow`.

The requested action is: **$ARGUMENTS** (empty or unrecognized means `status`).

## Rules

Do this YOURSELF on the main thread with Read and Write. Never delegate it,
even if an orchestration reminder says to. Use the ABSOLUTE path
`<project root>/.orchestrator-mode.json` (project root = `CLAUDE_PROJECT_DIR`
or the working directory). Writing it triggers the normal permission prompt
even while the lock is active; that is expected. It is the only file you may
write. Never write the user-wide file or the legacy `.orchestrator-mode.state`.

Before any change, Read `<project root>/.orchestrator-mode.json` (missing is
fine: start from `{"mode": "off"}`). If it is missing and a legacy
`<project root>/.orchestrator-mode.state` exists, take its starting values
from that line: the first word is the mode, and the words after
`allowed-models=` are the model list.

Write the file as pretty JSON (2-space indent) with keys in the order
`mode`, `allowed-models`, `main-allow`; leave a key out when its list is empty.

### `on` / `pi` / `wf` [--allowed-models ...]
Set `mode`. Keep `main-allow` as is. For `allowed-models`:
- The flag is lenient: any number of leading dashes, `-`/`_`/nothing between
  the words, `model`/`models`/`modes`. The value is `=list` or the tokens
  after the flag, split on commas and/or spaces. Lowercase, strip, drop empty
  entries and duplicates (keep order).
- `none`, or the flag with no value, clears the list.
- Flag absent: keep the stored list (switching modes never silently drops it).
With a list set, every Agent/Task call and workflow `agent()` call must
declare an allowed model, and fork subagents are denied.

### `off`
Set `mode` to `off` and remove `allowed-models`. Keep `main-allow`.

### `allow <pattern>` / `disallow <pattern>`
`allow` appends the pattern to `main-allow` if absent (mode unchanged; a new
file starts as `off`). Reject, without writing, a pattern with `*` anywhere
but the end, or a bare `*` (say: use `/orchestrator-mode:mode off` instead).
`disallow` removes an exact entry; if it isn't in the project list, say so,
and if it is in `global-main-allow` say it lives in the user-wide file, which
the user edits by hand.

### `status`
Don't write or Read anything. Report only values from the computed JSON above.

## Report

One result line, then:
- after a write: `Config: <absolute path> -> <exact JSON written>`
- for `status`: `Config: <config, or (no file)>`, `Mode: <mode>`, `Allowed models: <allowed-models, or none>`
- `Main thread may also use: <core-mcp + global-main-allow + project-main-allow>`
- for `status` only: `Core tools (<mode>): <core-tools, comma-separated>`
If a legacy `.orchestrator-mode.state` sits next to the JSON, add: `Legacy
.orchestrator-mode.state is ignored now; delete it by hand.` Keep it terse.
The JSON above is from before this command ran; after a write, report what
you wrote.
