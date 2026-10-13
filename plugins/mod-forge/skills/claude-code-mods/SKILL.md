---
name: claude-code-mods
description: |
  Claude Code mod UI: screens, keys and live proof. Use this skill whenever someone adds, builds, restyles, fixes or tests what a Claude Code mod shows or reacts to: a pane, a list to arrow through, a band above the prompt, a toast, a mod slash command with Enter, delete or y/n keys, or a tool.call guard in a hooks module. Load plugin-authoring first as the base, then this skill. For mod work, use it over tmux-orchestrator and frontend-design.
  It covers:
  - new mod commands, views, toasts and guards
  - ugly or non-native panes, for example pipe tables, in hooks/*.js|tsx
  - mockups or a storyboard of every screen, for approval before the build
  - a ui.render hook or AbovePrompt band that does not draw, eats keys or must yield
  - live tmux proof at set widths, inline or docked, with NO_COLOR and a focus ring
  Not for settings.json hooks, keybindings, MCP servers, plain skills or agents, statusLine scripts or web UIs.
argument-hint: "<mod-name> [pane-list|pane-simple|band|status-toast|guard|command|mixed]"
allowed-tools: Bash(python3 -I ${CLAUDE_SKILL_DIR}/scripts/mods.py *)
metadata: { version: "2.0.0", verifiedOn: "2.1.295, 2.1.296" }
---

# Claude Code mods: driver, kit and live proof

This skill builds a Claude Code mod that looks native, and proves it on a live screen.
A driver script runs and checks each step. A kit holds the screen behaviour that live runs proved.
Run the driver. Read its last two lines. Do what `next:` says.

!`python3 -I ${CLAUDE_SKILL_DIR}/scripts/mods.py doctor --brief`

## 1. How this skill relates to plugin-authoring

Load the built-in `plugin-authoring` skill first, then this skill. It gives the three files, the dev-mods and types paths, the surface line and `on($, e, next)`.
It also gives the hot-reload consent with its four answers, `validate` and `test`. This skill adds a driver and a kit. It adds a design pass and the native look. It adds exact limits, live tmux proof and pitfalls.
Do not repeat plugin-authoring. Cite `[PA:<heading>]` for its `reference.md` and `[D:<symbol>]` for its types file, never a line.

Terms: a pane is the framed region that `$.ui.open` asks for, docked at the side or inline above the prompt. A band is the `AbovePrompt` site, the rows above the prompt.
A hotkey is the one-key `hotkey` prop of a Button. A tree is what a `ui.render` hook returns. A guard is a `tool.call` or `tool.check` hook that can refuse.

Where this skill differs from plugin-authoring:

1. The types file has 21,451 lines on 2.1.295 and 21,463 on 2.1.296, not "about 14,000". Grep a symbol. Never read the whole file.
2. The test kit of `claude plugin test` checks hooks and trees, not the screen [PA:Developing one]. This skill gives the live tmux proof.
3. plugin-authoring has no design pass, no mockups, no storyboard and no tmux run. This skill owns them.
4. The plugin-authoring example `pane.tsx` opens its pane in `session.start`. Below 144 columns that pane waits undrawn [ev:21].
5. `$.ui.status` always draws as a `⚠` warning line [ev:161]. Use a band or a pane for neutral text.
6. Two versions can show at once: the plugin-authoring folder (this session) and `claude --version` (the tmux binary) [ev:2]. Report both.
7. The `/diff` mod source is the design reference. The plugin-authoring `examples/` show the machinery only.
8. A deferred state write from a render is denied too [ev:19].

## 2. Decide the path

```
Kind (from the request)        --kind = template   Design pass
  pane with selectable rows      pane-list           full: mockups, pick, journey, crawl, storyboard, approve
  pane with no selection         pane-simple         full
  band above the prompt          band                full, on the band states; the storyboard holds the band keys
  toast or status line only      status-toast        no mockups, pick is automatic; journey, crawl, storyboard of the screen lines; live --turn
  guard that draws nothing       guard               approve on the checklist (ux-design.md §12); live --turn --probe
  mod slash command              command             no mockups; crawl the output row; live --cols 150,100,60
  no-pane parts together         the main part       add --parts toast,command,guard; a pane with parts: mixed
  desktop or mobile surface      the kind above      terminal pass; the person takes a desktop screenshot

Context (from the doctor block and the session)
  person can answer?     yes -> the person picks and approves (--by person)
                         no  -> take the highest score, use --by headless, and say so in the report
  Agent tool present?    yes -> a subagent reviews the journey (storyboard.md §3)
                         no  -> walk that checklist yourself and say so
  tmux absent?           doctor shows FAIL on tmux. Run new and check only.
                          Skip mockups, pick, crawl, storyboard and live. Give the person the mockups command. Never present an ASCII sketch as a mockup, also on this path: say that the live mockups are missing.
                         Report that the live proof is missing. done cannot pass (rows 4-6 and 8 stay MISSING, testing.md §7).
  /diff source absent?   claude plugin marketplace add anthropics/claude-code, or read it on GitHub (examples.md §2)
  version not known?     mods.py doctor --upgrade (a live smoke run), then go on
```

A mod is the wrong tool for these needs [DOC:overview]. A script that blocks, allows or logs: a settings hook. Instructions for Claude: a skill.
An external system: an MCP server. A neutral status line: the settings `statusLine` command (`$.ui.status` always draws a `⚠`).
Trust: a mod is not sandboxed. It runs with the person's permissions and sees every prompt and tool call [DOC:overview]. It can approve a tool call before the person is asked [DOC:overview] (`api.md` §8).

## 3. The workflow

Run each step as `python3 -I ${CLAUDE_SKILL_DIR}/scripts/mods.py [-C <wb>] <subcommand>`. That exact form needs no permission prompt.
Below, `mods.py` is short for it. Write the full path in each call: one `python3 -I <scripts>/mods.py <subcommand>` command per Bash call, with no `M=` variable and no `cd` (use `-C <wb>`). Only that form matches the allowed-tools rule. Omit `-C <wb>` when the current folder holds one workbench only.
Each call ends with two lines: `<cmd>: PASS|FAIL <summary>` and `next: <command or none>`. Exit code 0 is a PASS, 1 is a failed step, 2 is a usage or configuration error.
A FAIL prints the last 30 lines of the failing step. Fix the cause, then run the same command again.
Each call adds one section to `<wb>/RUN.md`, the evidence of the run. Record each step that you do by hand: `mods.py note --workaround "<text>"`.

| Thing | Name |
|---|---|
| Workbench `<wb>` | `<scratch>/<mod>/` (default scratch `./.mods`): `mod.json`, `src/`, `run/`, `mockups/`, `journey.py`, `crawl/`, `storyboard.html`, `player.png`, `logs/`, `RUN.md` |
| Prototype plugin | `<mod>-proto` in `<wb>/src/`. Edit `src/` only: the driver copies it to `run/` before each session. |
| Mockup command | `/<mod>-proto <A\|B\|C\|D> <scenario>` |
| tmux sessions | Prefixes from `mod.json`: `mx-<mod>-` (mockups), `sb-<mod>-` (crawl), `lv-<mod>-` (live) |
| Real mod | `<mod>` in the dev-mods folder, command `/<mod>` |

| Step | Command | PASS line | Your work |
|---|---|---|---|
| doctor | the `!` line above runs it. When the skill has arguments, run `mods.py doctor --brief <mod> <kind>` once for the exact `next:` line | `doctor: PASS 9 ok, 0 missing, 0 warnings` | Install what it reports missing. Add `--pa <base dir>` when it finds the wrong build. |
| new | `mods.py new <mod> --kind <kind> --trusted <dir> --pa <PA base dir> --noun <word> --fields '<name:type,...>' [--actions 'k:verb'] [--scenarios 'name:role,...'] [--text key=value]` | `new: PASS <wb> (kind pane-list, template pane-list, noun branch, kit v2, domain 4 fields)` | A pane or band needs one text, slug, path or name field (the title), or `--title-field`. A guard takes no `--fields`. `--actions` verbs: delete, remove, add, new, refresh, reload, clear, or `key:verb>field=value`. Role fails makes the FIRST action fail once: put first the action whose failure the journey must show. A real read that can change: add `r:refresh`.<br>`--trusted` names a folder that Claude Code already trusts. `new` copies the kit from `templates/kit` and runs `domain`.<br>1. Read the `/diff` source.<br>2. Give each `STYLE` row one persona (A UX, B Visual, C native, D Accessibility). The personas differ in tone, spacing, grouping and hint wording. Keep the row lead `<pointer> <mark> <tag> <title>`.<br>3. Edit only the `STYLE` rows and the words of `hooks/views.tsx`.<br>4. Make each key that a variant shows work. |
| domain | `mods.py domain [--check] [<flags of new>]` | `domain: PASS in sync` | `new` runs it. It writes `fixtures.ts`, `domain.ts`, `types/index.d.ts`, `journey.py`, the marker tests and the `mod.json` scenarios and screens. Do not edit them: run `domain` again with new flags. Types: text, slug, path, name, age, number, enum(a\|b), enum(a=ok\|b=err). A screen that the schema lacks goes in `<wb>/journey.local.py`. |
| check | `mods.py check` | `check: PASS validate ✔ · test <N> pass 0 fail · tsc rc=0 · kit v2 in sync · domain in sync` (pane-list: N = 152) | Fix what it prints (`pitfalls.md` §1). Run it after each edit. It copies the `Scenario` union of `types/index.d.ts` into `mod.json`. |
| mockups | `mods.py mockups` | `mockups: PASS DONE 84 captures in 181 s · ring {'OK': 36, 'MISMATCH': 0, 'n/a': 48} · failed none`, score rows `C 11/11 · A 11/11 · D 11/11 · B 9/11` | Open with Read the first PNG that it names. Then present `index.html`, the score rows and `tmux attach -t mx-<mod>-<V>`. A kind with no pane skips it, and `pick` is automatic. |
| pick | `mods.py pick <V> --by person\|headless` | `pick: PASS C by person` | The person picks. The score leaves wording, hierarchy, glyph choice and grouping to you. |
| journey | `mods.py journey` | `journey: PASS 6 scenarios, 19 nodes, 67 edges (36 approximate) · lint OK · audit 34 lines · 0 OPEN · 0 stale · TODO 0`<br>`journey: PASS markers 6 starts, 8 presses, 22 skipped (arrow/Esc 14, Enter 8) · test 161 pass 0 fail` | `journey` builds `journey.json` from the generated `journey.py`, lints it, audits it and writes the marker tests. A screen that the schema lacks goes in `<wb>/journey.local.py`. |
| crawl | `mods.py crawl` | `crawl: PASS nodes 19/19 · edges 67/67 · ring {'OK': 9, 'MISMATCH': 0, 'n/a': 10} · lint OK` | Fix each failure with the table in `storyboard.md` §5. Crawl the failed ids again with `--only <ids>`. |
| storyboard | `mods.py storyboard` | `storyboard: PASS gate all pass · wrote storyboard.html (1380381 bytes) · player: #confirm-normal, key y -> #list-after-delete, errors []` | It writes `<wb>/storyboard.html` and `<wb>/player.png`. Open `player.png` with Read. Above 16 MB the driver warns: build again with `--colors 48`, then `--colors 32`. |
| approve | `mods.py approve --by person\|headless` | `approve: PASS by person` | The person walks the player and approves it. |
| build | `mods.py build --dev-mods <dir>` | `build: PASS <dev-mods>/<mod>` | Take `<dir>` from the plugin-authoring text. The real mod is written under `<config dir>/dev-mods/<session>/` by design; a task that forbids it passes `--dev-mods <folder>`. `build` removes the prototype parts and fails when one is left. Write the data source that it names (`hooks/source.ts`; toast `hooks/watch.ts`; guard `hooks/rules.ts`) and its test. |
| live | `mods.py check --real`, then `mods.py live --real --marker <text>` | `live: PASS marker drawn · ring OK · loaded yes · refusals 0` (`--debug`)<br>`live: PASS marker drawn · ring OK · nocolor: SGR 7 yes, 38;5; none` (`--nocolor`) | 1. Run `live --real --debug --nocolor --marker <text>` once: it proves rows 4 and 8.<br>2. Run each proof that `next:` names (`--turn`, `--turn --probe`, `--cols 150,100,60`). Git data: `--git-repo`. A band with `idle=yield` draws only in a `--turn`.<br>3. The marker is text of a real row, never the pane title alone. `--keys` go after the marker shows; `--after <text>` proves the screen they lead to: it matches pane or band rows only, never the transcript. Data that a hook writes (a tool.call observer): `--turn --prompt '<a prompt that runs a tool>' --keys 'text:"/<mod>" Enter' --after <row text>`.<br>Nocolor rule: no `38;5;` colour on the screen. `SGR 7` shows only where a selected row or a ring shows (`live` presses Tab once when a pointer row has no ring). An empty, error or no-pane screen gives `SGR 7 n/a`, which passes.<br>Each PASS line ends with `· png logs/live-<n>.png`. Data that the trusted folder lacks: `--env NAME=VALUE` (`testing.md` §2). |
| done | `mods.py done` | `done: PASS gate 8 pass, 2 manual, 0 fail · cleanup ok` (N/A rows add `, <n> n/a`, `testing.md` §7) | Row 7 passes by itself when a `live --real --keys ... --after <text>` PASS ran after the build; a failed one makes it FAIL. Else walk the paths (`testing.md` §5). Row 9: quote the notice; a headless run says hot reload is off (nobody could be asked): quote that line. Paste the block into the report. |

A change to an approved mod: run `check`, `live` and `done`, and walk the checklist (`ux-design.md` §12). Make mockups again only for a screen that changes.
A redesign of an existing mod: run `mods.py audit-existing <folder> --marker <text>` first. Use text that always shows, for example the pane title. A row of live data may be missing. The `--trusted` folder (default: the current folder) must be trusted by Claude Code. The driver reads the trust state and prints a `warn:` line when the folder has no trust entry. The run goes on. The on-screen check in `live-test.sh` fails with `trust dialog: ...` only when the dialog really shows. (`audit-existing: PASS 4 captures · score <n>/<m>`). Then run `new` with a NEW name and the fields of the old data. It lists rule-11 findings (an unasked `$.ui.open` in `session.start`), and its `next:` names `<old>-v2`. Keep the old data source: it goes into the real mod after `build`. A `tool.call` observer goes in `hooks/source.ts` (`observe`); `build` names the slot.
Quick start for a pane: `doctor`, `new`, `check`, `mockups`, `pick`, `journey`, `crawl`, `storyboard`, `approve`, `build`, `live`, `done`. No pane (toast, command, guard): `mockups` skips and `pick` is automatic. A guard goes `approve` on the checklist, then `build`. Each `next:` line names the next step.

## 4. Hard rules

| # | Rule |
|---|---|
| 0 | Make live mockups before you change what the person sees: a prototype mod, PNG renders and live sessions. Do not write code for the real mod before the person picks. Use an ASCII sketch as a private note only. Do not show an ASCII sketch for approval. The user rejected ASCII mockups as "not a mockup". The command `build` refuses to run until `approve` passes. |
| 3 | Write `$.noun.method(...)` in full. Do not alias, destructure or index `$` or `$.ui`. Pass `$` only to top-level functions of the same file. The command `check` finds a wrong form. Write the form correctly at the start. |
| 7 | A render hook never writes state, direct or deferred [ev:18] [ev:19]. Write from the command or a handler. The layout cache of the kit is the one module variable that a render may set. |
| 8 | A guard judges before `next(e)` and has a fail-closed `.catch` [PA:Developing one]. Without `.catch`, an error lets the call through. |
| 11 | Open a pane from a command or a press. Then check `isPlaced` [D:isPlaced]. An unasked open waits undrawn below 144 columns [ev:21]. |
| 12 | Use `$.session.root()` for the project. `cwd()` moves with Bash `cd`, and a pane that used `cwd()` broke in a session of the user [ev:22]. |
| 13 | Render content, never raw data: no raw JSON, no pipe tables, no internal codes [ev:23]. |
| 14 | Use ThemeKeys for colour [D:ThemeKey]. A name (`red`) or a raw colour stays the same in every theme. `ansi:<name>` makes the engine refuse the tree [ev:24]. |
| 15 | Give each colour a glyph or a word too, for `NO_COLOR`. |
| 19 | Every state has a plain-word dim line: empty, loading, error, overflow. |
| 20 | No digit hotkey on a band [ev:26]. Every key that you show must work. |
| 21-27 | Use the kit in `hooks/kit/`. The kit owns these behaviours:<br>focus ring · list window height · Esc step-back · refocus after a view change · safe choice on a confirm · `Input` epoch key · `Select` behind a Button · mobile narrowing.<br>Do not write these behaviours by hand. Do not edit `hooks/kit/`. If you edit it, `check` fails. Run `mods.py kit-sync` to update it. |

The other numbers moved out: `validate` enforces 1-5, the kit and the templates enforce 6, 10 and 16-18, and `pitfalls.md` §5 holds 9.

## 5. Reading path

| Situation | Open |
|---|---|
| Always | The plugin-authoring SKILL text of this session, then this file |
| Before `new`, a hook or a drawing | [PA:What a plugin of function hooks is], [PA:Drawing: ui.render]; for timers and own time [PA:Work that outlives a dispatch] |
| Before `build`, `live` or a publish | [PA:Developing one] (loading, hot reload, `claude plugin test`), [PA:Sharing a mod] |
| Before mockups, and before polish | `references/ux-design.md` §1 Rules from the user, §11 What the kit does for you, §12 Review checklist |
| You write the journey | `references/storyboard.md` §2 Map the journey, §3 Audit |
| A crawl or the gate fails | `references/storyboard.md` §5 Crawl, gate, player (the failure table) |
| You need a toast, ask or open limit, a budget, an event or a reload fact | `references/api.md` §4 Limits, §5 Traps (`$.ui.status`), §6 Budgets, §7 Lifecycle and reload, §8 Events |
| Something does not load, draw, update or react | `references/pitfalls.md`, by symptom |
| Before `done` | `references/testing.md` §7 Done gate, §5 The user's real paths |
| You want a real mod that does it, a native-look sample (the `pane-simple` template), or the `/diff` source is absent | `references/examples.md` |
| You want to know where a fact came from | `references/evidence.md`, entry `[ev:N]` |
| The version is not in `references/VERSIONS.md`, or two versions show | Not in it: run `mods.py doctor --upgrade` (§6). The plugin-authoring folder and `claude --version` differ: report both (§1, item 6). |

Read no other file unless a row in the table above names it. The driver prints each procedure.

## 6. Versions and drift

The facts of this skill hold for 2.1.295 and 2.1.296 (`references/VERSIONS.md`). `mods.py doctor` reports both versions and greps the types file for the names that this skill uses.
A count of 0 means that a name changed: read the new declaration first. On a version that is not in `references/VERSIONS.md`, run `mods.py doctor --upgrade` before other work.

## 7. Gaps

- Nobody tested mouse hover and click, OSC 52 copy or Desktop pixels.
- We do not know if screen reader mode changes the tree of a mod. We do not know if a registered tool stays callable after a reload drops it. We do not know which width setting for ambiguous glyphs (`ambiguousIsNarrow`) the layout uses.
- The band of the kit opens the pane two times. That works on 2.1.296, but the reason is not known.
- A turn proof (`live --turn`) needs a trusted folder where the Bash call of the prompt runs without a permission dialog.
