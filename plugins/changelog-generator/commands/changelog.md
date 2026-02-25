---
description: Generate or update the project's CHANGELOG.md file with recent changes
arguments:
  - name: since
    description: "Start date or 'auto' to detect from last entry (e.g., 'auto', 'monday', '2 weeks ago')"
    default: "auto"
  - name: version
    description: "Version label for this entry (e.g., 'v1.3.0', 'Sprint 11', 'Week of Feb 24')"
    default: ""
allowed-tools: Bash, Grep, Read, Write, Edit
---

# Generate or Update CHANGELOG.md

Write a human-readable changelog entry to the project's CHANGELOG.md file.

## Steps

### Step 1: Detect date range

If `$ARGUMENTS.since` is `auto`:
1. Read the existing CHANGELOG.md in the project root (if it exists)
2. Find the most recent entry's date — look for the pattern `## [` or `## v` at the start of a line
3. Extract the date from that entry header
4. Use that date as the `--since` value for git log
5. If no CHANGELOG.md exists or no date found, default to `1 week ago`

Otherwise, use the provided `$ARGUMENTS.since` value directly.

### Step 2: Collect commits

```bash
git log --since="<date>" --oneline --no-merges
git log --since="<date>" --stat --no-merges
git log --since="<date>" --no-merges --format="" --shortstat | awk '{f+=$1; i+=$4; d+=$6} END {printf "files=%d insertions=%d deletions=%d\n", f, i, d}'
git log --since="<date>" --no-merges --oneline | wc -l
```

If zero commits found, tell the user "No new changes since last entry" and stop.

### Step 3: Determine version label

If `$ARGUMENTS.version` was provided, use it.
Otherwise, try to detect:
1. Check `git tag --sort=-creatordate | head -1` for a recent tag
2. Check `package.json` or `pyproject.toml` for a version field
3. If nothing found, use today's date formatted as `YYYY-MM-DD`

### Step 4: Categorize and summarize commits

Group commits into human-readable categories. Use the changelog-generator skill for classification rules.

**CRITICAL**: Write descriptions that a non-developer can understand. Transform commit messages:
- `feat: add JWT refresh token rotation` → "Added automatic session refresh so users stay logged in longer"
- `fix: handle None auto_judge_threshold` → "Fixed a crash when running auto-judge without setting a threshold"
- `refactor: modular routers` → "Reorganized backend code for better maintainability"

Categories to use (skip empty ones):
- **New Features** — genuinely new capabilities users can see or use
- **Improvements** — enhancements to existing features (better UX, performance, etc.)
- **Bug Fixes** — things that were broken and are now fixed
- **Under the Hood** — refactoring, CI/CD, docs, testing, infrastructure (collapsed, brief)

### Step 5: Write the entry

Format the new entry following `references/changelog-format.md`.

### Step 6: Update CHANGELOG.md

If CHANGELOG.md exists:
- Read the existing file
- Insert the new entry AFTER the file header (title + description) but BEFORE all previous entries
- The most recent entry should always be at the top
- Use the Edit tool to insert, preserving all existing content

If CHANGELOG.md does not exist:
- Create it with a header and the first entry
- Header format:
  ```
  # Changelog

  All notable changes to this project are documented here.
  Format: human-readable summaries grouped by impact.

  ---
  ```

### Step 7: Confirm to user

Show the user what was written and where. Include:
- File path
- Version/date label used
- Number of entries added per category
- A brief preview of the entry
