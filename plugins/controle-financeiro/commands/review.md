---
allowed-tools: Bash(python:*), Read
argument-hint: [year] [month]
description: Review month summary - income, expenses, balance
---

# Monthly Review

Display comprehensive summary of a month's financial status.

**Requires**: CWD is the controle-financeiro project root.

## Workflow

1. **Determine Month**:
   - If `$ARGUMENTS` contains year and month, use those
   - Otherwise, run `list-months --limit 1` to get the latest month

2. **Show Summary**: Run `view-month <year> <month>` to display:
   - Income (PJ, salary, spouse)
   - PJ calculation breakdown
   - Expenses with paid/pending status
   - Credit card bills with paid/pending status
   - Balance

3. **Show Category Breakdown**: Run `category-report <year> <month>` to display spending by category

4. **Payment Status Summary**: Report how many items are paid vs pending

## CLI Commands Reference

```bash
# Get latest month
python app/src/cli.py list-months --limit 1

# View month summary
python app/src/cli.py view-month 2026 2

# Category breakdown
python app/src/cli.py category-report 2026 2
```

## Examples

```
/controle-financeiro:review
→ Shows latest month summary and category breakdown

/controle-financeiro:review 2026 1
→ Shows January 2026 summary and category breakdown
```

## Output Format

Present the information clearly:
- Total income vs total expenses
- Net balance (positive/negative)
- Payment progress (X of Y expenses paid)
- Top spending categories

## Important

- This is a READ-ONLY command - no modifications
