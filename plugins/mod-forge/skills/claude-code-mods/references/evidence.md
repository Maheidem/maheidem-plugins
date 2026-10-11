# Evidence for the claude-code-mods skill
Each `[ev:N]` tag in this skill points to one entry below: what ran, on which version, and what it showed.
Claude Code versions: 2.1.295 (most runs) and 2.1.296 (design pass, storyboard and template proofs).
Dates: 2026-10-09 and 2026-10-10.
Terminal size: 150 x 45 (columns x rows) in tmux 3.6a, unless an entry says otherwise.
Capture, log and file names (for example `caps/53`) are names only; the files are not shipped.

## ev:1 — Design pass and storyboard ran on 2.1.296
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane (design C, 212 nodes, 1237 edges, 24 scenarios, 6 sessions); a fresh agent that ran the whole design pass on a new mod `notes-pane` with only this skill, and the fix pass that re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: the storyboard crawl gave 212/212 nodes and 1233/1237 edges in 1875 s, and one re-crawl fixed the rest. The fix pass gave `DONE 84 captures in 182 s · ring {'OK': 32, 'MISMATCH': 0, 'n/a': 52} · failed none` and crawled 19/19 nodes and 64/64 edges.
replaces: [SB] [FIX: prove1] (SKILL.md:15)

## ev:2 — Two Claude Code versions show at once
2026-10-09 · 2.1.295 (the process of the session) and 2.1.296 (the binary on PATH) · the fresh-agent design pass on `notes-pane` and its fix pass; the agent read the plugin-authoring base folder and ran `claude --version`.
result: the base folder named `bundled-skills/2.1.295/...`. `claude --version`, the binary that the tmux sessions start, named 2.1.296. Report both versions.
replaces: [FIX: prove1] (SKILL.md:15, the second tag on the line)

## ev:3 — Upgrade-check grep finds every name
2026-10-09 · 2.1.295 (types file); the run used the 2.1.296 binary · the grep loop of the upgrade check (SKILL.md, step 2) for 8 names on the 2.1.295 types file, in the second fresh-agent run on `notes-pane` and its final fix pass.
result: each of the 8 names gave a count of 1 or more. No name gave 0.
replaces: [FIX: prove2] (SKILL.md:50)

## ev:15 — Two hooks on one event need a matcher
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 189657012; minified names are valid for 2.1.295 only.
result: One plain registration per event; add a matcher for more.
replaces: [B:189657012] (SKILL.md:185, api.md:101, pitfalls.md:14)

## ev:18 — Write state from an event, not from render
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Write from `onPress`, `onSubmit` or another event.
replaces: [LIVE] (SKILL.md:188)

## ev:19 — A deferred write from render is denied too
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: A deferred write from a render (`void Promise.resolve().then(() => update(...))`) was denied too under `claude plugin test`: `state.set: denied: it was made while ui.render is being dispatched`.
replaces: [FIX: prove1] (SKILL.md:188)

## ev:20 — A runaway hook unloads the mods
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 196780525; minified names are valid for 2.1.295 only.
result: One worker serves every mod; a spin unloads mods [DOC:troubleshoot].
replaces: [B:196780525] (SKILL.md:190, pitfalls.md:101)

## ev:21 — An unasked open waits below 144 columns
2026-10-09 · 2.1.295 · a live run in the research pass.
result: An unasked open waits undrawn below 144 columns [D:2479-2500].
replaces: [LIVE] (SKILL.md:192)

## ev:22 — A pane using cwd broke in a session
not recorded · not recorded · the user's feedback note `feedback_mod_pane_testing.md`.
result: `cwd()` moves with Bash `cd`; a pane that used `cwd()` broke in the user's session this way.
replaces: [MEM-TEST] (SKILL.md:193)

## ev:23 — Render content, never raw data
not recorded · not recorded · the user's feedback note `feedback_tui_ux_bar.md`.
result: Render content, never raw data: no raw JSON, no pipe tables, no internal codes.
replaces: [MEM-UX] (SKILL.md:196)

## ev:24 — An ansi name makes the engine refuse
2026-10-09 · 2.1.295 · a live run in the first fix pass, tmux, theme `dark`.
result: `ansi:<name>` makes the engine refuse the tree.
replaces: [FIX] (SKILL.md:197)

## ev:26 — No digit hotkey on a band
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `docs/agents-viewer.md` lines 117-124.
result: No digit hotkey on a band [D:1083-1088].
replaces: [PI:docs/agents-viewer.md:117-124] (SKILL.md:203, ux-design.md:303, pitfalls.md:60)

## ev:30 — Esc in an Input closes a docked pane
2026-10-09 · not recorded · the scratch mod `sfprobe`: a focus and close probe, second fix pass.
result: Esc in an Input raises `ui.close` and closes a docked pane: deny it in a `ui.close` hook.
replaces: [FIX: sfprobe] (SKILL.md:206)

## ev:38 — Built-in plugins load without the debug gate
2026-10-09 · 2.1.295 · a live run in the research pass: probe-debug-gate-off.log.
result: `--bare` refuses installed plugins: `hooks module probe-mod@probe-market not loaded: installed plugins that are not managed load no hooks module in this mode (--bare); built-in plugins load regardless`.
replaces: [LIVE:probe-debug-gate-off.log] (api.md:28)

## ev:39 — Reasons that block mods from loading
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 215950000-215960000; minified names are valid for 2.1.295 only.
result: Refusal codes in the binary: `diskless, hooks_modules_off, all_hooks_disabled, sideload_disabled, local_dirs_blocked, managed_hooks_only, hooks_disabled_in_settings, safe_mode, bare_mode, untrusted`.
replaces: [B:215950000-215960000] (api.md:30)

## ev:40 — Reserved words in a plugin name
2026-10-09 · 2.1.295 · a live run in the research pass: `claude plugin validate` on copies of the starter mod named `anthropics-x`, `claude-mods`, `official-claude-tools`, `claude`, `anthropics`; each failed with this text.
result: Validate text on 2.1.295: a name "cannot start with "claude-", "anthropic-", "anthropics-", or "cc-plugin-", be "claude", "anthropic", "anthropics", "claude-code", or "claude-mods", or put "official" beside "claude" or "anthropic"".
replaces: [LIVE: `claude plugin validate` on copies of the starter mod named `anthropics-x`, `claude-mods`, `official-claude-tools`, `claude`, `anthropics`; each failed with this text] (api.md:31)

## ev:41 — The session mods folder fails in some modes
2026-10-09 · 2.1.295 · a read of the research chapter on machinery, line 100.
result: A session mods-folder mod does not load in `claude -p`, `dontAsk`, an untrusted workspace, `--safe-mode`, `--bare`, `disableAllHooks`, or under a managed block [DOC:create].
replaces: [CH-M:100] (api.md:32)

## ev:42 — The modules value must be an array
2026-10-09 · 2.1.295 · a live run in the research pass.
result: A string gives `Invalid input: expected array, received string`.
replaces: [LIVE] (api.md:36)

## ev:43 — A second modules entry is refused
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 75346445; minified names are valid for 2.1.295 only.
result: A second entry is refused.
replaces: [B:75346445] (api.md:36)

## ev:44 — A hooks module may import relative paths only
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Real error: `hooks module did not load: cannot import "node:fs" (from hooks/register.js): a hooks module imports its own files by relative path and "claude-code", nothing else`.
replaces: [LIVE] (api.md:37)

## ev:45 — Example shape of the hooks.json file
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Otherwise: `turn-band.isHidden is not declared: the manifest's types contract must name it in interface PluginState { turn-band: { isHidden: ... } }`.
replaces: [LIVE] (api.md:39)

## ev:46 — A top-level export in the contract fails
2026-10-09 · 2.1.295 · a live run in the research pass.
result: A top-level `export {}` in the contract fails: "a contract exports types and nothing else".
replaces: [LIVE] (api.md:40)

## ev:47 — Strict validation rejects a missing entry
2026-10-09 · 2.1.295 · a live run in the research pass.
result: No `author` in `plugin.json` gives `No author information provided`. That fails `--strict`.
replaces: [LIVE] (api.md:41)

## ev:48 — A second exported function is not listed
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Calls in a second exported function are not listed.
replaces: [LIVE] (api.md:42)

## ev:49 — A let in a hook fails the scan
2026-10-09 · 2.1.295 · a live run in the research pass.
result: A `let` gives `takes a source the scan can read`.
replaces: [LIVE] (api.md:48)

## ev:50 — A hook may not register hooks
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset ~80762000; minified names are valid for 2.1.295 only.
result: `on()` after `register` returned throws: `after register() returned: on() is for register(); a hook may not register hooks`.
replaces: [B:~80762000] (api.md:49)

## ev:52 — Rules for the types contract file
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 187817736; minified names are valid for 2.1.295 only.
result: It starts with `./`, ends with `.d.ts`, holds no `..`, and holds no import, export-from, require or reference.
replaces: [B:187817736] (api.md:54, api.md:56, api.md:57)

## ev:54 — The debug log is deleted after cleanup
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 192492702; minified names are valid for 2.1.295 only.
result: Deleted after `cleanupPeriodDays` [DOC:create].
replaces: [B:192492702] (api.md:65)

## ev:56 — The telemetry log hook needs a named target
2026-10-09 · 2.1.295 · a live run in the research pass.
result: An installed mod that hooks `telemetry.log` must name `{ to: 'collector' }`, or validate fails [DOC:reference].
replaces: [LIVE] (api.md:88)

## ev:57 — Matcher keys and patterns that the engine refuses
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset ~80806300; minified names are valid for 2.1.295 only.
result: Refused: an unknown key (`has the key ..., which no event has`), a RegExp with `g` or `y`, a RegExp with a nested quantifier, depth over 8.
replaces: [B:~80806300] (api.md:100)

## ev:63 — Default hook budget is 10 seconds
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 189799509; minified names are valid for 2.1.295 only.
result: Default hook budget — 10,000 ms (`z_e=1e4`).
replaces: [B:189799509] (api.md:145, pitfalls.md:102)

## ev:64 — The prompt.edit budget is 50 ms
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 189717215; minified names are valid for 2.1.295 only.
result: `prompt.edit` budget — 50 ms, the only site with its own.
replaces: [B:189717215] (api.md:146)

## ev:65 — The catch handler budget is 1 second
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 189791310; minified names are valid for 2.1.295 only.
result: `.catch` handler — 1,000 ms (`b3e=1000`) — [DOC:reference Limits].
replaces: [B:189791310] (api.md:147)

## ev:66 — Grace after an abort is 5 seconds
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 189791116; minified names are valid for 2.1.295 only.
result: Grace after abort — 5,000 ms (`ZNe`).
replaces: [B:189791116] (api.md:148)

## ev:67 — Two overruns in a row unload the plugin
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 196825245; minified names are valid for 2.1.295 only.
result: Runaway kill — 2 overruns in a row unload the plugin: `<plugin> ignored its signal 2 times in a row: a runaway plugin in the hooks worker`.
replaces: [B:196825245] (api.md:149)

## ev:68 — The session.end budget is 1.5 seconds
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 197367970; minified names are valid for 2.1.295 only.
result: `session.end` — 1,500 ms default; `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` overrides.
replaces: [B:197367970] (api.md:150)

## ev:69 — A dollar call gets 10 seconds to answer
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 196827243; minified names are valid for 2.1.295 only.
result: Host answer for one `$` call — 10,000 ms: `$.<ns>.<m>: <plugin> did not answer within 10000ms`.
replaces: [B:196827243] (api.md:151)

## ev:70 — Own time excludes next and dollar calls
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 189839788; minified names are valid for 2.1.295 only.
result: "Own time" rule: time inside `next` and inside `$` calls does not count, except `clock.now`, `clock.sleep`, `clock.after`, `clock.every`.
replaces: [B:189839788] (api.md:154)

