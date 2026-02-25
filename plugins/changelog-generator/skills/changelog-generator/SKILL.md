---
description: >
  Generate structured changelogs from git history. Use when the user says
  "generate changelog", "what changed since", "show me changes",
  "changelog since monday", "list recent commits", "summarize git history",
  "what was shipped", "release notes", "what did we do this week",
  or asks about recent changes in a git repository.
---

# Changelog Generator

Generate categorized, formatted changelogs from git commit history.

## Commit Classification

Use conventional commit prefixes to categorize:

| Prefix | Category |
|---|---|
| `feat:`, `feature:` | Features |
| `fix:`, `bugfix:` | Bug Fixes |
| `chore:`, `ci:`, `build:` | Infrastructure |
| `docs:` | Documentation |
| `refactor:` | Refactoring |
| `test:`, `tests:` | Testing |
| `perf:` | Performance |

For commits without conventional prefixes, classify by file paths:
- `tests/` changes → Testing
- `docs/` changes → Documentation
- `.github/`, `Dockerfile`, `docker-compose*` → Infrastructure
- `frontend/` only → Frontend
- Otherwise → Other

## Output Structure

1. **Header** with date range
2. **Features** table — commit hash, feature name (bold), brief description
3. **Bug Fixes** table — commit hash, what was fixed
4. **Infrastructure / Docs** table — category, details
5. **By the Numbers** — total commits, files changed, lines +/-, test delta

## Metrics Extraction

From `git log --stat`:
- Count `files changed` from the summary line per commit
- Sum `insertions(+)` and `deletions(-)`
- Count unique files across all commits for total files touched

Test count detection:
- Look for pytest collection: `uv run pytest --collect-only -q 2>/dev/null | tail -1`
- Or count test files: `ls tests/test_*.py | wc -l`

## Handling Edge Cases

- **Merge commits**: Exclude with `--no-merges`
- **Co-author lines**: Strip `Co-Authored-By:` from descriptions
- **Multi-scope commits**: Use the commit message prefix, not file heuristics
- **Squash commits**: Treat as single entry, may contain bullet lists in body — summarize
- **Empty categories**: Omit sections with zero entries

See `references/changelog-format.md` for the exact output template.
