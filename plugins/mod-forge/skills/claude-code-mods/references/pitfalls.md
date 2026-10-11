# Pitfalls: symptom, cause, fix

Find the symptom, then apply the fix. Cites as in `api.md`. `[PG:<path>]` is `mods/<path>` in `https://github.com/anthropics/claude-code-playground`. `[EX:<file>]` is PA `examples/<file>`. "The kit" is `hooks/kit/` in a mod made from a template.

## 1. Load and validate

| Symptom | Cause | Fix |
|---|---|---|
| Validate passes, but it prints no `hooks:` line | `hooks.json` has no `modules` | `{ "modules": ["./register.tsx"] }` [DOC:troubleshoot] |
| Validate prints an error string | a scan rule | Find the string in `api.md` section 3 and apply that rule |
| `Plugin "x" is reserved: it passes as one of Anthropic's own` | a reserved name or prefix | Name the mod for what it does [ev:286] |
| No mods load at all | trust prompt open, `--safe-mode`, `--bare`, `disableAllHooks`, or a managed policy | `api.md` section 2 [DOC:troubleshoot] |
| `tsc` passes, but the mod breaks on this build | The types that the engine wrote are old [ev:334]. | `mods.py check` reads that header line. Refresh the types, or use `templates/tsconfig.check.json`. |

## 2. Commands

| Symptom | Cause | Fix |
|---|---|---|
| The `/x` reply shows `my-mod: text` | expected: Claude Code puts the plugin name before a `{ text }` reply (`cmdtest: REGCMD-HANDLED args=hello`) | Do not repeat the mod name in the text [ev:288] |
| `Unknown command: /x` | not registered, or the `session.start` hook threw before `register` | Register in `session.start`; put that call first, or in a `try` [DOC:api] |
| `$.command.register takes { name, ... }; name is letters, digits, _ or -` | a colon in the name (`my-mod:cmd`) | A bare name; or ship `commands/<name>.md` and match `{ command: '<plugin>:<name>' }` [ev:289] |
| `registered /x but no command.run hook answered it` | the matcher name differs, or the hook was skipped | Match `{ command: 'x' }` exactly [ev:291] |
| `/help` registers with no error, then no hook answers it | The cause is not known. It happened in `claude -p`. | Do not use `help` as a name [ev:296] |
| A command vanishes after a save | not registered again on reload | Register in `session.start`; it fires again on reload [ev:292] |
| The command must work with mods off | `$.command.register({ name: 'x' })` gives `/x` (matcher `{ command: 'x' }`) with mods on only | `commands/x.md` with `disable-model-invocation: true` and a fallback body, plus a `command.run` hook on `{ command: '<plugin>:x' }`; type `/<plugin>:x` [ev:293] [ev:297] |
| The `.md` body or a model turn runs after your hook answered | the hook called `next(e)` | Return `{ text }` or `{}`. Do not call `next`. Proof: 2.1.295 headless [ev:294]; 2.1.287 interactive [ev:295]. |

## 3. Panes and bands

| Symptom | Cause | Fix |
|---|---|---|
| The pane never shows | an unasked open below 144 columns | Open from a command or a press, then check `isPlaced` (kit `pane.ts`); when false, draw in the band [D:UiOpenResult] [PG:blast-radius/hooks/blast-radius.mjs] |
| `ui.open: focus is true or left out` | `focus: false` (also `closeOnEscape`, `holdToasts`, `autoFocus`) | Omit the prop, or `cond ? true : undefined` [DOC:interface] |
| The pane opens without the keys | the band or the composer held them | Hide the band, `await $.clock.sleep(200)`, then open with `focus: true` [PG:replay-theater/hooks/replay-theater.mjs] |
| Esc at an empty prompt closes the pane | `closeOnEscape` also acts at an idle, empty prompt | This is normal behaviour [D:PaneOpenArgs]. Do not set `closeOnEscape` for a pane that stays open. |
| A gray pane, or the stock drawing in place of yours | the tree was refused | Read the `refused: <reason>` line [PA:Drawing: ui.render]; check the props in [D:Elements] |
| A `Text` ignores its `text=` prop | `Text` takes its words as children | Write `<Text>words</Text>` [DOC:reference] |
| The pane is blank after a long text | one element over 10,000 characters | Split Markdown at about 9,500 [ev:298] |
| A colour does not follow the theme, or `Text prop "color" must be a color ...` | a named colour is fixed in every theme [ev:299]; `ansi:red` is refused [ev:300] | A ThemeKey; else `#hex`, `rgb(...)` or `ansi256(...)` |
| A value does not update after a press | a module variable changed and nothing redraws | Keep it in `$.state`, or call `$.ui.invalidate('ui.render')` [ev:301] |
| Right after very fast arrows, the ring is one row away from the `❯`, and Up at the top slot does nothing | Known limit: the engine can lag when arrow keys come 10 ms apart or faster. The numbers are in kit `README.md`, Limits item 5. | No fix needed: kit `focus.ts` (`settle`) puts the ring back on the selected row 80 ms after the last arrow |
| Your band hides the survey or other mods' bands; or the check never fires | no `hasSurvey` check, or it reads `e.hasSurvey` [PG:token-weather/hooks/token-weather.mjs]; your tree replaces what is below | `if (e.props.hasSurvey) return next(e)` (kit `band.tsx`) [EX:band.tsx]; put `await next(e)` in your Box [DOC:interface] |

