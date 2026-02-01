---
description: "Transcribe audio/video files using Whisper AI. Run without arguments for guided mode."
argument-hint: "[FILE] [--model MODEL] [--format FORMAT] [--output PATH] [--language LANG] [--all]"
---

# Meeting Transcription Command

You are executing the `/meeting:transcribe` command to transcribe audio or video files.

## Your Mission

Help the user transcribe a meeting recording using the most reliable Whisper backend:
- **Default (All platforms)**: Use `faster-whisper` with **VAD enabled** - MOST RELIABLE, prevents hallucinations
- **Fast mode (Apple Silicon)**: Use `uvx --from mlx-whisper mlx_whisper` - faster but may hallucinate on long files

**IMPORTANT**: Always use VAD (Voice Activity Detection) by default to prevent hallucinations on long recordings.

Use **interactive guided mode** to collect missing parameters.

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

**File Selection** (if FILE not provided):
```
Question: "Which file do you want to transcribe?"
Options:
- Search current directory for audio/video files
- Let me paste a path
- Browse recent files
```

**Model Selection** (if --model not provided):
```
Question: "Which model quality do you want?"
Options:
- large-v3 (Recommended) - Highest fidelity, slowest
- turbo - Fast + quality balance
- small - Quick processing
- tiny - Fastest, lower quality
```

**Format Selection** (if --format not provided):
```
Question: "What output format?"
Options:
- txt (Recommended) - Plain text transcript
- srt - SubRip subtitles with timestamps
- vtt - WebVTT subtitles
- json - Full data with segments
```

**Language Selection** (if --language not provided):
```
Question: "What language is the audio?"
Options:
- Auto-detect (Recommended)
- English
- Spanish
- Portuguese
- French
```

### Step 3: Detect Platform & Check faster-whisper

**faster-whisper with VAD is the default** because it prevents hallucinations on long recordings.

```bash
# Check if faster-whisper is available
echo "=== Backend Detection ==="
PLATFORM=$(uname -s)
ARCH=$(uname -m)
echo "Platform: $PLATFORM $ARCH"

# Check for faster-whisper (default, most reliable)
if python3 -c "from faster_whisper import WhisperModel" 2>/dev/null; then
    echo "Backend: faster-whisper + VAD (RECOMMENDED) ✅"
    USE_BACKEND="faster-whisper"
else
    echo "⚠️ faster-whisper not installed"
    echo "Install with: pip install faster-whisper"

    # Fallback to mlx-whisper on Apple Silicon
    if [[ "$PLATFORM" == "Darwin" && "$ARCH" == "arm64" ]]; then
        if command -v uvx &>/dev/null; then
            echo "Fallback: mlx-whisper (may hallucinate on long files)"
            USE_BACKEND="mlx-uvx"
        fi
    fi
fi

echo "USE_BACKEND=$USE_BACKEND"
```

### Step 3.5: Check for Embedded Subtitles (Video Files Only)

If the input file is a video, check for existing subtitle tracks before transcribing:

```bash
FILE="USER_FILE"
EXT="${FILE##*.}"

# Check if video file
if [[ "$EXT" =~ ^(mp4|mkv|webm|mov|avi|m4v)$ ]]; then
    echo "Checking for embedded subtitles..."

    SUBTITLE_TRACKS=$(ffprobe -v error -select_streams s -show_entries stream=index:stream_tags=language -of csv=p=0 "$FILE" 2>/dev/null)

    if [ -n "$SUBTITLE_TRACKS" ]; then
        echo "Found subtitle tracks:"
        echo "$SUBTITLE_TRACKS"

        # Count tracks
        TRACK_COUNT=$(echo "$SUBTITLE_TRACKS" | wc -l | tr -d ' ')
        echo "Total tracks: $TRACK_COUNT"

        # Flag for later
        HAS_SUBTITLES=true
    else
        echo "No embedded subtitles found"
        HAS_SUBTITLES=false
    fi
fi
```

**If subtitles found, use `AskUserQuestion`:**
```
Question: "This video has embedded subtitles. What would you like to do?"
Options:
- Use existing subtitles (Recommended) - Fast, already synced
- Transcribe anyway - Get a fresh AI transcription
- Extract all subtitle tracks - Get all available languages
```

