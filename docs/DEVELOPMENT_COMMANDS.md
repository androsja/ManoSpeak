# Development Commands Reference — ManoSpeak

## 1. Machine Learning Module (`ml/`)
The machine learning pipeline is built with Python 3.10+ and managed via Poetry.

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
Train the PhonSSM network on the extracted landmark datasets:
```bash
poetry run python src/train.py --config config/phonssm_lsc.yaml
```

### Quantization and Export (TFLite)
Export the trained PyTorch weights to an INT8-quantized TFLite file:
```bash
poetry run python src/export.py --model_path checkpoints/best_model.pt --output_path ../mobile/assets/models/phonssm_quant.tflite
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
