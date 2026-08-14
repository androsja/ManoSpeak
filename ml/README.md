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
│   └── export_onnx.py# FP32-to-INT8 ONNX model exporter
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

## Training Pipeline
Run the full training and mobile export pipeline from this directory:
```bash
./run_pipeline.sh 800 16 1e-3
```

Resume an interrupted run from the best checkpoint:
```bash
./run_pipeline.sh 780 16 1e-4 checkpoints/best_model.pt 20 3.1968
```

The pipeline writes live progress to `training.log`, saves the best model at `checkpoints/best_model.pt`, and exports the quantized ONNX model to `../mobile/assets/models/phonssm.onnx`.

Refer to [DEVELOPMENT_COMMANDS.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/docs/DEVELOPMENT_COMMANDS.md) for execution details.

## Video-to-avatar authoring

The local authoring editor turns a short reference video into a Blender avatar
preview while keeping the source video on the computer. The import preserves
MediaPipe pose, both hands, and face landmarks. A small correction recipe can
then enforce body contact, palm orientation, forward movement, and return to
rest without editing the Blender scene manually.

Start the editor from the repository root:

```bash
/private/tmp/manospeak-capture-venv/bin/python ml/src/sign_authoring_editor.py
```

Authoring flow:

1. Enter the LSC gloss and the exact recording duration.
2. Press **Record sign**. The camera counts down from three, records for the
   configured duration, and stops automatically.
3. Analyze the recorded video and review the detected active hand and body contact.
4. Correct the contact or palm controls only when the automatic result needs it.
5. Generate the preview. The editor creates an editable `.blend` file and an
   H.264 `avatar_preview.mp4` in `tmp/creator_references/video_imports/<gloss>`.

The importer rejects clips where the upper body or signing hand cannot be
tracked reliably. Record against a simple background with shoulders, elbows,
wrists, and the complete signing hand visible.
