# lm-eval Custom Tasks

Creating domain-specific evaluation tasks.

## Task Definition Format

```yaml
# tasks/my_task.yaml
task: my_task
dataset_path: my_dataset
dataset_name: null
output_type: generate_until
num_fewshot: 0

dataset_kwargs:
  split: test

validation_split: test
training_split: null

doc_to_target: "{{answer}}"
doc_to_text: "{{question}}"

metric_list:
  - metric: exact_match
    aggregation: mean
    higher_is_better: true
```

## Loading Custom Datasets

```bash
lm_eval \
  --model hf \
  --model_args pretrained=MODEL \
  --tasks tasks/my_task.yaml \
  --dataset_path my_dataset \
  --dataset_name null
```

## Custom Metrics

```python
# tasks/custom_metric.py
def custom_accuracy(results):
    total = 0
    correct = 0
    for result in results:
        if result['expected'] == result['actual']:
            correct += 1
        total += 1
    return correct / total
```

## Prompt Templates

```yaml
task: my_task
dataset_path: my_dataset

# Custom prompt format
doc_to_text: |
  Question: {{question}}

  Answer the question based on the following context:
  {{context}}

doc_to_target: "{{answer}}"
```

## Best Practices

- Test custom tasks with a known-good model first
- Include diverse examples covering edge cases
- Use 5-shot prompting for knowledge-heavy tasks
- Validate metric computation manually
