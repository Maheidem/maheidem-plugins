# Ollama Backend Reference

## Status: Not Installed

## Connection (planned)

- **Port**: 11434
- **Auth**: None (localhost)
- **CLI**: `ollama`
- **Model format**: GGUF (auto-downloaded)

## Key Endpoints (when installed)

| Endpoint | Method | Type |
|----------|--------|------|
| `/api/chat` | POST | Native chat |
| `/api/generate` | POST | Native completion |
| `/v1/chat/completions` | POST | OAI-compatible |
| `/api/tags` | GET | List models |
| `/api/show` | POST | Model details |
| `/api/pull` | POST | Download model |

## Notes

- Auto-manages model downloads via `ollama pull <model>`
- Built on llama.cpp, supports same GGUF models
- Simpler than LM Studio but fewer GUI controls
- Popular for quick local inference
