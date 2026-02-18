# LM Studio Backend Reference

## Connection

- **Port**: 1234
- **Auth**: Bearer `sk-lm-Nh3vjybJ:QKPCe9cbbKyOKa1EnDfX`
- **CLI**: `lms`
- **Runtime**: llama.cpp-win-x86_64-nvidia-cuda12-avx2@2.3.0
- **Model format**: GGUF

## Endpoints

| Endpoint | Method | Type |
|----------|--------|------|
| `/v1/chat/completions` | POST | OpenAI-compatible chat |
| `/v1/completions` | POST | OpenAI-compatible legacy |
| `/v1/embeddings` | POST | OpenAI-compatible embeddings |
| `/v1/models` | GET | OpenAI-compatible model list |
| `/v1/messages` | POST | Anthropic-compatible |
| `/v1/responses` | POST | OpenAI Responses API |
| `/api/v1/chat` | POST | Native (stateful, streaming, MCP) |
| `/api/v1/models/load` | POST | Load model |
| `/api/v1/models/unload` | POST | Unload model |
| `/api/v0/models` | GET | Model list with state/context |
| `/api/v0/models/{id}` | GET | Single model details |

## CLI Commands

```bash
lms status                    # Server on/off
lms ps --json                 # Loaded models (always use --json)
lms ls --json                 # All available models (always use --json)
lms load "<id>" -c <ctx> --parallel <n> --gpu max --ttl <sec> -y
lms unload "<id>"
lms load --estimate-only "<id>" -c <ctx> -y
lms log stream --json --stats # Live logs with perf stats
lms server start / stop
lms runtime ls                # Installed llama.cpp versions
```

## Load-Time Parameters

### CLI (`lms load`)

| Flag | Description |
|------|-------------|
| `-c, --context-length <n>` | Token context window |
| `--parallel <n>` | Concurrent prediction slots |
| `--gpu <ratio>` | `off`, `max`, or 0-1 float |
| `--ttl <seconds>` | Idle timeout |
| `--identifier <id>` | Custom API identifier |
| `--estimate-only` | VRAM estimate without loading |

### REST API (`POST /api/v1/models/load`)

| Parameter | Type | Description |
|-----------|------|-------------|
| `model` | string | Required. Model identifier |
| `context_length` | number | Max context tokens |
| `eval_batch_size` | number | Batch size during eval |
| `flash_attention` | boolean | Attention optimization |
| `num_experts` | number | Active MoE experts |
| `offload_kv_cache_to_gpu` | boolean | KV cache location |
| `echo_load_config` | boolean | Return config in response |

### GUI-Only (no CLI/API)

KV cache quantization (K/V types), Unified KV Cache, RoPE base/scale, Keep in Memory, Try mmap(), Seed, CPU Thread Pool, Max Concurrency, Layer-level GPU offload.

## Per-Request Parameters (`/v1/chat/completions`)

`temperature`, `top_p`, `top_k`, `min_p`, `max_tokens`, `frequency_penalty`, `presence_penalty`, `repeat_penalty`, `seed`, `stop`, `stream`, `logit_bias`, `logprobs`, `top_logprobs`, `n`, `response_format`, `tools`, `tool_choice`, `stream_options`

### Native-Only (`/api/v1/chat`)

`input`, `system_prompt`, `max_output_tokens`, `reasoning` (off/low/medium/high/on), `context_length` (**triggers reload**), `draft_model`, `store`, `previous_response_id`, `integrations`

## Known Issues

1. **Silent context collapse**: Reports requested context in API, but runtime may allocate less. Only visible in GUI tooltip.
2. **VRAM estimates ignore parallel**: `--estimate-only` doesn't account for parallel slot overhead.
3. **`lms ls` hides models**: Always use `--json`.
4. **Native API context_length**: Triggers model reload, not per-request override. Fails if busy.
5. **Log stream**: Shows prompts and stats, not HTTP request parameters.
6. **Parallel vs Max Concurrency**: CLI `--parallel` = KV slots, GUI "Max Concurrency" = API request limit. Independent settings.

## Models Available

| ID | Arch | Size | Max Ctx | Tool Use |
|----|------|------|---------|----------|
| `qwen/qwen3-coder-next` | qwen3next | 45.2 GB | 262K | Yes |
| `qwen/qwen3-coder-30b` | qwen3moe | 17.4 GB | 262K | Yes |
| `nvidia/nemotron-3-nano` | nemotron_h_moe | 22.8 GB | 1M | Yes |
| `zai-org/glm-4.7-flash` | deepseek2 | 16.9 GB | 203K | Yes |
| `mistralai/devstral-small-2-2512` | mistral3 | 14.2 GB | 393K | Yes+Vision |
| `ha-expert` | qwen2 | 8.4 GB | 32K | Yes |
| `text-embedding-nomic-embed-text-v1.5` | nomic-bert | 84 MB | 2K | — |
