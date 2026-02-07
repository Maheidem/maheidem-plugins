---
allowed-tools: Bash(python:*), Read, Write, Task, mcp__gmail__search_emails, mcp__gmail__get_email, mcp__gmail__download_attachment, mcp__gmail__auth_status
argument-hint: <from_year> <from_month> <to_year> <to_month>
description: Bulk import historical months from Gmail with parallel agents per month
---

# Historical Data Import (Parallel Agents)

Bulk-import financial data for a date range. Creates months sequentially, then spawns one parallel Task agent per month to fetch Gmail data, extract amounts, import CC transactions, and mark all paid.

**Requires**: CWD is the controle-financeiro project root.

> The `historical-data-guide` skill provides date-bounded search patterns, per-month agent specs,
> and autonomous CC import rules. It auto-triggers when working with historical imports.

---

## Phase 0: Parse Arguments and Validate

### 0.1 Parse Arguments

Parse `$ARGUMENTS` as: `from_year from_month to_year to_month`

Examples:
- `2025 3 2025 12` -> March 2025 to December 2025
- `2025 1 2025 1` -> January 2025 only

If arguments are missing or invalid, ask the user:
- "Periodo de importacao? (ano_inicio mes_inicio ano_fim mes_fim)"

### 0.2 Validate Range

- `from_year/from_month` must be <= `to_year/to_month`
- Range must not extend into the future (compare against current date)
- Calculate total months in range

### 0.3 Check Gmail MCP

```
mcp__gmail__auth_status
```

If authentication fails: STOP with "Gmail MCP nao disponivel. Corrija autenticacao primeiro."

### 0.4 Confirm with User

Display:
```
============================================================
  IMPORTACAO HISTORICA
============================================================
  Periodo:    {from_month_name} {from_year} -> {to_month_name} {to_year}
  Total:      {N} meses
  Modo:       Automatico (sem confirmacoes)
  CC Import:  Sim (2-layer categorization)
  Paid:       Todos marcados como pagos
============================================================

Meses existentes serao RECRIADOS (dados atuais perdidos).
Continuar? [y/N]
```

If user declines: STOP.

---

## Phase 1: Sequential Month Setup

Months MUST be created in chronological order because `--from-previous` requires the immediately prior month to exist.

### 1.1 Check Cold Start

Check if the month immediately BEFORE the range exists:
```bash
python app/src/cli.py view-month {prev_year} {prev_month}
```

- If exists: all months can use `--from-previous`
- If doesn't exist: first month uses bare `create-month` (no `--from-previous`)

### 1.2 Create Each Month (Sequential Loop)

For each month in chronological order (`from` -> `to`):

