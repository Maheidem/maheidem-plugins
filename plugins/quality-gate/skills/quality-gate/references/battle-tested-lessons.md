# Battle-Tested Lessons

These lessons come from 63+ real debugging sessions producing 210+ passing E2E tests. Ignoring them WILL cause test failures.

## 1. LLM Non-Determinism

When testing features that call LLMs (benchmarks, evaluations, AI-generated content):

**NEVER** assert exact values:
```javascript
// BAD — will fail on next run
await expect(cell).toHaveText('85%');
await expect(grade).toHaveText('A');

// GOOD — accept any valid outcome
await expect(cell).toHaveText(/\d+%/);
await expect(grade).toHaveText(/[A-F?]/);
```

**NEVER** assert exact token counts or speeds:
```javascript
// BAD
await expect(speed).toHaveText('42.5 tok/s');

// GOOD
await expect(speed).toHaveText(/[\d.]+ tok\/s/);
```

## 2. WebSocket Race Conditions

WebSocket messages may arrive before the page has finished rendering their target elements.

**Strategy A: Wait for container first**
```javascript
await page.locator('.results-container').waitFor({ state: 'visible', timeout: 30_000 });
await expect(page.locator('.results-row')).toHaveCount(expectedCount, { timeout: 30_000 });
```

**Strategy B: Generous auto-wait timeouts**
```javascript
await expect(page.locator('.progress-bar')).toHaveAttribute('style', /width: 100%/, {
  timeout: 90_000,
});
```

## 3. Pages That Do Not Auto-Refresh

Some pages require manual reload to show new data. Use a polling reload loop:

```javascript
async function waitForDataViaReload(page, selector, timeout = 30_000, interval = 3_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const el = page.locator(selector);
    if ((await el.count()) > 0 && (await el.first().isVisible())) return;
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(interval);
  }
  throw new Error(`Timed out waiting for "${selector}" after polling reload loop (${timeout}ms)`);
}
```

## 4. Conditional Cleanup (Skip-If-Not-Exists)

For cleanup steps that should only run if prior steps created data:

```javascript
test('Cleanup: delete test data if it exists', async () => {
  const row = page.locator('.data-row', { hasText: 'Test Item' });
  const exists = await row.count() > 0;
  test.skip(!exists, 'No test data to clean up');
  await row.locator('.delete-btn').click();
  await confirmDangerModal(page);
});
```

## 5. Provider Prefix in Model IDs

LiteLLM prepends provider names to model IDs. Match accordingly:

```javascript
// BAD
await expect(cell).toHaveText('GLM-4.5-Air');

// GOOD
await expect(cell).toHaveText(/GLM-4\.5-Air/);
```

## 6. Always Run Playwright From e2e/ Directory

Running `npx playwright test` from project root causes `test.describe() not expected here` errors. Always `cd e2e/` first.

## 7. Serial Mode and Shared Context

Multi-step journeys MUST share browser context:

- `test.describe.configure({ mode: 'serial' })` — steps run in order
- `test.beforeAll` / `test.afterAll` with shared `context` and `page`
- Failure in step N skips all subsequent steps (correct behavior)

## 8. Toast Assertions

Assert on CSS classes, not text (text may vary):

```javascript
// BAD
await expect(page.locator('.toast')).toHaveText('Successfully saved!');

// GOOD
await expect(page.locator('.toast-success')).toBeVisible({ timeout: TIMEOUT.modal });
```

## 9. Grade and Status Flexibility

Features that produce grades or scores may have multiple valid outcomes:

```javascript
await expect(grade).toHaveText(/[A-F?]/);
await expect(status).toHaveText(/OK|X|PASS|FAIL/i);
```

## 10. Scoped Selectors Prevent False Positives

Global selectors match unrelated elements:

```javascript
// BAD — matches anything on the page
const grade = page.locator('.grade');

// GOOD — scoped to the results section
const resultsSection = page.locator('.results-container');
const grade = resultsSection.locator('.grade');
```

## 11. Real Provider Mandate

Tests for LLM Benchmark Studio MUST hit real providers. This is a benchmarking platform — the entire product IS calling providers and handling responses.

- Use Zai GLM-4.5-Air as the default test provider
- Credentials in `e2e/.env.test` (gitignored)
- Tests fail fast if `TEST_API_KEY` is not set
- Accept that real provider tests are slower (30s-120s) — this is intentional
- Never mock LLM responses in E2E tests

## 12. Consolidated Test Account

Use one shared test account across all test files instead of registering fresh users per file:

- Account credentials in `e2e/.env.test`
- Global setup creates/verifies the account exists
- Provider and API key configured once
- Reduces DB clutter and speeds up test initialization
