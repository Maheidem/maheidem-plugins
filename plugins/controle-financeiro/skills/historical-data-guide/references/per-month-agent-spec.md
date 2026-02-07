# Per-Month Agent Specification

Template for autonomous agents spawned by `/controle-financeiro:import-historical`.
Each agent processes exactly ONE month: fetches Gmail data, extracts amounts, imports CC transactions, marks all paid.

---

## Agent Prompt Template

The orchestrator populates these variables and passes the full prompt to a `general-purpose` Task agent:

```
TARGET_YEAR       = {year}
TARGET_MONTH      = {month}
TARGET_MONTH_NAME = {month_name}  (Portuguese: Janeiro, Fevereiro, ...)
DOWNLOAD_DIR      = data/contas-do-mes/{YYYY-MM}/
EXPENSE_MAP       = {expense_map_json}   ({"description_lower": expense_id, ...})
MONTH_ID          = {month_id}           (from DB, needed for CC bill creation)
DATE_AFTER        = {after_str}          (e.g., "after:2025/02/15")
DATE_BEFORE       = {before_str}         (e.g., "before:2025/04/01")
```

---

## Agent Flow (7 Steps)

### Step 1: Search All 9 Providers

Execute all 9 Gmail searches in PARALLEL. Use date-bounded queries from `date-bounded-searches.md`.

For each provider, track status:
- `[OK]` = found, validated, amount extracted
- `[??]` = not found in Gmail for this date window
- `[!!]` = found but extraction failed
- `[STALE]` = found but billing month doesn't match target -- SKIP

### Step 2: Extract Amounts

For each provider found, extract amounts using the patterns below:

| Provider | Source | Amount Regex | Currency |
|----------|--------|-------------|----------|
| Husky | body (normalize whitespace) | `R\$\s*([\d.,]+)` | US-style |
| Itau | snippet | `Valor da fatura:\s*R\$\s*([\d.,]+)` | Brazilian |
| Nubank | PDF text | `fatura no valor de R\$\s*([\d.,]+)` | Brazilian |
| BradesCard | PDF text (pw: `124198`) | `\(=\)\s*Total\s*R\$\s*([\d.,]+)` | Brazilian |
| Enel | body | `R\$\s*([\d.,]+)` | Brazilian |
| Naturgy | body | `Valor\s+R\$\s*([\d.,]+)` | Brazilian |
| Claro | body_html | `Total a pagar.*?R\$\s*([\d.,]+)` | Brazilian |
| C-Com | snippet | `no valor de R\$\s*([\d.,]+)` | Brazilian |
| GARIN | PDF text | `Valor do Documento\s*([\d.,]+)` | Brazilian (no R$) |

**Currency parsing:**
- Brazilian: `float(s.replace(".", "").replace(",", "."))`
- US-style (Husky only): `float(s.replace(",", ""))`

### Step 3: Download CC PDFs

Download PDFs for CC providers (Itau, Nubank, BradesCard) to `{DOWNLOAD_DIR}`:

| Card | Filename Convention | Notes |
|------|-------------------|-------|
| Itau | Keep original `Fatura_VISA_*.pdf` | `get_email` -> parse saved file for attachment ID -> `download_attachment` |
| Nubank | Keep original `Nubank_*.pdf` | `get_email` -> parse saved file for attachment ID -> `download_attachment` |
| BradesCard | Rename to `BradesCard_{YYYY-MM}.pdf` | `download_attachment` with safe name |
| GARIN | Rename to `GARIN_{YYYY-MM}.pdf` | CRITICAL: original filename has `:` and `/` |
| Claro | Rename to `Claro_{YYYY-MM}.pdf` | Optional, for records |

**Oversized email handling**: Itau (~123K), Nubank (~84K), Husky (~62K) responses get saved to temp files. Parse with:
```python
import json
data = json.load(open(SAVED_FILE, encoding='utf-8'))
email = json.loads(data[0]['text'])
# Use email['body'], email['attachments'], etc.
```

### Step 4: Apply Values via CLI

**4a. Set PJ income (if Husky found):**
```bash
python app/src/cli.py edit-month {YEAR} {MONTH} --pj-total {husky_amount}
```

**4b. Set expense amounts:**
For each provider with an amount, match to expense via EXPENSE_MAP:

| Provider | Expense Key | Match In |
|----------|------------|----------|
| Itau | "itau" | expense description |
| Nubank | "nubank" | expense description |
| BradesCard | "amazon" | expense description |
| Enel | "luz" | expense description |
| Naturgy | "gas" | expense description |
| Claro | "claro" | expense description |
| C-Com | "ccom" | expense description |
| GARIN | "condominio" | expense description |

```bash
python app/src/cli.py edit-expense {expense_id} --amount {amount}
```

If a provider has no matching expense in EXPENSE_MAP and has a valid amount, use `add-expense`:
```bash
python app/src/cli.py add-expense {YEAR} {MONTH} --description "{name}" --amount {amount} --category {cat_id}
```

### Step 5: Import CC Transactions (Autonomous Mode)

For each CC PDF downloaded, run the simplified import pipeline:

**5a. Extract text with pdfplumber:**
Write a temp Python script (NEVER use multiline `python -c` on Windows):

```python
import pdfplumber, json, sys

pdf_path = sys.argv[1]
password = sys.argv[2] if len(sys.argv) > 2 else None

with pdfplumber.open(pdf_path, password=password) as pdf:
    text = "\n".join(p.extract_text() or "" for p in pdf.pages)

print(text)
```

