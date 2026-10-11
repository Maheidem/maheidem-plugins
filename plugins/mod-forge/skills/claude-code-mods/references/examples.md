# Real examples: what to read, and for which job

Read real mods before you design. Copy the good methods. Do not copy the bad methods.
Validate results come from runs on 2.1.295, 2026-10-09 [ev:377].

## 1. Built-in mods: the source of truth for idioms

`M` is the built-in mod source: `https://github.com/anthropics/claude-code/tree/main/mods`.
A local copy can be at `<config dir>/plugins/marketplaces/claude-code-plugins/mods`. Its README says the folder is "published as it is built into the binary".

| Mod | Read this | For |
|---|---|---|
| `diff` (1,035-line `register.ts`) | `hooks/views/dialog-pane/dialog-pane.tsx`: hint footer, edge rows, the window | The native look of a list pane |
| | `hooks/views/dialog-pane/dialog-focus-of.ts`: focus follows the slot | Focus in a windowed list |
| | `hooks/views/kit/kit.ts`: the `Kit` type (`ui`, `actions`, `columns`, `rows`) | One object for each part of a drawing |
| | `hooks/register.ts`: `closeOnEscape`; `ui.focus`; `ui.scroll` only for `e.origin.kind === 'person'` | Keys and scroll of a docked pane |
| | `tests/views.test.ts`: `$.ui.press`, `$.ui.scroll` | Tests of a drawing |
| `sec-default` (115 lines) | `hooks/register.ts`: `next.to(e, 'append')` for each event family | A guard at the outermost seat (managed tier only) |
| `agents-md` (305 lines) | `hooks/register.ts`: `prompt.context`, `agent.spawn { fork: true }`, `tool.call { tool: 'Read' }` | Matcher-scoped hooks |
| `telemetry` (369 lines) | `hooks/register.ts`: `engine.create` adds a noun to `$` | Read only. It fails validate as a user plugin |

Do not copy two `diff` habits: a module-closure `model` pushed with `invalidate`, and 7 gating hooks without `.catch` [ev:379].
It puts `.catch(() => undefined)` on its async side calls. Copy that.

## 2. When the `/diff` source is absent

`mods.py doctor` prints a warning when the local `diff` source is missing. Do one of these:
1. Add the marketplace once in this profile: `claude plugin marketplace add anthropics/claude-code`.
2. Read the same files on GitHub: `https://github.com/anthropics/claude-code/tree/main/mods/diff`.

The `examples/` folder of the plugin-authoring skill has three small mods: `tool-call.ts` (a guard), `band.tsx` (a band) and `pane.tsx` (a pane).
All three pass `validate --strict` and ran live on 2.1.295 [ev:378].
They show the mechanics, not the design. `pane.tsx` opens its pane unasked in `session.start`, and its rows have no glyph and no hierarchy.

## 3. Playground and community mods (in brief)

The playground is `https://github.com/anthropics/claude-code-playground`, folder `mods/`. Its samples are unsupported and need 2.1.287 or later.
- `token-weather` is a small, good band. It does nothing on subagent turns. It adds a chart only at 60 columns or more. It reads `e.hasSurvey` instead of `e.props.hasSurvey`.
- `replay-theater`: hides its band, waits 200 ms, then opens the pane with `focus`. It falls back to the band when `isPlaced` is false.
- `blast-radius`: holds a Bash call behind a confirm pane, and `Cancel` gets `autoFocus`. It uses digit hotkeys that also draw on the band.

Community mods. The first four passed `validate` on 2026-10-09. None ran in a live session.
- `https://github.com/scasella/claude-flightdeck`: all state in `$.state`, no top-level `let`.
- `https://github.com/NahumLitvin/prismantis`: restyles engine sites with `ui.render` on tool and message rows.
- `https://github.com/GGGODLIN/cc-mod-image-view`: `Image` from a PNG. tmux cannot show images; test it in kitty or Ghostty.
- `https://github.com/alexknowshtml/claude-auto-handoff`: a `tool.call` deny past a context-size threshold.
- `https://github.com/karanb192/awesome-claude-code-mods`: an index. Its checks are static, and runtime is "not-tested".
Most of these mods keep state in module variables, and several have gating hooks without `.catch`. Do not copy those parts.

