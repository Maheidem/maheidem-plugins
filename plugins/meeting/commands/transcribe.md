---
description: "Transcribe audio/video files using Whisper AI. Run without arguments for guided mode."
argument-hint: "[FILE] [--model MODEL] [--format FORMAT] [--output PATH] [--language LANG] [--all]"
---

# Meeting Transcription Command

You are executing the `/meeting:transcribe` command to transcribe audio or video files.

## Your Mission

Help the user transcribe a meeting recording using the best available Whisper backend for their platform:
- **Apple Silicon Mac**: Use `mlx_whisper` (native MLX acceleration)
- **Other platforms**: Use `pipx run insanely-fast-whisper` or local `faster-whisper`

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

# Check for Apple Silicon Mac
if [[ "$PLATFORM" == "Darwin" && "$ARCH" == "arm64" ]]; then
    echo "Device: Apple Silicon Mac"

    # Check for MLX Whisper (best for Apple Silicon)
    if python3 -c "import mlx_whisper" 2>/dev/null; then
        echo "Backend: mlx_whisper (RECOMMENDED)"
        echo "USE_BACKEND=mlx"
    elif command -v pipx &>/dev/null; then
        echo "Backend: pipx + insanely-fast-whisper (fallback)"
        echo "USE_BACKEND=pipx"
    else
        echo "Backend: None found"
        echo "USE_BACKEND=none"
    fi
else
    # Non-Mac: use pipx or faster-whisper
    if command -v pipx &>/dev/null; then
        echo "Backend: pipx + insanely-fast-whisper"
        echo "USE_BACKEND=pipx"
    else
        echo "Backend: None found"
        echo "USE_BACKEND=none"
    fi
fi
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

#### For Apple Silicon Mac (MLX Whisper):

```bash
mlx_whisper \
    --model "mlx-community/whisper-MODEL-mlx" \
    --language LANG \
    --output-format FORMAT \
    --output-dir "$(dirname "$FILE")" \
    "$TRANSCRIBE_FILE"
```

**MLX Model mapping:**
- tiny → `mlx-community/whisper-tiny-mlx`
- base → `mlx-community/whisper-base-mlx`
- small → `mlx-community/whisper-small-mlx`
- medium → `mlx-community/whisper-medium-mlx`
- large-v3 → `mlx-community/whisper-large-v3-mlx`
- turbo → `mlx-community/whisper-large-v3-turbo` (if available, else large-v3)

#### For Other Platforms (pipx + insanely-fast-whisper):

```bash
pipx run insanely-fast-whisper \
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
| No backend found | Install mlx-whisper (Mac) or pipx (other) |
| Video file, no ffmpeg | Ask user to install ffmpeg |
| File not found | Ask user to verify path |
| Out of memory | Suggest smaller model (small or tiny) |
| MLX error | Try with smaller batch or different model |

## Installation Requirements

**For Apple Silicon Mac (recommended):**
```bash
pip install mlx-whisper
```

**For other platforms:**
```bash
brew install pipx  # or: apt install pipx
pipx ensurepath
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
| `mlx_whisper` | Mac (Apple Silicon) | ⚡⚡⚡ | ✅ Excellent | Native Metal acceleration |
| `insanely-fast-whisper` | Any (with GPU) | ⚡⚡ | ⚠️ May crash on long files | Uses HuggingFace transformers |
| `faster-whisper` | Any | ⚡⚡ | ✅ Good | CTranslate2 backend |
