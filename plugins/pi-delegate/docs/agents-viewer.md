# Native pi children viewer

## Supported surface and command

Claude Code mods require 2.1.287 or later and can draw panes in the terminal and
Desktop, not VS Code chat or headless sessions:
https://code.claude.com/docs/en/plugins/mods/overview

The viewer uses `hooks/hooks.json`'s `modules` entry, `ui.render`/`$.ui.resolve`,
`$.ui.open`, buttons and input fields, and a `$.clock.every` timer:
https://code.claude.com/docs/en/plugins/mods/interface
https://code.claude.com/docs/en/plugins/mods/api

The exact invocation is **`/pi-delegate:agents`**. `commands/agents.md` provides
the namespaced command, and the mod handles `command.run` with that exact matcher,
opens its pane and returns `{}`. The Markdown body is suppressed, with no model
turn. This was verified in a real 2.1.287 terminal session loaded with
`--plugin-dir`. `$.command.register` is deliberately NOT used: a real experiment
with `name: 'pi-delegate:agents'` failed despite passing static validation:

```
pi-delegate: session.start hook skipped: threw pi-delegate:
$.command.register takes { name, description, argumentHint?, immediate? };
name is letters, digits, _ or...
```

The command hook itself is documented at:
https://code.claude.com/docs/en/plugins/mods/reference#commands-and-configuration

## Data and safety

Child reads use only `$.fs.list/read`: child `meta.json`, `events.jsonl`,
`results/<gen>-<turn>.md`, and the recorded pi session JSONL. No MCP server is
started by the viewer, no events are acknowledged, and nothing is written by
viewing. Claude Code itself normally starts a plugin's configured MCP server;
this viewer does not create an additional one. The scope is project-wide, not
just the current Claude session. State is the last persisted state, not an
independent process-liveness diagnosis. Age is the child's creation age.

Journal questions are restricted to the current generation/turn and exclude
answered/expired calls. Result is the most recently completed turn; transcript
shows the last 20 messages, events the last 30. Detail text is capped at 24,000
characters and control characters are stripped. Up to 200 child directories are
considered. Reads tolerate partial JSONL tails, malformed metadata and deletion
between refreshes. Full files are read before display truncation; very large
sessions/journals can therefore slow refreshing.

## Explicit actions

Controls appear only when `meta.ownerClaudeSession` equals `$.session.id()`.
Foreign or unknown owners show a read-only reason. Appropriate states offer Stop
(with a second confirmation), message submission, or pending-question answers.
Answers typed by the user set `relay_user:true`. No interrupt, forget, adoption,
or ownership transfer control is provided. Extension dialogs without journaled
`ask_parent` questions must be answered with the existing `pi_answer` tool.

An action re-reads metadata and checks session ownership plus instance/gen/turn,
resolves the already-registered pi-delegate tool, then uses `$.tool.call`. It
never writes state or spawns a server. The server remains the final authority on
ownership/locks/state; a server refusal is shown as the action result. A second
server in the same Claude session is not independently diagnosed by the viewer.
Permission prompts and fallback waits may take time, so the task is detached
from the UI callback and reports busy/result/error status instead of holding
`ui.press` past its 10-second budget.

Runtime API reference:
https://code.claude.com/docs/en/plugins/mods/reference#mods-api-methods

Real MCP-from-pane experiment (2.1.287, default permission mode): a temporary
button called `$.tool.check` then `$.tool.call` for existing
`mcp__plugin_pi-delegate_pi-delegate__pi_read`, name `viewer-probe-missing`, in an
isolated scratch project's inline store. Check returned `decision: "ask"`;
Claude displayed its normal MCP permission dialog beside the pane. After Yes,
the pane received `isError: true` and `No pi agent named "viewer-probe-missing".
Known: none.` No existing child was read through MCP or changed. The temporary
probe button was removed. Automated tests cover all three mutation routes with
stubs, including confirmation, user attribution and refusal display.

## Development and live data

