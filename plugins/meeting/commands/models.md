---
description: "List available Whisper models or change default model settings"
argument-hint: "[--set MODEL] [--download MODEL] [--info]"
---

# Models Command

Help the user view, compare, or configure Whisper models for transcription.

## Step 1: Initialize Settings

Ensure settings file exists before any operation:

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
EOF
  echo "Created settings file: $SETTINGS_FILE"
fi
```

## Step 2: Parse Arguments

- `--set MODEL` - Set default model
- `--download MODEL` - Pre-download a model
- `--info` - Show detailed model info
- (no args) - Interactive mode

## Step 3: Interactive Mode

Use `AskUserQuestion`:
- View models (Recommended) - See comparison table
- Change default - Set your preferred model
- Download model - Pre-download for faster first use

## Step 4: Display Model Comparison

```
Available Whisper Models
========================

| Model     | Speed      | Quality        | VRAM   | Best For                    |
|-----------|------------|----------------|--------|-----------------------------|
| tiny      | ⚡⚡⚡⚡⚡     | ⭐⭐             | ~1GB   | Quick drafts, testing       |
| base      | ⚡⚡⚡⚡      | ⭐⭐⭐            | ~1GB   | Fast processing             |
| small     | ⚡⚡⚡       | ⭐⭐⭐⭐           | ~2GB   | Balanced speed/quality      |
| medium    | ⚡⚡        | ⭐⭐⭐⭐⭐          | ~5GB   | High quality                |
| large-v3  | ⚡         | ⭐⭐⭐⭐⭐⭐         | ~10GB  | Maximum fidelity (default)  |
| turbo     | ⚡⚡⚡       | ⭐⭐⭐⭐⭐          | ~6GB   | Fast + quality balance      |

Current default: {default_model}
```

## Step 5: Handle --set MODEL

1. Validate model name
2. Update `~/.claude/meeting.local.md` YAML frontmatter
3. Confirm the change

## Step 6: Handle --download MODEL

Pre-download models using the correct backend for the platform:

```bash
PLATFORM=$(uname -s)
ARCH=$(uname -m)

if [[ "$PLATFORM" == "Darwin" && "$ARCH" == "arm64" ]]; then
    # Apple Silicon: Use mlx-whisper
    echo "Downloading MLX model for Apple Silicon..."
    python3 -c "import mlx_whisper; mlx_whisper.transcribe('/dev/null', path_or_hf_repo='mlx-community/whisper-MODEL-mlx')" 2>&1 | head -20
elif nvidia-smi &>/dev/null; then
    # NVIDIA GPU: Use faster-whisper
    echo "Downloading faster-whisper model for NVIDIA GPU..."
    python3 -c "from faster_whisper import WhisperModel; WhisperModel('MODEL', device='cuda')"
else
    # CPU/Other: Use insanely-fast-whisper
    echo "Downloading model via insanely-fast-whisper..."
    pipx run insanely-fast-whisper --model-name "openai/whisper-MODEL" --file-name /dev/null 2>&1 | head -20
fi
```

**Download sizes:**
- tiny: ~75MB
- base: ~150MB
- small: ~500MB
- medium: ~1.5GB
- large-v3: ~3GB
- turbo: ~1.5GB

## Model Recommendations

| Use Case | Recommended Model |
|----------|-------------------|
| Quick test/draft | tiny or base |
| Daily meetings | small or turbo |
| Important recordings | large-v3 |
| Non-English audio | large-v3 (best multilingual) |
| Limited RAM (<8GB) | tiny or base |
| Apple Silicon Mac | turbo (good MLX support) |

## Error Handling

| Error | Solution |
|-------|----------|
| Invalid model name | Show valid options |
| Download failed | Check internet connection |
| Settings file permission | Check ~/.claude permissions |
