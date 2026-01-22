---
description: "Transcribe audio/video files using Whisper AI. Run without arguments for guided mode."
argument-hint: "[FILE] [--model MODEL] [--format FORMAT] [--output PATH] [--language LANG] [--all]"
---

# Meeting Transcription Command

You are executing the `/meeting:transcribe` command to transcribe audio or video files.

## Your Mission

Help the user transcribe a meeting recording using the best available Whisper backend for their platform:
- **Apple Silicon Mac**: Use `uvx mlx-whisper` (native MLX acceleration) - FASTEST
- **Other platforms**: Use `uvx insanely-fast-whisper`

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

### Step 3: Detect Platform & Backend

Run this check to determine the best transcription backend:

```bash
# Check platform and available backends
echo "=== Platform Detection ==="
PLATFORM=$(uname -s)
ARCH=$(uname -m)
echo "Platform: $PLATFORM $ARCH"

USE_BACKEND="none"

# Check for Apple Silicon Mac
if [[ "$PLATFORM" == "Darwin" && "$ARCH" == "arm64" ]]; then
    echo "Device: Apple Silicon Mac"

    # Priority 1: uvx mlx-whisper
    if command -v uvx &>/dev/null && uvx mlx-whisper --help &>/dev/null 2>&1; then
        echo "Backend: uvx mlx-whisper (RECOMMENDED)"
        USE_BACKEND="mlx-uvx"
    # Priority 2: pip-installed mlx-whisper
    elif python3 -c "import mlx_whisper" 2>/dev/null; then
        echo "Backend: mlx_whisper (pip installed)"
        USE_BACKEND="mlx-pip"
    # Priority 3: uvx insanely-fast-whisper with MPS
    elif command -v uvx &>/dev/null; then
        echo "Backend: uvx insanely-fast-whisper (MPS)"
        USE_BACKEND="ifwhisper"
    fi
else
    # Non-Mac: uvx insanely-fast-whisper
    if command -v uvx &>/dev/null; then
        echo "Backend: uvx insanely-fast-whisper"
        USE_BACKEND="ifwhisper"
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

#### For Apple Silicon Mac (uvx mlx-whisper - RECOMMENDED):

```bash
uvx mlx-whisper "$TRANSCRIBE_FILE" \
    --model "mlx-community/whisper-MODEL-mlx" \
    --language LANG \
    --output-format FORMAT \
    --output-dir "$(dirname "$FILE")"
```

**MLX Model mapping:**
- tiny → `mlx-community/whisper-tiny-mlx`
- base → `mlx-community/whisper-base-mlx`
- small → `mlx-community/whisper-small-mlx`
- medium → `mlx-community/whisper-medium-mlx`
- large-v3 → `mlx-community/whisper-large-v3-mlx`
- turbo → `mlx-community/whisper-large-v3-turbo` (if available, else large-v3)

#### For Apple Silicon Mac (pip-installed mlx_whisper):

```bash
mlx_whisper \
    --model "mlx-community/whisper-MODEL-mlx" \
    --language LANG \
    --output-format FORMAT \
    --output-dir "$(dirname "$FILE")" \
    "$TRANSCRIBE_FILE"
```

#### For Other Platforms (uvx + insanely-fast-whisper):

```bash
uvx insanely-fast-whisper \
    --file-name "$TRANSCRIBE_FILE" \
    --model-name "openai/whisper-MODEL" \
    --device-id DEVICE \
    --transcript-path "OUTPUT_PATH" \
    --batch-size 24
```

**Device mapping:**
- Apple Silicon: `--device-id mps` (but prefer MLX instead!)
- NVIDIA GPU: `--device-id 0` (CUDA)
- CPU: `--device-id -1`

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
| No backend found | Install uv (curl -LsSf https://astral.sh/uv/install.sh \| sh) |
| Video file, no ffmpeg | Ask user to install ffmpeg |
| File not found | Ask user to verify path |
| Out of memory | Suggest smaller model (small or tiny) |
| MLX error | Try with smaller batch or different model |

## Installation Requirements

**For Apple Silicon Mac (recommended - uvx):**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
# Then restart terminal
```

**Alternative: pip install mlx-whisper:**
```bash
pip install mlx-whisper
```

**For other platforms:**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
# Then restart terminal
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

| Backend | Platform | Speed | Stability | Notes |
|---------|----------|-------|-----------|-------|
| `uvx mlx-whisper` | Mac (Apple Silicon) | ⚡⚡⚡⚡ | ✅ Excellent | Native Metal, fastest option |
| `mlx_whisper` (pip) | Mac (Apple Silicon) | ⚡⚡⚡⚡ | ✅ Excellent | Native Metal acceleration |
| `uvx insanely-fast-whisper` | Any (with GPU) | ⚡⚡⚡ | ⚠️ May crash on long files | Uses HuggingFace transformers |
| `faster-whisper` | Any | ⚡⚡ | ✅ Good | CTranslate2 backend |
