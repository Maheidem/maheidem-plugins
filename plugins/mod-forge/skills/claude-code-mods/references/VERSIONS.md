# Versions: what was verified on which build

Two versions can show at once. The plugin-authoring base folder names the build of this session. `claude --version` names the binary that tmux sessions start [ev:2]. Report both.
The types file of the running build is the authority. Grep a symbol; never trust a line number across builds.

## 1. Verified on

| Fact | 2.1.295 | 2.1.296 | How to re-check |
|---|---|---|---|
| Lines in `types/claude-code.d.ts` | 21,451 | 21,463 | `wc -l <PA base>/types/claude-code.d.ts` |
| Types change from 2.1.295 | n/a | 10 hunks; none in `ui.*`, toast, pane, render or focus text | `diff <old types> <new types>` |
| `reference.md` headings | 9 | the same 9 | `grep '^#' <PA base>/reference.md` |
| The 8 upgrade names (section 2) | all found [ev:3] | all found | `mods.py doctor --upgrade` |
| Placement floor: 144 columns unasked, 110 once asked [ev:93] | in the types text | in the types text | `grep -n '144 terminal columns' <types file>` |
| Toast `timeoutMs` default 4000 | in the types text | in the types text | `grep -n 'timeoutMs' <types file>` |
| `ansi:<name>` makes the engine refuse the tree [ev:24] | live | not re-checked | `mods.py live` with that colour |
| A state write from a render is denied, deferred or not [ev:19] | live | `plugin test` | `mods.py check` on a mod that writes from a render |
| Design pass, crawl and storyboard [ev:1] | live | live | `mods.py selfcheck --live --trusted <dir>` |
| Kit v2 (`KIT.version` 2 in `templates/kit/defaults.ts`: the `X` type parameter) | not re-checked | proven by the round-3 chain: 5 proof mods on kit v2 passed `mods.py done` (`KIT.types` = `2.1.296`) | `mods.py selfcheck --live --trusted <dir>` |

## 2. The upgrade check

Run it at the start of each session, and after each Claude Code update:

```bash
python3 -I ${CLAUDE_SKILL_DIR}/scripts/mods.py doctor --upgrade
```

It greps the types file for 8 names. Each count must be 1 or more:
`export type PaneOpenArgs = `, `bodyRows: number`, `'ui.focus': UiFocusInput`, `export type UiFocusInput = `,
`export type CommandPresentation = `, `isPlaced`, `timeoutMs`, `export const atom`.
On 2.1.295 and 2.1.296 the counts are 1, 2, 1, 1, 1, 10, 13, 1.
- A 0 means that a name changed. Read the new declaration before you use it.
- For a version that is not 2.1.295 or 2.1.296, `doctor --upgrade` runs `selfcheck --live`. It runs `new`, `mockups`, `journey` and `crawl` on that binary.
- `mods.py upgrade-check` runs the same grep alone: `upgrade-check: PASS types 2.1.296 · binary 2.1.296 · 8/8 names found`.
- After a pass, add a column to the table in section 1.

## 3. Known drift in the plugin-authoring text

- The plugin-authoring skill text says the types file has "about 14,000 lines". It has 21,451 on 2.1.295 and 21,463 on 2.1.296. Grep symbols, not lines.
- The web reference page says "as of v2.1.290". It lags the binary. Use the types file of the running build.
- Line numbers in `reference.md` and the types file change with each build. Cite `[PA:<heading>]` and `[D:<symbol>]` only.

## 4. Changelog of this skill

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-10-09 | The first version: a user skill with facts for 2.1.295, the design-pass scripts, the `proto-pane` template and the storyboard |
| 2.0 | 2026-10-11 | The skill moves into the `mod-forge` plugin. The driver `mods.py`, kit v2, `evidence.md`, `VERSIONS.md` and `skill-lint.py` are new. Seven templates, one for each kind, replace `proto-pane`. The references are shorter |
