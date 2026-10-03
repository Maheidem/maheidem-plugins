# Native pi agents pane

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

## Reload safety

Initialization is lazy and idempotent from `session.start`, command, render and
press/input hooks. Project/session identity and the two-second refresh timer do
not depend on `session.start` having fired; one timer starts per loaded module.
Render/interaction exceptions are logged to the debug log and displayed briefly
in the pane. Reopen `/pi-delegate:agents` to retry after an error.

Native element text has a 10,000-character limit, validated **after** the
render hook returns, so an oversized child blanks the whole pane. Every long
text is cut or split ahead of time (see Data and safety):
https://code.claude.com/docs/en/plugins/mods/reference#limits

Regression tests mount freshly loaded modules without `session.start` and cover
command/direct-render entry, every detail tab, Settings and back navigation,
long results, and visible errors. A separate initialization test checks
concurrent/repeated calls start one timer.
The installed directory-source plugin was also opened, actually reloaded after
a source change, reopened, and navigated through all five tabs in a real 2.1.287
session. That build did emit `session.start` for the rebuilt module; the tests
cover reload paths where it does not.

## Data and safety

Reads use only `$.fs.list/stat/read` (plus `tail -c` through `$.process.run`
for session files past 1 MiB): agent `meta.json`, `events.jsonl`,
`results/<gen>-<turn>.md`, and the recorded pi session JSONL. No MCP server is
started by the pane, no events are acknowledged, and nothing is written by
viewing. The scope is project-wide, not just the current Claude session.

A two-second timer runs at module scope (the band, toasts and log lines need it
while the pane is closed). Each tick lists every agent folder and re-reads a
file only when its listed size/mtime changed; parsed results are cached. The
session JSONL is read only while Activity is on screen, and after the first
read only the bytes it grew by are parsed. Idle, the pane redraws once a minute
(ages are minute-granular).

Disk text is sanitised before any element sees it: ANSI escapes and control
characters are stripped, and `api_key=`/`token:`-style values are redacted.
Long text is cut ahead of the 10,000-character element limit, keeping the head:
results are split into at most three Markdown blocks of 9,500 characters at
blank lines outside code fences (a fence longer than that becomes a Code
element), and every cut says how much was left out.

## Layout and keys

`/pi-delegate:agents` opens the list: agents grouped Needs input → Working →
Idle → Ended (newest first; Ended collapses past three rows or 24 h), one line
each: pointer, state glyph, name, summary, tail word, minute age. Every state
has its own glyph and word (`? asking`, `✻ working`, `✓ done`, `∙ parked`,
`◦ stopped`, `✕ failed`, `! can't read`); colour comes from one theme map
(`C` in `hooks/agents-format.js`). A waiting agent gets an inline answer card
under the list; others get a one-line peek. Lists taller than the pane are
windowed around the selection with `… N above / below` edges.

Enter opens the detail view: breadcrumb, facts line, question cards or a
state-aware composer (Steer / Next turn / Wake and send / Restart and send),
then tabs `1: Result  2: Activity  3: Log  4: Questions`. Result renders
Markdown (`p`/`n` step between turns); Activity pairs each tool call with its
result on one line and expands into Code or a diff; Log turns events into
sentences; Questions holds the full history. In a docked pane at least 110
columns wide the list and the focused agent's detail sit side by side; on a
terminal of 240+ columns the pane asks the dock for 112 columns.

Every letter or digit on screen is a hotkey Button: `a` answer, `m` message or
steer, `x` stop (then `y`/`n`, Cancel focused), `s` settings, `b` back, `r`
retry or reset. Inline, Esc leaves a field, cancels a confirm or goes back one
level before it closes the pane; docked, Esc closes and `b` goes back.

Outside the pane: while any agent is live, a one-line band above the prompt
says what needs attention (warning colour when one is waiting) and an `Open`
button. It has no hotkey: a band Button's digit hotkey answers a bare digit
typed into an empty prompt, and live testing showed a human-paced `1` of
`1. fix the parser` being swallowed (spec Open choice 3, option b). Reach the
band with ctrl+x tab (or click it) and press Enter; with an agent waiting, the
pane opens on its answer card. Done, failed and question events add one transcript
log line each, and a toast while the pane is closed.

View state (view, selection, tab, drafts per agent and question, notices) lives
in `$.state` under the contract in `types/index.d.ts`, so it survives a hot
reload; /clear, /resume and /branch reset it.

## Explicit actions

The pane never decides ownership. Controls are always shown for agents in this
project; Stop (two-step), Send and Answer resolve the session's own
pi-delegate MCP tool and call it with `$.tool.call`. Answers typed by the user
set `relay_user:true`. The server is the authority: an "owned by another Claude
session" refusal is shown in plain words, the draft is kept and the facts line
gains `other session`; a declined permission prompt and other failures get
their own messages, the latter with `r: retry`. (A pane-side comparison of
`meta.ownerClaudeSession` with `$.session.id()` used to hide every control after
a resume, because the server stamps `CLAUDE_CODE_SESSION_ID` while the pane
read the transcript id.) Calls run detached from the UI callback, so
permission prompts and wake waits do not hold `ui.press` past its budget.

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
Actions route through this session's server, which may refuse a target from
another store; the pane shows that refusal. Use a fresh
Claude process for overrides: during the 2.1.287 live experiment, hot reload
reset custom environment visibility and the overridden list became empty.

## Settings

`s` opens Settings from the list or detail; `b` (or Esc inline) returns to
where you came from. Rows follow `/config`: label, right-aligned value (bold
when not the default), dim source. Enter edits a number inline (`Save`), and
Default thinking is a Select. `Save to` (This project / Your user settings)
sits below the rows. The focused row shows its description, the source chain
`this project · your settings · default`, and where a save goes. `r` resets
the focused setting after a confirm with Cancel focused. Invalid values are
explained inline; a successful save is confirmed from a fresh read-back.
Warnings and test-mode overrides show on one warning line.

The mods sandbox cannot import the Node-based settings backend directly.
`scripts/settings-view.mjs` is a read/validate-only adapter run with
`$.process.run`; writes go through `$.tool.call({tool:'Bash', ...})` and the
companion `write-config --scope ...` CLI, with normal permission prompts and
every shell argument quoted. Settings always target the session project from
`$.session.root()`, not `PI_DELEGATE_VIEW_PROJECT`.

Child data identity comes from read-only profile metadata:
`plugins/installed_plugins.json`, `known_marketplaces.json`, and each relevant
directory marketplace's `.claude-plugin/marketplace.json`. Exact installed-root
matches or directory source entry matches identify the installed key, e.g.
`pi-delegate@maheidem-plugins`; sanitizing that key gives its data directory.
Multiple matches or an unmapped root with installed pi-delegate records fail
visibly. With no installed identity, inline is used. Explicit
`PI_DELEGATE_VIEW_DATA` still wins.

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
no generation selector; Activity and Log are disk snapshots, not RPC reads of
in-memory buffers; no extension-dialog controls; the list summary for a working
agent comes from its latest note, not its latest tool step.