## ev:71 — The starter mod registers four events
2026-10-09 · 2.1.295 · the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9).
result: Load line: `hooks module recent-tools@inline loaded (worker, environment 1, tier user); events: session.start,command.run,tool.call,ui.render`.
replaces: [LIVE:TPL] (api.md:158)

## ev:72 — A heartbeat marks a stalled worker
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset ~196818940; minified names are valid for 2.1.295 only.
result: Heartbeat: about 5 s without an answer marks the worker wedged: `no answer to a heartbeat within 5000ms: the hooks worker is wedged (a hook spinning without yielding)`.
replaces: [B:~196818940] (api.md:160)

## ev:73 — The reload command resets the crash count
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 196780525; minified names are valid for 2.1.295 only; a static read of the 2.1.295 binary at byte offset 196807006; minified names are valid for 2.1.295 only.
result: `/reload-plugins` resets the count.
replaces: [B:196780525] [B:196807006] (api.md:161)

## ev:74 — The same-thread flag runs mods on main
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 196802842; minified names are valid for 2.1.295 only.
result: `CLAUDE_CODE_HOOKS_SAME_THREAD` runs mods on the main thread.
replaces: [B:196802842] (api.md:162)

## ev:75 — A mod may approve a blocked call
2026-10-09 · 2.1.295 · a read of the research chapter on machinery, line 272.
result: So a mod can approve, in `tool.check`, a call that a non-managed `PreToolUse` hook blocked [DOC:events].
replaces: [CH-M:272] (api.md:169)

## ev:76 — Startup order of the plugin events
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Startup: `plugin.register` (admission), `engine.create`, then `session.start` for each plugin.
replaces: [LIVE] (api.md:174)

## ev:77 — What survives a hot reload
2026-10-09 · 2.1.295 · a live run in the research pass.
result: The entries about what survives a hot reload come from live runs, unless an entry says otherwise.
replaces: [LIVE unless marked] (api.md:176)

## ev:78 — session.start fires again after a reload
2026-10-09 · 2.1.295 · the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9).
result: Fires again: `session.start: raised for recent-tools (loaded later)`.
replaces: [LIVE:TPL] (api.md:181)

## ev:79 — State stays after a save
2026-10-09 · 2.1.295 · the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9): the pane kept its rows after a save.
result: `$.state` is kept across a hot reload (the pane kept its rows after a save).
replaces: [LIVE:TPL: the pane kept its rows after a save] (api.md:183)

## ev:80 — Module variables survive the clear command
2026-10-09 · 2.1.295 · a live tmux audit of an in-house background-agents pane (0.13.0), capture caps/75-after-clear.txt.
result: Module variables SURVIVE `/clear`.
replaces: [AUDIT: caps/75-after-clear.txt] (api.md:189, testing.md:249, pitfalls.md:85)

## ev:81 — The reload command reloads changed plugins only
2026-10-09 · 2.1.295 · a live run in the research pass.
result: `/reload-plugins` reloads only changed plugins: `hooks modules unchanged, kept as loaded: ...`.
replaces: [LIVE] (api.md:198)

## ev:82 — A failed save keeps the old version
2026-10-09 · 2.1.295 · a live run in the research pass.
result: A SAVE that fails to load keeps the old version running, timers included: `reload failed, the previous version stays loaded: <file> does not parse: ...`.
replaces: [LIVE] (api.md:199)

## ev:83 — A broken file at reload unloads the mod
2026-10-09 · 2.1.295 · a live run in the research pass, practice chapter, section 2.2 case d2.
result: `/reload-plugins` with a broken file is different: the load fails (`[ERROR] hooks module <n>@inline failed to load`) and the mod is GONE until you fix the file.
replaces: [LIVE: chapter-practice 2.2 case d2] (api.md:200, pitfalls.md:89)

## ev:84 — A reload of unchanged files keeps the timers
2026-10-09 · 2.1.295 · a live run in the research pass, practice chapter, section 2.2 case b.
result: `/reload-plugins` with unchanged files keeps the module, and its timers keep running.
replaces: [LIVE: chapter-practice 2.2 case b] (api.md:201)

## ev:85 — The watcher polls fast, then slowly
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 194922982-194923120; minified names are valid for 2.1.295 only.
result: Reload timing: lone save debounce 250 ms; storm breaker after 5 fast reloads (`reloading unusually often`); poll every 400 ms while typing, every 30 s after 60 s idle.
replaces: [B:194922982-194923120] (api.md:202)

## ev:86 — Save to reload takes 0.6 to 2 seconds
2026-10-09 · 2.1.295 · a live run in the research pass; the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9).
result: Measured: about 0.6 to 2 s from save to reload while active.
replaces: [LIVE] [LIVE:TPL] (api.md:202)

## ev:87 — An idle watcher reloaded after 29 seconds
2026-10-09 · not recorded · the scratch mod `sfprobe`: a focus and close probe, second fix pass.
result: A save took 29 s to reload after the log said `plugin-dir watch on <dir>: idle, polling every 30000ms`.
replaces: [FIX: sfprobe] (api.md:202)

## ev:88 — Event name totals in 2.1.295
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 189639337; minified names are valid for 2.1.295 only.
result: Totals in 2.1.295: 142 event names: 33 `classic.*`, 46 engine events, 63 op events (one per `$` method).
replaces: [B:189639337] (api.md:207)

## ev:89 — The classic star pattern selects all classic events
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 187748783; minified names are valid for 2.1.295 only; a read of the research chapter on machinery, line 389.
result: Hook them as `classic.<Name>`; `classic.*` selects all.
replaces: [B:187748783] [CH-M:389] (api.md:231)

## ev:91 — Release notes for 2.1.295 UI changes
2026-10-09 · not recorded · the Claude Code release feed (`feed.xml`), read in the research pass.
result: The 2.1.295 release adds `$.ui.notify`, Button children, and type files only where a mod is developed [https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md].
replaces: [research feed.xml] (api.md:235)

## ev:92 — Hotkeys also work at an idle, empty prompt
2026-10-09 · 2.1.295 · the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9).
result: `closeOnEscape` closes the pane while it holds the keys, and also at an idle, empty prompt [D:7414-7426].
replaces: [LIVE:TPL] (api.md:267)

## ev:93 — The placement floor is 144 columns
2026-10-09 · 2.1.295 · a live run in the research pass.
result: The placement floor is 144 columns: below it an unasked open waits undrawn [D:2479-2500].
replaces: [LIVE] (api.md:274)

## ev:95 — Measured: 8 rows at 30 terminal rows
2026-10-09 · 2.1.295 · a live tmux audit of an in-house background-agents pane (0.13.0), captures caps/53, 57.
result: Measured: 8 body rows at 30 terminal rows with `rows: 30`.
replaces: [AUDIT: caps/53, 57] (api.md:279, ux-design.md:546, pitfalls.md:65)

## ev:96 — 13 body rows at 45 terminal rows
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows; cap `A-overflow-100.
result: Measured: 8 body rows at 30 terminal rows with `rows: 30` ; 13 body rows at 45 terminal rows with `rows: 18`.
replaces: [PROTO: cap `A-overflow-100`] (api.md:279)

## ev:97 — A rows value of 30 also gave 13
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows; agent report.
result: Measured: 8 body rows at 30 terminal rows with `rows: 30` ; 13 body rows at 45 terminal rows with `rows: 18` ; `rows: 30` at 45 rows also gave 13.
replaces: [PROTO: agent report] (api.md:279)

## ev:98 — Elements per surface
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 189761051; minified names are valid for 2.1.295 only.
result: Section 10.3 lists the elements that each surface provides.
replaces: [B:189761051] (api.md:289, ux-design.md:448)

## ev:99 — The result is typed per surface
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: The result is typed per surface, so taking `Input` or `Select` fails `tsc` (`TS2339`) until the code returns early on `e.surface === 'mobile'`.
replaces: [FIX: prove1] (api.md:298)

## ev:100 — The 15 render sites and their writable props
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 189720170; minified names are valid for 2.1.295 only; a read of the research chapter on machinery, line 554-574.
result: Section 10.5 lists the 15 render sites and their writable props [D:9767-10360].
replaces: [B:189720170] [CH-M:554-574] (api.md:309)

## ev:101 — A statement about render sites is stale
2026-10-09 · 2.1.295 · a read of the research chapter on machinery, line 574.
result: The 2.1.277 types said Spinner, PromptHint and AbovePrompt were terminal only. That is stale.
replaces: [CH-M:574] (api.md:331)

## ev:102 — Engine rules for tree nodes
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 193251804, 193256025, 193288954; minified names are valid for 2.1.295 only.
result: The engine-node rules of section 10.5 come from the binary at the cited offsets.
replaces: [B:193251804, 193256025, 193288954] (api.md:333)

## ev:103 — Depth and node limits of a tree
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 189676441; minified names are valid for 2.1.295 only.
result: Depth 32, 20,000 nodes.
replaces: [B:189676441] (api.md:341)

## ev:104 — A long Markdown child blanked the pane
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `docs/agents-viewer.md` lines 38-41.
result: One Markdown or Code child over 10,000 characters blanked a background-agents pane.
replaces: [PI docs/agents-viewer.md:38-41] (api.md:342)

## ev:107 — Keep render pure
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 230758684; minified names are valid for 2.1.295 only.
result: The binary holds `const UPDATE_TRIES_MAX = 64;` and the `update` loop `for (let tries = 0; tries < UPDATE_TRIES_MAX; ...)`. The 2.1.296 binary holds the same constant at byte offset 231711889. The change function of `update` can run many times. Keep it pure.
replaces: [B:230758684] (api.md:359, pitfalls.md:93)

## ev:109 — Limits of the store namespace
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 189892608; minified names are valid for 2.1.295 only.
result: `$.store` holds 4 MiB in total.
replaces: [B:189892608] (api.md:367)

## ev:110 — Rules for a command name
2026-10-09 · 2.1.295 · a live run in the research pass.
result: A command name must match `/^[a-zA-Z0-9_-]{1,64}$/`; a colon throws.
replaces: [LIVE] (api.md:369)

## ev:111 — A built-in command name is refused
2026-10-09 · 2.1.295 · a live run in the research pass.
result: A built-in name throws: `"/focus" refused: it is the built-in /focus`.
replaces: [LIVE] (api.md:369)

## ev:113 — root fixed the cwd problem
not recorded · not recorded · the user's feedback note `feedback_mod_pane_testing.md`.
result: Use `root()` for the project: `cwd()` moves with Bash `cd`. A pane that used `cwd()` broke after a Bash `cd` in the user's session.
replaces: [MEM-TEST] (api.md:373)

## ev:115 — A file limit of 4 MiB
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 196269073; minified names are valid for 2.1.295 only.
result: A file has a limit of 4 MiB.
replaces: [B:196269073] (api.md:375)

## ev:116 — The fetch default is 30 seconds
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 196275543; minified names are valid for 2.1.295 only.
result: `fetch({ url, init })`, 30 s default.
replaces: [B:196275543] (api.md:378)

## ev:118 — CLAUDE_PLUGIN_ROOT is undefined in a mod
2026-10-09 · 2.1.295 · a live run in the research pass.
result: `$.plugin` — `name`, `root`. `CLAUDE_PLUGIN_ROOT` is undefined in a mod; use `$.plugin.root` .
replaces: [LIVE] (api.md:385)

## ev:119 — Exports of the test module
2026-10-09 · 2.1.295 · a read of the research chapter on machinery, line 626.
result: Exports: `test`, `describe`, `expect`, `mock`, `tier` [DOC:test].
replaces: [CH-M:626] (api.md:389)

## ev:122 — Type check of CommandRunInput on a copy
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows; checked again on a copy.
result: `$.command.run({ command, args })` in a test fails `tsc` with `TS2345: ... is missing the following properties from type 'CommandRunInput': origin, presentation`.
replaces: [PROTO, checked again on a copy] (api.md:396)

## ev:123 — The user rejected a working pane as ugly
not recorded · not recorded · the user's feedback note `feedback_tui_ux_bar.md`.
result: The user rejected a working pane as "ugly as F": it showed pipe rows, raw JSON, jargon codes, and no colour or hierarchy.
replaces: [MEM-UX] (ux-design.md:3)

## ev:124 — The design pass gave "that looks awesome"
not recorded · not recorded · the user's feedback note `feedback_tui_ux_bar.md`.
result: This file gives the rules, the tokens and the design-pass procedure that produced "that looks awesome".
replaces: [MEM-UX] (ux-design.md:3)

## ev:125 — Copy the look of the built-ins first
not recorded · not recorded · the user's feedback note `feedback_tui_ux_bar.md`.
result: Copy the look of the built-ins before you draw: `/agents`, `/workflows`, `/config` and the `/diff` mod source.
replaces: [MEM-UX] (ux-design.md:26)

## ev:126 — No pipe rows, raw JSON or codes
not recorded · not recorded · the user's feedback note `feedback_tui_ux_bar.md`.
result: No pipe rows, no raw JSON, no internal codes.
replaces: [MEM-UX] (ux-design.md:27)

## ev:127 — Use the rich elements where they fit
not recorded · not recorded · the user's feedback note `feedback_tui_ux_bar.md`.
result: Use the rich elements where they fit: Markdown, Code, Select, Input, band, toast, `$.state`.
replaces: [MEM-UX] (ux-design.md:28)

## ev:128 — Check the real API surface first
not recorded · not recorded · the user's feedback note `feedback_tui_ux_bar.md`.
result: Check the real API surface for a capability before you invent one.
replaces: [MEM-UX] (ux-design.md:29)

## ev:129 — Verify live in tmux, not only units
not recorded · not recorded · the user's feedback note `feedback_tui_ux_bar.md`.
result: Verify live in a tmux claude session, not only with unit tests.
replaces: [MEM-UX] (ux-design.md:30)

## ev:130 — The prototype procedure ran live on 2.1.295
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows.
result: Source of this procedure: a prototype of a background-agents pane, run live on 2.1.295.
replaces: [PROTO] (ux-design.md:40)

## ev:131 — Sketch one design for each persona
not recorded · not recorded · the user's feedback note `feedback_tui_ux_bar.md`.
result: Think in private sketches, one per persona.
replaces: [MEM-UX] (ux-design.md:43)

## ev:133 — The prototype used 9 agents
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows.
result: The prototype used 9 agents: 4 for `normal`, all 9 for `overflow`.
replaces: [PROTO] (ux-design.md:54)

## ev:136 — Success is blue in the daltonized themes
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary (theme tables); minified names are valid for 2.1.295 only.
result: In the daltonized themes `success` is blue, not green.
replaces: [B theme tables] (ux-design.md:150)

## ev:137 — Measured colour strings on 2.1.295
2026-10-09 · 2.1.295 · a live run in the first fix pass, tmux, theme `dark`.
result: Measured colour strings on 2.1.295 (Text in a docked pane, `capture-pane -e`, theme `dark`).
replaces: [FIX] (ux-design.md:152)

## ev:138 — An older static reading said they draw nothing
2026-10-09 · 2.1.295 · a read of the research chapter on UX, section 5.3.
result: An older static reading of the binary said named colours draw nothing; the live run shows that is wrong.
replaces: [CH-UX 5.3] (ux-design.md:165)

## ev:139 — warning and error were checked live on 2.1.288
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents-format.js` lines 3-6.
result: A background-agents pane checked `warning` and `error` live on 2.1.288.
replaces: [PI:hooks/agents-format.js:3-6] (ux-design.md:169)

