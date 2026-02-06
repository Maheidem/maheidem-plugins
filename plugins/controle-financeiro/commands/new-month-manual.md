---
allowed-tools: Bash(python:*), Read, Write, AskUserQuestion
argument-hint: [pj-total]
description: Create new month with recurrents, enter PJ income and expense values, show summary
---

# New Month Setup

Create the next month in the financial tracking system, copying recurrent expenses, setting up PJ income, and updating each recurrent expense amount.

**Requires**: CWD is the controle-financeiro project root.

## Workflow

1. **Create Month**: Run `create-month --next --from-previous` to create the next sequential month and copy recurrent expenses

2. **Get PJ Income**:
   - If `$ARGUMENTS` contains a number, use that as the PJ total
   - Otherwise, ask the user: "Qual o faturamento PJ deste mes?"

3. **Set PJ Values**: Run `edit-month <year> <month> --pj-total <value>` with the provided PJ total

4. **Auto-Import Credit Card Bills**:

   For each credit card (Itau account_id=3, Nubank account_id=4):

   **4.1 Check for unprocessed PDFs:**
   ```python
   from pathlib import Path
   import re

   input_dir = Path("data/contas-do-mes")
   processed_dir = Path("data/processed")

   # Find all PDFs in input directory
   all_pdfs = list(input_dir.glob("*.pdf"))

   # Find processed PDFs
   processed_pdfs = set(p.name for p in processed_dir.rglob("*.pdf"))

   # Unprocessed PDFs
   unprocessed = [p for p in all_pdfs if p.name not in processed_pdfs]

   # Filter by card pattern
   itau_pdfs = [p for p in unprocessed if re.search(r'(visa|itau|4101)', p.name, re.I)]
   nubank_pdfs = [p for p in unprocessed if re.search(r'nubank', p.name, re.I)]
   ```

   **4.2 If card PDF found, extract total:**
   ```python
   import pdfplumber

   def extract_total_from_pdf(pdf_path: Path, password: str = None) -> float:
       """
       Extract total amount from credit card PDF.
       Returns None if extraction fails.
       """
       try:
           with pdfplumber.open(pdf_path, password=password) as pdf:
               full_text = ""
               for page in pdf.pages:
                   full_text += page.extract_text() + "\n"

               # Pattern: "Total" followed by R$ amount
               # Common patterns: "Total da fatura", "Valor total", "Total a pagar"
               pattern = r'(?:Total|TOTAL).*?R\$\s*([\d.,]+)'
               match = re.search(pattern, full_text, re.IGNORECASE)

               if match:
                   amount_str = match.group(1)
                   # Parse Brazilian currency: 1.234,56 -> 1234.56
                   amount = float(amount_str.replace('.', '').replace(',', '.'))
                   return amount
               else:
                   return None

       except Exception as e:
           if "password" in str(e).lower() or "encrypted" in str(e).lower():
               # Ask user for password
               password = input(f"PDF password for {pdf_path.name}: ").strip()
               return extract_total_from_pdf(pdf_path, password)
           else:
               print(f"WARNING: Failed to extract from {pdf_path.name}: {e}")
               return None
   ```

   **4.3 Handle extraction results:**
   - **If PDF found and total extracted**: Report "Found PDF: {filename}, Total: R$ {amount}" and use that amount
   - **If PDF found but extraction failed**: Report "Could not extract from {filename}" and ask user for amount
   - **If no PDF found**: Ask user for amount normally

   **4.4 Create credit card bill in database:**
   ```python
   import sys
   from pathlib import Path
   sys.path.insert(0, str(Path("app/src")))

   from repository import Repository
   from models import CreditCardBill

   repo = Repository()
   month_obj = repo.get_month(year, month)

   # For each card with amount (extracted or user-provided)
   bill = CreditCardBill(
       month_id=month_obj.id,
       account_id=account_id,  # 3=Itau, 4=Nubank
       total_amount=amount,
       due_date=f"{year}-{month:02d}-12",  # Default to 12th
       is_paid=False
   )
   bill_id = repo.add_cc_bill(bill)
   print(f"Created CC bill #{bill_id}: {card_name} R$ {amount:.2f}")
   ```

   **4.5 Offer full import:**
   - If PDF was found, ask: "Importar transacoes detalhadas do PDF? [Y/n]"
   - If user confirms (Y/y/Enter), run: `/controle-financeiro:import-fatura {pdf_path}`
   - Otherwise, continue with basic bill record

