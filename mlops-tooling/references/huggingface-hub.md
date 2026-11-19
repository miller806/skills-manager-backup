# HuggingFace Hub CLI Reference

The `hf` CLI for downloading, uploading, and managing models, datasets, and Spaces.

## Installation

```bash
pip install huggingface_hub
```

## Authentication

```bash
# Login to HuggingFace
hf auth login

# Check current token
hf whoami

# Logout
hf auth logout
```

## Download Models

```bash
# Download a model to current directory
hf download REPO_ID

# Download to specific path
hf download REPO_ID --local-dir /path/to/save

# Download specific revision/branch
hf download REPO_ID --revision main

# Download specific file
hf download REPO_ID --filename config.json

# Download with specific repo type (model/dataset/space)
hf download REPO_ID --repo-type model
```

**Examples:**
```bash
hf download meta-llama/Llama-3-8B-Instruct
hf download google/gemma-7b-it
hf download mistralai/Mistral-7B-Instruct-v0.2
```

## Download Datasets

```bash
# Download a dataset
hf download datasetsdataset-name

# Download specific config/subset
hf download datasetsdataset-name --config en

# Download specific split
hf download datasetsdataset-name --split train

# Download to local directory
hf download datasetsdataset-name --local-dir ./data/dataset
```

## Upload Files

```bash
# Upload a file
hf upload REPO_ID /local/path/to/file

# Upload with message
hf upload REPO_ID /local/path/to/file -m "Upload model weights"

# Upload to specific revision
hf upload REPO_ID /local/path/to/file --revision v1.0

# Upload entire folder
hf upload REPO_ID ./folder/ --folder
```

## Repo Management

```bash
# Create a new repo
hf repo create REPO_ID

# List your repos
hf ls

# Delete a repo
hf repo delete REPO_ID

# Update repo settings
hf repo update REPO_ID --visibility private
```

## Download from Private Repos

```bash
# Login first
hf auth login

# Download works automatically with token
hf download username/private-model
```

## API Endpoints (Advanced)

```bash
# Get repo info
hf api repo info REPO_ID

# List files in repo
hf api repo tree REPO_ID

# Get file metadata
hf api repo diff REPO_ID --filename file.gguf
```

## Common Workflows

### Download GGUF model for llama.cpp

```bash
# Search for GGUF models
# https://huggingface.co/models?filter=gguf

# Download specific quant
hf download REPO_ID --filename *Q4_K_M.gguf --local-dir ./models
```

### Download dataset for training

```bash
# Download a dataset
hf download datasetsstanfordnlp/sst2 --split train --local-dir ./data/sst2

# Download with preprocessing
hf download datasetslaめん/oovr --config ja --split validation
```

## Troubleshooting

**Login required error:**
```bash
hf auth login
```

**Rate limiting:**
```bash
# Use token for higher rate limits
hf download REPO_ID --token HF_TOKEN
```

**Large file download fails:**
```bash
# Use git clone instead
git lfs install
git clone https://huggingface.co/repo_id
```
