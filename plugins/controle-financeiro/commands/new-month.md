---
allowed-tools: Bash(python:*), Read, Write, AskUserQuestion, mcp__gmail__search_emails, mcp__gmail__get_email, mcp__gmail__download_attachment, mcp__gmail__get_email_with_attachments, mcp__gmail__auth_status
argument-hint: [pj-total]
description: Create new month with Gmail-powered bill fetching, PJ income, expense auto-fill
---

# New Month Setup (Gmail-Powered)

Create the next month, fetch bills and income from Gmail, preview, confirm, then populate all expenses. Falls back to manual input when Gmail is unavailable.

**Requires**: CWD is the controle-financeiro project root.

> The `gmail-bill-patterns` skill provides provider search queries, extraction patterns,
> stale-bill detection, and currency parsing rules. It auto-triggers when using Gmail MCP tools.

---

## Phase 0: Prerequisites

### 0.1 Parse PJ Total Argument

If `$ARGUMENTS` contains a number, store as `husky_amount` (skip Husky Gmail search later).
- Brazilian `R$ 63.336,42` -> `63336.42`
- Plain number `63336.42` -> use directly

### 0.2 Check Gmail MCP Availability

Call `mcp__gmail__auth_status`.

- **Success**: Proceed with Gmail-powered flow.
- **Failure or tool unavailable**: Report "Gmail MCP not available. Running in manual mode." and jump to **Phase 3-Manual**.

---

## Phase 1: Create Month + Fetch from Gmail

### 1.1 Determine Target Month

Determine target month from **current calendar date** (not DB state):
- If today is between 1st-28th: target = current month (YYYY, MM)
- If today is 29th-31st: target = next month

```bash
python app/src/cli.py view-month {target_year} {target_month}
```

- **If month exists**: Ask user: "Mes {Month} {Year} ja existe. Recriar? [y/N]"
  - If yes: `python app/src/cli.py delete-month {target_year} {target_month} --yes` then proceed
  - If no: STOP
- **If month does not exist**: Proceed

### 1.1b Create the Month

```bash
python app/src/cli.py create-month {target_year} {target_month} --from-previous
```

This creates the month with explicit year/month and copies recurrent expenses with zeroed amounts.

**If this fails, STOP. Report the error and do not continue.**

### 1.2 Get Expense IDs

```bash
python app/src/cli.py list-expenses {year} {month}
```

Parse output to build `expense_map`: `{description_lowercase -> expense_id}`. These are the NEW expense IDs for the just-created month.

### 1.3 Fetch All 9 Providers from Gmail

**Execute all 9 Gmail searches in PARALLEL** (use parallel tool calls). Each provider is independent -- if one fails, continue with others.

Track results with status codes:
- `[OK]` = found and extracted successfully
- `[OK][STALE]` = found but billing month doesn't match target (e.g., Jan bill for Feb month). **Flag for user review.**
- `[??]` = not found in Gmail
- `[!!]` = found but extraction/download failed
- `[>>]` = manual input needed (no email provider)

**Stale bill detection**: For every provider, validate the billing month matches `target_month`. See the `gmail-bill-patterns` skill for per-provider validation patterns.

All Gmail searches use `newer_than:45d`.

#### Provider 1: Husky (PJ Income)

**Skip if** `husky_amount` provided via argument.

Query: `from:friends@husky.io subject:"Money is coming" newer_than:45d`

1. `mcp__gmail__search_emails` with query
2. If found: `mcp__gmail__get_email` -- **WARNING: response is ~62K, will be saved to file**
3. Parse the saved JSON file with a temp Python script to extract amount:
   ```python
   # Write to temp file, then run:
   import json, re
   data = json.load(open(SAVED_FILE, encoding='utf-8'))
   email = json.loads(data[0]['text'])
   body = email.get('body', '').replace('\xa0', ' ').replace('\u200b', ' ')
   # Try R$ prefix first
   matches = re.findall(r'R\$\s*([\d.,]+)', body)
   # Fallback: bare US-style amount
   if not matches:
       matches = re.findall(r'(\d{2,3},\d{3}\.\d{2})', body)
   ```