5. **List Recurrent Expenses**: Run `list-expenses <year> <month>` to get all copied expenses with their IDs and descriptions

6. **Update Each Expense**:
   - Parse the expense list to extract ID, description, and current amount
   - For each expense:
     - Use AskUserQuestion to ask: "Valor de [expense description]? (R$) [Enter para pular]"
     - Handle special responses:
       - `R$ 1.234,56` (Brazilian format) -> parse to `1234.56`
       - `mesmo`, `igual`, `same` -> skip (keep current value from previous month)
       - `nao acontece mais`, `cancelar`, `remover` -> run `delete-expense <id>`
       - `0` or blank/Enter -> skip (keeps original amount)
       - Any positive number -> run `edit-expense <id> --amount <value>`
   - Show progress: "Atualizando despesa X de Y..."

7. **Mark Paid Status**:
   - Run `list-expenses <year> <month>` again to get current IDs and updated amounts
   - Parse the expense list to get ID, description, and current amount for each expense
   - Use AskUserQuestion to ask for each expense (can batch up to 4 per question):
     - Question format: "Despesa [name] (R$ [amount]) foi paga/agendada?"
     - Options: "Sim, paga" or "Nao, pendente"
   - Handle special responses:
     - `tudo pago`, `todas pagas` -> run `mark-paid` with all expense IDs
   - For each expense marked as "Sim, paga", run `toggle-paid <expense_id>`
   - Show progress: "Marcando pagamento X de Y..."
   - Only mark expenses confirmed as paid - skip those marked as "Nao, pendente"

8. **Show Summary**: Run `view-month <year> <month>` to display the complete month summary including:
   - PJ calculation (tax, prolaborio, lucro presumido)
   - Transfer amounts for PF account
   - Credit card bills with totals
   - Updated recurrent expenses with accurate [PAID]/[PENDING] status
   - Balance

## CLI Commands Reference

```bash
# Create next month with recurrents
python app/src/cli.py create-month --next --from-previous

# Set PJ income
python app/src/cli.py edit-month 2026 2 --pj-total 15000

# List expenses for the month
python app/src/cli.py list-expenses 2026 2

# Update individual expense
python app/src/cli.py edit-expense 42 --amount 1500.00

# Mark expense as paid
python app/src/cli.py toggle-paid 42

# Mark multiple expenses as paid
python app/src/cli.py mark-paid 42 43 44

# View summary
python app/src/cli.py view-month 2026 2
```

## Examples

```
/controle-financeiro:new-month-manual
-> Creates next month, asks for PJ total, checks for CC PDFs, asks for each expense value, asks paid status, shows summary

/controle-financeiro:new-month-manual 63336.42
-> Creates next month with PJ total R$ 63.336,42, checks for CC PDFs, asks for each expense value, asks paid status, shows summary
```

## Important

- All expenses start as UNPAID (from --from-previous)
- The PJ calculation uses configured defaults (9% tax, R$1518 prolaborio)
- Credit card bills are auto-detected from PDFs in `data/contas-do-mes/`
- If PDF found, total is extracted; if extraction fails, asks user
- User can choose to import full transaction details or skip
- Expense amounts are asked one-by-one with clear descriptions
- User can skip expenses by pressing Enter or entering 0
- Paid status is asked AFTER all amounts are updated (ensures accurate totals shown)
- Show the two transfer amounts clearly: prolaborio and lucro_presumido

## Error Handling

If errors occur during workflow:
1. Report specific error message from CLI command or Python script
2. Show which step failed (month creation, PJ setup, CC import, expense update, paid status, etc.)
3. DO NOT proceed to next step if previous step failed
4. If CC PDF extraction fails for one card, report it but continue with other card
5. If expense update fails for one item, report it but continue with remaining expenses
6. If toggle-paid fails for one expense, report it but continue with remaining expenses

## Parsing Notes

When parsing `list-expenses` output:
- Extract expense ID (first column)
- Extract description/category (typically 2nd-3rd columns)
- Extract current amount (currency column)
- Present description to user in a clear format: "Nome da despesa (R$ valor atual)"

## PDF Pattern Matching

Credit card PDF filename patterns:
- **Itau VISA**: Contains `visa`, `itau`, or `4101` (case-insensitive)
- **Nubank**: Contains `nubank` (case-insensitive)

Only PDFs in `data/contas-do-mes/` that are NOT in `data/processed/` are considered unprocessed.

## Account IDs Reference

- `3` = Itau VISA
- `4` = Nubank
- `2` = Amazon Prime Visa (not auto-detected in this workflow)
