# MLX-Whisper + Silero VAD Transcription

This reference contains the Python implementation for transcribing audio on Apple Silicon Macs using MLX-Whisper with Silero VAD for hallucination prevention.

## When to Use

- Platform: Apple Silicon Mac (M1/M2/M3/M4)
- Backend: `mlx-vad`
- Benefits: GPU speed + VAD reliability

## Configuration Variables

Replace these before running:
- `FILE` - Audio file path (WAV 16kHz recommended)
- `LANGUAGE` - Language code (e.g., "pt", "en") or None for auto-detect
- `MODEL` - MLX model path (see model options below)
- `OUTPUT_DIR` - Directory for output files
- `VAD_THRESHOLD` - Voice activity detection threshold (see below)
- `NO_VAD` - Set to True to skip VAD entirely (for problematic audio)

## VAD Threshold Selection (2026-02 Update)

**Analyze audio volume first, then set threshold:**

| Audio Quality | Mean Volume | VAD_THRESHOLD | MIN_SEGMENT_SECONDS |
|---------------|-------------|---------------|---------------------|
| Good (loud) | > -20 dB | 0.5 | 5 |
| Moderate | -20 to -30 dB | 0.35 | 3 |
| Poor (quiet) | < -30 dB | 0.25 | 2 |
| Skip VAD | Any | N/A | N/A |

**Lesson learned (2026-02):** Even with threshold 0.25, VAD may miss speech in very quiet recordings. If user says "talking most of the time" but VAD captures <60%, offer `--no-vad` option.

## MLX Model Options

| Model | Path | Notes |
|-------|------|-------|
| turbo (recommended) | `mlx-community/whisper-large-v3-turbo` | Best speed/quality |
| large-v3 | `mlx-community/whisper-large-v3-mlx` | Highest quality |
| small | `mlx-community/whisper-small-mlx` | Quick processing |
| tiny | `mlx-community/whisper-tiny-mlx` | Fastest |

## Implementation