4. **Husky uses US-style currency**: `R$ 57,892.01` -> `float("57,892.01".replace(",", ""))` = `57892.01`
5. Store as `husky_amount`

#### Provider 2: Itau VISA (Samsung)

Query: `from:faturadigital@itau.com.br subject:"fatura digital" has:attachment newer_than:45d`

1. `mcp__gmail__search_emails`
2. If found: parse **snippet** for amount (`Valor da fatura:\s*R\$\s*([\d.,]+)`) and due date (`Data de vencimento:\s*(\d{2}/\d{2}/\d{4})`)
3. Validate due date month matches target month (stale bill detection)
4. `mcp__gmail__get_email` to get attachment metadata -- **WARNING: response is ~123K, will be saved to file**. Parse saved JSON file for attachment ID only.
5. `mcp__gmail__download_attachment` to download PDF to `data/contas-do-mes/`. **NEVER use `get_email_with_attachments`** (oversized).
6. Parse amount as Brazilian format. Store: `itau_amount`, `itau_pdf_path`

#### Provider 3: Nubank

Query: `from:todomundo@nubank.com.br subject:"fatura fechou" has:attachment newer_than:45d`

1. `mcp__gmail__search_emails`
2. If found: `mcp__gmail__get_email` -- **WARNING: response is ~84K, will be saved to file**. Parse saved JSON file for attachment ID only. **NEVER use `get_email_with_attachments`** (oversized).
3. `mcp__gmail__download_attachment` to download PDF to `data/contas-do-mes/`
4. Amount NOT in snippet -- extract from PDF: `fatura no valor de R\$\s*([\d.,]+)`
5. Due date from PDF filename: `Nubank_YYYY-MM-DD.pdf`
6. Store: `nubank_amount`, `nubank_pdf_path`

#### Provider 4: BradesCard (Amazon)

Query: `from:faturabradescard@infobradesco.com.br subject:"Fatura por E-Mail BradesCard" has:attachment newer_than:45d`

1. `mcp__gmail__search_emails`
2. If found: `mcp__gmail__get_email` to read body for billing period (`Essa e a fatura de (\w+)\s*/\s*(\d{4})`)
3. `mcp__gmail__download_attachment` -- rename from `FATURA MENSAL.pdf` to `BradesCard_YYYY-MM.pdf`
4. PDF is **password-protected**. Extract using pdfplumber (tries `"124198"` first -- 6-digit CPF prefix)
5. Bill total: `\(=\)\s*Total\s*R\$\s*([\d.,]+)`
6. Store: `amazon_amount`, `amazon_pdf_path`

#### Provider 5: Enel (Luz)

Query: `from:faturaporemail@riodejaneiro.enel.com subject:"Sua Fatura Enel chegou" 8495510 newer_than:45d`

1. `mcp__gmail__search_emails` (query includes `8495510` to filter at Gmail level)
2. Results should be pre-filtered to UC 8495510. Double-check snippet as safety net. Ignore UC 8404007, 1570705, 7820994.
3. If correct UC found: `mcp__gmail__get_email` -> parse body for amount (`R\$\s*([\d.,]+)`) and due date
4. No PDF attachment. Store: `enel_amount`

#### Provider 6: Naturgy (Gas)

Query: `from:conta.inteligente@naturgy.com subject:CONTA subject:CHEGOU newer_than:45d`

1. `mcp__gmail__search_emails`
2. If found: `mcp__gmail__get_email` -> parse **body** for amount: `Valor\s+R\$\s*([\d.,]+)` (body has structured table with N. Cliente / Mes / Vencimento / Valor)
3. Parse due date from body: `Vencimento\s+(\d{2}/\d{2}/\d{4})`
4. Validate billing month from body table matches target month
5. **No PDF download needed** -- body has all billing data. Only download PDF as fallback if body parsing fails (filter attachments to `Fatura_*` filename pattern)
6. Store: `naturgy_amount`

#### Provider 7: Claro