## ev:140 — dimColor resolves to inactive
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary (Text wrapper); minified names are valid for 2.1.295 only.
result: `dimColor` resolves to `inactive`.
replaces: [B Text wrapper] (ux-design.md:178)

## ev:141 — Colour codes measured in the starter mod
2026-10-09 · 2.1.295 · the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9).
result: Measured in the starter mod: `error` drew as SGR `38;5;211`, `dimColor` as `38;5;246`, the bold count as `1m`.
replaces: [TPL] (ux-design.md:181)

## ev:142 — NO_COLOR drops the colour level to 0
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary (`ne()); minified names are valid for 2.1.295 only.
result: Under `NO_COLOR` the colour level drops to 0.
replaces: [B `ne()`] (ux-design.md:185)

## ev:143 — A plain hotkey Button draws key and label
2026-10-09 · 2.1.295 · a live tmux capture with SGR codes in the research pass; the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9).
result: A plain hotkey Button draws itself as `<key>: <label>`: `c: clear`.
replaces: [TMUX] [TPL] (ux-design.md:221)

## ev:144 — A label of add drew a: add
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: `label="a to add"` drew `a: a to add`; `label="add"` drew `a: add`.
replaces: [FIX: prove1] (ux-design.md:221)

## ev:145 — A focused Button draws inverse
2026-10-09 · 2.1.295 · a live tmux capture with SGR codes in the research pass.
result: A focused Button draws inverse.
replaces: [TMUX] (ux-design.md:231)

## ev:146 — Reuse the glyphs of the engine
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary (glyph block `var po=O()==="macos"?"⏺":"●"); minified names are valid for 2.1.295 only.
result: Reuse the engine's glyphs.
replaces: [B glyph block `var po=O()==="macos"?"⏺":"●"`] (ux-design.md:235)

## ev:147 — The status glyph map of the engine
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary (`idle:"\u25E6"); minified names are valid for 2.1.295 only.
result: idle: the engine's status map is `{ working: '•', needsYou: '!', idle: '◦', failed: '×' }`.
replaces: [B: `idle:"\u25E6"`] (ux-design.md:248)

## ev:148 — The small dot glyph constant
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary (`axe="\u2219"); minified names are valid for 2.1.295 only.
result: small dot: the glyph block constant beside the message dot (`po`) and `•`.
replaces: [B: `axe="\u2219"`] (ux-design.md:249)

## ev:149 — A pane marks a parked worker with it
2026-10-09 · 2.1.295 · a live tmux audit of an in-house background-agents pane (0.13.0), capture caps/53.
result: A background-agents pane marks a parked worker with the small dot.
replaces: [AUDIT: caps/53] (ux-design.md:249)

## ev:150 — Source of the added glyph rows
2026-10-09 · 2.1.295 · a read of the research chapter on UX, section 6; a static read of the 2.1.295 binary (glyph block); minified names are valid for 2.1.295 only.
result: The added glyph rows come from the research chapter on UX (section 6) and the glyph block of the binary.
replaces: [CH-UX 6] [B glyph block] (ux-design.md:256)

## ev:151 — U+2714 has six hits in the binary
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary (python scan of `\u2713` / `\u2714` with readable context); minified names are valid for 2.1.295 only.
result: `✔` (U+2714) has 6 hits, only as `tick` in a symbol table, in an emoji map and in a character list.
replaces: [B: python scan of `\u2713` / `\u2714` with readable context] (ux-design.md:258)

