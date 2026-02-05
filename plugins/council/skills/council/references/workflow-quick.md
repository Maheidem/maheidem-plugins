# Quick Mode Workflow

Quick mode is the default Council mode - single round, immediate synthesis.

## When to Use Quick Mode

- Straightforward technical questions
- Questions likely to have consensus answers
- Time-sensitive queries
- First exploration of a topic

## Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER QUESTION                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PARALLEL EXECUTION                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                         │
│  │  Codex  │  │ Gemini  │  │OpenCode │  (runs simultaneously)  │
│  └────┬────┘  └────┬────┘  └────┬────┘                         │
│       │            │            │                               │
└───────┼────────────┼────────────┼───────────────────────────────┘
        │            │            │
        ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     RESPONSE COLLECTION                         │
│  • Capture stdout from each tool                                │
│  • Record timing for each                                       │
│  • Note any failures/timeouts                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     CLAUDE SYNTHESIS                            │
│  1. Identify agreement points                                   │
│  2. Note unique contributions                                   │
│  3. Evaluate accuracy/quality                                   │
│  4. Create unified answer                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DISPLAY RESULTS                             │
│  • Synthesis box at top                                         │
│  • Agreement/difference summary                                 │
│  • Collapsible raw responses                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Timing

Typical quick mode execution:

| Phase | Duration |
|-------|----------|
| Parallel query | 2-5 seconds (depends on slowest tool) |
| Synthesis | Immediate |
| Total | 3-6 seconds |

## Synthesis Guidelines

Claude should:

1. **Lead with consensus**: Start with what all tools agree on
2. **Highlight unique value**: Note valuable points only one tool mentioned
3. **Address conflicts**: Briefly explain any disagreements
4. **Give verdict**: State Claude's assessment of the best approach

## Example Output

```
┌───────────────────────────────────────────────────────────┐
│  🤝 COUNCIL SYNTHESIS                                     │
│  Mode: quick | Tools: codex, gemini | Time: 4.2s          │
└───────────────────────────────────────────────────────────┘

For testing Node.js applications, **Jest** is the recommended choice.

**Agreement**: Both tools recommend Jest as the primary testing framework
for its zero-config setup, snapshot testing, and excellent TypeScript support.

**Codex adds**: Consider Vitest for newer projects using Vite, as it offers
faster execution with compatible APIs.

**Gemini adds**: For API testing specifically, pair Jest with Supertest
for comprehensive endpoint coverage.

**My assessment**: Start with Jest for its ecosystem maturity. Migrate to
Vitest later if you adopt Vite for builds.
```

## When to Switch to Thorough Mode

Consider using `--thorough` when:

- Quick mode shows significant disagreement
- The question involves architectural decisions
- You need deeper analysis
- Initial responses raise more questions
