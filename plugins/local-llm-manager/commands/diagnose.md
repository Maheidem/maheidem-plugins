# /local-llm-manager:diagnose - Diagnose Active Backend

Run diagnostics on the currently active LLM backend: settings conflicts, VRAM usage, and runtime health.

## Allowed Tools

Bash, Read, Glob, Grep, WebFetch, AskUserQuestion

## Workflow

### Step 1: Detect Active Backend

Run the status checks from `/local-llm-manager:status`. If multiple are active, ask user which to diagnose.

### Step 2: Backend-Specific Diagnostics

Load the appropriate reference from `references/<backend>.md` for context.

#### LM Studio
```bash
lms ps --json
curl -s -H 'Authorization: Bearer <KEY>' http://localhost:1234/api/v0/models/<loaded-model>
lms load --estimate-only "<model>" -c <loaded_context> -y
```

Check for:
- Context collapse (loaded_context_length vs actual)
- VRAM pressure (estimate > 28GB)
- Parallel vs Max Concurrency mismatch (warn user to check GUI)
- MoE expert count (arch = qwen3moe/deepseek2 → check num_experts)

#### TabbyAPI
```bash
curl -s http://localhost:5000/v1/models
```
Read `engines/tabbyAPI/config.yml` for current settings.

Check for:
- VRAM headroom with current model + cache_mode
- max_seq_len vs model's max context
- num_experts_per_token setting

#### TensorRT-LLM
```bash
curl -s http://localhost:5001/v1/models
```

Check for known blockers from reference file.

#### Ollama / vLLM / llama.cpp
Query their respective endpoints and report model info.
For llama.cpp, `/props` and `/slots` give actual runtime context allocation.

### Step 3: Report

Present backend-specific diagnostics:
```
Backend: <name>
Model: <id>
Context: <configured> / <max> tokens
VRAM: <estimated> GB / 32 GB
Status: <state>
Conflicts: <list or "None detected">
Recommendations: <specific actions>
```