## 4. Case study: a background-agents pane (an in-house mod, 2026-10)

What it did:
- A docked pane with a list of agents, and a detail view with tabs.
- A composer `Input`, a band while agents run, and a toast for each result.
- A 2-second timer, and a split view from 110 columns.
- A settings view that writes through `$.tool.call({ tool: 'Bash' })`. The person sees a permission prompt.
- A namespaced command from `commands/*.md`, answered by a `command.run` hook.

What the live audit found, and what the kit does now:

| Finding | The kit or the driver now |
|---|---|
| The ring and `❯` drifted apart; ↓ stuck [ev:313] | `kit/focus.ts`: the selection lives in `$.state`; `ui.focus` stays cheap |
| A focusable edge row took the ring [ev:316] | `kit/list.tsx`: inline edges are dim `Text` |
| Heavy `ui.focus` work lost fast presses [ev:314] | `kit/focus.ts`: one small key write for each press |
| Esc in the composer closed the dock [ev:30] | `kit/close.ts`: deny `ui.close`, then focus the pane again |
| A bordered card inside the pane | The rule: no card inside a pane |
| Engine-written types named an old build [ev:334] | `mods.py check` reads the header line of the types file |

Its storyboard: 212 nodes, 1,237 edges, 24 scenarios and 6 sessions [ev:357]. The crawl took about 31 minutes [ev:358].
The player was 19.2 MB [ev:359]. Lesson: the 16 MB page limit and the scale-down order in `storyboard.md`.

## 5. The templates, by kind

`mods.py new <mod> --kind <kind>` picks the template.

| Kind | Template | What it shows |
|---|---|---|
| `pane-list` | `templates/pane-list` (the kit) | A windowed list, detail, confirm with the safe choice focused, an add view with a kept draft, scenarios for the storyboard |
| `pane-simple` | `templates/pane-simple` | A command that opens a pane; state in `$.state`; plain rows, an overflow edge, a hint footer. It is the native-look sample |
| `band` | `templates/band` (plugin `prompt-band`) | A one-line band above the prompt and a small list pane |
| `status-toast` | `templates/status-toast` | A `tool.call` hook pins a status line and announces a failed call. No pane |
| `guard` | `templates/guard` (plugin `guard-starter`) | A `tool.call` hook refuses risky Bash commands and fails closed. No pane |
| `command` | `templates/command` (plugin `command-demo`) | A `command.run` hook answers with text, and a `CommandOutput` render draws it. No pane |
| `mixed` | `templates/mixed` | A list pane, a band, a toast, a tool-call guard and a slash command in one hooks module |

The kit lives in `templates/kit/`. `new` copies it to `hooks/kit/`, and `check` hashes it. Do not edit the copy.
The template proof commands are `/prompt-band`, `/guard-starter` and `/command-demo`. A new mod's proof command is `/<mod>-proto`.

## 6. Which example for which job

| Job | Read |
|---|---|
| A list pane | the `pane-list` template, then `diff` `views/dialog-pane/` |
| A dialog or a confirm | `blast-radius` (safe focus), the `diff` dialog pane |
| A band | the `band` template, `band.tsx`, then `token-weather` (read `e.props`) |
| A guard | the `guard` template, `tool-call.ts`, `sec-default`, then `claude-auto-handoff`. A file guard: `on('tool.call', { tool: 'Edit' }, ...)` and `{ tool: 'Write' }`; the tool arguments sit beside `tool`, so read `e.file_path` [D:ToolCallEnvelope] ([D:ToolCheckInput]: "{ file_path, ... } for the file tools"). The starter guard judges Bash commands only |
| Restyle the transcript | `prismantis` |
| Images | `cc-mod-image-view` (test in kitty or Ghostty, not tmux) |
| State discipline | `claude-flightdeck` |
| A namespaced command with a fallback | the case study (section 4): `commands/*.md` plus a `command.run` hook |
