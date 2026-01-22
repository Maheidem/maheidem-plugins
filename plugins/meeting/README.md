# Meeting Transcription Plugin

A self-contained Claude Code plugin for transcribing and summarizing meeting recordings using Whisper AI.

## Features

- **Zero-install transcription** via `pipx run insanely-fast-whisper`
- **Interactive guided mode** - just type the command, no need to remember flags
- **Multiple output formats** - txt, srt, vtt, json
- **Speaker diarization** - identify who said what (optional)
- **AI-powered summaries** - action items, meeting minutes, brief overviews
- **Apple Silicon optimized** - automatic MPS acceleration

## Quick Start

```bash
# Transcribe a meeting (guided mode)
/meeting:transcribe

# Transcribe with specific options
/meeting:transcribe video.mp4 --model large-v3 --format txt

# Use all defaults, no prompts
/meeting:transcribe audio.wav --all

# Summarize a transcript
/meeting:summarize transcript.txt --style action-items

# Get help
/meeting:help
```

## Prerequisites

### Required

**pipx** - Python package runner (no global installs needed)
```bash
brew install pipx
pipx ensurepath
```

Then restart your terminal.

### Optional (for speaker diarization)

```bash
pip install whisperx
export HF_TOKEN="your_huggingface_token"
```

Get a HuggingFace token at https://huggingface.co/settings/tokens

## Commands

| Command | Description |
|---------|-------------|
| `/meeting:transcribe` | Transcribe audio/video files |
| `/meeting:models` | View/configure Whisper models |
| `/meeting:summarize` | Summarize transcriptions |
| `/meeting:diarize` | Transcribe with speaker labels |
| `/meeting:help` | Show all commands |

## Guided Mode

All commands support **interactive guided mode**. Just run the command without arguments:

```bash
/meeting:transcribe
```

Claude will ask you step-by-step:
1. Which file to transcribe
2. Which model quality
3. What output format
4. What language

Skip prompts by providing arguments:
```bash
/meeting:transcribe video.mp4 --model turbo  # Only asks for format
```

## Models

| Model | Speed | Quality | VRAM | Best For |
|-------|-------|---------|------|----------|
| tiny | ★★★★★ | ★★ | ~1GB | Quick drafts |
| base | ★★★★ | ★★★ | ~1GB | Fast processing |
| small | ★★★ | ★★★★ | ~2GB | Balanced |
| medium | ★★ | ★★★★★ | ~5GB | High quality |
| **large-v3** | ★ | ★★★★★★ | ~10GB | Maximum fidelity (default) |
| turbo | ★★★ | ★★★★★ | ~6GB | Fast + quality |

## Supported Formats

**Input:** mp4, mp3, wav, m4a, webm, ogg, flac, aac

**Output:**
- `txt` - Plain text
- `srt` - SubRip subtitles
- `vtt` - WebVTT subtitles
- `json` - Full data with timestamps

## Summary Styles

| Style | Use Case |
|-------|----------|
| `action-items` | Tasks, decisions, follow-ups |
| `brief` | 2-3 paragraph overview |
| `minutes` | Formal meeting minutes |
| `detailed` | Section-by-section analysis |

## Configuration

Settings are stored in `~/.claude/meeting.local.md`:

```yaml
---
default_model: large-v3
default_format: txt
default_language: auto
hf_token_set: false
---
```

Change defaults with:
```bash
/meeting:models --set turbo
```

## Troubleshooting

### "pipx not found"
```bash
brew install pipx
pipx ensurepath
# Restart terminal
```

### "Out of memory"
Use a smaller model:
```bash
/meeting:transcribe file.mp4 --model tiny
```

### Slow transcription
Check GPU acceleration:
```bash
# Should show "mps" (Apple Silicon) or "cuda" (NVIDIA)
python3 -c "import torch; print(torch.backends.mps.is_available())"
```

### Speaker diarization not working
1. Ensure whisperx is installed: `pip install whisperx`
2. Set HuggingFace token: `export HF_TOKEN="..."`
3. Accept pyannote terms on HuggingFace

## Check Dependencies

Run the dependency checker:
```bash
bash ~/.claude/plugins/meeting/scripts/check-deps.sh
```

## License

MIT
