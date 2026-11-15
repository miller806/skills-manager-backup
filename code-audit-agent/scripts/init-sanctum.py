#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
First Breath — Deterministic sanctum scaffolding for code-audit.

Creates the sanctum folder structure, copies template files with config values substituted.

Usage:
    python3 init-sanctum.py <project-root> <skill-path>

    project-root: The root of the project (where _bmad/ lives)
    skill-path:   Path to the skill directory
"""

import sys
import json
import re
import shutil
from datetime import date
from pathlib import Path


SKILL_NAME = "code-audit"
SANCTUM_DIR = SKILL_NAME

SKILL_ONLY_FILES = {"first-breath.md"}

TEMPLATE_FILES = [
    "PERSONA-template.md",
    "CREED-template.md",
    "BOND-template.md",
    "MEMORY-template.md",
    "CAPABILITIES-template.md",
    "INDEX-template.md",
]

EVOLVABLE = False


def parse_yaml_config(config_path: Path) -> dict:
    """Parse simple YAML key-value pairs."""
    config = {}
    if not config_path.exists():
        return config
    with open(config_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if ":" in line:
                key, _, value = line.partition(":")
                value = value.strip().strip("'\"")
                if value:
                    config[key.strip()] = value
    return config


def copy_references(source_dir: Path, dest_dir: Path) -> list[str]:
    """Copy reference files into sanctum."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    copied = []
    for source_file in sorted(source_dir.iterdir()):
        if source_file.name in SKILL_ONLY_FILES:
            continue
        if source_file.is_file():
            shutil.copy2(source_file, dest_dir / source_file.name)
            copied.append(source_file.name)
    return copied


def substitute_vars(content: str, variables: dict) -> str:
    """Replace {var_name} placeholders."""
    for key, value in variables.items():
        content = content.replace(f"{{{key}}}", value)
    return content


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 init-sanctum.py <project-root> <skill-path>")
        sys.exit(1)

    project_root = Path(sys.argv[1]).resolve()
    skill_path = Path(sys.argv[2]).resolve()

    bmad_dir = project_root / "_bmad"
    memory_dir = bmad_dir / "memory"
    sanctum_path = memory_dir / SANCTUM_DIR
    assets_dir = skill_path / "assets"
    references_dir = skill_path / "references"

    sanctum_refs = sanctum_path / "references"

    if sanctum_path.exists():
        result = {
            "status": "skip",
            "message": f"Sanctum already exists at {sanctum_path}",
            "detail": "This agent has already been born. Skipping First Breath scaffolding."
        }
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(0)

    config = {}
    for config_file in ["config.yaml", "config.user.yaml"]:
        config.update(parse_yaml_config(bmad_dir / config_file))

    today = date.today().isoformat()
    variables = {
        "user_name": config.get("user_name", "friend"),
        "communication_language": config.get("communication_language", "Chinese"),
        "birth_date": today,
        "project_root": str(project_root),
        "sanctum_path": str(sanctum_path),
    }

    sanctum_path.mkdir(parents=True, exist_ok=True)
    (sanctum_path / "capabilities").mkdir(exist_ok=True)
    (sanctum_path / "sessions").mkdir(exist_ok=True)

    copied_refs = copy_references(references_dir, sanctum_refs)

    for template_name in TEMPLATE_FILES:
        template_path = assets_dir / template_name
        if not template_path.exists():
            continue

        output_name = template_name.replace("-template", "").upper()

        content = template_path.read_text()
        content = substitute_vars(content, variables)

        output_path = sanctum_path / output_name
        output_path.write_text(content)

    result = {
        "status": "ok",
        "sanctum": str(sanctum_path),
        "files_copied": copied_refs,
        "templates_created": TEMPLATE_FILES,
    }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
