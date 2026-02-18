# llama.cpp Backend Reference

## Status: Not Installed

## Connection (planned)

- **Port**: 8080
- **Auth**: Configurable (`--api-key`)
- **Binary**: `llama-server`
- **Model format**: GGUF

## Key Endpoints (when installed)

| Endpoint | Method | Type |
|----------|--------|------|
| `/v1/chat/completions` | POST | OAI-compatible |
| `/completion` | POST | Native completion |
| `/props` | GET | Server properties (context, slots) |
| `/slots` | GET | Slot details (actual context per slot) |
| `/health` | GET | Server health |

## Notes

- Standalone llama.cpp server (same engine LM Studio uses)
- Direct access to `/props` and `/slots` (LM Studio blocks these)
- Full control over all load parameters via CLI flags
- Useful for scripted/headless deployments
- Key flags: `--ctx-size`, `--n-gpu-layers`, `--parallel`, `--flash-attn`, `--cache-type-k`, `--cache-type-v`