Passwords: BradesCard = `124198`, Itau = `12419`, Nubank = none.

**5b. Detect card type:**
```
1. "BRADESCARD" or "5373" -> Amazon Prime (account_id=2)
2. "ITAU" or "4101" -> Itau VISA (account_id=3)
3. "NUBANK" or "NU PAGAMENTOS" -> Nubank (account_id=1)
```
ALWAYS check BradesCard FIRST (its PDF contains "AMAZON" which would misdetect).

**5c. Parse transactions (card-specific):**

- **Nubank**: Regex `^(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(.+?)\s+([-\u2212]?)R\$\s*([\d.,]+)$` per line. Start after "TRANSACOES DE", stop at "Pagamentos".
- **BradesCard**: Regex `^(\d{2}/\d{2})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})([-]?)$`. Start after "MARCOS HEIDEMANN" + "5373", stop at "Resumo dos encargos".
- **Itau VISA**: Two-column merged layout. Manual extraction needed -- parse each line, extract date/description/amount. Skip "PAGAMENTO DEB AUTOMATIC", "Total dos" lines.

**5d. Auto-categorize (2-layer only):**

1. **Hard rules** (always first):
   - "NuTag" or "Transacao de NuTag" -> `carro` (cat 2)
   - "IOF" or "IOF Repasse" or "Repasse de IOF" -> `tax_foreign` (cat 24)
   - "Ajuste a credito" -> `reversal` (cat 27)
   - "CANCELAMENTO DE COMPRA" -> `reversal` (cat 27)

2. **Exact history match**: Run `python app/src/cli.py merchant-history` once at start. If merchant has 2+ occurrences in one category, use that category.

3. **Everything else** -> `outros` (cat 20). NO fuzzy match, NO web search, NO Claude reasoning in autonomous mode.

**5e. Create CC bill + insert transactions:**
Write a temp Python script:

```python
import sys, json
sys.path.insert(0, "app/src")
from repository import Repository
from models import CreditCardBill

repo = Repository()
month = repo.get_month(YEAR, MONTH)

# Check existing bill
existing = repo.get_cc_bills_for_month(month.id)
bill_id = None
for bill, name in existing:
    if bill.account_id == ACCOUNT_ID:
        bill.total_amount = TOTAL
        bill.due_date = DUE_DATE
        repo.update_cc_bill(bill)
        bill_id = bill.id
        with repo.get_connection() as conn:
            conn.cursor().execute("DELETE FROM transaction_detail WHERE credit_card_bill_id = ?", (bill_id,))
        break

if not bill_id:
    bill = CreditCardBill(month_id=month.id, account_id=ACCOUNT_ID,
                          total_amount=TOTAL, due_date=DUE_DATE, is_paid=False)
    bill_id = repo.add_cc_bill(bill)

# Insert transactions
with repo.get_connection() as conn:
    cur = conn.cursor()
    for t in transactions:
        cur.execute("""INSERT INTO transaction_detail
            (credit_card_bill_id, category_id, transaction_date, description, amount, installment_info)
            VALUES (?, ?, ?, ?, ?, ?)""",
            (bill_id, t['cat_id'], t['date'], t['desc'], t['amount'], t.get('installment')))
```

**5f. Validate:**
Compare transaction sum vs bill total. Tolerance: R$ 1.00. Log warning if mismatch but continue.

**5g. Archive PDF:**
Move to `data/processed/{YYYY-MM}/`.

### Step 6: Mark All Paid

```bash
python app/src/cli.py mark-paid {id1} {id2} {id3} ...
```

Use ALL expense IDs from EXPENSE_MAP.

### Step 7: Report Results

Run verification:
```bash
python app/src/cli.py view-month {YEAR} {MONTH}
python app/src/cli.py cc-bills {YEAR} {MONTH}
```

Report back to orchestrator with structured summary:
```
=== {MONTH_NAME} {YEAR} ===
PJ Income: R$ {husky_amount} [status]
Expenses:
  Itau:        R$ {amount} [status]
  Nubank:      R$ {amount} [status]
  Amazon:      R$ {amount} [status]
  Luz:         R$ {amount} [status]
  Gas:         R$ {amount} [status]
  Claro:       R$ {amount} [status]
  CCom:        R$ {amount} [status]
  Condominio:  R$ {amount} [status]
CC Imports:
  Itau:    {N} transactions [status]
  Nubank:  {N} transactions [status]
  Amazon:  {N} transactions [status]
Errors: {error_list or "none"}
```

---

## Error Handling

- **Never stop on individual provider failure.** Log `[!!]` and continue.
- **Never stop on CC import failure.** The expense amount is already set. Log error and continue.
- **SQLite contention**: Each CLI call is a separate process with default 5s timeout. Different month_ids means no row-level collisions.
- **If `edit-expense` fails**: Try `add-expense` as fallback.
- **If `get_email` is oversized**: Response saved to temp file. Parse with `json.load` + `json.loads`.

---

## Windows Safety Reminders

1. ALL Python scripts MUST be written to temp `.py` files, then executed. NEVER use multiline `python -c`.
2. GARIN filenames contain `:` and `/` -- always use `download_attachment` with safe path.
3. BradesCard PDF always named `FATURA MENSAL.pdf` -- rename to avoid collisions across months.
4. Use the scratchpad directory for temp scripts.
5. Quote all paths containing spaces.
