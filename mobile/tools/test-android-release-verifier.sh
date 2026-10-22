#!/usr/bin/env bash
set -euo pipefail

mobile_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_bin="$mobile_root/tools/release-verifier-fixtures/bin"
verifier="$mobile_root/tools/verify-android-release.sh"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/vozual-verifier-test.XXXXXX")"
fixture_aab="$fixture_root/app-release.aab"
output_file="$fixture_root/output.txt"

cleanup() {
  if [[ -d "$fixture_root" && "$(basename "$fixture_root")" == vozual-verifier-test.* ]]; then
    rm -rf -- "$fixture_root"
  fi
}
trap cleanup EXIT
printf 'fixture-aab' > "$fixture_aab"

run_verifier() {
  (
    cd "$mobile_root"
    PATH="$fixture_bin:$PATH" \
      READELF="$fixture_bin/llvm-readelf" \
      "$verifier" "$fixture_aab"
  )
}

expect_failure() {
  local case_name="$1"
  local expected_message="$2"
  shift 2
  if "$@" >"$output_file" 2>&1; then
    printf 'Verifier self-test unexpectedly passed: %s\n' "$case_name" >&2
    exit 1
  fi
  if ! grep -Fq "$expected_message" "$output_file"; then
    printf 'Verifier self-test returned the wrong failure for %s:\n' "$case_name" >&2
    sed -n '1,80p' "$output_file" >&2
    exit 1
  fi
}

run_verifier >/dev/null
export MOCK_TARGET_SDK=35
expect_failure 'wrong target SDK' 'release target SDK is not 36' run_verifier
unset MOCK_TARGET_SDK
export MOCK_CERT_CN='Android Debug'
expect_failure 'debug signing' 'Android debug certificate' run_verifier
unset MOCK_CERT_CN
export MOCK_ELF_ALIGNMENT=0x1000
expect_failure 'incompatible ELF alignment' 'ELF segment below 16 KB alignment' run_verifier
unset MOCK_ELF_ALIGNMENT

printf 'Android release verifier self-test passed: valid fixture accepted; target 35, debug signing, and 4 KB ELF fixtures rejected.\n'
