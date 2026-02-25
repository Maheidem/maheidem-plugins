# Journey Tier Classification Guide

Tiers determine test priority and execution frequency. Every discovered journey must be classified into exactly one tier.

## Tier Definitions

### @smoke -- Basic Reachability

**Question**: "Can the user even get to this page and see it render?"

Smoke tests verify that:
- The route loads without crashing
- Critical elements are visible (heading, nav, primary content area)
- Authentication gates work (logged-out user redirected, logged-in user sees content)
- Navigation links work (click tab, arrive at correct URL)

**Characteristics**:
- Fast to run (under 10 seconds each)
- No data mutations
- No API calls beyond page load
- No LLM or async operations
- Run on every deploy

**Examples**:
| Journey | Why @smoke |
|---------|-----------|
| Landing page renders | Basic entry point |
| Login page accessible | Auth gate works |
| Each nav tab navigates to correct URL | Navigation works |
| 404 page shows for invalid routes | Error routing works |
| Empty state renders for new user | First-use experience |
| Sidebar items all clickable | Nav not broken |

**Test Pattern**:
```javascript
test('@smoke Dashboard page loads', async () => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
    timeout: TIMEOUT.nav,
  });
});
```

---

### @critical -- Core Business Flows

**Question**: "Is this a reason users come to this application?"

Critical tests verify the complete user journey for features that define the product's value:
- Full CRUD cycles (create, verify, update, verify, delete, verify)
- Primary workflows end-to-end (start process, monitor progress, see results)
- Data persistence (create something, reload page, it's still there)
- Integration points (API calls succeed, responses render correctly)

**Characteristics**:
- May take 30-120 seconds each
- Create, modify, and delete data
- May involve API calls, LLM calls, or WebSocket connections
- Run steps in serial mode with shared browser context
- Self-contained (each test file creates its own user and test data)
- Run before releases and on every PR

**Examples**:
| Journey | Why @critical |
|---------|-------------|
| Register account, add API key, run benchmark | Core product loop |
| Create evaluation suite, add tools, run eval | Primary feature |
| Configure provider, add models, verify in list | Setup flow |
| Run benchmark, view results in history | Data persistence |
| Import suite from JSON, verify imported data | Data migration |

**Test Pattern**:
```javascript
test.describe('@critical Benchmark Run', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  let context, page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    // Register, setup provider, etc.
  });

  test.afterAll(async () => { await context?.close(); });

  test('Step 1: Navigate to benchmark', async () => { /* ... */ });
  test('Step 2: Select models', async () => { /* ... */ });
  test('Step 3: Run and verify progress', async () => { /* ... */ });
  test('Step 4: Verify results', async () => { /* ... */ });
});
```

---

### @regression -- Edge Cases and Secondary Features

**Question**: "If this breaks, will a power user notice?"

Regression tests verify:
- Sort, filter, and search functionality
- Pagination and infinite scroll
- Error handling and validation messages
- Modal interactions and confirmations
- Keyboard shortcuts and accessibility
- Edge cases (empty input, very long input, special characters)
- UI state transitions (loading, error, empty, populated)
- Secondary features (export, share, duplicate)

**Characteristics**:
- Medium run time (10-60 seconds each)
- May or may not mutate data
- Often test one specific interaction in isolation
- Less critical for deploy gates, important for release quality
- Run nightly or before major releases

**Examples**:
| Journey | Why @regression |
|---------|----------------|
| Sort benchmark results by tokens/sec | Sorting correctness |
| Filter history by date range | Filter functionality |
| Form validation shows error on empty submit | Input validation |
| Modal cancel button discards changes | Modal behavior |
| Delete confirmation prevents accidental deletion | Safety check |
| Resize columns in data table | UI interaction |
| Toggle between chart and table view | View switching |
| Copy API key to clipboard | Utility feature |

**Test Pattern**:
```javascript
test('@regression Sort results by column', async () => {
  const header = page.locator('th', { hasText: 'Tokens/sec' });
  await header.click();

  const firstCell = page.locator('tbody tr:first-child td:nth-child(3)');
  const lastCell = page.locator('tbody tr:last-child td:nth-child(3)');

  const first = parseFloat(await firstCell.textContent());
  const last = parseFloat(await lastCell.textContent());
  expect(first).toBeGreaterThanOrEqual(last);
});
```

---

## Classification Decision Tree

```
Is the user trying to reach a page?
  YES --> Does it require auth?
    YES --> Test auth gate + page render = @smoke
    NO  --> Test page render = @smoke
  NO --> Is this a core business operation?
    YES --> Does it create/modify/run something?
      YES --> Full CRUD or workflow = @critical
      NO  --> View/read only of critical data = @smoke
    NO --> Is it a secondary feature?
      YES --> Sort, filter, export, settings = @regression
      NO  --> Error state, edge case, or validation = @regression
```

## Tier Distribution Guidelines

A healthy test suite has roughly:

| Tier | Percentage | Count (for 30 journeys) | Run Frequency |
|------|-----------|------------------------|---------------|
| @smoke | 30-40% | 9-12 tests | Every deploy |
| @critical | 30-40% | 9-12 tests | Every PR |
| @regression | 20-30% | 6-9 tests | Nightly/release |

If your distribution is heavily skewed toward @smoke, you probably have too many "page loads" tests and not enough workflow coverage.

If it's heavily @critical, consider whether some of those could be @smoke (just check rendering) or @regression (edge cases split out).

## Tier Tags in Test Files

Use the tier tag in:
1. **File header JSDoc**: `@smoke`, `@critical`, `@regression`
2. **describe block name**: `test.describe('@smoke Nav Routing', ...)`
3. **grep filter**: `npx playwright test --grep "@critical"`

This allows running subsets of tests based on deployment context:
```bash
# CI on every push -- just smoke
npx playwright test --grep "@smoke"

# PR merge -- smoke + critical
npx playwright test --grep "@smoke|@critical"

# Release candidate -- everything
npx playwright test
```
