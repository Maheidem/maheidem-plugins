---
name: journey-auditor
description: |
  Audit user journeys and generate Playwright E2E tests for any web application.
  Use when: (1) "audit journeys" or "discover user journeys", (2) "find test gaps"
  or "what's not tested", (3) "generate E2E tests" or "generate Playwright tests",
  (4) "map user flows" or "map user paths", (5) "coverage gap analysis",
  (6) "audit-journeys" or "/audit-journeys", (7) "what can users do in this app",
  (8) "find all routes and flows", (9) "E2E test coverage" or "missing test coverage",
  (10) "journey mapping" or "user journey discovery", (11) "scan codebase for testable flows",
  (12) "what needs E2E tests", (13) "generate tests from gaps",
  (14) "Playwright test generation", (15) "smoke critical regression tests".
  Battle-tested across 63 sessions producing 210+ passing E2E tests.
---

# Journey Auditor Skill

Discovers all user journeys in a web application codebase, maps them into tiered test plans, identifies coverage gaps against existing tests, and generates production-quality Playwright E2E tests.

## Quick Reference

- **Discovery Checklist**: See `references/discovery-checklist.md` for WHERE to look
- **Tier Classification**: See `references/journey-tiers.md` for smoke/critical/regression tiers
- **Test Patterns**: See `references/test-generation-patterns.md` for reusable Playwright templates

## The 4-Phase Workflow

Execute phases sequentially. Each phase produces an artifact that feeds the next.

---

### Phase 1: Discovery -- Scan Codebase for User Entry Points

**Goal**: Build a complete inventory of every interaction surface in the application.

Consult `references/discovery-checklist.md` for the full checklist. The key areas:

#### 1.1 Routes and Navigation

Scan for ALL route definitions. Every route is a potential user journey entry point.

```bash
# Vue Router
grep -r "path:" src/router/ --include="*.js" --include="*.ts"

# React Router
grep -r "<Route" src/ --include="*.jsx" --include="*.tsx"

# Next.js pages
find pages/ -name "*.tsx" -o -name "*.jsx"

# FastAPI/backend routes
grep -r "@app\.\(get\|post\|put\|delete\|patch\)" --include="*.py"
grep -r "@router\.\(get\|post\|put\|delete\|patch\)" --include="*.py"
```

For each route found, record:
- **Path**: The URL pattern (e.g., `/settings`, `/tool-eval/suites/:id`)
- **Guard**: Any auth middleware or role check
- **Component**: The view/page component rendered
- **Dynamic params**: Any `:id` or `[slug]` segments

#### 1.2 Navigation Elements

Find every clickable navigation element that moves users between views:

- **Primary nav**: Sidebar links, top tabs, main navigation bars
- **Secondary nav**: Subtabs within pages, breadcrumb links
- **Programmatic nav**: `router.push()`, `navigate()`, `window.location` calls
- **Deep links**: Hash routes (`#section`), query params that change view state

```bash
# Vue navigation
grep -rn "router\.push\|router\.replace\|\$router\." src/ --include="*.vue" --include="*.js"

# React navigation
grep -rn "useNavigate\|navigate(\|Link to=" src/ --include="*.jsx" --include="*.tsx"

# HTML anchors acting as nav
grep -rn "href=" src/ --include="*.vue" --include="*.jsx" --include="*.html"
```

#### 1.3 Modals, Drawers, and Overlays

These are "hidden" journeys -- interactions that happen without a URL change:

```bash
# Find modal triggers
grep -rn "modal\|dialog\|drawer\|overlay\|popup" src/ --include="*.vue" --include="*.jsx" -i

# Find show/hide state toggles
grep -rn "showModal\|isOpen\|isVisible\|setOpen\|toggleDrawer" src/ --include="*.vue" --include="*.jsx"
```

