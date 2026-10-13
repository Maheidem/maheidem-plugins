# Changelog

Version 1 of the skill lived in `~/.claude/skills/claude-code-mods/` and had no changelog.

## 2.0.1 (2026-10-13)

### Fixed
- `audit-existing`, `mockups`, `crawl` and `live` no longer report a misleading "session did not start" when the session folder is not trusted. `live-test.sh` detects the trust dialog on screen and fails with `trust dialog: <dir> is not trusted; pass --trusted <a trusted dir>`. The driver warns when the folder has no exact trust entry in the Claude Code state file.
- The failure label is now `session X live-test.sh failed:` with the real reason under it.

### Changed
- The `--marker` help and `SKILL.md` say to use text that always shows (for example the pane title). A missing marker prints a hint.

## 2.0.0 (2026-10-11)

### Added
- The driver `scripts/mods.py` with 22 subcommands, from `doctor` to `done`. Each subcommand ends with `<cmd>: PASS|FAIL <summary>` and `next: <command or none>`.
- The kit v2 in `templates/kit/`. It owns the focus ring, the list window, Esc step-back, confirms and the mobile narrowing.
- Templates for 7 mod kinds: `pane-list`, `pane-simple`, `band`, `status-toast`, `guard`, `command` and `mixed`.
- The domain generator `mods.py domain`. It writes fixtures, types, the journey and the marker tests from the fields of `new`.
- The storyboard tools: `journey`, `crawl`, `storyboard` and `approve`. They build the player `storyboard.html` from real sessions.
- Six eval cases in `evals/`: `pane-list-new`, `band-new`, `guard-no-screen`, `polish-native`, `redesign-existing` and `negative-settings-hook`.
- `scripts/skill-lint.py` (`mods.py lint-skill`). It checks the skill text for budgets, banned phrases and hard-coded paths.

### Changed
- The skill `claude-code-mods` moves into this plugin. Its call name is now `/mod-forge:claude-code-mods`.
- `SKILL.md` is a manual for the driver (150 lines). Script paths use `${CLAUDE_SKILL_DIR}`.

### Measured
Round 2 proof runs (output tokens / tool calls / minutes):
- stale-branches 16.0k / 38 / 8.0
- git-status-band 22.6k / 53 / 14.1
- turn-cost 16.9k / 27 / 4.5
- redesign 18.8k / 31 / 7.9
- final-notes 22.4k / 39 / 10.6

Round 3 is not measured yet (see the repo guide `guides/mods-skill.md`).

### Upgrade notes
- Install the plugin in each profile (see `README.md`). Then remove `~/.claude/skills/claude-code-mods/`. If you keep both, two skills with the same name show in the list.
