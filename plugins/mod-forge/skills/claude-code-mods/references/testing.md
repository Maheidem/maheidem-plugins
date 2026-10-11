# Testing a mod: check gate, live loop, debugging, done gate

A green `claude plugin test` does not prove the screen [PA:Developing one]. Prove each screen in a real tmux session.

Source keys: `[ev:N]` = entry N in `evidence.md`. `[PA:<heading>]` = that section of the plugin-authoring `reference.md`. `[D:<symbol>]` = the types file; grep the symbol. `[DOC:<page>]` = `https://code.claude.com/docs/en/plugins/mods/<page>`.

## 1. Check gate: `mods.py -C <wb> check [--real]`

It runs five steps on `src/<plugin>` (with `--real`, on the dev-mods copy). Each step runs, also after an earlier failure.

| Step | Command | Pass |
|---|---|---|
| validate | `claude plugin validate <target> --strict` | rc 0, last line `✔ Validation passed` |
| test | `claude plugin test <target>` | rc 0, ` N pass` with N ≥ 1, ` 0 fail` |
| tsc | `npx -y -p typescript@5.6.3 tsc --noEmit -p tscheck/tsconfig.json` | rc 0, no output |
| greps | the template's plugin name, `your-name`, the template noun | no hit |
| kit | `hooks/kit/` against the skill's `templates/kit/` | `in sync` or `n/a` |

PASS line on a new `pane-list` mod: `check: PASS validate ✔ · test 149 pass 0 fail · tsc rc=0 · kit v1 in sync` (`band`: 154 pass). A FAIL prints the last 30 lines of the failed tool and each `error TS<n>` line.

- Validate does not run code. `gating hook without .catch` is a fact; only `Validation passed` or `Validation failed` is the verdict [PA:The types are the reference] [ev:212] [ev:213].
- A bad prop gives `error TS2353: ... 'bogusProp' does not exist in type 'PaneOpenArgs'` and `rc=2` [ev:218]. Plain `npx tsc` fails: it cannot find the executable.
- The tsconfig sets `allowJs` and `checkJs`, so a `.js` module is checked too [ev:219]. Give it types with `/** @param {import('claude-code').On} on */`. Do not type a JS `register` as `Register`: `checkJs` reports `TS2355` [ev:220].
- The engine writes `.claude-plugin/types/` and a `tsconfig.json` into a mod folder only when it watches that folder [ev:214] [ev:215]. `validate` and `test` never write them [ev:216]. `/plugin-types` does not exist [ev:217].
- An installed mod keeps old types that the engine wrote. Example: a pane had `// Written by Claude Code 2.1.288.` on 2.1.295 [ev:222]. `check` runs `tsc` on these types only when their first line names the output of `claude --version`. Old copies on GitHub are old too [ev:221]. Refresh them with `CLAUDE_CODE_PLUGIN_DIR_WATCH=1 claude -p "say ok" --plugin-dir <mod>` [ev:215], or type-check with `templates/tsconfig.check.json`.

Test-kit facts that PA does not state:
- No test file gives exit 1, `no *.test.ts or *.test.tsx under <dir>` [ev:223].
- An event with no answer beneath the plugin throws `HooksError: no implementation for <event>` [ev:224]. Stub each event that your path reaches. A stub takes `($, e)` like a mod hook [D:TestBody]: `on('process.run', ($, e) => ({ value: ... }))`. The plugin's own `$.ui.focus` always rejects this way under the test kit.
- Test another width with `redraw({ ...props, bodyColumns: 40 })`, not `resize`: `resize` lays out a `Client` region [D:Mounted] [ev:225].
- `find({ text })` returns the OUTERMOST match first [D:FoundElement] [ev:226]. Press a key that is not on a Button with `ui.key({ key, in })` [D:MountKeyEvent].
- Write a "fresh module, no `session.start`" test when entries depend on init [ev:227].
- Each call on a mounted tree (`press`, `input`, `select`, `key`) waits for the hook chain and its handler. Assert right after the `await` [PA:Developing one] [D:MountedMembers].

Headless smoke test: `claude -p "/<cmd>" --plugin-dir <mod> --debug-file <log>`, then grep the log for `hooks module <name>@inline loaded`. Headless loads fresh and does not watch [PA:Developing one].

