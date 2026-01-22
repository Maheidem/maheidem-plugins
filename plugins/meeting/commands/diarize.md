---
description: "Transcribe with speaker identification (requires HuggingFace token)"
argument-hint: "[FILE] [--speakers NUM] [--model MODEL] [--output PATH]"
---

# Diarize Command

You are executing the `/meeting:diarize` command to transcribe with speaker identification.

## Your Mission

Help the user transcribe a meeting with speaker labels. This requires whisperx and a HuggingFace token.

## Execution Flow

### Step 1: Parse Arguments

Check what the user provided:
- `FILE` - Path to audio/video file
- `--speakers NUM` - Expected number of speakers
- `--model MODEL` - Whisper model to use
- `--output PATH` - Custom output path

### Step 2: Check Prerequisites

**Check whisperx:**
```bash
python3 -c "import whisperx; print('whisperx: OK')" 2>/dev/null || echo "whisperx: MISSING"
```

**Check HuggingFace token:**
```bash
[ -n "$HF_TOKEN" ] && echo "HF_TOKEN: SET" || echo "HF_TOKEN: NOT SET"
```

Also check settings file:
```bash
grep "hf_token_set: true" ~/.claude/meeting.local.md 2>/dev/null && echo "Token in settings: YES" || echo "Token in settings: NO"
```

### Step 3: Handle Missing Prerequisites

**If whisperx missing:**
```
Speaker diarization requires whisperx. Install it with:

  pip install whisperx

Note: This also requires PyTorch. If you have issues, try:
  pip install torch torchvision torchaudio
  pip install whisperx

Would you like me to:
- Proceed with standard transcription (no speaker labels)
- Show installation instructions
```

**If HF_TOKEN missing:**
Use `AskUserQuestion`:
```
Question: "Speaker diarization requires a HuggingFace token. What would you like to do?"
Options:
- Enter token now - I'll save it securely
- Skip diarization - Transcribe without speaker labels
- Learn how to get a token - Show instructions
```

**Token setup instructions:**
```
To get a HuggingFace token:

1. Create account at https://huggingface.co
2. Go to Settings → Access Tokens
3. Create a new token (read access is sufficient)
4. Accept the pyannote terms:
   - https://huggingface.co/pyannote/speaker-diarization-3.1
   - https://huggingface.co/pyannote/segmentation-3.0

Then set the token:
  export HF_TOKEN="your_token_here"

Or I can save it to your settings file.
```

### Step 4: Interactive Mode (for missing parameters)

**File Selection** (if FILE not provided):
```
Question: "Which file do you want to transcribe with speaker detection?"
Options:
- Search for audio/video files
- Let me paste a path
```

**Speaker Count** (if --speakers not provided):
```
Question: "How many speakers are in the recording?"
Options:
- 2 people (Recommended)
- 3-4 people
- 5+ people
- Auto-detect (may be less accurate)
```

### Step 5: Execute Diarization

Run whisperx with diarization:

```python
import whisperx
import torch

# Load model
device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
compute_type = "float16" if device != "cpu" else "int8"

model = whisperx.load_model("MODEL", device, compute_type=compute_type)

# Transcribe
audio = whisperx.load_audio("FILE")
result = model.transcribe(audio, batch_size=16)

# Align
model_a, metadata = whisperx.load_align_model(language_code=result["language"], device=device)
result = whisperx.align(result["segments"], model_a, metadata, audio, device)

# Diarize
diarize_model = whisperx.DiarizationPipeline(use_auth_token="HF_TOKEN", device=device)
diarize_segments = diarize_model(audio, min_speakers=MIN, max_speakers=MAX)

# Assign speakers
result = whisperx.assign_word_speakers(diarize_segments, result)
```

**Alternative: Use existing transcriber if available:**
```bash
# Check if meeting-transcriber is available
curl -s http://localhost:8000/health 2>/dev/null && echo "Local transcriber: AVAILABLE"
```

If local transcriber is running, use its `/transcribe` endpoint with diarization enabled.

### Step 6: Format Output

Format transcription with speaker labels:

```
SPEAKER_00 (0:00 - 0:15): Hello everyone, thanks for joining today.

SPEAKER_01 (0:15 - 0:32): Thanks for having us. Should we start with the agenda?

SPEAKER_00 (0:32 - 0:45): Yes, let's begin with the quarterly review.
```

For SRT format with speakers:
```
1
00:00:00,000 --> 00:00:15,000
[SPEAKER_00] Hello everyone, thanks for joining today.

2
00:00:15,000 --> 00:00:32,000
[SPEAKER_01] Thanks for having us. Should we start with the agenda?
```

### Step 7: Report Results

```
Diarization complete!

File: meeting-recording.mp4
Model: large-v3
Speakers detected: 3
Duration: 45:32
Output: meeting-recording-diarized.txt

Speaker breakdown:
- SPEAKER_00: 45% of speaking time
- SPEAKER_01: 35% of speaking time
- SPEAKER_02: 20% of speaking time

Would you like me to:
- Rename speakers (e.g., SPEAKER_00 → "John")
- Summarize by speaker
- Export to a different format
```

## Speaker Naming

Offer to rename generic speaker labels:
```
Question: "Would you like to name the speakers?"

Current labels:
- SPEAKER_00 → [text input]
- SPEAKER_01 → [text input]
- SPEAKER_02 → [text input]
```

Then find/replace in the output file.

## Error Handling

| Error | Solution |
|-------|----------|
| whisperx not installed | Provide pip install command |
| Invalid HF token | Guide to token setup |
| Token not accepted | Link to pyannote terms |
| Out of memory | Suggest smaller model or CPU |
| Too few segments | May need longer audio |

## Fallback Behavior

If diarization prerequisites aren't met, offer:
1. Standard transcription (no speakers)
2. Manual speaker labeling assistance
3. Setup help for diarization
