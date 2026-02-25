# Changelog Output Format

## Table Format (default)

```markdown
## Changelog: [start date] - [end date]

### Features

| Commit | What Was Added |
|---|---|
| `abc1234` | **Feature Name** -- brief description of what was added |
| `def5678` | **Another Feature** -- what it does and why it matters |

### Bug Fixes

| Commit | Fix |
|---|---|
| `ghi9012` | Fixed X that caused Y when Z happened |
| `jkl3456` | Description of what was broken and how it was resolved |

### Infrastructure / Docs

| What | Details |
|---|---|
| CI/CD | Description of pipeline changes |
| Docker | Description of container changes |
| Docs | Documentation updates |

### By the Numbers

| Metric | Value |
|---|---|
| Commits | 9 |
| Files changed | 42 |
| Lines added | +2,400 |
| Lines removed | -320 |
| Tests | 815 -> 988 |
```

## Bullet Format (alternative)

```markdown
## Changelog: [start date] - [end date]

### Features
- **`abc1234`** -- **Feature Name**: brief description
- **`def5678`** -- **Another Feature**: what it does

### Bug Fixes
- **`ghi9012`** -- Fixed X that caused Y
- **`jkl3456`** -- Fixed broken Z

### Infrastructure / Docs
- **`mno7890`** -- Updated CI pipeline for staging deploys
- **`pqr1234`** -- Added Docker healthcheck

### Summary
- **9 commits**, 42 files changed
- **+2,400** lines added, **-320** removed
- Tests: 815 -> 988
```

## Grouping Rules

When multiple commits relate to the same feature, group them:

```markdown
| `abc1234`, `def5678` | **Auth System** -- JWT login, forgot password flow, OAuth integration |
```

## Conventional Commit Prefix Map

| Prefix | Category | Icon (optional) |
|---|---|---|
| `feat:` | Features | -- |
| `fix:` | Bug Fixes | -- |
| `chore:` | Infrastructure | -- |
| `ci:` | Infrastructure | -- |
| `build:` | Infrastructure | -- |
| `docs:` | Documentation | -- |
| `refactor:` | Refactoring | -- |
| `test:` | Testing | -- |
| `perf:` | Performance | -- |

## File Path Fallback Classification

When no conventional prefix is present:

| Path Pattern | Category |
|---|---|
| `tests/`, `test_*` | Testing |
| `docs/`, `*.md` (not README) | Documentation |
| `.github/`, `Dockerfile`, `docker-compose*` | Infrastructure |
| `frontend/`, `*.vue`, `*.js` (in frontend) | Frontend |
| `static/` | Build Artifacts (skip or summarize) |
| Everything else | Other |

## Tips

- Skip `static/assets/` hash-renamed files -- they're build artifacts, mention as "Frontend rebuilt" once
- For large commits (20+ files), summarize rather than listing every file
- Strip `Co-Authored-By:` lines from commit messages
- Use `--` (em dash) not `-` for separating commit title from description
