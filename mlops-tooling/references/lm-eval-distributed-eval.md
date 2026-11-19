# lm-eval Distributed Evaluation

Scaling evaluations across multiple GPUs and nodes.

## Single-Node Multi-GPU

```bash
# Data parallel (same model on multiple GPUs)
lm_eval \
  --model hf \
  --model_args pretrained=meta-llama/Llama-2-70b-hf,tensor_parallel_size=4 \
  --tasks mmlu \
  --device cuda
```

## Multi-Node Evaluation

```bash
# Node 1 (master)
export MASTER_ADDR=192.168.1.10
export MASTER_PORT=29500
export RANK=0
export WORLD_SIZE=4

lm_eval \
  --model hf \
  --model_args pretrained=meta-llama/Llama-2-70b-hf \
  --tasks mmlu \
  --device cuda

# Node 2-4: Same command with RANK=1,2,3
```

## Accelerate Integration

```bash
# Use accelerate for easier distribution
accelerate launch \
  --num_processes=4 \
  lm_eval \
    --model hf \
    --model_args pretrained=MODEL \
    --tasks mmlu
```

## Memory Optimization

For large models:
```bash
# Reduce memory with smaller batch size
lm_eval \
  --model hf \
  --model_args pretrained=70B-model \
  --tasks mmlu \
  --batch_size 1 \
  --device cuda:0
```