**1.2a Delete if exists:**
```bash
python app/src/cli.py delete-month {year} {month} --yes
```
(Ignore errors if month doesn't exist)

**1.2b Create month:**
```bash
# First month (if cold start):
python app/src/cli.py create-month {year} {month}

# All other months:
python app/src/cli.py create-month {year} {month} --from-previous
```

If `create-month` fails: STOP entire workflow. Report error.

**1.2c Get expense map:**
```bash
python app/src/cli.py list-expenses {year} {month}
```

Parse output to build: `expense_map = {description_lowercase: expense_id}`

**1.2d Create download directory:**
```bash
mkdir -p data/contas-do-mes/{YYYY-MM}/
```

**1.2e Store month data:**
```python
months_data[f"{year}-{month:02d}"] = {
    "year": year,
    "month": month,
    "expense_map": expense_map,
    "download_dir": f"data/contas-do-mes/{year}-{month:02d}/",
    "is_cold_start": is_cold_start  # True only for first month if no prior exists
}
```

### 1.3 Load Merchant History (Once)

```bash
python app/src/cli.py merchant-history
```

Parse and store the full merchant-to-category history. This will be passed to each agent for CC categorization.

### 1.4 Load Category List (Once)

```bash
python app/src/cli.py list-categories --type expense
```

Store category IDs and names for agent prompts.

---

## Phase 2: Parallel Agent Spawning

### 2.1 Compute Date Bounds

For each month, calculate Gmail date bounds:

```python
def get_date_bounds(year, month):
    if month == 1:
        after = f"after:{year-1}/12/15"
    else:
        after = f"after:{year}/{month-1:02d}/15"
    if month == 12:
        before = f"before:{year+1}/01/01"
    else:
        before = f"before:{year}/{month+1:02d}/01"
    return after, before
```

### 2.2 Build Agent Prompts

For each month, build a self-contained prompt following the template in `per-month-agent-spec.md`. Include:

1. Target year, month, month name (Portuguese)
2. Download directory path
3. Expense map JSON
4. Date bounds (after/before strings)
5. Merchant history (for CC categorization)
6. Category list
7. The complete 7-step flow from the agent spec

### 2.3 Spawn Agents in Batches

Spawn `general-purpose` Task agents in batches of up to 6 concurrent agents. Each agent runs in the background.

```
For each batch of ~6 months:
    Spawn all agents in parallel using Task tool (run_in_background=true)
    Wait for all to complete
    Collect results
    Proceed to next batch
```

**Agent spawn parameters:**
- `subagent_type`: `general-purpose`
- `mode`: `bypassPermissions` (fully automatic, no confirmations)
- `run_in_background`: `true`
- `name`: `month-{YYYY-MM}` (for identification)

**CRITICAL**: The agent prompt MUST include:
- All 9 provider queries with date bounds already substituted
- The expense_map JSON with actual expense IDs
- The download directory path
- The merchant history for categorization
- Windows safety reminders (no multiline python -c, safe GARIN filename)
- Instruction to NEVER stop on individual provider failure

### 2.4 Monitor Progress

After spawning each batch, periodically check agent output files. Log progress:
```
[month-2025-03] Processing...
[month-2025-04] Processing...
[month-2025-03] DONE - 8/9 providers OK, 1 CC import
[month-2025-04] DONE - 9/9 providers OK, 3 CC imports
```

---

## Phase 3: Summary and Verification

### 3.1 Collect Results

After all agents complete, aggregate their reports.

### 3.2 Run list-months

```bash
python app/src/cli.py list-months
```

Verify all months in range appear in the output.

### 3.3 Spot-Check

Pick 3 months (first, middle, last of range) and run:
```bash
python app/src/cli.py view-month {year} {month}
python app/src/cli.py cc-bills {year} {month}
```

Display results for user review.

### 3.4 Consolidated Report

```
============================================================
  IMPORTACAO HISTORICA - RESULTADO
============================================================
  Periodo:    {from_month_name} {from_year} -> {to_month_name} {to_year}
  Total:      {N} meses processados

  POR MES:
  ----------------------------------------------------------
  Mes          PJ Income  Expenses  CC Trans  Status
  Mar 2025     R$ 55.000  8/8       120       [OK]
  Abr 2025     R$ 57.892  8/8       135       [OK]
  Mai 2025     R$ 0       6/8       98        [!!] 2 falhas
  ...

  PROVIDER SUCCESS RATES:
  ----------------------------------------------------------
  Husky:       10/10 (100%)
  Itau:        10/10 (100%)
  Nubank:       9/10 (90%)
  BradesCard:  10/10 (100%)
  Enel:        10/10 (100%)
  Naturgy:      8/10 (80%)
  Claro:       10/10 (100%)
  C-Com:       10/10 (100%)
  GARIN:        7/10 (70%)

  CC TRANSACTIONS IMPORTED:
  ----------------------------------------------------------
  Itau VISA:     650 transactions across 10 months
  Nubank:        420 transactions across 9 months
  BradesCard:    140 transactions across 10 months

  ERRORS:
  ----------------------------------------------------------
  Mai 2025: Naturgy [??] no email found
  Mai 2025: GARIN [!!] PDF extraction failed
  ...
============================================================
```

---

## Error Handling

### Phase 1 Errors (STOP)
- `create-month` fails -> STOP entire workflow, report error
- Database connection failure -> STOP
- Gmail auth failure -> STOP

### Phase 2 Errors (Per-Agent, Continue)
- Individual provider not found -> `[??]`, leave amount at 0
- Provider extraction fails -> `[!!]`, leave amount at 0
- CC import fails -> log error, expense amount already set
- Stale bill detected -> `[STALE]`, skip that provider
- SQLite timeout -> retry once, then log error

### Phase 3 Errors (Report Only)
- Spot-check shows missing data -> report in summary
- Provider success rate < 50% -> flag in summary

---

## CLI Commands Reference

```bash
# Month management
python app/src/cli.py create-month {year} {month}
python app/src/cli.py create-month {year} {month} --from-previous
python app/src/cli.py delete-month {year} {month} --yes
python app/src/cli.py view-month {year} {month}
python app/src/cli.py list-months

# Expenses
python app/src/cli.py list-expenses {year} {month}
python app/src/cli.py edit-expense {id} --amount {amount}
python app/src/cli.py add-expense {year} {month} --description "{name}" --amount {amount} --category {cat_id}
python app/src/cli.py delete-expense {id}
python app/src/cli.py mark-paid {id1} {id2} ...

# PJ income
python app/src/cli.py edit-month {year} {month} --pj-total {amount}

# CC bills
python app/src/cli.py cc-bills {year} {month}
python app/src/cli.py cc-details {bill_id}

# Reference data
python app/src/cli.py list-categories --type expense
python app/src/cli.py merchant-history
python app/src/cli.py category-report {year} {month}
```

---

## Portuguese Month Names

```python
MONTH_NAMES = {
    1: "Janeiro", 2: "Fevereiro", 3: "Marco", 4: "Abril",
    5: "Maio", 6: "Junho", 7: "Julho", 8: "Agosto",
    9: "Setembro", 10: "Outubro", 11: "Novembro", 12: "Dezembro"
}
```

---

## Examples

```
/controle-financeiro:import-historical 2025 3 2025 12
-> Creates Mar-Dec 2025 (10 months), spawns 10 agents,
   fetches all Gmail data, imports CC transactions, marks paid

/controle-financeiro:import-historical 2025 1 2025 1
-> Single month import (January 2025 only)

/controle-financeiro:import-historical 2024 6 2025 5
-> 12-month range spanning year boundary
```

## Important Notes

- Months are DELETED and RECREATED. All existing data for months in range is lost.
- `--from-previous` requires sequential creation. Phase 1 is always sequential.
- Each agent downloads to a unique `data/contas-do-mes/YYYY-MM/` directory to avoid file collisions.
- Merchant history is loaded ONCE and shared across all agents (read-only).
- SQLite handles concurrent reads well. CLI calls from different agents write to different month_ids, so no row-level conflicts. Default 5s busy timeout handles brief locks.
- All expenses marked paid automatically (historical data = already paid).
- CC categorization uses 2-layer only (hard rules + exact history). Unknown merchants default to `outros` (cat 20).
- **Windows**: All Python scripts written to temp files. No multiline `python -c`. GARIN filenames sanitized. Paths quoted.