For each modal/overlay, record:
- **Trigger**: What opens it (button click, route guard, auto-open)
- **Content**: What it contains (form, confirmation, info display)
- **Actions**: What buttons/actions it offers (confirm, cancel, submit)
- **Side effects**: What happens on submit (API call, state change, navigation)

#### 1.4 Forms and Submit Handlers

Every form is a potential multi-step journey:

```bash
# HTML forms
grep -rn "<form\|@submit\|onSubmit\|handleSubmit" src/ --include="*.vue" --include="*.jsx"

# File uploads
grep -rn "type=\"file\"\|file-input\|dropzone\|upload" src/ --include="*.vue" --include="*.jsx"

# Inline editing
grep -rn "contenteditable\|click-to-edit\|inline-edit" src/ --include="*.vue" --include="*.jsx"
```

#### 1.5 Buttons and Click Handlers

Every button with a click handler is a testable interaction:

```bash
# Vue click handlers
grep -rn "@click\|v-on:click" src/ --include="*.vue"

# React click handlers
grep -rn "onClick=" src/ --include="*.jsx" --include="*.tsx"
```

Classify each button's effect:
- **Navigation**: Moves to another page/view
- **Mutation**: Creates, updates, or deletes data
- **Toggle**: Shows/hides UI elements
- **Trigger**: Starts a process (benchmark run, evaluation, export)

#### 1.6 Real-Time Features

WebSocket, SSE, and polling patterns need special test strategies:

```bash
# WebSocket connections
grep -rn "WebSocket\|new WS\|ws://\|wss://\|onmessage\|socket\." src/ --include="*.js" --include="*.vue"

# Server-Sent Events
grep -rn "EventSource\|text/event-stream" src/ --include="*.js" --include="*.py"

# Polling
grep -rn "setInterval\|setTimeout.*fetch\|polling\|poll" src/ --include="*.js" --include="*.vue"

# Progress indicators
grep -rn "progress\|loading\|spinner\|pulse" src/ --include="*.vue" --include="*.jsx"
```

#### 1.7 Conditional UI States

These represent distinct user experiences for the same route:

```bash
# Empty states
grep -rn "empty-state\|no-data\|no-results\|nothing here" src/ --include="*.vue" --include="*.jsx"

# Error states
grep -rn "error-state\|error-message\|try-again" src/ --include="*.vue" --include="*.jsx"

# Loading states
grep -rn "v-if.*loading\|isLoading\|skeleton" src/ --include="*.vue" --include="*.jsx"

# Auth-conditional UI
grep -rn "v-if.*auth\|isAdmin\|role ==\|permission" src/ --include="*.vue" --include="*.jsx"
```

#### 1.8 API Endpoints (Backend)

Backend endpoints reveal data operations that must be covered:

```bash
# All API routes
grep -rn "def \w\+.*request" --include="*.py"
grep -rn "app\.\(get\|post\|put\|delete\)" --include="*.py" --include="*.js"

# WebSocket endpoints
grep -rn "websocket\|@app.ws\|socket\.io" --include="*.py" --include="*.js"
```

**Phase 1 Output**: A flat list of ALL discoverable interaction points, organized by source file. This is the raw inventory.

---

### Phase 2: Mapping -- Organize Into User Journeys

**Goal**: Transform the raw inventory into coherent user journeys with full paths.

#### 2.1 Group by Feature Area

Organize discoveries into logical feature groups:

| Feature Area | Example Routes | Key Interactions |
|---|---|---|
| Authentication | `/login`, `/register` | Login form, register form, logout, session expiry |
| Settings | `/settings/*` | API keys, provider CRUD, preferences |
| Dashboard | `/`, `/benchmark` | View results, run benchmark, compare |
| (your areas) | ... | ... |

#### 2.2 Map Full User Paths

For each feature, trace the COMPLETE user journey:

```
JOURNEY: "Create and run a benchmark"
  Entry:    User clicks "Run Benchmark" button on dashboard
  Step 1:   Select models from model list
  Step 2:   Configure parameters (tokens, temperature)
  Step 3:   Click "Start" button
  Step 4:   Progress bar updates in real-time (WebSocket)
  Step 5:   Results table populates on completion
  Step 6:   User can click row to see detailed results
  Exit:     Results persisted in history
  Dependencies: Must have API key configured first
```

#### 2.3 Identify Journey Dependencies

Map which journeys MUST complete before others can start:

```
graph TD
  A[Register Account] --> B[Add API Key]
  B --> C[Add Provider]
  C --> D[Run Benchmark]
  D --> E[View History]
  A --> F[Create Suite]
  F --> G[Run Evaluation]
```

These dependencies dictate test ordering and shared setup.

#### 2.4 Classify Into Tiers

Apply tier labels using `references/journey-tiers.md`:

- **@smoke**: Basic reachability -- can the user get there and see it render?
- **@critical**: Core business flows -- the reason users come to this app
- **@regression**: Edge cases, filters, sorting, error handling, secondary features

**Phase 2 Output**: A structured journey map document with tiers, paths, and dependencies.

---

### Phase 3: Gap Analysis -- Compare Against Existing Tests

**Goal**: Identify which journeys have NO test coverage and prioritize gaps.

#### 3.1 Inventory Existing Tests

```bash
# Find all test files
find e2e/ tests/ cypress/ __tests__/ -name "*.spec.*" -o -name "*.test.*" 2>/dev/null

# Extract test descriptions
grep -rn "test\('" e2e/ --include="*.spec.*" --include="*.test.*"
grep -rn "it\('" e2e/ --include="*.spec.*" --include="*.test.*"
grep -rn "describe\('" e2e/ --include="*.spec.*" --include="*.test.*"
```

#### 3.2 Map Test-to-Journey Coverage

For each existing test file:
1. Read the file header comment (if present) to understand intent
2. List the user actions it exercises
3. Map those actions to journeys from Phase 2

Build a coverage matrix:

```
| Journey                    | Tier      | Test File              | Status   |
|----------------------------|-----------|------------------------|----------|
| User registration          | @smoke    | auth/registration.spec | COVERED  |
| Login/logout               | @smoke    | auth/login-logout.spec | COVERED  |
| API key management         | @critical | settings/api-keys.spec | COVERED  |
| Benchmark comparison       | @critical | (none)                 | **GAP**  |
| Error states on login      | @regress  | auth/error-states.spec | COVERED  |
| Scheduled benchmark CRUD   | @critical | (none)                 | **GAP**  |
```

#### 3.3 Produce Gap Report

Output a prioritized list:

```markdown
## Critical Gaps (MUST FIX)
1. Benchmark comparison flow -- no test exists
2. Scheduled benchmark CRUD -- no test exists

## Regression Gaps (SHOULD FIX)
3. Filter/sort on history page -- no test exists
4. Empty state rendering -- no test exists

## Smoke Gaps (NICE TO HAVE)
5. 404 page rendering -- no test exists
```

**Phase 3 Output**: A gap report with prioritized list of uncovered journeys.

---

### Phase 4: Test Generation -- Build Tests From Gaps

**Goal**: Generate production-quality Playwright E2E tests for each gap.

Use the templates in `references/test-generation-patterns.md` as starting points.

#### 4.1 Project Setup

If no E2E directory exists, scaffold:

```
e2e/
├── components/           # Page Object components
│   ├── AuthModal.js      # Login/register interactions
│   └── ProviderSetup.js  # Common provider setup
├── helpers/
│   ├── constants.js      # Shared timeouts, credentials, utils
│   └── modals.js         # Modal interaction helpers
├── tests/
│   ├── auth/             # Auth-related test files
│   ├── settings/         # Settings test files
│   └── (feature)/        # One directory per feature area
├── package.json
└── playwright.config.js
```

#### 4.2 Page Object Components

