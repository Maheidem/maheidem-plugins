# Email Search Patterns Reference

Machine-readable reference for fetching financial data from Gmail (maheidem@gmail.com).
Used by `/fetch-faturas` and `/new-month` skill commands.

> **Last verified**: 2026-02-06
> **Gmail scope**: readonly
> **Total providers**: 9 active (3 credit cards + 5 utility bills + 1 PJ income) + 2 reference-only
> **Search window**: `newer_than:45d` (covers both previous and current month arrivals)

---

## Credit Card Statements

These map to `credit_card_bill` + `transaction_detail` tables in the DB.

### 1. Itau VISA (Samsung)

| Field | Value |
|-------|-------|
| **Provider ID** | `itau-visa` |
| **DB table** | `credit_card_bill` |
| **DB account_id** | `3` |
| **Card label** | Itau VISA |
| **From** | `faturadigital@itau.com.br` |
| **From display** | Samsung - Fatura Digital |
| **Subject** | `Aqui esta a sua fatura digital` |
| **Arrival window** | ~3rd of the billing month |
| **PDF filename pattern** | `Fatura_VISA_102044337687_DD-MM-YYYY.pdf` |
| **PDF mime_type** | `application/octet-stream` |
| **PDF password** | None |

**Gmail search query:**
```
from:faturadigital@itau.com.br subject:"fatura digital" has:attachment newer_than:45d
```

**MCP tool workflow:**
1. `search_emails` -- find the statement email (snippet has amount + due date)
2. `get_email` -- get attachment metadata (avoids 123K oversized response from `get_email_with_attachments`)
3. `download_attachment` -- download PDF to `data/contas-do-mes/`
4. Feed PDF to `/import-fatura` for transaction extraction

**Data extraction:**
- **Bill amount**: In email snippet: `Valor da fatura: R$ 9.832,78`
- **Due date**: In email snippet: `Data de vencimento: 10/02/2026` (DD/MM/YYYY)
- **Target month**: Derived from due date month/year
- **PDF**: Download attachment, feed to `/import-fatura` for transaction extraction

**Special handling:**
- PDF filename encodes the due date as `DD-MM-YYYY` suffix
- Snippet reliably contains amount and due date -- can be parsed without opening the full email
- Amount in snippet uses Brazilian format: `R$ 9.832,78` (period = thousands, comma = decimal)
- **Snippet-first strategy**: Amount and due date are reliably in the snippet -- extract these BEFORE downloading the full email or PDF
- **Avoid `get_email_with_attachments`**: Itau emails are ~123K which can cause oversized responses. Use `get_email` + selective `download_attachment` instead

---

### 2. Nubank

| Field | Value |
|-------|-------|
| **Provider ID** | `nubank` |
| **DB table** | `credit_card_bill` |
| **DB account_id** | `1` |
| **Card label** | Nubank |
| **From** | `todomundo@nubank.com.br` |
| **From display** | Nubank |
| **Subject** | `Sua fatura fechou e o debito automatico esta ativado` |
| **Arrival window** | ~31st of previous month (bill closing date) |
| **PDF filename pattern** | `Nubank_YYYY-MM-DD.pdf` |
| **PDF mime_type** | `application/pdf` |
| **PDF password** | None |

**Gmail search query:**
```
from:todomundo@nubank.com.br subject:"fatura fechou" has:attachment newer_than:45d
```

**MCP tool workflow:**
1. `search_emails` -- find the statement email
2. `get_email_with_attachments` -- download PDF to `data/contas-do-mes/`
3. Feed PDF to `/import-fatura` for transaction extraction

**Data extraction:**
- **Bill amount**: Must parse from PDF (not reliably in snippet)
- **Due date**: Encoded in PDF filename as `YYYY-MM-DD`
- **Target month**: Derived from due date month/year
- **PDF**: Download attachment, feed to `/import-fatura`

**Special handling:**
- Nubank also sends payment confirmations with subject `Pagamento da fatura do cartao de credito Nubank realizado` -- do NOT confuse with the statement email
- Bill closing email arrives end of previous month; due date is usually ~9th of billing month
- No amount in snippet; must download and parse PDF

---

### 3. BradesCard (Amazon)