## 2. Live loop: `mods.py -C <wb> live`

Options: `--cmd`, `--marker`, `--cols` (150, or a CSV `150,100,60`: one session per width), `--rows` (40), `--keys 'Down*3 Enter'` (`text:"..."` types text; sent after `--marker` shows), `--after <text>` (must show after the keys), `--git-repo` (a fixed scratch repo: branches `feat/login-1` to `docs/sync-40`, 2 modified files, 1 untracked file), `--nocolor`, `--debug`, `--keep`, `--real`, `--env NAME=VALUE` (repeat it), `--turn [--prompt T]` (a real model turn, with `--real`), `--probe` (with `--turn`: a guard proof; the probe folder lies outside the trusted folder). With `--real` the command is `/<mod>` and `--marker` is required. The session is `lv-<mod>-<n>`. It runs `scripts/live-test.sh`, sends the keys, waits 1.5 s, captures, renders a PNG and checks the ring.

PASS lines: `live: PASS marker drawn · ring OK · loaded yes · refusals 0` (`--debug`) and `live: PASS marker drawn · ring OK · nocolor: SGR 7 yes, 38;5; none` (`--nocolor`). Each ends with `· png logs/live-<n>.png`. Use text that only your drawing prints as the marker. A command reply is a weaker proof. `--nocolor` looks for `38;5;` on the whole screen: under `NO_COLOR` the 2.1.296 screen has no SGR code of its own. It needs SGR 7 only where a selected row or a ring shows, else it prints `SGR 7 n/a` and passes. `--nocolor` presses Tab once by itself when a pointer row has no ring. One `--debug --nocolor` run proves rows 4 and 8. A mod that reads data the trusted folder lacks (git): `--env GIT_DIR=<repo>/.git --env GIT_WORK_TREE=<repo>`. A scratch folder inside the trusted one is not trusted: the hooks do not load.

By hand (when the driver is not there), five rules [ev:228]:
1. Put env vars in the command string. `tmux new-session` uses the tmux SERVER's env, not the caller's [ev:234].
2. Start every session that you capture with `NODEBUG=1` (no `--debug-file`): the debug banner puts a local path into every PNG [ev:255] [ev:230].
3. Resize FIRST, then run the command, then capture. A docked pane that moves inline on a resize has no ring [ev:256] [ev:257].
4. Send ONE Esc at a time, only while the pane is open. Two Esc at the empty prompt open Rewind [ev:235] [ev:258].
5. Send text with `send-keys -l`, then a separate `Enter`. Text and Enter in one call is not reliable.

```bash
S=lv-<mod>-1; MOD=<copy of the mod>; TR=<trusted project folder>
tmux new-session -d -s $S -x 150 -y 40 -c $TR "env -u ANTHROPIC_API_KEY claude --plugin-dir $MOD"
for i in $(seq 1 60); do tmux capture-pane -p -t $S | grep -q '❯' && break; sleep 1; done; sleep 3
tmux send-keys -t $S C-u; tmux send-keys -t $S -l '/<cmd>'; sleep 1; tmux send-keys -t $S Enter
for i in $(seq 1 15); do tmux capture-pane -p -t $S | grep -q '<MARKER>' && break; sleep 1; done
tmux send-keys -t $S Down; sleep 1.5                # key names: no -l
tmux capture-pane -p -e -t $S > <out>.ansi          # with SGR codes
python3 -I ${CLAUDE_SKILL_DIR}/scripts/ring-check.py <out>.ansi   # exit 0 OK, 1 MISMATCH, 2 n/a
tmux kill-session -t $S
```

