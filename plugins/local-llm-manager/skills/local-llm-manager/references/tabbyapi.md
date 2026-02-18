# TabbyAPI (ExLlamaV3) Backend Reference

## Connection

- **Port**: 5000
- **Auth**: Disabled for localhost
- **Start**: `engines/start-tabby.bat` or `cd engines/tabbyAPI && python main.py`
- **Config**: `engines/tabbyAPI/config.yml`
- **Venv**: `engines/exllamav3-env/` (Python 3.12.10, torch 2.9.0+cu128)
- **Model format**: EXL3

## Endpoints

| Endpoint | Method | Type |
|----------|--------|------|
| `/v1/chat/completions` | POST | OpenAI-compatible chat |
| `/v1/completions` | POST | OpenAI-compatible legacy |
| `/v1/models` | GET | Model list |
| `/v1/model/load` | POST | Load model |
| `/v1/model/unload` | POST | Unload model |

## Configuration (config.yml)

Key settings:
```yaml
model:
  model_dir: D:/models/exl3
  model_name: <model-folder-name>
  max_seq_len: <context-length>
  cache_mode: Q4    # KV cache quantization (FP16, Q8, Q4)
  num_experts_per_token: <n>  # MoE active experts

network:
  host: 0.0.0.0
  port: 5000

developer:
  unsafe_launch: true  # Skip confirmation prompts
```

## Per-Request Parameters

Same as OAI standard: `temperature`, `top_p`, `top_k`, `min_p`, `max_tokens`, `frequency_penalty`, `presence_penalty`, `repetition_penalty`, `stop`, `stream`, `response_format`

## Models Available

| Folder | Model | Size | VRAM |
|--------|-------|------|------|
| `Qwen3-Next-80B-A3B-Instruct-3.0bpw` | Qwen3-Next 80B MoE | 29 GB | ~31 GB |

## Known Issues

1. **Qwen3-Next VRAM**: 3.0bpw uses ~31GB of 32GB. Only ~1GB headroom for KV cache.
2. **FLA + Triton required**: Qwen3-Next needs `flash-linear-attention` + `triton-windows` for gated delta rule.
3. **First inference slow**: Triton kernel JIT compilation on first run.
4. **FLA Windows warning**: Warns about Windows but works fine.
5. **start.py broken in Git Bash**: Use `python main.py` directly.
6. **ExLlamaV3 wheel matching**: Must match torch version exactly (torch2.9.0 wheel).

## Performance

- Completion: ~12 tok/s
- Prompt processing: ~17 tok/s
- (Warmed up, RTX 5090)
