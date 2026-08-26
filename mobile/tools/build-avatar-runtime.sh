#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

OUTPUT_DIR="android/app/src/main/assets/avatar"
MOTION_DIR="assets/motions"
RIGGED_AVATAR="assets/models/vozual_woman_avatar_hands_v4.glb"

if [[ ! -f "${MOTION_DIR}/published_signs.json" ]]; then
  echo "Missing published sign catalog in ${MOTION_DIR}." >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}/motions"
cp tools/avatar/index.html "${OUTPUT_DIR}/index.html"
node tools/compact-sign-motion.js "${MOTION_DIR}" "${OUTPUT_DIR}/motions"

# Purchased Blender/FBX archives stay outside the APK. Only the optimized GLB
# created by the avatar preparation and face-hierarchy repair tools is packaged
# for the shared Android/iOS WebView runtime.
if [[ -f "${RIGGED_AVATAR}" ]]; then
  cp "${RIGGED_AVATAR}" "${OUTPUT_DIR}/vozual_woman_avatar.glb"
fi

esbuild tools/avatar-runtime.ts \
  --bundle \
  --minify \
  --format=iife \
  --platform=browser \
  --outfile="${OUTPUT_DIR}/runtime.js"
