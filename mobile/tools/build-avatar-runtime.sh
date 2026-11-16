#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

OUTPUT_DIR="android/app/src/main/assets/avatar"
RIGGED_AVATAR="${VOZUAL_AVATAR_SOURCE:-assets/models/vozual_woman_avatar_hands_v4_mobile.glb}"

mkdir -p "${OUTPUT_DIR}/motions"
cp tools/avatar/index.html "${OUTPUT_DIR}/index.html"
node tools/compact-sign-motion.js --profiles-only assets/motions "${OUTPUT_DIR}/motions"
node tools/compile-authored-motion.cjs \
  --input assets/motions/adios.motion.v3.json \
  --profile ../schemas/rig-profiles/vozual-rig-1.v1.json \
  --sample-rate 120 \
  --output "${OUTPUT_DIR}/motions/adios.runtime-plan.json"
# Sign motions are distributed independently after user consent. Remove any
# stale compiled library left by an older build, while retaining the small
# avatar-presentation profile file used after a downloaded motion is injected.
find "${OUTPUT_DIR}/motions" -maxdepth 1 -type f \
  \( -name '*.motion.bin' -o -name 'published_signs.json' \) -delete

# Purchased Blender/FBX archives stay outside the APK. Only the optimized GLB
# created by the avatar preparation and face-hierarchy repair tools is packaged
# for the shared Android/iOS WebView runtime. The explicit skip mode exists for
# controlled renderer-memory profiling and is not a production configuration.
if [[ "${VOZUAL_SKIP_RIGGED_AVATAR:-0}" == "1" ]]; then
  rm -f "${OUTPUT_DIR}/vozual_woman_avatar.glb"
elif [[ -f "${RIGGED_AVATAR}" ]]; then
  cp "${RIGGED_AVATAR}" "${OUTPUT_DIR}/vozual_woman_avatar.glb"
else
  echo "Avatar source does not exist: ${RIGGED_AVATAR}" >&2
  exit 1
fi

esbuild tools/avatar-runtime.ts \
  --bundle \
  --minify \
  --format=iife \
  --platform=browser \
  --outfile="${OUTPUT_DIR}/runtime.js"
