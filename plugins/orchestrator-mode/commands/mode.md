---
description: Set orchestrator-mode (off/on/pi/wf), manage the main-thread allowlist, or show status for this project
argument-hint: "on | off | pi [pi model] | wf [sonnet, haiku ...] | models <which, in words> | allow [<pattern> | <what you want, in words>] | disallow [...] | status"
allowed-tools: Read, Write, AskUserQuestion, ToolSearch, Bash(python3 *_state.py* status *)
---

You are managing **orchestrator-mode** for the current project.

Effective configuration right now, as the plugin's hooks compute it:

```json
!`python3 "${CLAUDE_PLUGIN_ROOT}/hooks/_state.py" status "$0"`
```

Fields: `mode`; `config` (the file the hooks read, `null` if none);
`global_config` (the user-wide file); `allowed-models`; `core-tools` (built-in
main-thread tools for this mode); `core-mcp` (always-allowed pi-delegate
patterns); `global-main-allow` and `project-main-allow` (extra main-thread
patterns); `pi-pin` (pi-delegate's project model pin, `null` if unset). For
`pi`, or `models` while in pi mode, it also has a `pi` object (see "pi mode:
the model pin" below).

The project config is `<project root>/.orchestrator-mode.json`, shaped as
`{"mode": <mode>, "allowed-models": [<model>...], "main-allow": [<pattern>...]}`
(both lists optional). That shape is a schema, not this project's values:
the only source of truth for current values is the computed JSON above, or
the file itself once you Read it.

- `on`: main agent read-only; delegates via Agent/Task or Workflow.
- `wf`: read-only; delegates via the Workflow tool; Agent/Task only for the
  Explore scout.
- `pi`: read-only; no subagents; code changes through the pi-delegate MCP
  tools or `/pi-delegate:delegate`, locked to the project's pinned pi model.
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
absolute `global_config` path above), and `pi`/`models` in pi mode write the
pi-delegate pin (the absolute `pi.pin_file`), when the rules below say so. Never write
the legacy `.orchestrator-mode.state`, and never use Edit or a shell on
either config (the hook denies it; only Write is exempt).

Before any change, Read `<project root>/.orchestrator-mode.json` (missing is
fine: start from `{"mode": "off"}`). If it is missing and a legacy
`<project root>/.orchestrator-mode.state` exists, take its starting values
from that line: the first word is the mode, and the words after
`allowed-models=` are the model list.

Write the file as pretty JSON (2-space indent) with keys in the order
`mode`, `allowed-models`, `main-allow`; leave a key out when its list is empty.

### `on` / `wf` [models] and `models [...]` (outside pi mode)
`on`/`wf` set `mode`; `models` keeps the current mode and changes only
`allowed-models` (if the mode is `off`, say the list only applies once a mode
is on, and still save it). Keep `main-allow` as is.

**The model request** is everything after the verb, flag or not: the old
`--allowed-models` flag (any dashes, `-`/`_`/nothing between the words,
`model`/`models`/`modes`, `=list` or following tokens) and plain words
(`wf sonnet, haiku`, `wf only sonnet and haiku`, `models no opus`) mean the
same thing. Valid entries are the families `opus`, `sonnet`, `haiku`,
`fable`, lowercase, no duplicates, in the order given.
- **Plain names** (every word is a family, ignoring commas, `and`, `only`,
  `just`, the flag itself): write them directly, no question.
- **Anything you had to interpret** (a typo like `sonet`, an exclusion like
  `no opus` / `everything but opus`, a description like `the cheap ones`, an
  unknown name): resolve it to a list of families, then confirm with the
  **quick confirm** (below): the question quotes what the user typed; the
  "Use ..." option lists the resolved families; the full list offers all
  four families, with the excluded ones' descriptions saying why. Write what
  they choose. Never write a name that isn't a family (if they type one via
  "Other", map it to a family or ask again).
- `none` / `clear` / `any model` / `no restriction` (or the flag with no
  value) clears the list.
- **No model request:** keep the stored list, so switching modes never
  drops it. If there is no stored list AND the previous mode was `off` (or
  there was no config), write the default `["sonnet", "haiku"]` and say so
  in the report. Never for `pi`: pi mode has its own section below.
With a list set, every Agent/Task call and workflow `agent()` call must
declare an allowed model, and fork subagents are denied.