Query: `from:faturadigital@minhaclaro.com.br subject:"Fatura Digital Claro" has:attachment newer_than:45d`

1. `mcp__gmail__search_emails`
2. If found: parse snippet for due date (`vencimento em (\d{2}/\d{2}/\d{4})`)
3. `mcp__gmail__get_email` to read `body_html` -- **amount is in HTML body, not PDF**
4. Parse `body_html` for amount: `Total a pagar.*?R\$\s*([\d.,]+)` (use `re.DOTALL`). The `body` field says "formato texto" and is useless -- always use `body_html`.
5. Only download PDF attachment via `download_attachment` if user wants detailed import later (Phase 4.3)
6. Store: `claro_amount`

#### Provider 8: C-Com (Internet)

Query: `from:nao-responda@nao-responda.ccomtelecom.com.br subject:"Lembrete de Pagamento" has:attachment newer_than:45d`

1. `mcp__gmail__search_emails`
2. If found: parse **snippet** for both amount and due date: `vencimento em (\d{2}/\d{2}/\d{4}),\s*no valor de R\$\s*([\d.,]+)`
3. Store: `ccom_amount`

#### Provider 9: Condominio GARIN

Query: `from:immobileweb@sistemas.alterdata.com.br subject:GARIN has:attachment newer_than:45d`

1. `mcp__gmail__search_emails`
2. If found: `mcp__gmail__get_email` to get attachment metadata
3. **WARNING (Windows)**: Attachment filenames contain `:` and `/` (e.g., `Ref. :02/2026`) which CRASH on Windows. Use `mcp__gmail__download_attachment` with safe filename: `GARIN_YYYY-MM.pdf`
4. Parse billing month from attachment filename: `Ref\.\s*:(\d{2})/(\d{4})` -> validate matches target month
5. Extract amount from PDF: `Valor do Documento\s*([\d.,]+)` (no R$ prefix!)
6. Store: `garin_amount`, `garin_pdf_path`

---

## Phase 2: Assemble Preview

### 2.1 Provider-to-Expense Mapping

| Provider | DB Expense Description | Match Key |
|----------|----------------------|-----------|
| Itau VISA | `Itau` | "itau" |
| Nubank | `Nubank` | "nubank" |
| BradesCard | `Amazon` | "amazon" |
| Enel | `Luz (debito automatico)` | "luz" |
| Naturgy | `Gas` | "gas" |
| Claro | `Claro` | "claro" |
| C-Com | `CCom` | "ccom" |
| GARIN | `Condominio` | "condominio" |

Match each provider to its expense ID using case-insensitive partial match on the key against expense descriptions from Phase 1.2.

### 2.2 Calculate PJ Preview

If `husky_amount` available:
- `pj_tax = husky_amount * 0.09`
- `pj_prolaborio = 1518.00`
- `pj_lucro_presumido = husky_amount - pj_tax - pj_prolaborio`

### 2.3 Display Preview

Format all values as `R$ 1.234,56`. Show:

```
============================================================
  SETUP MES: {Month Name} {Year}
============================================================

  RENDA PJ (Husky)
  --------------------------------------------------
    Faturamento PJ:          R$ XX.XXX,XX  [status]
    Imposto (9%):            R$ X.XXX,XX
    Prolaborio:              R$ 1.518,00
    Lucro Presumido:         R$ XX.XXX,XX

  CARTOES DE CREDITO
  --------------------------------------------------
    Itau:                    R$ X.XXX,XX   [status]
    Nubank:                  R$ X.XXX,XX   [status]
    Amazon:                  R$ X.XXX,XX   [status]

  CONTAS
  --------------------------------------------------
    Luz:                     R$ XXX,XX     [status]
    Gas:                     R$ XXX,XX     [status]
    Claro:                   R$ XXX,XX     [status]
    CCom:                    R$ XXX,XX     [status]
    Condominio:              R$ X.XXX,XX   [status]

  SEM EMAIL (entrada manual necessaria)
  --------------------------------------------------
    Financiamento:           R$ 0,00       [>>]
    Quentinha:               R$ 0,00       [>>]

  RESUMO
  --------------------------------------------------
    Total Renda (PJ liq.):   R$ XX.XXX,XX
    Total Despesas:          R$ XX.XXX,XX
    Saldo Estimado:          R$ XX.XXX,XX
============================================================
```

