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
Idle → Ended (newest first; every row shows, so the list stays stable), one line
each: pointer, state glyph, name, summary (dim `no task text` when there is none),
tail word, minute age. The first selection is the first row of the first group.
Every state has its own glyph and word (`? asking`, `✻ working`, `✓ done`,
`∙ parked`, `◦ stopped`, `✕ failed`, `! can't read`); colour comes from one
theme map (`C` in `hooks/agents-format.ts`). A waiting agent gets an answer card
under the list, cut to the rows that are free; others get one line in plain words.
Group names show while every row fits; a longer list is a kit list window
(`hooks/kit/list.tsx`) with dim `↑ N more` / `↓ N more` edge rows.

The pane is built on the mod-forge kit v2, copied byte for byte into `hooks/kit/`
(do not edit it). `hooks/register.tsx` wires the hooks, `views.tsx` and
`detail.tsx` draw the screens, `actions.ts` holds what the keys do, and
`source.ts` reads the disk and calls the MCP tools.

Enter opens the detail view: breadcrumb, facts line, question cards or a
state-aware composer (Steer / Next turn / Wake and send / Restart and send),
then tabs `1: Result  2: Activity  3: Log  4: Questions`. Result renders
Markdown (`p`/`n` step between turns); Activity pairs each tool call with its
result on one line and expands into Code or a diff; Log turns events into
sentences; Questions holds the full history. In a docked pane at least 110
columns wide the list and the focused agent's detail sit side by side; on a
terminal of 240+ columns the pane asks the dock for 112 columns.

The tab row is one line: the active tab carries `▸` whatever holds the focus.
The action keys (`a` or `m`, `x`, `s`) are in the kit footer under the body, with
one dim hint row that always ends with the Esc hint. Every body is cut to the rows
that are left, so the footer always shows. Activity and Log are kit list windows
that start on the newest row; Enter expands a row into a card under the list.
A Result or Questions body longer than the pane becomes a line window, and only
then does the footer say `↑/↓ to scroll`. Activity never shows
thinking (the footer counts the hidden blocks), shows `ask_parent` as `note` or
`asked` rows, and drops a leading `cd <dir> &&` from commands. Questions history
shows each answer's text from the pi session. Mid-turn, the facts line labels
the previous turn's cost (`turn 2 cost $0.73`). Expanded Log/Activity cards are
capped so the header, card and footer stay on screen.

Engine behaviour, not the pane's: a Button under the mouse pointer is drawn
inverse in addition to the keyboard focus (so two rows can look selected; `❯`
marks the selection); an open Select repeats its current value above the
option list; Enter on a closed Select commits the shown value (the pane
ignores a commit that changes nothing); a focused empty Input draws its cursor
over the first placeholder cell (after Send the pane moves the focus back to
the tab row).

Every letter or digit on screen is a hotkey Button: `a` answer, `m` with one
label for each state (`steer`, `message`, `wake and send`, `restart and send`;
it shows only when a composer exists), `x` stop (then `y`/`n`, cancel focused),
`s` settings, `r` retry or reset. The arrows never land on these keys.
Esc steps back one level in every placement: it dismisses a notice, closes a
Select, leaves a field, cancels a question, collapses a card, then goes back one
view (settings to where it came from, the detail to the list). Only Esc in the
list closes the pane. An Esc while the prompt has the keys (an empty prompt)
closes the pane at once. There is no `b` key.

Outside the pane: while any agent is live, a one-line band above the prompt
says what needs attention (warning colour when one is waiting) and an `Open`
button. It has no hotkey: a band Button's digit hotkey answers a bare digit
typed into an empty prompt, and live testing showed a human-paced `1` of
`1. fix the parser` being swallowed (spec Open choice 3, option b). Reach the
band with ctrl+x tab (or click it) and press Enter; with an agent waiting, the
pane opens on its answer card. Done, failed and question events add one transcript
log line each, and a toast while the pane is closed.

View state (view, selection, tab, drafts per agent and question, notices) lives
in `$.state` under the contract in `types/index.d.ts` (three cells: `ui`,
`world`, `drafts`), so it survives a hot reload. A reload drops wait notices,
busy marks and open questions. /clear, /resume and /branch reset the view to the
list (the `classic.SessionStart` hook) and read the agents again.

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

`s` opens Settings from the list, the detail or the error view; Esc returns to
where you came from. Rows follow `/config`: label, right-aligned value (bold
when not the default), dim source. The pointer follows the ring. Enter edits a
number inline (`save`). Default thinking and `Save to` show their value with `▾`;
the Select opens only when you press Enter on the row. `Save to` (This project / Your user settings)
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

A mod gets neither `CLAUDE_PLUGIN_ROOT` nor `CLAUDE_PLUGIN_DATA` (the pane uses
`$.plugin.root`). The pane reads the data folder of this session's own MCP
server, in this order:

1. `PI_DELEGATE_VIEW_DATA`, a silent override for development.
2. `CLAUDE_PLUGIN_DATA` of the `pi-mcp-server.mjs` process that this Claude Code
   process started from this plugin folder (`ps`).
3. The rule Claude Code uses: a `--plugin-dir` (or `CLAUDE_CODE_PLUGIN_DIRS`) load
   is `pi-delegate-inline`, also when an installed directory marketplace serves
   the same folder (seen live on 2.1.296); an install whose record names this
   folder is `pi-delegate-<marketplace>`; no record is `pi-delegate-inline`.

The shared rule is in `hooks/shared.mjs`; the text fallback uses it too.

## Read-only fallback

When plugin hooks modules are disabled (including an off server rollout), the
Markdown command injects `settings-view.mjs fallback` output: plain lines, no
tables and no internal keys. It lists the agents by group, the six settings with
their source, the model pin, warnings and test-mode notices without calling MCP
or writing anything. Its data folder is `${CLAUDE_PLUGIN_DATA}` (Claude Code fills
it in for a command), else the rule of `hooks/shared.mjs`. This fallback takes a Claude
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
