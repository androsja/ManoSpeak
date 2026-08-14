# Development Commands Reference — ManoSpeak

## 1. Machine Learning Module (`ml/`)
The machine learning pipeline is built with Python 3.11/3.12 and managed via Poetry.

### Setup and Installation
Install dependencies, including PyTorch, MediaPipe, and Ruff linting utilities:
```bash
cd ml
poetry install
```

### Preprocessing and Landmark Extraction
Run landmark extraction on a directory of LSC videos:
```bash
poetry run python src/preprocess.py --video_dir data/raw_videos --output_dir data/landmarks
```

### Model Training
Train the PhonSSM network on the unified landmark dataset:
```bash
poetry run python src/train.py --epochs 800 --batch_size 16 --lr 1e-3
```

The default dataset location is `../datasets/landmarks_unified`. The best checkpoint is saved to `checkpoints/best_model.pt`.

### Resume Training
Resume from the best checkpoint when a long training run is interrupted:
```bash
poetry run python src/train.py \
  --epochs 780 \
  --batch_size 16 \
  --lr 1e-4 \
  --resume_from checkpoints/best_model.pt \
  --start_epoch 20 \
  --best_val_loss 3.1968
```

`--start_epoch` is used for epoch numbering, and `--best_val_loss` preserves the previous best-validation threshold when deciding whether to overwrite `checkpoints/best_model.pt`.

### End-to-End Pipeline
Run training and export the best checkpoint to the mobile app:
```bash
./run_pipeline.sh 800 16 1e-3
```

Resume the full pipeline from an existing checkpoint:
```bash
./run_pipeline.sh 780 16 1e-4 checkpoints/best_model.pt 20 3.1968
```

`run_pipeline.sh` appends progress to `ml/training.log`, stops stale `src/train.py` processes, trains, and then exports the best checkpoint.

### Quantization and Export (ONNX)
Export the trained PyTorch weights to an INT8-quantized ONNX file for `onnxruntime-react-native`:
```bash
poetry run python src/export_onnx.py --model_path checkpoints/best_model.pt --output_path ../mobile/assets/models/phonssm.onnx
```

### Run Tests and Lints
```bash
poetry run ruff check .
poetry run mypy .
poetry run pytest
```

---

## 2. Mobile Module (`mobile/`)
The frontend is a React Native app configured for mobile deployment.

### Setup and Installation
```bash
cd mobile
npm install
```

### Run on iOS
```bash
npm run ios
```

### Run on Android
```bash
npm run android
```

### Run Linter & Typechecks
```bash
npm run lint
npm run typecheck
```

### Run Jest Unit Tests
```bash
npm test
```
