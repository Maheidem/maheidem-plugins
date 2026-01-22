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

COMMANDS
--------

/meeting:transcribe [FILE] [OPTIONS]
  Transcribe audio/video files to text.

  Options:
    --model MODEL    Whisper model (tiny, base, small, medium, large-v3, turbo)
    --format FORMAT  Output format (txt, srt, vtt, json)
    --output PATH    Custom output path
    --language LANG  Language code (en, es, fr, etc.) or "auto"
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

Required:
  pipx - For running insanely-fast-whisper
    brew install pipx && pipx ensurepath

For speaker diarization (optional):
  whisperx - pip install whisperx
  HuggingFace token - export HF_TOKEN="your_token"

SUPPORTED FORMATS
-----------------

Input:  mp4, mp3, wav, m4a, webm, ogg, flac, aac
Output: txt, srt, vtt, json

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
• Apple Silicon Macs use Metal acceleration automatically
• For long meetings, use 'turbo' model for speed
• Action items summary is great for follow-up emails

TROUBLESHOOTING
---------------

"pipx not found"
  → brew install pipx && pipx ensurepath
  → Restart your terminal

"Out of memory"
  → Use smaller model: --model tiny or --model base

"Slow transcription"
  → Check GPU is being used (look for "mps" or "cuda" in output)
  → Try --model turbo for faster processing

"Speaker diarization not working"
  → Ensure HF_TOKEN is set
  → Accept pyannote terms on HuggingFace
  → pip install whisperx

MORE INFO
---------

Plugin location: ~/.claude/plugins/meeting/
Settings file:   ~/.claude/meeting.local.md
```

## Additional Help

After displaying the help, offer:
```
Would you like me to:
- Run a quick test transcription
- Set up speaker diarization
- Show more examples for a specific command
```