**If user chooses to extract:**
```bash
# Extract first subtitle track
OUTPUT_SUB="${FILE%.*}.srt"
ffmpeg -i "$FILE" -map 0:s:0 "$OUTPUT_SUB" -y 2>/dev/null

if [ -f "$OUTPUT_SUB" ]; then
    echo "✅ Extracted subtitles: $OUTPUT_SUB"
fi
```

**If user chooses to extract ALL tracks:**
```bash
# Extract all subtitle tracks with language suffix
ffprobe -v error -select_streams s -show_entries stream=index:stream_tags=language -of csv=p=0 "$FILE" 2>/dev/null | while IFS=',' read -r idx lang; do
    lang=${lang:-"track$idx"}
    OUTPUT_SUB="${FILE%.*}.${lang}.srt"
    ffmpeg -i "$FILE" -map "0:s:$idx" "$OUTPUT_SUB" -y 2>/dev/null
    echo "Extracted: $OUTPUT_SUB"
done
```

### Step 4: Extract Audio (if video file)

If the input file is a video (mp4, mkv, webm, mov, avi), extract audio first:

```bash
FILE="USER_FILE"
EXT="${FILE##*.}"

# Check if video file (needs audio extraction)
if [[ "$EXT" =~ ^(mp4|mkv|webm|mov|avi|m4v)$ ]]; then
    echo "Video file detected - extracting audio..."
    AUDIO_FILE="${FILE%.*}.wav"

    # Extract audio with ffmpeg (16kHz mono WAV for Whisper)
    ffmpeg -i "$FILE" -vn -acodec pcm_s16le -ar 16000 -ac 1 "$AUDIO_FILE" -y

    if [ $? -eq 0 ]; then
        echo "Audio extracted: $AUDIO_FILE"
        TRANSCRIBE_FILE="$AUDIO_FILE"
        CLEANUP_AUDIO=true
    else
        echo "ERROR: Failed to extract audio. Is ffmpeg installed?"
        exit 1
    fi
else
    TRANSCRIBE_FILE="$FILE"
    CLEANUP_AUDIO=false
fi
```

### Step 5: Execute Transcription

#### DEFAULT: faster-whisper with VAD (RECOMMENDED - prevents hallucinations)

```python
from faster_whisper import WhisperModel
import json
import time

FILE = "USER_FILE"  # Replace with actual file path
LANGUAGE = "LANG"   # Replace with language code or None for auto-detect
MODEL = "MODEL"     # Replace with model name (large-v3, turbo, small, etc.)
OUTPUT_DIR = "OUTPUT_DIR"  # Replace with output directory

print(f"🎙️ Transcribing with VAD filter (prevents hallucinations)...")
print(f"   Model: {MODEL}")
print(f"   Language: {LANGUAGE or 'auto-detect'}")
print(f"   VAD: enabled ✅")
print()

start_time = time.time()

# Load model (CPU with int8 for stability, or cuda:0 for NVIDIA GPU)
model = WhisperModel(MODEL, device="cpu", compute_type="int8")

# Transcribe with VAD enabled - CRITICAL for preventing hallucinations
segments, info = model.transcribe(
    FILE,
    language=LANGUAGE if LANGUAGE != "auto" else None,
    beam_size=5,
    vad_filter=True,  # ← ALWAYS ENABLED BY DEFAULT
    vad_parameters=dict(
        min_silence_duration_ms=500,
        speech_pad_ms=400,
    )
)

# Collect all segments
all_segments = []
full_text = []
for segment in segments:
    all_segments.append({
        "start": segment.start,
        "end": segment.end,
        "text": segment.text.strip()
    })
    full_text.append(segment.text.strip())
    if len(all_segments) % 50 == 0:
        print(f"   Processed {len(all_segments)} segments...")

# Generate output file paths
import os
base_name = os.path.splitext(os.path.basename(FILE))[0]
output_txt = os.path.join(OUTPUT_DIR, f"{base_name}.txt")
output_json = os.path.join(OUTPUT_DIR, f"{base_name}.json")

# Save outputs
with open(output_json, "w", encoding="utf-8") as f:
    json.dump({"language": info.language, "segments": all_segments}, f, ensure_ascii=False, indent=2)

with open(output_txt, "w", encoding="utf-8") as f:
    f.write("\n".join(full_text))

elapsed = time.time() - start_time
print()
print(f"✅ Transcription complete!")
print(f"   Segments: {len(all_segments)}")
print(f"   Time: {elapsed/60:.1f} minutes")
print(f"   Output: {output_txt}")
```

