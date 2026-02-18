# /local-llm-manager:status - Unified Backend Status

Check which local LLM backends are running and what models are loaded.

## Allowed Tools

Bash, Read

## Workflow

### Step 1: Detect Running Backends

Run all checks in parallel:
```bash
lms status 2>/dev/null
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/v1/models 2>/dev/null
curl -s -o /dev/null -w "%{http_code}" http://localhost:5001/v1/models 2>/dev/null
curl -s -o /dev/null -w "%{http_code}" http://localhost:11434/api/tags 2>/dev/null
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/v1/models 2>/dev/null
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health 2>/dev/null
```

### Step 2: Query Active Backends

For each backend that responded:

**LM Studio** (port 1234):
```bash
lms ps --json
```

**TabbyAPI** (port 5000):
```bash
curl -s http://localhost:5000/v1/models
```

**TensorRT-LLM** (port 5001):
```bash
curl -s http://localhost:5001/v1/models
```

**Ollama** (port 11434):
```bash
curl -s http://localhost:11434/api/tags
```

**vLLM** (port 8000):
```bash
curl -s http://localhost:8000/v1/models
```

**llama.cpp** (port 8080):
```bash
curl -s http://localhost:8080/props
```

### Step 3: Report

Present unified status table:
```
Backend         | Status | Port  | Model Loaded          | VRAM
----------------|--------|-------|-----------------------|--------
LM Studio       | UP     | 1234  | qwen/qwen3-coder-30b | ~18 GB
TabbyAPI         | DOWN   | 5000  | —                     | —
TensorRT-LLM    | DOWN   | 5001  | —                     | —
Ollama           | DOWN   | 11434 | —                     | —
vLLM             | DOWN   | 8000  | —                     | —
llama.cpp        | DOWN   | 8080  | —                     | —
```

Warn if multiple GPU backends are active simultaneously (VRAM conflict risk).