Where `[status]` is: `[OK]`, `[OK][STALE]`, `[??]`, `[!!]`, `[>>]`

Each provider line should include email date: `[OK] (email: 03/02/2026)` or `[OK][STALE] (email: 05/01/2026)`

---

## Phase 3: Confirm and Fill Gaps

### 3.1 Confirm

Ask: "Confirmar valores e prosseguir? [Y/n/edit]"

- `Y`, `y`, `sim`, Enter -> Proceed to Phase 3.2
- `n`, `nao` -> Run `python app/src/cli.py delete-month {year} {month} --yes` to clean up, then STOP
- `edit` -> Ask which item to change, accept new values, redisplay preview

### 3.2 Fill Missing and Stale Providers

For each provider marked `[OK][STALE]`, ask:
- "{expense name} valor R$ {amount} e de {old_month}. Usar mesmo valor, informar novo, ou pular? [usar/novo/pular]"
- `usar` -> keep the stale amount
- `novo` -> ask for new amount
- `pular` -> set to 0

For each provider marked `[??]` or `[!!]`, ask:
- "Valor de {expense name}? (R$) [Enter para pular]"

Handle responses:
- `R$ 1.234,56` -> parse to `1234.56`
- `mesmo`, `igual`, `same` -> look up last month's value
- `nao acontece mais`, `cancelar`, `remover` -> mark for deletion
- `0` or blank/Enter -> skip (keep at 0)
- Positive number -> use that value

### 3.3 Fill Unmatched Expenses

For recurrent expenses with no provider match (Financiamento, Quentinha, etc.), ask one by one:
- "Valor de {expense name}? (R$) [Enter para pular]"

Same response handling as above.

### 3.4 Get Husky Amount if Missing

If `husky_amount` still unavailable: Ask "Qual o faturamento PJ deste mes? (R$)"

---

## Phase 3-Manual: Manual Fallback

**Only when Gmail MCP is unavailable (Phase 0.2 failed).**

1. Determine target month from current calendar date (same logic as Phase 1.1)
2. Run `python app/src/cli.py create-month {target_year} {target_month} --from-previous` to create month
3. Run `python app/src/cli.py list-expenses {year} {month}` to get expense IDs
4. Get PJ income: use `$ARGUMENTS` if provided, otherwise ask user
5. Check `data/contas-do-mes/` for unprocessed PDFs (Itau/Nubank patterns), extract totals if found
6. Ask user for each expense amount one by one
7. Continue to Phase 4

---

## Phase 4: Apply Values

All CLI edits use the expense IDs from Phase 1.2 (or Phase 3-Manual step 3).

### 4.1 Set PJ Income

```bash
python app/src/cli.py edit-month {year} {month} --pj-total {husky_amount}
```

### 4.2 Set Expense Amounts

For each provider with an extracted or user-provided amount, match to expense by description:

```bash
python app/src/cli.py edit-expense {id} --amount {amount}
```

Order: Itau("itau") -> Nubank("nubank") -> Amazon("amazon") -> Luz("luz") -> Gas("gas") -> Claro("claro") -> CCom("ccom") -> Condominio("condominio") -> then user-provided amounts for unmatched expenses.

For expenses marked for deletion:
```bash
python app/src/cli.py delete-expense {id}
```

### 4.3 Optional: Import CC Transaction Details

For each CC PDF downloaded (Itau, Nubank, BradesCard), offer:
- "Importar transacoes detalhadas do PDF {filename}? [Y/n]"
- If confirmed: run the `/controle-financeiro:import-fatura` pipeline for that PDF
- If declined: skip (expense amount already set)

---

## Phase 5: Paid Status and Summary

### 5.1 List Current Expenses

```bash
python app/src/cli.py list-expenses {year} {month}
```

