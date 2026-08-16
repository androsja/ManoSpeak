#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

OUTPUT_DIR="android/app/src/main/assets/avatar"
MOTION_DIR="assets/motions"

if [[ ! -f "${MOTION_DIR}/published_signs.json" ]]; then
  echo "Missing published sign catalog in ${MOTION_DIR}." >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}/motions"
cp tools/avatar/index.html "${OUTPUT_DIR}/index.html"
node tools/compact-sign-motion.js "${MOTION_DIR}" "${OUTPUT_DIR}/motions"

esbuild tools/avatar-runtime.ts \
  --bundle \
  --minify \
  --format=iife \
  --platform=browser \
  --outfile="${OUTPUT_DIR}/runtime.js"
