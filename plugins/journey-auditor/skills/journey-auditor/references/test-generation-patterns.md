# Playwright E2E Test Generation Patterns

Reusable templates extracted from 210+ passing E2E tests across the LLM Benchmark Studio project. Copy and adapt these patterns for any web application.

---

## 1. Serial Test Template With Shared Context

Use for multi-step user journeys where each step depends on the previous one.

```javascript
/**
 * @critical Feature Name -- Journey Description
 *
 * Full user journey:
 *   1. Step one description
 *   2. Step two description
 *   3. Step three description
 *
 * Self-contained: registers its own user (no dependency on other test files).
 */
const { test, expect } = require('@playwright/test');
const { AuthModal } = require('../../components/AuthModal');
const { uniqueEmail, TEST_PASSWORD, TIMEOUT } = require('../../helpers/constants');

const TEST_EMAIL = uniqueEmail('e2e-feature-name');

test.describe('@critical Feature Name', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000); // Adjust based on journey length

  /** @type {import('@playwright/test').BrowserContext} */
  let context;
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();

    // Register a fresh user
    const auth = new AuthModal(page);
    await page.goto('/login');
    await auth.register(TEST_EMAIL, TEST_PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: TIMEOUT.nav });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // ─── STEP 1 ──────────────────────────────────────────────────────────

  test('Step 1: Navigate to feature page', async () => {
    await page.locator('a.tab', { hasText: 'Feature' }).click();
    await page.waitForURL('**/feature', { timeout: TIMEOUT.nav });
    await expect(page.getByRole('heading', { name: 'Feature' })).toBeVisible();
  });

  // ─── STEP 2 ──────────────────────────────────────────────────────────

  test('Step 2: Perform primary action', async () => {
    await page.locator('button', { hasText: 'Create' }).click();
    await expect(page.locator('.toast-success')).toBeVisible({
      timeout: TIMEOUT.modal,
    });
  });
});
```

**Key Points**:
- `mode: 'serial'` ensures steps run in order; failure in step N skips steps N+1, N+2, ...
- `context` and `page` are shared across all steps via `beforeAll`/`afterAll`
- Each step is an independent `test()` so Playwright reports which step failed
- Always close context in `afterAll` to prevent browser leak

---

## 2. Page Object Component Template

Use for any interaction pattern that appears in 2+ test files.

```javascript
/**
 * FeatureName component object -- encapsulates selectors for the feature area.
 * Selectors derived from: frontend/src/components/FeatureName.vue
 */
class FeatureName {
  constructor(page) {
    this.page = page;
    // Always scope to a parent container
    this.container = page.locator('.feature-container');
    this.title = this.container.locator('.feature-title');
    this.actionButton = this.container.locator('button.primary-action');
    this.itemList = this.container.locator('.item-list');
  }

  /** Navigate to this feature's page */
  async navigateTo() {
    await this.page.locator('a.tab', { hasText: 'Feature' }).click();
    await this.page.waitForURL('**/feature', { timeout: 10_000 });
  }

  /** Create a new item with the given name */
  async createItem(name) {
    await this.actionButton.click();
    const modal = this.page.locator('.modal-overlay');
    await modal.waitFor({ state: 'visible', timeout: 5_000 });
    await modal.locator('input').fill(name);
    await modal.locator('button[type="submit"]').click();
    await modal.waitFor({ state: 'hidden', timeout: 5_000 });
  }

  /** Get the count of items in the list */
  async getItemCount() {
    return this.itemList.locator('.item-row').count();
  }

  /** Get item by name */
  getItem(name) {
    return this.itemList.locator('.item-row', { hasText: name });
  }
}

module.exports = { FeatureName };
```

**Rules for Page Objects**:
- Constructor takes only `page`
- All selectors scoped inside a parent container
- Methods perform actions, NOT assertions (tests own their assertions)
- Export as named class from module

---

## 3. Notification Bell and Dropdown Pattern

For testing real-time notification UIs.