| Field | Value |
|-------|-------|
| **Provider ID** | `bradescard` |
| **DB table** | `credit_card_bill` |
| **DB account_id** | `2` |
| **Card label** | Amazon Prime |
| **From** | `faturabradescard@infobradesco.com.br` |
| **From display** | faturabradescard@infobradesco.com.br |
| **Subject** | `Fatura por E-Mail BradesCard` |
| **Arrival window** | ~28th-31st of previous month |
| **PDF filename** | `FATURA MENSAL.pdf` (fixed name, no date encoding) |
| **PDF mime_type** | `application/octet-stream` |
| **PDF password** | CPF-based (see below) |

**Gmail search query:**
```
from:faturabradescard@infobradesco.com.br subject:"Fatura por E-Mail BradesCard" has:attachment newer_than:45d
```

**MCP tool workflow:**
1. `search_emails` -- find the statement email
2. `get_email` -- read body to extract billing period (month/year)
3. `download_attachment` -- download PDF to `data/contas-do-mes/` with renamed filename
4. Decrypt PDF with CPF-based password, feed to `/import-fatura`

**Data extraction:**
- **Billing period**: In email body: `Essa e a fatura de FEVEREIRO / 2026`
- **Target month**: Parse month name (Portuguese) and year from body
- **Bill amount**: Must parse from PDF (password-protected)
- **PDF**: Download, decrypt with password, feed to `/import-fatura`

**Special handling -- PASSWORD:**
- PDF is **password-protected** using digits from CPF `12419864794`
- The email body states the password format. Check body for hints:
  - If body says "6 primeiros digitos do seu CPF": password = `124198`
  - If body says "5 primeiros digitos do seu CPF": password = `12419`
- **Recommended strategy**: Try `124198` first (6 digits), then `12419` (5 digits). The 6-digit password works reliably; 5-digit often fails.
- pdfplumber usage: `pdfplumber.open(path, password="124198")`

**Special handling -- FILENAME:**
- PDF filename is always `FATURA MENSAL.pdf` -- must rename during download to avoid collisions
- Rename to: `BradesCard_YYYY-MM.pdf` based on billing period parsed from email body
- Example: body says `FEVEREIRO / 2026` -> rename to `BradesCard_2026-02.pdf`

---

## Utility Bills

These map to `expense` records in the DB.

### 4. Enel (Electricity)

| Field | Value |
|-------|-------|
| **Provider ID** | `enel` |
| **DB table** | `expense` |
| **Expense category** | Luz |
| **From** | `faturaporemail@riodejaneiro.enel.com` |
| **From display** | Enel Distribuicao |
| **Subject** | `Sua Fatura Enel chegou!` |
| **Arrival window** | ~28th-30th of previous month |
| **Installation filter** | UC `8495510` only |
| **Has PDF attachment** | No (body-only) |

**Gmail search query:**
```
from:faturaporemail@riodejaneiro.enel.com subject:"Sua Fatura Enel chegou" newer_than:45d
```

**MCP tool workflow:**
1. `search_emails` -- find Enel emails (may return multiple installations)
2. For each result, check snippet for `8495510` -- **skip all others**
3. `get_email` -- read full body to extract amount and due date
4. No attachment download needed

**Data extraction (from email body):**
- **Amount**: Regex on body: `R\$\s*([\d.,]+)` -- example: `R$ 265,38`
- **Due date**: Regex on body: `Data de vencimento:\s*(\d{2}/\d{2}/\d{4})` -- example: `10/02/2026`
- **Installation UC**: Body contains `instalacao/UC 8495510`

**Special handling:**
- **CRITICAL FILTER**: Marcos has multiple Enel installations. ONLY process emails containing UC `8495510`
- **IGNORE** these installation numbers (other properties):
  - UC `8404007`
  - UC `1570705`
  - UC `7820994`
- Filter by checking snippet for `8495510` before fetching full email
- No PDF attachment -- amount and due date are extracted directly from email body
- Amount is in Brazilian format: `R$ 265,38`

---

### 5. Naturgy (Gas)

| Field | Value |
|-------|-------|
| **Provider ID** | `naturgy` |
| **DB table** | `expense` |
| **Expense category** | Gas |
| **From** | `conta.inteligente@naturgy.com` |
| **From display** | conta.inteligente@naturgy.com |
| **Subject** | `Naturgy - SUA CONTA DE GÁS CHEGOU` |
| **Arrival window** | ~7th-19th of the billing month |
| **Has PDF attachment** | Yes |

**Gmail search query:**
```
from:conta.inteligente@naturgy.com subject:CONTA subject:CHEGOU has:attachment newer_than:45d
```