## 4. Keys and focus

| Symptom | Cause | Fix |
|---|---|---|
| The band eats the `1` of `1. fix the parser` | a digit hotkey on a band | Letters, or no hotkey on the band (kit `band.tsx`) [ev:26] |
| A hotkey does nothing | the site does not hold the keys | `ctrl+x tab`, a click, or `open({ focus: true })` [ev:303] |
| Esc in a focused Input closes the whole docked pane | Esc in the Input raises `ui.close` with origin `person` [ev:304] | Kit `close.ts`: deny the close [ev:305], open with `focus: true` again, then focus a key [ev:306]. Without it a crawl edge failed 3 times; with it 58/58 passed [ev:307] |
| After a view change the ring sits on the wrong row, or on `y: delete` of a confirm | the host keeps the ring at the same SLOT; `autoFocus` does not move it [ev:308] [ev:309] | After the view write, focus the new element by key (kit `focusSoon`, `askConfirm` focuses `confirm:no`) |
| The ring and `❯` are on different rows; ↓ sticks at row 2 or at an edge row | selection not driven from `ui.focus`; focusable edge rows [ev:313] [ev:316] | Kit `focus.ts` writes the selection and lands on the slot, as `/diff` does (`views/dialog-pane/dialog-focus-of.ts`); kit `list.tsx` draws edges as dim Text |
| ↓ past the last row puts the ring on a footer hotkey | footer Buttons are in the arrow ring [ev:311] | Kit `focus.ts` returns `{}` for a person on an `act:` key; the letter still presses it |
| Fast ↑/↓ presses are lost | heavy work in `ui.focus`: 16 presses at 0.5 s moved 2 rows [ev:314] | Write one small key, only when the row changed. The kit took 22 presses at 0.1 s with no loss [ev:315] |
| An inline list shows 1 or 2 rows and the hint is cut; a grouped list jumps while it scrolls | `rows` above about a third of the screen is not granted [ev:95] [ev:310]; group headers in the window come and go [ev:312] | Fit to `e.props.scroll.bodyRows` (kit `list.tsx`, flat lists only); count headers in the window budget |
| Arrow focus opens a `Select` list at once; an `Input` is empty after Enter | the engine opens a focused `Select` [ev:317]; it empties a field after Enter [ev:318] | `api.md` section 5 traps; kit key `pick:<name>`; kit `drafts.ts` and `input.tsx` [ev:319] |
| `TS2339: Property 'Input' does not exist on type ...` | `mobile` has no `Input` or `Select` [D:Elements] | Return early on `e.surface === 'mobile'` before you take `Input` [ev:320] |
| A test fails: `no implementation for ui.focus` | the plugin's own `$.ui.focus` has nothing beneath it under test [ev:322] | End the call with `.catch(() => undefined)`; prove the focus live (journey node field `focus`) |

## 5. Guards, the worker and the environment

| Symptom | Cause | Fix |
|---|---|---|
| A guard let a call through after an error | no `.catch`, so the failed hook was skipped | A fail-closed `.catch` [PA:Developing one] |
| A deny did not stop the tool | the deny came after `next(e)` resolved | Judge before `next` [PA:Developing one] |
| `live --debug` counts a refusal that the mod did not make | a hook of the user (for example a stop hook) quotes the deny text of your guard in its own debug line | None: `live` counts only the lines of the engine about the mod (`<n>: ... skipped`, `hook failed: <n>: ...`, `[<n>] ... dropped`); a `Hooks: ...` line is not counted |
| `journey: FAIL ... OPEN` on `hooks/rules.ts` and the guard hook after `new --parts toast,command,guard` | the guard needs a scenario with the role `deny` to reach its lines | `new` and `domain` add the scenario `blocked:deny` when you give `--parts` with guard and no `--scenarios`; with `--scenarios`, add `blocked:deny` yourself |
| All mods stop | a loop with no `await` wedged the shared worker | Await `$` calls; check `next.signal.aborted`; `/reload-plugins` after 3 crashes [ev:20] |
| `<n>: <event> hook skipped` after about 10 s | the hook used up its own time | Move long work to `session.start` and `$.clock` [PA:Work that outlives a dispatch] [ev:63] |
| A poll with `$.process.run(['sleep','0.25'])` is slow | each poll starts a process | For a yes/no hold in `tool.call`, use `$.ui.ask` [DOC:events] |
| A press handler times out | long work in `onPress` (a permission prompt can outlive it) | Detach it: `void startAction(...)` [ev:328] |
| The wrong project folder | `$.session.cwd()` moves with a Bash `cd` | `$.session.root()` [ev:329] |
| `CLAUDE_PLUGIN_ROOT` is undefined | not set for a mod | `$.plugin.root` [ev:330] |
| `CLAUDE_PLUGIN_DATA` shows another plugin's folder | not set for a mod (only stdio MCP servers get it [ev:331]); the value leaked from the parent shell | Find the data folder from the provenance key [ev:332] |
| The mod works installed, fails with `--plugin-dir` | the copy loads as `<name>@inline`, so a lookup in the installed registry fails [ev:233] | Read an override env var first [ev:333]; set it with `CC_ENV` in `scripts/live-test.sh` |
| `NO_COLOR=1 tmux new-session ...` still has colour | tmux starts the command with the SERVER's env | Put the var in the command string, or in `CC_ENV` [ev:335] |
| Raw text breaks the layout | ANSI or control characters from disk or tools | Strip them; redact secrets [ev:185] |
| `tmux kill-session -t =proto-A` gives `proto-A not found` in zsh | zsh reads a word that starts with `=` as a command path | Quote it: `"=proto-A"` [ev:336] |
| A local path (`logging to /private/tmp/...`) shows in every capture | the session runs with `--debug-file` | Start captured sessions with `NODEBUG=1`; the driver does it [ev:337] |

