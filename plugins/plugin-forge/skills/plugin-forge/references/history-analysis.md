# History Analysis Procedure

How to analyze Claude Code session history to discover patterns and forge plugins from findings.

## Overview

Two-tier analysis:
- **Tier 1** (Automated): Python script scans JSONL files for error/retry/correction/workflow patterns
- **Tier 2** (AI-assisted): Claude reads specific session excerpts and applies reflection-patterns.md categories

## Tier 1: Automated Scan

### Commands

```bash
# List all projects with session counts
python ${CLAUDE_PLUGIN_ROOT}/scripts/session_analyzer.py list-projects

# List sessions for a project (filter by name substring)
python ${CLAUDE_PLUGIN_ROOT}/scripts/session_analyzer.py list-sessions "<project-filter>"

# Full pattern scan (all projects or filtered)
python ${CLAUDE_PLUGIN_ROOT}/scripts/session_analyzer.py scan [--project X] [--after YYYY-MM-DD] [--before YYYY-MM-DD]

# Extract excerpts around patterns for Tier 2 analysis
python ${CLAUDE_PLUGIN_ROOT}/scripts/session_analyzer.py extract <session-id> <project-dir> [--context 3]
```

### Scan Output Interpretation

The `scan` command outputs JSON with these sections:

| Section | Contains | Use For |
|---------|----------|---------|
| `scan_metadata` | Timestamp, filters, counts | Confirming scope |
| `summary` | Top errors, tool failures, corrections | Quick overview |
| `per_project` | Breakdown per project | Identifying problem areas |
| `session_highlights` | Sessions ranked by score | Picking Tier 2 targets |

**Score formula**: errors×2 + retries×3 + corrections×4 + tool_failures×2 + workflows×1

Higher score = more patterns detected = more interesting for analysis.

### Pattern Detectors

| Pattern | How Detected | Significance |
|---------|-------------|--------------|
| Errors | `is_error: true` in tool_result, "Error:"/"Failed:" text | Something went wrong |
| Retries | Same tool called 2+ times in 5-message window, >60% input similarity | Struggled with approach |
| Corrections | User message with "no,", "don't", "instead", "wrong", "actually" after assistant | AI misunderstood intent |
| Tool failures | Non-zero exit codes, `is_error` in tool_result | Tool or environment issue |
| Successful workflows | 3+ consecutive successful tool calls | Reusable pattern |

## Tier 2: Deep-Dive Analysis

After Tier 1 identifies high-scoring sessions:

1. Run `extract` on the top session(s) to get message excerpts
2. Read the excerpts and classify each pattern using `references/reflection-patterns.md`:
   - Error → DON'T/BECAUSE/DO INSTEAD
   - Retry → BEST PRACTICE/AVOID/CONTEXT
   - Successful workflow → WORKFLOW/STEPS/USE WHEN
   - Edge case → WATCH OUT/WHEN/SYMPTOMS/HANDLE BY
3. Cross-reference findings against existing marketplace plugins (run marketplace_scanner.py)
4. Produce recommendations (see table below)

## Recommendation Categories

| Finding | Recommendation | Plugin Action |
|---------|---------------|---------------|
| Recurring error across sessions | New skill with prevention rules | Create skill with DON'T rules |
| Complex multi-step workflow | New command automating steps | Create command with workflow phases |
| Repeated corrections | Better trigger phrases/descriptions | Update existing skill description |
| Tool failures in specific context | Hook or validation script | Create hook or pre-check script |
| Successful workflow pattern | Reusable command template | Create command from workflow |
| Platform-specific edge case | Reference doc with WATCH OUT | Add to existing plugin references |

## Cross-Referencing Marketplace

Before recommending a new plugin, check if an existing one already covers the finding:

```bash
python ${CLAUDE_PLUGIN_ROOT}/scripts/marketplace_scanner.py "${MARKETPLACE_PATH}" check "<proposed-name>" "<finding-description>"
```

If overlap found:
- **Update existing plugin** rather than creating new
- Add the finding as a new reference doc or skill rule
- Bump the existing plugin version

## Integration with Forge Workflow

History analysis feeds into the standard Phase 2-6 pipeline:

1. User selects "Evaluate past conversations" in Phase 1
2. Phase 1.5 runs Tier 1 scan and optionally Tier 2 deep-dive
3. If user wants to forge from a finding → Phase 2 (Marketplace Setup) with pre-populated context
4. The finding's category determines plugin structure (skill, command, hook, reference)
5. Phases 3-6 proceed as normal

The key difference from "Reflect on this session" is that history analysis looks at ALL past sessions, not just the current one.
