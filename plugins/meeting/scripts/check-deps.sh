#!/bin/bash
# Meeting Plugin Dependency Checker
# Verifies prerequisites for meeting transcription

set -e

echo "Meeting Plugin Dependency Check"
echo "================================"
echo ""

# Track overall status
ALL_OK=true

# Check uv/uvx
echo -n "uv: "
if command -v uv >/dev/null 2>&1; then
    echo "OK ($(uv --version 2>/dev/null))"
elif command -v uvx >/dev/null 2>&1; then
    echo "OK (uvx available)"
else
    echo "MISSING"
    echo "  → Install with: curl -LsSf https://astral.sh/uv/install.sh | sh"
    ALL_OK=false
fi

# Check Python
echo -n "Python: "
if command -v python3 >/dev/null 2>&1; then
    echo "OK ($(python3 --version 2>&1))"
else
    echo "MISSING"
    echo "  → Install Python 3.8 or later"
    ALL_OK=false
fi

# Check ffmpeg (needed for audio extraction)
echo -n "ffmpeg: "
if command -v ffmpeg >/dev/null 2>&1; then
    echo "OK"
else
    echo "MISSING (optional but recommended)"
    echo "  → Install with: brew install ffmpeg"
fi

# Detect GPU/Device
echo ""
echo "GPU Detection"
echo "-------------"

# Check for Apple Silicon MPS
echo -n "Apple Silicon (MPS): "
if python3 -c "import platform; exit(0 if platform.processor() == 'arm' and platform.system() == 'Darwin' else 1)" 2>/dev/null; then
    echo "AVAILABLE"
    DEVICE="mps"
    IS_APPLE_SILICON=true
else
    echo "Not available"
    IS_APPLE_SILICON=false
fi

# Check for CUDA
echo -n "NVIDIA CUDA: "
if python3 -c "import torch; exit(0 if torch.cuda.is_available() else 1)" 2>/dev/null; then
    CUDA_VERSION=$(python3 -c "import torch; print(torch.version.cuda)" 2>/dev/null)
    echo "AVAILABLE (CUDA $CUDA_VERSION)"
    DEVICE="cuda"
else
    echo "Not available"
fi

# Determine best device
if [ -z "$DEVICE" ]; then
    DEVICE="cpu"
fi
echo ""
echo "Recommended device: $DEVICE"

# Check MLX Whisper (Apple Silicon only)
echo ""
echo "Whisper Backends"
echo "----------------"

if [ "$IS_APPLE_SILICON" = true ]; then
    echo -n "uvx mlx-whisper: "
    if command -v uvx >/dev/null 2>&1 && uvx mlx-whisper --help >/dev/null 2>&1; then
        echo "AVAILABLE (RECOMMENDED)"
    else
        echo "NOT AVAILABLE"
        echo "  → Will be auto-installed on first use via uvx"
    fi

    echo -n "mlx_whisper (pip): "
    if python3 -c "import mlx_whisper" 2>/dev/null; then
        echo "AVAILABLE"
    else
        echo "NOT INSTALLED"
        echo "  → Optional: pip install mlx-whisper"
    fi
fi

echo -n "uvx insanely-fast-whisper: "
if command -v uvx >/dev/null 2>&1; then
    echo "AVAILABLE"
else
    echo "NOT AVAILABLE"
    echo "  → Install uv first"
fi

# Check whisperx (optional, for diarization)
echo ""
echo "Optional: Speaker Diarization"
echo "-----------------------------"
echo -n "whisperx: "
if python3 -c "import whisperx" 2>/dev/null; then
    echo "OK"
else
    echo "NOT INSTALLED"
    echo "  → Install with: pip install whisperx"
fi

echo -n "HF_TOKEN: "
if [ -n "$HF_TOKEN" ]; then
    echo "SET"
else
    echo "NOT SET"
    echo "  → Set with: export HF_TOKEN='your_token'"
fi

# Summary
echo ""
echo "================================"
if [ "$ALL_OK" = true ]; then
    echo "✅ All required dependencies OK!"
    echo "Ready to transcribe with: /meeting:transcribe"
else
    echo "⚠️ Some dependencies missing."
    echo "Install missing items above, then run this check again."
fi

echo ""
echo "Device recommendation for transcription:"
case "$DEVICE" in
    "mps")
        if [ "$IS_APPLE_SILICON" = true ]; then
            echo "  Use: uvx mlx-whisper (Apple Silicon - FASTEST)"
        else
            echo "  Use: uvx insanely-fast-whisper --device-id mps"
        fi
        ;;
    "cuda")
        echo "  Use: uvx insanely-fast-whisper --device-id 0 (NVIDIA GPU)"
        ;;
    *)
        echo "  Use: uvx insanely-fast-whisper --device-id -1 (CPU fallback)"
        ;;
esac
