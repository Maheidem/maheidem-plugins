# Kit changelog

## v2 (2026-10-10)

`KIT.version` is 2. The `X` type parameter changes the generic signature of 44 kit functions and types. No export is removed.
A mod that compiles with v1 compiles with v2 with no change, because `X` defaults to `{}`.
The hash changed. Run `mods.py kit-sync` in each workbench: `check` says `kit v1 drift` until then.

- `types.ts`: `World`, `Handles`, `Ctx` and `Nav` take a last type parameter `X extends object = {}`. `World<T, S, X>` is the fixed world fields `& X`. A mod puts its own world fields in `X`.
- The kit then passes the mod's own world to the mod callbacks and to `Ctx.w`. The callbacks are `Nav.back`, `Nav.home`, the `keys` option of `focusHook`, and `outcome` and `apply` of `runAction`.
- Every kit function that takes `Handles`, `Ctx`, `World` or `Nav` has `X extends object = {}` as its LAST type parameter. `listRows<V, T, S, R>` is now `listRows<V, T, S, R, X>`. A required parameter cannot follow one with a default.
- The kit infers `X` from `k` or `c`. A call that does not infer it takes the type arguments: `Ctx<View, Row, Scenario, WorldExtra>`.
- `scenario.ts`: a small helper `wp` casts the kit's own world patches. TypeScript cannot prove that a literal fits `Partial<World<T, S, X>>` when `X` is open.
- `band.tsx`: `bandRow(E, line, onOpen, keys = [])` draws one Button for each key AFTER the Button `open`. So `ctrl+x tab` then Enter always presses `open`. `ctrl+x tab` then the hotkey presses the key.
- `band.tsx`: `bandQuiet(k, props, w, o?)` takes the option `o = { idle?: 'yield' | 'show'; working?: boolean }`. With `idle: 'yield'` the band is quiet while no model turn runs. `o.working` wins over `props.isWorking`. A call with no `o` behaves as in v1.
- Tests: `kit.band` has 7 tests (3 new). Idle yield with `working: false` is quiet. Idle yield with `working: true` is not. `bandRow` with one key draws `open` before the key.
- The kit tests keep `World<R, S>`, so `X` is `{}` there.

## v1, fixes (2026-10-11)

The version stays 1: no export was removed. These fixes come from four proof runs of the skill on 2.1.296.

- `confirm.tsx`: the safe Button reads `n: cancel`, in lower case like `a: add` and `d: delete`. The journeys expect `n: cancel`.
- `scenario.ts`: `runAction` takes an async outcome and the option `waitMs` (default `ACTION_MS`). A real action passes 0.
- `scenario.ts`: an outcome that throws or rejects gives an error notice with its first line. Before, `busy` stayed set and the pane froze.
- `band.tsx`: a comment says to put no Button in the band line, and names `isWorking` for a band that shows only during a turn.
- `defaults.ts`: a comment no longer names a template folder, so the kit-words lint passes.
- Tests: `kit.scenario` has 13 tests (2 new). `kit.confirm` checks the `cancel` label.

## v1, fixes (2026-10-10)

The version stays 1: no export was removed. Live proof on Claude Code 2.1.296 (the list-pane template, noun note): mockups 84 captures, ring MISMATCH 0; crawl 19 of 19 nodes, 67 of 67 edges; storyboard gate all pass.

- `focus.ts`: the slot math reads the drawn window (`windowSeen`), not the selection in the cells. `record` is one atomic update. Fixes the ring one row away from the pointer after arrow bursts 5-20 ms apart. A wrap needs 3 or more drawn rows (as /diff `isFar`).
- `list.tsx`: `listWindow` picks the first layout that the pane holds (gap and edges first, then no gap, then no edges), so the footer always shows on a 30-row terminal. `ListWindow` has two new fields, `gap` and `edges`. New export `windowSeen`. `topOf` keeps the selection in a window of one row.
- `input.tsx`: no input and no submit while an action runs, so a failed save keeps the text it says it kept.
- `band.tsx`: the double open stays; the one-open probe failed (see README, Limits).
- `README.md`: the measured limits.

## v1 (2026-10-10)

`KIT.version` is 1 in this entry. `KIT.types` is `2.1.296` (the types that the kit is proven on, live).

### Proven on

