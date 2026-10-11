# Storyboard: every screen and every path, drawn live

## 1. Why

The mockups show four variants in a few states at three sizes. The person picks one.
The storyboard shows the picked variant at one size, on every path. Claude Code draws each screen live.
The person walks the storyboard in a browser player and approves it. Only then you build the real mod.
`build` refuses to run before `approve`: `build: FAIL the storyboard is not approved`.

`mockups -> pick -> journey -> audit -> crawl -> storyboard -> approve -> build`
In this file, `M` means `python3 -I ${CLAUDE_SKILL_DIR}/scripts/mods.py -C <wb>`. It is a short form of this text, not a shell variable (zsh does not split `$M`): write the full command.

## 2. Map the journey

The journey is a graph of scenarios, nodes (screens) and edges (keys). Its schema is `references/journey.schema.json`.
- `M domain` writes `journey.py` from the domain. Do not edit it. Add a screen that the schema lacks in `journey.local.py`.
- `M journey` builds `journey.json`, lints it, runs the audit (section 3) and writes the marker tests. It fails while a `TODO`, an `OPEN` line or a stale cite stays.
- A toast fades before the capture. The toast marker in a storyboard is the `$.ui.log` line of that toast.

Take the graph from the design and from the prototype source, never from memory. Give each node and edge a `source`.
Write a source as `<file>:<lines> (<symbol>)`, for example `hooks/register.tsx:177 (act del)`. Line numbers change after each edit. The symbol names the code that the line held.
The audit prints `STALE` for a cite past the end of its file. It prints `holds no listed line (drifted?)` for a source that moved [ev:345].

Walk the source handler by handler. For each item, write the screens it shows and the keys that reach them:
1. Each `ui.render` branch (`view`, `tab`, `confirm`, `notice`, `busy`, empty, loading, error). One branch is one node.
2. Each `onPress`, `onSubmit`, `onInput`, `onSelect` and `hotkey`. A handler with an `if` on the result is one edge per outcome.
3. Each `ui.focus` hook: arrow moves and the top, middle and bottom of a windowed list.
4. Each `ui.close` hook and each Esc rule. Write which Esc closes the pane and which Esc steps back.
5. Each view or tab switch and what it keeps. An edge whose result depends on the origin gets `history: true`.
6. Each confirm view, toast, notice, error path and band state. Each timer is an edge with the key `wait`.
7. The command with no argument (a plain reopen) and with each argument.

Scenarios. A scenario is one fixture world with one start node. Make one per data shape (normal, empty, loading, error, overflow). Make one per action outcome (refused, declined, failed, slow). Every path replays from its scenario start, because actions change the fixture [ev:346].

Markers. A marker is text that only its node shows: `a && b` needs both, `!c` needs c absent.
1. For each edge A -> B, B's marker must not hold on A's screen. `journey-lint.py --shots` checks this.
2. Two nodes of one scenario never share a marker. Leave out text that changes with time (`2m`).
3. Give a positive anchor first. Then add the negations that tell the node from its neighbours.
4. Do not negate one glyph (`!✓`): a timed notice can still show it. The first crawl had 33 failures from `!✓` [ev:349].
5. The same screen in two scenarios is two nodes (`j.twin(...)`). Else lint says `reach: ... no scenario has a path to its source` [ev:348].
6. The reset reply names the scenario (`Scenario C empty`). A closed-pane node can use it with `region: screen`.
7. A `focus` field names the text the ring must hold. The crawl fails with `focus: the ring holds [...]` when it differs [ev:347].

Edge keys use tmux names: `Enter`, `Escape`, `Down*4`, `C-x Tab`, `text:"main"`, `wait`, `y wait`. Every key that a screen shows needs an edge. A self-loop needs a `check` that holds after the key.
If the screen after a key is not a node, point the edge at the closest node of the same view. Add `approx`. It states what differs. Add `check`. It holds a marker of the real screen, so the live run still proves the key. Add a real node when the person must review that screen alone [ev:350].

## 3. Audit

`M journey` runs `audit-handlers.py`. It lists each line that can make a screen or a key: `on('...'`, `onPress=`, `hotkey=`, `$.ui.close(`, `$.clock.*(`, `deny:`, render returns and `if` branches.
A line that no node or edge cites is `OPEN`. Waive a line with `j.skip('<piece of the line>', '<why>')`. A helper branch that no screen shows (a path helper of a guard): end its line with `// @skip: <why>`; `journey` waives it. The starter's `inside()` has these tags. The audit ends: `44 lines · 41 cited · 3 skipped · 0 OPEN · 0 stale cites`.
On one crawled prototype (19/19, 64/64) it found 5 `OPEN` lines that the journey never cited [ev:351].

A line list cannot see a missing outcome or a shown key with no handler. Give the journey and the source to an independent reviewer: a subagent that did not write the journey. Tell it to report each gap with `file:line`.
When you have no Agent tool, walk the checklist yourself, one audit line at a time. Say in the report that no independent reviewer ran.
1. Every render branch has a node. Every handler has an edge for each outcome.
2. Every key that a screen shows has an edge. Every node has a way out (Esc, `wait` or a key); write why in `notes` when not.
3. Every timer and fixture event has a `wait` edge in the right scenario. Every error path has its scenario.
4. Field focus: enter, type, send, Esc out, and the draft kept or cleared after a send.
5. `notes` lists what the storyboard leaves out: engine prompts, mouse, other sizes, rules that differ from the code.

