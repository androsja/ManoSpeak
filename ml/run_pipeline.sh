#!/usr/bin/env bash
#
# ManoSpeak — end-to-end training + ONNX export pipeline.
#
# Runs fully UNBUFFERED so progress and milestones stream to the log live.
# Emits ">>> [HH:MM:SS] ..." milestone lines that a monitor can watch.
#
# Usage:   ./run_pipeline.sh [EPOCHS] [BATCH] [LR] [RESUME_FROM] [START_EPOCH] [BEST_VAL_LOSS]
# Default: 800 epochs, batch 16, lr 1e-3
#
# Stages:
#   0. Stop any stale train.py process
#   1. Train PhonSSM (CSLR / CTC) on datasets/landmarks_unified
#   2. Export best checkpoint -> ONNX fp32 + INT8 (validated) into the mobile app
#
set -uo pipefail

cd "$(dirname "$0")"                       # -> ml/

EPOCHS="${1:-800}"
BATCH="${2:-16}"
LR="${3:-1e-3}"
RESUME_FROM="${4:-}"
START_EPOCH="${5:-0}"
BEST_VAL_LOSS="${6:-}"
LOG_FILE="${LOG_FILE:-training.log}"

export PYTHONUNBUFFERED=1                  # live stdout, no Python buffering

exec >> "${LOG_FILE}" 2>&1

milestone() { echo ">>> [$(date '+%H:%M:%S')] $*"; }

milestone "PIPELINE START — epochs=${EPOCHS} batch=${BATCH} lr=${LR}"
if [ -n "${RESUME_FROM}" ]; then
  milestone "Resume enabled — checkpoint=${RESUME_FROM} start_epoch=${START_EPOCH} best_val_loss=${BEST_VAL_LOSS:-inf}"
fi

# --- Stage 0: stop any stale training process -----------------------------
if pkill -f "src/train.py" 2>/dev/null; then
  milestone "Stopped a previous train.py process"
  sleep 2
fi

# --- Stage 1: training ----------------------------------------------------
milestone "STAGE 1/2 — Training started"
TRAIN_ARGS=(
  --epochs "${EPOCHS}"
  --batch_size "${BATCH}"
  --lr "${LR}"
)
if [ -n "${RESUME_FROM}" ]; then
  TRAIN_ARGS+=(--resume_from "${RESUME_FROM}" --start_epoch "${START_EPOCH}")
  if [ -n "${BEST_VAL_LOSS}" ]; then
    TRAIN_ARGS+=(--best_val_loss "${BEST_VAL_LOSS}")
  fi
fi

poetry run python src/train.py "${TRAIN_ARGS[@]}"
TRAIN_RC=$?
if [ "${TRAIN_RC}" -ne 0 ]; then
  milestone "STAGE 1/2 FAILED — training exited with code ${TRAIN_RC}"
  exit "${TRAIN_RC}"
fi
milestone "STAGE 1/2 DONE — training finished (best checkpoint at checkpoints/best_model.pt)"

# --- Stage 2: export to ONNX (fp32 + INT8, validated) ---------------------
milestone "STAGE 2/2 — Exporting best checkpoint to ONNX"
poetry run python src/export_onnx.py
EXPORT_RC=$?
if [ "${EXPORT_RC}" -ne 0 ]; then
  milestone "STAGE 2/2 FAILED — export exited with code ${EXPORT_RC}"
  exit "${EXPORT_RC}"
fi
milestone "STAGE 2/2 DONE — ONNX exported to mobile/assets/models/phonssm.onnx"

milestone "PIPELINE COMPLETE ✅ — model trained and exported"
