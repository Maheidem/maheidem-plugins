---
name: generate-tests
description: "Generate Playwright E2E tests from journey docs or gap reports. Phase 4 of the quality gate workflow."
---

# /generate-tests — Phase 4: Test Generation

Generate production-quality Playwright E2E tests for uncovered journeys.

## Arguments

- `{tab}/{journey}` — Generate test for a specific journey doc (e.g., `benchmark/run-benchmark`)
- `--from-gaps` — Generate tests for ALL journeys identified as gaps in the last audit
- `--tier smoke|critical|regression` — Generate only for a specific tier

## Workflow

### Step 1: Identify What Needs Tests

**If specific journey provided**:
1. Read the journey doc at `.documentation/user-journeys/{path}.md`
2. Check if a test already exists (from "Maps to E2E Tests" section)
3. If test exists, ask user: overwrite or skip?

**If `--from-gaps`**:
1. Read the gap report from the last `/audit-journeys` run
2. Filter by `--tier` if specified
3. List all journeys that need tests, confirm with user before generating

### Step 2: Load Test Configuration

Read `e2e/.env.test` (or `e2e/.env.test.example` as reference):
- `TEST_PROVIDER`, `TEST_MODEL`, `TEST_API_KEY`, `TEST_API_BASE`
- `TEST_EMAIL`, `TEST_PASSWORD`
- Timeout values

If `.env.test` doesn't exist, warn the user and provide setup instructions.

### Step 3: Generate Test Files

For each journey, use patterns from `references/test-generation-patterns.md` and lessons from `references/battle-tested-lessons.md`:

1. **Header comment**: Journey name, tier, steps, link to journey doc
2. **Setup**: Use consolidated test account from `.env.test`
3. **Steps**: One `test()` per journey step, serial mode
4. **Assertions**: Respect LLM non-determinism (regex, not exact values)
5. **Timeouts**: Tier-appropriate (smoke <10s, critical 30-120s)
6. **Selectors**: Scoped to parent containers
7. **Real providers**: No mocking — tests hit actual LLM APIs

Place test files at:
```
e2e/tests/{tab}/{journey-name}.spec.js
```

For nested journeys:
```
e2e/tests/tool-eval/suite/create-suite.spec.js
```

### Step 4: Update Journey Docs

For each generated test:
1. Update the journey doc's "Maps to E2E Tests" section with the test file path
2. Verify the bidirectional link (test header references journey doc)

### Step 5: Verify Tests Run

Run the generated tests to confirm they at least start:
```bash
cd e2e && npx playwright test tests/{tab}/{journey}.spec.js --reporter=list
```

If a test fails on generation, diagnose and fix before reporting.

### Step 6: Report

```
TESTS GENERATED
  Journey Docs Processed: {N}
  Test Files Created: {N}
  Test Files Updated: {N}
  Journey Docs Updated: {N} (Maps to E2E Tests links added)

  Files:
    - e2e/tests/{tab}/{journey}.spec.js ← .documentation/user-journeys/{tab}/{journey}.md
    - ...

  Next: Run /validate to execute all tests against real providers
```

## Examples

```bash
# Generate test for a specific journey
/generate-tests benchmark/run-benchmark

# Generate tests for all gaps found by audit
/generate-tests --from-gaps

# Generate only critical-tier tests from gaps
/generate-tests --from-gaps --tier critical
```

## Important

- Generated tests MUST hit real providers (no mocking)
- Use consolidated test account (not fresh users per file)
- Always consult battle-tested lessons before writing assertions
- Review generated tests before committing — selectors may need fine-tuning
- After generation, run `/validate` to confirm tests pass
