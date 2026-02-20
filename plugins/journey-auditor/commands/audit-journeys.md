---
name: audit-journeys
description: "Discover all user journeys, map paths, find test gaps, generate Playwright E2E tests"
---

# /audit-journeys -- Journey Audit

Audit user journeys in the current codebase and generate Playwright E2E tests for uncovered flows.

## Arguments

- `--phase discovery|mapping|gaps|generate` -- Run a specific phase only (default: all 4 phases)
- `--tier smoke|critical|regression` -- Filter output to a specific tier

## Workflow

### Step 1: Determine Scope

Parse arguments to decide which phases to run:

- No arguments: run all 4 phases sequentially
- `--phase discovery`: run Phase 1 only, output the discovery inventory
- `--phase mapping`: run Phase 2 only (requires Phase 1 output or existing inventory)
- `--phase gaps`: run Phase 3 only (requires Phase 2 output or existing journey map)
- `--phase generate`: run Phase 4 only (requires Phase 3 output or existing gap report)

If a phase requires output from a previous phase that hasn't been run, run the prerequisite phases first.

### Step 2: Identify the Tech Stack

Before scanning, identify the project's technology:

1. Check `package.json` for frontend framework (vue, react, next, angular, svelte)
2. Check backend files for framework (FastAPI, Django, Express, Spring Boot)
3. Check for existing test infrastructure (playwright, cypress, jest, vitest)
4. Determine routing strategy (file-based, config-based, code-based)

This determines which discovery patterns from `references/discovery-checklist.md` to apply.

### Step 3: Execute the Journey Auditor Skill

Load and follow the `journey-auditor` skill. It defines the complete 4-phase workflow:

1. **Phase 1: Discovery** -- Scan the codebase for ALL user entry points
   - Use the discovery checklist in `references/discovery-checklist.md`
   - Output a flat inventory of interaction points

2. **Phase 2: Mapping** -- Organize findings into user journeys
   - Group by feature area
   - Trace full paths (entry, interaction, state change, exit)
   - Classify tiers using `references/journey-tiers.md`
   - Map dependencies between journeys

3. **Phase 3: Gap Analysis** -- Compare against existing tests
   - Inventory all existing test files
   - Cross-reference against journey map
   - Produce prioritized gap report
   - If `--tier` specified, filter gaps to that tier only

4. **Phase 4: Test Generation** -- Build tests from gaps
   - Use patterns from `references/test-generation-patterns.md`
   - Generate Page Object components for reusable selectors
   - Create test files organized by feature area
   - Apply all 10 battle-tested lessons from the skill
   - If `--tier` specified, generate tests only for that tier

### Step 4: Report Results

Present a summary:

```
JOURNEY AUDIT COMPLETE
  Phase: {which phases ran}
  Tech Stack: {detected framework(s)}
  Discovered: {N} interaction points
  Mapped: {N} user journeys ({N} smoke, {N} critical, {N} regression)
  Existing Tests: {N} files covering {N} journeys
  Gaps Found: {N} journeys with no coverage
  Tests Generated: {N} new test files
  Files Created:
    - e2e/tests/{feature}/{file}.spec.js
    - e2e/components/{Component}.js
    - ...
```

## Examples

```bash
# Full audit -- discover everything, find gaps, generate tests
/audit-journeys

# Just discover what's in the codebase
/audit-journeys --phase discovery

# Find what's missing from existing tests
/audit-journeys --phase gaps

# Generate tests for critical gaps only
/audit-journeys --phase generate --tier critical

# Full audit but only report on smoke-level journeys
/audit-journeys --tier smoke
```

## Important

- Always run Playwright tests from the `e2e/` directory, not the project root
- Generated tests are self-contained -- each file registers its own test user
- Adapt selectors to the actual CSS classes and components in the target codebase
- The discovery phase may take several minutes on large codebases
- Review generated tests before committing -- selectors may need fine-tuning for your app
