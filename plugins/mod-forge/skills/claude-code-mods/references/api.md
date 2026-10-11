# Mods API: the deltas

This file holds only facts that the `plugin-authoring` skill (PA) does not give. It also corrects wrong facts in PA. A fact that PA states is not written again: section 1 cites it. The API is early access: it "may change between releases without notice" [D:EARLY ACCESS].

Cites: `[PA:<heading>]` is a heading of PA `reference.md`. `[D:<symbol>]` is a symbol of PA `types/claude-code.d.ts`: grep it, never cite a line. `[DOC:<page>]` is `https://code.claude.com/docs/en/plugins/mods/<page>`. `[ev:N]` is entry N in `evidence.md`.

## 1. What PA already states

| Need | Read |
|---|---|
| The three files, `modules`, suffixes, imports, `($, e, next)`, streaming hooks, `telemetry` streams, `classic.<Event>` | [PA:What a plugin of function hooks is] |
| The types file, the types laid into `.claude-plugin/types/`, the noun contract, `dependencies`, the `gating hook` lines | [PA:The types are the reference] |
| Loading from disk, watch and reload timing, `pluginConfigs`, installs; the fail-closed `.catch`, re-entry; `claude plugin test` | [PA:Developing one] |
| The install line and the marketplace file | [PA:Sharing a mod] |
| `e.props`, `bodyColumns`, `$.state`, the state library, elements per surface, refused trees, text limits, borders, toasts, Buttons, hotkeys, dialog panes | [PA:Drawing: ui.render] |
| `$.session.append` and the rows it stores | [PA:The rows a conversation keeps: session.append] |
| Own time, `session.start`, timers, `$.model`, `$.ui.copy`, `$.ui.notify`, `$.fs.stat` | [PA:Work that outlives a dispatch] |
| `$.tool.register`, `isDeferred`, `$.agent` | [PA:Tools and agent types the model can call] |
| Each signature, prop and doc comment. Delta: PA says the types file has about 14,000 lines. The 2.1.295 file has 21,451 lines. Grep a symbol. | [D:EngineInterface], [D:PaneOpenArgs], [D:RenderPropsOf], [D:Elements], [D:ButtonProps] |

## 2. Gates: where a mod does not load

- Mods are on by default from 2.1.287 (terminal) and 2.1.286 (Desktop). `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` has no effect from 2.1.287 [DOC:overview].
- Off switches: the plugin disabled in `/plugin`, `--safe-mode`, `"disableAllHooks": true`, managed `allowManagedModsOnly`, `allowManagedHooksOnly`, `disableSideloadFlags`. Built-in mods ignore `--safe-mode`, `--bare` and `disableAllHooks` [DOC:overview].
- `--bare` refuses installed plugins: `installed plugins that are not managed load no hooks module in this mode (--bare)` [ev:38].
- Refusal codes in the binary: `diskless, hooks_modules_off, all_hooks_disabled, sideload_disabled, local_dirs_blocked, managed_hooks_only, hooks_disabled_in_settings, safe_mode, bare_mode, untrusted` [ev:39]. Only `bare_mode` is proven live.
- A mod in the session mods folder does not load in `claude -p`, `dontAsk` or an untrusted workspace [DOC:create] [ev:41]. Claude Code deletes the session mods folder after `cleanupPeriodDays` [ev:54]. Keep a copy.

## 3. What validate refuses

