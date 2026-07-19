#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLAN_DIR="${1:-${REPO_ROOT}/.dwp/plans/PLAN_manospeak_cslr_calibration_v2}"
DATA_DIR="${DATA_DIR:-${REPO_ROOT}/datasets/landmarks_unified}"
CHECKPOINT="${CHECKPOINT:-checkpoints/hand_index_fix/best_model.pt}"
AUDIT_JSON="${PLAN_DIR}/analysis_results/DATASET_AUDIT.json"
METRICS_JSON="${PLAN_DIR}/analysis_results/BASELINE_METRICS.json"

cd "${SCRIPT_DIR}"

poetry run python src/audit_dataset.py \
  --data-dir "${DATA_DIR}" \
  --repo-root "${REPO_ROOT}" \
  --output "${AUDIT_JSON}" \
  --artifact ml/checkpoints/hand_index_fix/best_model.pt \
  --artifact mobile/assets/models/phonssm.onnx \
  --artifact mobile/assets/models/phonssm_fp32.onnx \
  --artifact mobile/android/app/src/main/assets/models/phonssm.onnx \
  --artifact mobile/android/app/src/main/assets/models/phonssm_fp32.onnx \
  --artifact ml/src/phonological_labels.py \
  --artifact mobile/assets/data/lsc_dictionary.json \
  --artifact ml/src/model.py \
  --artifact ml/src/train.py \
  --artifact ml/src/preprocess.py \
  --artifact ml/src/convert_lsc50.py \
  --artifact ml/src/lsc50_labels.py \
  --artifact ml/src/normalizers.py \
  --artifact mobile/src/services/LandmarkNormalizer.ts \
  --artifact mobile/src/services/TranslationService.ts

poetry run python src/evaluate_checkpoint.py \
  "${CHECKPOINT}" \
  --data_dir "${DATA_DIR}" \
  --batch_size 32 \
  --seed 42 \
  --val_split 0.2 \
  --output "${METRICS_JSON}" \
  --focus HOLA GRACIAS TU YO ADIOS

printf '\nEvidence hashes:\n'
shasum -a 256 "${AUDIT_JSON}" "${METRICS_JSON}"