## ev:152 — A braille spinner set also exists
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary (`Qcn()`, `rIe()`, `vu); minified names are valid for 2.1.295 only; a read of the research chapter on UX, section 6.
result: A braille set `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` also exists.
replaces: [B `Qcn()`, `rIe()`, `vu`] [CH-UX 6] (ux-design.md:260)

## ev:153 — The binary holds three width settings
2026-10-09 · 2.1.295 · a live run in the first fix pass, tmux, theme `dark`: `grep -ao 'ambiguousIsNarrow:![01]'` on the 2.1.295 binary.
result: The binary has three width settings, counted with `grep -ao 'ambiguousIsNarrow:![01]'` on the 2.1.295 binary.
replaces: [FIX: `grep -ao 'ambiguousIsNarrow:![01]'` on the 2.1.295 binary] (ux-design.md:262)

## ev:154 — Width setting true in the string-width wrapper
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 186910632; minified names are valid for 2.1.295 only.
result: `ambiguousIsNarrow:!0` (true) in a `Bun.stringWidth` wrapper `function ae(e)`.
replaces: [B:186910632] (ux-design.md:263)

## ev:155 — Width setting true in the cell segmenter
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 192316859; minified names are valid for 2.1.295 only.
result: `ambiguousIsNarrow:!0` (true) in a `Bun.stringWidth` wrapper `function ae(e)` , and in `Bun.ant.CellSegmenter`.
replaces: [B:192316859] (ux-design.md:263)

## ev:156 — Width setting false in the width helper
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 201147272; minified names are valid for 2.1.295 only.
result: `ambiguousIsNarrow:!1` (false) in `fv`, used by `function Wo`, next to the `[unreadable text]` code.
replaces: [B:201147272] (ux-design.md:264)

## ev:157 — A pane checks glyph width with Python
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents-format.js` line 20.
result: A background-agents pane checks its column glyphs with Python `unicodedata.east_asian_width`.
replaces: [PI:hooks/agents-format.js:20] (ux-design.md:266)

## ev:158 — An action shows a notice, then done
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents.js` lines 247, 479.
result: Action in progress — a notice line, then a done line: `Sending your answer…` then `✓ Answer sent · NAME is working again`.
replaces: [PI:hooks/agents.js:247,479] (ux-design.md:273)

## ev:159 — Hide the band while the pane is open
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents.js` lines 1241-1251.
result: Hide the band while your pane is open.
replaces: [PI:hooks/agents.js:1241-1251] (ux-design.md:304)

## ev:160 — A collapsed band is one dim row
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary (`F1`, `abovePrompt:toggle); minified names are valid for 2.1.295 only; a read of the research chapter on UX, section 10.1.
result: Collapsed, the band is one dim row: `▸ plugin panel hidden · <shortcut> or click to show` (default `ctrl+x ctrl+a`).
replaces: [B `F1`, `abovePrompt:toggle`] [CH-UX 10.1] (ux-design.md:306)

## ev:161 — A plugin notice draws as one pinned line
2026-10-09 · 2.1.295 · a live run in the research pass: mods/pane-capture.txt; a static read of the 2.1.295 binary (notice renderer); minified names are valid for 2.1.295 only.
result: One pinned line per plugin under the prompt, drawn as `⚠ <plugin>: <text>` in `warning` colour.
replaces: [LIVE: mods/pane-capture.txt] [B notice renderer] (ux-design.md:310)

## ev:162 — Two signals for one event are noise
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents.js` lines 385-392.
result: Two signals for one event is noise.
replaces: [PI:hooks/agents.js:385-392] (ux-design.md:319)

## ev:163 — Colour was measured live in tmux with SGR
2026-10-09 · 2.1.295 · a live tmux capture with SGR codes in the research pass; a read of the research chapter on UX, section 9.1.
result: Measured live on 2.1.295 in tmux with SGR capture.
replaces: [TMUX] [CH-UX 9.1] (ux-design.md:334)

## ev:164 — Every key shown on screen must work
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `docs/agents-viewer.md` lines 112-124.
result: Every key shown on screen must work.
replaces: [PI:docs/agents-viewer.md:112-124] (ux-design.md:351)

## ev:165 — Hotkeys work only while the site holds keys
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Hotkeys work only while the site holds the keys: after `ctrl+x tab`, a click, or `open({ focus: true })` [D:1083-1088].
replaces: [LIVE] (ux-design.md:353)

## ev:166 — autoFocus alone left the ring on delete
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: `autoFocus` on it is not enough when the confirm replaces another view: the ring stayed on `y: delete`.
replaces: [FIX: prove1] (ux-design.md:354)

## ev:167 — A ui.close hook can deny the close
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents.js` line 1329.
result: A `ui.close` hook can return `{ deny: 'back one level' }`.
replaces: [PI:hooks/agents.js:1329] (ux-design.md:357)

## ev:168 — In a dock, Esc closes the whole pane
2026-10-09 · not recorded (sfprobe); 2.1.295 (audit) · the scratch mod `sfprobe`: a focus and close probe, second fix pass; a live tmux audit of an in-house background-agents pane (0.13.0), capture caps/14→15.
result: In a dock it closes the whole pane unless a `ui.close` hook denies it.
replaces: [FIX: sfprobe] [AUDIT: caps/14→15] (ux-design.md:358)

## ev:169 — After a deny, return keys to the pane
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: After the deny, give the keys back to the pane (13.2).
replaces: [FIX: prove1] (ux-design.md:358)

## ev:170 — A pane steps back only inline
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents.js` line 1315.
result: A background-agents pane stepped back only inline.
replaces: [PI:hooks/agents.js:1315] (ux-design.md:358)

## ev:171 — Use the pattern in section 13.1
2026-10-09 · not recorded · the scratch mod `sfprobe`: a focus and close probe, second fix pass.
result: Use the pattern in 13.1.
replaces: [FIX: sfprobe] (ux-design.md:359)

## ev:172 — No hook runs on this path
2026-10-09 · 2.1.295 · a read of the research chapter on UX, section 9.3.
result: `hover` is style data only; no hook runs [D:911-915].
replaces: [CH-UX 9.3] (ux-design.md:365)

## ev:173 — Hover code validated, effect not run
2026-10-09 · 2.1.295 · a live run in the first fix pass, tmux, theme `dark`: validate passed and a `$.ui.mount` test found `NAME-A` and the `stop:a` Button; the hover effect itself was not run.
result: Validate passed and a `$.ui.mount` test found `NAME-A` and the `stop:a` Button; the hover effect itself was not run.
replaces: [FIX: validate passed and a `$.ui.mount` test found `NAME-A` and the `stop:a` Button; the hover effect itself was not run.] (ux-design.md:380)

## ev:174 — Reduced motion setting
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary; minified names are valid for 2.1.295 only.
result: Reduced motion — `(await $.settings.read()).prefersReducedMotion` (`undefined` when unset) — [A11Y].
replaces: [B] (ux-design.md:386)

## ev:175 — Screen reader setting
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary; minified names are valid for 2.1.295 only.
result: Screen reader — `$.env.get('CLAUDE_AX_SCREEN_READER')`, `settings.axScreenReader`. The `--ax-screen-reader` flag is not readable — [A11Y].
replaces: [B] (ux-design.md:387)

## ev:176 — Magnifier cursor setting
2026-10-09 · 2.1.295 · a read of the research chapter on UX, section 11.1: env-vars docs; binary byte offset 201185124.
result: Magnifier cursor — `$.env.get('CLAUDE_CODE_ACCESSIBILITY')`.
replaces: [CH-UX 11.1: env-vars docs; B:201185124] (ux-design.md:388)

## ev:177 — Theme name setting
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 187600448, 187945768; minified names are valid for 2.1.295 only; a read of the research chapter on UX, section 11.1.
result: Theme name — `(await $.settings.read()).theme`. Values: `auto`, `dark`, `light`, `light-daltonized`, `dark-daltonized`, `light-ansi`, `dark-ansi`, `custom:<slug>`.
replaces: [B:187600448, 187945768] [CH-UX 11.1] (ux-design.md:389)

## ev:178 — The accessibility check was not run live
2026-10-09 · 2.1.295 · a read of the research chapter on UX, section 11.3.
result: The accessibility rules are a composition of the signals above; they were not run live.
replaces: [CH-UX 11.3] (ux-design.md:403)

## ev:179 — NO_COLOR gives colour level 0
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary (`ne()); minified names are valid for 2.1.295 only.
result: `NO_COLOR` drops colour to level 0.
replaces: [B `ne()`] (ux-design.md:405)

## ev:180 — Captures with and without NO_COLOR
2026-10-09 · 2.1.295 · a live tmux audit of an in-house background-agents pane (0.13.0), capture caps/64-nocolor-100.ansi vs 30-list-inline-100.ansi.
result: Under `NO_COLOR=1` a mod pane lost all colour, bold and dim SGR, and kept inverse: the capture had only SGR `7` and `0`; without `NO_COLOR` the same list had colour, `1` and `2`.
replaces: [AUDIT: caps/64-nocolor-100.ansi vs 30-list-inline-100.ansi] (ux-design.md:405)

## ev:181 — Cut text before you draw it
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents-format.js` lines 40-44.
result: A Button label does not truncate itself. Cut it before you draw it.
replaces: [PI:hooks/agents-format.js:40-44] (ux-design.md:428)

## ev:182 — A pane counts text with length
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents-format.js` lines 40-57.
result: A background-agents pane uses `.length` in `cut()`, `fitHint()` and `buttonWidth()`.
replaces: [PI:hooks/agents-format.js:40-57] (ux-design.md:429)

## ev:183 — Detail goes in a detail view
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `CHANGELOG.md` lines 9-11.
result: Detail goes in a detail view.
replaces: [PI:CHANGELOG.md:9-11] (ux-design.md:430)

## ev:184 — Split view only when docked and wide
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents.js` line 1416.
result: Split list and detail side by side only when docked and `bodyColumns >= 110`.
replaces: [PI:hooks/agents.js:1416] (ux-design.md:432)

## ev:185 — Sanitize text from disk or tools
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents-format.js` lines 26-27.
result: Sanitize text from disk or tools: strip ANSI and control characters, redact secrets.
replaces: [PI:hooks/agents-format.js:26-27] (ux-design.md:433, ux-design.md:498, pitfalls.md:116)

## ev:186 — Tie-break when several variants pass
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: Tie-break when two or more variants pass (three did in a fresh-agent run).
replaces: [FIX: prove1] (ux-design.md:464)

## ev:187 — Raw data only behind an explicit expand
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `CHANGELOG.md` lines 12-15.
result: Raw data only behind an explicit expand.
replaces: [PI:CHANGELOG.md:12-15] (ux-design.md:497)

## ev:188 — Why the left variant fails
not recorded · not recorded · the user's feedback note `feedback_tui_ux_bar.md`.
result: Why the left mockup fails, as the user's feedback note states it.
replaces: [MEM-UX] (ux-design.md:516)

## ev:189 — The host keeps the ring in one slot
2026-10-09 · not recorded · the scratch mod `sfprobe`: a focus and close probe, second fix pass (after `sel=2` the window moved and the ring sat on `job-3).
result: The host keeps the ring at the same slot when the window moves.
replaces: [FIX: sfprobe: after `sel=2` the window moved and the ring sat on `job-3`] (ux-design.md:529)

## ev:190 — The prototype used the same landing
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows.
result: The prototype used the same landing (`register.tsx` lines 123-127); after Down presses to row 5 of 9, ring and `❯` were both on that row (capture `C-overflow-scrolled-100`).
replaces: [PROTO] (ux-design.md:529)

## ev:191 — A focusable edge takes the ring
2026-10-09 · 2.1.295 · a live tmux audit of an in-house background-agents pane (0.13.0), capture caps/61.
result: A focusable edge takes the ring and traps ↓.
replaces: [AUDIT: caps/61] (ux-design.md:530)

## ev:192 — Down past the last row lands on edge
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows; log `ui.focus Pane <mod>-proto (person) onto <mod>-proto's act:a: moved`, proto-C.log:1117.
result: Down past the last row lands on the footer hotkey Buttons (log `ui.focus Pane <mod>-proto (person) onto <mod>-proto's act:a: moved`, log proto-C.log:1117).
replaces: [PROTO: log `ui.focus Pane <mod>-proto (person) onto <mod>-proto's act:a: moved`, proto-C.log:1117] (ux-design.md:531)

## ev:193 — The exact shape of the landing code
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows; register.tsx:108-111.
result: The exact shape of the guard is in `register.tsx` lines 108-111 of the prototype.
replaces: [PROTO: register.tsx:108-111] (ux-design.md:531)

## ev:194 — The prototype refuses a ring wrap
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows.
result: The prototype refuses a wrap that jumps the slot: `if (list.length > MAX && ((cur === list.length - 1 && picked === top) || (cur === 0 && picked === last))) return {}` (`register.tsx` lines 119-121).
replaces: [PROTO] (ux-design.md:542)

## ev:195 — Prototype caps rows at a third
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows; register.tsx:102; cap `A-`, `B-`, `D-overflow-100.
result: An inline pane gets about a third of the screen: with `rows: 18` asked, a prototype got 13 body rows at 45 terminal rows (`register.tsx` line 102; captures `A-`, `B-`, `D-overflow-100`).
replaces: [PROTO: register.tsx:102; cap `A-`, `B-`, `D-overflow-100`] (ux-design.md:546)

## ev:196 — A rows value of 30 changed nothing either
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows; agent report.
result: `rows: 30` changed nothing either.
replaces: [PROTO: agent report] (ux-design.md:546)

## ev:197 — Read bodyRows in the render hook
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows; register.tsx:234-242.
result: Read `e.props.scroll.bodyRows` in the render hook and count your rows against it.
replaces: [PROTO: register.tsx:234-242] (ux-design.md:547)

## ev:198 — Drop rows in order until the list fits
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows.
result: Drop in this order until it fits: blank rows between groups, then the blank row under the header.
replaces: [PROTO] (ux-design.md:548)

## ev:199 — A wrapped row breaks the window count
2026-10-09 · 2.1.296 · a second fresh agent ran the whole chain on `notes-pane` (13 of 13 steps); the final fix pass fixed its 7 reports and ran the smoke test (`storyboard.md` section 10).
result: A row that wraps takes two lines and the window count is wrong: at 60 columns variant D wrapped `Call the vendor about the invoice before Friday` to two lines.
replaces: [FIX: prove2] (ux-design.md:558)

## ev:200 — Live result of the window rule
2026-10-09 · 2.1.296 · a second fresh agent ran the whole chain on `notes-pane` (13 of 13 steps); the final fix pass fixed its 7 reports and ran the smoke test (`storyboard.md` section 10).
result: Live result : a 150 x 45 dock showed 34 rows of 60 (`↓ 26 more`) with one spare row; inline at 100 x 45 it showed 9 rows (`↓ 51 more`).
replaces: [FIX: prove2] (ux-design.md:559)

## ev:201 — The old fixed window left rows empty
2026-10-09 · 2.1.296 · a second fresh agent ran the whole chain on `notes-pane` (13 of 13 steps); the final fix pass fixed its 7 reports and ran the smoke test (`storyboard.md` section 10) (`C-overflow-150).
result: The old fixed window (10 rows) left 25 rows of a 45-row dock empty.
replaces: [FIX: prove2: `C-overflow-150`] (ux-design.md:559)

## ev:202 — Group headers change the window height
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows; A and B variants, `register.tsx:236-239.
result: Group headers (`Needs input`, `Working`) change the height while the window scrolls: a window of 4 rows can hold 1, 2 or 3 headers.
replaces: [PROTO: A and B variants, `register.tsx:236-239`] (ux-design.md:561)

## ev:204 — The windowed list drifted without these rules
2026-10-09 · 2.1.295 · a live tmux audit of an in-house background-agents pane (0.13.0), captures caps/53-58, 62.
result: Without these rules the list of a background-agents pane drifted: the ring and `❯` sat on different rows and ↓ stuck at row 2.
replaces: [AUDIT: caps/53-58, 62] (ux-design.md:567)

## ev:205 — A first probe without rule 2 also drifted
2026-10-09 · not recorded · the scratch mod `sfprobe`: a focus and close probe, second fix pass.
result: A first probe without rule 2 drifted the same way.
replaces: [FIX: sfprobe] (ux-design.md:567)

## ev:207 — The old prototype failed both checks
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: Proof: 19 screens and 64 keys crawled live on 2.1.296, ring `MISMATCH 0`, and the confirm's `focus` check passed; the old prototype without these rules failed both.
replaces: [FIX: prove1] (ux-design.md:680)

## ev:208 — With the rule: 58 of 58 edges
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: With it: 58/58 edges.
replaces: [FIX: prove1] (ux-design.md:711)

## ev:209 — With the rule: the ring check is OK
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: With it: `OK`.
replaces: [FIX: prove1] (ux-design.md:712)

## ev:210 — With the rule: the capture passed
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: With it: the capture passed.
replaces: [FIX: prove1] (ux-design.md:713)

## ev:212 — The verdict text of validate
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Only `Validation passed` / `Validation failed` is the verdict [R:66].
replaces: [LIVE] (testing.md:34)

## ev:213 — The JSON item shape of validate
2026-10-09 · 2.1.295 · a live run in the research pass.
result: JSON item shape: `{"module":"./tool-call.ts","pattern":"tool.call","hook":"tool.call{tool=Edit}","hasCatch":true}`.
replaces: [LIVE] (testing.md:35)

## ev:214 — The engine writes types and tsconfig files
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows; the file's mtime is 17:12:31Z, the second of the log line `type root of <mod>-proto at <mod>/.claude-plugin/types`, proto-C.log:146; `plugin.json` was older.
result: The engine writes `<mod>/.claude-plugin/types/` AND `<mod>/tsconfig.json` (`{ "extends": "./.claude-plugin/types/tsconfig.json" }`) into the mod folder.
replaces: [PROTO: the file's mtime is 17:12:31Z, the second of the log line `type root of <mod>-proto at <mod>/.claude-plugin/types`, proto-C.log:146; `plugin.json` was older] (testing.md:39)

## ev:215 — When the engine writes the types folder
2026-10-09 · 2.1.295 · a live run in the research pass.
result: It writes them only where it watches the folder: an interactive `--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`, the session mods folder, or headless with `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` [R:39-53].
replaces: [LIVE] (testing.md:39)

## ev:216 — Validate and test never write the types
2026-10-09 · 2.1.295 · a live run in the research pass.
result: `validate` and `test` never write them.
replaces: [LIVE] (testing.md:39)

## ev:217 — The plugin-types command does not exist
2026-10-09 · 2.1.295 · a live run in the research pass.
result: `/plugin-types` does not exist in 2.1.295.
replaces: [LIVE] (testing.md:39)

## ev:218 — The type check fails on an unknown prop
2026-10-09 · 2.1.295 · a live run in a fix pass: 2026-10-09, on a fresh copy of the starter mod.
result: A bad prop gives `error TS2353: ... 'bogusProp' does not exist in type 'PaneOpenArgs'` and `rc=2`.
replaces: [LIVE: fix pass, 2026-10-09, on a fresh copy of the starter mod] (testing.md:60)

## ev:219 — Proof with a .js copy of the starter
2026-10-09 · not recorded · a `.js` copy of the starter mod, second fix pass.
result: Proof : a `.js` copy with `bogusProp` gave `register.js(4,68): error TS2353` and `rc=2`.
replaces: [FIX: jsmod] (testing.md:69)

## ev:220 — checkJs reports TS2355
2026-10-09 · not recorded · a `.js` copy of the starter mod, second fix pass.
result: `checkJs` reports `TS2355: A function whose declared type is neither 'undefined', 'void', nor 'any' must return a value`.
replaces: [FIX: jsmod] (testing.md:70)

## ev:221 — Old copies of the types file are stale
2026-10-09 · 2.1.295 · a live run in the research pass: curl | head -1.
result: Do not trust old copies: GitHub `mods/types/claude-code.d.ts` says `Written by Claude Code 2.1.277`.
replaces: [LIVE: curl | head -1] (testing.md:72)

## ev:222 — A pane source folder had stale types
2026-10-09 · 2.1.295 · a live tmux audit of an in-house background-agents pane (0.13.0), head -1 of the types file.
result: The source folder of a background-agents pane had `// Written by Claude Code 2.1.288.` while the build was 2.1.295.
replaces: [AUDIT: head -1 of the types file] (testing.md:74)

## ev:223 — No test file: exit 1
2026-10-09 · 2.1.295 · a live run in the research pass.
result: No test file: exit 1, `no *.test.ts or *.test.tsx under <dir>`.
replaces: [LIVE] (testing.md:85)

## ev:224 — Nothing beneath the plugins answers session.start
2026-10-09 · 2.1.295 · a live run in the research pass.
result: An event with no answer beneath the plugin throws: `HooksError: no implementation for session.start; nothing beneath the plugins answers session.start`.
replaces: [LIVE] (testing.md:87)

## ev:225 — A redraw test found a width of 24
2026-10-09 · 2.1.295 · a live run in a fix pass.
result: Proof: a test that redrew the starter pane with `bodyColumns: 25` found `"width":24` in `ui.drawn()` (2 pass 0 fail).
replaces: [LIVE: fix pass] (testing.md:89)

## ev:226 — The text value holds all string children
2026-10-09 · 2.1.295 · the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9): a `toBe` failed, `toContain` passed.
result: Its `text` holds all string children below it [D:15194-15215].
replaces: [TPL: a `toBe` failed, `toContain` passed] (testing.md:91)

