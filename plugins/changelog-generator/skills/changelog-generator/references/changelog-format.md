# CHANGELOG.md File Format

## File Header (created once)

```markdown
# Changelog

All notable changes to this project are documented here.
Format: human-readable summaries grouped by impact.

---
```

## Entry Template

```markdown
## [v1.3.0] -- 2026-02-25

### New Features
- **Forgot Password** -- users can now reset their password via email link
- **Google OAuth** -- sign in with Google, auto-merges with existing accounts
- **Public Leaderboard** -- anonymous model rankings visible without login
- **Auto-Optimize** -- iterative prompt refinement using meta-model feedback

### Improvements
- Progress bars now show accurate ETA and persist across page navigation
- Model selector upgraded from text input to searchable dropdown
- Auth tokens extended to 24 hours with proactive background refresh

### Bug Fixes
- Fixed progress bar getting stuck at 100% between runs
- Fixed auto-judge crashing when threshold was not set
- Fixed cross-provider errors when judge and eval share the same endpoint
- Fixed Docker builds missing required Python modules

### Under the Hood
- Migrated tool eval and judge from SSE to WebSocket for real-time updates
- Added 170+ new tests (total: 988), reorganized test fixtures
- Backend restructured into 24 modular routers

> 56 commits, 736 files changed, +72,342 / -13,192 lines
```

## Full File Example

```markdown
# Changelog

All notable changes to this project are documented here.
Format: human-readable summaries grouped by impact.

---

## [v1.3.0] -- 2026-02-25

### New Features
- **Forgot Password** -- users can now reset their password via email link
- **Google OAuth** -- sign in with Google, auto-merges with existing accounts

### Bug Fixes
- Fixed progress bar getting stuck at 100%

> 12 commits, 45 files changed, +2,400 / -320 lines

---

## [v1.2.0] -- 2026-02-18

### New Features
- **Parameter Tuner** -- grid search across temperature, top_p, and provider-specific params
- **Search Space Presets** -- save and load tuning configurations

### Improvements
- WebSocket migration for real-time job updates (replaced SSE)

### Bug Fixes
- Fixed tool accuracy percentage showing double the actual value

> 20 commits, 89 files changed, +3,806 / -306 lines

---

## [v1.1.0] -- 2026-02-10

### New Features
- **Process Tracker** -- centralized job management with queuing and concurrency limits

### Under the Hood
- Added 405 automated tests across 12 files

> 8 commits, 32 files changed, +1,200 / -150 lines
```

## Version Label Conventions

Pick the style that fits the project:

| Style | Example | When to Use |
|---|---|---|
| Semver | `[v1.3.0]` | Projects with formal releases |
| Sprint | `[Sprint 11]` | Agile/sprint-based teams |
| Date | `[2026-02-25]` | Continuous delivery, no formal versions |
| Week | `[Week of Feb 24]` | Weekly cadence teams |

## Auto-Detection of Last Entry

To find where to insert a new entry, scan for:
1. The first line matching `^## \[` after the file header
2. Extract the date from `-- YYYY-MM-DD` at the end of that line
3. Use that date as the `--since` for git log
4. If no match, use the last `---` separator or end of header

## Separator Rules

- Put `---` between each entry for visual separation
- The header ends with `---` before the first entry
- Each entry is separated by `---`

## Category Priority Order

Always list categories in this order (skip empty ones):
1. New Features
2. Improvements
3. Bug Fixes
4. Breaking Changes (rare, only when applicable)
5. Under the Hood

## Grouping Heuristics

When multiple commits touch the same area:
- 3 commits fixing auth → one "Fixed" bullet mentioning all three
- 5 commits building param tuner → one "New Feature" bullet describing the end result
- 10 commits that are all `static/assets/` renames → skip entirely or "Frontend rebuilt"
