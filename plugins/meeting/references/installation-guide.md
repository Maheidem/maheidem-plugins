# Meeting Plugin Installation Guide

Complete setup instructions for all supported platforms.

## Quick Platform Detection

```bash
PLATFORM=$(uname -s)
ARCH=$(uname -m)
echo "Platform: $PLATFORM $ARCH"

# Check for NVIDIA GPU
nvidia-smi &>/dev/null && echo "NVIDIA GPU: detected" || echo "NVIDIA GPU: not found"

# Check for Apple Silicon
[[ "$PLATFORM" == "Darwin" && "$ARCH" == "arm64" ]] && echo "Apple Silicon: YES" || echo "Apple Silicon: NO"
```

## Backend Priority

| Priority | Platform | Backend | Notes |
|----------|----------|---------|-------|
| 1 | Apple Silicon Mac | mlx-whisper | MLX optimized, fastest |
| 2 | NVIDIA GPU | faster-whisper (CUDA) | GPU accelerated |
| 3 | Other GPU | insanely-fast-whisper | Generic GPU support |
| 4 | CPU only | faster-whisper (CPU) | Universal fallback |

## Installation by Platform

### Apple Silicon Mac (Priority 1)

```bash
# Core dependencies
pip install mlx-whisper torch soundfile numpy

# Silero VAD auto-downloads via torch.hub on first use

# For video file support
brew install ffmpeg
```

**Verify installation:**
```bash
python3 -c "import mlx_whisper; print('mlx-whisper: OK')"
python3 -c "import torch; print('torch: OK')"
```

### NVIDIA GPU (Priority 2)

```bash
# Core dependency
pip install faster-whisper

# Verify CUDA
nvidia-smi
python3 -c "import torch; print('CUDA:', torch.cuda.is_available())"

# For video file support
# Linux: apt install ffmpeg
# macOS: brew install ffmpeg
```

**Verify installation:**
```bash
python3 -c "from faster_whisper import WhisperModel; print('faster-whisper: OK')"
```

### Other GPU / CPU (Priority 3-4)

```bash
# Install pipx for isolated tool execution
brew install pipx && pipx ensurepath  # macOS
# or: apt install pipx && pipx ensurepath  # Linux

# For video file support
brew install ffmpeg  # macOS
# or: apt install ffmpeg  # Linux
```

**Verify installation:**
```bash
pipx run insanely-fast-whisper --help
```

## All Platforms: FFmpeg

FFmpeg is required for video file support on all platforms:

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
apt install ffmpeg

# Windows
# Download from https://ffmpeg.org/download.html
```

## Optional: Speaker Diarization

For speaker identification (who said what):

```bash
pip install whisperx
export HF_TOKEN="your_huggingface_token"
```

Get a HuggingFace token at https://huggingface.co/settings/tokens

You must also accept the pyannote model terms:
- https://huggingface.co/pyannote/speaker-diarization-3.1
- https://huggingface.co/pyannote/segmentation-3.0

## Troubleshooting

### "No backend found"
- Mac: `pip install mlx-whisper`
- NVIDIA: `pip install faster-whisper`
- Other: `brew install pipx && pipx ensurepath`

### "Out of memory"
Use a smaller model: `--model small` or `--model tiny`

### "MPS/GPU crash on long files"
This is a known issue with some backends. Use mlx-whisper on Mac or faster-whisper on other platforms.

### "Video file not supported"
Install ffmpeg: `brew install ffmpeg` or `apt install ffmpeg`