## ev:227 — Write a fresh-module test
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `tests/agents-reload.test.ts` lines 24-25.
result: Also write a "fresh module, no `session.start`" test when entries depend on init.
replaces: [PI:tests/agents-reload.test.ts:24-25] (testing.md:93)

## ev:228 — Run on 2.1.295 with tmux 3.6a
2026-10-09 · 2.1.295 · a live run in the research pass; the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9).
result: Run on 2.1.295 with tmux 3.6a.
replaces: [LIVE] [TPL] (testing.md:106)

## ev:229 — live-test exits 1 and prints the last screen
2026-10-09 · 2.1.295 · a live run in a fix pass: pass and fail runs on the starter mod.
result: It exits 1 and prints the last screen and the mod's log lines when the prompt, the load line or the marker does not appear.
replaces: [LIVE: fix pass, pass and fail runs on the starter mod] (testing.md:133)

## ev:230 — live-test prints log none with NODEBUG
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: It prints `log: none (NODEBUG=1)`.
replaces: [FIX: prove1] (testing.md:138)

## ev:231 — Defaults gave a passing run
2026-10-09 · not recorded · a copy of the starter template run with `scripts/live-test.sh`, second fix pass.
result: Proof : defaults gave `session: modtest-36127`, `PASS`, rc 0, no session left.
replaces: [FIX: template copy] (testing.md:140)

## ev:232 — Log lines of a plugin-dir load
2026-10-09 · 2.1.295 · a live tmux audit of an in-house background-agents pane (0.13.0), log reload.log:67,160.
result: Log: `Plugin "<name>" from --plugin-dir overrides installed version`, then only `hooks module <name>@inline loaded`.
replaces: [AUDIT: reload.log:67,160] (testing.md:143)

## ev:233 — The screen text when the root cannot resolve
2026-10-09 · 2.1.295 · a live tmux audit of an in-house background-agents pane (0.13.0), capture caps/70-reload-start.txt.
result: A background-agents pane drew `✕ Cannot resolve this <name> root from the installed registry; set <env override> explicitly.`.
replaces: [AUDIT: caps/70-reload-start.txt] (testing.md:144, pitfalls.md:113)

## ev:234 — An env var in the command string
2026-10-09 · 2.1.295 · a tmux 3.6a env check in the first fix pass.
result: Proof: a caller export gave `outside=[]`; the same var in the command string gave `inside=[inside]`.
replaces: [FIX: tmux 3.6a] (testing.md:145)

## ev:235 — Esc to cancel text
2026-10-09 · not recorded · a copy of the starter template run with `scripts/live-test.sh`, second fix pass.
result: Two Esc at the empty prompt open `Rewind` (`Nothing to rewind to yet. / Esc to cancel`).
replaces: [FIX: skillfix-lt] (testing.md:146)

## ev:236 — An untrusted folder blocks mods
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary at byte offset 215950000-215960000; minified names are valid for 2.1.295 only.
result: An untrusted folder blocks mods (`untrusted` refusal code).
replaces: [B:215950000-215960000] (testing.md:147)

## ev:237 — A key chord then n did not press
2026-10-09 · 2.1.295 · a live run in the research pass, practice chapter, section 3.4.
result: `C-x Tab` then `n` did not press the pane Button.
replaces: [LIVE: chapter-practice 3.4] (testing.md:151)

## ev:238 — Always read alternate_on
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary (`fullscreen disabled: tmux -CC (iTerm2 integration mode) detected); minified names are valid for 2.1.295 only.
result: Always read `#{alternate_on}`.
replaces: [B: `fullscreen disabled: tmux -CC (iTerm2 integration mode) detected`] (testing.md:152)

## ev:239 — NO_FLICKER=1 is the fullscreen switch
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary; minified names are valid for 2.1.295 only.
result: `CLAUDE_CODE_NO_FLICKER=1` is the fullscreen switch.
replaces: [B] (testing.md:152)

## ev:240 — The band showed isPlaced false late
2026-10-09 · 2.1.295 · a live run in the research pass, practice chapter, section 3.3.
result: At 143 columns the band showed a timer's `isPlaced:false` only after the next event.
replaces: [LIVE: chapter-practice 3.3] (testing.md:153, testing.md:182)

## ev:241 — The pane closed right after open
2026-10-09 · 2.1.295 (audit); not recorded (sfprobe) · a live tmux audit of an in-house background-agents pane (0.13.0), capture caps/24-27; the scratch mod `sfprobe`: a focus and close probe, second fix pass (inline 60 cols).
result: `ctrl+x x` (`pane:close`) did nothing after `ctrl+x tab`; it closed the pane right after open.
replaces: [AUDIT: caps/24-27] [FIX: sfprobe, inline 60 cols] (testing.md:155)

## ev:242 — Escape then Enter worked
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Escape then Enter worked.
replaces: [LIVE] (testing.md:156)

## ev:243 — closeOnEscape closes the pane on Escape
2026-10-09 · 2.1.295 · the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9).
result: With `closeOnEscape`, that Escape also closes the pane.
replaces: [TPL] (testing.md:156)

## ev:244 — sed and cut fail on UTF-8 bytes
2026-10-09 · 2.1.295 · a live run in the research pass; the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9).
result: `sed`/`cut` fail on the bytes with `Illegal byte sequence` unless `LC_ALL=en_US.UTF-8`.
replaces: [LIVE] [TPL] (testing.md:157)

## ev:245 — Debug output through ui.log
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Use `$.ui.log(text, { to: 'debug' })`, or print state in the pane text.
replaces: [LIVE] (testing.md:163)

## ev:246 — alternate_on 1 means fullscreen
2026-10-09 · 2.1.295 · a live run in the research pass.
result: `#{alternate_on}` 1 = fullscreen (setting `"tui": "fullscreen"`).
replaces: [LIVE] (testing.md:167)

## ev:247 — Force classic mode for one run
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Force classic for one run: `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`.
replaces: [LIVE] (testing.md:168)

## ev:248 — Fullscreen changes the saved setting
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary; minified names are valid for 2.1.295 only.
result: It changes the user's saved setting and restarts.
replaces: [B] (testing.md:169)

## ev:249 — Fullscreen is refused in tmux -CC
2026-10-09 · 2.1.295 · a static read of the 2.1.295 binary; minified names are valid for 2.1.295 only.
result: Fullscreen is refused in `tmux -CC`.
replaces: [B] (testing.md:170)

## ev:250 — Measured placement of a pane
2026-10-09 · 2.1.295 · a live run in the research pass; the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9).
result: Section 5.2 holds the placement results that were measured live.
replaces: [LIVE] [TPL] (testing.md:172)

## ev:251 — A pane moves inline and fits
2026-10-09 · 2.1.295 · the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9).
result: A docked pane, resized to 100 and 60 columns, moves inline above the prompt and fits.
replaces: [TPL] (testing.md:183)

## ev:253 — A relative glob was refused for safety
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: To remove an old one, use its absolute path: a relative glob (`rm -rf mockups*`) was refused by the safety check.
replaces: [FIX: prove1] (testing.md:205)

## ev:255 — The debug line stays in the transcript
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: With debug on, `Debug mode enabled / logging to <path>` stays in the transcript after `/clear`, so a local path shows in every PNG.
replaces: [FIX: prove1] (testing.md:209)

