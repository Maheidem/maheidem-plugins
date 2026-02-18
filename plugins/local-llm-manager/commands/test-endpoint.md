# /local-llm-manager:test-endpoint - Test Any Backend API

Send a test request to verify a local LLM backend is responding correctly.

## Allowed Tools

Bash, Read, AskUserQuestion

## Workflow

### Step 1: Detect Active Backend

Check all known ports. If multiple active, ask which to test.

### Step 2: Send Test Request

Adapt request per backend:

**LM Studio** (auth required):
```bash
curl -s -H 'Authorization: Bearer <KEY>' \
  -X POST http://localhost:1234/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"<model>","messages":[{"role":"user","content":"Say OK"}],"max_tokens":5,"temperature":0}'
```

**TabbyAPI** (no auth):
```bash
curl -s -X POST http://localhost:5000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"<model>","messages":[{"role":"user","content":"Say OK"}],"max_tokens":5,"temperature":0}'
```

**Ollama**:
```bash
curl -s -X POST http://localhost:11434/api/chat \
  -d '{"model":"<model>","messages":[{"role":"user","content":"Say OK"}],"stream":false}'
```

**vLLM / llama.cpp**: Standard OAI format on their respective ports.

### Step 3: Report

- Backend & port
- Response status (success/error)
- Model responding
- Tokens per second (if available in stats)
- Time to first token
- Any errors or warnings
