---
name: historical-data-guide
description: >
  Use this skill when bulk-importing historical financial data across multiple months,
  running date-bounded Gmail searches for past billing periods, building per-month
  agent prompts for parallel processing, or working with the /import-historical command.
  Also use when computing Gmail after:/before: date bounds from a target month,
  handling cold-start month creation without --from-previous, or configuring autonomous
  CC transaction import (2-layer categorization: hard rules + exact history only).
---

# Historical Data Import Guide

Patterns and specifications for bulk-importing financial data across a date range.
Used by `/controle-financeiro:import-historical` to process N months in parallel.

## Key Differences from /new-month

| Aspect | /new-month | /import-historical |
|--------|-----------|-------------------|
| Months | 1 (current) | N (date range) |
| Interaction | Interactive | Fully automatic |
| Gmail search | `newer_than:45d` | `after:X before:Y` |
| Paid status | Ask user | All paid automatically |
| CC import | Optional, ask | Always, autonomous |
| Categorization | 4-layer | 2-layer (history + hard rules) |
| Download path | `data/contas-do-mes/` | `data/contas-do-mes/YYYY-MM/` |
| Unknown merchants | Fuzzy + Claude + web | Default to `outros` (cat 20) |

## Architecture

1. **Phase 1 (Sequential)**: Create months in chronological order (`--from-previous` needs prior month)
2. **Phase 2 (Parallel)**: Spawn one Task agent per month (batches of ~6)
3. **Phase 3 (Summary)**: Collect results, spot-check, report

## Date-Bounded Searches

For target month `YYYY-MM`:
```
after:YYYY/(MM-1)/15  before:YYYY/(MM+1)/01
```

This creates a ~45-day window centered on the billing month. Stale-bill validation filters false matches.

See `references/date-bounded-searches.md` for per-provider query templates and year boundary handling.

## Per-Month Agent Specification

Each spawned agent gets a self-contained prompt with target month, expense map, download path, and the complete flow for searching Gmail, extracting amounts, importing CC transactions, and marking paid.

See `references/per-month-agent-spec.md` for the full agent template.

## Autonomous CC Import (2-Layer Categorization)

In historical mode, CC transaction categorization is simplified:

1. **Hard rules** (deterministic, always applied first):
   - NuTag -> carro (2)
   - IOF / IOF Repasse -> tax_foreign (24)
   - Ajuste a credito / CANCELAMENTO -> reversal (27)

2. **Exact history match** (2+ occurrences in same category):
   - Run `merchant-history` once, reuse across all months
   - Merchant must appear 2+ times in one category

3. **Everything else** -> `outros` (cat 20)

No fuzzy matching, no Claude reasoning, no web search. Speed over precision for historical data.

## Cold-Start Handling

If the month immediately before the range doesn't exist in the DB:
- First month in range: create WITHOUT `--from-previous` (uses defaults: R$1518 prolaborio, 9% tax)
- All subsequent months: create WITH `--from-previous` (copies recurrents from prior month)

## Quick Reference

- Date bounds: `references/date-bounded-searches.md`
- Agent template: `references/per-month-agent-spec.md`
- Provider queries: `../gmail-bill-patterns/references/email-search-patterns.md`
- CC parsers: `../fatura-debug-guide/references/card-parsers.md`
- Currency parsing: `../gmail-bill-patterns/references/currency-parsing.md`
- Windows workarounds: `../fatura-debug-guide/references/windows-workarounds.md`