## ev:256 — Captures at a smaller size lacked the ring
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: A docked pane that moves inline on a resize has no focus ring: two capture passes that resized and captured gave `pointer rows [33] · inverse rows [] · MISMATCH` at 100 and 60 columns, and Down keys went nowhere.
replaces: [FIX: prove1] (testing.md:210)

## ev:257 — After the resize the ring was right
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: Run after the resize, the ring was right in 32 of 32 list captures.
replaces: [FIX: prove1] (testing.md:210)

## ev:258 — Two Esc open Rewind
2026-10-09 · not recorded · a copy of the starter template run with `scripts/live-test.sh`, second fix pass.
result: Two Esc at the empty prompt open Rewind.
replaces: [FIX: skillfix-lt] (testing.md:211)

## ev:259 — Each hot reload adds a dim line
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows; 6 reload lines in each of proto-A.log and proto-B.log.
result: Each hot reload adds a dim `<mod>: reloaded (N hooks: ...)` line, and old command replies pile up.
replaces: [PROTO: 6 reload lines in each of proto-A.log and proto-B.log] (testing.md:212)

## ev:260 — zsh reads an equals word as a command
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: Unquoted, zsh reads `=proto-A` as a command path and fails with `proto-A not found`.
replaces: [FIX: prove1] (testing.md:225)

## ev:263 — Renderer facts for the PNG script
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows.
result: The renderer facts of `scripts/ansi2png.py` were checked on 2026-10-09 on prototype captures.
replaces: [PROTO] (testing.md:235)

## ev:264 — The pane passed tests and broke three times
not recorded · not recorded · the user's feedback note `feedback_mod_pane_testing.md`.
result: A background-agents pane passed fresh `--plugin-dir` tests and broke three times in the user's session.
replaces: [MEM-TEST] (testing.md:244)

## ev:265 — The cwd value moves
not recorded · not recorded · the user's feedback note `feedback_mod_pane_testing.md`.
result: Use `$.session.root()` for the project; `cwd()` moves.
replaces: [MEM-TEST] (testing.md:247)

## ev:266 — Test at 60, 120 and 200 columns
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `CHANGELOG.md` lines 33-42.
result: Test at 60, 120 and 200+ columns.
replaces: [PI:CHANGELOG.md:33-42] (testing.md:251)

## ev:267 — These paths are part of the test
not recorded · not recorded · the user's feedback note `feedback_mod_pane_testing.md`.
result: So these paths are part of the test.
replaces: [MEM-TEST] (testing.md:252)

## ev:268 — Load error line in a reloaded folder
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Hot-reloaded folder (`--plugin-dir`, the mods folder): a dim transcript line, for example `probe: session.start hook skipped: threw Error: probe boom v3`.
replaces: [LIVE] (testing.md:258)

## ev:269 — An installed mod writes to the debug log
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Installed mod: the debug log only, as `[ERROR] probe: session.start hook skipped: threw ...`.
replaces: [LIVE] (testing.md:259)

## ev:270 — The loaded line in the debug log
2026-10-09 · 2.1.295 · a live run in the research pass; the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9).
result: `hooks module <n>@inline loaded (worker, environment N, tier user); events: ...` — loaded.
replaces: [LIVE] [TPL] (testing.md:266)

## ev:271 — A good reload from a watcher save
2026-10-09 · 2.1.295 · the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9).
result: `hooks module <n>@inline reloaded in 6.5ms` plus `session.start: raised for <n> (loaded later)` mean a good reload from a watcher save.
replaces: [TPL] (testing.md:273)

## ev:272 — A reload after a file changed
2026-10-09 · 2.1.295 · a live tmux audit of an in-house background-agents pane (0.13.0), log reload.log:1329-1333.
result: `/reload-plugins` after a file of `<n>` changed.
replaces: [AUDIT: reload.log:1329-1333] (testing.md:274)

## ev:273 — A reload with no file changed
2026-10-09 · 2.1.295 · a live tmux audit of an in-house background-agents pane (0.13.0), log reload.log:991.
result: `hooks modules unchanged, kept as loaded: <all>` — `/reload-plugins` with no file changed; nothing reloads.
replaces: [AUDIT: reload.log:991] (testing.md:275)

## ev:274 — A save can take about 30 seconds
2026-10-09 · not recorded · the scratch mod `sfprobe`: a focus and close probe, second fix pass.
result: When the watcher is idle, a save can take about 30 s to reload (29 s measured).
replaces: [FIX: sfprobe] (testing.md:276)

## ev:275 — ui.log also draws a dim row
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows; proto-A.log, 6 lines.
result: `$.ui.log` also draws it as a dim transcript row (`api.md` 10).
replaces: [PROTO: proto-A.log, 6 lines] (testing.md:281)

## ev:276 — Placement log lines
2026-10-09 · 2.1.295 · the starter mod `templates/recent-tools`, run live in tmux (`testing.md` section 9).
result: `ui.open <n> <id> (asked\ — unasked, N columns): placed` / `waits unplaced` — placement.
replaces: [TPL] (testing.md:282)

## ev:277 — A probe line in a pane
2026-10-09 · 2.1.295 · a live tmux audit of an in-house background-agents pane (0.13.0), captures caps/70-75, reload.log.
result: Measured with a probe line in a background-agents pane: a load id, a module variable, and a `$.state` list that `session.start` appends to.
replaces: [AUDIT: caps/70-75, reload.log] (testing.md:293)

## ev:278 — Exclude the reload lines from matches
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows.
result: Exclude the reload lines, or they match `\[<n>\]`.
replaces: [PROTO] (testing.md:311)

