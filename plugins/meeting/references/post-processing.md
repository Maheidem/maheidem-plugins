# Post-Processing: Hallucination Detection

This reference contains utilities for detecting and filtering common Whisper hallucinations in transcription output.

## When to Use

Apply post-processing when:
- Transcribing long meetings (>30 minutes)
- Working with audio that has silence gaps
- Noticing repetitive phrases in output
- Output quality seems degraded

## Common Hallucination Patterns

Whisper models may hallucinate these phrases during silence or noise:

```python
KNOWN_HALLUCINATIONS = [
    # YouTube/video artifacts
    "thank you for watching",
    "please subscribe",
    "like and subscribe",
    "thanks for watching",
    "see you in the next video",
    "don't forget to subscribe",

    # Generic filler
    "thank you",
    "thanks",
    "you",
    "...",

    # Music/audio artifacts
    "[music]",
    "[applause]",
    "(music)",
    "(applause)",

    # Common foreign hallucinations
    "sous-titres",  # French: "subtitles"
    "sous-titrage",
    "amara.org",
]
```

## N-gram Repetition Detection

Detect repetitive content that indicates hallucination:

```python
from collections import Counter
import re

def detect_repetition(text: str, n: int = 3, threshold: int = 3) -> bool:
    """
    Detect if text contains excessive n-gram repetition.

    Args:
        text: Text to analyze
        n: Size of n-grams (default: 3 words)
        threshold: Number of repeats to flag (default: 3)

    Returns:
        True if repetition detected (likely hallucination)

    Example:
        >>> detect_repetition("I said I said I said hello")
        True
    """
    words = text.lower().split()
    if len(words) < n * threshold:
        return False

    ngrams = [' '.join(words[i:i+n]) for i in range(len(words) - n + 1)]
    counts = Counter(ngrams)

    max_count = max(counts.values()) if counts else 0
    return max_count >= threshold


def remove_repeated_sentences(text: str) -> str:
    """
    Remove consecutive duplicate sentences.

    Args:
        text: Text with potential duplicates

    Returns:
        Text with duplicates removed

    Example:
        >>> remove_repeated_sentences("Hello. Hello. How are you?")
        'Hello. How are you?'
    """
    # Split into sentences (handles multiple punctuation styles)
    sentences = re.split(r'(?<=[.!?])\s+', text)

    result = []
    prev = None
    for sentence in sentences:
        normalized = sentence.strip().lower()
        if normalized != prev and normalized:
            result.append(sentence.strip())
            prev = normalized

    return ' '.join(result)
```

## Full Post-Processing Pipeline

```python
def clean_transcription(segments: list) -> list:
    """
    Apply all hallucination filters to transcription segments.

    Args:
        segments: List of dicts with 'text', 'start', 'end' keys

    Returns:
        Cleaned segment list
    """
    cleaned = []

    for seg in segments:
        text = seg.get('text', '').strip()

        # Skip empty
        if not text:
            continue

        # Skip known hallucinations
        text_lower = text.lower()
        if any(h in text_lower for h in KNOWN_HALLUCINATIONS):
            # Only skip if segment is SHORT (likely just the hallucination)
            if len(text) < 50:
                continue

        # Skip repetitive content
        if detect_repetition(text):
            continue

        # Clean duplicate sentences within segment
        text = remove_repeated_sentences(text)

        if text:
            cleaned.append({
                'start': seg['start'],
                'end': seg['end'],
                'text': text
            })

    return cleaned
```

## Integration Example

Use after transcription but before saving:

```python
# After transcription completes...
all_segments = [...]  # Your transcription output

# Apply post-processing
cleaned_segments = clean_transcription(all_segments)

# Rebuild full text
full_text = '\n'.join(s['text'] for s in cleaned_segments)

# Save cleaned output
with open(output_txt, 'w') as f:
    f.write(full_text)
```

## When NOT to Use

Post-processing can over-filter in these cases:
- Content that legitimately repeats (songs, chants, mantras)
- Non-English content (hallucination patterns differ)
- Very short clips (<30 seconds)

## Tips for Long Meetings

1. **Use `turbo` or `large-v3` models** - they hallucinate less
2. **VAD is essential** - filters silence before transcription
3. **Watch for patterns** - same phrase every ~30 seconds = hallucination
4. **Spot check** - listen to flagged sections if unsure
5. **Segment boundaries** - hallucinations often occur at segment starts/ends

## Recognizing Hallucinations

Signs that output contains hallucinations:
- Same phrase repeats at regular intervals
- YouTube-related phrases in non-YouTube content
- Foreign language snippets in English audio
- Phrases that don't match speaker's voice/style
- Text during obviously silent sections
