# Weights & Biases Sweeps

Comprehensive hyperparameter optimization with W&B.

## Quick Start

### Basic Sweep

```python
import wandb
import random

# Initialize sweep
sweep_config = {
    'method': 'random',
    'metric': {'name': 'val_accuracy', 'goal': 'maximize'},
    'parameters': {
        'learning_rate': {'values': [0.001, 0.01, 0.1]},
        'batch_size': {'values': [16, 32, 64]},
        'epochs': {'value': 10}
    }
}

sweep_id = wandb.sweep(sweep_config, project="my-project")

def train():
    wandb.init()
    config = wandb.config

    # Training code using config values
    for epoch in range(config.epochs):
        # ... training logic ...
        wandb.log({"train/loss": loss, "val/accuracy": accuracy})

# Run agent
wandb.agent(sweep_id, function=train, count=20)
```

## Sweep Methods

### Grid Search

```python
sweep_config = {
    'method': 'grid',
    'metric': {'name': 'val_accuracy', 'goal': 'maximize'},
    'parameters': {
        'learning_rate': {'values': [0.001, 0.01, 0.1]},
        'batch_size': {'values': [16, 32]}
    }
}
# Total runs: 3 x 2 = 6
```

### Random Search

```python
sweep_config = {
    'method': 'random',
    'metric': {'name': 'val_accuracy', 'goal': 'maximize'},
    'parameters': {
        'learning_rate': {'distribution': 'uniform', 'min': 0.001, 'max': 0.1},
        'batch_size': {'values': [16, 32, 64, 128]},
        'dropout': {'distribution': 'normal', 'mean': 0.5, 'std': 0.1},
    }
}
```

### Bayesian Optimization

```python
sweep_config = {
    'method': 'bayes',
    'metric': {'name': 'val_accuracy', 'goal': 'maximize'},
    'parameters': {
        'learning_rate': {'min': 0.001, 'max': 0.1},
        'batch_size': {'values': [16, 32, 64]},
        'num_layers': {'values': [2, 3, 4]},
    },
    'early_terminate': {
        'type': 'hyperband',
        'min_iter': 3
    }
}
```

## Distribution Types

```python
parameters: {
    # Uniform distribution (continuous)
    'learning_rate': {'distribution': 'uniform', 'min': 0.0001, 'max': 0.1},

    # Log-uniform (for learning rates, etc.)
    'learning_rate': {'distribution': 'log_uniform', 'min': -10, 'max': -1},

    # Normal distribution
    'dropout': {'distribution': 'normal', 'mean': 0.5, 'std': 0.1},

    # Categorical
    'optimizer': {'values': ['adam', 'sgd', 'rmsprop']},

    # Constant (all runs same value)
    'epochs': {'value': 100},

    # Integer range
    'num_layers': {'min': 1, 'max': 10},

    # QUniform (quantized uniform - good for learning rates)
    'lr': {'distribution': 'q_uniform', 'min': -4, 'max': -1, 'q': 1},
    # Samples: 10^-4, 10^-3, 10^-2, 10^-1
}
```

## Early Termination

### Hyperband

```python
'early_terminate': {
    'type': 'hyperband',
    'min_iter': 3,
    'max_iter': 27,
    'eta': 3  # Halving factor
}
```

### Median Stopping Rule

```python
'early_terminate': {
    'type': 'median',
    'min_iter': 5,
    'eta': 3  # Stop if best run is >3x median of other runs
}
```

## Nested Sweeps

```python
# Outer sweep varies model architecture
# Inner sweep varies training hyperparameters

outer_config = {
    'method': 'grid',
    'parameters': {
        'model_type': {'values': ['resnet', 'vit']},
        'hidden_size': {'values': [256, 512]}
    }
}

def train():
    wandb.init()
    config = wandb.config

    if config.model_type == 'resnet':
        # ResNet-specific params
        sweep_config['parameters']['depth'] = {'values': [18, 34, 50]}
    else:
        # ViT-specific params
        sweep_config['parameters']['num_heads'] = {'values': [4, 8]}

    # Inner sweep logic
```

## Distributed Sweeps

```python
# sweep.yaml
method: random
metric:
  name: val_accuracy
  goal: maximize
parameters:
  learning_rate:
    min: 0.0001
    max: 0.01
  batch_size:
    values: [16, 32, 64]

# Run across multiple machines
# Terminal 1
wandb agent project/sweep-id --count 50

# Terminal 2
wandb agent project/sweep-id --count 50

# All runs will be tracked in same sweep
```

## Best Practices

### Parameter Ranges

```python
# DO: Use log scale for learning rates
'learning_rate': {'distribution': 'log_uniform', 'min': -10, 'max': -4}

# DON'T: Use linear scale for learning rates
'learning_rate': {'min': 0.00001, 'max': 0.1}  # Poor coverage

# DO: Use reasonable ranges based on prior knowledge
'batch_size': {'values': [16, 32, 64, 128, 256]}  # Common values

# DON'T: Search too wide
'learning_rate': {'min': 0.0000001, 'max': 1000}  # Wastes samples
```

### Budget Allocation

```python
# For 100 total runs with Bayesian optimization:
# - Start with 10 random initialization runs
# - Then 90 Bayesian optimization runs

sweep_config = {
    'method': 'bayes',
    'metric': {'name': 'val_accuracy', 'goal': 'maximize'},
    'parameters': {...},
    'aggressive': 10,  # First 10 random, then Bayesian
}
```

### Logging Best Practices

```python
def train():
    wandb.init()

    # Log config
    wandb.config.update({
        'model': 'transformer',
        'dataset': 'imagenet',
        'timestamp': datetime.now().isoformat()
    })

    for epoch in range(wandb.config.epochs):
        train_loss, train_acc = train_epoch()
        val_loss, val_acc = validate()

        wandb.log({
            'epoch': epoch,
            'train/loss': train_loss,
            'train/accuracy': train_acc,
            'val/loss': val_loss,
            'val/accuracy': val_acc,
            'learning_rate': optimizer.param_groups[0]['lr']
        })

    # Log best model
    wandb.run.summary['best_val_accuracy'] = best_val_accuracy
```

## Analyzing Sweep Results

### From W&B Dashboard

1. Open sweep run in W&B UI
2. Go to "Sweeps" tab
3. View parallel coordinates plot
4. Use "Optuna" or "BO" visualization for Bayesian sweeps

### Programmatically

```python
api = wandb.Api()

# Get all runs in sweep
runs = api.sweep("project/sweep-id").runs

# Find best run
best_run = max(runs, key=lambda r: r.summary['val_accuracy'])

print(f"Best config: {best_run.config}")
print(f"Best accuracy: {best_run.summary['val_accuracy']}")

# Compare parameter importance
import pandas as pd
df = pd.DataFrame([run.config for run in runs])
df['val_accuracy'] = [run.summary['val_accuracy'] for run in runs]
df.corr()['val_accuracy'].sort_values()
```

## Stopping and Resuming Sweeps

```python
# Stop sweep gracefully
wandb agent project/sweep-id --count 100 --stop-on-error

# Resume sweep with new agent count
# Sweep continues from where it left off
wandb agent project/sweep-id --count 50
```