- Each wait loop has a limit. When it ends without a match, stop and read the screen and the log.
- Use `--plugin-dir` on a COPY, never on the session's dev-mods folder. The copy replaces an installed mod of the same name as `<name>@inline` [ev:232]. A mod that finds its data through the installed registry fails there: give it an override env var [ev:233].
- Run in a trusted folder: an untrusted folder blocks mods [ev:236]. Run `/clear` before each capture: reloads and old replies pile up [ev:259].
- `scripts/live-test.sh <copy> <command> <marker> [cols] [trusted]` env: `SESSION`, `LOGDIR`, `ROWS`, `CC_ENV="NO_COLOR=1"`, `KEEP=1`, `NODEBUG=1` [ev:229] [ev:231].
- When a band and a pane show, `C-x Tab` gives the keys to the band first [ev:237]. `ctrl+x x` closes a pane only right after open [ev:241]. With a pane open, the first Enter may not submit [ev:242] [ev:243].
- A band redraws only on the next event that renders it [ev:240]. In zsh, quote a target that starts with `=` [ev:260].
- Read SGR bytes with Python; `sed` fails without `LC_ALL=en_US.UTF-8` [ev:244]. A mod cannot write a log file: use `$.ui.log(text, { to: 'debug' })` [ev:245].

## 3. Renderer and placement

- `tmux display-message -p '#{alternate_on}'`: 1 = fullscreen, 0 = classic [ev:246]. Always read it: fullscreen can turn itself off [ev:238]. `CLAUDE_CODE_NO_FLICKER=1` turns it on [ev:239].
- `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` forces classic for one run [ev:247]. Do not run `/tui` in a test: it changes the saved setting [ev:248]. `tmux -CC` refuses fullscreen [ev:249].

| Case (measured [ev:250]) | Result |
|---|---|
| fullscreen, asked, 109 cols | inline |
| fullscreen, asked, 110 or 150 cols | dock |
| unasked, 143 cols | not drawn: `isPlaced:false`, `unasked below 144 columns`; a resize to 144 draws it |
| classic, asked, any width | inline |
| classic, 100 cols, unasked | not drawn: the 144 floor applies in classic too [ev:240] |
| dock, then a resize to 100 or 60 cols | it moves inline above the prompt and fits [ev:251] |

The script `scripts/ansi2png.py` makes the PNG [ev:263]. It uses rich to export an SVG. It draws one `<text>` element for each cell, so borders stay straight under rsvg-convert. Without rsvg-convert, it uses `qlmanage`. `RENDER_WITH=qlmanage` forces `qlmanage`. It drops blank rows at the end. Remove an old capture folder by its absolute path only [ev:253].

## 4. What tmux cannot test

`Image` draws only its `alt` text in tmux; test it in kitty 0.28+ or Ghostty [DOC:gallery]. `Svg` draws only in Desktop. Mouse hover and click, OSC 52 copy, exact RGB, and the Desktop, mobile and VS Code surfaces are out of reach too.

## 5. The user's real paths

A pane passed fresh `--plugin-dir` tests and broke three times in the user's session [ev:264] [ev:267]. So also test these, in a tmux session of your own:
1. Install from the directory-source marketplace, then `/reload-plugins`. That install is read from the source folder [PA:Developing one].
2. Run a Bash `cd` elsewhere mid-session. Use `$.session.root()` for the project; `cwd()` moves [ev:265].
3. Run `/reload-plugins`, open the pane again, and navigate.
4. Run `/clear`: `$.state` resets and `session.start` does not fire [PA:What a plugin of function hooks is] [ev:80].
5. Test at 60, 120 and 200+ columns [ev:266]. Your own Bash `cd` moves the user's session cwd: change back after.

## 6. Debugging

Where failures show: a watched folder writes a dim transcript line [ev:268]. An installed mod writes to the debug log only, as `[ERROR] <n>: ...` [ev:269]. `claude -p` writes "not loaded" lines to stderr [PA:Developing one].

