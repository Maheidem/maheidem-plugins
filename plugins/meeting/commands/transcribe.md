---
description: "Transcribe audio/video files using Whisper AI. Run without arguments for guided mode."
argument-hint: "[FILE] [--model MODEL] [--format FORMAT] [--output PATH] [--language LANG] [--all]"
---

# Meeting Transcription Command

You are executing the `/meeting:transcribe` command to transcribe audio or video files.

## Your Mission

Help the user transcribe a meeting recording using the best backend for their platform:
- **Apple Silicon Mac**: Use **Silero VAD + mlx-whisper** - FAST (GPU) + RELIABLE (VAD prevents hallucinations)
- **Other platforms**: Use `faster-whisper` with VAD enabled

**IMPORTANT**: Always use VAD (Voice Activity Detection) to prevent hallucinations on long recordings.

## Execution Flow

### Step 1: Parse Arguments

Check what the user provided:
- `FILE` - Path to audio/video file
- `--model` - Whisper model (tiny, base, small, medium, large-v3, turbo)
- `--format` - Output format (txt, srt, vtt, json)
- `--output` - Custom output path
- `--language` - Language code (e.g., en, es, fr, pt) or "auto"
- `--all` - Skip all prompts, use defaults

### Step 2: Interactive Mode (for missing parameters)

If `--all` flag is NOT set, use `AskUserQuestion` for each missing parameter:

**Model Selection** (if --model not provided):
```
Question: "Which model quality do you want?"
Options:
- large-v3-turbo (Recommended) - Best speed/quality balance for MLX
- large-v3 - Highest quality, slower
- small - Quick processing
- tiny - Fastest, lower quality
```

**Language Selection** (if --language not provided):
```
Question: "What language is the audio?"
Options:
- Auto-detect (Recommended)
- English
- Portuguese
- Spanish
- French
```

### Step 3: Detect Platform & Backend

```bash
echo "=== Platform Detection ==="
PLATFORM=$(uname -s)
ARCH=$(uname -m)
echo "Platform: $PLATFORM $ARCH"

if [[ "$PLATFORM" == "Darwin" && "$ARCH" == "arm64" ]]; then
    echo "Apple Silicon detected - using Silero VAD + MLX (fastest + reliable)"
    USE_BACKEND="mlx-vad"
else
    echo "Using faster-whisper + VAD"
    USE_BACKEND="faster-whisper"
fi
```

### Step 4: Convert to WAV (if needed)

Always convert to 16kHz mono WAV for optimal VAD and Whisper performance:

```bash
FILE="USER_FILE"
EXT="${FILE##*.}"
WAV_FILE="${FILE%.*}.wav"

# Convert to 16kHz mono WAV
if [[ ! -f "$WAV_FILE" ]] || [[ "$FILE" -nt "$WAV_FILE" ]]; then
    echo "Converting to 16kHz mono WAV..."
    ffmpeg -i "$FILE" -ar 16000 -ac 1 -y "$WAV_FILE" 2>/dev/null
fi
```

### Step 5: Execute Transcription

#### DEFAULT (Apple Silicon): Silero VAD + mlx-whisper

This is the **recommended approach** - combines MLX's GPU speed with VAD's hallucination prevention.

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

def get_speech_segments(wav, vad_model, get_speech_timestamps, sampling_rate=16000):
    """Detect speech segments using Silero VAD"""
    speech_timestamps = get_speech_timestamps(
        wav, vad_model,
        threshold=0.5,
        min_speech_duration_ms=500,  # Increased to reduce noise
        min_silence_duration_ms=2000,
        speech_pad_ms=400,
        sampling_rate=sampling_rate,
        return_seconds=False
    )
    return speech_timestamps

MIN_SEGMENT_SECONDS = 15  # Filter segments shorter than this to avoid hallucinations

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

    result = mlx_whisper.transcribe(
        chunk,
        path_or_hf_repo=MODEL,
        language=LANGUAGE if LANGUAGE and LANGUAGE != "auto" else None,
        condition_on_previous_text=False,  # CRITICAL: Prevents repetition loops
        word_timestamps=True,
        hallucination_silence_threshold=0.5,
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

**MLX Model options:**
- `mlx-community/whisper-large-v3-turbo` - Best speed/quality (recommended)
- `mlx-community/whisper-large-v3-mlx` - Highest quality
- `mlx-community/whisper-small-mlx` - Quick processing
- `mlx-community/whisper-tiny-mlx` - Fastest

#### FALLBACK (Non-Apple Silicon): faster-whisper + VAD

```python
from faster_whisper import WhisperModel
import json, time, os

FILE = "USER_FILE"
LANGUAGE = "LANG"
MODEL = "large-v3"
OUTPUT_DIR = "OUTPUT_DIR"

print(f"🎙️ Transcribing with faster-whisper + VAD")
start_time = time.time()

model = WhisperModel(MODEL, device="cpu", compute_type="int8")
segments, info = model.transcribe(
    FILE,
    language=LANGUAGE if LANGUAGE != "auto" else None,
    beam_size=5,
    vad_filter=True,
    vad_parameters=dict(min_silence_duration_ms=500, speech_pad_ms=400)
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

### Step 6: Cleanup & Report

After successful transcription, offer:
```
Transcription complete!

📁 File: meeting-recording.mp4
🎯 Model: whisper-large-v3-turbo
⏱️ Duration: 45:32
📄 Output: meeting-recording.txt

Would you like me to:
- Summarize this transcript (/meeting:summarize)
- Add speaker labels (/meeting:diarize)
```

## Default Values

- Model: `large-v3-turbo` (MLX) or `large-v3` (faster-whisper)
- Format: `txt`
- Language: `auto`
- Output: Same directory as input

## Installation Requirements

**Apple Silicon Mac:**
```bash
pip install mlx-whisper torch soundfile numpy
# Silero VAD auto-downloads via torch.hub
```

**Other platforms:**
```bash
pip install faster-whisper
```

**All platforms:**
```bash
brew install ffmpeg  # or: apt install ffmpeg
```

## Backend Comparison

| Backend | Platform | Speed | Reliability | Notes |
|---------|----------|-------|-------------|-------|
| **Silero VAD + mlx-whisper** | Apple Silicon | ⚡⚡⚡⚡ | ⭐⭐⭐ BEST | **DEFAULT** - GPU speed + VAD reliability |
| `faster-whisper` + VAD | Any | ⚡⚡ | ⭐⭐⭐ | CPU-only but reliable |
| `mlx-whisper` alone | Apple Silicon | ⚡⚡⚡⚡ | ⚠️ May hallucinate | Fast but risky |

## Why Silero VAD + MLX?

1. **GPU Speed**: MLX uses Metal GPU - 3-5x faster than CPU
2. **VAD Prevents Hallucinations**: Silero detects speech regions, skips silence
3. **Best of Both Worlds**: Fast AND reliable
4. **Lightweight**: Silero VAD is only ~1.8MB, runs on CPU in <1ms per chunk
