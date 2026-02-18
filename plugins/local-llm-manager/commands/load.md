# /local-llm-manager:load - Load Model on Any Backend

Interactively load a model with VRAM-aware parameter selection on any supported backend.

## Allowed Tools

Bash, Read, AskUserQuestion

## Workflow

### Step 1: Choose Backend

If user didn't specify, detect what's available and ask:
- "LM Studio" (if `lms status` shows server on)
- "TabbyAPI" (if TabbyAPI dir exists)
- Other installed backends

### Step 2: List Models

**LM Studio**: `lms ls --json`
**TabbyAPI**: List folders in `D:/models/exl3/`
**Ollama**: `ollama list` or `curl http://localhost:11434/api/tags`

### Step 3: VRAM Planning (LM Studio)

```bash
lms load --estimate-only "<model>" -c 8192 -y
lms load --estimate-only "<model>" -c 16384 -y
lms load --estimate-only "<model>" -c 32768 -y
```

Present estimate table with fit/no-fit for 32GB.

### Step 4: Configure & Load

Ask for context length, parallel slots, etc. based on backend capabilities.
Check if another model is loaded first — ask to confirm unload.

**LM Studio**:
```bash
lms unload "<current>" 2>/dev/null
lms load "<model>" -c <ctx> --parallel <n> --gpu max --ttl <ttl> -y
```

**TabbyAPI**: Edit `engines/tabbyAPI/config.yml` and restart.

### Step 5: Verify

Query the appropriate API to confirm loaded settings match requested.