| String (2.1.295) | Meaning |
|---|---|
| `hooks module <n>@inline loaded (worker, environment N, tier user)` | loaded [ev:270] |
| `hooks module <n> not loaded: <reason>` | refused at load |
| `<n>: <event> hook skipped: threw ...` | a hook threw, timed out or gave a bad shape |
| `ui.render (<C>) refused` / `does not validate` | bad tree; the full text: [PA:Drawing: ui.render] |
| `<n>: ui.render (<C>) threw while drawn: <reason>` | valid tree, failed at paint |
| `reload failed, the previous version stays loaded: <reason>` | broken save |
| `hooks module <n>@inline reloaded in 6.5ms` | good reload from a watcher save [ev:271] |
| `hooks modules kept as loaded, unchanged: <others>` | `/reload-plugins` after a file of `<n>` changed [ev:272] |
| `hooks modules unchanged, kept as loaded: <all>` | `/reload-plugins` with no change; nothing reloads [ev:273] |
| `plugin-dir watch on <dir>: idle, polling every 30000ms` | a save can take about 30 s to reload [ev:274] |
| `<n> was unloaded: it crashed the hooks worker` | a loop with no `await` |
| `... off for this session: it crashed 3 times` | run `/reload-plugins` to recover |
| `[<n>] $.<call> dropped: <reason>` | an API call was refused |
| `<n> registered /x but no command.run hook answered it` | no matching `command.run` hook |
| `[<n>] $.ui.log: reloaded (N hooks: ...)` | a hot reload, NOT a failure [ev:275] |
| `ui.open <n> <id> (asked\|unasked, N columns): placed` / `waits unplaced` | placement [ev:276] |

Filter for one mod `M`: `grep -E "M(@inline)?[ :)]|\[M\]|ui\.render \(|hooks worker|not loaded|ui\.open M|\[(WARN|ERROR)\]"`.

What a reload or `/clear` keeps, measured with a probe [ev:277]:

| Action | Module variables | `$.state` | `session.start` |
|---|---|---|---|
| `/reload-plugins`, no file changed | kept | kept | does not fire |
| watcher save, or `/reload-plugins` after a change | reset | kept | fires (`loaded later`) |
| `/clear` | kept | RESET | does NOT fire |

## 7. Done gate: `mods.py -C <wb> done`

`done` runs `clean`, then `evidence --gate`, and prints a block to paste. PASS line: `done: PASS gate 8 pass, 2 manual, 0 fail · cleanup ok`. MISSING and PENDING rows count as a fail. N/A rows add `, <n> n/a`: a `guard` has 3 (rows 5, 6, 8); a `status-toast` with part toast only has 1 (row 5). For output tokens, cache reads and tool calls of a run: `scripts/metrics.py <session.jsonl> [--until <ISO>]`, or `evidence --session`.
The gate has 8 automatic rows and 2 MANUAL rows (7 and 9; row 7 passes by itself after a live key path). Before `clean`, `evidence --gate` gives `gate 7 pass, 2 manual, 1 fail`: row 10 is PENDING.

| Row | Gate item | Evidence |
|---|---|---|
| 1 | validate `--strict` | newest `check`: validate passed |
| 2 | tsc | newest `check`: rc 0 |
| 3 | plugin test | newest `check`: 0 fail, 1 pass or more. Include a `$.ui.mount` drawing test for the terminal and desktop surfaces; the driver counts tests only |
| 4 | load line; no `refused`, `skipped` or `dropped` line for the mod | `live --debug`; reload lines do not count [ev:278] |
| 5 | screens: every state; dock 150; inline 100 and 60 | `mockups` or `audit-existing` PASS. `command`, and `status-toast` with part command: `live --cols 150,100,60` PASS. Other no-pane parts and `guard`: N/A |
| 6 | keys | `crawl` PASS, every edge ok (screen nodes for no-pane kinds). `guard`: N/A |
| 7 | user paths (section 5) | PASS by itself when a `live --real --keys ... --after <text>` PASS ran after the build; a failed one is FAIL. Else MANUAL: run them and quote the output |
| 8 | colour | `live --nocolor`: SGR 7 yes or n/a, no `38;5;` [ev:279]. `guard`: N/A. Check a light theme by hand |
| 9 | hot reload | MANUAL. Quote the notice that starts your next turn after the dev-mods write [PA:Developing one]. A headless run says hot reload is off (nobody could be asked): quote that line. If the notice is not "enabled", run `live` on a copy. Say so in the report. |
| 10 | cleanup | a `clean` PASS newer than the last session |

`clean` kills only the sessions of this mod and removes only the workbench paths that it made. `--installs` also uninstalls `<mod>@...` and `<mod>-proto@...`. Then check that `claude plugin list | grep <mod>` prints nothing. `done` counts only the tmux sessions with the `mod.json` prefixes; a session of another tool that holds the mod name is not yours. `--debug-file` writes a `latest` link in the log folder: remove it when it points to your log [ev:280].
