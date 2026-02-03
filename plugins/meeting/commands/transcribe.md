---
description: "Transcribe audio/video files using Whisper AI. Run without arguments for guided mode."
argument-hint: "[FILE] [--model MODEL] [--format FORMAT] [--output PATH] [--language LANG] [--all]"
---

# Meeting Transcription Command

Help the user transcribe a meeting recording using the best backend for their platform.

**IMPORTANT**: Always use VAD (Voice Activity Detection) to prevent hallucinations.

## Step 1: Initialize Settings

Check if settings file exists, create with defaults if not:

```bash
SETTINGS_FILE="$HOME/.claude/meeting.local.md"
if [ ! -f "$SETTINGS_FILE" ]; then
  mkdir -p "$HOME/.claude"
  cat > "$SETTINGS_FILE" << 'EOF'
---
default_model: large-v3
default_format: txt
default_language: auto
hf_token_set: false
---

# Meeting Plugin Settings

Personal configuration for the meeting transcription plugin.
Modify the YAML frontmatter above to change defaults.

## Available Models
tiny, base, small, medium, large-v3, turbo

## Available Formats
txt, srt, vtt, json

## Language Codes
auto (detect), en, es, fr, de, pt, ja, zh, etc.
EOF
  echo "Created settings file: $SETTINGS_FILE"
fi
```

## Step 2: Parse Arguments

- `FILE` - Path to audio/video file
- `--model` - Whisper model (tiny, base, small, medium, large-v3, turbo)
- `--format` - Output format (txt, srt, vtt, json)
- `--output` - Custom output path
- `--language` - Language code or "auto"
- `--all` - Skip prompts, use defaults

## Step 3: Interactive Mode (if needed)

If `--all` not set, use `AskUserQuestion` for missing parameters:

**Model**: large-v3-turbo (Recommended), large-v3, small, tiny
**Language**: Auto-detect (Recommended), English, Portuguese, Spanish, French

## Step 4: Detect Platform & Select Backend

```bash
PLATFORM=$(uname -s)
ARCH=$(uname -m)

if [[ "$PLATFORM" == "Darwin" && "$ARCH" == "arm64" ]]; then
    USE_BACKEND="mlx-vad"  # Apple Silicon
elif nvidia-smi &>/dev/null; then
    USE_BACKEND="faster-whisper-cuda"  # NVIDIA GPU
else
    USE_BACKEND="faster-whisper-cpu"  # Fallback
fi
```

## Step 5: Convert to WAV

```bash
WAV_FILE="${FILE%.*}.wav"
if [[ ! -f "$WAV_FILE" ]] || [[ "$FILE" -nt "$WAV_FILE" ]]; then
    ffmpeg -i "$FILE" -ar 16000 -ac 1 -y "$WAV_FILE" 2>/dev/null
fi
```

## Step 6: Execute Transcription

**Apple Silicon (mlx-vad)**: Use implementation from `@references/mlx-vad-transcription.md`

**Other platforms**: Use implementation from `@references/faster-whisper-transcription.md`

## Step 7: Report & Offer Next Steps

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

| Setting | Default |
|---------|---------|
| Model | large-v3-turbo (MLX) / large-v3 (other) |
| Format | txt |
| Language | auto |
| Output | Same directory as input |

## Backend Comparison

| Backend | Platform | Speed | Reliability |
|---------|----------|-------|-------------|
| Silero VAD + mlx-whisper | Apple Silicon | Fast | Best |
| faster-whisper + CUDA | NVIDIA GPU | Fast | Good |
| faster-whisper (CPU) | Any | Slow | Good |

## Installation

See `@references/installation-guide.md` for complete setup instructions.