```javascript
test('Notification appears in bell dropdown', async () => {
  // Wait for the notification badge to show a count
  const bell = page.locator('.notification-bell');
  const badge = bell.locator('.badge');

  await expect(badge).toBeVisible({ timeout: TIMEOUT.fetch });
  const count = parseInt(await badge.textContent(), 10);
  expect(count).toBeGreaterThan(0);

  // Open the dropdown
  await bell.click();
  const dropdown = page.locator('.notification-dropdown');
  await dropdown.waitFor({ state: 'visible', timeout: TIMEOUT.modal });

  // Verify notification content
  const firstItem = dropdown.locator('.notification-item').first();
  await expect(firstItem).toBeVisible();
  await expect(firstItem).toContainText(/completed|finished|done/i);

  // Close dropdown
  await page.keyboard.press('Escape');
  await dropdown.waitFor({ state: 'hidden', timeout: TIMEOUT.modal });
});
```

---

## 4. Polling Reload Loop Pattern

For pages that do not auto-update via WebSocket and require manual reload to see new data.

```javascript
/**
 * Poll a page by reloading until a selector becomes visible or timeout expires.
 * Use when the page does not listen to WebSocket updates.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector - CSS selector to wait for
 * @param {number} timeout - Maximum wait time in ms (default 30000)
 * @param {number} interval - Reload interval in ms (default 3000)
 */
async function waitForDataViaReload(page, selector, timeout = 30_000, interval = 3_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const el = page.locator(selector);
    if ((await el.count()) > 0 && (await el.first().isVisible())) {
      return;
    }
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(interval);
  }
  throw new Error(`Timed out waiting for "${selector}" after polling reload loop (${timeout}ms)`);
}

// Usage in test:
test('Step 5: Verify results appear after processing', async () => {
  await waitForDataViaReload(page, '.results-row', 60_000);
  const rows = page.locator('.results-row');
  await expect(rows).toHaveCount(1, { timeout: 5_000 });
});
```

---

## 5. WebSocket Progress Verification Pattern

For testing features that stream progress updates via WebSocket.

```javascript
test('Step 3: Run process and verify progress', async () => {
  // Click the start button
  await page.locator('button', { hasText: 'Start' }).click();

  // Wait for progress container to appear
  const progress = page.locator('.progress-container');
  await progress.waitFor({ state: 'visible', timeout: TIMEOUT.nav });

  // Verify progress bar reaches 100% (generous timeout for LLM operations)
  await expect(progress.locator('.progress-bar')).toHaveAttribute(
    'style',
    /width:\s*100%/,
    { timeout: TIMEOUT.benchmark }
  );

  // OR verify completion message
  await expect(page.locator('.status-text')).toHaveText(/complete|finished|done/i, {
    timeout: TIMEOUT.benchmark,
  });
});
```

**Alternative: Counting WebSocket-driven rows**
```javascript
test('Step 4: Verify all results arrive', async () => {
  // Wait for results to populate (each result arrives via WebSocket)
  const resultsTable = page.locator('.results-table');
  await resultsTable.waitFor({ state: 'visible', timeout: TIMEOUT.nav });

  // Wait for expected number of rows (use toHaveCount with generous timeout)
  const rows = resultsTable.locator('tbody tr');
  await expect(rows).toHaveCount(expectedModelCount, {
    timeout: TIMEOUT.benchmark,
  });

  // Verify each row has data (not just placeholder)
  for (let i = 0; i < expectedModelCount; i++) {
    const row = rows.nth(i);
    // Check for numeric value in speed column (LLM non-determinism safe)
    await expect(row.locator('td.speed')).toHaveText(/[\d.]+ tok\/s/);
  }
});
```

---

## 6. Modal Open, Verify, Close Pattern

Standard pattern for any modal interaction.

