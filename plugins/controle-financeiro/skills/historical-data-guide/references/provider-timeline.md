# Provider Timeline

Which financial providers are active per year. Use this to avoid searching for non-existent providers in historical imports.

## Provider Active Periods

| Provider | Gmail Sender | First Seen | Last Seen | Notes |
|----------|-------------|------------|-----------|-------|
| Husky (PJ income) | nf@husky.io | Jan 2024 | present | PJ-era only. Pre-2024 = CLT salary (not in Gmail) |
| Enel (Luz) | faturaporemail@riodejaneiro.enel.com | Jan 2023 | present | UC 8495510 only. Ignore other UCs |
| Naturgy (Gas) | conta.inteligente@naturgy.com | Jan 2023 | present | Client IDs: 5174152-8 and 5132332-7 |
| C-Com (Internet) | boleto@ccomtelecom.com.br | Jan 2023 | Mar 2023 | Old sender, subject "Boleto C-ComTelecom" |
| C-Com (Internet) | nao-responda@nao-responda.ccomtelecom.com.br | Apr 2023 | present | New sender, subject "Lembrete de Pagamento" |
| GARIN (Condominio) | immobileweb@sistemas.alterdata.com.br | Jan 2023 | present | Always validate Ref month in attachment |
| Claro (Telecom) | clarocontas@minhaclaro.com.br | Jan 2025 | present | body is empty, use body_html |
| Nubank CC | todomundo@nubank.com.br | Jan 2023 | present | account_id=1 |
| BradesCard/Amazon CC | faturabradescard@infobradesco.com.br | Oct 2023 | present | account_id=2. Password: 124198 |
| Itau VISA CC | faturadigital@itau.com.br | Dec 2024 | present | account_id=3. Includes Samsung card |

## Year Summary

### 2023 (Pre-PJ / CLT)
- **NO PJ income** (pj_total = 0)
- **Providers**: Enel, Naturgy, C-Com (both senders), GARIN, Nubank CC
- **BradesCard**: Only from October 2023
- **NO**: Husky, Claro, Itau VISA
- **Expenses**: 6 per month (Nubank, Financiamento, Condominio, Luz, Gas, CCom)

### 2024 (PJ Year 1)
- **PJ income**: Husky (some months have 2-3 payments)
- **Providers**: All from 2023 + Husky + BradesCard (full year)
- **Itau VISA**: Only December 2024 (Samsung card)
- **NO**: Claro
- **Expenses**: 9 per month (+ IPVA, Gastos Pontuais, Amazon)

### 2025 (PJ Year 2)
- **All 9 providers active**
- **Expenses**: 11 per month (+ Claro, Cuidado Avos, Quentinha)
- **Samsung**: Merged into Itau VISA

### 2026+ (Current)
- Same as 2025 until changes detected

## Agent Prompt Usage

When building per-month agent prompts, ONLY include providers active in that year:
```python
PROVIDERS_BY_YEAR = {
    2023: ["enel", "naturgy", "ccom", "garin", "nubank_cc", "bradescard_cc"],  # bradescard only Oct+
    2024: ["husky", "enel", "naturgy", "ccom", "garin", "nubank_cc", "bradescard_cc", "itau_cc"],  # itau only Dec
    2025: ["husky", "enel", "naturgy", "ccom", "garin", "claro", "nubank_cc", "bradescard_cc", "itau_cc"],
}
```

For 2023, additionally note in agent prompt:
- "This is a PRE-PJ month. Skip Husky PJ income search. pj_total stays at 0."
- "C-Com: Try BOTH senders (boleto@ first for Jan-Mar, nao-responda@ for Apr+)"
