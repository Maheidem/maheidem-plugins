# Thorough Mode Workflow

Thorough mode enables multi-round debate for complex decisions.

## When to Use Thorough Mode

- Architectural decisions (microservices vs monolith)
- Technology choices with trade-offs
- Design pattern selection
- Contentious or nuanced topics
- When quick mode shows significant disagreement

## Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                     ROUND 1: INITIAL                            │
│  Same as quick mode - parallel query, collect responses         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  CONVERGENCE CHECK                              │
│  Do all tools agree on key points?                              │
│  YES → Skip to final synthesis                                  │
│  NO  → Continue to Round 2                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ROUND 2: CROSS-EXAMINATION                    │
│                                                                 │
│  For each tool, ask:                                            │
│  "Tool A said X. Tool B said Y. Given this context,             │
│   reconsider your recommendation and address the differences."  │
│                                                                 │
│  Run in parallel again, collect new responses                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  CONVERGENCE CHECK                              │
│  • Are tools now agreeing?                                      │
│  • Are responses just repeating?                                │
│  • Have we hit max_rounds (default: 3)?                         │
│                                                                 │
│  CONVERGED or MAX_ROUNDS → Final synthesis                      │
│  NOT CONVERGED → Continue to Round N+1                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   FINAL SYNTHESIS                               │
│  • Summarize debate evolution                                   │
│  • State consensus (if reached)                                 │
│  • Document remaining disagreements                             │
│  • Provide Claude's verdict with reasoning                      │
└─────────────────────────────────────────────────────────────────┘
```

## Cross-Examination Prompts

### Round 2 Prompt Template
```
Original question: {QUESTION}

In round 1:
- Codex recommended: {CODEX_SUMMARY}
- Gemini recommended: {GEMINI_SUMMARY}

Given these differing perspectives, reconsider your recommendation.
Address the points raised by the other tool(s).
Have you changed your position? Why or why not?
```

### Round 3+ Prompt Template
```
We're in round {N} of discussion on: {QUESTION}

Previous rounds:
- Round 1: {SUMMARY}
- Round 2: {SUMMARY}
...

Current disagreement: {SPECIFIC_DISAGREEMENT}

Please address this specific point of contention.
```

## Convergence Detection

### Signals of Convergence
- Tools explicitly agree: "I agree with Codex that..."
- Same recommendation with different reasoning
- Acknowledgment of valid points from others

### Signals to Continue
- Direct contradiction: "Actually, X is better because..."
- New information introduced
- Conditional disagreement: "In some cases..."

### Signals to Stop (Without Convergence)
- Circular arguments
- No new information in responses
- "Agree to disagree" language
- Max rounds reached

## Timing

Typical thorough mode execution:

| Phase | Duration |
|-------|----------|
| Round 1 | 3-5 seconds |
| Convergence check | Immediate |
| Round 2 | 3-5 seconds |
| Round 3 (if needed) | 3-5 seconds |
| Final synthesis | Immediate |
| **Total** | **10-20 seconds** |

## Example Output

```
┌───────────────────────────────────────────────────────────┐
│  🤝 COUNCIL SYNTHESIS (Thorough Mode)                     │
│  Rounds: 3 | Tools: codex, gemini | Time: 14.7s           │
└───────────────────────────────────────────────────────────┘

## Debate Summary

**Round 1 - Initial Positions:**
- Codex: Recommended microservices for scalability
- Gemini: Recommended monolith-first for simplicity

**Round 2 - Cross-Examination:**
- Codex acknowledged: Small team makes microservices harder
- Gemini acknowledged: Future scaling concerns are valid

**Round 3 - Resolution:**
Both converged on: Modular monolith with clear boundaries

## Final Synthesis

Start with a **modular monolith** that enforces clear module boundaries.
This gives you monolith simplicity now with a clear migration path later.

Key practices:
1. Define module interfaces as if they were services
2. Use separate databases per module (schemas)
3. Set up observability as if distributed

**Consensus reached**: Both tools agree this approach balances current
needs with future scalability.

<details>
<summary>📜 Round 1: Codex</summary>
[Full response...]
</details>

<details>
<summary>📜 Round 1: Gemini</summary>
[Full response...]
</details>

<details>
<summary>📜 Round 2: Codex (reconsidered)</summary>
[Full response...]
</details>

...
```

## Configuration

In `~/.claude/council.local.md`:

```yaml
thorough_settings:
  max_rounds: 3           # Maximum debate rounds
  convergence_threshold: 0.8  # Future: similarity score for auto-detection
```
