---
description: "Local LLM management, diagnostics, API operations, troubleshooting, VRAM estimation, model loading, and parameter reference across multiple backends. Use when user mentions LM Studio, lms CLI, Ollama, vLLM, llama.cpp, TabbyAPI, ExLlamaV3, TensorRT-LLM, local model serving, GGUF loading, EXL3 loading, localhost inference API, or any local LLM backend issues."
---

# Local LLM Manager

Unified toolkit for managing local LLM backends: diagnostics, API operations, parameter tuning, and troubleshooting.

## Supported Backends

| Backend | Status | Default Port | API Type | Reference |
|---------|--------|-------------|----------|-----------|
| LM Studio | Active | 1234 | OAI + Native | `references/lmstudio.md` |
| TabbyAPI (ExLlamaV3) | Active | 5000 | OAI-compatible | `references/tabbyapi.md` |
| TensorRT-LLM | Installed (blocked) | 5001 | OAI-compatible | `references/trtllm.md` |
| Ollama | Not installed | 11434 | OAI + Native | `references/ollama.md` |
| vLLM | Not installed | 8000 | OAI-compatible | `references/vllm.md` |
| llama.cpp | Not installed | 8080 | Native | `references/llamacpp.md` |

## Hardware Context

- **GPU**: NVIDIA RTX 5090, 32GB VRAM, compute capability 12.0
- **RAM**: 64GB DDR4
- **Storage**: D:/models/ (GGUF, EXL3, NVFP4)
- **Constraint**: Only one GPU backend at a time (32GB shared)

## Backend Detection

To detect running backends, check these ports/processes:
```bash
# LM Studio
lms status 2>/dev/null && echo "LM Studio: UP" || echo "LM Studio: DOWN"

# TabbyAPI
curl -s http://localhost:5000/v1/models > /dev/null 2>&1 && echo "TabbyAPI: UP" || echo "TabbyAPI: DOWN"

# TensorRT-LLM (WSL Docker)
curl -s http://localhost:5001/v1/models > /dev/null 2>&1 && echo "TRT-LLM: UP" || echo "TRT-LLM: DOWN"

# Ollama
curl -s http://localhost:11434/api/tags > /dev/null 2>&1 && echo "Ollama: UP" || echo "Ollama: DOWN"

# vLLM
curl -s http://localhost:8000/v1/models > /dev/null 2>&1 && echo "vLLM: UP" || echo "vLLM: DOWN"

# llama.cpp
curl -s http://localhost:8080/props > /dev/null 2>&1 && echo "llama.cpp: UP" || echo "llama.cpp: DOWN"
```

## Universal Concepts

### Parameter Hierarchy
Every backend has this split (details vary per backend):

| Level | When Set | Can Override Per-Request? |
|-------|----------|--------------------------|
| **Load-time** | Model load / server start | No |
| **Per-request** | Each API call | Yes |

Load-time: context length, GPU layers, KV cache config, parallel slots, quantization
Per-request: temperature, top_p, top_k, max_tokens, stop sequences, tools

### VRAM Budget (32GB)
- Model weights: varies by quant (check per-backend)
- KV cache: scales with context length x parallel slots
- Overhead: ~1-2GB CUDA + framework
- Rule: keep total < 28GB for stability (4GB headroom)

### Common Gotchas
1. **Silent context reduction**: Backends may silently reduce context when VRAM is tight (LM Studio, llama.cpp)
2. **Only one GPU backend at a time**: Unload/stop one before starting another
3. **MoE models**: Check active expert count vs total — wrong config wastes VRAM
4. **Quantization format lock-in**: GGUF (LM Studio, Ollama, llama.cpp), EXL3 (TabbyAPI), NVFP4 (TRT-LLM)
