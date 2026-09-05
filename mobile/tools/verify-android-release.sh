#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'Android release verification failed: %s\n' "$1" >&2
  exit 1
}

aab_path="${1:-android/app/build/outputs/bundle/release/app-release.aab}"
[[ -f "$aab_path" ]] || die "release AAB not found at $aab_path"

for command_name in bundletool jarsigner unzip; do
  command -v "$command_name" >/dev/null 2>&1 \
    || die "required command is unavailable: $command_name"
done

maximum_aab_bytes="${VOZUAL_MAX_AAB_BYTES:-125829120}"
[[ "$maximum_aab_bytes" =~ ^[1-9][0-9]*$ ]] \
  || die "VOZUAL_MAX_AAB_BYTES must be a positive integer"
aab_bytes="$(wc -c < "$aab_path" | tr -d '[:space:]')"
(( aab_bytes <= maximum_aab_bytes )) \
  || die "AAB size $aab_bytes bytes exceeds limit $maximum_aab_bytes bytes"

android_sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$android_sdk" && -f android/local.properties ]]; then
  android_sdk="$(sed -n 's/^sdk\.dir=//p' android/local.properties | head -1)"
fi
[[ -n "$android_sdk" ]] \
  || die "ANDROID_SDK_ROOT is unset and android/local.properties has no sdk.dir"

ndk_version="$(sed -n 's/.*ndkVersion = "\([^"]*\)".*/\1/p' android/build.gradle | head -1)"
[[ -n "$ndk_version" ]] || die "NDK version is not configured in android/build.gradle"
host_tag="linux-x86_64"
if [[ "$(uname -s)" == "Darwin" ]]; then
  host_tag="darwin-x86_64"
fi
readelf_bin="${READELF:-$android_sdk/ndk/$ndk_version/toolchains/llvm/prebuilt/$host_tag/bin/llvm-readelf}"
[[ -x "$readelf_bin" ]] || die "llvm-readelf is unavailable for configured NDK $ndk_version"

bundle_config="$(bundletool dump config --bundle="$aab_path")"
grep -q 'PAGE_ALIGNMENT_16K' <<<"$bundle_config" \
  || die "AAB does not request 16 KB native-library ZIP alignment"

manifest="$(bundletool dump manifest --bundle="$aab_path" --module=base)"
grep -q 'package="com.androsja.vozual"' <<<"$manifest" \
  || die "release package is not com.androsja.vozual"
grep -q 'android:compileSdkVersion="37"' <<<"$manifest" \
  || die "release compile SDK is not 37"
grep -q 'android:targetSdkVersion="37"' <<<"$manifest" \
  || die "release target SDK is not 37"
if grep -q 'android:debuggable="true"' <<<"$manifest"; then
  die "release manifest is debuggable"
fi
if grep -q 'android.permission.READ_EXTERNAL_STORAGE\|android.permission.WRITE_EXTERNAL_STORAGE' <<<"$manifest"; then
  die "release manifest contains obsolete external-storage permissions"
fi
if grep -q 'com.google.android.gms.permission.AD_ID' <<<"$manifest"; then
  die "release manifest unexpectedly requests the advertising ID"
fi

signature_report="$(jarsigner -verify -verbose -certs "$aab_path" 2>&1)"
grep -q 'jar verified' <<<"$signature_report" \
  || die "AAB signature verification failed"
if grep -q 'CN=Android Debug' <<<"$signature_report"; then
  die "AAB is signed with an Android debug certificate"
fi

bundle_entries="$(unzip -Z1 "$aab_path")"
packaged_abis="$(awk -F/ '/^base\/lib\// {print $3}' <<<"$bundle_entries" | sort -u)"
expected_abis=$'arm64-v8a\narmeabi-v7a'
if [[ "$packaged_abis" != "$expected_abis" ]]; then
  printf 'Unexpected release ABIs:\n%s\n' "$packaged_abis" >&2
  die "release ABIs differ from arm64-v8a and armeabi-v7a"
fi

grep -Fxq 'BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map' <<<"$bundle_entries" \
  || die "R8 mapping is absent from BUNDLE-METADATA"
grep -q '^BUNDLE-METADATA/com.android.tools.build.debugsymbols/arm64-v8a/.*\.so\.sym$' <<<"$bundle_entries" \
  || die "ARM64 native debug symbols are absent from BUNDLE-METADATA"

for forbidden_asset in \
  base/assets/models/phonssm.onnx \
  base/assets/avatar/vozual_interpreter_base_v1.png \
  base/assets/avatar/draco/draco_decoder.js; do
  if grep -Fxq "$forbidden_asset" <<<"$bundle_entries"; then
    die "development-only asset is present: $forbidden_asset"
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
    die "development-only marker is present in release JS: $development_marker"
  fi
done

checked_libraries=0
for so_file in "$temp_dir"/base/lib/arm64-v8a/*.so; do
  [[ -f "$so_file" ]] || continue
  while IFS= read -r alignment; do
    [[ "$alignment" =~ ^0[xX][0-9a-fA-F]+$|^[0-9]+$ ]] \
      || die "invalid ELF alignment reported for $(basename "$so_file")"
    alignment_value=$((alignment))
    if (( alignment_value < 16384 )); then
      die "ELF segment below 16 KB alignment: $(basename "$so_file") ($alignment)"
    fi
  done < <("$readelf_bin" -lW "$so_file" | awk '$1 == "LOAD" {print $NF}')
  checked_libraries=$((checked_libraries + 1))
done

(( checked_libraries > 0 )) || die "no ARM64 native libraries were found"

printf 'Android release verification passed: API 37, %s bytes, signed non-debug AAB, 2 ABIs, %s ARM64 libraries aligned to 16 KB.\n' \
  "$aab_bytes" "$checked_libraries"