## ev:279 — Each state must read by glyph or word
2026-10-09 · 2.1.295 (chapter); not recorded (the pane's own notes name 2.1.287 and 2.1.288) (source read) · a read of the research chapter on UX, section 15.7; a source read of an in-house background-agents pane (0.13.0), file CHANGELOG.md line 48; it lists "themes without colour" as not verified.
result: Each state must still read by glyph or word.
replaces: [chapter ux 15.7; PI:CHANGELOG.md:48 lists "themes without colour" as not verified] (testing.md:319)

## ev:280 — Remove a link that points to your log
2026-10-09 · not recorded · a copy of the starter template run with `scripts/live-test.sh`, second fix pass.
result: `--debug-file` also writes a `latest` link in the log folder; remove it when it points to your log (`readlink <LOGDIR>/latest`).
replaces: [FIX: template copy] (testing.md:331)

## ev:286 — Fix for a reserved plugin name
2026-10-09 · 2.1.295 · a live run in the research pass: `claude plugin validate` on 2.1.295, names `anthropics-x`, `claude-mods`, `official-claude-tools`, `claude`, `anthropics.
result: `Plugin name "x" is reserved: it passes as one of Anthropic's own` — Validate text: the name "cannot start with "claude-", "anthropic-", "anthropics-", or "cc-plugin-", be "claude", "anthropic", "anthropics", "claude-code", or "claude-mods", or put "official" beside "claude" or "anthropic"" — Name it for what it does.
replaces: [LIVE: `claude plugin validate` on 2.1.295, names `anthropics-x`, `claude-mods`, `official-claude-tools`, `claude`, `anthropics`] (pitfalls.md:19)

## ev:288 — Do not repeat the mod name in text
2026-10-09 · 2.1.295 · a live run in the research pass: cmdtest.
result: `/x` reply shows `my-mod: text` — Expected: a `command.run` `{ text }` reply gets the plugin name in front (`cmdtest: REGCMD-HANDLED args=hello`) — Do not repeat the mod name in the text.
replaces: [LIVE:cmdtest] (pitfalls.md:27)

## ev:289 — A command needs a md file or match
2026-10-09 · 2.1.295 (live); not recorded (the pane's own notes name 2.1.287 and 2.1.288) (source read) · a live run in the research pass; a source read of an in-house background-agents pane (0.13.0), file `docs/agents-viewer.md` lines 14-25.
result: `$.command.register takes { name, ... }; name is letters, digits, _ or -` — colon in name (`my-mod:cmd`) — Bare name; or ship `commands/<name>.md` and match `{ command: '<plugin>:<name>' }`.
replaces: [LIVE] [PI:docs/agents-viewer.md:14-25] (pitfalls.md:29)

## ev:291 — Match the command exactly
2026-10-09 · 2.1.295 · a live run in the research pass.
result: `registered /x but no command.run hook answered it` — matcher name differs, or hook skipped — Match `{ command: 'x' }` exactly.
replaces: [LIVE] (pitfalls.md:31)

## ev:292 — A command vanishes after a save
2026-10-09 · 2.1.295 · a live run in the research pass.
result: A command vanishes after a save — not registered again on reload — Register in `session.start`; it fires again on reload.
replaces: [LIVE] (pitfalls.md:32)

## ev:293 — A fallback body plus a command.run hook
2026-10-09 · 2.1.295 (live); not recorded (the pane's own notes name 2.1.287 and 2.1.288) (source read) · a live run in the research pass; a source read of an in-house background-agents pane (0.13.0), file `commands/agents.md` lines 1-14.
result: The command must work with mods off — registered commands do not exist then — `commands/<name>.md` with `disable-model-invocation: true` and a fallback body, plus a `command.run` hook.
replaces: [LIVE] [PI:commands/agents.md:1-14] (pitfalls.md:33)

## ev:294 — Return text without next suppresses the turn
2026-10-09 · 2.1.295 · a live run in the research pass: cmdtest.
result: Return `{ text }` or `{}` without `next`: that suppresses the `.md` body and the model turn (2.1.295 headless).
replaces: LIVE:cmdtest (pitfalls.md:34)

## ev:295 — Interactive behaviour is unverified
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `docs/agents-viewer.md` lines 14-18.
result: The same suppression in an interactive session is UNVERIFIED on 2.1.295; a background-agents pane saw it on 2.1.287.
replaces: [PI:docs/agents-viewer.md:14-18] (pitfalls.md:34)

## ev:296 — Do not use help as a name
2026-10-09 · 2.1.295 · a live run in the research pass: cmdtest.
result: `/help` registers with no error, then `registered /help but no command.run hook answered it` — unknown (seen in `-p`) — Do not use `help` as a name (cause UNVERIFIED).
replaces: [LIVE:cmdtest] (pitfalls.md:35)

## ev:297 — Two command patterns
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Two command patterns.
replaces: [LIVE] (pitfalls.md:37)

## ev:298 — Split Markdown at about 9,500 characters
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents-format.js` lines 270, 313-315.
result: Pane blank after a long text — one element over 10,000 chars — Split Markdown at about 9,500.
replaces: [PI:hooks/agents-format.js:270,313-315] (pitfalls.md:53)

## ev:299 — Named colours draw on 2.1.295
2026-10-09 · 2.1.295 · a live run in the research pass: colour probe, see `ux-design.md` 4.1.
result: Colour does not follow the theme — a named or raw colour (`red`, `#ff0000`) is fixed in every theme — ThemeKeys (`error`). Named colours DO draw on 2.1.295 (`red` gave SGR `38;5;168`, `gray` `38;5;145`).
replaces: [LIVE: colour probe, see `ux-design.md` 4.1] (pitfalls.md:56)

## ev:300 — Use a theme key or a colour function
2026-10-09 · 2.1.295 · a live run in the research pass: colour probe.
result: `Text prop "color" must be a color (a theme key, a name, or hex)`; the engine drew its own — `color="ansi:red"`: the colon is refused — Use a ThemeKey, `#hex`, `rgb(...)` or `ansi256(...)`.
replaces: [LIVE: colour probe] (pitfalls.md:57)

## ev:301 — Keep the value in the state
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Value does not update after a press — module variable changed, nothing redraws — Keep it in `$.state` (a read subscribes), or call `$.ui.invalidate('ui.render')`.
replaces: [LIVE] (pitfalls.md:58)

## ev:303 — Key chord, click or focus true
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Hotkey does nothing — site does not hold the keys — `ctrl+x tab`, a click, or `open({ focus: true })`.
replaces: [LIVE] (pitfalls.md:61)

## ev:304 — Esc in the Input raises ui.close
2026-10-09 · 2.1.295 (audit); not recorded (sfprobe) · a live tmux audit of an in-house background-agents pane (0.13.0), captures caps/14→15, 20→21; the scratch mod `sfprobe`: a focus and close probe, second fix pass (`ui.close allowed (person)).
result: Esc in the Input raises `ui.close` with origin `person`, and a dock closes.
replaces: [AUDIT: caps/14→15, 20→21] [FIX: sfprobe: `ui.close allowed (person)`] (pitfalls.md:62)

## ev:305 — A ui.close deny keeps the docked pane
2026-10-09 · not recorded · the scratch mod `sfprobe`: a focus and close probe, second fix pass (`ui.close denied`, pane stayed).
result: A `ui.close` hook that returns `{ deny }` keeps a docked pane.
replaces: [FIX: sfprobe: `ui.close denied`, pane stayed] (pitfalls.md:62)

## ev:306 — The keys then go to the prompt
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents.js` line 1328.
result: The keys then go to the prompt, so focus the pane again: `void $.ui.open({ ...args, focus: true }).then(() => $.ui.focus({ requestId, key }))`.
replaces: [PI:hooks/agents.js:1328] (pitfalls.md:62)

## ev:307 — The crawl failed without this fix
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: Verified in a dock on 2.1.296: without it the crawl failed `list-fail-banner -[a]-> add-normal` 3 times (the `a` went to the prompt); with it, 58/58 edges.
replaces: [FIX: prove1] (pitfalls.md:62)

## ev:308 — Ring stays in one slot after a change
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: After a key changes the view, the ring sits on the wrong row (`pointer rows [3] · inverse rows [4]`) — the host keeps the ring at the same SLOT when the tree changes: after `y` on a confirm with the ring on `n` (slot 2), the list put the ring on row 2 — After the view write, `$.ui.focus({ requestId, key })` on the element of the new state (`ux-design.md` 13.2).
replaces: [FIX: prove1] (pitfalls.md:63)

## ev:309 — Move the ring with ui.focus
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: A confirm shows the ring on the destructive choice (`y: delete`), though the safe Button has `autoFocus` — `autoFocus` does not move the ring when a view replaces another; the ring takes the slot — `$.ui.focus({ requestId, key: 'act:no' })` after the view write; check with `ring-check.py --focus` or the journey node field `focus`.
replaces: [FIX: prove1] (pitfalls.md:64)

## ev:310 — 13 rows at 45 terminal rows
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows.
result: `rows` above about a third of the screen is not granted: 8 body rows at 30 terminal rows with `rows: 30` ; 13 at 45 rows with `rows: 18` or `30`.
replaces: [PROTO] (pitfalls.md:65)

## ev:311 — Footer Buttons are in the arrow ring
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows; proto-C.log:1117 `onto <mod>-proto's act:a: moved.
result: Down past the last row puts the ring on a footer hotkey (`a: answer`); `❯` stays on the last row — footer hotkey Buttons are in the arrow ring — In the `ui.focus` hook: `if (el.startsWith('act:') && e.origin.kind === 'person') return {}`. The letter still presses it (`ux-design.md` 13.1 rule 4).
replaces: [PROTO: proto-C.log:1117 `onto <mod>-proto's act:a: moved`] (pitfalls.md:66)

## ev:312 — Group headers come and go
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows.
result: A grouped list jumps in height while it scrolls — group headers inside the window come and go — Count headers inside the window budget, or pin the first shown group's header (`ux-design.md` 13.1).
replaces: [PROTO] (pitfalls.md:67)

## ev:313 — Causes of a drifting selection
2026-10-09 · 2.1.295 (audit); not recorded (sfprobe) · a live tmux audit of an in-house background-agents pane (0.13.0), captures caps/53-58, 62; the scratch mod `sfprobe`: a focus and close probe, second fix pass (`sel=2`, ring on `job-3).
result: Focus ring and `❯` on different rows; ↓ stuck at row 2 — selection not driven by `$.state` from `ui.focus`, focusable edge Buttons, and the host keeps the ring at the same SLOT when the window moves — Copy `ux-design.md` 13.1: `ui.focus` writes the selection and passes on the key for the slot, as `/diff` does [DIFF:views/dialog-pane/dialog-focus-of.ts:36-37].
replaces: [AUDIT: caps/53-58, 62] [FIX: sfprobe: `sel=2`, ring on `job-3`] (pitfalls.md:68)

## ev:314 — A slow key press lost presses
2026-10-09 · 2.1.295 · a live tmux audit of an in-house background-agents pane (0.13.0), captures caps/60, 62; the timings are from the audit report.
result: Fast ↑/↓ presses were lost because of heavy work in `ui.focus`: a background-agents pane wrote several state keys and redrew on each focus; 16 presses at 0.5 s moved 2 rows, 1.5 s per press worked.
replaces: [AUDIT: caps/60, 62; the timings are from the audit report] (pitfalls.md:69)

## ev:315 — Fast key presses kept the ring in step
2026-10-09 · 2.1.295 (jobs); not recorded (sfprobe) · the scratch mod `jobs`: the `ux-design.md` 13.1 code, run live; the scratch mod `sfprobe`: a focus and close probe, second fix pass.
result: 13.1 took 22 presses at 0.1 s with no loss; at 0.03 s it lost 2 of 14, and ring and `❯` still matched.
replaces: [FIX: jobs, sfprobe] (pitfalls.md:69)

## ev:316 — An edge Button took the ring
2026-10-09 · 2.1.295 · a live tmux audit of an in-house background-agents pane (0.13.0), capture caps/61-overflow-dock-cross-edge.ansi.
result: ↓ stops at the edge row inline — a focusable edge Button takes the ring: the ring sat on the edge of a background-agents pane `… 8 below` (docked) — Inline edges are dim Text, never focusable [DIFF:views/dialog-pane/dialog-pane.tsx:98-106]. The `/diff` DOCK uses edge Buttons bound to `app:diffFileListUp/Down` [DIFF:views/sections/list-edge-button/list-edge-button.tsx].
replaces: [AUDIT: caps/61-overflow-dock-cross-edge.ansi] (pitfalls.md:70)

## ev:317 — The engine opens a focused Select
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file proto/hooks/register.tsx:1157-1158, 1303.
result: Arrow focus lands on a `Select` and its option list opens at once; Esc in it also leaves the view — the engine opens a focused `Select` — Draw a plain Button with the value and `▾`; its `onPress` shows the `Select` with `autoFocus`, and `onSelect` hides it (`storyboard.md` section 7).
replaces: [SB:proto/hooks/register.tsx:1157-1158, 1303] (pitfalls.md:71, storyboard.md:214)

## ev:318 — The engine empties a field after Enter
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file proto/hooks/register.tsx:148-149.
result: The engine empties a field after Enter and reports `''` as a change.
replaces: [SB:proto/hooks/register.tsx:148-149] (pitfalls.md:72, storyboard.md:215)

## ev:319 — A counter in the Input key
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file register.tsx:316, 1195.
result: Ignore the `''` that follows a submit, keep the draft in `$.state`, and put a counter in the Input `key` (`edit:${k}#${epoch}`) that you raise after each result, so the field mounts again with the draft.
replaces: [SB:register.tsx:316, 1195] (pitfalls.md:72)

## ev:320 — The shape of a render return value
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: `tsc`: `TS2339: Property 'Input' does not exist on type ...` — `$.ui.resolve(e)` is typed per surface; mobile has no `Input` or `Select` [D: `Elements` type] — Return early on `e.surface === 'mobile'` before you take `Input` (`if (e.surface === 'mobile') { const els = $.ui.resolve(e); return <els.Text>…</els.Text> }`).
replaces: [FIX: prove1] (pitfalls.md:73)

## ev:321 — A write still counts as render dispatch
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: `state.set: denied: it was made while ui.render is being dispatched`, also from `void Promise.resolve().then(...)` in a render — a write still counts as part of the render dispatch (seen under `claude plugin test`) — Write from the command or a handler. For a window size that `ui.focus` needs, pick it in the command from `e.presentation` (`ux-design.md` 13.1 "Height").
replaces: [FIX: prove1] (pitfalls.md:74)

## ev:322 — A stub does not answer a direct call
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: A `$.ui.focus` in an `onPress` fails a test: `no implementation for ui.focus` (or an unhandled rejection after the test) — the test kit has nothing beneath a focus that a press starts; a stub `on('ui.focus', () => ({}))` answers a direct `$.ui.focus` call, not this one — Add `.catch(() => undefined)` to that focus call; prove the focus live (`crawl.py` node `focus`).
replaces: [FIX: prove1] (pitfalls.md:75)

## ev:323 — Expected reload timing
2026-10-09 · not recorded · the scratch mod `sfprobe`: a focus and close probe, second fix pass.
result: A save shows only after about 30 s — the watcher went idle (`plugin-dir watch on <dir>: idle, polling every 30000ms`) — Expected: save at 17:00:05, reload at 17:00:34 . Wait for `reloaded in`, or run `/reload-plugins`.
replaces: [FIX: sfprobe] (pitfalls.md:86)

## ev:324 — Start timers in session.start
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Start timers in `session.start` (it fires again on reload).
replaces: [LIVE] (pitfalls.md:87)

## ev:325 — Guard with a lazy init
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents.js` lines 96-117.
result: Start timers in `session.start` (it fires again on reload) ; guard with a lazy `ensureInit($)`.
replaces: [PI:hooks/agents.js:96-117] (pitfalls.md:87, pitfalls.md:129)

## ev:326 — Look for the reload failed line
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Old code still runs after a save — the new file failed to load — Look for `reload failed, the previous version stays loaded`.
replaces: [LIVE] (pitfalls.md:88)

## ev:328 — Detach with void startAction
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents.js` lines 501-505.
result: Press handler times out — long work in `onPress` (a permission prompt can outlive it) — Detach: `void startAction(...)`.
replaces: [PI:hooks/agents.js:501-505] (pitfalls.md:103)

## ev:329 — Wrong project folder
not recorded · not recorded · the user's feedback note `feedback_mod_pane_testing.md`.
result: Wrong project folder — `$.session.cwd()` moves with Bash `cd` — `$.session.root()`.
replaces: [MEM-TEST] (pitfalls.md:110)

## ev:330 — CLAUDE_PLUGIN_ROOT is undefined
2026-10-09 · 2.1.295 · a live run in the research pass.
result: `CLAUDE_PLUGIN_ROOT` undefined — not set for a mod — `$.plugin.root`.
replaces: [LIVE] (pitfalls.md:111)

## ev:331 — Only stdio MCP servers get the variable
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), its stdio MCP server script, line 653.
result: A mod does not get `CLAUDE_PLUGIN_DATA`; only stdio MCP servers get it.
replaces: [PI:scripts/pi-mcp-server.mjs:653] (pitfalls.md:112)

## ev:332 — Find the data dir from the provenance key
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents.js` lines 104-113, 185-225.
result: Find the data dir from the provenance key, as a background-agents pane does.
replaces: [PI:hooks/agents.js:104-113,185-225] (pitfalls.md:112)

## ev:333 — Read an override env var first
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents.js` line 105.
result: Read an override env var first (for example `<env override>`).
replaces: [PI:hooks/agents.js:105] (pitfalls.md:113)

## ev:334 — Engine-written types are stale
2026-10-09 · 2.1.295 · a live tmux audit of an in-house background-agents pane (0.13.0).
result: `tsc` passes, the mod breaks on this build — engine-written types are stale: a background-agents pane had `Written by Claude Code 2.1.288` on 2.1.295 — `testing.md` section 2: check `head -1`, refresh, or use `templates/tsconfig.check.json`.
replaces: [AUDIT] (pitfalls.md:114)

## ev:335 — Put the var in the command string
2026-10-09 · 2.1.295 · a tmux 3.6a env check in the first fix pass.
result: `NO_COLOR=1 tmux new-session ...` has colour — tmux starts the command with the SERVER's env — Put the var in the command string, or `CC_ENV`.
replaces: [FIX: tmux 3.6a] (pitfalls.md:115)

## ev:336 — Quote the tmux target name
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: `tmux kill-session -t =proto-A` fails with `proto-A not found` in zsh — zsh reads a word that starts with `=` as a command path — Quote it: `tmux kill-session -t "=proto-A"`.
replaces: [FIX: prove1] (pitfalls.md:117)

## ev:337 — Start captured sessions with NODEBUG
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: A local path shows in every capture, also after `/clear`: the session runs with `--debug-file`. Start captured sessions with `NODEBUG=1` (`live-test.sh`, `capture-matrix.py` and `crawl.py` do it).
replaces: [FIX: prove1] (pitfalls.md:118)

## ev:339 — It works right after open
2026-10-09 · 2.1.295 (audit); not recorded (sfprobe) · a live tmux audit of an in-house background-agents pane (0.13.0), capture caps/24-27; the scratch mod `sfprobe`: a focus and close probe, second fix pass.
result: `ctrl+x x` (`pane:close`) does nothing after `ctrl+x tab`; it works right after open.
replaces: [AUDIT: caps/24-27] [FIX: sfprobe] (pitfalls.md:123)

## ev:340 — A test script must not send Esc
2026-10-09 · not recorded · a copy of the starter template run with `scripts/live-test.sh`, second fix pass.
result: Two Esc at the empty prompt open `Rewind`. A test script must not send Esc there.
replaces: [FIX: skillfix-lt] (pitfalls.md:124)

## ev:341 — A Button under the mouse draws inverse
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `docs/agents-viewer.md` lines 104-110.
result: A Button under the mouse is drawn inverse.
replaces: [PI:docs/agents-viewer.md:104-110] (pitfalls.md:125, pitfalls.md:127)

## ev:342 — Guard against an equal value
2026-10-09 · not recorded (the pane's own notes name 2.1.287 and 2.1.288) · a source read of an in-house background-agents pane (0.13.0), file `hooks/agents.js` lines 1138-1140.
result: Guard `if (value !== current)`.
replaces: [PI:hooks/agents.js:1138-1140] (pitfalls.md:126)

## ev:343 — It cannot be neutral
2026-10-09 · 2.1.295 · a live run in the research pass.
result: `$.ui.status` always draws as `⚠ <plugin>: <text>` in warning colour. It cannot be neutral.
replaces: [LIVE] (pitfalls.md:128)

## ev:345 — Journey lint on the old source
2026-10-09 · 2.1.296 · a second fresh agent ran the whole chain on `notes-pane` (13 of 13 steps); the final fix pass fixed its 7 reports and ran the smoke test (`storyboard.md` section 10) (the new template journey on the old source gave `13 OPEN · 2 stale cites · 22 warnings`, exit 1).
result: Run `python3 -I scripts/audit-handlers.py <mod> journey.json` after each edit: it prints `STALE` for a cite past the end of its file and `holds no listed line (drifted?)` for a source that no longer points at a handler or a branch.
replaces: [FIX: prove2: the new template journey on the old source gave `13 OPEN · 2 stale cites · 22 warnings`, exit 1] (storyboard.md:56)

## ev:346 — Every path replays from its scenario start
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file journey.json notes, KEY SYNTAX.
result: Every path replays from its scenario start, because actions change the fixture.
replaces: [SB:journey.json notes, KEY SYNTAX] (storyboard.md:76, storyboard.md:221)

## ev:347 — The crawl fails on a wrong focus
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: `crawl.py` fails the capture when the ring holds something else (`focus: the ring holds ['y: delete'], not 'n: keep it'`).
replaces: [FIX: prove1] (storyboard.md:89)

## ev:348 — Lint needs the Escape twin
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: Without the twin, lint says `reach: edge add-normal -[Escape]-> list-empty: no scenario has a path to its source where the edge is allowed`.
replaces: [FIX: prove1] (storyboard.md:96)

## ev:349 — Summary of the first crawl failures
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file crawl/summary-run1.json.
result: The first crawl gave 27 edge failures and 6 node failures, all `missing ['!✓']` on `detail-done`; the fix was `!✓ Message sent && !✓ Stopped`.
replaces: [SB:crawl/summary-run1.json] (storyboard.md:98)

## ev:350 — Approximate edges in the journey
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file journey.md.
result: 279 of 1237 edges are approximate; the review fix pass added 26 nodes where the difference mattered.
replaces: [SB:journey.md] (storyboard.md:125)

## ev:351 — Lines the journey never cited
2026-10-09 · 2.1.296 · a second fresh agent ran the whole chain on `notes-pane` (13 of 13 steps); the final fix pass fixed its 7 reports and ran the smoke test (`storyboard.md` section 10).
result: On the second fresh-agent prototype (`notes-pane`, crawled 19/19 and 64/64) the audit found 5 `OPEN` lines that the journey never cited: `session.start`, the `ui.render` hook line, the mobile branch, its draw, and the shared hotkey Button of the footer.
replaces: [FIX: prove2] (storyboard.md:140)

## ev:352 — Each timer checks a run id
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file proto/hooks/register.tsx:216-221.
result: Each timer checks a run id and does nothing after another reset.
replaces: [SB:proto/hooks/register.tsx:216-221] (storyboard.md:162)

## ev:353 — The scenario decides each action result
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45.
result: Each action result is decided by the scenario (ok, refused, declined, failed), after a fixed delay (1.5 s in the first storyboard run).
replaces: [SB] (storyboard.md:166)

## ev:354 — The gate passed while the ring was wrong
2026-10-09 · 2.1.296 · a fresh agent ran the whole design pass on a new mod `notes-pane` with only this skill; a fix pass re-ran its failing steps with the `proto-pane` template, `capture-matrix.py` and `crawl.py`.
result: In the crawl, lint and gate all passed while the ring sat on `y: delete`; nothing checked it then.
replaces: [FIX: prove1] (storyboard.md:168)

## ev:356 — An earlier step changed the fixture
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file crawl/redo-in.json.
result: An earlier step changed the fixture, so set `scn` on the edge: `band-working -[text:"/<mod>-proto" Enter]-> list-<name>-selected` failed in `normal` and passed in `band-working`.
replaces: [SB:crawl/redo-in.json] (storyboard.md:192)

## ev:357 — Numbers of the storyboard run
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45.
result: The first storyboard run had 212 nodes, 1237 edges, 24 scenarios and 6 sessions at 150 x 45.
replaces: [SB] (storyboard.md:198)

## ev:358 — The full crawl took 1875 seconds
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file crawl/run.log: real 1874,99.
result: The full crawl took 1875 s (about 31 min).
replaces: [SB:crawl/run.log: real 1874,99] (storyboard.md:198)

## ev:359 — The player was 19.2 MB
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file storyboard.html.
result: The player was 19.2 MB with 212 images as WebP lossless, quantized to 96 colours, base64 inline.
replaces: [SB:storyboard.html] (storyboard.md:198)

## ev:360 — A counter in the Input key (storyboard)
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file register.tsx:316, 349, 360, 1195.
result: Put a counter in the Input `key` (`edit:${k}#${epoch}`) and add 1 after each result, so the field mounts again with the kept draft.
replaces: [SB:register.tsx:316, 349, 360, 1195] (storyboard.md:215)

## ev:361 — Old transcript lines match a marker
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file crawl.sh, crawl.py `CLEAR_FIRST.
result: Old transcript lines match a marker (a toast's log line, a notice); every node capture starts with `/clear`, and event scenarios are listed in `crawl.clearScenarios`.
replaces: [SB:crawl.sh, crawl.py `CLEAR_FIRST`] (storyboard.md:216)

## ev:362 — Crawl sessions start with NODEBUG
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file crawl.sh:15-17.
result: `--debug-file` prints "Debug mode enabled / logging to <path>" into the transcript, so a local path shows in every shot; crawl sessions start with `NODEBUG=1`.
replaces: [SB:crawl.sh:15-17] (storyboard.md:217)

## ev:363 — A reload adds a dim row
2026-10-09 · 2.1.295 · a live prototype run: a scratch prototype of a background-agents pane, 4 variants on fixtures, tmux 45 rows.
result: Each hot reload adds a dim `<mod>: reloaded (…)` row (`testing.md` 5.4).
replaces: [PROTO] (storyboard.md:218)

## ev:364 — The marker checks the log line
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file journey.json notes, MARKER SYNTAX.
result: A toast fades before the capture; the prototype writes a transcript log line with each toast, and the marker checks the log line (`region: screen`).
replaces: [SB:journey.json notes, MARKER SYNTAX] (storyboard.md:219)

## ev:365 — The toast writes a log line
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file register.tsx:182-187.
result: The prototype function `announce()` writes `$.ui.log(line)` and a toast.
replaces: [SB:register.tsx:182-187] (storyboard.md:219)

## ev:366 — The crawler joins wrapped lines
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45; file crawl.py `holds().
result: A long notice wraps at the pane edge, so a marker part spans two lines — The crawler joins wrapped lines (`journey_lib.holds`).
replaces: [SB:crawl.py `holds()`] (storyboard.md:220)

## ev:367 — Two Esc at an empty prompt open Rewind
2026-10-09 · 2.1.295 · a live run in the first fix pass, tmux, theme `dark`.
result: Two Esc at an empty prompt open Rewind — `testing.md` 5 — `crawl.py` sends Esc only while a pane is open (dock divider, or `crawl.openMarker` for an inline pane).
replaces: [FIX] (storyboard.md:222)

## ev:368 — Strict markers from the shots check
2026-10-09 · 2.1.296 · the first live storyboard run of a background-agents pane, design C, 150 x 45.
result: With `journey-lint.py --shots` on the first storyboard run: 61 edges whose target marker already held on the source shot, and 4 node pairs with the same marker.
replaces: [SB] (storyboard.md:223)

## ev:377 — Validate results of the catalogue run
2026-10-09 · 2.1.295 · a live run in the research pass: research catalogue run.
result: Validate results are from runs on 2.1.295, 2026-10-09.
replaces: [LIVE: research catalogue run] (examples.md:3)

## ev:378 — Example mod behaviour live
2026-10-09 · 2.1.295 · a live run in the research pass.
result: All three pass `validate --strict` and ran live on 2.1.295: the pane listed `done Bash / done Read / done Edit`, the band showed `Last turn: 13s, 3 tool calls [ Hide ]`, and an `.env` Edit was denied with `guard: .../.env is protected here.`.
replaces: [LIVE] (examples.md:12)

## ev:379 — Seven gating hooks without catch
2026-10-09 · 2.1.295 · a live run in the research pass.
result: Diff anti-patterns: a module-closure `model` pushed with `invalidate`; 7 gating hooks without `.catch`.
replaces: [LIVE] (examples.md:31)

## ev:380 — The toast timeout has a cap of 60000 ms
2026-10-10 · 2.1.296 · a static read of the 2.1.296 binary at byte offsets 197577446 (the constant) and 197586185 (the `ui.toast` check).
result: The check returns `timeoutMs is a whole number of ms, 1 to ${F2e}` when `timeoutMs` is not a whole number in range, and the binary sets `F2e=60000`. Minified names are valid for 2.1.296 only.
replaces: none (new in v2)

## ev:381 — A mod lifts a deny rule only with a setting
2026-10-10 · 2.1.296 · a static read of the 2.1.296 binary at byte offset 223040814.
result: The binary reads `allowModsToOverrideDenyRules` from `pluginConfigs`, `cc-plugin-sec-default@builtin`, `options`. When it is not `true`, the refusal says `the deny rule holds over the plugins you install (allowModsToOverrideDenyRules)`.
replaces: none (new in v2)
