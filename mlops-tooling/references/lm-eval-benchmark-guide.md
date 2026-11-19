# lm-eval-harness Benchmark Guide

Detailed descriptions of standard benchmarks and how to interpret results.

## Core Benchmarks

### MMLU (Massive Multitask Language Understanding)

**What it measures**: Knowledge and problem-solving across 57 subjects at a US college-level difficulty.

**Subjects include**: Abstract algebra, anatomy, astronomy, business ethics, clinical knowledge, computer security, economies, electrical engineering, formal logic, global facts, high school mathematics, high school physics, human sexuality, professional accounting, professional medicine, professional law, public relations, management, marketing, medical genetics, microbiology, moral disputes, nutrition, philosophy, prehistory, professional psychology, security studies, sociology, US foreign policy, virology, world religions.

**How to run**:
```bash
lm_eval --model hf \
  --model_args pretrained=meta-llama/Llama-2-7b-hf \
  --tasks mmlu \
  --device cuda:0
```

**Interpreting results**:
- 70-75%: Average US college student
- 80%+: Strong performer
- 90%+: Expert level
- Human baseline: ~89.8%

### GSM8K (Grade School Math)

**What it measures**: Math word problems at grade school level (elementary through middle school).

**Format**: 8,500 training + 1,320 test problems requiring 1-2 step reasoning.

**How to run**:
```bash
lm_eval --model hf \
  --model_args pretrained=meta-llama/Llama-2-7b-hf \
  --tasks gsm8k \
  --device cuda:0
```

**Interpreting results**:
- 50%+: Reasonable grade-school level math
- 75%+: Good performance
- 90%+: Near-human performance
- Human baseline: ~96%

### HellaSwag (Harder End of Language, Language, and Commonsense)

**What it measures**: Commonsense reasoning about everyday situations.

**Format**: Multiple-choice questions about what happens next in a scenario.

**How to run**:
```bash
lm_eval --model hf \
  --model_args pretrained=meta-llama/Llama-2-7b-hf \
  --tasks hellaswag \
  --device cuda:0
```

**Interpreting results**:
- 50%: Random chance (4-way multiple choice)
- 80%+: Good commonsense reasoning
- 95%+: Near-human performance
- Human baseline: ~95%

### TruthfulQA

**What it measures**: Propensity to generate false statements when answering questions.

**Format**: Questions where humans might commonly give wrong answers due to misconceptions.

**How to run**:
```bash
lm_eval --model hf \
  --model_args pretrained=meta-llama/Llama-2-7b-hf \
  --tasks truthfulqa \
  --device cuda:0
```

**Interpreting results**:
- MC1 (multiple choice): Higher = more truthful
- MC2 (生成 + classification): Higher = more truthful + informative
- GPT-3 (few-shot): ~40-60% depending on subject

### ARC (AI2 Reasoning Challenge)

**What it measures**: Question answering requiring reasoning over science texts.

**Format**: 7,787 science questions, split into Challenge (2,590 "hard") and Easy sets.

**How to run**:
```bash
lm_eval --model hf \
  --model_args pretrained=meta-llama/Llama-2-7b-hf \
  --tasks arc_challenge \
  --device cuda:0
```

**Interpreting results**:
- Human baseline: ~96%
- ARC-Easy: ~90%+
- ARC-Challenge: 70%+ is strong

### HumanEval (Code Generation)

**What it measures**: Python code generation from docstrings and function signatures.

**Format**: 164 hand-written programming problems.

**How to run**:
```bash
lm_eval --model hf \
  --model_args pretrained=codellama/CodeLlama-7b-Python-hf \
  --tasks humaneval \
  --device cuda:0 \
  --allow_code_execution
```

**Interpreting results**:
- 0%: No correct solutions
- 30%+: Usable for simple tasks
- 70%+: Production-ready code generation
- Human baseline: ~80%

## Standard Evaluation Suite

For model releases, run:

```bash
lm_eval \
  --model hf \
  --model_args pretrained=MODEL_NAME \
  --tasks mmlu,gsm8k,hellaswag,truthfulqa,arc_challenge \
  --device cuda:0 \
  --batch_size auto
```

## Understanding Results Format

Output format:
```
|   Tasks   |Version|  Metric   |Value |   |Stderr|
|-----------|------:|-----------|-----:|---|-----:|
| mmlu      |     v0|acc        |0.6955|±  |0.0051|
|-----------|------:|-----------|-----:|---|-----:|
| gsm8k     |     v2|acc        |0.5231|±  |0.0176|
|-----------|------:|-----------|-----:|---|-----:|
```

- `Metric`: Primary metric for the task (acc, f1, ppl)
- `Value`: Mean score across examples
- `Stderr`: Standard error of the mean

## Interpreting Perplexity-based Metrics

Tasks like `wikitext` report perplexity (PPL):
- Lower is better
- FP16 baseline: ~5.96 for Llama 2-7B on wikitext-2
- Relative difference: Q4_K_M vs FP16 should be <3% increase

```bash
lm_eval --model hf \
  --model_args pretrained=MODEL \
  --tasks wikitext \
  --device cuda:0

# Output:
# |  Tasks   |Version|Metric|Value |   |Stderr |
# |----------|------:|------|-----:|---|-------:|
# | wikitext |     v0| ppl  |5.9622|±  |0.06961|
```

## Common Benchmark Pitfalls

### Model Format Mismatch

Some benchmarks require specific chat formats. Check task description:
```bash
# View task config
lm_eval --tasks helpsteer  # May require specific prompt format
```

### Generative vs Multiple-Choice

- Multiple-choice tasks (MMLU, HellaSwag, ARC): Use `acc` metric
- Generative tasks (GSM8K, HumanEval): Use `exact_match` or pass@1

### Batch Size and Memory

For large models, reduce batch size:
```bash
lm_eval --model hf \
  --model_args pretrained=MODEL,device_map=auto \
  --tasks mmlu \
  --batch_size 1  # Avoid OOM
```

## Aggregating Results

```python
# Calculate aggregate score
scores = {
    'mmlu': 0.70,
    'gsm8k': 0.52,
    'hellaswag': 0.84,
    'truthfulqa': 0.55,
    'arc_challenge': 0.75
}

# Average across tasks
avg = sum(scores.values()) / len(scores)
print(f"Average: {avg:.2%}")

# Weighted average (MMLU more reliable)
weighted = (
    scores['mmlu'] * 0.3 +
    scores['gsm8k'] * 0.2 +
    scores['hellaswag'] * 0.2 +
    scores['truthfulqa'] * 0.15 +
    scores['arc_challenge'] * 0.15
)
```
