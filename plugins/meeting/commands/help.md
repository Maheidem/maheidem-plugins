---
description: "Show all meeting plugin commands and usage examples"
argument-hint: ""
---

# Help Command

You are executing the `/meeting:help` command to show documentation.

## Display This Help Content

```
Meeting Transcription Plugin
============================

Transcribe and summarize meeting recordings using Whisper AI.
Auto-detects best backend: MLX (Apple Silicon) or insanely-fast-whisper.

COMMANDS
--------

/meeting:transcribe [FILE] [OPTIONS]
  Transcribe audio/video files to text.
  Video files (mp4, mkv, etc.) are automatically converted.

  Options:
    --model MODEL    Whisper model (tiny, base, small, medium, large-v3, turbo)
    --format FORMAT  Output format (txt, srt, vtt, json)
    --output PATH    Custom output path
    --language LANG  Language code (en, es, fr, pt, etc.) or "auto"
    --all            Use all defaults, skip interactive prompts

  Examples:
    /meeting:transcribe                           # Guided mode
    /meeting:transcribe video.mp4                 # Transcribe with prompts
    /meeting:transcribe audio.wav --model small   # Specific model
    /meeting:transcribe meeting.mp4 --all         # All defaults

/meeting:models [OPTIONS]
  View or configure Whisper models.

  Options:
    --set MODEL      Set default model
    --download MODEL Pre-download a model
    --info           Show detailed model info

  Examples:
    /meeting:models                    # View model comparison
    /meeting:models --set turbo        # Change default
    /meeting:models --download large-v3 # Pre-download

/meeting:summarize [FILE] [OPTIONS]
  Create meeting summaries from transcripts.

  Options:
    --style STYLE   Summary style (action-items, brief, minutes, detailed)
    --output PATH   Custom output path

  Examples:
    /meeting:summarize                           # Guided mode
    /meeting:summarize transcript.txt            # Summarize file
    /meeting:summarize notes.txt --style minutes # Meeting minutes

/meeting:diarize [FILE] [OPTIONS]
  Transcribe with speaker identification.

  Options:
    --speakers NUM   Expected number of speakers
    --model MODEL    Whisper model to use
    --output PATH    Custom output path

  Examples:
    /meeting:diarize                         # Guided mode
    /meeting:diarize meeting.mp4             # With speaker detection
    /meeting:diarize call.wav --speakers 2   # Specify speaker count

/meeting:help
  Show this help message.

PREREQUISITES
-------------

For Apple Silicon Mac (recommended):
  pip install mlx-whisper
  brew install ffmpeg        # For video file support

For other platforms:
  brew install pipx && pipx ensurepath
  brew install ffmpeg

For speaker diarization (optional):
  pip install whisperx
  export HF_TOKEN="your_huggingface_token"

SUPPORTED FORMATS
-----------------

Input:  mp4, mkv, webm, mov, avi, mp3, wav, m4a, ogg, flac, aac
Output: txt, srt, vtt, json

BACKEND AUTO-DETECTION
----------------------

The plugin automatically selects the best backend:

| Priority | Platform      | Backend                  | Speed | Stability |
|----------|---------------|--------------------------|-------|-----------|
| 1        | Apple Silicon | mlx-whisper + Silero VAD | ⚡⚡⚡⚡ | Excellent |
| 2        | NVIDIA GPU    | faster-whisper (CUDA)    | ⚡⚡⚡  | Good      |
| 3        | Other GPU     | insanely-fast-whisper    | ⚡⚡   | Good      |
| 4        | CPU only      | faster-whisper (CPU)     | ⚡    | Good      |

MODEL COMPARISON
----------------

| Model     | Speed | Quality | VRAM  | Use Case            |
|-----------|-------|---------|-------|---------------------|
| tiny      | ★★★★★ | ★★      | ~1GB  | Quick drafts        |
| base      | ★★★★  | ★★★     | ~1GB  | Fast processing     |
| small     | ★★★   | ★★★★    | ~2GB  | Balanced            |
| medium    | ★★    | ★★★★★   | ~5GB  | High quality        |
| large-v3  | ★     | ★★★★★★  | ~10GB | Maximum fidelity    |
| turbo     | ★★★   | ★★★★★   | ~6GB  | Fast + quality      |

TIPS
----

• First transcription downloads the model (~500MB-3GB)
• Use --all flag when you know exactly what you want
• Apple Silicon Macs use MLX for native Metal acceleration
• Video files are auto-converted (requires ffmpeg)
• Action items summary is great for follow-up emails

LONG MEETING TIPS (1+ hours)
----------------------------

• Use 'turbo' or 'large-v3' models - they hallucinate less
• Anti-hallucination filters are built-in (no extra config needed)
• The plugin uses optimized VAD parameters for conversational speech
• Signs of hallucination: "thank you for watching", same phrase repeating
• If you see repetitive output, try --model large-v3 for best results
• Spot-check: listen to flagged sections if output seems wrong

TROUBLESHOOTING
---------------

"No backend found"
  → Mac: pip install mlx-whisper
  → Other: brew install pipx && pipx ensurepath

"Video file not supported"
  → Install ffmpeg: brew install ffmpeg
  → Audio will be extracted automatically

"Out of memory"
  → Use smaller model: --model small or --model tiny

"Slow transcription"
  → Check you're using MLX (Mac) or CUDA (NVIDIA)
  → Try --model turbo for faster processing

"MPS/GPU crash on long files"
  → This is a known issue with HuggingFace transformers
  → Use mlx_whisper instead (pip install mlx-whisper)

"Speaker diarization not working"
  → Ensure HF_TOKEN is set
  → Accept pyannote terms on HuggingFace
  → pip install whisperx

MORE INFO
---------

Plugin location: ~/.claude/plugins/meeting/
Settings file:   ~/.claude/meeting.local.md
Repository:      https://github.com/Maheidem/maheidem-plugins
```

## Additional Help

After displaying the help, offer:
```
Would you like me to:
- Run a quick test transcription
- Set up speaker diarization
- Show more examples for a specific command
```