**MCP tool workflow:**
1. `search_emails` -- find the gas bill email
2. `get_email` -- read full body (contains structured billing table)
3. Parse body for amount and due date (no PDF needed)
4. Fallback: if body parsing fails, `download_attachment` filtering to `Fatura_*` filename

**Data extraction (from email body):**
- **Amount**: Regex on body: `Valor\s+R\$\s*([\d.,]+)` -- example: `Valor R$ 127,01`
- **Due date**: Regex on body: `Vencimento\s+(\d{2}/\d{2}/\d{4})`
- **Billing month**: From body table -- validate matches target month
- **PDF**: NOT needed for amount extraction. Body has structured table (N. Cliente / Mes / Vencimento / Valor)

**Special handling:**
- Subject contains accented character: `GÁS` (with accent on A)
- Gmail `subject:` with exact phrase (`"CONTA DE GAS"`) does NOT match `GÁS` -- use individual word matching instead
- PDF contains the boleto (payment slip) with amount and due date
- **Body-first strategy**: Email body contains all billing data in a structured table. No PDF download needed for amount/due date extraction. This avoids issues with Naturgy's 3 attachments (including junk files)

---

### 6. Claro (Telecom)

| Field | Value |
|-------|-------|
| **Provider ID** | `claro` |
| **DB table** | `expense` |
| **Expense category** | Telecom |
| **From** | `faturadigital@minhaclaro.com.br` |
| **From display** | Fatura Claro |
| **Subject** | `Sua Fatura Digital Claro chegou` |
| **Arrival window** | ~26th-27th of previous month |
| **Has PDF attachment** | Yes |

**Gmail search query:**
```
from:faturadigital@minhaclaro.com.br subject:"Fatura Digital Claro" has:attachment newer_than:45d
```

**MCP tool workflow:**
1. `search_emails` -- find the Claro bill email
2. `get_email_with_attachments` -- download PDF
3. Parse snippet for due date; parse PDF for amount

**Data extraction:**
- **Due date**: In snippet: `vencimento em 10/02/2026`
- **Amount**: Parse from PDF attachment
- **PDF**: Download for amount and payment details

**Special handling:**
- Snippet reliably contains due date: `vencimento em DD/MM/YYYY`
- Due date can be extracted from snippet without full email fetch

---

### 7. C-Com Telecom (Internet / ISP)

| Field | Value |
|-------|-------|
| **Provider ID** | `ccom` |
| **DB table** | `expense` |
| **Expense category** | Internet |
| **From** | `nao-responda@nao-responda.ccomtelecom.com.br` |
| **From display** | C-Com Telecom |
| **Subject** | `Lembrete de Pagamento C-ComTelecom` |
| **Arrival window** | ~29th of prev month to ~7th of billing month |
| **Has PDF attachment** | Yes (on payment reminder emails) |

**Gmail search query:**
```
from:nao-responda@nao-responda.ccomtelecom.com.br subject:"Lembrete de Pagamento" has:attachment newer_than:45d
```

**MCP tool workflow:**
1. `search_emails` -- find the payment reminder email
2. Parse snippet for amount and due date (usually sufficient)
3. Optionally `get_email_with_attachments` -- download PDF for boleto

**Data extraction (from snippet):**
- **Amount**: In snippet: `no valor de R$ 109,90`
- **Due date**: In snippet: `vencimento em 08/01/2026`
- **PDF**: Download for boleto/payment details

**Special handling:**
- Amount and due date are both reliably in the snippet
- Regex on snippet: `vencimento em (\d{2}/\d{2}/\d{4}), no valor de R\$ ([\d.,]+)`
- C-Com also sends `Lembrete: Fatura Com Pagamento no Cartao de Credito` emails (no attachment) -- skip those
- Filter by requiring `has:attachment` to get the right email

---

### 8. Condominio GARIN

| Field | Value |
|-------|-------|
| **Provider ID** | `garin` |
| **DB table** | `expense` |
| **Expense category** | Condominio |
| **From** | `immobileweb@sistemas.alterdata.com.br` |
| **From display** | Immobileweb - Condominio (or MPG CONTABILIDADE) |
| **Subject** | `GARIN - DOCUMENTO IMPORTANTE!` |
| **Arrival window** | ~8th-20th of the billing month |
| **Has PDF attachment** | Yes |

**Gmail search query:**
```
from:immobileweb@sistemas.alterdata.com.br subject:GARIN has:attachment newer_than:45d
```

**MCP tool workflow:**
1. `search_emails` -- find the condominium bill email
2. `get_email` -- get email body and attachment metadata
3. `download_attachment` -- download PDF with **safe filename** `GARIN_YYYY-MM.pdf`
4. Parse PDF for boleto amount and due date

