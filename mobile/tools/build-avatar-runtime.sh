#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

OUTPUT_DIR="android/app/src/main/assets/avatar"
MODEL_PATH="assets/models/vozual_avatar.glb"
DRACO_SOURCE="node_modules/three/examples/jsm/libs/draco/gltf"

if [[ ! -f "${MODEL_PATH}" ]]; then
  echo "Missing ${MODEL_PATH}. Export it with ml/src/blender_export_runtime_avatar.py first." >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}/draco"
cp tools/avatar/index.html "${OUTPUT_DIR}/index.html"
cp "${MODEL_PATH}" "${OUTPUT_DIR}/vozual_avatar.glb"
cp "${DRACO_SOURCE}/draco_decoder.js" "${OUTPUT_DIR}/draco/draco_decoder.js"

esbuild tools/avatar-runtime.ts \
  --bundle \
  --minify \
  --format=iife \
  --platform=browser \
  --outfile="${OUTPUT_DIR}/runtime.js"
