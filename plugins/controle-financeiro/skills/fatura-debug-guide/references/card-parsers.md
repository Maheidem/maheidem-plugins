# Card-Specific PDF Parsers

## Itau VISA

**Layout**: Two-column PDF. Left and right columns merge into single text lines.
Amounts have NO `R$` prefix. International transactions use a completely different format.

**Strategy**: Manual extraction ONLY. Two regex attempts both failed (sums off by R$ 872-965
due to column merging). Read the extracted text, identify each transaction visually,
and build the transaction list by hand.

**Why regex fails**: Lines like `12/01 PAGAMENTO DEB AUTOMATIC -9.281,51 10/01 FRUTOS DA TERRA HORTIFP 28,14`
contain TWO transactions merged from left and right columns. Splitting on `\s+(\d{2}/\d{2})\s+`
is unreliable because category/location lines also appear between transactions.

**Transaction types:**
- Domestic: `DD/MM MERCHANT_NAMECITY AMOUNT` (amount is last number on line, no R$ prefix)
- International: Separate section starting with "Lancamentos internacionais"
  - Format: `DD/MM MERCHANT AMOUNT_BRL` on first line, then `USD_AMOUNT BRL USD_AMOUNT` on next line,
    then `Dolar de Conversao R$ RATE` -- the R$ amount is on the FIRST line
- IOF Repasse: `Repasse de IOF em R$ AMOUNT` at end of international section
- Fees: "Mensalidade - Plano Anuidade" in "produtos e servicos" section

**Skip these lines:**
- "PAGAMENTO DEB AUTOMATIC"
- "Total dos pagamentos", "Total dos lancamentos", "Total lancamentos inter."
- Category/location lines (lines without DD/MM prefix between transactions)
- "Lancamentos atuais", "Lancamentos no cartao"

**Section totals for validation (RELIABLE):**
- `Lancamentos no cartao\s+([\d.,]+)` -> domestic total (verified: 7,530.87)
- `Total lancamentos inter\.\s+em R\$\s+([\d.,]+)` -> international total (verified: 2,279.92)
- `Lancamentos produtos e servicos\s+([\d.,]+)` -> fees total (verified: 21.99)
- Sum MUST equal `Total desta fatura` -- if not, re-check manual extraction

**Verified Feb 2026**: 66 transactions, R$ 9,832.78 exact match (manual extraction).

---

## Nubank

**Layout**: Clean single-column. Most parse-friendly of the three.

**Regex pattern:**
```
^(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(.+?)\s+([-−]?)R\$\s*([\d.,]+)$
```

**Parsing rules:**
- Start after "TRANSACOES DE" line
- Stop at "Pagamentos" or "Em cumprimento"
- Strip card prefix `•••• NNNN` from descriptions
- Unicode minus `−` (U+2212) for negative amounts -- NOT ASCII hyphen
- Extract installment: `- Parcela (\d+/\d+)` in description
- Skip USD conversion lines (e.g., `USD 10.46`) and `Conversao:` lines

**Pitfall**: "Ajuste a credito" uses Unicode minus `−R$`, not `-R$`.
If your regex only matches ASCII `-`, you'll miss refunds.

**Year inference**: DEZ transactions in a FEV bill -> previous year (2025, not 2026).

**Verified Feb 2026**: 42 transactions, R$ 1,676.56 exact match.

---

## BradesCard

**Layout**: Two-column with "Limites" table on the right side of page 2.
The Limites values merge into transaction lines, inflating totals if you grab the wrong amount.

**Regex pattern:**
```
^(\d{2}/\d{2})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})(-?)
```

**CRITICAL section boundaries**: Without these, regex picks up Limites table + boleto
numbers, inflating the sum ~20x (observed: R$ 12,229.70 instead of R$ 572.63).

**Parsing rules:**
- **START** after line matching "MARCOS HEIDEMANN" + "5373" (cardholder + card number)
- **STOP** at "Resumo dos encargos" or "Total parcelado" -- do NOT parse beyond this
- Skip "PAGAMENTO RECEBIDO" lines
- Trailing `-` means negative (refund)
- Use non-greedy match -- capture only the FIRST monetary amount per line
- Most descriptions are "AMAZON BR SAO PAULO BRA" -- differentiate by date/amount

**Verified Feb 2026**: 14 transactions (9 purchases + 5 refunds), R$ 572.63 exact match.