| Rule | Error text or result | Source |
|---|---|---|
| `modules` is an array of one path | `Invalid input: expected array, received string`; a second entry is refused | [ev:42] [ev:43] |
| Imports: own files and `'claude-code'`; no `setTimeout` | `cannot import "node:fs" (from hooks/register.js)`; use `$.clock`, `$.fs`, `$.http`, `$.process`. Web APIs that exist: `URL`, `TextEncoder`, `AbortController`, `crypto.subtle` | [ev:44] [DOC:api] |
| Each `$.state` key is in the contract | `turn-band.isHidden is not declared: the manifest's types contract must name it ...` | [ev:45] |
| Contract path starts with `./`, ends with `.d.ts`, holds no `..` | a top-level `export {}` gives "a contract exports types and nothing else" | [ev:46] [ev:52] |
| `author` in `plugin.json` | `No author information provided` fails `--strict` | [ev:47] |
| Only the `register` export is scanned | calls in a second exported function are not listed | [ev:48] |
| Write each call in full, `$.noun.method(...)`; pass `$` only to top-level functions of the same file | `$.ui is used as a value` (alias, destructure, index); a passed call is listed `via <function>`. The data source gets `io` (`hooks/source.ts` type `Io`): `io.run` and `io.store`; never pass `$.store` itself | [DOC:create] |
| Event names are string literals; do not shadow `on` | `the event name passed to on() is not a string literal`; `"tool.calls" is not an event` | [DOC:create] |
| `atom()` `plugin` and `key` are literals in a `const` | a `let` gives `takes a source the scan can read`; only `id` may be computed | [ev:49] |
| `on()` only while `register` runs | `after register() returned: on() is for register(); a hook may not register hooks` | [ev:50] |
| Matchers | an unknown key gives `has the key ..., which no event has`; refused: RegExp `g` or `y`, a nested quantifier, depth over 8; no operator keys (`{ startsWith }` never matches) | [ev:57] [D:Matcher] |
| Matcher keys | `tool` (tool.call, tool.check), `command` (command.run), `component` and `requestId` (ui.render), `id` (ui.open, ui.close), `key` (config.set), `trigger` (session.compact), `source` (classic.SessionStart) | [D:Matcher] |
| Patterns | an event name, `'*'`, `'<ns>.*'`, or `'!'` before one of these; `'!*'` is refused; `'*'` and `'!x'` never select a `telemetry.*` event for an installed plugin | [D:Glob] [D:Negation] |
| One unmatched registration per event | `on("session.start") is registered twice without a matcher; the first is at <file>:<line>`; a glob counts as unmatched | [ev:15] |
| An installed mod that hooks `telemetry.log` | fails unless the matcher names `{ to: 'collector' }` | [ev:56] |
| Reserved names | the name "cannot start with "claude-", "anthropic-", "anthropics-", or "cc-plugin-", be "claude", "anthropic", "anthropics", "claude-code", or "claude-mods" ..." | [ev:40] |

## 4. Limits

| Item | Limit | Source |
|---|---|---|
| `$.ui.invalidate` | 10 calls/s; 30/s for the shown pane, the band and the prompt hint; calls inside the cap fold | [D:InvalidatableEventName] |
| `$.ui.toast` | default 4,000 ms [D:ToastOptions]; `timeoutMs` is a whole number 1 to 60,000, else `$.ui.toast dropped: timeoutMs is a whole number of ms, 1 to 60000` | [ev:380] |
| `$.ui.ask` | 2 to 4 options, `header` up to 12 characters; rejects when dismissed and in `-p` | [D:AskOptions] |
| `$.ui.open` | `id` is 1 to 64 letters, digits, `_`, `-`; a second open retitles | [D:PaneOpenArgs] |
| Pane placement | If the person asks (command, prompt, press), the pane opens at any width. If nobody asks, the terminal needs 144 columns. After the first open, the terminal needs 110 columns for that id. In fullscreen, the pane docks from 110 columns. Below 110 columns it is inline. Measured: `"reason":"unasked below 144 columns (143 ..."` | [D:UiOpenResult] [ev:93] |
| `$.ui.focus` | `deny` when the site is not this plugin's, does not hold the keys, or has no such element; sites `Pane`, `AbovePrompt` | [D:UiFocusResult] |
| Tree | depth 32, 20,000 nodes; one `Markdown` or `Code` child over 10,000 characters blanked a pane, so split at about 9,500 | [ev:103] [ev:104] |
| Engine node | at AskUserQuestion: one engine node, nothing after it, at most 12 extra rows, no Markdown around it; at any site: never in an inline element, a Button or a Client | [ev:102] |
| `$.store`, `$.fs.write` | 4 MiB in all for the store, shared by all sessions [ev:109]; 4 MiB per file [ev:115]; neither is atomic | [ev:109] [ev:115] |
| `$.process.run`, `$.http.fetch` | run: 30 s default, 600 s max, no shell, the first 4 MiB of each output stream; fetch: 30 s default | [D:EngineInterface] [ev:116] |
| `$.command.register` | name `/^[a-zA-Z0-9_-]{1,64}$/`, a colon throws [ev:110]; a built-in name gives `"/focus" refused: it is the built-in /focus` | [ev:111] |
| `$.model.complete` | `maxTokens` 1,024 by default, up to 64,000; it spends the user's plan | [D:ModelCompleteInput] |
| `update()` | tries again on a version miss, 64 times at most; the change function can run many times, so keep it pure | [D:UpdateFunction] [ev:107] |

## 5. Traps