### 5.2 Mark Paid Status

Batch up to 4 expenses per question:

"Despesas pagas/agendadas?"
```
1. Itau (R$ 9.281,51)
2. Nubank (R$ 2.920,83)
3. Amazon (R$ 399,51)
4. Financiamento (R$ 4.000,00)
```
"Quais foram pagas? (numeros separados por espaco, 'todos', ou 'nenhum')"

- `tudo pago`, `todas pagas`, `todos` -> `mark-paid` all IDs
- `nenhum` -> skip, all stay pending
- Specific numbers `1 2 3` -> mark those paid

```bash
python app/src/cli.py mark-paid {id1} {id2} ...
```

### 5.3 Show Final Summary

```bash
python app/src/cli.py view-month {year} {month}
python app/src/cli.py category-report {year} {month}
```

Report transfer amounts:
- **Prolaborio**: R$ {value} (transfer to PF)
- **Lucro Presumido**: R$ {value} (transfer to PF)

---

## Error Handling

**Critical (STOP workflow):**
- `create-month` fails -> STOP, report error
- Database connection failure -> STOP

**Non-critical (continue with others):**
- Individual Gmail search returns no results -> mark `[??]`, continue
- PDF download/extraction fails -> mark `[!!]`, ask user for amount
- BradesCard password fails -> ask user for password or mark `[!!]`
- `edit-expense` fails for one item -> report, continue with remaining
- `mark-paid` fails for one expense -> report, continue with remaining

Error format: `[ERROR] Phase X.Y - {provider}: {message}`

---

## CLI Commands Reference

```bash
python app/src/cli.py create-month {year} {month} --from-previous
python app/src/cli.py list-expenses 2026 2
python app/src/cli.py edit-month 2026 2 --pj-total 57892.01
python app/src/cli.py edit-expense 42 --amount 9281.51
python app/src/cli.py delete-expense 42
python app/src/cli.py delete-month 2026 2 --yes
python app/src/cli.py mark-paid 42 43 44
python app/src/cli.py view-month 2026 2
python app/src/cli.py category-report 2026 2
```

## Examples

```
/controle-financeiro:new-month
-> Creates month, searches Gmail for 9 providers, shows preview, confirms,
   fills expenses, asks paid status, shows summary

/controle-financeiro:new-month 57892.01
-> Same but skips Husky search, uses provided PJ total
```

## Important Notes

- Target month determined from calendar date, NOT `--next` flag (avoids wrong-month bug)
- Month is created FIRST (Phase 1.1b), before Gmail fetch -- expense IDs needed for mapping
- If user aborts at confirmation, `delete-month --yes` cleans up
- All expenses start UNPAID after `--from-previous`
- PJ defaults: 9% tax, R$1518 prolaborio
- CC bills (Itau, Nubank, Amazon) are regular EXPENSES, not `credit_card_bill` records
- `credit_card_bill` table only populated during optional detailed import (Phase 4.3)
- BradesCard PDF always named `FATURA MENSAL.pdf` -- must rename
- Enel: ONLY process UC 8495510
- Paid status asked AFTER all amounts set (accurate totals)
- Show prolaborio and lucro_presumido transfers clearly in final summary
- If Gmail unavailable, falls back to manual mode (Phase 3-Manual)
- **Oversized `get_email` responses**: Husky (~62K), Itau (~123K), Nubank (~84K) exceed MCP token limits and get saved to temp files. Parse these files with Python scripts, NOT inline. Never use `get_email_with_attachments` for these providers.
- **CRITICAL (Windows)**: ALL Python extraction scripts MUST be written to a temp `.py` file first, then executed with `python /path/to/script.py`. NEVER use inline `python -c` for multi-line scripts.
- **Attachment ID extraction**: When parsing saved JSON files for attachment IDs, ALWAYS print/use the FULL attachment ID string. Never truncate.
- **STALE bill handling**: For `[OK][STALE]` providers, include the stale amount in the preview BUT highlight clearly. In Phase 3, explicitly ask user.
