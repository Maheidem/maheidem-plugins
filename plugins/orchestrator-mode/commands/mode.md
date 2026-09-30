---
description: Set orchestrator-mode (off/on/pi/wf), manage the main-thread allowlist, or show status for this project
argument-hint: "on | off | pi | wf [--allowed-models m1,m2] | allow [<pattern> | <what you want, in words>] | disallow [...] | status"
allowed-tools: Read, Write, AskUserQuestion, ToolSearch, Bash(python3 *_state.py* status)
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
write, except that `allow`/`disallow` may write the user-wide file (the
absolute `global_config` path above) when the rules below say so. Never write
the legacy `.orchestrator-mode.state`, and never use Edit or a shell on
either config (the hook denies it; only Write is exempt).

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

### `allow` / `disallow`
Entries are exact tool names, or a prefix ending in `*`. Reject, without
writing, a `*` anywhere but the end, or a bare `*` (say: use
`/orchestrator-mode:mode off` instead). `allow` never changes `mode` (a new
project file starts as `off`).

**Target file.** The project file, unless the user's words ask for
everywhere / globally / all projects / user-wide: then the user-wide file
(`global_config` above; it holds only `{"main-allow": [...]}`, pretty JSON).
Read the target before writing it (missing is fine).

**Direct form.** When the argument is ONE token that starts with `mcp__`, or
is the exact name of a tool you have, it is a pattern: `allow` appends it to
the project `main-allow` if absent; `disallow` removes that exact entry from
the project list (if it is only in `global-main-allow`, remove it from the
user-wide file instead). No questions.

**Wizard form.** Anything else is a request in plain words. A bare `allow` or
`disallow` first asks the user, in one line, what they want.

For `allow`:
1. Find REAL tool names that fit the request: your own tool list, the
   deferred tool names you've been told about, and `ToolSearch` keyword
   queries (e.g. the server or product name) to find MCP tools. Never invent
   a name. Drop tools the main thread already has (`core-tools`, `core-mcp`,
   `global-main-allow`, and `project-main-allow` unless the target is the
   user-wide file). If nothing fits, say so and stop.
2. Sort each candidate: read-only (read/get/list/search/status/query/fetch)
   or side-effecting (anything that sends, writes, creates, updates, edits,
   deletes, posts, publishes, runs or executes). Read-only is the default
   unless the user explicitly asked for writes or sends.
3. Ask with `AskUserQuestion`, `multiSelect: true`, 2-4 options per question
   and up to 4 questions (group by server when there are many; if more than
   16 candidates, keep the closest matches). Each option's label is the exact
   entry; its description says what it does. Put read-only options first
   with "(Recommended)" at the end of the label; side-effecting ones get
   "⚠️ writes/sends:" at the start of the description and no
   "(Recommended)". Offer a server prefix `mcp__<server>__*` only when the
   user asked for all of a server, marked ⚠️ if the server has any
   side-effecting tool. Name the target file in the question text.
4. Append the chosen entries (skip ones already there), Write the target,
   Read it back, and report from what you read. Nothing chosen: write nothing.
5. If the target was the user-wide file and any entry you just added is also
   in `project-main-allow`, ask one yes/no `AskUserQuestion`: "Also remove
   the now-redundant project entries: <list>?" On yes, remove them from the
   project file, Write, Read it back, and report.

For `disallow` in words: gather the entries in `project-main-allow` and
`global-main-allow` that fit the request, ask with the same picker (label =
entry; description says which file it lives in), remove the chosen ones from
the file each lives in, Write, Read back, and report.

### `status`
Don't write or Read anything. Report only values from the computed JSON above.

## Report

One result line, then:
- after a write: `Config: <absolute path> -> <exact JSON read back>` (one
  line per file written)
- for `status`: `Config: <config, or (no file)>`, `Mode: <mode>`, `Allowed models: <allowed-models, or none>`
- `Main thread may also use: <core-mcp + global-main-allow + project-main-allow>`
- for `status` only: `Core tools (<mode>): <core-tools, comma-separated>`
If a legacy `.orchestrator-mode.state` sits next to the JSON, add: `Legacy
.orchestrator-mode.state is ignored now; delete it by hand.` Keep it terse.
The JSON above is from before this command ran; after a write, report what
you wrote.
