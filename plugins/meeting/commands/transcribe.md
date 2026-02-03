---
description: "Transcribe audio/video files using Whisper AI. Run without arguments for guided mode."
argument-hint: "[FILE] [--model MODEL] [--format FORMAT] [--output PATH] [--language LANG] [--all] [--no-vad]"
---

# Meeting Transcription Command

Help the user transcribe a meeting recording using the best backend for their platform.

**IMPORTANT**: Use VAD by default, but analyze audio quality first to set optimal thresholds.

## Step 0: Audio Quality Analysis (NEW - 2026-02)

**Before transcription, analyze the audio to set smart defaults:**

```bash
# Get audio stats
AUDIO_STATS=$(ffmpeg -i "$FILE" -af "volumedetect" -f null /dev/null 2>&1)
MEAN_VOL=$(echo "$AUDIO_STATS" | grep "mean_volume" | awk '{print $5}')
MAX_VOL=$(echo "$AUDIO_STATS" | grep "max_volume" | awk '{print $5}')

# Get duration
DURATION=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$FILE" 2>/dev/null)

echo "📊 Audio Analysis:"
echo "   Duration: $(echo "$DURATION/60" | bc)m"
echo "   Mean volume: ${MEAN_VOL}dB"
echo "   Max volume: ${MAX_VOL}dB"
```

**Set VAD threshold based on audio quality:**

| Mean Volume | Audio Quality | VAD Threshold | Notes |
|-------------|---------------|---------------|-------|
| > -20 dB | Good/loud | 0.5 (default) | Standard detection |
| -20 to -30 dB | Moderate | 0.35 | More sensitive |
| < -30 dB | Quiet/bad | 0.25 | Most sensitive |

**If user mentions "bad audio" in arguments, automatically use permissive settings.**

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
- `--no-vad` - Skip VAD, process entire audio (for problematic recordings)
- Natural language hints: "bad audio", "long form", "continuous talking" → use permissive VAD

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

## Step 6.5: Post-Processing Cleanup (NEW - 2026-02)

**Always apply post-processing to remove common hallucinations.**

See `@references/post-processing.md` for the cleanup pipeline.

**Additional Portuguese-specific patterns (from 2026-02 learnings):**

```python
PORTUGUESE_HALLUCINATIONS = [
    # Subtitle/caption artifacts
    r'Legenda\s+\w+\s+\w+',  # "Legenda Adriana Zanotto" pattern
    r'(E aí\s*){3,}',        # Repeated "E aí"
    r'(rem\s*){5,}',         # Repeated "rem" gibberish
    r'(vai ser uma \w+\s*){2,}',  # Repeated phrase loops
    r'Obrigado\.\s*$',       # Random "Obrigado" alone
    r'Um beijinho\.',        # Random phrases
]
```

**Apply cleanup automatically and report:**
```
🧹 Post-processing applied:
   Removed: ~X characters of artifacts
   Final word count: ~Y words
```

## Step 7: Report & Offer Next Steps

```
Transcription complete!

📁 File: meeting-recording.mp4
🎯 Model: whisper-large-v3-turbo
⏱️ Duration: 45:32
📊 Speech detected: 32:15 (71% of recording)
📄 Output: meeting-recording.txt

Would you like me to:
- Summarize this transcript (/meeting:summarize)
- Add speaker labels (/meeting:diarize)
```

**If speech % is surprisingly low (<60%) and user expected more:**
- Explain VAD detected that much actual speech
- Offer to re-run with `--no-vad` to capture everything
- Note: "No-VAD mode may include hallucinations in silent sections"

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
