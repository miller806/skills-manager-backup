# Weights & Biases Framework Integrations

W&B integration patterns for common ML frameworks.

## PyTorch

```python
import wandb
import torch
import torch.nn as nn

wandb.init(project="my-project")

# Watch model for gradient flow visualization
model = MyModel()
wandb.watch(model, log='all', log_freq=100)

optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
criterion = nn.CrossEntropyLoss()

for epoch in range(10):
    for batch in dataloader:
        optimizer.zero_grad()
        outputs = model(batch['input'])
        loss = criterion(outputs, batch['target'])
        loss.backward()
        optimizer.step()

        wandb.log({
            'train/loss': loss.item(),
            'train/acc': accuracy(outputs, batch['target'])
        })

wandb.finish()
```

## PyTorch Lightning

```python
import wandb
from pytorch_lightning import Trainer
from pytorch_lightning.loggers import WandbLogger

# Simple integration
wandb_logger = WandbLogger(
    project='my-project',
    name='experiment-1',
    log_model='all'  # Log model checkpoints
)

trainer = Trainer(
    logger=wandb_logger,
    max_epochs=10
)

# Auto-logs: loss, metrics, gradients, weights, predictions
model = MyLightningModule()
trainer.fit(model, datamodule=data_module)

# Log additional metrics
wandb_logger.experiment.log({
    'custom_metric': value
})
```

## Keras / TensorFlow

```python
import wandb
from wandb.keras import WandbMetricsLogger, WandbModelCheckpoint

wandb.init(project="my-project")

# Callbacks
callbacks = [
    WandbMetricsLogger(),
    WandbModelCheckpoint('checkpoints/'),
]

# Compile and train
model.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])
model.fit(
    x_train, y_train,
    validation_data=(x_val, y_val),
    epochs=10,
    callbacks=callbacks
)
```

## HuggingFace Transformers

```python
import wandb
from transformers import Trainer, TrainingArguments

wandb.init(project="my-project")

training_args = TrainingArguments(
    output_dir='./results',
    report_to='wandb',  # Enable W&B logging
    logging_steps=10,
    evaluation_strategy='epoch',
    save_strategy='epoch',
)

trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=train_dataset,
    eval_dataset=eval_dataset,
    compute_metrics=compute_metrics,
)

trainer.train()
wandb.finish()
```

## JAX / Flax

```python
import wandb
import jax
import jax.numpy as jnp

wandb.init(project="my-project")

# Log metrics
for step in range(1000):
    metrics = compute_metrics(params, batch)
    wandb.log({
        'loss': metrics['loss'],
        'accuracy': metrics['accuracy']
    })
```

## scikit-learn

```python
import wandb
from sklearn.model_selection import cross_val_score

wandb.init(project="my-project")

# Log with sklearn
for param in param_grid:
    wandb.log(param)
    model = RandomForestClassifier(**param)
    scores = cross_val_score(model, X, y, cv=5)
    wandb.log({'mean_accuracy': scores.mean()})
```

## XGBoost / LightGBM

```python
import wandb
import xgboost as xgb

wandb.init(project="my-project")

dtrain = xgb.DMatrix('train.csv')
dval = xgb.DMatrix('val.csv')

params = {
    'objective': 'binary:logistic',
    'eval_metric': 'auc',
    'tree_method': 'hist'
}

# Train with evaluation
evallist = [(dtrain, 'train'), (dval, 'eval')]

xgb.train(
    params,
    dtrain,
    num_boost_round=100,
    evals=evallist,
    early_stopping_rounds=10,
    verbose_eval=10,
    callbacks=[xgb.callback.log_evaluation(period=10)]
)
```

## Custom Training Loops

```python
import wandb

wandb.init(project="my-project")

# Log config
wandb.config.update({
    'learning_rate': 0.001,
    'batch_size': 32,
    'epochs': 10,
    'optimizer': 'adam'
})

# Log gradients and weights manually
for name, param in model.named_parameters():
    if param.requires_grad:
        wandb.log({
            f'gradients/{name}': param.grad.norm().item(),
            f'weights/{name}': param.data.norm().item()
        })
```

## Logging Images and Media

```python
import wandb
import matplotlib.pyplot as plt

wandb.init(project="my-project")

# Log image
wandb.log({
    'confusion_matrix': wandb.Image(confusion_matrix),
    'sample_predictions': [
        wandb.Image(img, caption=f'Pred: {pred}')
        for img, pred in zip(images, predictions)
    ]
})

# Log matplotlib plot
fig, ax = plt.subplots()
ax.plot([1, 2, 3], [1, 4, 9])
wandb.log({'chart': wandb.Image(fig)})
```

## Tables

```python
# Log prediction table
table = wandb.Table(columns=['image', 'prediction', 'ground_truth', 'confidence'])

for img, pred, gt, conf in predictions:
    table.add_data(
        wandb.Image(img),
        pred,
        gt,
        conf
    )

wandb.log({'predictions': table})
```

## Histograms

```python
# Log histograms of activations/weights
wandb.log({
    'layer1/activations': wandb.Histogram(activations),
    'layer1/weights': wandb.Histogram(weights)
})
```
