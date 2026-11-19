# Weights & Biases Artifacts

Versioned data and model management with W&B Artifacts.

## Basic Usage

### Creating Artifacts

```python
import wandb

run = wandb.init(project="my-project")

# Create dataset artifact
artifact = wandb.Artifact('dataset', type='dataset')
artifact.add_file('train.csv')
artifact.add_file('val.csv')
run.log_artifact(artifact)

# Create model artifact
model_artifact = wandb.Artifact('model', type='model')
model_artifact.add_file('model.pt')
run.log_artifact(model_artifact)

run.finish()
```

### Loading Artifacts

```python
run = wandb.init()

# Load dataset artifact
artifact = run.use_artifact('dataset:v0')  # version tag
artifact.download()

# Or by alias
artifact = run.use_artifact('dataset:latest')
artifact.download(root='/path/to/download')

# Load into DataFrame
table = artifact.get('table_name')
```

## Artifact Types

### Dataset Artifacts

```python
# Versioned dataset
dataset_artifact = wandb.Artifact(
    'preprocessed_dataset',
    type='dataset',
    description='Preprocessed training data',
    metadata={'version': '2.0', 'num_samples': 100000}
)

# Add directory
dataset_artifact.add_dir('data/preprocessed/')

# Add reference (no upload)
dataset_artifact.add_reference('s3://my-bucket/data/')

# Add artifact as dependency
dataset_artifact.add_dependents(other_artifact)

run.log_artifact(dataset_artifact)
```

### Model Artifacts

```python
# Model checkpoints
model_artifact = wandb.Artifact(
    'transformer_model',
    type='model',
    metadata={'architecture': 'transformer', 'epochs': 100}
)

# Save model
model_artifact.add_file('checkpoints/epoch_100.pt')

# Save config
model_artifact.add_file('config.json')

# Metadata
model_artifact.metadata = {
    'accuracy': 0.95,
    'f1_score': 0.92,
    'training_time': '4h'
}

run.log_artifact(model_artifact)
```

### Output Artifacts

```python
# Log evaluation results
eval_artifact = wandb.Artifact(
    'evaluation_results',
    type='evaluation'
)

# Add metrics as JSON
import json
with open('metrics.json') as f:
    eval_artifact.add_file(f.name, name='metrics.json')

# Add visualizations
eval_artifact.add_file('confusion_matrix.png')

run.log_artifact(eval_artifact)
```

## Aliases and Versioning

```python
# Versioning (automatic)
artifact = run.log_artifact(dataset_artifact)
# artifact.version = 'v0', 'v1', etc.

# Add aliases
artifact = run.log_artifact(model_artifact)
artifact.alias = 'production'
artifact.alias = 'best accuracy'
artifact.alias = 'baseline'

# Use aliases
production_model = run.use_artifact('model:production')
best_model = run.use_artifact('model:best accuracy')

# List aliases
artifact = run.use_artifact('model:latest')
print(artifact.aliases)  # ['latest', 'best_accuracy']
```

## Downloading and Using Artifacts

```python
run = wandb.init()

# Download specific version
artifact = run.use_artifact('dataset:v0')
artifact.download()

# Download to custom path
artifact.download(root='/data/project')

# Download latest
artifact = run.use_artifact('dataset:latest')
artifact.download()

# Check if artifact exists
if run.exist_artifact('dataset:v0'):
    artifact = run.use_artifact('dataset:v0')
```

## Linking Artifacts to Runs

```python
# Link model to training run
run = wandb.init()

# Train model
# ...

# Log model with reference to dataset used
model_artifact = wandb.Artifact('model', type='model')
model_artifact.add_file('model.pt')

# Link to dataset artifact
model_artifact.dependents.add(
    run.use_artifact('dataset:v0')
)

run.log_artifact(model_artifact)
```

## Model Registry

```python
# Register production model
registered_model = wandb RegistryArtifact(
    name='models/production/transformer',
    type='model',
    description='Production transformer model',
    metadata={'accuracy': 0.95}
)

# Promote model to stage
wandb.run.link_artifact(
    registered_model,
    'models/production/transformer',
    aliases=['production', 'stable']
)
```

## Best Practices

### Dataset Versioning

```python
# DO: Use consistent naming
dataset_artifact = wandb.Artifact(
    'preprocessed_train',
    type='dataset',
    metadata={'split': 'train', 'preprocessing': 'v2'}
)

# DON'T: Upload raw data every time
# Instead, upload processed/feature-engineered data
```

### Model Checkpointing

```python
# Save best model only
if val_accuracy > best_accuracy:
    model_artifact = wandb.Artifact('model', type='model')
    model_artifact.add_file(f'checkpoints/best.pt')
    run.log_artifact(model_artifact)
    best_accuracy = val_accuracy

# Use aliases for clarity
model_artifact.alias = f'epoch_{epoch}'
```

### Storage Management

```python
# List large artifacts
api = wandb.Api()
for artifact in api.artifacts(type='dataset', per_page=100):
    size_gb = artifact.size / (1024**3)
    if size_gb > 1:
        print(f"{artifact.name}: {size_gb:.2f} GB")

# Delete old artifact version (W&B UI or API)
api.delete_artifact("project/artifact:v0")
```
