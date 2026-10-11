# UX design: make a mod look native

A mod that works but shows raw data is a failure. The user rejected a working pane because it was ugly. It showed pipe rows, raw JSON, jargon codes, and no colour or hierarchy [ev:123]. The rules and tokens below produced "that looks awesome" [ev:124].

Source keys: `[ev:N]` = entry N in `evidence.md`. `[PA:<heading>]` = that section of the plugin-authoring `reference.md`. `[D:<symbol>]` = the types file; grep the symbol. `[DIFF:<path>]` = `mods/diff/hooks/<path>` of the built-in `/diff` mod (https://github.com/anthropics/claude-code/tree/main/mods). `[DOC:<page>]` = `https://code.claude.com/docs/en/plugins/mods/<page>`. `[A11Y]` = `https://code.claude.com/docs/en/accessibility`. `[PG:<path>]` = `https://github.com/anthropics/claude-code-playground`, folder `mods/<path>`.

## 1. Rules from the user

1. Copy the look of the built-ins before you draw: `/agents`, `/workflows`, `/config` and the `/diff` mod source [ev:125].
2. Render content. Do not show raw data: no pipe rows, no raw JSON, no internal codes [ev:126].
3. Use the rich elements where they fit: Markdown, Code, Select, Input, band, toast, `$.state` [ev:127].
4. Check the real API surface for a capability before you invent one [ev:128].
5. Verify live in a tmux claude session, not only with unit tests [ev:129].
6. Do the design pass for each change that the person sees. This includes a pane, a band, a toast, a `$.ui.status` line and a change to an approved pane. A mockup is a live prototype mod, drawn by Claude Code and captured as a PNG. The user rejected ASCII mockups as "not a mockup". Do not write code for the real mod before the person picks.
7. Work that changes nothing on the screen (a silent guard, a rewrite of a prop that draws nothing) needs the checklist (section 12) only.

## 2. The design pass (the driver runs it)

1. `mods.py doctor`, then `mods.py new <mod> --kind <kind> --trusted <dir>`. You get a prototype `<mod>-proto` with the kit, fixtures and a scenario switch [ev:130].
2. You decide: read the closest built-in pane (section 3). Sketch one variant per persona in private: A UX, B visual, C native, D accessibility [ev:131]. Never show a sketch.
3. You write the views of the prototype. Every key that a variant shows must work on the fixtures. Fixtures hold more rows than the window [ev:133].
4. `mods.py -C <wb> check`. Then `mods.py -C <wb> mockups`: every variant in every state at 150, 100 and 60 columns, plus extras, on one contact sheet. It runs `score`.
5. Open at least one PNG with Read. Then present the contact sheet, the score rows and your favourite. Give `tmux attach -t mx-<mod>-<V>`.
6. The person picks: `mods.py -C <wb> pick <V>`. Then `journey`, `crawl` and `storyboard` (`storyboard.md`). The person walks the player and approves: `approve --by person`. Only then `build --dev-mods <path>`.
7. No person can answer (`claude -p`, a workflow agent): use `--by headless` and say so in the report. A worker that can ask its parent sends the contact sheet to the parent and stops.

## 3. Anatomy of a native pane (`/diff`)

- It opens with `closeOnEscape: true` and `rows` [DIFF:register.ts].
- The title is the tab text only while two or more panes are open. With one pane, no title row shows. So do not draw your own title row in a dock [D:PaneOpenArgs].
- It draws to `bodyColumns - 1`. One blank column stays at the right edge [DIFF:limits/columns/pane-right-pad-columns.ts].
- It coalesces state changes for 100 ms into one `invalidate`, under 10 redraws per second [DIFF:limits/timing/redraw-coalesce-ms.ts].
- One model, two layouts. A dock pane sits at the side. An inline pane sits above the prompt. Inline and too narrow gives one dim line: `Resize your terminal to at least 110 columns to show the diff panel` [DIFF:views/pane-view.tsx].
- It never reads `props.isFocused`. Focus shows through the host ring and `autoFocus` [DIFF:tests/fixtures/pane.ts].
- It draws no border inside the pane, also not in its inline layout. The host frames the pane [DIFF:views/dialog-pane/dialog-pane.tsx].
- Header: one `Text wrap="truncate-end"`. Only the count is bold: `3 files` in `3 files changed +42 -7` [DIFF:views/sections/header-view.tsx].
- Inline order: title row, blank row, dim subtitle, body with `marginTop={1} marginBottom={1}`, dim hint [DIFF:views/dialog-pane/dialog-pane.tsx].
- Rows are plain Buttons, dim at rest, padded so that the whole row presses. At most 5 rows show inline [DIFF:limits/sizes/max-visible-files.ts].
- Counts: `+N` in `diffAddedWord`, `-M` in `diffRemovedWord`; a zero side is left out [DIFF:views/sections/diff-stat/diff-stat.tsx]. Progress: `█` in `success`, `░` in `inactive` [DIFF:views/sections/todo-bar.tsx].
- Hint, verbatim: `↑/↓ to select · Enter to view · Esc to close`; in the detail `↑/↓ to scroll · Esc to back` [DIFF:views/dialog-pane/dialog-pane.tsx].

## 4. Colour

- Use ThemeKeys only [D:ThemeKey]. There are 23 keys. Text and state keys: `text`, `inverseText`, `inactive`, `subtle`, `suggestion`, `remember`, `success`, `error`, `warning`, `merged`, `claude`, `permission`. Mode and border keys: `planMode`, `autoAccept`, `promptBorder`, `bashBorder`, `ide`. Diff keys: `diffAdded`, `diffRemoved`, `diffAddedDimmed`, `diffRemovedDimmed`, `diffAddedWord`, `diffRemovedWord`.
- A ThemeKey follows the person's theme [D:Color]. A name or a raw colour stays fixed. In the daltonized themes `success` is blue [ev:136].
- Measured on 2.1.295, theme `dark`: `error` → `38;5;211`; `red` → `38;5;168`; `#ff0000` → `38;5;196`; `ansi256(39)` → `38;5;39`. `ansi:red` makes the validator refuse the tree [ev:137]. An older static reading said that names draw nothing; the live run shows that is wrong [ev:138]. Assert on the index of your own theme, never on exact RGB [ev:141].

| Meaning | Key |
|---|---|
| done, pass | `success` |
| running, needs attention | `warning` [ev:139] |
| failed, refused | `error` |
| accent, link-like | `suggestion` |
| brand moment (rare) | `claude` |
| secondary text | `dimColor` (it resolves to `inactive`) [ev:140] |
| added / removed | `diffAddedWord` / `diffRemovedWord` |

Only `success`, `inactive` and the diff keys have an example in `/diff` [DIFF:views/sections/diff-stat/diff-stat.tsx]. The other rows are our guess. Colour never carries meaning alone. `NO_COLOR` sets the colour level to 0 [ev:142]. Screen reader mode promises no cues by colour only [A11Y]. Pair each colour with a glyph or a word. Write `✓ Bash npm test`. Do not write a green `Bash npm test` only.

## 5. Visual grammar

| Weight | Use | How |
|---|---|---|
| Primary | the one number or name that matters | `bold` on ONE span, no colour [DIFF:views/sections/header-view.tsx] |
| Secondary | hints, subtitles, edges, rules | `dimColor` |
| Aside | `untracked`, `Binary file`, placeholders | `dimColor` + `italic` [DIFF:views/dialog-pane/dialog-file-row.tsx] |
| Data | state, counts, progress | ThemeKey + glyph |

- Spacing: one blank row between header and list (`marginTop={1}`), one between list and hint (`marginBottom={1}`).
- Right-align a tail with `<Box flexGrow={1}/>`, never with padded spaces [DIFF:views/sections/list-row/list-row.tsx].
- No border inside a pane, also not for a card. Set a card apart with a dim `─` rule, `marginTop={1}` and one bold span. The playground's round border on a decision card is an unsupported sample [PG:blast-radius/hooks/blast-radius.mjs].
- Hint footer: one dim line at the bottom, `wrap="truncate-end"`. Format: `<keys> to <verb> · <keys> to <verb> · Esc to <verb>`. Join keys with `/`. The separator is ` · ` (U+00B7). `Esc` goes last. Write key names in sentence case: `Enter`, `Esc`, `Tab`.
- A plain hotkey Button draws itself as `<key>: <label>` [ev:143]. So the label is the verb only: `label="add"` draws `a: add`; `label="a to add"` drew `a: a to add` [ev:144].
- Footer shape: `a: add · d: delete · Enter to open · Esc to close`.
- Selection: `❯` (U+276F) before the selected row, two spaces before the others [DIFF:views/sections/pointer/pointer.ts]. The host draws the focus ring as inverse [ev:145]. Do not draw a second inverse bar.

## 6. Glyphs

Reuse the engine's glyphs [ev:146] [ev:150]. Do not use emoji.

| Glyph | Use |
|---|---|
| `⏺` / `●` | message dot (macOS / other); running |
| `⎿` | tree continuation, dim, two spaces after |
| `❯` | prompt, selected row |
| `·` `…` `─` | separator ` · `; truncation and `Loading…`; dim rule |
| `↑ ↓ ← → ↳` | overflow edges, navigation |
| `✓ ✕ ✘ ⚠ ℹ` | status marks (the kit uses `✓` and `✕`) |
| `○ ◐ ● ◉ ◎ ◌` | state circles |
| `• ! ◦ ×` | the engine's status map: working, needs you, idle, failed [ev:147] |
| `∙` | small dot beside the message dot [ev:148]; a parked worker [ev:149] |
| `▸ ◇ ◆ ※ ✦` · `✻` | bullets, markers, collapsed · finished turn (`✻ Cogitated for 8s`) |
| `█ ░` · `⏸` / `⏵⏵` · `╭╮╰╯ ├ └ │` | bars · paused / mode marker · corners and tree branches |

- Use `✓` (U+2713), not `✔` (U+2714). The first-party TUI has 51 `✓` hits and 6 `✔` hits [ev:151]. Use one of them per mod.
- Spinner frames: `· ✢ ✳ ✶ ✻ ✽`, forward then back [ev:152].
- Width: the binary has three settings for ambiguous width [ev:153]. Two are true [ev:154] [ev:155] and one is false [ev:156]. Which one the layout uses is UNVERIFIED. So keep ambiguous glyphs (`…`, `●`, `·`) out of aligned columns. CJK and emoji take 2 cells [ev:157].

## 7. States

| State | Native form |
|---|---|
| Empty | one dim line in plain words, plus a dim hint when useful: `No uncommitted changes` [DIFF:pane-state/empty-state-of.ts] |
| Loading | static dim text with `…`: `Loading diff…`. Better: measure before you open, so the first frame is complete [DIFF:views/prelude-of/prelude-of.tsx] |
| Action in progress | a notice line, then a result line: `Sending your answer…`, then `✓ Answer sent` [ev:158] |
| Error | what failed and what happens next. Keep the last good data [PG:token-weather/hooks/token-weather.mjs] |
| Overflow | an edge row with arrow and count: `↑ 2 more above`. Never cut silently [DIFF:views/body/list-block-of.tsx] |
| Not applicable | say why: `The diff panel shows git changes — the current directory isn't in a git repository` [DIFF:names/texts/not-in-repository-text.ts] |
| Band idle | return `next(e)` and draw nothing |

- Use the `error` colour only for a real failure of the user's work, not for "no data". Never show `[]`, `null`, `Error: ENOENT` or a stack trace as a state.
- No first-party mod animates. If you must, use `$.clock.every(ms, ...)` with `$.ui.invalidate('ui.render')` [DOC:interface], under 10 redraws per second, for real progress only.

## 8. Surfaces other than a pane

- Band (`AbovePrompt`): return `next(e)` when `e.props.hasSurvey` is true or when you have nothing to say [D:hasSurvey]. Keep it to 1-2 rows. The slot is half the terminal rows at most [D:RenderPropsOf].
- The band is shared. To keep what later mods draw, put `await next(e)` inside your Box [DOC:interface].
- A band has no digit hotkey: a bare digit in an empty prompt presses it [D:bare digit]. A pane lost the `1` of `1. fix the parser` this way [ev:26].
- Hide the band while your pane is open [ev:159]. The engine draws its own `[-]` mark at the right [PA:Drawing: ui.render]. With `idle=yield` the band draws nothing while no turn runs (`AbovePrompt` `isWorking` [D:AbovePrompt]). Put band keys after `open`: `bandRow(E, line, onOpen, keys)`. Collapsed, the band is one dim row `▸ plugin panel hidden · <shortcut> or click to show` [ev:160].
- `$.ui.status` draws as `⚠ <plugin>: <text>` in `warning` [ev:161]. It cannot be neutral. Put neutral text in a band or a pane. Text limits: [PA:Drawing: ui.render].
- `$.ui.toast` has the mod name as prefix and 4 s default [D:ToastOptions]. Fullscreen draws 3 at most; classic draws one line [DOC:troubleshoot]. Send a toast only while your pane is closed [ev:162]. `holdToasts: true` only on a dialog pane [D:holdToasts].
- `$.ui.log` writes a dim transcript line that Claude does not read. `{ to: 'debug' }` writes to the debug log only [D:UiLogOptions].
- The best native method is to change one prop. The engine then draws the element. Example: `next({ ...e, props: { ...e.props, suffix: ' · 3 calls' } })` at the Spinner [DOC:interface].
- Desktop and mobile: the element sets differ per surface [ev:98] [PA:Drawing: ui.render]. Branch on `e.surface` and draw a line of text where your element is missing. VS Code chat, `claude -p` and cloud sessions run hooks and draw nothing [DOC:overview].
- A grid of coloured cells is one `Raster` [PA:Drawing: ui.render]. Desktop draws a `Link` as plain text unless it is `https:` or `http://localhost`, with no `@` [DOC:interface].

## 9. Keys and focus

How the terminal draws a Button, measured on 2.1.295 [ev:163]:

| Button | At rest | Focused |
|---|---|---|
| default, `variant="secondary"`, `role="dismiss"` | bold `[ label ]` | bold + inverse |
| `variant="primary"` | bold, accent colour | bold + inverse |
| `dimColor` | bold, grey | full strength + inverse |
| `plain` + `hotkey="p"` | `p: Plain`, `p` in accent | inverse |
| `plain` + `variant="primary"` | label only (`plain` wins) | inverse |

- Rows are plain Buttons with a stable `key`. Only real actions are bracketed Buttons [DIFF:views/sections/list-row/list-row.tsx]. A bracketed Button shows no hotkey on the terminal. Use `plain` with `hotkey` [DOC:interface].
- Every key on the screen must work [ev:164]. A hotkey is one digit or one lowercase letter; a later duplicate wins [D:hotkey]. Hotkeys work only while the site holds the keys: after `ctrl+x tab`, a click, or `open({ focus: true })` [ev:165].
- Focus the safe choice on a confirm by key: `autoFocus` alone left the ring on `y: delete` [ev:166]. `autoFocus` takes only `true` [D:autoFocus?: true].
- Bind a built-in chord with `action="app:<binding>"` [DIFF:views/sidebar-pane.tsx]. You cannot rebind Tab or the arrows [DOC:interface].
- Esc goes back one level before it closes [ev:167]. Esc in a focused Input also raises `ui.close`. In a dock, Esc closes the pane unless a hook denies it [ev:168]. After a deny, give the keys back to the pane [ev:169] [ev:170].
- When a windowed list moves, the ring keeps its screen slot, not its key [ev:171].
- Hover is style data only; no hook runs [ev:172] [D:BoxHoverProps]. tmux sends no mouse events, so hover is untested. Never hide the only path to an action behind hover: the same action needs a key path [ev:173].
- A Box with a `key` is a hover scope. A Text or Button `hover` outside a keyed Box is refused unless it names a `scope` [D:TextHoverProps].
- Reveal: inside a keyed row Box, put a Box with `display="none"` and `hover={{ display: 'flex' }}` that holds the Button [D:BoxHoverProps].

## 10. Accessibility and density

| Signal | How to read it |
|---|---|
| Reduced motion | `(await $.settings.read()).prefersReducedMotion` [ev:174] |
| Screen reader | `await $.env.get('CLAUDE_AX_SCREEN_READER')`, `settings.axScreenReader` [ev:175] [A11Y] |
| Magnifier cursor | `await $.env.get('CLAUDE_CODE_ACCESSIBILITY')` [ev:176] |
| Theme name | `(await $.settings.read()).theme` [ev:177] |
| Surface | `e.surface` [PA:Drawing: ui.render] |

- Read these in a non-render hook and keep the result in `$.state` [ev:178]. A render hook cannot write state.
- Under `NO_COLOR=1` a pane lost all colour, bold and dim, and kept inverse (SGR `7`) [ev:179] [ev:180]. So the ring still shows, and bold and dim carry no meaning there.
- Be calm when `prefersReducedMotion` or `axScreenReader` is `true`, or `CLAUDE_AX_SCREEN_READER` is `1`: no frame loops, no blinking, state words in text.
- A mod cannot read the colour depth, the theme that `auto` resolves to, or a dark flag.
- Size to `e.props.bodyColumns` [D:bodyColumns]. Reserve the tail first (counts, buttons), then give the rest to the name.
- Set `wrap` by content type [D:truncate-start]. Use `truncate-start` for a path. Use `truncate-middle` for an id or hash. Use `truncate-end` for a sentence, hint or header. Use `wrap` for body prose.
- A Button label does not cut itself. Cut it before you draw it [ev:181] [ev:182].
- One line per row in a list; detail goes in a detail view [ev:183]. Split list and detail side by side only when docked and `bodyColumns >= 110` [ev:184].
- Strip ANSI and control characters from text of disk or tools, and redact secrets [ev:185].
- An inline pane gets about a third of the screen; `rows` above that is not granted [ev:95] [ev:195] [ev:196]. Fit `e.props.scroll.bodyRows` [D:bodyRows] [ev:197]. Drop in this order: blank rows between groups, the blank row under the header [ev:198], secondary lines, list rows.
- A grouped list changes height while it scrolls [ev:202]. Count the group headers inside the window, or pin the first header.

## 11. What the kit does for you

`mods.py new` copies the kit into `hooks/kit/`. Its behaviour is proven live; the cites name the runs. Do not write these behaviours again.

- `format.ts` measures text in terminal cells, not `.length`. `cut` and `fit` cut a label to its room with `…`, so a row stays one screen line [ev:199]. `clean` strips escape sequences and control characters [ev:185].
- `ctx.ts` reads the three state cells in the render and sizes to `bodyColumns - 1` and `bodyRows`, with a floor of 20 columns and 8 rows.
- `header.tsx` draws the breadcrumb `<title> · <subject>` (`›` inside a screen) with ONE bold span, and a dim `─` rule.
- `footer.tsx` draws the action Buttons on one row and the dim hints on the next. It drops hints from the front to fit, never `Esc`. While an action runs, it shows `Waiting for the result…` and no action keys. Use at most 3 action keys. At 60 columns, a row of more than 3 action keys is too wide.
- `notice.tsx` and `press.ts` draw a notice in its tone, with `Esc to dismiss` and an optional `r: retry`. A timed notice clears after 5 s. Any press on the pane clears an error notice.
- `list.tsx` draws the selectable list. Each row is one plain Button; the selected row has `❯` and `autoFocus`. The window fits `bodyRows` [ev:200]. Dim edge rows `↑ N more` / `↓ N more` keep the height steady [ev:201]. Edges are never focusable [ev:191].
- `focus.ts` keeps the ring and `❯` on one row. The selection follows the ring. An arrow move lands on the key drawn now at the picked slot, as `/diff` does [ev:189] [ev:190]. A person's arrow move to an `act:` key is refused [ev:192] [ev:193]. A wrap across a window is refused [ev:194]. The hook writes one small patch after the move [ev:204] [ev:205].
- `close.ts` handles Esc in a fixed order. While an action runs, Esc does nothing. Else Esc does the first step that applies: dismiss the notice, close a picker, leave a field, cancel a confirm, collapse, go back one view. Each step denies the close and opens the pane with focus again. It puts the ring on a known key [ev:208]. Only at the top level does Esc close the pane.
- `confirm.tsx` draws the question, `y: <verb>`, `n: cancel` and `y to <verb> · Esc to cancel`. It focuses `confirm:no` by key [ev:210].
- `drafts.ts` and `input.tsx` keep a draft while the person types and after a failed send. The Input key holds an epoch, so a kept draft shows again after a result.
- `states.tsx` draws the loading, empty and error screens with header and footer, and one line for `mobile` and `vscode`.
- `pane.ts` opens the pane from a command or a press and reports `Pane waits: <reason>` when it is not placed. `toast.ts` always logs a result and sends a toast only while the pane is closed [ev:162].
- `band.tsx` draws the band row with `ctrl+x tab to open` and a Button with no hotkey. It yields to a survey, before the first load, and while the pane is open. It opens the pane twice, 150 ms apart; that is proven live, and the reason is unknown. Put no Button in the band line: ctrl+x tab rings the first Button, so Enter presses it, not open. A band that shows only during a turn tests `e.props.isWorking` [D:AbovePrompt] first.
- `scenario.ts` parses `/<mod>-proto <A|B|C|D> [scenario]`, resets the fixture world, and drops the timers of an older scenario. `runAction` runs one action: busy, pending notice, result notice, draft cleared, ring on a known key [ev:207] [ev:209]. A real action gives an async outcome and `waitMs: 0`; a thrown outcome becomes an error notice.

## 12. Review checklist

`mods.py score` ticks the boxes marked **score**; other drivers tick the boxes that name them. You judge the boxes marked **you**: wording, hierarchy, glyph choice, grouping. A group scores 1 when every box is ticked. Pass: all 7 groups score 1. Tie-break: more boxes ticked, then fewer rows at 60 columns, then C (closest to `/diff`) [ev:186]. Write the tie-break in the report.
#### Native
- [ ] **score** `footer`, `footer-dim`: hint line `<keys> to <verb> · … · Esc to <verb>`, dim, last.
- [ ] **score** `separator`: ` · ` only, no ASCII `|`. **you**: glyphs from section 6, no emoji.
- [ ] **score** `pointer`: selected row `❯`, others two spaces.
- [ ] **you**: rows are plain Buttons with stable keys; one blank column at the right; no border inside; no own title row in a dock.
#### Hierarchy
- [ ] **score** `one-bold`: one bold span per header. **you**: secondary text dim, asides dim italic.
- [ ] **score** `colour-not-alone`. **you**: colour only on data, ThemeKeys only.
#### States
- [ ] **you**: empty, loading, error and overflow each have a plain-word dim line.
- [ ] **score** `edges`: an edge row on overflow; the height stays steady while paging.
- [ ] **you**: the band returns `next(e)` when idle or under a survey.
#### Fit
- [ ] **score** `pane`, `fits60`: drawn at 150 dock, 100 and 60 inline; no wrapped row at 60.
- [ ] **you**: paths `truncate-start`; a narrow inline view has a dim resize line.
#### Keys
- [ ] **mods.py crawl**: every visible key works; no digit hotkey on a band.
- [ ] **score** `ring`: the ring and `❯` are on one row. **mods.py crawl** `focus`: the safe choice has focus on a confirm. Esc steps back, and the keys stay in the pane.
#### Accessibility
- [ ] **mods.py live --nocolor**: readable with `NO_COLOR` (a glyph or a word per state).
- [ ] **you**: no animation under reduced motion or screen reader mode; nothing reachable only by hover.
#### No raw data
- [ ] **score** `no-raw`: no raw JSON, pipe tables, `null`, `undefined` or stack lines [ev:187] [ev:188].
- [ ] **you**: text from disk or tools has no secret-shaped values.

## 13. Gaps

Not found: how the host draws the pane tab, title bar and close mark; the glyph and colour of a toast. Not documented: Desktop pixels and fonts. Not tested: whether screen reader mode changes a mod's tree.
