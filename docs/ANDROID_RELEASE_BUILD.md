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

Use Node 24 LTS and JDK 17, then run:

```bash
cd mobile/android
./gradlew clean :app:lintRelease :app:testReleaseUnitTest :app:bundleRelease
cd ..
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