```javascript
test('Open details modal and verify content', async () => {
  // Trigger the modal
  await page.locator('.item-row', { hasText: 'Test Item' }).click();

  // Wait for modal to open
  const modal = page.locator('.modal-overlay');
  await modal.waitFor({ state: 'visible', timeout: TIMEOUT.modal });

  // Verify modal content (scope all selectors to modal)
  await expect(modal.locator('.modal-title')).toHaveText('Test Item');
  await expect(modal.locator('.detail-field')).toBeVisible();

  // Close modal (try X button, then Escape as fallback)
  const closeBtn = modal.locator('.modal-close, [aria-label="Close"]');
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }

  // Verify modal closed
  await modal.waitFor({ state: 'hidden', timeout: TIMEOUT.modal });
});
```

---

## 7. Toast Assertion Pattern

For verifying success/error feedback after actions.

```javascript
// SUCCESS toast
test('Action shows success toast', async () => {
  await page.locator('button', { hasText: 'Save' }).click();

  // Assert by CSS class, not text (text may vary)
  await expect(page.locator('.toast-success')).toBeVisible({
    timeout: TIMEOUT.modal,
  });
});

// ERROR toast
test('Invalid action shows error toast', async () => {
  await page.locator('button', { hasText: 'Submit' }).click();

  await expect(page.locator('.toast-error')).toBeVisible({
    timeout: TIMEOUT.modal,
  });
});

// Wait for toast to disappear before next action
test('Toast auto-dismisses', async () => {
  await page.locator('button', { hasText: 'Save' }).click();

  const toast = page.locator('.toast-success');
  await toast.waitFor({ state: 'visible', timeout: TIMEOUT.modal });
  await toast.waitFor({ state: 'hidden', timeout: 10_000 });
});
```

---

## 8. Conditional Cleanup (Skip-If-Not-Exists) Pattern

For cleanup steps that should only run if prior steps created data.

```javascript
test('Cleanup: delete test suite if it exists', async () => {
  // Navigate to the list page
  await page.locator('.te-subtab', { hasText: 'Suites' }).click();
  await page.waitForURL('**/tool-eval/suites', { timeout: TIMEOUT.nav });

  // Check if our test data exists
  const row = page.locator('.suite-row', { hasText: 'E2E Test Suite' });
  const exists = (await row.count()) > 0;
  test.skip(!exists, 'No test suite to clean up -- prior step may have failed');

  // Delete it
  await row.locator('.delete-btn').click();

  // Confirm danger modal
  const modal = page.locator('.modal-overlay');
  await modal.waitFor({ state: 'visible', timeout: TIMEOUT.modal });
  await modal.locator('.modal-btn-danger').click();
  await modal.waitFor({ state: 'hidden', timeout: TIMEOUT.modal });

  // Verify deleted
  await expect(row).toHaveCount(0, { timeout: TIMEOUT.nav });
});
```

---

## 9. Danger Confirmation Modal Pattern

For delete/destructive actions that require a confirmation dialog.

```javascript
/**
 * Reusable helper -- put in helpers/modals.js
 */
async function confirmDangerModal(page) {
  const modal = page.locator('.modal-overlay');
  await modal.waitFor({ state: 'visible', timeout: 5_000 });
  await modal.locator('.modal-btn-danger').click();
  await modal.waitFor({ state: 'hidden', timeout: 5_000 });
}

async function confirmModal(page) {
  const modal = page.locator('.modal-overlay');
  await modal.waitFor({ state: 'visible', timeout: 5_000 });
  await modal.locator('.modal-btn-confirm').click();
  await modal.waitFor({ state: 'hidden', timeout: 5_000 });
}

async function fillModalInput(page, value) {
  const modal = page.locator('.modal-overlay');
  await modal.waitFor({ state: 'visible', timeout: 5_000 });
  await modal.locator('.modal-input').fill(value);
  await modal.locator('.modal-btn-confirm').click();
  await modal.waitFor({ state: 'hidden', timeout: 5_000 });
}
```

---

## 10. Constants and Utilities Template

Shared configuration for all test files.