**Model options:**
- `large-v3` - Highest quality (recommended for important meetings)
- `turbo` - Good balance of speed and quality
- `medium` - Faster, still good quality
- `small` - Quick processing
- `tiny` - Fastest, lower quality

#### FALLBACK: mlx-whisper (Apple Silicon only, faster but may hallucinate)

Only use this if faster-whisper is not available or user explicitly requests fast mode:

```bash
uvx --from mlx-whisper mlx_whisper "$TRANSCRIBE_FILE" \
    --model "mlx-community/whisper-large-v3-mlx" \
    --language LANG \
    --output-format txt \
    --output-dir "$(dirname "$FILE")"
```

⚠️ **Warning**: mlx-whisper does NOT have VAD and may hallucinate on long recordings (producing repetitive "E aí", "Tchau", "Thank you" etc.)

### Step 6: Cleanup & Report

```bash
# Remove temporary WAV if we extracted it
if [ "$CLEANUP_AUDIO" = true ]; then
    rm "$AUDIO_FILE"
    echo "Cleaned up temporary audio file"
fi

# Report success
echo ""
echo "✅ Transcription complete!"
echo "   Input: $FILE"
echo "   Output: OUTPUT_FILE"
echo "   Model: MODEL"
echo "   Language: LANG"
```

After successful transcription, offer:
```
Transcription complete!

📁 File: meeting-recording.mp4
🎯 Model: large-v3
⏱️ Duration: 45:32
📄 Output: meeting-recording.txt

Would you like me to:
- Summarize this transcript (/meeting:summarize)
- Add speaker labels (/meeting:diarize)
```

## Default Values

When `--all` flag is used or for any missing values after prompts:
- Model: `large-v3`
- Format: `txt`
- Language: `auto` (omit --language flag for auto-detect)
- Output: Same directory as input, same name with new extension

## Error Handling

| Error | Solution |
|-------|----------|
| `faster-whisper` not installed | `pip install faster-whisper` |
| Video file, no ffmpeg | `brew install ffmpeg` or `apt install ffmpeg` |
| File not found | Ask user to verify path |
| Out of memory | Suggest smaller model (small or tiny) |
| Slow on CPU | Normal for large-v3; use `turbo` or `small` for speed |

## Why VAD is the Default

**VAD (Voice Activity Detection)** prevents hallucinations by:
1. Pre-filtering audio to identify actual speech regions
2. Skipping silence and noise that confuses the model
3. Providing clear speech boundaries for transcription

### Signs of Hallucination (if you use mlx-whisper without VAD)

- Same phrase repeating every 30 seconds ("E aí", "Tchau", "Thank you")
- Output is mostly filler words
- Transcript length is suspiciously short for a long recording
- Timestamps are evenly spaced (30s, 60s, 90s...) instead of natural speech patterns

### If Transcription Fails

1. **Check audio file**: `ffprobe -v error -show_format audio.mp4`
2. **Try smaller model**: Use `small` or `medium` instead of `large-v3`
3. **Check disk space**: Large models need ~3GB of space

## Installation Requirements

**Required: faster-whisper (all platforms):**
```bash
pip install faster-whisper
```

**Optional: mlx-whisper (Apple Silicon only, for fast mode):**
```bash
pip install mlx-whisper
# Or use uvx:
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**For video file support (all platforms):**
```bash
brew install ffmpeg  # or: apt install ffmpeg
```

## Output Naming Convention

If no `--output` specified:
- Input: `meeting-2024-01-15.mp4`
- Output: `meeting-2024-01-15.txt` (or .srt, .vtt, .json)

Place output in same directory as input file.

## Backend Comparison

| Backend | Platform | Speed | Reliability | Notes |
|---------|----------|-------|-------------|-------|
| **`faster-whisper` + VAD** | Any | ⚡⚡ | ⭐⭐⭐ BEST | **DEFAULT - Prevents hallucinations** |
| `mlx-whisper` | Mac (Apple Silicon) | ⚡⚡⚡⚡ | ⚠️ May hallucinate | Fast but no VAD support |
| `insanely-fast-whisper` | Any (with GPU) | ⚡⚡⚡ | ⚠️ May crash | Uses HuggingFace transformers |

### Recommended Approach

1. **Default**: `faster-whisper` with `vad_filter=True` (most reliable, prevents hallucinations)
2. **Fast mode**: `mlx-whisper` (only if you're sure the audio won't cause hallucinations)
3. **For speaker diarization**: Use `/meeting:diarize` instead
