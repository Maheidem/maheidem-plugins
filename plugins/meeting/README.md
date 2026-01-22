# Meeting Transcription Plugin

A self-contained Claude Code plugin for transcribing and summarizing meeting recordings using Whisper AI.

## Features

- **Zero-install transcription** via `uvx mlx-whisper` (Apple Silicon) or `uvx insanely-fast-whisper`
- **Interactive guided mode** - just type the command, no need to remember flags
- **Smart subtitle detection** - automatically extracts embedded subtitles from videos
- **Multiple output formats** - txt, srt, vtt, json
- **Speaker diarization** - identify who said what (optional)
- **AI-powered summaries** - action items, meeting minutes, brief overviews
- **Apple Silicon optimized** - automatic MLX acceleration for fastest transcription

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

**uv** - Fast Python package runner
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Then restart your terminal.

### Optional (for speaker diarization)

```bash
pip install whisperx
export HF_TOKEN="your_huggingface_token"
```

Get a HuggingFace token at https://huggingface.co/settings/tokens

## Smart Subtitle Detection

When transcribing video files, the plugin automatically:
1. **Checks for embedded subtitle tracks** using ffprobe
2. **Offers to extract existing subtitles** (fast!)
3. **Falls back to AI transcription** if no subtitles found

This saves significant time when videos already have subtitles baked in - no need to wait for AI transcription!

Example prompt when subtitles are detected:
```
This video has embedded subtitles. What would you like to do?
- Use existing subtitles (Recommended) - Fast, already synced
- Transcribe anyway - Get a fresh AI transcription
- Extract all subtitle tracks - Get all available languages
```

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

## Backend Priority (Apple Silicon)

The plugin automatically selects the fastest available backend:

1. **uvx mlx-whisper** ⚡⚡⚡⚡ - Native Metal acceleration (FASTEST)
2. **mlx_whisper (pip)** ⚡⚡⚡⚡ - If pip-installed
3. **uvx insanely-fast-whisper** ⚡⚡⚡ - MPS fallback

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

**Input:** mp4, mp3, wav, m4a, webm, ogg, flac, aac, mkv, mov, avi

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

### "uv not found"
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
# Restart terminal
```

### "Out of memory"
Use a smaller model:
```bash
/meeting:transcribe file.mp4 --model tiny
```

### Slow transcription on Apple Silicon
Ensure you're using MLX backend:
```bash
# Check if mlx-whisper is being used
# The plugin auto-detects, but you can verify with:
uvx mlx-whisper --help
```

### File paths with special characters
The plugin properly handles paths with spaces, parentheses, and special characters:
```bash
/meeting:transcribe "/Users/name/Downloads/meeting (2026-01-20 21_27).mp4"
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
