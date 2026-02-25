---
name: validate
description: "Run Playwright E2E tests against real providers and report results. Phase 5 of quality gate, also usable standalone anytime."
---

# /validate — Phase 5: Run Tests and Validate

Execute Playwright E2E tests and verify they pass with real providers. Works both as the final step of the quality gate workflow and as a standalone command.

## Arguments

- No args: run ALL E2E tests
- `--tab {name}` — Run tests for a specific tab (e.g., `benchmark`, `tool-eval`)
- `--tier smoke|critical|regression` — Run only a specific tier
- `--journey {tab}/{name}` — Run a single journey's test
- `--check-only` — Don't run tests, just verify journey docs ↔ test files are linked

## Workflow

### Step 1: Pre-Flight Checks

1. Verify `e2e/.env.test` exists and has `TEST_API_KEY` set
2. Verify the app server is running at the configured `BASE_URL`
3. Verify Playwright is installed (`cd e2e && npx playwright --version`)
4. If any check fails, provide clear fix instructions and stop

### Step 2: Build Test Command

Based on arguments, construct the Playwright command:

```bash
# All tests
cd e2e && npx playwright test --reporter=list

# By tab
cd e2e && npx playwright test tests/benchmark/ --reporter=list

# By tier
cd e2e && npx playwright test --grep "@critical" --reporter=list

# Single journey
cd e2e && npx playwright test tests/benchmark/run-benchmark.spec.js --reporter=list
```

### Step 3: Execute Tests

Run the constructed command. Important:
- Always run from `e2e/` directory
- Use `--reporter=list` for readable output
- On failure, capture screenshots and trace (configured in playwright.config.js)

### Step 4: Analyze Results

Parse test output and categorize:
- **PASSED**: Test completed successfully
- **FAILED**: Test assertion failed — report which step and why
- **TIMED OUT**: Test exceeded timeout — likely provider issue or selector miss
- **SKIPPED**: Test was skipped (cleanup conditions, missing data)

### Step 5: Linkage Check

Regardless of `--check-only`, verify:
1. Every journey doc in `.documentation/user-journeys/` has a corresponding test in `e2e/tests/`
2. Every test in `e2e/tests/` references a journey doc in its header comment
3. Report orphans in both directions

### Step 6: Report

```
VALIDATION COMPLETE
  Tests Run: {N}
  Passed: {N} ✓
  Failed: {N} ✗
  Timed Out: {N} ⏱
  Skipped: {N} ⊘

  FAILURES:
    1. {test-file}:{step} — {assertion error}
    2. ...

  LINKAGE:
    Journey Docs: {N} total, {N} linked to tests, {N} orphaned
    Test Files: {N} total, {N} linked to docs, {N} orphaned

  Duration: {time}
```

## Examples

```bash
# Run everything
/validate

# Quick smoke check
/validate --tier smoke

# Validate specific tab
/validate --tab tool-eval

# Just check linkage without running
/validate --check-only

# Validate a single journey
/validate --journey benchmark/run-benchmark
```

## Important

- The app server MUST be running before validation
- Tests hit REAL providers — expect 1-10 minutes depending on scope
- Failures are NOT always test bugs — could be provider downtime or app bugs
- Use `--tier smoke` for quick sanity checks (< 1 minute)
- Use full validation before releases or after major changes
