---
name: audit-journeys
description: "Discover all user journeys in the codebase, map them, and find test coverage gaps. Phases 1-3 of the quality gate workflow."
---

# /audit-journeys — Phases 1-3: Discovery, Mapping, Gap Analysis

Scan the codebase for all user interaction points, organize them into journeys, and identify what has no test coverage.

## Arguments

- `--phase discovery|mapping|gaps` — Run a specific phase only (default: all 3)
- `--tier smoke|critical|regression` — Filter output to a specific tier
- `--tab {tab-name}` — Focus on a specific tab (e.g., `benchmark`, `tool-eval`)

## Workflow

### Step 1: Determine Scope

Parse arguments:
- No arguments: run all 3 phases sequentially
- `--phase discovery`: Phase 1 only
- `--phase mapping`: Phase 2 only (requires Phase 1 output)
- `--phase gaps`: Phase 3 only (requires Phase 2 output)

### Step 2: Identify Tech Stack

Detect the project's technology:
1. Check `package.json` for frontend framework
2. Check backend files for framework (FastAPI, Django, etc.)
3. Check for existing test infrastructure (playwright, cypress)
4. Determine routing strategy

### Step 3: Phase 1 — Discovery

Use `references/discovery-checklist.md` to scan for:
- Routes, navigation, guards
- Modals, drawers, overlays
- Forms, inputs, submit handlers
- Buttons, click handlers
- Real-time features (WebSocket, SSE, polling)
- Conditional UI states
- API endpoints

Output: flat inventory of all interaction points.

### Step 4: Phase 2 — Mapping

1. Group discoveries by feature area/tab
2. Trace full user paths (entry → steps → exit)
3. Identify dependencies between journeys
4. Classify tiers using `references/tier-classification.md`
5. Compare against existing journey docs in `.documentation/user-journeys/`
6. Flag journeys that exist in code but have NO journey doc

Output: structured journey map with tiers and dependencies.

### Step 5: Phase 3 — Gap Analysis

1. Inventory all existing test files in `e2e/tests/` and `tests/`
2. Inventory all journey docs in `.documentation/user-journeys/`
3. Cross-reference: journey doc ↔ test file ↔ actual code
4. Build coverage matrix:
   - **FULL**: Journey doc exists + test exists + test passes
   - **PARTIAL**: Journey doc exists but no test, or test exists but no journey doc
   - **GAP**: Neither journey doc nor test exists for a discovered interaction
5. Produce prioritized gap report (critical gaps first)

Output: gap report.

### Step 6: Report

```
JOURNEY AUDIT COMPLETE
  Discovered: {N} interaction points
  Mapped: {N} user journeys ({N} smoke, {N} critical, {N} regression)
  Journey Docs: {N} existing in .documentation/user-journeys/
  E2E Tests: {N} existing in e2e/tests/
  Full Coverage: {N} journeys (doc + test)
  Partial: {N} journeys (doc or test, not both)
  Gaps: {N} journeys (no doc, no test)

  CRITICAL GAPS:
    1. {journey} — {reason}
    2. {journey} — {reason}

  Next: Run /generate-tests to create tests for gaps
```

## Examples

```bash
# Full audit
/audit-journeys

# Just discover what exists
/audit-journeys --phase discovery

# Find gaps in tool-eval only
/audit-journeys --phase gaps --tab tool-eval

# Show only critical gaps
/audit-journeys --tier critical
```