| Trap | Fact | Do this |
|---|---|---|
| Prop booleans | `focus`, `closeOnEscape`, `holdToasts`, `autoFocus` accept only `true`; `false` throws `ui.open: focus is true or left out` [DOC:interface] | Omit the prop, or write `cond ? true : undefined` |
| `ansi:` colours | `color="ansi:red"` gives `Text prop "color" must be a color (a theme key, a name, or hex)` [ev:300] | Use a ThemeKey [D:ThemeKey]; a named colour draws but stays fixed in every theme [ev:299] |
| `rows` on an inline pane | An inline pane gets at most about one third of the screen rows. Examples: 8 body rows at 30 terminal rows with `rows: 30` [ev:95]; 13 at 45 rows with `rows: 18` [ev:96] or `30` [ev:97]. A dock pane ignores `rows`. | Fit the tree to `e.props.scroll.bodyRows` |
| `Select` opens on focus | arrow focus on a `Select` opens its list at once; Esc there also leaves the view [ev:317] | Draw a Button with the value and `▾`; its press shows the `Select` (kit key `pick:<name>`) |
| `Input` empties on Enter | the engine empties the field and reports `''` as a change [ev:318] | Ignore that `''`; keep the draft in `$.state`; key the Input `in:<name>#<epoch>` (kit `drafts.ts`, `input.tsx`) [ev:319] |
| `closeOnEscape` | Esc also closes the pane at an idle, empty prompt [ev:92] | Leave it off for a pane that stays |
| Pane `title` | not drawn while only one pane is open | Put the name in the first row |
| `borderStyle: 'rounded'` | not a style, so no border [PA:Drawing: ui.render] | `'round'` |
| `$.ui.status` | always drawn as `⚠ <plugin>: <text>` in warning colour [ev:343] | A band, a pane, or the settings `statusLine` |
| `$.ui.copy` | OSC 52 does not report back, so `isCopied: true` is no proof | Say "copied" only after a real check |
| `$.session.cwd()` | moves with a Bash `cd` in the session [ev:113] | `$.session.root()` |
| `CLAUDE_PLUGIN_ROOT` | undefined in a mod [ev:118] | `$.plugin.root` |
| `$.prompt.submit` | an await in a hook that runs while Claude works holds that hook [DOC:api] | `void` it |
| `mobile` surface | no `Input` or `Select`, so `tsc` gives `TS2339` [ev:99] | Return early on `e.surface === 'mobile'` |
| Permission prompt | not a render site | `$.ui.notice` adds one line under it [D:EngineInterface] |

## 6. Budgets (binary constants, static unless marked)

| Item | Value | Source |
|---|---|---|
| Default hook budget; `prompt.edit` | 10,000 ms; 50 ms, the only event with its own budget | [ev:63] [ev:64] |
| `.catch` handler; grace after abort | 1,000 ms; 5,000 ms | [ev:65] [ev:66] |
| Runaway | 2 overruns in a row unload the plugin: `<plugin> ignored its signal 2 times in a row` | [ev:67] |
| `session.end` | 1,500 ms; `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` overrides | [ev:68] |
| Host answer to one `$` call | 10,000 ms: `$.<ns>.<m>: <plugin> did not answer within 10000ms` | [ev:69] |
| Worker heartbeat | 5 s: `no answer to a heartbeat within 5000ms: the hooks worker is wedged` | [ev:72] |
| One test | 5 s unless `timeoutMs` | [DOC:reference] |

- Delta: PA counts only `$.clock.sleep` against own time. The binary also counts `clock.now`, `clock.after` and `clock.every` (static) [ev:70].
- All installed and `--plugin-dir` mods share one worker [DOC:troubleshoot]. If a crash names a plugin, Claude Code unloads that plugin. If 3 crashes name no plugin, Claude Code stops all worker mods [ev:73]. `/reload-plugins` resets the count.
- `CLAUDE_CODE_HOOKS_SAME_THREAD` runs mods on the main thread, with no heartbeat found (UNVERIFIED) [ev:74]. Do not use it.

## 7. Lifecycle and reload

Startup: `plugin.register`, `engine.create`, then `session.start` for each plugin [ev:76]. Claude Code waits for `session.start` before the first prompt. Register commands and tools in `session.start` [PA:Work that outlives a dispatch]. Load line: `hooks module <plugin>@inline loaded (worker, environment 1, tier user); events: ...` [ev:71].

| Event | Module variables | `$.state` | Timers | `session.start` | Commands | Tools |
|---|---|---|---|---|---|---|
| Hot reload [ev:77] | reset | kept [ev:79] | dropped | fires: `raised for <n> (loaded later)` [ev:78] | removed unless registered again | kept unless registered again; callable? UNVERIFIED |
| `/clear`, `/resume`, `/branch` | KEPT [ev:80] | reset | kept | does not fire | kept | kept |
| `/reload-plugins`, files unchanged | kept | kept | keep running [ev:84] | does not fire | kept | kept |

- `$.store` survives all of them, also across sessions. Open panes survive a reload; the new render hook draws them.
- Re-seed after `/clear` in `classic.SessionStart` with the matcher `{ source: ['clear', 'resume', 'fork'] }` [DOC:interface].
- `/reload-plugins` reloads only changed plugins: `hooks modules unchanged, kept as loaded: ...` [ev:81].
- A save that fails to load keeps the old version and its timers: `reload failed, the previous version stays loaded` [ev:82].
- `/reload-plugins` with a broken file unloads the mod: `[ERROR] hooks module <n>@inline failed to load` [ev:83].
- After 5 fast reloads, Claude Code limits the reloads. The message is `reloading unusually often`. After 60 s idle, Claude Code checks the files every 30 s [ev:85]. Measured: 0.6 to 2 s from save to reload while active [ev:86]; 29 s after `idle, polling every 30000ms` [ev:87].

