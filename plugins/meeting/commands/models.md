---
description: "List available Whisper models or change default model settings"
argument-hint: "[--set MODEL] [--download MODEL] [--info]"
---

# Models Command

You are executing the `/meeting:models` command to manage Whisper models.

## Your Mission

Help the user view, compare, or configure Whisper models for transcription.

## Execution Flow

### Step 1: Parse Arguments

Check what the user provided:
- `--set MODEL` - Set default model
- `--download MODEL` - Pre-download a model
- `--info` - Show detailed model info
- (no args) - Interactive mode

### Step 2: Interactive Mode (no arguments)

Use `AskUserQuestion`:
```
Question: "What would you like to do with models?"
Options:
- View models (Recommended) - See comparison table
- Change default - Set your preferred model
- Download model - Pre-download for faster first use
```

### Step 3: Display Model Comparison

Show this table:

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

### Step 4: Handle --set MODEL

If user wants to change default:

1. Validate model name is valid
2. Read current settings from `.claude/meeting.local.md`
3. Update the `default_model` field
4. Confirm the change

**Settings file location:** `~/.claude/meeting.local.md`

**Settings format:**
```yaml
---
default_model: large-v3
default_format: txt
default_language: auto
hf_token_set: false
---

# Meeting Plugin Settings

Personal settings for the meeting transcription plugin.
```

### Step 5: Handle --download MODEL

Pre-download a model for faster first use:

```bash
# This command downloads the model without transcribing
pipx run insanely-fast-whisper \
  --model-name "openai/whisper-MODEL" \
  --file-name /dev/null \
  2>&1 | head -20
```

Note: First-time download may take several minutes depending on model size.

**Download sizes:**
- tiny: ~75MB
- base: ~150MB
- small: ~500MB
- medium: ~1.5GB
- large-v3: ~3GB
- turbo: ~1.5GB

### Step 6: Read/Write Settings

**Read settings:**
```bash
cat ~/.claude/meeting.local.md 2>/dev/null || echo "No settings file found"
```

**Write settings:**
Create or update `~/.claude/meeting.local.md` with YAML frontmatter.

## Model Recommendations

Based on use case:

| Use Case | Recommended Model |
|----------|-------------------|
| Quick test/draft | tiny or base |
| Daily meetings | small or turbo |
| Important recordings | large-v3 |
| Non-English audio | large-v3 (best multilingual) |
| Limited RAM (<8GB) | tiny or base |
| Apple Silicon Mac | turbo (good MPS support) |

## Error Handling

| Error | Solution |
|-------|----------|
| Invalid model name | Show valid options |
| Download failed | Check internet connection |
| Settings file permission | Check ~/.claude permissions |