> **WARNING (Windows)**: GARIN attachment filenames contain `:` and `/` characters (e.g., `Ref. :02/2026`) which are illegal on Windows and will CRASH file operations. Always use `download_attachment` with a sanitized `save_path`.

**Data extraction:**
- **Amount**: Parse from PDF attachment (boleto)
- **Due date**: Parse from PDF attachment
- **PDF**: Download for boleto with amount and due date

**Special handling:**
- **CRITICAL FILTER**: The `from` address `immobileweb@sistemas.alterdata.com.br` is a shared platform. MUST filter by `subject:GARIN` to get only Marcos' condominium
- The `from` display name alternates between `Immobileweb - Condominio` and `MPG CONTABILIDADE` -- use `from:` address for reliable matching
- Subject is always `GARIN - DOCUMENTO IMPORTANTE!`
- PDF contains the condominium fee boleto
- **Billing month validation**: Parse `Ref\.\s*:(\d{2})/(\d{4})` from attachment filename metadata to validate billing month matches target
- **Windows filename safety**: Never use `get_email_with_attachments` for GARIN -- it passes the raw filename which crashes on Windows

---

## Business / PJ

### 9. Husky (PJ Income Transfer)

| Field | Value |
|-------|-------|
| **Provider ID** | `husky` |
| **DB table** | `month` (pj_total field) + PJ calculator |
| **Type** | PJ income (faturamento) |
| **From** | `friends@husky.io` |
| **From display** | Husky |
| **Subject** | `[HUSKY] Money is coming!` |
| **Arrival window** | ~1st-2nd of the billing month |
| **Has PDF attachment** | No (not needed) |

**Gmail search query:**
```
from:friends@husky.io subject:"Money is coming" newer_than:45d
```

**MCP tool workflow:**
1. `search_emails` -- find the transfer notification email
2. `get_email` -- read full body to extract transfer amount
3. No attachment download needed

**Data extraction (from email body):**
- **Transfer amount (BRL)**: Regex on body: `R\$\s*([\d.,]+)` -- first match is the total
- **Transfer deadline**: Body contains `ate as 23h59m do dia DD/MM`
- **Amount format**: Uses US-style: `R$ 57,892.01` (comma = thousands, period = decimal)

**Special handling:**
- **CRITICAL**: This is PJ income, not an expense. It feeds into the PJ calculator:
  - `pj_total` = transfer amount
  - `pj_tax` = pj_total * 9% (default rate)
  - `pj_prolaborio` = R$ 1,518.00 (current minimum wage)
  - `pj_lucro_presumido` = pj_total - pj_tax - pj_prolaborio
- Amount uses **US-style formatting**: `R$ 57,892.01` means fifty-seven thousand, eight hundred ninety-two reais and one centavo
  - Parse: remove commas, use period as decimal separator
  - `float("57,892.01".replace(",", ""))` = `57892.01`
- Body may mention multiple transfer lines -- use the first `R$` amount which is the total
- Payments may arrive in 2+ separate transfers but the email states the total

---

## Exclusion List

These senders appear in Gmail but are **explicitly NOT tracked** by the finance system. Skip them even if they match search patterns.

| Sender / Pattern | Reason |
|-----------------|--------|
| Enel UC `8404007` | Not Marcos' bill (other property) |
| Enel UC `1570705` | Not Marcos' bill (other property) |
| Enel UC `7820994` | Not Marcos' bill (other property) |
| Gigalink (`nao_responda@gigalink.net.br`) | Not Marcos' ISP bill |
| Growatt | Not tracked |
| Anthropic | Not tracked |
| Cloudflare | Not tracked |
| Shell Recharge | Not tracked |
| BYD | Not tracked |
| Hankook | Not tracked |
| KaBuM | Not tracked |
| Lufthansa | Not tracked |

---

## Quick Reference: Monthly Collection Checklist

Ordered by typical arrival date within a billing cycle:

| # | Provider | Arrives | Type | DB Target | Extract From | MCP Tools |
|---|----------|---------|------|-----------|-------------|-----------|
| 1 | Claro | ~26-27th prev | Utility | `expense` | PDF + snippet | search, get_email_with_attachments |
| 2 | Enel | ~28-30th prev | Utility | `expense` | Email body | search, get_email |
| 3 | BradesCard | ~28-31st prev | CC statement | `credit_card_bill` | PDF (password) | search, get_email, download_attachment |
| 4 | Nubank | ~31st prev | CC statement | `credit_card_bill` | PDF | search, get_email_with_attachments |
| 5 | C-Com | ~29th-7th | Utility | `expense` | Snippet + PDF | search, get_email_with_attachments |
| 6 | Husky | ~1st-2nd | PJ income | `month.pj_total` | Email body | search, get_email |
| 7 | Itau VISA | ~3rd | CC statement | `credit_card_bill` | Snippet + PDF | search, get_email, download_attachment |
| 8 | Naturgy | ~7-19th | Utility | `expense` | Email body | search, get_email |
| 9 | Condominio | ~8-20th | Utility | `expense` | PDF | search, get_email, download_attachment |

---

## Composite Gmail Queries

All queries use `newer_than:45d` to cover the full billing cycle.

**All CC statements:**
```
(from:faturadigital@itau.com.br OR from:todomundo@nubank.com.br OR from:faturabradescard@infobradesco.com.br) has:attachment newer_than:45d
```

**All utility bills:**
```
(from:faturaporemail@riodejaneiro.enel.com OR from:conta.inteligente@naturgy.com OR from:faturadigital@minhaclaro.com.br OR from:nao-responda@nao-responda.ccomtelecom.com.br OR from:immobileweb@sistemas.alterdata.com.br) newer_than:45d
```

**PJ income:**
```
from:friends@husky.io subject:"Money is coming" newer_than:45d
```

**All active providers (9):**
```
(from:faturadigital@itau.com.br OR from:todomundo@nubank.com.br OR from:faturabradescard@infobradesco.com.br OR from:faturaporemail@riodejaneiro.enel.com OR from:conta.inteligente@naturgy.com OR from:faturadigital@minhaclaro.com.br OR from:nao-responda@nao-responda.ccomtelecom.com.br OR from:immobileweb@sistemas.alterdata.com.br OR from:friends@husky.io) newer_than:45d
```

---

## DB Mapping Reference

### Credit Card account_id -> credit_card_bill table

| account_id | Card Name | Provider ID | Import Method |
|-----------|-----------|-------------|---------------|
| 1 | Nubank | `nubank` | `/import-fatura` (PDF) |
| 2 | Amazon Prime | `bradescard` | `/import-fatura` (PDF, password) |
| 3 | Itau VISA | `itau-visa` | `/import-fatura` (PDF) |

### Utility Bills -> expense table

| Expense Description | Provider ID | Data Source |
|--------------------|-------------|-------------|
| Luz (Enel) | `enel` | Email body (no PDF) |
| Gas (Naturgy) | `naturgy` | Email body (fallback: PDF) |
| Telecom (Claro) | `claro` | PDF attachment |
| Internet (C-Com) | `ccom` | Snippet + PDF |
| Condominio (GARIN) | `garin` | PDF attachment |

### PJ Income -> month table

| Field | Source | Calculation |
|-------|--------|------------|
| `pj_total` | Husky email body (R$ amount) | Direct value |
| `pj_tax_rate` | Config default | `0.09` (9%) |
| `pj_tax` | Calculated | `pj_total * pj_tax_rate` |
| `pj_prolaborio` | Config default | `1518.00` (1 salario minimo) |
| `pj_lucro_presumido` | Calculated | `pj_total - pj_tax - pj_prolaborio` |

---

## MCP Tool Reference

### Available Gmail MCP Tools

| Tool | Purpose | When to Use |
|------|---------|------------|
| `mcp__gmail__search_emails` | Search by query, returns list with id/snippet | First step for every provider |
| `mcp__gmail__get_email` | Get full email body by message_id | Husky (body amount), Enel (body amount), BradesCard (body for billing period) |
| `mcp__gmail__download_attachment` | Download single attachment by id | BradesCard (need to rename file) |
| `mcp__gmail__get_email_with_attachments` | Get email + download all attachments | Most providers with PDFs (Itau, Nubank, Naturgy, Claro, C-Com, GARIN) |
| `mcp__gmail__auth_status` | Check connection | Verify before starting any workflow |

### Tool Selection by Provider

