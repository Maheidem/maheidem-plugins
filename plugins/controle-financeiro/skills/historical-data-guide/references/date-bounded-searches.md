# Date-Bounded Gmail Search Patterns

Reference for searching Gmail with explicit date bounds instead of `newer_than:45d`.
Used by `/controle-financeiro:import-historical` for historical month processing.

## Date Window Calculation

For a target month `YYYY-MM`, create a ~45-day search window:

```
after:YYYY/(MM-1)/15  before:YYYY/(MM+1)/01
```

This covers bills arriving from mid-previous-month through end of target month.

### Year Boundary Examples

| Target Month | after: | before: |
|-------------|--------|---------|
| 2025-01 | `after:2024/12/15` | `before:2025/02/01` |
| 2025-02 | `after:2025/01/15` | `before:2025/03/01` |
| 2025-06 | `after:2025/05/15` | `before:2025/07/01` |
| 2025-12 | `after:2025/11/15` | `before:2026/01/01` |

### Python Helper

```python
def get_date_bounds(year: int, month: int) -> tuple[str, str]:
    """Returns (after_str, before_str) for Gmail date-bounded search."""
    # after: 15th of previous month
    if month == 1:
        after_str = f"after:{year-1}/12/15"
    else:
        after_str = f"after:{year}/{month-1:02d}/15"

    # before: 1st of next month
    if month == 12:
        before_str = f"before:{year+1}/01/01"
    else:
        before_str = f"before:{year}/{month+1:02d}/01"

    return after_str, before_str
```

---

## Per-Provider Query Templates

Replace `newer_than:45d` with `{after} {before}` in each query.

### 1. Husky (PJ Income)

```
from:friends@husky.io subject:"Money is coming" {after} {before}
```

**Extract**: Email body (normalize whitespace first)
**Amount regex**: `R\$\s*([\d.,]+)` (US-style: `R$ 57,892.01`)
**Parse**: `float(amount.replace(",", ""))`
**Stale check**: Body contains `ate as 23h59m do dia DD/MM` -- validate month matches target

### 2. Itau VISA

```
from:faturadigital@itau.com.br subject:"fatura digital" has:attachment {after} {before}
```

**Extract**: Snippet (amount + due date)
**Amount regex**: `Valor da fatura:\s*R\$\s*([\d.,]+)` on snippet
**Due date regex**: `Data de vencimento:\s*(\d{2}/\d{2}/\d{4})` on snippet
**Stale check**: Due date month must match target month
**PDF**: `get_email` for attachment ID -> `download_attachment`
**WARNING**: Response is ~123K, saved to temp file. Parse file for attachment ID only.

### 3. Nubank

```
from:todomundo@nubank.com.br subject:"fatura fechou" has:attachment {after} {before}
```

**Extract**: PDF (amount not in snippet)
**Amount regex**: `fatura no valor de R\$\s*([\d.,]+)` on PDF text
**Stale check**: PDF filename `Nubank_YYYY-MM-DD.pdf` -- month from filename
**PDF**: `get_email` for attachment ID -> `download_attachment`
**WARNING**: Response is ~84K, saved to temp file. Parse file for attachment ID only.

### 4. BradesCard (Amazon)

```
from:faturabradescard@infobradesco.com.br subject:"Fatura por E-Mail BradesCard" has:attachment {after} {before}
```

**Extract**: Email body (billing period) + PDF (amount, password-protected)
**Billing period regex**: `fatura de (\w+)\s*/\s*(\d{4})` on body
**Amount regex**: `\(=\)\s*Total\s*R\$\s*([\d.,]+)` on PDF text
**PDF password**: `124198` (6-digit CPF prefix)
**Stale check**: Billing period month name (Portuguese) must match target
**RENAME**: `FATURA MENSAL.pdf` -> `BradesCard_YYYY-MM.pdf`

### 5. Enel (Luz)

```
from:faturaporemail@riodejaneiro.enel.com subject:"Sua Fatura Enel chegou" 8495510 {after} {before}
```

**Extract**: Email body
**Amount regex**: `R\$\s*([\d.,]+)` on body
**Due date regex**: `Data de vencimento:\s*(\d{2}/\d{2}/\d{4})` on body
**Stale check**: Due date month from body must match target
**FILTER**: Only UC `8495510`. Ignore UC 8404007, 1570705, 7820994.
**No PDF**: Amount from body only.

### 6. Naturgy (Gas)

```
from:conta.inteligente@naturgy.com subject:CONTA subject:CHEGOU {after} {before}
```

**Extract**: Email body (structured table)
**Amount regex**: `Valor\s+R\$\s*([\d.,]+)` on body
**Due date regex**: `Vencimento\s+(\d{2}/\d{2}/\d{4})` on body
**Stale check**: Body table `Mes` column must match target
**No PDF needed**: Body has all billing data.

### 7. Claro

```
from:faturadigital@minhaclaro.com.br subject:"Fatura Digital Claro" has:attachment {after} {before}
```

**Extract**: `body_html` (NOT `body` -- body is empty for Claro)
**Amount regex**: `Total a pagar.*?R\$\s*([\d.,]+)` on `body_html` (use `re.DOTALL`)
**Due date regex**: `vencimento em (\d{2}/\d{2}/\d{4})` on snippet
**Stale check**: Due date month from snippet must match target
**PDF**: Download via `download_attachment` for CC import only.

### 8. C-Com (Internet)

```
from:nao-responda@nao-responda.ccomtelecom.com.br subject:"Lembrete de Pagamento" has:attachment {after} {before}
```

**Extract**: Snippet only
**Combined regex**: `vencimento em (\d{2}/\d{2}/\d{4}),\s*no valor de R\$\s*([\d.,]+)` on snippet
**Stale check**: Due date month from snippet must match target
**No full email needed**: Snippet has amount + due date.

### 9. GARIN (Condominio)

```
from:immobileweb@sistemas.alterdata.com.br subject:GARIN has:attachment {after} {before}
```

**Extract**: PDF (boleto)
**Amount regex**: `Valor do Documento\s*([\d.,]+)` on PDF text (NO R$ prefix!)
**Stale check**: Attachment filename `Ref\.\s*:(\d{2})/(\d{4})` -- month must match target
**WINDOWS SAFETY**: Attachment filename contains `:` and `/`. MUST use `download_attachment` with safe path: `GARIN_YYYY-MM.pdf`

---

## Multiple Results Handling

When searching historical months, the date window may return multiple emails per provider. Rules:

1. Sort results by date (newest first)
2. For each result, validate billing month matches target month (using stale-check pattern above)
3. Use the FIRST result that passes stale-check validation
4. If no results pass validation, log `[??]` and move on

---

## Currency Parsing (Quick Reference)

| Provider | Format | Parse Logic |
|----------|--------|-------------|
| Husky | US-style `R$ 57,892.01` | `float(s.replace(",", ""))` |
| All others | Brazilian `R$ 9.832,78` | `float(s.replace(".", "").replace(",", "."))` |

GARIN is special: `Valor do Documento 1.234,56` -- no `R$` prefix. Apply Brazilian parse.
