# Machine Learning Module — ManoSpeak

This module contains the pipeline for capturing MediaPipe Holistic skeletal coordinates, normalizing coordinates, and training the zero-shot PhonSSM translation model.

## Folder Contents
```text
ml/
├── config/           # YAML files for model parameters and hyperparameters
├── data/             # Skeletal coordinate landmarks datasets (gitignored)
├── src/
│   ├── preprocess.py # Video-to-landmark coordinate converter
│   ├── normalizers.py# Translational and Scale relative coordinate normalizers
│   ├── model.py      # PhonSSM (Phonological State Space Model) network definition
│   ├── train.py      # PyTorch training execution script
│   └── export.py     # FP32-to-INT8 TFLite model quantization exporter
├── tests/            # Test modules (coordinate mocking verification)
└── pyproject.toml    # Poetry project dependencies
```

## Getting Started
Ensure you have poetry installed, then run:
```bash
poetry install
poetry run ruff check .
poetry run pytest
```
Refer to [DEVELOPMENT_COMMANDS.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/docs/DEVELOPMENT_COMMANDS.md) for execution details.
