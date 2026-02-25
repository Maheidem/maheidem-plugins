---
name: define-journey
description: "Define a user journey BEFORE writing code. Creates structured journey docs with preconditions, steps, success criteria, and error scenarios."
---

# /define-journey — Phase 0: Journey Definition

Define a user journey before implementing any feature. This is the FIRST step in the quality gate workflow.

## Arguments

- `{tab}/{journey-name}` — Path within `.documentation/user-journeys/` (e.g., `benchmark/run-benchmark` or `tool-eval/suite/create-suite`)

## Workflow

### Step 1: Validate Location

1. Parse the argument to determine tab and journey name
2. If no argument provided, ask the user which tab/feature area this journey belongs to
3. Determine the correct sub-folder path:
   - Simple: `benchmark/run-benchmark` → `.documentation/user-journeys/benchmark/run-benchmark.md`
   - Nested: `tool-eval/suite/create-suite` → `.documentation/user-journeys/tool-eval/suite/create-suite.md`
4. Create the directory if it doesn't exist

### Step 2: Gather Context

Before writing the journey doc, understand the feature:

1. Ask the user to describe what the feature does (if not already clear from conversation context)
2. Scan the codebase for related:
   - Frontend routes and components (if they exist already)
   - Backend API endpoints (if they exist already)
   - WebSocket events (if applicable)
3. If the feature doesn't exist yet, work entirely from the user's description

### Step 3: Draft the Journey Doc

Use the template from `references/journey-doc-template.md`:

1. **Preconditions** — What must be true before this journey starts
2. **Steps** — Numbered steps, each with:
   - **Sees**: What the user sees on screen
   - **Backend**: API call or server action
   - **WebSocket**: Real-time event (if applicable)
3. **Success Criteria** — What "working" looks like
4. **Error Scenarios** — At minimum: empty input, invalid credentials, provider timeout
5. **Maps to E2E Tests** — Initially "(none yet — to be generated)"

### Step 4: Review with User

Present the draft journey doc and ask the user to confirm:
- Are the steps accurate?
- Are any steps missing?
- Are the error scenarios realistic?
- Are the success criteria measurable?

### Step 5: Write the File

Save the approved journey doc to `.documentation/user-journeys/{path}.md`

### Step 6: Report

```
JOURNEY DEFINED
  Path: .documentation/user-journeys/{tab}/{journey-name}.md
  Steps: {N} steps
  Error Scenarios: {N} scenarios
  Tier: {tier}
  E2E Test: (not yet generated — use /generate-tests after implementation)
```

## Examples

```bash
# Define a new benchmark journey
/define-journey benchmark/scheduled-run

# Define a tool eval sub-journey
/define-journey tool-eval/suite/import-bfcl

# Define with no argument (interactive)
/define-journey
```

## Important

- This command runs BEFORE any code is written
- The journey doc is the contract — implementation must match it
- After implementation, use `/generate-tests` to create the Playwright test
- After tests are generated, the journey doc's "Maps to E2E Tests" section gets updated automatically
