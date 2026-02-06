---
allowed-tools: Read, Write, Edit, Bash
argument-hint: "[optional: specific-pdf-path]"
description: Auto-scan, extract, categorize credit card PDFs, create JSON, import to DB, validate, and archive
---

# Import Credit Card Statement - Automated Workflow

Fully automated credit card statement import: scans for unprocessed PDFs, extracts transactions, auto-categorizes, creates JSON intermediate files, imports to database, validates, and archives.

**Requires**: CWD is the controle-financeiro project root.

> The `fatura-debug-guide` skill provides card-specific parsing patterns, password hints, and pitfall documentation. It auto-triggers when working with CC PDFs.

## Workflow Overview

```
1. Scan       -> Find *.pdf in data/contas-do-mes/
2. Extract    -> pdfplumber with password support
3. Detect     -> Month from "Vencimento: DD/MM/YYYY"
4. Categorize -> Smart 4-layer categorization (history, fuzzy, reasoning, web)
5. JSON       -> Save to data/contas-do-mes/extracted/
6. Import     -> Create/update DB records
7. Validate   -> Two-phase: bill total check + DB verification
8. Archive    -> Move PDF to data/processed/YYYY-MM/
```

**IMPORTANT - Windows**: Never use multiline `python -c` commands. Always write Python
code to a temp file in the scratchpad directory, then execute with `python <path>`.
This avoids the Windows batch script corruption bug.

## Pre-Execution Context