```javascript
/**
 * Shared test constants and utilities.
 * Single source of truth for all E2E test configuration.
 */

const TEST_PASSWORD = 'TestPass123!';

/** Generate a unique email to avoid collisions between parallel test files */
function uniqueEmail(prefix = 'e2e') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
}

/** Graduated timeout values (ms) -- adjust per project */
const TIMEOUT = {
  modal: 5_000,      // Modal open/close
  nav: 10_000,       // Page navigation
  fetch: 15_000,     // API fetch responses
  apiDiscovery: 30_000, // Slow API discovery
  benchmark: 90_000,  // LLM benchmark runs
  stress: 120_000,    // Long-running operations
};

module.exports = { TEST_PASSWORD, uniqueEmail, TIMEOUT };
```

---

## 11. Playwright Config Template

Base configuration for any project.

```javascript
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['list'], ['html', { open: 'on-failure' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'on-first-retry',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

---

## 12. Auth Guard Test Pattern

Verify that unauthenticated users cannot access protected routes.

```javascript
test('@smoke Protected route redirects to login', async ({ page }) => {
  // Try to access protected route without auth
  await page.goto('/dashboard');

  // Should redirect to login
  await page.waitForURL('**/login', { timeout: TIMEOUT.nav });
  await expect(page.getByRole('heading', { name: /login|sign in/i })).toBeVisible();
});
```

---

## 13. CRUD Lifecycle Pattern

Complete create-read-update-delete cycle in a single serial describe block.

```javascript
test.describe('@critical Item CRUD Lifecycle', () => {
  test.describe.configure({ mode: 'serial' });

  let context, page;
  const ITEM_NAME = 'E2E Test Item';
  const UPDATED_NAME = 'E2E Test Item Updated';

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    // Auth setup ...
  });

  test.afterAll(async () => { await context?.close(); });

  test('CREATE: Add new item', async () => {
    await page.locator('button', { hasText: 'Add' }).click();
    await fillModalInput(page, ITEM_NAME);
    await expect(page.locator('.item-row', { hasText: ITEM_NAME })).toBeVisible({
      timeout: TIMEOUT.nav,
    });
  });

  test('READ: Item appears in list', async () => {
    const row = page.locator('.item-row', { hasText: ITEM_NAME });
    await expect(row).toBeVisible();
  });

  test('UPDATE: Edit item name', async () => {
    const row = page.locator('.item-row', { hasText: ITEM_NAME });
    await row.locator('.edit-btn').click();
    await fillModalInput(page, UPDATED_NAME);
    await expect(page.locator('.item-row', { hasText: UPDATED_NAME })).toBeVisible({
      timeout: TIMEOUT.nav,
    });
  });

  test('DELETE: Remove item', async () => {
    const row = page.locator('.item-row', { hasText: UPDATED_NAME });
    await row.locator('.delete-btn').click();
    await confirmDangerModal(page);
    await expect(row).toHaveCount(0, { timeout: TIMEOUT.nav });
  });
});
```

---

## 14. File Upload Pattern

For testing file input and drag-and-drop uploads.

```javascript
test('Upload JSON file', async () => {
  // Use Playwright's file chooser API
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('button', { hasText: 'Import' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles('/path/to/test-data.json');

  // Verify upload success
  await expect(page.locator('.toast-success')).toBeVisible({
    timeout: TIMEOUT.fetch,
  });
});
```

---

## 15. Select Dropdown Pattern

For testing `<select>` elements with dynamic options.

```javascript
test('Select option from dropdown', async () => {
  const select = page.locator('select.model-select');
  await select.waitFor({ state: 'visible', timeout: TIMEOUT.nav });

  // Wait for options to populate (may load async)
  const options = select.locator('option:not([value=""])');
  await expect(options).not.toHaveCount(0, { timeout: TIMEOUT.fetch });

  // Select by visible text match
  const targetOption = select.locator('option', { hasText: 'Target Model' });
  const value = await targetOption.getAttribute('value');
  await select.selectOption(value);

  // Verify selection took effect
  await expect(select).toHaveValue(value);
});
```
