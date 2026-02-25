---
description: Generate a structured changelog from git history
arguments:
  - name: since
    description: "Start date (e.g., 'monday', '2 weeks ago', '2026-02-01')"
    default: "1 week ago"
  - name: format
    description: "Output format: 'table' or 'bullets'"
    default: "table"
allowed-tools: Bash, Grep, Read
---

# Generate Changelog

Generate a structured changelog from git history since `$ARGUMENTS.since` using `$ARGUMENTS.format` format.

## Steps

1. **Collect commits** — Run:
   ```
   git log --since="$ARGUMENTS.since" --oneline --no-merges
   git log --since="$ARGUMENTS.since" --stat --no-merges
   ```

2. **Categorize each commit** by its conventional commit prefix:
   - `feat:` / `feature:` → **Features**
   - `fix:` / `bugfix:` → **Bug Fixes**
   - `chore:` / `ci:` / `build:` → **Infrastructure**
   - `docs:` → **Documentation**
   - `refactor:` → **Refactoring**
   - `test:` / `tests:` → **Testing**
   - `perf:` → **Performance**
   - No prefix → classify by files changed (tests/ → Testing, docs/ → Docs, .github/ → CI, otherwise → Other)

3. **For each commit**, extract:
   - Short hash and message
   - Number of files changed
   - Lines added/removed (from `--stat` output)

4. **Detect test count changes** (optional):
   - Check if test files were added/removed
   - If possible, run `uv run pytest --collect-only -q 2>/dev/null | tail -1` to get current count

5. **Format output** using the changelog-generator skill's reference format.
   - If format is `table`, use markdown tables
   - If format is `bullets`, use bullet lists with bold commit hashes

6. **Present the changelog** to the user. Include a "By the Numbers" summary at the bottom.

Use the `changelog-generator` skill for formatting guidance and the reference at `references/changelog-format.md` for the exact output template.