## 6. State and reload

| Symptom | Cause | Fix |
|---|---|---|
| `state.set: denied: it was made while ui.render is being dispatched`, also from `void Promise.resolve().then(...)` in a render | a render hook never writes; a deferred write still counts as part of the render dispatch [ev:321] | Write from the command or a handler. For a window size, use the kit's layout cache (`roomSeen()` in `list.tsx`) |
| Data is gone after a save | a module variable | `$.state` for drawn data, `$.store` for durable data [PA:Drawing: ui.render] |
| Data is gone after `/clear` | `$.state` resets and `session.start` does not fire; module variables SURVIVE, so an init flag says "done" [ev:80] | Re-seed in `classic.SessionStart` with `source: ['clear','resume','fork']` [DOC:interface] |
| A save shows only after about 30 s | the watcher went idle (`idle, polling every 30000ms`) | Expected [ev:323]; wait for `reloaded in`, or run `/reload-plugins` |
| A timer stops after a save | timers drop on reload | Start timers in `session.start` [ev:324]; guard with a lazy `ensureInit($)` [ev:325] |
| Old code still runs after a save | the new file failed to load | Look for `reload failed, the previous version stays loaded` [ev:326] |
| The mod is gone after `/reload-plugins` | a broken file: `[ERROR] hooks module <n>@inline failed to load` | Fix the file; the watcher loads it again [ev:83] |
| Edits to an installed mod are ignored | a git or npm install runs its copy | `--plugin-dir`, or a folder marketplace and `/reload-plugins` [PA:Developing one] |
| `$.store` lost an update | `get` then `set` is not atomic; all sessions share it | One key per item; read again before a write [DOC:interface] |

## 7. Driver messages

| Message | Cause | Fix |
|---|---|---|
| `check: FAIL ... kit drift` | the files in `hooks/kit/` differ from the skill's kit | `mods.py kit-sync`; keep mod code out of `hooks/kit/` |
| `new: FAIL <wb> exists` | an earlier run made that workbench | Pick another name; the driver never deletes a workbench |
| `crawl: FAIL pick a variant first ...`, or `crawl: FAIL journey.json is older than journey.py ...` | no pick yet, or `journey.py` changed | The person picks, then `mods.py pick <V>`; or run `mods.py journey` |
| `FAIL node <id>  start <id> missing <marker>`, or `FAIL edge <id>  ... missing <marker>` | reset failed, weak marker, prototype bug, timing, or a key that did not reach the pane | Read the shot and `storyboard.md` (failures); then `mods.py crawl --only <ids>` |
| `GATE FAILED: N check(s)` | gaps in graph, shots, crawl, ring, hint keys or hotspots | `mods.py storyboard --draft` marks each gap |
| `WARN storyboard.html is 19.2 MB, above the 16 MB page limit` | too many shots or colours | `--colors 48`, then `--colors 32`; the result stays PASS |
| `build: FAIL the storyboard is not approved; run mods.py approve` | no approval in `mod.json` | The person walks the player, then `mods.py approve --by person` |
| `clean: FAIL refused to delete run: it resolves outside the workbench` | `run` is a link out of the workbench | Remove the link yourself, after a check |
| `upgrade-check: FAIL 7/8 names found (0: ...)` | a symbol changed in the new build | Read the new declaration; update `VERSIONS.md` |

## 8. Quirks (not bugs)

- `ctrl+x x` (`pane:close`) does nothing after `ctrl+x tab`; it works right after an open [ev:339]. Two Esc at an empty prompt open `Rewind`. A test script must not send Esc there [ev:340].
- A Button under the mouse is drawn inverse. A focused empty Input draws its cursor over the first placeholder cell [ev:341].
- Enter on a closed `Select` commits its shown value. Guard with `if (value !== current)` [ev:342].
