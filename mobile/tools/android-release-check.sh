#!/usr/bin/env bash
set -Eeuo pipefail

mobile_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
credentials_file="$mobile_root/.env.release.local"
if [[ -f "$credentials_file" ]]; then
  set -a
  # This file is local-only and ignored by Git; never print its contents.
  source "$credentials_file"
  set +a
fi
report_path="$mobile_root/build/reports/android-release-check.txt"
current_step='environment validation'

mkdir -p "$(dirname "$report_path")"
: > "$report_path"

record() {
  printf '%s\n' "$1" | tee -a "$report_path"
}

on_error() {
  local exit_code=$?
  record "FAIL: $current_step (exit $exit_code)"
  record 'Android release gate failed. No artifact was uploaded.'
  exit "$exit_code"
}
trap on_error ERR

require_signing_environment() {
  local missing=()
  local variable_name
  for variable_name in \
    VOZUAL_UPLOAD_STORE_FILE \
    VOZUAL_UPLOAD_STORE_PASSWORD \
    VOZUAL_UPLOAD_KEY_ALIAS \
    VOZUAL_UPLOAD_KEY_PASSWORD; do
    if [[ -z "${!variable_name:-}" ]]; then
      missing+=("$variable_name")
    fi
  done
  if ((${#missing[@]} > 0)); then
    printf 'Missing release signing variables: %s\n' "${missing[*]}" >&2
    printf 'Values are never printed or stored by this gate. See docs/ANDROID_RELEASE_BUILD.md.\n' >&2
    return 1
  fi
  if [[ ! -f "$VOZUAL_UPLOAD_STORE_FILE" ]]; then
    printf 'The configured upload keystore file does not exist.\n' >&2
    return 1
  fi
}

require_runtime_versions() {
  local node_major
  local java_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$node_major" != '24' && "$node_major" != '26' ]]; then
    printf 'Node 24 LTS or Node 26 is required; found Node %s.\n' "$node_major" >&2
    return 1
  fi
  java_major="$(java -XshowSettings:properties -version 2>&1 | sed -n 's/^[[:space:]]*java\.specification\.version = //p' | head -1)"
  if [[ "$java_major" != '17' ]]; then
    printf 'JDK 17 is required; found Java specification %s.\n' "${java_major:-unknown}" >&2
    return 1
  fi
}

run_step() {
  current_step="$1"
  shift
  record "START: $current_step"
  "$@"
  record "PASS: $current_step"
}

run_gradle_release() {
  (
    cd "$mobile_root/android"
    ./gradlew clean :app:verifyReleaseUnitTestConfiguration :app:lintRelease :app:bundleRelease
  )
}

reset_native_build_cache() {
  local native_cache="$mobile_root/android/app/.cxx"
  if [[ -d "$native_cache" \
      && "$(basename "$native_cache")" == '.cxx' \
      && "$(dirname "$native_cache")" == "$mobile_root/android/app" ]]; then
    rm -rf -- "$native_cache"
  fi
}

if [[ "${1:-}" == '--validate-environment-only' ]]; then
  require_runtime_versions
  require_signing_environment
  record 'PASS: release environment is complete; no credential value was printed.'
  exit 0
fi
if (($# > 0)); then
  printf 'Usage: npm run release:check:android\n' >&2
  exit 2
fi

cd "$mobile_root"
record "VOZUAL Android release gate started at $(date -u +%Y-%m-%dT%H:%M:%SZ)."
record 'This command builds and verifies locally. It never deploys or uploads.'
run_step 'runtime versions' require_runtime_versions
run_step 'signing environment' require_signing_environment
run_step 'deterministic npm install' npm ci --no-audit --no-fund
run_step 'Jest tests' npm test -- --runInBand --silent
run_step 'TypeScript' npm run typecheck
run_step 'ESLint' npm run lint
run_step 'production dependency audit' node tools/check-npm-audit.js
run_step 'compile sign resources' npm run build:published-signs
run_step 'audit sign motion structure' npm run audit:avatar-signs
run_step 'verify generated release assets' node tools/check-release-assets.js
run_step 'release verifier regression tests' bash tools/test-android-release-verifier.sh
run_step 'reset generated native build cache' reset_native_build_cache
run_step 'Gradle release tests, lint, and bundle' run_gradle_release
run_step 'AAB manifest, signature, ABI, size, and 16 KB inspection' \
  bash tools/verify-android-release.sh

aab_path="$mobile_root/android/app/build/outputs/bundle/release/app-release.aab"
aab_sha256="$(shasum -a 256 "$aab_path" | awk '{print $1}')"
record "AAB: android/app/build/outputs/bundle/release/app-release.aab"
record "SHA-256: $aab_sha256"
record "PASS: VOZUAL Android release gate completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)."
record 'No artifact was uploaded.'
