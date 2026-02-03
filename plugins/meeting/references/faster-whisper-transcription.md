# faster-whisper Transcription

This reference contains the Python implementation for transcribing audio on non-Apple platforms using faster-whisper with built-in VAD.

## When to Use

- Platform: NVIDIA GPU, other GPU, or CPU-only systems
- Backend: `faster-whisper`
- Benefits: Wide compatibility, built-in VAD support

## Configuration Variables

Replace these before running:
- `FILE` - Audio file path (WAV 16kHz recommended)
- `LANGUAGE` - Language code (e.g., "pt", "en") or "auto"
- `MODEL` - Whisper model name (see model options below)
- `OUTPUT_DIR` - Directory for output files

## Model Options

| Model | Speed | Quality | Notes |
|-------|-------|---------|-------|
| tiny | Fastest | Low | Quick drafts |
| base | Fast | Medium | Fast processing |
| small | Medium | Good | Balanced |
| medium | Slow | High | High quality |
| large-v3 | Slowest | Best | Maximum fidelity |
| turbo | Medium | High | Good balance |

## Device Detection

The implementation auto-detects the best compute device:
- **CUDA**: NVIDIA GPU with float16 (fastest)
- **CPU**: int8 quantization (wide compatibility)

## Implementation

```python
from faster_whisper import WhisperModel
import json, time, os

FILE = "USER_FILE"
LANGUAGE = "LANG"
MODEL = "large-v3"
OUTPUT_DIR = "OUTPUT_DIR"

print(f"🎙️ Transcribing with faster-whisper + VAD")
start_time = time.time()

# Auto-detect device and compute type
import torch
if torch.cuda.is_available():
    device = "cuda"
    compute_type = "float16"
else:
    device = "cpu"
    compute_type = "int8"

model = WhisperModel(MODEL, device=device, compute_type=compute_type)

# Anti-hallucination settings based on 2026 research
# See: .documentation/whisper-long-meeting-transcription-best-practices-2026-02-03.md
segments, info = model.transcribe(
    FILE,
    language=LANGUAGE if LANGUAGE != "auto" else None,
    beam_size=1,  # Greedy decoding - lowest hallucination rate (was 5)
    vad_filter=True,
    vad_parameters=dict(
        min_silence_duration_ms=500,  # Better for conversational speech
        speech_pad_ms=200,            # Tighter segments (was 400)
        threshold=0.5,
    ),
    # Anti-hallucination settings (2026 best practices)
    condition_on_previous_text=False,  # Prevents repetition loops
    compression_ratio_threshold=1.35,  # Catches repetitive output
    logprob_threshold=-0.5,            # Rejects low-confidence segments
    no_speech_threshold=0.2,           # Reduces hallucinations in silence
    temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0),  # Fallback temps for retries
)

all_segments = []
full_text = []
for seg in segments:
    all_segments.append({"start": seg.start, "end": seg.end, "text": seg.text.strip()})
    full_text.append(seg.text.strip())

base_name = os.path.splitext(os.path.basename(FILE))[0]
output_txt = os.path.join(OUTPUT_DIR, f"{base_name}.txt")

with open(output_txt, "w", encoding="utf-8") as f:
    f.write("\n".join(full_text))

print(f"✅ Done in {(time.time()-start_time)/60:.1f} min: {output_txt}")
```

## NVIDIA GPU Setup

For NVIDIA GPU acceleration:
```bash
pip install faster-whisper
# CUDA toolkit should be installed
nvidia-smi  # Verify GPU is detected
```

## CPU Fallback

If no GPU is available, faster-whisper will use CPU with int8 quantization for reasonable performance.