Create reusable components for common interactions. Each component:
- Takes `page` in constructor
- Scopes selectors to a parent container (avoid global matches)
- Exposes high-level methods like `register()`, `login()`, `setupProvider()`
- Does NOT contain assertions -- tests own their assertions

```javascript
class ExampleComponent {
  constructor(page) {
    this.page = page;
    // Scope to parent container
    this.container = page.locator('.feature-container');
    this.button = this.container.locator('button.action');
  }

  async doAction(input) {
    await this.container.locator('input').fill(input);
    await this.button.click();
  }
}
```

#### 4.3 Test File Structure

Every test file follows this pattern:

```javascript
/**
 * @{tier} Feature Name -- Test Description
 *
 * Full user journey:
 *   1. Step one
 *   2. Step two
 *   3. Step three
 *
 * Self-contained: registers its own user (no dependency on other test files).
 */
const { test, expect } = require('@playwright/test');
const { AuthModal } = require('../../components/AuthModal');
const { uniqueEmail, TEST_PASSWORD, TIMEOUT } = require('../../helpers/constants');

const TEST_EMAIL = uniqueEmail('e2e-feature-name');

test.describe('@{tier} Feature Name', () => {
  test.describe.configure({ mode: 'serial' });

  let context;
  let page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();

    // Self-contained user setup
    const auth = new AuthModal(page);
    await page.goto('/login');
    await auth.register(TEST_EMAIL, TEST_PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: TIMEOUT.nav });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('Step 1: Navigate to feature', async () => {
    // ...
  });

  test('Step 2: Perform action', async () => {
    // ...
  });
});
```

#### 4.4 Writing Assertions

Follow these battle-tested rules:

1. **Use graduated timeouts**: Define a TIMEOUT object with escalating values (modal: 5s, nav: 10s, fetch: 15s, async: 30s, long-running: 90s+)
2. **Scope selectors**: Always scope to parent container to avoid matching unrelated elements
3. **Wait before assert**: Use `waitFor({ state: 'visible' })` before checking text content
4. **Prefer role selectors**: `getByRole('button', { name: 'Submit' })` over `.locator('button.submit')`
5. **Use CSS class selectors for dynamic content**: When text is non-deterministic, assert CSS classes instead

#### 4.5 Running Generated Tests

```bash
# Always run from the e2e/ directory
cd e2e/

# Run all tests
npx playwright test

# Run specific tier
npx playwright test --grep "@smoke"
npx playwright test --grep "@critical"

# Run specific file
npx playwright test tests/feature/my-test.spec.js

# Debug mode
npx playwright test --debug tests/feature/my-test.spec.js
```

**Phase 4 Output**: Complete, runnable test files with page objects and helpers.

---

## Battle-Tested Lessons (CRITICAL -- READ BEFORE GENERATING)

These lessons come from 63 real debugging sessions. Ignoring them WILL cause test failures.

### 1. LLM Non-Determinism

When testing features that call LLMs (benchmarks, evaluations, AI-generated content):

**NEVER** assert exact values:
```javascript
// BAD -- will fail on next run
await expect(cell).toHaveText('85%');
await expect(grade).toHaveText('A');

// GOOD -- accept any valid outcome
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

### 2. WebSocket Race Conditions

WebSocket messages may arrive before the page has finished rendering their target elements. Two strategies:

**Strategy A: Wait for the container first, then check for updates**
```javascript
// Wait for the results container to exist
await page.locator('.results-container').waitFor({ state: 'visible', timeout: 30_000 });
// Then wait for content to populate
await expect(page.locator('.results-row')).toHaveCount(expectedCount, { timeout: 30_000 });
```

**Strategy B: Use Playwright's built-in auto-waiting with generous timeouts**
```javascript
await expect(page.locator('.progress-bar')).toHaveAttribute('style', /width: 100%/, {
  timeout: 90_000,
});
```

### 3. Pages That Do Not Auto-Refresh

Some pages do not listen to WebSocket updates and require manual navigation/reload to show new data. Use a polling reload loop:

```javascript
async function waitForDataViaReload(page, selector, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const el = page.locator(selector);
    if (await el.count() > 0 && await el.first().isVisible()) {
      return;
    }
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2_000);
  }
  throw new Error(`Timed out waiting for ${selector} after reload loop`);
}
```

### 4. Conditional Cleanup (Skip-If-Not-Exists)

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

### 5. Provider Prefix in Model IDs

LiteLLM and similar tools prepend the provider name to model IDs. Match accordingly:

```javascript
// BAD -- model ID alone
await expect(cell).toHaveText('GLM-4.5-Air');