## 4. Prototype requirements

The kit (`hooks/kit/scenario.ts`) does items 1, 3 and 4. Check them when you do not use the kit.
1. One command resets all: `/<mod>-proto <variant> <scenario>`. It resets the world, `$.state`, view, selection, drafts and timers.
2. All drawn state lives in `$.state`. A hot reload must not change the screen.
3. Each timer checks a run id and does nothing after another reset [ev:352].
4. The scenario decides each action result after a fixed delay (1.5 s) [ev:353].
5. Markers stay stable: fixed fixture order, no random text, no clock text.
6. Every shown key works on the fixtures. A toast or a notice stands in for a real effect.
7. One size only: docked, 150 x 45. Other sizes stay in the mockups.
8. A confirm focuses the safe choice. Give its node `focus: "<safe choice>"`. One gate passed while the ring sat on `y: delete` [ev:354].

## 5. Crawl, gate, player

1. `M crawl`. It copies `src/` to `run/`, starts `crawlSessions` tmux sessions (`sb-<mod>-*`) and captures each node. Then it replays each edge and runs `journey-lint.py --shots`.
2. Fix each failure (table below). Then run `M crawl --only <ids>`: it re-captures those nodes and their edges and merges the result.
3. `M storyboard`. The gate checks graph, shots, crawl, ring, hint keys and hotspots. It writes nothing until the gate passes.
4. `M storyboard --draft` writes a review copy with the gaps in red. It exits 1.
5. Open one PNG with the Read tool. With Playwright, `storyboard` presses one key in the player: `player: #confirm-normal, key y -> #list-after-delete, errors []`.
6. Give the HTML file to the person. Go back to section 2 for each change. Then run `M approve --by person`.

Do not edit `src/` while a crawl runs. `crawl` and `live` refuse to start while an own session runs: `FAIL sessions running: ...`. Run `M clean`.

| The log says | Likely cause | Do this |
|---|---|---|
| `start <node> missing [...]` | The reset failed: unknown scenario, no load, a pane stayed open | Read `screen` in `crawl/result.json`; run the command in one session |
| `missing ['!x']`, the screen looks right | The negation matches other text | Make the marker stricter |
| `missing ['text']`, the old screen shows | The key does nothing, or the pane does not hold the key | Press it in a session; check focus |
| Right screen, a few hundred ms late | Crawler timing | Add `timeout` to the edge |
| Fails only in the edge phase | An earlier step changed the fixture | Set `scn` on the edge [ev:356] |
| Fails, then passes `via target` | The result depends on the origin | Set `history: true` |
| `ring: MISMATCH` | The ring and `❯` drift apart | Use `kit/focus.ts` and `kit/list.tsx` |

## 6. Cost and scale-down

One run had 212 nodes, 1,237 edges, 24 scenarios and 6 sessions at 150 x 45 [ev:357]. The full crawl took 1,875 s [ev:358].
The player was 19.2 MB with 212 WebP images at 96 colours [ev:359]. Above 16 MB, `storyboard` gives a WARN, not a FAIL.
- Time is about (nodes x 10 s + edges x 9 s) / sessions. Each session is a full Claude Code process; more than 6 adds timing failures.
- An image costs about 90 KB at 150 x 45. Run `M storyboard --colors 48`, then `--colors 32`, to make the file smaller.

Scale down a big graph in this order:
1. Core paths: the `normal`, `empty` and `error` scenarios, and each node one key from their start.
2. One scenario per action outcome.
3. Overflow, timers and long tails.
Use `M crawl --phase nodes` first (fast, every PNG). Then use `--phase edges`.

## 7. Traps found live

| Trap | Rule |
|---|---|
| A `Select` opens its list when the ring lands on it; its Esc also leaves the view [ev:317] | Draw a Button with the value and `▾`; show the `Select` from `onPress` |
| After Enter, the engine empties an `Input` [ev:318] | Put a counter in the Input `key` and add 1 after each result [ev:360] |
| Old transcript lines match a marker [ev:361] | Each node capture starts with `/clear`; list event scenarios in `crawl.clearScenarios` |
| `--debug-file` writes a local path into each shot [ev:362] | Crawl sessions start with `NODEBUG=1` |
| Each hot reload adds a dim `<mod>: reloaded (…)` row [ev:363] | Do not save during a crawl |
| A toast fades before the capture [ev:364] | Write a log line with each toast (`kit/toast.ts`); the marker checks it with `region: screen` [ev:365] |
| A long notice wraps, so a marker spans two lines | The crawler joins wrapped lines [ev:366] |
| Two Esc at an empty prompt open Rewind [ev:367] | The crawler sends Esc only while a pane is open |
| A marker holds before the key had effect | `journey-lint.py --shots` found 61 such edges in one run [ev:368] |
