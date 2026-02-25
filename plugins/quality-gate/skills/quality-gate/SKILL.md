---
name: quality-gate
description: |
  Journey-first development workflow enforcer. Defines user journeys before code,
  discovers interaction gaps, generates Playwright E2E tests, validates with real providers.
  Use when: (1) "define journey" or "define user journey", (2) "audit journeys" or
  "discover journeys", (3) "find test gaps" or "what's not tested",
  (4) "generate E2E tests" or "generate Playwright tests", (5) "validate journeys"
  or "run E2E tests", (6) "quality gate" or "/quality-gate",
  (7) "map user flows" or "what can users do", (8) before building ANY new feature,
  (9) "journey mapping" or "coverage gaps", (10) "what needs tests",
  (11) after implementing a feature to verify it works end-to-end.
  Replaces journey-auditor. Battle-tested across 63+ sessions producing 210+ passing tests.
---

# Quality Gate Skill

Journey-first development workflow that ensures features are defined, tested, and validated before they ship. Every feature starts with a journey definition and ends with a passing Playwright test against real providers.

## Quick Reference

- **Journey Doc Template**: See `references/journey-doc-template.md`
- **Discovery Checklist**: See `references/discovery-checklist.md`
- **Tier Classification**: See `references/tier-classification.md`
- **Test Patterns**: See `references/test-generation-patterns.md`
- **Battle-Tested Lessons**: See `references/battle-tested-lessons.md`

## The 5-Phase Workflow

### Phase 0: Define Journey (BEFORE writing code)

**Goal**: Document what "working" means BEFORE implementing anything.

**When**: Every time a new feature, screen, or user flow is requested.

**Process**:

1. Identify which tab/area the feature belongs to
2. Create a journey doc using the template from `references/journey-doc-template.md`
3. Place it in `.documentation/user-journeys/{tab}/{journey-name}.md`
4. For tool-eval sub-sections, use sub-folders: `.documentation/user-journeys/tool-eval/suite/`, `tool-eval/evaluate/`, etc.

**Journey doc structure** (see full template in references):
```
## Journey: {Name}
### Preconditions
### Steps (numbered, with See/Backend/WebSocket for each)
### Success Criteria
### Error Scenarios
### Maps to E2E Tests (initially "none yet")
```

5. Review the journey doc with the user BEFORE writing any code
6. A journey is NOT complete until it has both a `.md` doc AND a `.spec.js` test

**Phase 0 Output**: A journey doc in `.documentation/user-journeys/` approved by the user.

---

### Phase 1: Discovery — Scan Codebase for User Entry Points

**Goal**: Build a complete inventory of every interaction surface in the application.

**When**: Auditing an existing app, or verifying nothing was missed.

Consult `references/discovery-checklist.md` for the full scanning checklist. Key areas:

1. **Routes and Navigation** — All route definitions, dynamic params, guards
2. **Navigation Elements** — Sidebar, tabs, programmatic navigation
3. **Modals and Overlays** — Hidden journeys without URL changes
4. **Forms and Submit Handlers** — Every form is a potential journey
5. **Buttons and Click Handlers** — Classify as navigation, mutation, toggle, or trigger
6. **Real-Time Features** — WebSocket, SSE, polling, progress indicators
7. **Conditional UI States** — Empty states, error states, loading states, auth-conditional
8. **API Endpoints** — Backend routes reveal data operations

**Phase 1 Output**: A flat inventory of ALL discoverable interaction points.

---

### Phase 2: Mapping — Organize Into User Journeys

**Goal**: Transform raw inventory into coherent user journeys with full paths.

1. **Group by feature area** (benchmark, tool-eval, settings, etc.)
2. **Map full user paths** — Entry → Steps → Exit, with dependencies
3. **Identify journey dependencies** — Which journeys must complete before others start
4. **Classify into tiers** using `references/tier-classification.md`:
   - **@smoke**: Basic reachability (page loads, nav works)
   - **@critical**: Core business flows (the reason users come to this app)
   - **@regression**: Edge cases, filters, error handling

**Phase 2 Output**: Structured journey map with tiers, paths, and dependencies.

---

### Phase 3: Gap Analysis — Compare Against Existing Tests