```python
"""
Silero VAD + MLX-Whisper Transcription
Tested on Apple Silicon (M1/M2/M3/M4)
"""

import numpy as np
import torch
import mlx_whisper
import soundfile as sf
import json
import time
import os
from typing import List, Dict, Optional

# ============================================================================
# Configuration - Replace these values
# ============================================================================

FILE = "USER_FILE"           # Audio file path (WAV 16kHz recommended)
LANGUAGE = "LANG"            # Language code (e.g., "pt", "en") or None
MODEL = "mlx-community/whisper-large-v3-turbo"  # MLX model
OUTPUT_DIR = "OUTPUT_DIR"    # Output directory

# ============================================================================
# Silero VAD Setup
# ============================================================================

def load_silero_vad():
    """Load Silero VAD model (CPU-optimized, ~1.8MB)"""
    torch.set_num_threads(1)
    model, utils = torch.hub.load(
        repo_or_dir='snakers4/silero-vad',
        model='silero_vad',
        force_reload=False
    )
    return model, utils

def get_speech_segments(wav, vad_model, get_speech_timestamps, sampling_rate=16000, vad_threshold=0.5):
    """Detect speech segments using Silero VAD

    Parameters optimized for long meetings (based on 2026-02 research):
    - threshold: Adapt based on audio quality (0.25-0.5)
    - min_silence_duration_ms=500: Better for conversational speech
    - speech_pad_ms=300: Balance between tight and capturing full words

    2026-02 Update: Added vad_threshold parameter for adaptive detection
    """
    speech_timestamps = get_speech_timestamps(
        wav, vad_model,
        threshold=vad_threshold,       # ADAPTIVE: Set based on audio analysis
        min_speech_duration_ms=300,    # Lowered to catch short responses
        min_silence_duration_ms=500,   # Keep short for conversation
        speech_pad_ms=300,             # Balanced padding
        sampling_rate=sampling_rate,
        return_seconds=False
    )
    return speech_timestamps

# 2026-02 Update: Made configurable based on audio quality
MIN_SEGMENT_SECONDS = 3  # Default; can be lowered for quiet audio

def merge_segments(segments, max_gap_samples, max_segment_samples):
    """Merge close segments, respecting 30s Whisper optimal window"""
    if not segments:
        return []

    merged = []
    current = segments[0].copy()

    for seg in segments[1:]:
        gap = seg['start'] - current['end']
        combined = seg['end'] - current['start']

        if gap <= max_gap_samples and combined <= max_segment_samples:
            current['end'] = seg['end']
        else:
            merged.append(current)
            current = seg.copy()

    merged.append(current)
    return merged

# ============================================================================
# Main Pipeline
# ============================================================================

print(f"🎙️ Transcribing with Silero VAD + MLX-Whisper")
print(f"   Model: {MODEL}")
print(f"   Language: {LANGUAGE or 'auto-detect'}")
print(f"   VAD: enabled ✅")
print()

start_time = time.time()
sampling_rate = 16000

# Step 1: Load VAD
print("Loading Silero VAD...")
vad_model, utils = load_silero_vad()
get_speech_timestamps, _, read_audio, _, _ = utils

# Step 2: Read audio and detect speech
print(f"Detecting speech in: {FILE}")
wav = read_audio(FILE, sampling_rate=sampling_rate)
segments = get_speech_segments(wav, vad_model, get_speech_timestamps, sampling_rate)

if not segments:
    print("No speech detected!")
    exit(1)

total_duration = len(wav) / sampling_rate
speech_duration = sum((s['end'] - s['start']) / sampling_rate for s in segments)
print(f"Found {len(segments)} speech segments ({speech_duration:.1f}s speech / {total_duration:.1f}s total)")

# Step 3: Merge close segments
max_segment_samples = int(30 * sampling_rate)  # 30 seconds
merge_gap_samples = int(3 * sampling_rate)      # 3 seconds
merged = merge_segments(segments, merge_gap_samples, max_segment_samples)

# Step 3.5: Filter short segments (prevents hallucinations on noise)
min_samples = int(MIN_SEGMENT_SECONDS * sampling_rate)
filtered = [s for s in merged if (s['end'] - s['start']) >= min_samples]
print(f"Segments: {len(segments)} detected → {len(merged)} merged → {len(filtered)} kept (min {MIN_SEGMENT_SECONDS}s)")

# Step 4: Transcribe each segment with MLX
wav_np = wav.numpy() if hasattr(wav, 'numpy') else np.array(wav)
all_text = []
all_segments = []

for i, seg in enumerate(filtered):
    start_sample = seg['start']
    end_sample = seg['end']
    start_time_seg = start_sample / sampling_rate
    end_time_seg = end_sample / sampling_rate

    print(f"  [{i+1}/{len(filtered)}] {start_time_seg:.1f}s - {end_time_seg:.1f}s")

    chunk = wav_np[start_sample:end_sample].astype(np.float32)

    # Anti-hallucination settings based on 2026 research
    # See: .documentation/whisper-long-meeting-transcription-best-practices-2026-02-03.md
    result = mlx_whisper.transcribe(
        chunk,
        path_or_hf_repo=MODEL,
        language=LANGUAGE if LANGUAGE and LANGUAGE != "auto" else None,
        condition_on_previous_text=False,  # CRITICAL: Prevents repetition loops
        word_timestamps=True,
        hallucination_silence_threshold=0.5,
        # Anti-hallucination settings (2026 best practices)
        compression_ratio_threshold=1.35,  # Catches repetitive output
        no_speech_threshold=0.2,           # Reduces hallucinations in silence
        temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0),  # Fallback temps for retries
    )

    text = result.get('text', '').strip()
    if text:
        all_text.append(text)
        for s in result.get('segments', []):
            s['start'] += start_time_seg
            s['end'] += start_time_seg
            all_segments.append(s)

# Step 5: Save outputs
base_name = os.path.splitext(os.path.basename(FILE))[0]
output_txt = os.path.join(OUTPUT_DIR, f"{base_name}.txt")
output_json = os.path.join(OUTPUT_DIR, f"{base_name}.json")

with open(output_txt, "w", encoding="utf-8") as f:
    f.write("\n".join(all_text))

with open(output_json, "w", encoding="utf-8") as f:
    json.dump({
        "language": result.get('language', LANGUAGE),
        "segments": all_segments
    }, f, ensure_ascii=False, indent=2)

elapsed = time.time() - start_time
print()
print(f"✅ Transcription complete!")
print(f"   Segments: {len(all_segments)}")
print(f"   Time: {elapsed/60:.1f} minutes")
print(f"   Output: {output_txt}")
```

## Why Silero VAD + MLX?

1. **GPU Speed**: MLX uses Metal GPU - 3-5x faster than CPU
2. **VAD Prevents Hallucinations**: Silero detects speech regions, skips silence
3. **Best of Both Worlds**: Fast AND reliable
4. **Lightweight**: Silero VAD is only ~1.8MB, runs on CPU in <1ms per chunk