### `pi` [pi model] and `models [...]` while in pi mode: the model pin
In pi mode the model is pi's, not a Claude family: `pi_agent` is locked to
pi-delegate's project pin (`.claude/pi-delegate.local.md`), and the enforcer
ignores `allowed-models`. Never add or change `allowed-models` here (leave a
stored list as it is), and never write the `["sonnet", "haiku"]` default.

The status JSON's `pi` object: `pin` (`{provider, model}` or null),
`pin_valid` (the pin is in pi's model list), `pin_file` (absolute path to
write), `default` (pi's own default, when it's in the list), `scoped` (pi's
scoped models from `enabledModels`, already checked against
`pi --list-models`), `unmatched` (scoped patterns that matched nothing),
`all` (`{provider: [model, ...]}`, the whole list) and `error`.

1. `error` set: report it (for a missing pi, suggest `/pi-delegate:setup`)
   and stop without writing anything.
2. **Pick the model.**
   - Words after the verb name a model (`pi glm 5.3`, `models the flash
     one`): match them against `scoped`, then `all`. One exact
     `provider/model` hit: use it with no question. Otherwise quick confirm
     the closest match (below); "Let me choose" opens the picker.
   - No words and `pin_valid`: quick confirm `Use <provider>/<model>
     (Recommended)` / `Pick another`. "Pick another" opens the picker.
   - No words and a pin that isn't valid: say it's not in pi's model list
     any more, then open the picker. No pin at all: open the picker.
3. **Picker**, from `scoped` first. Options are labelled `provider/model`;
   put `default` first with "(Recommended)" when it's in `scoped`. With 1-3
   scoped models, show them all plus `Browse all models`. With more, show 3
   per page plus `More...`; the last page gets `Browse all models` instead.
   An empty `scoped` goes straight to browsing.
4. **Browse all** follows `/pi-delegate:setup`'s provider -> model picker
   over `all`: providers first (2-4 remaining: ask them all; 5 or more:
   pages of 3 plus `More providers...`; exactly one: state it and use it),
   then that provider's models the same way. A provider with more than about
   8 models first asks `Browse all (paged)` or `Filter by name`; a filter
   only narrows the list.
5. **Validate** before writing: the chosen `provider` and `model` must be a
   pair in `all`, and each must match `^[A-Za-z0-9._/:@-]+$`, not start with
   `-` and not contain `---`. A name typed via "Other" is only a search
   term; never write anything that isn't in `all`. Cancelled: write nothing.
6. **Write the pin** with Write to the absolute `pin_file`, exactly
   (pi-delegate's own format):
   ```
   ---
   provider: <provider>
   model: <model>
   ---
   ```
   Skip this write when the user kept the existing pin.
7. For `pi`, write the project config with `mode` `pi` (keep `main-allow`
   and any stored `allowed-models` untouched). `models` changes only the pin.
8. Read back what you wrote and report `pi model pin: <provider>/<model>`
   plus the `Config:` lines.

**Quick confirm** (used by `models`, `allow` and pi mode). Multi-select options start
unticked, so accepting a guess that way takes several keys. Instead ask ONE
single-select `AskUserQuestion` with two options: `Use <the resolved list>
(Recommended)` first, then `Let me choose`. On "Use", take that list as-is.
On "Let me choose", ask the full multi-select list that section describes
and take what they tick.

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
3. Confirm with the **quick confirm** (below), naming the target file in the
   question. The "Use ..." option lists the recommended entries (the
   read-only ones; if there are none, skip straight to the full list). The
   full list: `multiSelect: true`, 2-4 options per question, up to 4
   questions (group by server when there are many; if more than 16
   candidates, keep the closest matches). Each option's label is the exact
   entry; its description says what it does. Read-only options first with
   "(Recommended)" at the end of the label; side-effecting ones get "⚠️
   writes/sends:" at the start of the description and no "(Recommended)".
   Offer a server prefix `mcp__<server>__*` only when the user asked for all
   of a server, marked ⚠️ if the server has any side-effecting tool.
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
- for `status`: `Config: <config, or (no file)>`, `Mode: <mode>`, `Allowed models: <allowed-models, or none>` (in pi mode instead: `pi model pin: <pi-pin as provider/model, or none (pi's default; pi_agent may not pick a model)>`)
- `Main thread may also use: <core-mcp + global-main-allow + project-main-allow>`
- for `status` only: `Core tools (<mode>): <core-tools, comma-separated>`
If a legacy `.orchestrator-mode.state` sits next to the JSON, add: `Legacy
.orchestrator-mode.state is ignored now; delete it by hand.` Keep it terse.
The JSON above is from before this command ran; after a write, report what
you wrote.