## 8. Events

2.1.295 has 142 event names: 33 `classic.*`, 46 engine events, 63 op events [ev:88]. Grep `classic.` in the types for the names [ev:89].

| Event | Use | Result |
|---|---|---|
| `command.run` | answer a slash command | `{ text }`, `{}`, or `next(e)` |
| `tool.call` | guard, rewrite or observe a tool | `next(e)`, `{ deny }`, `{ result }` |
| `tool.check` | the permission verdict | `{ decision: 'allow' \| 'ask' \| 'deny', reason }` |
| `prompt.submit` | change or drop a prompt | `next({ ...e, text })`, `{ drop }` |
| `turn.complete` | after a turn | `{ text }` adds a line under the answer |
| `ui.render` | draw a site | a tree, `next(e)`, `next({ ...e, props })` |
| `ui.press`, `ui.input`, `ui.select`, `ui.focus`, `ui.close` | react to the person | `{ deny }` on `ui.close` keeps the pane |
| `agent.offer`, `agent.spawn` | hide, change or refuse a subagent | `{ isOffered: false }`; `{ deny }` |
| `plugin.register` | admit each plugin | `{ refuse: reason }`; a throw admits, so add `.catch` [DOC:admin] |
| Op events (`fs.write`, ...) | audit or deny another mod's `$` call | `{ value }` or `{ deny }` [D:OpEventResult] |
| Also: `prompt.compose`, `turn.step` (a stream: `yield* next(e)`), `tool.describe`, `ui.resolve`, `ui.message`, `config.set`, `config.describe`, `session.receive`, `session.send`, `session.compact`, `session.end` | grep the name in the types | `session.compact` can return `{ skip }` [D:EventName] |

Order [DOC:events]: `sec-default@builtin` and managed `prependPlugins`, then user mods, then `appendPlugins`, then other built-ins. `tool.check` fires after the settings `PreToolUse` hooks, so a mod can approve a call that a non-managed `PreToolUse` hook blocked [ev:75]. A deny rule in the settings wins over an installed mod. To change this, set `allowModsToOverrideDenyRules: true` in `pluginConfigs`, under the `options` of `cc-plugin-sec-default@builtin` [ev:381].

| Render site [D:RenderPropsOf] [ev:100] | Props a rewrite can change |
|---|---|
| AskUserQuestion; UserMessage, AssistantMessage, CommandOutput | `questions`; `text` |
| ToolUse; ToolResult; ToolGroup | `input`, `output`; `output`; `isExpanded` |
| ToolProgress; TurnDuration; InfoNotice (terminal only) | `hint`; `word`, `durationMs`; `text`, `command` |
| Spinner; SessionMode; PromptHint (terminal, desktop) | `word`, `message`, `suffix`; `modes`; `hint`, `tail` |
| AbovePrompt (terminal, desktop), Pane (all) | the tree only |

## 9. Test kit deltas

- `claude-code/testing` exports `test`, `describe`, `expect`, `mock`, `tier` [ev:119]. `mock.session` is new in 2.1.293 [DOC:test].
- Register every stub before the first `$` call. A late one gives `on(...) after the test first called $` [DOC:test].
- A file with no `test()` fails: `declares no test(): nothing ran` [DOC:test]. The `HooksError`, no-test-file and `$.ui.focus` facts are in `testing.md` §1.
- `$.command.run` in a test needs `origin` and `presentation`, else `TS2345` [ev:122] [D:CommandRunInput].
- The kit tests call `mock.clock(on, { now })` and stub `ui.open`, `ui.close`, `ui.panes`, `ui.toast`, `ui.log`, `ui.invalidate` (`templates/kit-tests/`). There, `ui.findAll({ type: 'Button' })` returns each `key`. `ui.redraw({ ...props, bodyColumns: 40 })` runs the render again.

## 10. Version map

- 2.1.287 mods; 2.1.288 `$.ui.selection()`; 2.1.289 `ui.fault`; 2.1.290 `prompt.mention`, `gatingHooks`; 2.1.292 `prompt.autocomplete`, re-entry, prompt caching [ev:91]. 2.1.293 `isDeferred`, `mock.session`; 2.1.295 `$.ui.notify`, Button children, type files only where a mod is developed [ev:91].
- The 2.1.277 types said `$.ui.open` returns `void` and three sites draw on the terminal only. Both are stale [ev:101].