| Provider | Step 1: Search | Step 2: Read | Step 3: Download |
|----------|---------------|-------------|-----------------|
| Itau VISA | `search_emails` | `get_email` (attachment metadata) | `download_attachment` (avoids 123K response) |
| Nubank | `search_emails` | -- | `get_email_with_attachments` |
| BradesCard | `search_emails` | `get_email` (body for period) | `download_attachment` (rename needed) |
| Enel | `search_emails` | `get_email` (body for amount) | -- (no PDF) |
| Naturgy | `search_emails` | `get_email` (body for amount) | -- (PDF not needed) |
| Claro | `search_emails` | -- | `get_email_with_attachments` |
| C-Com | `search_emails` | -- (snippet has data) | `get_email_with_attachments` |
| GARIN | `search_emails` | `get_email` (attachment metadata) | `download_attachment` (safe filename) |
| Husky | `search_emails` | `get_email` (body for amount) | -- (no PDF needed) |

---

## Gmail Search Syntax Reference

Useful operators for building queries:

| Operator | Example | Notes |
|----------|---------|-------|
| `from:` | `from:friends@husky.io` | Exact sender match |
| `subject:` | `subject:"fatura digital"` | Words in subject |
| `has:attachment` | `has:attachment` | Only emails with files |
| `newer_than:Nd` | `newer_than:45d` | Last N days |
| `after:YYYY/MM/DD` | `after:2026/01/01` | After specific date |
| `before:YYYY/MM/DD` | `before:2026/02/01` | Before specific date |
| `filename:pdf` | `filename:pdf` | Has PDF attachment |
| `OR` | `from:a OR from:b` | Either condition |
| `""` | `"exact phrase"` | Exact phrase match |

---

## Currency Parsing Notes

Two different currency formats appear in emails:

| Format | Example | Parse Logic | Used By |
|--------|---------|-------------|---------|
| Brazilian (BRL) | `R$ 9.832,78` | Remove `.`, replace `,` with `.` | All providers except Husky |
| US-style (BRL) | `R$ 57,892.01` | Remove `,` | Husky only |

**Brazilian format parser:**
```python
def parse_brl(text: str) -> float:
    # "R$ 9.832,78" -> 9832.78
    cleaned = text.replace("R$", "").strip()
    cleaned = cleaned.replace(".", "").replace(",", ".")
    return float(cleaned)
```

**US-style parser (Husky only):**
```python
def parse_usd_style_brl(text: str) -> float:
    # "R$ 57,892.01" -> 57892.01
    cleaned = text.replace("R$", "").strip()
    cleaned = cleaned.replace(",", "")
    return float(cleaned)
```

**BradesCard password-protected PDF decryption:**
```python
import pdfplumber

def open_bradescard_pdf(path: str) -> pdfplumber.PDF:
    # Try 6-digit CPF first (works reliably), then 5-digit fallback
    for password in ["124198", "12419"]:
        try:
            return pdfplumber.open(path, password=password)
        except Exception:
            continue
    raise ValueError("Could not decrypt BradesCard PDF with known passwords")
```

---

## Appendix: Reference-Only Providers (NOT used by /new-month)

These providers are documented for completeness but are **out of scope** for the `/new-month` and `/fetch-faturas` workflows. They are not queried, downloaded, or imported.

### Contabilizei (Tax Guides) -- OUT OF SCOPE

| Field | Value |
|-------|-------|
| **Provider ID** | `contabilizei` |
| **Status** | Reference only -- PJ taxes not tracked in this PF expense system |
| **From** | `atendimento.experts@contabilizei.com.br` |
| **Subject** | `Suas guias chegaram em um so arquivo!` |
| **Arrival window** | ~15th of the billing month |
| **Has PDF attachment** | Yes (tax payment guides: DAS, ISS, etc.) |

**Gmail search query (for manual use only):**
```
from:atendimento.experts@contabilizei.com.br subject:"guias chegaram" has:attachment newer_than:45d
```

**Why excluded**: PJ tax obligations (guias de impostos) are not tracked in this personal finance (PF) system. They are handled separately through Contabilizei's own platform.

---

### NF-e (Service Invoice) -- OUT OF SCOPE

| Field | Value |
|-------|-------|
| **Provider ID** | `nfse` |
| **Status** | Reference only -- informational document, not a bill |
| **From** | `noreply-nfse@el.com.br` |
| **Subject** | `Emissao de Nota Fiscal de Servicos Eletronica.` |
| **Arrival window** | ~5th of the month |
| **Has PDF attachment** | Yes (NF-e document) |

**Gmail search query (for manual use only):**
```
from:noreply-nfse@el.com.br subject:"Nota Fiscal" has:attachment newer_than:45d
```

**Why excluded**: This is an informational fiscal document confirming Marcos' company issued a service invoice. It's proof of income, not a cost. No DB import needed.