- Claude Code 2.1.296 with the plugin-authoring types 2.1.296: `tsc --noEmit` (TypeScript 5.6.3) gives no output.
- The same check against the types 2.1.295 also gives no output.
- `claude plugin validate <mod> --strict` ends with `✔ Validation passed`.
- `claude plugin test <mod>` gives 144 pass and 0 fail: 137 kit tests and 7 tests of the list-pane template that composes the kit.
- The composition is the `register.tsx` of kit API section 9 with a small `views.tsx` and `fixtures.ts`. It draws a list, a detail view, an add view, a confirm strip, a notice with retry, and the loading, empty and error views.
- The kit is proven in a live Claude Code pane. The list-pane template (kit API section 9 composition) passed these live checks on Claude Code 2.1.296 on 2026-10-10:
  - `capture-matrix.py`: 80 captures (4 variants, 5 modes, 3 sizes, 5 extra screens), 0 failed, ring MISMATCH 0.
  - `crawl.py`: 19 of 19 nodes, 64 of 64 edges, ring MISMATCH 0.
  - `journey-lint.py` with the crawl shots: OK. `audit-handlers.py`: 0 OPEN, 0 stale.
- `KIT.types` changed from `2.1.295` to `2.1.296` after that proof. The two types files differ only in docs and in `autoCompactWindow` (not used by the kit).
- Do not write the name of a template in this folder. `new-mod.sh` renames that name in every file of a new mod, so the hash of `hooks/kit/` would then differ from the hash of the kit.

### Modules

| File | Exports | Tests |
|---|---|---|
| `types.ts` | `Ui`, `Cell`, `PatchCell`, `Host`, `Tone`, `Notice`, `NoticeSpec`, `Confirm`, `Action`, `Variant`, `UiState`, `World`, `Drafts`, `Handles`, `PaneProps`, `Ctx`, `KeySpec`, `ListKeys`, `FocusExtra`, `Nav` | (types only) |
| `defaults.ts` | `KIT`, timing constants, `HINTS`, `KEYS`, `TONE_COLOR`, `GLYPHS`, `POINTER`, `SEP` | (constants only) |
| `ctx.ts` | `ctx`, `isBusy` | used by every mount test |
| `format.ts` | `cells`, `cut`, `pad`, `fit`, `oneLine`, `firstLine`, `clean`, `kChars`, `when`, `age`, `duration`, `headLines` | `kit.format` (6) |
| `pane.ts` | `openPane`, `isOpen`, `closeIfOpen` | `kit.pane` (8) |
| `toast.ts` | `announce` | `kit.toast` (3) |
| `header.tsx` | `header`, `rule`, `HeaderOpts` | `kit.header` (12) |
| `footer.tsx` | `footer`, `footerRows`, `hintsFor`, `fitHints` | `kit.footer` (8) |
| `notice.tsx` | `notify`, `noticeNodes`, `noticeRows`, `dismissable` | `kit.notice` (6) |
| `press.ts` | `pressHook` | `kit.press` (6) |
| `list.tsx` | `listRows`, `listWindow`, `rowKeys`, `topOf`, `roomSeen`, `windowSeen`, `ListRow`, `ListWindow`, `ListOpts` | `kit.list` (10) |
| `focus.ts` | `focusHook`, `focusPatch`, `focusNow`, `focusSoon` | `kit.focus` (20) |
| `close.ts` | `closeHook` | `kit.close` (12) |
| `confirm.tsx` | `confirmStrip`, `askConfirm`, `cancelConfirm`, `ConfirmOpts` | `kit.confirm` (7) |
| `drafts.ts` | `setDraft`, `draftValue`, `onType`, `onSubmitted`, `clearTyping` | `kit.drafts` (6) |
| `input.tsx` | `draftInput`, `DraftInputOpts` | `kit.input` (7) |
| `states.tsx` | `loadingView`, `emptyView`, `errorView`, `mobileNote` | `kit.states` (11) |
| `band.tsx` | `bandRow`, `bandQuiet`, `openFromBand` | `kit.band` (7) |
| `scenario.ts` | `parseSwitch`, `usage`, `reply`, `startScenario`, `later`, `runAction`, `Outcome`, `ActionOpts` | `kit.scenario` (11) |

The tests are in `templates/kit-tests/`. `fake.ts` and `flat.ts` are the test helpers.

### Integration notes

- Every mount test draws through its own test hook (`on('ui.render', ...)` with plugin `kit-test`). No test needs a mod, a mod name or a mod command. A generated mod can run all kit tests as they are.
- A test hook cannot press a Button that it drew. The press tests of `confirm` call the `onPress` handler of the drawn Button.
- A mod needs `hooks/hooks.json` with `{ "modules": ["./register.tsx"] }`. Without it, `claude plugin test` says `no hooks module to load`.
- `ui.focus` under `claude plugin test` rejects with `no implementation for ui.focus`. The kit catches it (`focusSoon` ends in `.catch(() => undefined)`).
- The engine drops the `key` prop of a `Text`. Find a `Text` by its text, not by `key`.
- One windowed list for each mod: `list.tsx` keeps one `room` buffer.
