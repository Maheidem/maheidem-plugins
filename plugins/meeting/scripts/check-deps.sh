#!/bin/bash
# Meeting Plugin Dependency Checker
# Verifies prerequisites for meeting transcription

set -e

echo "Meeting Plugin Dependency Check"
echo "================================"
echo ""

# Track overall status
ALL_OK=true

# Check pipx
echo -n "pipx: "
if command -v pipx >/dev/null 2>&1; then
    echo "OK ($(pipx --version 2>/dev/null | head -1))"
else
    echo "MISSING"
    echo "  → Install with: brew install pipx && pipx ensurepath"
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
else
    echo "Not available"
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
    echo "All required dependencies OK!"
    echo "Ready to transcribe with: /meeting:transcribe"
else
    echo "Some dependencies missing."
    echo "Install missing items above, then run this check again."
fi

echo ""
echo "Device recommendation for transcription:"
case "$DEVICE" in
    "mps")
        echo "  Use: --device-id mps (Apple Silicon GPU)"
        ;;
    "cuda")
        echo "  Use: --device-id 0 (NVIDIA GPU)"
        ;;
    *)
        echo "  Use: --device-id -1 (CPU fallback)"
        ;;
esac