// GOOD -- may include provider prefix
await expect(cell).toHaveText(/GLM-4\.5-Air/);
```

### 6. Always Run Playwright From the E2E Directory

Running `npx playwright test` from the project root causes `test.describe() not expected here` errors. Always `cd e2e/` first, or configure the Playwright config to resolve paths correctly.

### 7. Serial Mode and Shared Context

Multi-step journeys MUST share browser context across steps:

- Use `test.describe.configure({ mode: 'serial' })` to run steps in order
- Use `test.beforeAll` / `test.afterAll` with shared `context` and `page` variables
- Declare `context` and `page` in the outer `describe` scope
- A failure in any step skips all subsequent steps (which is correct behavior)

### 8. Toast Assertions

Toast notifications often have dynamic text that's hard to match. Assert on CSS classes:

```javascript
// BAD -- text may vary between runs or locales
await expect(page.locator('.toast')).toHaveText('Successfully saved!');

// GOOD -- assert the success/error class
await expect(page.locator('.toast-success')).toBeVisible({ timeout: TIMEOUT.modal });

// Or wait for it to appear then disappear
await page.locator('.toast-success').waitFor({ state: 'visible', timeout: TIMEOUT.modal });
```

### 9. Grade and Status Flexibility

Features that produce grades, scores, or pass/fail status may have multiple valid outcomes:

```javascript
// Accept any grade including fallback "?"
await expect(grade).toHaveText(/[A-F?]/);

// Accept pass OR fail indicators
await expect(status).toHaveText(/OK|X|PASS|FAIL/i);
```

### 10. Scoped Selectors Prevent False Positives

Global selectors match unrelated elements (e.g., a navbar logo matching a grade regex):

```javascript
// BAD -- matches anything on the page
const grade = page.locator('.grade');

// GOOD -- scoped to the results section
const resultsSection = page.locator('.results-container');
const grade = resultsSection.locator('.grade');
```

---

## Output Format

At each phase, produce a clearly labeled artifact:

- **Phase 1**: `## Discovery Inventory` -- flat list of all interaction points
- **Phase 2**: `## Journey Map` -- organized table with tiers and dependencies
- **Phase 3**: `## Gap Report` -- prioritized list of uncovered journeys
- **Phase 4**: `## Generated Tests` -- complete test files ready to run

When running all 4 phases, present a final summary:

```
JOURNEY AUDIT COMPLETE
  Discovered: 47 interaction points
  Mapped:     18 user journeys
  Existing:   12 test files covering 14 journeys
  Gaps:       4 journeys with no coverage
  Generated:  4 new test files (ready to run)
```

## Critical Rules

1. **Self-contained tests**: Each test file registers its own user. Never depend on another test file's state.
2. **No hardcoded secrets**: Use environment variables or constants files for API keys.
3. **Graduated timeouts**: Always use a TIMEOUT object, never magic numbers.
4. **Component-based selectors**: Build page objects for anything used in 2+ test files.
5. **One journey per file**: Keep test files focused on a single user journey.
6. **Header comment**: Every test file starts with a JSDoc comment explaining the journey, tier, and steps.
7. **Always scope selectors**: Use parent container locators to avoid false positives.
8. **Run from e2e/ directory**: Never run Playwright from the project root.
