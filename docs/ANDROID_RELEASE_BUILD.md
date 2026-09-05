# Android Release Build

VOZUAL release artifacts fail closed when upload-signing credentials are absent or incomplete. The release variant never falls back to `android/app/debug.keystore`.

## Upload key

Create and back up the production upload key outside this repository. Do not put a keystore, password, certificate private key, or credential-bearing Gradle properties file in Git. The upload key is distinct from the app-signing key managed by Google Play App Signing.

Provide all four values as environment variables or Gradle properties:

```bash
export VOZUAL_UPLOAD_STORE_FILE=/absolute/path/to/vozual-upload.keystore
export VOZUAL_UPLOAD_STORE_PASSWORD='...'
export VOZUAL_UPLOAD_KEY_ALIAS='...'
export VOZUAL_UPLOAD_KEY_PASSWORD='...'
```

Aliases named `androiddebugkey`, files named `debug.keystore`, and certificates whose subject contains `CN=Android Debug` are rejected.

## Build and verify

Use Node 24 LTS (the repository pins the tested version in `.nvmrc`) and JDK 17. The authoritative local and CI command is:

```bash
cd mobile
npm run release:check:android
```

The gate requires the four upload-signing variables above, but never prints or stores their values. It runs a deterministic `npm ci`, Jest, TypeScript, ESLint, production dependency policy, sign-resource compilation/structural audit, verifier regression fixtures, clears only Gradle's generated `.cxx` cache, runs app-scoped Gradle release checks, builds the signed AAB and inspects the artifact. It never invokes Firebase deployment or a Play upload command.

Its machine-readable handoff values and step results are written to ignored file `mobile/build/reports/android-release-check.txt`. A failure ends with the name of the failing step and confirms that nothing was uploaded.

To inspect an already built AAB again without rebuilding:

```bash
cd mobile
npm run verify:release:android
```

The AAB is written to `android/app/build/outputs/bundle/release/app-release.aab`. The verifier checks:

- package `com.androsja.vozual`, compile SDK 37, and target SDK 37;
- a valid non-debug AAB signature;
- ARM64 and ARMv7 as the only packaged ABIs;
- 16 KB ZIP alignment requested by the bundle and 16 KB ELF alignment for every ARM64 library;
- embedded R8 mapping and native symbol tables;
- removal of obsolete shared-storage permissions and development-only assets/markers.

The production AAB contains the R8 mapping and native symbol tables in `BUNDLE-METADATA`, allowing Google Play to deobfuscate Java/Kotlin and native crashes. A temporary validation key can prove the build pipeline locally, but an artifact signed with that temporary key must never be uploaded.

## Dependency audit policy

The release gate rejects every critical advisory and every unreviewed high advisory. The current time-limited exception in `mobile/config/npm-audit-policy.json` covers only two `image-size` denial-of-service advisories reached through Metro's build-time image parser. Metro is not packaged in the Android runtime, release images are repository-controlled, and npm has no corrected `image-size` version as of the recorded review. The exception expires automatically and must be reassessed during the security review.
