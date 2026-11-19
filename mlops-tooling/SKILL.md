---
name: mlops-tooling
description: "Use when working with ML model infrastructure: downloading from HuggingFace Hub, local GGUF inference with llama.cpp, serving with vLLM, benchmarking with lm-eval-harness, or tracking experiments with Weights & Biases."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [mlops, huggingface, llama-cpp, vllm, lm-evaluation-harness, weights-and-biases, inference, training, experiment-tracking]
---

# MLOps Tooling

Tools for the full ML model lifecycle: discovery, local inference, production serving, benchmarking, and experiment tracking. These skills are independent but often used together — use the specific subsection for your immediate task.

---

## HuggingFace Hub (`hf` CLI)

Download, upload, and manage models, datasets, and Spaces from HuggingFace.

### Core Commands

```bash
# Download a model
hf download REPO_ID

# Upload files
hf upload REPO_ID

# Authenticate
hf auth login
```

### Key References

- `references/huggingface-hub.md` — Full `hf` CLI reference

---

## Local GGUF Inference (llama.cpp)

Run local models on CPU, Apple Silicon, CUDA, ROCm, or Intel GPUs using GGUF quantized models.

### Quick Start

```bash
# Install
brew install llama.cpp  # macOS/Linux

# Run directly from HuggingFace Hub
llama-cli -hf bartowski/Llama-3.2-3B-Instruct-GGUF:Q8_0

# Start OpenAI-compatible server
llama-server -hf bartowski/Llama-3.2-3B-Instruct-GGUF:Q8_0
```

### Model Discovery Workflow

1. Search: `https://huggingface.co/models?apps=llama.cpp&sort=trending`
2. Check local-app view: `https://huggingface.co/<repo>?local-app=llama.cpp`
3. Use tree API: `https://huggingface.co/api/models/<repo>/tree/main?recursive=true`

### Key References

- `references/llama-cpp-hub-discovery.md` — URL-only HF workflows, search patterns, GGUF extraction
- `references/llama-cpp-advanced-usage.md` — Speculative decoding, batched inference, grammar-constrained generation, LoRA, multi-GPU
- `references/llama-cpp-quantization.md` — Quant quality tradeoffs, Q4/Q5/Q6/IQ selection
- `references/llama-cpp-server.md` — Direct-from-Hub server launch, OpenAI API endpoints, Docker, NGINX
- `references/llama-cpp-optimization.md` — CPU threading, BLAS, GPU offload, batch tuning
- `references/llama-cpp-troubleshooting.md` — Install/convert/quantize/inference/server issues

### Quant Selection

- General chat: `Q4_K_M`
- Code/technical: `Q5_K_M` or `Q6_K`
- Tight RAM: `Q3_K_M` or IQ variants
- Multimodal repos: separate `mmproj-*.gguf` projector file

---

## Production Serving (vLLM)

High-throughput LLM serving with PagedAttention and continuous batching. OpenAI-compatible API.

### Quick Start

```bash
# Install
pip install vllm

# Start server
vllm serve meta-llama/Llama-3-8B-Instruct

# Query
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'
```

### Key References

- `references/vllm-server-deployment.md` — Docker, Kubernetes, load balancing
- `references/vllm-optimization.md` — PagedAttention tuning, continuous batching
- `references/vllm-quantization.md` — AWQ/GPTQ/FP8 setup and accuracy
- `references/vllm-troubleshooting.md` — Error messages, debugging, performance diagnostics

### When to Use vs Alternatives

| Use Case | Tool |
|----------|------|
| Production API (100+ req/sec) | vLLM |
| CPU/edge inference | llama.cpp |
| Research/prototyping | HuggingFace transformers |
| NVIDIA-only max perf | TensorRT-LLM |

---

## Benchmarking (lm-eval-harness)

Evaluate LLMs across 60+ academic benchmarks (MMLU, GSM8K, HumanEval, etc.).

### Quick Start

```bash
pip install lm-eval

lm_eval --model hf \
  --model_args pretrained=meta-llama/Llama-2-7b-hf \
  --tasks mmlu,gsm8k,hellaswag \
  --device cuda:0 \
  --batch_size auto
```

### Core Benchmarks

- **MMLU**: 57 subjects, multiple choice (~2 hours for 7B)
- **GSM8K**: Grade school math (~5 minutes)
- **HellaSwag**: Common sense reasoning (~10 minutes)
- **HumanEval**: Python code generation (requires `--allow_code_execution`)

### Standard Suite for Model Releases

```bash
--tasks mmlu,gsm8k,hellaswag,truthfulqa,arc_challenge
```

### Key References

- `references/lm-eval-benchmark-guide.md` — Detailed task descriptions, what they measure, interpretation
- `references/lm-eval-api-evaluation.md` — OpenAI, Anthropic, API model evaluation
- `references/lm-eval-distributed-eval.md` — Data parallel, tensor parallel evaluation
- `references/lm-eval-custom-tasks.md` — Domain-specific evaluation tasks

### vLLM Backend (5-10x faster)

```bash
lm_eval --model vllm \
  --model_args pretrained=model-name,tensor_parallel_size=2 \
  --tasks mmlu \
  --batch_size auto
```

---

## Experiment Tracking (Weights & Biases)

Log ML experiments, manage hyperparameter sweeps, and track model registry.

### Quick Start

```python
import wandb

run = wandb.init(
    project="my-project",
    config={"learning_rate": 0.001, "epochs": 10, "batch_size": 32}
)

for epoch in range(10):
    # training code
    wandb.log({"train/loss": loss, "val/accuracy": acc})

wandb.finish()
```

### Core Concepts

- **Projects**: Collections of related experiments
- **Runs**: Single executions with unique IDs
- **Artifacts**: Versioned datasets, models, and files
- **Sweeps**: Automated hyperparameter search (bayes, grid, random)

### Key References

- `references/wandb-sweeps.md` — Comprehensive hyperparameter optimization
- `references/wandb-artifacts.md` — Data and model versioning patterns
- `references/wandb-integrations.md` — Framework-specific examples (PyTorch, Lightning, Keras, HF)

---

## Choosing the Right Tool

| Goal | Tool |
|------|------|
| Find/download HuggingFace models | `hf` CLI |
| Local CPU/GPU inference | llama.cpp |
| Production API serving | vLLM |
| Academic benchmarking | lm-eval-harness |
| Experiment tracking & sweeps | Weights & Biases |
