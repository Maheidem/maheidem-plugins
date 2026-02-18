# vLLM Backend Reference

## Status: Not Installed

## Connection (planned)

- **Port**: 8000
- **Auth**: Configurable
- **CLI**: `vllm serve`
- **Model format**: HuggingFace (safetensors), GGUF, AWQ, GPTQ

## Key Endpoints (when installed)

| Endpoint | Method | Type |
|----------|--------|------|
| `/v1/chat/completions` | POST | OAI-compatible |
| `/v1/completions` | POST | OAI-compatible |
| `/v1/models` | GET | Model list |
| `/v1/embeddings` | POST | Embeddings |

## Notes

- High-throughput engine with PagedAttention
- Best for batch/concurrent inference workloads
- Native HuggingFace model support (no conversion needed)
- Supports tensor parallelism (multi-GPU)
- Windows support via WSL or Docker
