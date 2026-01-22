---
description: "Transcribe audio/video files using Whisper AI. Run without arguments for guided mode."
argument-hint: "[FILE] [--model MODEL] [--format FORMAT] [--output PATH] [--language LANG] [--all]"
---

# Meeting Transcription Command

You are executing the `/meeting:transcribe` command to transcribe audio or video files.

## Your Mission

Help the user transcribe a meeting recording using `insanely-fast-whisper` via pipx. Use the **interactive guided mode** to collect missing parameters.

## Execution Flow

### Step 1: Parse Arguments

Check what the user provided:
- `FILE` - Path to audio/video file
- `--model` - Whisper model (tiny, base, small, medium, large-v3, turbo)
- `--format` - Output format (txt, srt, vtt, json)
- `--output` - Custom output path
- `--language` - Language code (e.g., en, es, fr) or "auto"
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
- French
```

### Step 3: Validate Prerequisites

Before transcribing, verify:

1. **Check pipx availability:**
```bash
command -v pipx >/dev/null 2>&1 && echo "pipx: OK" || echo "pipx: MISSING"
```

2. **Check file exists:**
```bash
[ -f "USER_FILE" ] && echo "File: OK" || echo "File: NOT FOUND"
```

3. **Detect best device:**
```bash
# For Apple Silicon
python3 -c "import platform; print('mps' if platform.processor() == 'arm' and platform.system() == 'Darwin' else 'cpu')" 2>/dev/null || echo "cpu"
```

If pipx is missing, tell the user:
```
pipx is required but not installed. Install it with:
  brew install pipx && pipx ensurepath
Then restart your terminal and try again.
```

### Step 4: Execute Transcription

Run the transcription:

```bash
pipx run insanely-fast-whisper \
  --file-name "USER_FILE" \
  --model-name "openai/whisper-MODEL" \
  --device-id DEVICE \
  --transcript-path "OUTPUT_PATH" \
  --batch-size 24
```

**Device mapping:**
- Apple Silicon: `--device-id mps`
- NVIDIA GPU: `--device-id 0` (CUDA)
- CPU: `--device-id -1`

**Model mapping:**
- tiny → `openai/whisper-tiny`
- base → `openai/whisper-base`
- small → `openai/whisper-small`
- medium → `openai/whisper-medium`
- large-v3 → `openai/whisper-large-v3`
- turbo → `openai/whisper-large-v3-turbo`

### Step 5: Format Conversion

If the user requested srt/vtt format, convert the JSON output:

For **SRT**:
```python
# Read JSON, convert to SRT format
# Segment format: start_time --> end_time\ntext
```

For **VTT**:
```python
# Add WEBVTT header
# Same timestamp format as SRT with . instead of ,
```

### Step 6: Report Results

After successful transcription:
```
Transcription complete!

File: meeting-recording.mp4
Model: large-v3
Duration: 45:32
Output: meeting-recording.txt

Would you like me to:
- Summarize this transcript (/meeting:summarize)
- Add speaker labels (/meeting:diarize)
```

## Default Values

When `--all` flag is used or for any missing values after prompts:
- Model: `large-v3`
- Format: `txt`
- Language: `auto` (auto-detect)
- Output: Same directory as input, same name with new extension

## Error Handling

| Error | Solution |
|-------|----------|
| pipx not found | Provide installation instructions |
| File not found | Ask user to verify path |
| Out of memory | Suggest smaller model |
| GPU error | Fall back to CPU |

## Output Naming Convention

If no `--output` specified:
- Input: `meeting-2024-01-15.mp4`
- Output: `meeting-2024-01-15.txt` (or .srt, .vtt, .json)

Place output in same directory as input file.
