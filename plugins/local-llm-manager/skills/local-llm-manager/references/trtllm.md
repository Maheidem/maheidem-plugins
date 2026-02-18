# TensorRT-LLM Backend Reference

## Connection

- **Port**: 5001
- **Auth**: None
- **Platform**: WSL2 Ubuntu 24.04 (Docker)
- **Docker image**: `nvcr.io/nvidia/tensorrt-llm/release:1.3.0rc2`
- **Model format**: NVFP4

## Status: BLOCKED

Infrastructure works but no viable model fits in 32GB VRAM:
- **Nemotron-3-Nano**: Mamba SSM state needs 47.6GB (fixed allocation, can't reduce)
- **GLM-4.7-Flash-NVFP4**: Uses `compressed-tensors` format, TRT-LLM rejects it

## Docker Run Command

```bash
docker run --rm --gpus all --ipc=host \
  --ulimit memlock=-1 --ulimit stack=67108864 \
  -p 5001:8000 \
  -v /mnt/d/models/nvfp4:/workspace/models \
  nvcr.io/nvidia/tensorrt-llm/release:1.3.0rc2 \
  trtllm-serve /workspace/models/<model-name>
```

## Models Downloaded

| Folder | Model | Size | Status |
|--------|-------|------|--------|
| `NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4` | Nemotron 30B MoE | 19.4 GB | BLOCKED (OOM) |
| `GLM-4.7-Flash-NVFP4` | GLM-4.7 Flash | 20.5 GB | BLOCKED (format) |

## Known Issues

1. **Prefer Docker over pip**: Docker has TRT-LLM 1.3 vs pip 1.1.0. Much better model support.
2. **Nemotron Mamba SSM OOM**: 18.6GB weights + 47.6GB SSM state = 66GB. Cannot fit 32GB.
3. **GLM-4.7 compressed-tensors**: Community quant uses wrong format for TRT-LLM.
4. **One GPU at a time**: Must stop TabbyAPI/LM Studio before starting TRT-LLM.
5. **WSL CRLF issues**: Scripts must live inside WSL filesystem or use `sed -i $'s/\r$//'`.
6. **Docker overlay2 bug**: Use Docker CE from official apt repo, not Ubuntu's `docker.io` package.