!pwd
!ls data/contas-do-mes/*.pdf 2>/dev/null | head -5 || echo "No PDFs found"

## Step 1: Scan for Unprocessed PDFs

Scan `data/contas-do-mes/` directory for PDF files that have NOT been archived to `data/processed/`.

**Implementation:**
```python
from pathlib import Path

input_dir = Path("data/contas-do-mes")
processed_dir = Path("data/processed")

# Find all PDFs in input directory (non-recursive)
all_pdfs = list(input_dir.glob("*.pdf"))

# Find all processed PDFs (recursive search in processed/)
processed_pdfs = set(p.name for p in processed_dir.rglob("*.pdf"))

# Unprocessed = in input_dir but not in processed/
unprocessed = [p for p in all_pdfs if p.name not in processed_pdfs]

print(f"Found {len(unprocessed)} unprocessed PDF(s)")
```

**If `$1` is provided**: Use that specific PDF path instead of scanning.

**If no unprocessed PDFs found**: Report and STOP.

## Step 2: Extract PDF with pdfplumber

For each unprocessed PDF:

**2.1 Attempt extraction without password:**
```python
import pdfplumber

pdf_path = "path/to/fatura.pdf"
password = None

try:
    with pdfplumber.open(pdf_path, password=password) as pdf:
        full_text = ""
        for page in pdf.pages:
            full_text += page.extract_text() + "\n"
except Exception as e:
    if "password" in str(e).lower() or "encrypted" in str(e).lower():
        # Ask user for password
        print(f"PDF is password-protected: {pdf_path.name}")
        password = input("Enter password: ").strip()
        # Retry with password
    else:
        print(f"ERROR: Failed to extract PDF - {e}")
        # Skip to next PDF
```

**2.2 Handle password-protected PDFs:**
- Ask user: "Enter password: "
- Retry extraction with provided password
- If still fails, report error and skip to next PDF

### Password Reference (try automatically before asking user)

| Card | Password | Pattern |
|------|----------|---------|
| Itau VISA | `12419` | First 5 digits of CPF (124.198.647-94) |
| BradesCard | `124198` | First 6 digits of CPF |
| Nubank | (none) | Not password-protected |

Try these passwords automatically. Only ask the user if they fail.

## Step 3: Detect Card Type and Target Month

**3.1 Detect card type from PDF text:**
```python
def detect_card(text: str) -> tuple[str, int]:
    """
    Returns (card_name, account_id)
    IMPORTANT: Check BradesCard FIRST -- its PDF contains "AMAZON" everywhere
    which would misdetect as Amazon Prime account.
    """
    text_upper = text.upper()

    # Check BradesCard FIRST (has "AMAZON" in name, would misdetect)
    if "BRADESCARD" in text_upper or "5373" in text_upper:
        return ("Amazon Prime", 2)

    # Check for Itau VISA
    if "ITAU" in text_upper or "4101" in text_upper:
        return ("Itau VISA", 3)

    # Check for Nubank
    if "NUBANK" in text_upper or "NU PAGAMENTOS" in text_upper:
        return ("Nubank", 1)

    # Unknown - ask user
    print("Could not auto-detect card type")
    print("1 = Nubank")
    print("2 = Amazon Prime (BradesCard)")
    print("3 = Itau VISA")
    choice = input("Enter card ID: ").strip()

    card_map = {"1": ("Nubank", 1), "2": ("Amazon Prime", 2), "3": ("Itau VISA", 3)}
    return card_map.get(choice, ("Unknown", 0))
```

**3.2 Extract due date and determine target month:**
```python
import re
from datetime import datetime

def extract_due_date(text: str) -> tuple[str, int, int]:
    """
    Returns (due_date_str, target_year, target_month)

    Logic: Due date determines which month the bill belongs to.
    Example: Vencimento 12/01/2026 -> Janeiro 2026
    """
    # Pattern: "Vencimento" followed by DD/MM/YYYY
    pattern = r'Vencimento[:\s]+(\d{2})/(\d{2})/(\d{4})'
    match = re.search(pattern, text, re.IGNORECASE)

    if not match:
        print("WARNING: Could not find due date in PDF")
        print("Enter due date manually (DD/MM/YYYY): ")
        date_input = input().strip()
        day, month, year = date_input.split('/')
    else:
        day, month, year = match.groups()

    # Target month is the month of the due date
    target_year = int(year)
    target_month = int(month)
    due_date = f"{year}-{month}-{day}"

    return (due_date, target_year, target_month)
```

**Validation:**
- Verify target month exists in database:
  ```bash
  python app/src/cli.py view-month <year> <month>
  ```
- If month not found: Report error "Month YYYY-MM does not exist. Create it first with /controle-financeiro:new-month" and skip to next PDF

**3.3 Extract bill total from PDF text:**

Each card has a different pattern for the bill total. Extract this early for validation in Step 8.

| Card | Regex | Example Match |
|------|-------|---------------|
| Itau VISA | `Total desta fatura\s+([\d.,]+)` | "Total desta fatura 9.832,78" |
| Nubank | `fatura no valor de R\$\s*([\d.,]+)` | "fatura no valor de R$ 1.676,56" |
| BradesCard | `\(=\)\s*Total\s*R\$\s*([\d.,]+)` | "(=) Total R$ 572,63" |

Parse the matched value as Brazilian currency (remove `.` thousands separator, replace `,` with `.`).

## Step 4: Parse and Auto-Categorize Transactions

**4.1 Parse transactions from PDF text (card-specific):**

The generic `DD/MM MERCHANT R$ XX,XX` regex DOES NOT WORK on any of the 3 cards. Each card has a unique PDF layout that requires card-specific parsing. Write a temp Python script in the scratchpad directory with the appropriate parser.

---

**4.1.1 Itau VISA Parser**

The Itau two-column PDF merges columns into single lines, making regex unreliable. Amounts have NO `R$` prefix. International transactions use a completely different format.

**Strategy**: Use manual extraction -- read the extracted text, identify each transaction visually, and build the transaction list by hand. Itau typically has ~60-70 transactions per month.

Transaction types:
- **Domestic**: `DD/MM MERCHANT_NAMECITY AMOUNT` (no R$ prefix, amount is last number on line)
- **International**: Separate section with US$ and R$ columns, conversion rate
- **IOF Repasse**: Single line at end of international section
- **Fees**: "Mensalidade - Plano Anuidade" in "produtos e servicos" section
- **SKIP**: "PAGAMENTO DEB AUTOMATIC", "Total dos pagamentos", "Total dos lancamentos", summary lines, category/location lines (lines without DD/MM prefix that appear between transactions)

**Bill total extraction**: `Lancamentos atuais\s+([\d.,]+)` for domestic + `Total lancamentos inter\.\s+em R\$\s+([\d.,]+)` for international + fees.

---

**4.1.2 Nubank Parser**

```
Pattern: ^(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(.+?)\s+([-−]?)R\$\s*([\d.,]+)$
```

Parsing rules:
- Start parsing after "TRANSACOES DE" line
- Stop at "Pagamentos" or "Em cumprimento"
- Strip card prefix `•••• NNNN` from descriptions
- Handle Unicode minus `−` (U+2212) for negative amounts (Ajuste a credito)
- Extract installment: `- Parcela (\d+/\d+)` in description

**Bill total extraction**: `fatura no valor de R\$\s*([\d.,]+)` (single line, NOT cross-line)

---

**4.1.3 BradesCard Parser**

```
Pattern: ^(\d{2}/\d{2})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})([-]?)$
```

Parsing rules:
- Start parsing after "MARCOS HEIDEMANN" + "5373" line
- Stop at "Resumo dos encargos" or "Total parcelado" or "Limites"
- **CRITICAL**: Extract only the FIRST monetary amount from each line (right-column "Limites" table values merge into transaction lines, inflating totals)
- Skip "PAGAMENTO RECEBIDO" lines
- Trailing `-` means negative (refund)
- Most descriptions are "AMAZON BR SAO PAULO BRA" -- differentiate by date/amount

**Bill total extraction**: `\(=\)\s*Total\s*R\$\s*([\d.,]+)` -- matches "(=) Total R$ 572,63"

**4.2 Smart Categorization (4-layer)**

Before categorizing, load context by running these two CLI commands:

```bash
python app/src/cli.py list-categories --type expense
python app/src/cli.py merchant-history
```

The first returns all valid category IDs and names. The second returns historical merchant-to-category mappings from previous imports (merchant name, category, occurrence count).

**Pre-processing**: Before matching, normalize each transaction description:
- Strip installment suffixes matching `- Parcela \d+/\d+` or `\d{2}/\d{2}$` (installment info like "03/12")
- Trim extra whitespace

**4.2.1 Hard rules (always apply first):**

| Pattern | Category | ID |
|---------|----------|----|
| Description starts with "NuTag" or contains "Transacao de NuTag" | carro | 2 |
| Description starts with "IOF" or contains "IOF Repasse" or "Repasse de IOF" | tax_foreign | 24 |
| Description contains "Ajuste a credito" | reversal_upfront_national_settled | 27 |
| Description contains "CANCELAMENTO DE COMPRA" | reversal_upfront_national_settled | 27 |

These override all other layers. Do NOT ask the user to confirm these.

**4.2.2 Layer 1 -- Exact history match:**

Compare the normalized description against the `merchant-history` output. If the merchant appears with 2 or more historical occurrences in a single category, assign that category automatically. Mark confidence as **high** -- no user confirmation needed.

**4.2.3 Layer 2 -- Fuzzy history match:**

If no exact match, check if the normalized description is a substring of (or contains as a substring) any merchant in the history list. If a match is found, propose that category. Mark confidence as **medium-high** -- needs user confirmation in the batch review.

**4.2.4 Layer 3 -- Claude reasoning:**

For remaining unmatched transactions, use your world knowledge about Brazilian merchants, brands, and services to infer the most likely category from the `list-categories` output. Consider:
- Known Brazilian supermarket chains (Assai, Carrefour, Dia, etc.)
- Restaurant/food delivery apps (iFood, Rappi, Uber Eats)
- Pharmacy chains (Drogasil, Panvel, RD Saude)
- Subscription services (Netflix, Spotify, Google, Apple)
- Gas stations, toll roads, parking

Mark confidence as **medium** -- needs user confirmation in the batch review.

**4.2.5 Layer 4 -- Web search (for unknowns > R$ 50):**

For transactions that remain uncategorized after Layer 3 AND have amount > R$ 50, use the `WebSearch` tool to look up the merchant name (e.g., "Kc85comerciode CNPJ" or "DRFRUTOSDOACAI loja"). Use the search results to determine the business type and assign a category.

For transactions <= R$ 50 that remain unknown, assign `outros` (ID 20).

Mark confidence as **low** -- needs user confirmation in the batch review.

**4.2.6 Batch confirmation:**

After categorizing all transactions, present a grouped summary for user review:

```
=== Auto-categorized (exact history + hard rules, N transactions) ===
  Description                    Category         Amount
  Armazem do Grao                supermercado     R$  205,98
  Transacao de NuTag             carro            R$   14,50
  ...

=== Need confirmation (M transactions) ===
  #  Description                  Category         Amount     Signal
  1. Drfrutosdoacai              restaurante      R$   42,57  [claude]
  2. Kc85comerciode              outros           R$  122,30  [web-search]
  3. Padaria Real                restaurante      R$   18,90  [fuzzy-history]
  ...

Valid categories: (list from list-categories output)

Confirm all? [Y] or enter corrections (e.g., "2=19" or "2=pet"):
```

**User input:**
- `Y`, `y`, Enter, `sim` -- accept all proposed categories
- Corrections like `2=19` (by ID) or `2=pet` (by name) -- override specific items, accept rest
- Multiple corrections: `2=19, 3=supermercado`

After confirmation, assign `category_id` and `category_name` to each transaction in the transactions list.

**Note on year inference:**
- Transactions in December may belong to next year's January bill
- Use statement year from filename or due date year - 1 if due date is in January

## Step 5: Create JSON Intermediate File

**5.1 Build JSON structure:**
```python
import json
from datetime import datetime

json_data = {
    "source_file": pdf_path.name,
    "extracted_at": datetime.now().isoformat(),
    "card_type": card_name,
    "account_id": account_id,
    "due_date": due_date,
    "target_month": {
        "year": target_year,
        "month": target_month
    },
    "total_amount": sum(t['amount'] for t in transactions),
    "transactions": transactions,
    "summary": {
        "transaction_count": len(transactions),
        "transactions_total": sum(t['amount'] for t in transactions),
        "by_category": {}
    }
}

# Calculate category breakdown
from collections import defaultdict
cat_totals = defaultdict(float)
for trans in transactions:
    cat_totals[trans['category_name']] += trans['amount']

json_data['summary']['by_category'] = dict(cat_totals)
```

**5.2 Save JSON file:**
```python
from pathlib import Path

extracted_dir = Path("data/contas-do-mes/extracted")
extracted_dir.mkdir(exist_ok=True)

json_filename = pdf_path.stem + ".json"  # Same name as PDF
json_path = extracted_dir / json_filename

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(json_data, f, indent=2, ensure_ascii=False)

print(f"[OK] JSON saved: {json_path}")
```

## Step 6: Show Preview and Confirm Import

**6.1 Bill total comparison:**

Before showing the preview, check if a bill record already exists in the DB for this card+month (created by `/controle-financeiro:new-month`). If it does, fetch `bill.total_amount` from the DB record and compare against the sum of parsed transactions:

```bash
python app/src/cli.py cc-bills <year> <month>
```

Show the comparison:
- `Bill total (from /new-month)`: the amount stored in the DB
- `PDF transactions sum`: the sum of all parsed transaction amounts
- `Difference`: absolute difference

If the difference is > R$ 1.00, display a warning. Minor rounding differences (<= R$ 0.02) are expected and acceptable.

**6.2 Display enhanced preview:**

```
---------------------------------------------
PDF: Fatura_VISA_102044337687_12-01-2026.pdf
Card: Itau VISA
Due Date: 12/01/2026
Target Month: Janeiro 2026
---------------------------------------------

Bill total (DB):          R$ 9.281,51
PDF transactions sum:     R$ 9.281,51
Difference:               R$ 0,00       [OK]

Transactions: 54

Category Breakdown:
  Category           Amount         Count
  supermercado       R$ 2.603,05    12
  servicos           R$ 2.191,52     8
  restaurante        R$ 1.845,30    15
  eletronicos        R$ 1.234,00     3
  outros             R$ 1.407,64    16

Categorization confidence:
  Auto (exact history + hard rules):  38 transactions
  Needs confirmation:                 16 transactions

JSON preview: data/contas-do-mes/extracted/Fatura_VISA_102044337687_12-01-2026.json

Import to database? [Y/n]:
```

**User input:**
- `Y`, `y`, `yes`, `sim`, or Enter -- Proceed to import
- `n`, `no`, `nao` -- Skip this PDF, continue to next
- `q`, `quit` -- Stop processing all PDFs

## Step 7: Import to Database

**7.1 Get or create credit card bill:**
```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path("app/src")))

from repository import Repository
from models import CreditCardBill

repo = Repository()

# Get month object
month_obj = repo.get_month(target_year, target_month)
if not month_obj:
    print(f"ERROR: Month {target_year}-{target_month:02d} not found in database")
    # Skip to next PDF

# Check for existing bill
existing_bills = repo.get_cc_bills_for_month(month_obj.id)
bill_id = None

for bill, acc_name in existing_bills:
    if bill.account_id == account_id:
        print(f"[INFO] Updating existing bill #{bill.id}")
        # Update existing bill
        bill.total_amount = json_data['total_amount']
        bill.due_date = json_data['due_date']
        repo.update_cc_bill(bill)
        bill_id = bill.id

        # Delete old transactions
        with repo.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM transaction_detail WHERE credit_card_bill_id = ?", (bill_id,))
            print(f"[INFO] Deleted old transactions")
        break

if not bill_id:
    # Create new bill
    print(f"[INFO] Creating new bill")
    bill = CreditCardBill(
        month_id=month_obj.id,
        account_id=account_id,
        total_amount=json_data['total_amount'],
        due_date=json_data['due_date'],
        is_paid=False
    )
    bill_id = repo.add_cc_bill(bill)
```

**7.2 Insert transaction details:**
```python
with repo.get_connection() as conn:
    cur = conn.cursor()

    for trans in json_data['transactions']:
        cur.execute("""
            INSERT INTO transaction_detail
            (credit_card_bill_id, category_id, transaction_date, description, amount, installment_info)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            bill_id,
            trans['category_id'],
            trans['date'],
            trans['description'],
            trans['amount'],
            trans.get('installment')
        ))

    print(f"[OK] Imported {len(json_data['transactions'])} transactions to bill #{bill_id}")
```

## Step 8: Validate Import (Two-Phase)

**Phase A -- Transaction sum vs bill total:**

Before verifying the DB insert, compare the bill total (set by `/controle-financeiro:new-month`) against the sum of transaction amounts from the PDF:

```python
# Fetch the bill total from DB (set by /new-month)
with repo.get_connection() as conn:
    cur = conn.cursor()
    cur.execute("SELECT total_amount FROM credit_card_bill WHERE id = ?", (bill_id,))
    bill_total_from_db = cur.fetchone()[0]

pdf_transactions_sum = sum(t['amount'] for t in json_data['transactions'])
difference = abs(bill_total_from_db - pdf_transactions_sum)
```

Apply tolerance rules:

| Difference | Result | Action |
|-----------|--------|--------|
| <= R$ 0.02 | PASS | Continue silently |
| <= R$ 1.00 | WARN | Show warning, continue |
| > R$ 1.00 | ERROR | Ask user to choose |

If difference > R$ 1.00, present options:

```
[WARNING] Bill total mismatch:
  Bill total (DB):         R$ 9.281,51
  PDF transactions sum:    R$ 9.250,03
  Difference:              R$    31,48

Options:
  1. Update bill total to match PDF transactions (R$ 9.250,03)
  2. Continue anyway (keep bill total as-is)
  3. Abort import

Choose [1/2/3]:
```

If user chooses option 1, update the bill total in the DB before proceeding. If option 3, skip to next PDF without archiving.

**Phase B -- Post-import DB verification:**

After inserting transactions, verify the data was written correctly:

```python
with repo.get_connection() as conn:
    cur = conn.cursor()

    # Get transaction count and sum from DB
    cur.execute("""
        SELECT COUNT(*), SUM(amount)
        FROM transaction_detail
        WHERE credit_card_bill_id = ?
    """, (bill_id,))
    db_trans_count, db_trans_total = cur.fetchone()

# Compare with JSON
json_count = json_data['summary']['transaction_count']
json_total = json_data['total_amount']

errors = []

if db_trans_count != json_count:
    errors.append(f"Transaction count mismatch: DB={db_trans_count}, JSON={json_count}")

if abs(db_trans_total - json_total) > 0.01:
    errors.append(f"Total amount mismatch: DB={db_trans_total:.2f}, JSON={json_total:.2f}")

if errors:
    print("[ERROR] Validation failed:")
    for err in errors:
        print(f"  - {err}")
    print("Database import may be corrupted. Review manually.")
    # Do NOT archive PDF
else:
    print("[OK] Validation passed: DB matches JSON")
```

## Step 9: Archive PDF to Processed Folder

**Only if validation passed:**

```python
from pathlib import Path
import shutil

# Create archive directory: processed/YYYY-MM/
archive_dir = Path("data/processed")
month_dir = archive_dir / f"{target_year:04d}-{target_month:02d}"
month_dir.mkdir(parents=True, exist_ok=True)

# Move PDF to archive
dest_path = month_dir / pdf_path.name

try:
    shutil.move(str(pdf_path), str(dest_path))
    print(f"[OK] Archived: {dest_path}")
except Exception as e:
    print(f"[WARNING] Failed to archive PDF: {e}")
    print(f"PDF remains at: {pdf_path}")
```

**Archive structure:**
```
data/processed/
  2026-01/
    Fatura_VISA_102044337687_12-01-2026.pdf
  2025-12/
    Fatura_Nubank_123.pdf
```

## Step 10: Summary Report

After processing all PDFs, show summary:

```
===============================================
Import Summary
===============================================

Processed: 2 PDF(s)
Successful: 2
Failed: 0

Details:
  Fatura_VISA_102044337687_12-01-2026.pdf
  -> Janeiro 2026 | R$ 9.281,51 | 54 transactions

  Fatura_Nubank_202512.pdf
  -> Dezembro 2025 | R$ 3.456,78 | 32 transactions

JSON files: data/contas-do-mes/extracted/
Archived to: data/processed/

Next steps:
  - Review month: /controle-financeiro:review 2026 1
  - Mark as paid: /controle-financeiro:pay-bills
```

## Error Handling

### PDF Not Found
```
ERROR: No PDF found at path: {path}
Searched directory: data/contas-do-mes/
Available PDFs: {list}
```

### PDF Password Protected
```
PDF is password-protected: Fatura_VISA_XXX.pdf
Enter password: [user input]

[If wrong password]
ERROR: Invalid password. Skipping PDF.
```

### No Transactions Extracted
```
WARNING: No transactions found in PDF
Possible causes:
  - PDF is scanned image (not text-based)
  - Non-standard format
  - Empty statement

Skipping import. Review PDF manually.
```

### Month Not Found in Database
```
ERROR: Month 2026-02 does not exist in database
Create it first:
  /controle-financeiro:new-month

Skipping PDF: Fatura_XXX.pdf
```

### Validation Failed
```
[ERROR] Validation failed:
  - Transaction count mismatch: DB=52, JSON=54
  - Total amount mismatch: DB=9250.00, JSON=9281.51

Database import may be corrupted. Review manually:
  python app/src/tui.py

PDF NOT archived (remains in: data/contas-do-mes/)
JSON available for debugging: data/contas-do-mes/extracted/Fatura_XXX.json
```

## Important Notes

- **JSON Intermediate**: Always create JSON before DB import for debugging/rollback
- **Validation Required**: Never archive without successful validation
- **Duplicate Handling**: Existing bills are updated, old transactions replaced
- **Password Handling**: Never store passwords, only used for PDF decryption
- **Rollback**: JSON files allow re-import without re-parsing PDF

## Dependencies

Required Python packages (already installed):
- `pdfplumber` - PDF text extraction
- Standard library: `pathlib`, `json`, `re`, `datetime`, `shutil`

## Database Schema Reference

```sql
-- credit_card_bill
CREATE TABLE credit_card_bill (
    id INTEGER PRIMARY KEY,
    month_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    total_amount REAL NOT NULL,
    due_date TEXT NOT NULL,
    is_paid INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (month_id) REFERENCES month(id),
    FOREIGN KEY (account_id) REFERENCES account(id),
    UNIQUE(month_id, account_id)
);

-- transaction_detail
CREATE TABLE transaction_detail (
    id INTEGER PRIMARY KEY,
    credit_card_bill_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    transaction_date TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    installment_info TEXT,
    FOREIGN KEY (credit_card_bill_id) REFERENCES credit_card_bill(id),
    FOREIGN KEY (category_id) REFERENCES category(id)
);
```

## Account IDs (Credit Cards)
- `1` = Nubank
- `2` = Amazon Prime Visa
- `3` = Itau VISA

## Category IDs

Categories are loaded dynamically from the database at runtime via:
```bash
python app/src/cli.py list-categories --type expense
python app/src/cli.py merchant-history
```
