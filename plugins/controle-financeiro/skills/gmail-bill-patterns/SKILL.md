---
name: gmail-bill-patterns
description: >
  Use this skill when fetching financial bills from Gmail, searching for utility
  bills or credit card statements via Gmail MCP, extracting billing amounts from
  email snippets or bodies, working with Brazilian financial email providers
  (Naturgy, Enel, Claro, C-Com, GARIN, Husky, Itau, Nubank, BradesCard),
  or debugging Gmail search queries for bill automation. Also use when parsing
  currency amounts from emails, validating billing months against target months,
  or dealing with stale bills from previous months.
---

# Gmail Bill Extraction Patterns

Patterns for extracting financial data from Gmail using the Gmail MCP tools.
9 active providers: 3 credit cards + 5 utility bills + 1 PJ income.

## Provider Overview

| # | Provider | Type | Extract From | Amount In |
|---|----------|------|-------------|-----------|
| 1 | Itau VISA | CC | Snippet + PDF | Snippet |
| 2 | Nubank | CC | PDF only | PDF |
| 3 | BradesCard | CC | Body + PDF | PDF (password) |
| 4 | Enel | Utility | Email body | Body |
| 5 | Naturgy | Utility | Email body | Body |
| 6 | Claro | Utility | body_html + PDF | body_html |
| 7 | C-Com | Utility | Snippet | Snippet |
| 8 | GARIN | Utility | PDF | PDF |
| 9 | Husky | PJ Income | Email body | Body |

## Snippet-First Strategy

Parse `search_emails` snippet BEFORE calling `get_email`. Several providers have
amounts and due dates in the snippet, saving an API call:

| Provider | Snippet Contains |
|----------|-----------------|
| Itau VISA | Amount (`R$ 9.832,78`) + due date (`10/02/2026`) |
| C-Com | Amount (`R$ 109,90`) + due date (`08/01/2026`) |
| Claro | Due date (`vencimento em 10/02/2026`) |

## Stale Bill Detection

Every provider's billing month is available without opening the PDF:

| Provider | Billing Month Source | Validation Pattern |
|----------|--------------------|--------------------|
| Itau VISA | Snippet due date | `(\d{2}/\d{2}/\d{4})` -> month/year |
| Nubank | PDF filename | `Nubank_YYYY-MM-DD.pdf` |
| BradesCard | Email body | `fatura de (MONTH) / (YEAR)` |
| Enel | Email body | `Data de vencimento: DD/MM/YYYY` |
| Naturgy | Email body table | `Mes` column |
| Claro | Snippet | `vencimento em DD/MM/YYYY` |
| C-Com | Snippet | `vencimento em DD/MM/YYYY` |
| GARIN | Attachment filename | `Ref\.\s*:(\d{2})/(\d{4})` |
| Husky | Email body | `ate as 23h59m do dia DD/MM` |

**ALWAYS validate** the billing month matches the target month before importing.
A stale bill (e.g., January bill used for February) will silently corrupt data.

## Gmail Accent Sensitivity Workaround

Gmail `subject:` with exact phrase matching (`"CONTA DE GAS"`) does NOT match
accented characters (like `GAS`). Use individual word matching as workaround:

```
# WRONG -- won't match accented subject
subject:"CONTA DE GAS"

# CORRECT -- matches regardless of accents
subject:CONTA subject:CHEGOU
```

## MCP Tool Selection

| Tool | When to Use |
|------|------------|
| `search_emails` | Always first. Returns snippet + message_id |
| `get_email` | When body has data (Husky, Enel, Naturgy, BradesCard) |
| `download_attachment` | When you need safe filename control (GARIN, BradesCard, Itau) |
| `get_email_with_attachments` | Simple cases only (Nubank, Claro, C-Com) |

**Avoid `get_email_with_attachments`** for: Husky (62K), Itau (123K), Nubank (84K),
Naturgy (3 attachments). Use `get_email` + selective `download_attachment` instead.

## Claro Exception

Claro `body` field is empty (email says "formato texto" but has no text part).
Must use `body_html` with: `Total a pagar.*?R\$\s*([\d.,]+)`

## Husky Amount Format

Husky uses US-style Brazilian Real: `R$ 57,892.01` (comma=thousands, period=decimal).
Normalize whitespace first (replace `\xa0`, `\u200b`, `&nbsp;` with space) then
parse with: `float(amount.replace(",", ""))`

## Detailed Reference

For complete per-provider queries, extraction patterns, and MCP workflows:
`references/email-search-patterns.md`

For currency parsing rules (BRL vs US-style):
`references/currency-parsing.md`
