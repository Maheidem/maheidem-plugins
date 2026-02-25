---
description: >
  Generate and maintain a human-readable CHANGELOG.md file from git history.
  Use when the user says "generate changelog", "update changelog", "what changed since",
  "show me changes", "changelog since monday", "write release notes",
  "summarize git history", "what was shipped", "what did we do this week",
  "add to changelog", "maintain changelog", or asks about recent changes
  in a git repository. Writes a persistent CHANGELOG.md file that accumulates
  entries over time.
---

# Changelog Generator

Write and maintain a human-readable CHANGELOG.md file from git commit history.

## Core Principle: Human-Readable First

The changelog is for HUMANS, not machines. Every entry should be understandable by someone who doesn't read code.

**Transform commit messages into plain language:**

| Commit Message | Changelog Entry |
|---|---|
| `feat: add JWT refresh token rotation` | Added automatic session refresh so users stay logged in longer |
| `fix: handle None auto_judge_threshold` | Fixed a crash when running auto-judge without a threshold set |
| `refactor: modular routers` | Reorganized backend code for better maintainability |
| `fix: progress bar stuck at 100%` | Fixed progress bar that wouldn't reset between runs |
| `feat: Sprint 11 — 9 tool eval features` | Break this into individual feature bullets |

## Commit Classification

Use conventional commit prefixes, then map to human-friendly categories:

| Prefix | Human Category |
|---|---|
| `feat:`, `feature:` | New Features |
| `fix:`, `bugfix:` | Bug Fixes |
| `perf:` | Improvements |
| `refactor:`, `chore:`, `ci:`, `build:`, `docs:`, `test:` | Under the Hood |

For commits without prefixes, classify by file paths:
- `tests/` → Under the Hood
- `docs/` → Under the Hood
- `.github/`, `Dockerfile` → Under the Hood
- `frontend/` only → Improvements (if UX change) or Under the Hood
- Otherwise → look at the commit body for intent

## Entry Structure

Each changelog entry follows this format:

```markdown
## [version or date label] -- YYYY-MM-DD

### New Features
- **Feature Name** -- plain-language description of what users can now do
- **Another Feature** -- what it enables, why it matters

### Improvements
- Better X when doing Y
- Faster Z under heavy load

### Bug Fixes
- Fixed: description of what was broken and what it does now
- Fixed: another fix in plain language

### Under the Hood
- Upgraded dependencies, reorganized backend, added N tests
- CI/CD improvements, Docker changes
```

## File Maintenance Rules

1. **CHANGELOG.md lives in the project root**
2. **Newest entries at the top** (reverse chronological)
3. **Never overwrite existing entries** — only prepend new ones
4. **Auto-detect last entry date** — scan for the most recent `## [` header to avoid duplicate coverage
5. **Skip empty categories** — don't include a section with zero items
6. **Group related commits** — if 5 commits all fix the same feature, write one bullet
7. **Collapse infrastructure** — "Under the Hood" should be 1-3 lines max, not a full list

## Writing Guidelines

- Start bullets with a verb: "Added", "Fixed", "Improved", "Removed", "Updated"
- Don't mention commit hashes in the file (keep it clean)
- Don't include `Co-Authored-By` lines
- Skip `static/assets/` hash-renamed files entirely
- For mega-commits (20+ files), summarize the theme, don't list files
- Keep each bullet to 1-2 lines max
- Use `--` (double dash) not `-` for em-dash separators

## Metrics (optional, at end of entry)

If the entry covers significant work, add a brief stats line:

```markdown
> 12 commits, 45 files changed, +2,400 / -320 lines
```

See `references/changelog-format.md` for the exact file template and examples.
