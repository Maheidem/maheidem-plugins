# Card-Specific PDF Parsers

## Itau VISA

**Layout**: Two-column PDF. Left and right columns merge into single text lines.
Amounts have NO `R$` prefix. International transactions use a completely different format.

**Strategy**: Manual extraction. Read the extracted text, identify each transaction visually,
and build the transaction list by hand. Regex is unreliable due to column merging.

**Transaction types:**
- Domestic: `DD/MM MERCHANT_NAMECITY AMOUNT` (amount is last number on line, no R$ prefix)
- International: Separate section with US$ and R$ columns, conversion rate
- IOF Repasse: Single line at end of international section
- Fees: "Mensalidade - Plano Anuidade" in "produtos e servicos" section

**Skip these lines:**
- "PAGAMENTO DEB AUTOMATIC"
- "Total dos pagamentos", "Total dos lancamentos"
- Category/location lines (lines without DD/MM prefix between transactions)
- Summary lines

**Section totals for validation:**
- `Lancamentos atuais\s+([\d.,]+)` -> domestic total
- `Total lancamentos inter\.\s+em R\$\s+([\d.,]+)` -> international total
- `Lancamentos produtos e servicos\s+([\d.,]+)` -> fees total
- Sum should equal `Total desta fatura`

---

## Nubank

**Layout**: Clean single-column. Most parse-friendly of the three.

**Regex pattern:**
```
^(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(.+?)\s+([-\u2212]?)R\$\s*([\d.,]+)$
```

**Parsing rules:**
- Start after "TRANSACOES DE" line
- Stop at "Pagamentos" or "Em cumprimento"
- Strip card prefix `\u2022\u2022\u2022\u2022 NNNN` from descriptions
- Unicode minus `\u2212` (U+2212) for negative amounts -- NOT ASCII hyphen
- Extract installment: `- Parcela (\d+/\d+)` in description

**Pitfall**: "Ajuste a credito" uses Unicode minus `\u2212R$`, not `-R$`.
If your regex only matches ASCII `-`, you'll miss refunds.

**Year inference**: DEZ transactions in a FEV bill -> previous year (2025, not 2026).

---

## BradesCard

**Layout**: Two-column with "Limites" table on the right side of page 2.
The Limites values merge into transaction lines, inflating totals if you grab the wrong amount.

**Regex pattern:**
```
^(\d{2}/\d{2})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})(-?)
```

**CRITICAL**: Use non-greedy match and capture only the FIRST monetary amount.
The pattern above stops at the first `NNN,NN` match. If you use `.*` greedy,
you'll capture Limites table values like `9.427,37` or `2.000,00`.

**Parsing rules:**
- Start after "MARCOS HEIDEMANN" + "5373" line
- Stop at "Resumo dos encargos"
- Skip "PAGAMENTO RECEBIDO" lines
- Trailing `-` means negative (refund)
- Most descriptions are "AMAZON BR SAO PAULO BRA" -- differentiate by date/amount

**Verified Feb 2026**: 14 transactions, R$ 572.63 exact match.
