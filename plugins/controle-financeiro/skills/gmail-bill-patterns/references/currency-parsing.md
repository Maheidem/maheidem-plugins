# Currency Parsing Rules

Two different currency formats appear in financial emails:

## Brazilian Format (BRL) -- All Providers Except Husky

Format: `R$ 9.832,78` (period = thousands separator, comma = decimal separator)

```python
def parse_brl(text: str) -> float:
    # "R$ 9.832,78" -> 9832.78
    cleaned = text.replace("R$", "").strip()
    cleaned = cleaned.replace(".", "").replace(",", ".")
    return float(cleaned)
```

Used by: Itau VISA, Nubank, BradesCard, Enel, Naturgy, Claro, C-Com, GARIN

## US-Style Format (BRL) -- Husky Only

Format: `R$ 57,892.01` (comma = thousands separator, period = decimal separator)

```python
def parse_usd_style_brl(text: str) -> float:
    # "R$ 57,892.01" -> 57892.01
    cleaned = text.replace("R$", "").strip()
    cleaned = cleaned.replace(",", "")
    return float(cleaned)
```

Used by: Husky (PJ income transfers)

## Husky Encoding Issues

Husky emails (via SendGrid) may contain non-breaking spaces and HTML entities
around the `R$` symbol. Normalize whitespace BEFORE applying the regex:

```python
import re

def normalize_whitespace(text: str) -> str:
    text = text.replace('\xa0', ' ')    # non-breaking space
    text = text.replace('\u200b', ' ')  # zero-width space
    text = text.replace('&nbsp;', ' ')  # HTML entity
    return text

body = normalize_whitespace(email_body)
match = re.search(r'R\$\s*([\d.,]+)', body)
```

## BradesCard PDF Decryption

BradesCard PDFs are password-protected using CPF digits:

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

- `124198` (6 digits) works for BradesCard
- `12419` (5 digits) works for Itau VISA
- Never mix them up: wrong digit count causes silent failures
