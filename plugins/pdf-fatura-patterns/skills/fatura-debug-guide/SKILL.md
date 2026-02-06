---
name: fatura-debug-guide
description: >
  Use this skill when working with Brazilian credit card PDF statements (faturas),
  parsing CC PDFs, importing credit card transactions, debugging PDF extraction failures,
  or encountering issues with pdfplumber on Itau VISA, Nubank, or BradesCard/Amazon PDFs.
  Also use when categorizing CC transactions, handling password-protected PDFs, or
  dealing with two-column PDF layouts that merge columns.
---

# Brazilian CC PDF Fatura - Debug Guide & Patterns

Hard-won patterns from real-world parsing of Itau VISA, Nubank, and BradesCard statements.

## Critical Rule: Generic Regex Does NOT Work

The pattern `DD/MM MERCHANT R$ XX,XX` fails on ALL three cards. Each card has a unique PDF layout.
Never attempt a one-size-fits-all parser. Use the card-specific strategies in `references/card-parsers.md`.

## Card Detection Order (Pitfall #1)

BradesCard PDF contains "AMAZON" everywhere (card brand is "Amazon Mastercard Platinum").
If you check for "AMAZON" before "BRADESCARD", you misdetect as the wrong account.

**Always check BradesCard FIRST:**
```
1. BRADESCARD or 5373 -> Amazon Prime (account 2)
2. ITAU or 4101 -> Itau VISA (account 3)
3. NUBANK or NU PAGAMENTOS -> Nubank (account 1)
```

## Password Patterns (Pitfall #2)

Try these automatically before asking the user:

| Card | Password | Pattern |
|------|----------|---------|
| Itau VISA | `12419` | First 5 digits of CPF |
| BradesCard | `124198` | First 6 digits of CPF (NOT 5!) |
| Nubank | (none) | Not password-protected |

`12419` (5-digit) fails on BradesCard. `124198` (6-digit) fails on Itau. Don't mix them up.

## Bill Total Extraction (Pitfall #3)

Each card formats the total differently. Extract early for validation.

| Card | Regex | Notes |
|------|-------|-------|
| Itau VISA | `Total desta fatura\s+([\d.,]+)` | NO R$ prefix |
| Nubank | `fatura no valor de R\$\s*([\d.,]+)` | Single line only |
| BradesCard | `\(=\)\s*Total\s*R\$\s*([\d.,]+)` | Matches "(=) Total R$ 572,63" |

## Hard Rules for Auto-Categorization

These patterns are deterministic - never ask the user to confirm:

| Pattern | Category | ID |
|---------|----------|----|
| "NuTag" or "Transacao de NuTag" | carro | 2 |
| "IOF" or "IOF Repasse" or "Repasse de IOF" | tax_foreign | 24 |
| "Ajuste a credito" | reversal | 27 |
| "CANCELAMENTO DE COMPRA" | reversal | 27 |

## Windows-Specific

Never use multiline `python -c` commands on Windows Claude Code. Always write to a temp file first.
See `references/windows-workarounds.md`.

## Quick Reference

For card-specific parser details: `references/card-parsers.md`
For Windows workarounds: `references/windows-workarounds.md`
