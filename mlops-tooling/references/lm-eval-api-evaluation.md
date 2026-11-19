# lm-eval API Model Evaluation

Evaluating OpenAI, Anthropic, and other API-based models.

## OpenAI API

```bash
lm_eval --model openai \
  --model_args model=gpt-4-turbo \
  --tasks mmlu,gsm8k,hellaswag \
  --limit 100  # Sample for quick test
```

## Anthropic Claude

```bash
lm_eval --model anthropic \
  --model_args model=claude-3-opus-20240229 \
  --tasks mmlu,gsm8k \
  --limit 50
```

## Custom API Endpoint

```bash
lm_eval --model local-chat-completions \
  --model_args \
    model=MODEL_NAME,\
    base_url=http://localhost:8000/v1,\
    api_key=EMPTY \
  --tasks mmlu,gsm8k
```

## Configuration

```yaml
# lm_eval.yaml
model: openai-chat-completions
model_args:
  model: gpt-4-turbo
  api_key: ${OPENAI_API_KEY}
tasks:
  - mmlu
  - gsm8k
  - hellaswag
batch_size: 8
limit: 500
```

## Interpreting API Results

API evaluations have higher variance due to:
- Stochastic API responses
- Rate limiting
- Context window differences

Run with sufficient samples (--limit) for reliable estimates.
