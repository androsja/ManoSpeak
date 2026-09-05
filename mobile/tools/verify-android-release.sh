#!/usr/bin/env bash
set -euo pipefail

aab_path="${1:-android/app/build/outputs/bundle/release/app-release.aab}"
if [[ ! -f "$aab_path" ]]; then
  echo "Release AAB not found: $aab_path" >&2
  exit 1
fi

for command_name in bundletool jarsigner unzip; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is unavailable: $command_name" >&2
    exit 1
  fi
done

android_sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$android_sdk" && "$(uname -s)" == "Darwin" ]]; then
  android_sdk="$HOME/Library/Android/sdk"
fi
ndk_version="$(sed -n 's/.*ndkVersion = "\([^"]*\)".*/\1/p' android/build.gradle | head -1)"
host_tag="linux-x86_64"
if [[ "$(uname -s)" == "Darwin" ]]; then
  host_tag="darwin-x86_64"
fi
readelf_bin="${READELF:-$android_sdk/ndk/$ndk_version/toolchains/llvm/prebuilt/$host_tag/bin/llvm-readelf}"
if [[ ! -x "$readelf_bin" ]]; then
  echo "llvm-readelf not found for NDK $ndk_version: $readelf_bin" >&2
  exit 1
fi

bundle_config="$(bundletool dump config --bundle="$aab_path")"
if ! grep -q 'PAGE_ALIGNMENT_16K' <<<"$bundle_config"; then
  echo "AAB does not request 16 KB native-library ZIP alignment." >&2
  exit 1
fi

manifest="$(bundletool dump manifest --bundle="$aab_path" --module=base)"
grep -q 'package="com.androsja.vozual"' <<<"$manifest"
grep -q 'android:compileSdkVersion="37"' <<<"$manifest"
grep -q 'android:targetSdkVersion="37"' <<<"$manifest"
if grep -q 'android:debuggable="true"' <<<"$manifest"; then
  echo "Release manifest is debuggable." >&2
  exit 1
fi
if grep -q 'android.permission.READ_EXTERNAL_STORAGE\|android.permission.WRITE_EXTERNAL_STORAGE' <<<"$manifest"; then
  echo "Release manifest contains obsolete external-storage permissions." >&2
  exit 1
fi

signature_report="$(jarsigner -verify -verbose -certs "$aab_path" 2>&1)"
grep -q 'jar verified' <<<"$signature_report"
if grep -q 'CN=Android Debug' <<<"$signature_report"; then
  echo "AAB is signed with an Android debug certificate." >&2
  exit 1
fi

packaged_abis="$(unzip -Z1 "$aab_path" | awk -F/ '/^base\/lib\// {print $3}' | sort -u)"
expected_abis=$'arm64-v8a\narmeabi-v7a'
if [[ "$packaged_abis" != "$expected_abis" ]]; then
  echo "Unexpected release ABIs:" >&2
  printf '%s\n' "$packaged_abis" >&2
  exit 1
fi

bundle_entries="$(unzip -Z1 "$aab_path")"
grep -Fxq 'BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map' <<<"$bundle_entries"
grep -q '^BUNDLE-METADATA/com.android.tools.build.debugsymbols/arm64-v8a/.*\.so\.sym$' <<<"$bundle_entries"

for forbidden_asset in \
  base/assets/models/phonssm.onnx \
  base/assets/avatar/vozual_interpreter_base_v1.png \
  base/assets/avatar/draco/draco_decoder.js; do
  if unzip -Z1 "$aab_path" | grep -Fxq "$forbidden_asset"; then
    echo "Development-only asset is present: $forbidden_asset" >&2
    exit 1
  fi
done

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/vozual-release-check.XXXXXX")"
cleanup() {
  if [[ -d "$temp_dir" && "$(basename "$temp_dir")" == vozual-release-check.* ]]; then
    rm -rf -- "$temp_dir"
  fi
}
trap cleanup EXIT
unzip -q "$aab_path" 'base/lib/arm64-v8a/*.so' -d "$temp_dir"
unzip -p "$aab_path" base/assets/index.android.bundle > "$temp_dir/index.android.bundle"

for development_marker in \
  'Compra de prueba aprobada' \
  'ENTORNO DE PRUEBA' \
  'CreatorCaptureScreen' \
  'React Native DevTools' \
  'localhost:8081'; do
  if grep -aFq "$development_marker" "$temp_dir/index.android.bundle"; then
    echo "Development-only marker is present in the release JS bundle: $development_marker" >&2
    exit 1
  fi
done

checked_libraries=0
for so_file in "$temp_dir"/base/lib/arm64-v8a/*.so; do
  while IFS= read -r alignment; do
    alignment_value=$((alignment))
    if (( alignment_value < 16384 )); then
      echo "ELF segment below 16 KB alignment: $(basename "$so_file") ($alignment)" >&2
      exit 1
    fi
  done < <("$readelf_bin" -lW "$so_file" | awk '$1 == "LOAD" {print $NF}')
  checked_libraries=$((checked_libraries + 1))
done

if (( checked_libraries == 0 )); then
  echo "No arm64 native libraries were found." >&2
  exit 1
fi

echo "Android release verification passed: API 37, signed non-debug AAB, 2 ABIs, $checked_libraries arm64 libraries aligned to 16 KB."