Load the source with `claude --plugin-dir <source-directory>`; no installed
plugin changes or version bump are needed. A fresh inline plugin has a separate
data store from the marketplace copy (see ADR-006). For a read-only live-data
test, explicitly set:

```
PI_DELEGATE_VIEW_DATA=/absolute/path/to/plugin-data-store
PI_DELEGATE_VIEW_PROJECT=/absolute/path/to/project
```

These override only the viewer's read target, never the MCP server's store.
Actions still require matching session ownership and route through this
session's server, which may refuse a target from another store. Use a fresh
Claude process for overrides: during the 2.1.287 live experiment, hot reload
reset custom environment visibility and the overridden list became empty.

## Settings tab

Press **5** from the agents pane to open Settings. It shows all six settings'
effective values/sources and project/user values, plus a read-only provider/model
pin and its source. Choose project or user scope, Tab to a field, type a value
and press Enter. Each row also has a reset-to-inherit button (hotkeys 2–7 when
not typing); **1** returns to agents. If permission dialogs move keyboard focus
to chat, Ctrl+X then Tab returns focus to the pane.

Settings always target the actual session project, not `PI_DELEGATE_VIEW_PROJECT`.
User scope affects all projects; the UI explicitly warns that project values
still take precedence. Invalid settings warnings and a conspicuous test-mode
notice (including active overrides) appear above the controls.

The mods sandbox cannot import the Node-based settings backend directly.
`scripts/settings-view.mjs` is a read/validate-only adapter: it imports
`SETTINGS`, `resolveSettings`, `parseSetting` and companion `loadProjectConfig`.
The pane runs it with `$.process.run` to read or validate, reusing backend rules
without copying ranges. Explicit writes go through `$.tool.call({tool:'Bash',
command:...})` and the existing companion `write-config --scope ...` CLI, with
normal permission prompts. All shell path/value arguments are quoted. Writes
run detached so dialogs don't exceed a UI callback's 10-second budget. No
backend/server/companion changes were required.

Fresh-session testing uncovered a viewer path bug: plugin root/data shell
variables are not necessarily exposed to mods `$.env`. Settings uses the native
`$.plugin.root` fallback. Child store paths fall back to the documented cache
marketplace layout or the inline store for source loading; explicit data overrides
still win. A missing child directory is an empty list rather than an error.

## Read-only fallback

When plugin hooks modules are disabled (including an off server rollout), the
Markdown command injects `settings-view.mjs fallback` output. It lists children,
the six settings and scoped provenance, model pin, warnings and test-mode
notices without calling MCP or writing anything. This fallback takes a Claude
turn and is a text snapshot, not an interactive editor. It uses the Bash
working directory, not a potentially inherited `CLAUDE_PROJECT_DIR` from the
parent that launched Claude.

A real 2.1.287 test initially logged:

```
installed plugins' hooks modules not loaded: rollout flag
(tengu_plugin_hooks_modules) is off, from GrowthBook
(the disk cache of an earlier session)
```

One permitted fresh retry refreshed the rollout on, and the native Settings tab
was tested live: project `questions_per_turn` saved as 2, then reset to inherit,
with a normal Bash approval dialog each time and the pane showing source
`project`, then `default`. No live user-scope write was performed. A separate
fresh process with the supported `--settings '{"disableAllHooks":true}'` flag
verified the read-only fallback. This flag was process-local; profile settings
were not edited.

Native tests use Claude Code's built-in test kit:
https://code.claude.com/docs/en/plugins/mods/test

```
claude plugin validate <source-directory>
claude plugin test <source-directory>
```

Read/validate adapter tests (scratch project and scratch user config only):

```
bash tests/test_settings_view.sh
```

Known limitations: no native pane in VS Code/headless or older/disabled mods;
no inline tool-result streaming beyond busy status; no generation selector;
no Markdown formatting of result text; transcript/journal reads are snapshots,
not RPC reads of in-memory buffers; no extension-dialog controls.