**Goal**: Identify which journeys have NO test coverage.

1. **Inventory existing tests** — Find all `.spec.js` and `.test.*` files
2. **Map test-to-journey coverage** — Which tests cover which journeys
3. **Build coverage matrix** — Journey × Test File × Status (COVERED/GAP)
4. **Produce gap report** — Prioritized by tier (critical gaps first)

**Phase 3 Output**: A gap report with prioritized list of uncovered journeys.

---

### Phase 4: Test Generation — Build Playwright Tests From Gaps

**Goal**: Generate production-quality E2E tests for every uncovered journey.

Use templates from `references/test-generation-patterns.md`. Apply ALL lessons from `references/battle-tested-lessons.md`.

**Test configuration prerequisites** (in `e2e/.env.test`):
```bash
TEST_PROVIDER=zai_glm
TEST_MODEL=GLM-4.5-Air
TEST_API_KEY=<real-api-key>
TEST_API_BASE=https://api.z.ai/api/coding/paas/v4/
TEST_EMAIL=e2e-test@benchmark.local
TEST_PASSWORD=TestPass123!
```

**Key rules**:
- One consolidated test account shared across all test files
- Tests use `e2e/.env.test` for credentials (gitignored, `.env.test.example` committed)
- `constants.js` reads from env vars, fails fast if `TEST_API_KEY` is missing
- Tests MUST hit real providers — no mocking LLM calls
- Every generated test file links back to its journey doc in the header comment
- Every journey doc gets updated with its test file path in "Maps to E2E Tests"

**Phase 4 Output**: Runnable Playwright test files + updated journey docs with bidirectional links.

---

### Phase 5: Validation — Run Tests and Confirm Results

**Goal**: Execute tests against real providers and verify everything passes.

**In-flow mode** (after Phase 4):
```bash
cd e2e && npx playwright test tests/{feature}/ --reporter=list
```

**Standalone mode** (anytime):
```bash
# Run all tests
cd e2e && npx playwright test

# Filter by tab
cd e2e && npx playwright test tests/benchmark/

# Filter by tier
cd e2e && npx playwright test --grep "@critical"

# Filter by specific journey
cd e2e && npx playwright test tests/tool-eval/suite/create-suite.spec.js
```

**Validation checks**:
1. All tests pass (exit code 0)
2. Tests actually hit real providers (check for API calls in network tab or logs)
3. Journey docs ↔ test files are bidirectionally linked
4. No orphan tests (tests without journey docs) or orphan docs (docs without tests)

**Phase 5 Output**: Pass/fail report with test results.

---

## Journey Documentation Structure

```
.documentation/user-journeys/
├── benchmark/
│   ├── run-benchmark.md
│   ├── compare-results.md
│   ├── cancel-benchmark.md
│   └── view-history.md
├── tool-eval/
│   ├── suite/
│   │   ├── create-suite.md
│   │   └── import-suite.md
│   ├── evaluate/
│   │   ├── run-evaluation.md
│   │   └── view-results.md
│   ├── param-tune/
│   ├── prompt-tune/
│   ├── judge/
│   └── auto-optimize/
├── param-tune/
├── prompt-tune/
├── auto-optimize/
├── judge/
├── analytics/
└── settings/
```

Each `.md` file follows the template in `references/journey-doc-template.md`.

## Critical Rules

1. **Journey BEFORE code** — No feature implementation without a Phase 0 journey doc
2. **Real providers only** — Tests MUST hit real LLM APIs (Zai GLM as default)
3. **Consolidated test account** — One shared account per run, not fresh users per file
4. **Bidirectional links** — Journey docs reference test files, test files reference journey docs
5. **Time is not a constraint** — A 10-minute honest test suite beats a 2-second mocked one
6. **Battle-tested patterns** — Always consult `references/battle-tested-lessons.md` before generating tests
7. **Tier-appropriate timeouts** — Smoke: <10s, Critical: 30-120s, Regression: 10-60s
8. **Scope selectors** — Always scope to parent container to avoid false positives
9. **Run from e2e/** — Never run Playwright from project root
10. **One journey per test file** — Keep test files focused on a single user journey
