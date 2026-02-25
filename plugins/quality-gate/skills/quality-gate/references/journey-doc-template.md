# Journey Document Template

Copy this template when creating a new journey doc in `.documentation/user-journeys/{tab}/{journey-name}.md`.

---

```markdown
## Journey: {Journey Name}

**Tab:** {Tab name (e.g., Benchmark, Tool Eval > Suite)}
**Tier:** {@smoke | @critical | @regression}
**Last Updated:** {YYYY-MM-DD}

### Preconditions

- {What must be true before this journey starts}
- {e.g., User is logged in}
- {e.g., At least 1 provider configured with valid API key}

### Steps

1. **{Action description}**
   - **Sees:** {What the user sees on screen}
   - **Backend:** {API call or server-side action, e.g., GET /api/config/providers}
   - **WebSocket:** {WS event if applicable, e.g., job_status PENDING → RUNNING}

2. **{Next action}**
   - **Sees:** {UI state change}
   - **Backend:** {API call}
   - **WebSocket:** {WS event if applicable}

3. **{Continue for each step...}**

### Success Criteria

- {What "working" looks like when the journey completes}
- {e.g., Results table shows tok/sec + TTFT for each model}
- {e.g., Results persist in History tab after page refresh}

### Error Scenarios

- **{Error condition}** → {Expected behavior}
  - e.g., No provider selected → validation error before submit
- **{Error condition}** → {Expected behavior}
  - e.g., API key invalid → job fails, error shown in notification

### Maps to E2E Tests

- {Path to Playwright test file, e.g., e2e/tests/benchmark/run-benchmark.spec.js}
- {Or "(none yet — to be generated)" if test doesn't exist}
```

---

## Guidelines

- **One journey per file** — Don't combine multiple user flows in one doc
- **Be specific about "Sees"** — Name the UI elements, not just "the page updates"
- **Include WebSocket events** — For any real-time feature, document the event type and payload shape
- **Error scenarios are mandatory** — At minimum: empty/missing input, invalid credentials, provider timeout
- **Bidirectional links** — When a test is generated, update "Maps to E2E Tests" with the file path. The test file header should reference this journey doc.
- **Keep it current** — When the feature changes, update the journey doc FIRST, then the test
