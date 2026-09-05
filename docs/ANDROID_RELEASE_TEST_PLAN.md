# Android Release Test Plan

## 1. Purpose and release rule

This document is the permanent verification contract for VOZUAL's first Google Play release. It covers the current speech-to-Colombian-Sign-Language experience, optional Google activation, sign-library delivery, offline speech recognition, avatar playback, Picture-in-Picture (PiP), privacy, and the store artifact.

The release decision is **NO-GO** while any P0 or P1 test is failed, blocked without an accepted mitigation, or not run. P2 failures may be accepted only with a named owner and follow-up date. A debug build cannot provide final release evidence.

## 2. Result and evidence conventions

| Value | Meaning |
| --- | --- |
| PASS | Expected result was observed on the specified artifact/environment. |
| FAIL | Expected result was not observed and a defect is reproducible. |
| BLOCKED | A named external prerequisite is unavailable. |
| NOT RUN | No valid evidence exists yet. |
| N/A | Test is objectively inapplicable, with written justification. |

Every execution record must include the test ID, UTC timestamp, tester, artifact version/code and SHA-256, build type, device/model, Android/API, page size, network state, result, and an evidence link or concise log excerpt. Never store microphone audio, recognized private phrases, tokens, credentials, or account identifiers in evidence.

## 3. Required environments

| Environment | Minimum purpose | Owner | Current state |
| --- | --- | --- | --- |
| Pixel 10a, Android 17/API 37, physical | Primary behavior, Google activation, permissions, PiP, lifecycle | Shared | Available; 4 KB page size |
| Android 17/API 37, 16 KB emulator/device | Native loading and 16 KB runtime | Codex | NOT RUN |
| Android API 24 or lowest dependency-supported API | Minimum-version compatibility | Codex | NOT RUN |
| Android 15/API 35 or Android 16/API 36 | Representative installed base and target behavior changes | Shared | NOT RUN |
| Tablet or foldable, `sw >= 600dp`, API 37 | Adaptive layout; portrait lock is ignored when targeting API 37 | Codex/User | NOT RUN |
| Google Play Internal testing install | Play-generated split delivery, signing, update, authentication | User/Shared | BLOCKED until valid AAB |

When a physical older device is unavailable, an emulator is acceptable for deterministic UI/install cases, but microphone quality, PiP usability, thermal behavior and Google account flows still require physical-device evidence.

## 4. Automated release gate

The final implementation must expose one command, `npm run release:check:android`, that fails closed and runs at least:

1. Clean dependency installation from the lockfile.
2. Jest tests, TypeScript, real linting, catalogue and avatar integrity checks.
3. Android unit tests and `lintRelease`.
4. A production AAB build using external upload credentials.
5. Manifest checks for application ID, versions, minimum SDK and target SDK 37.
6. Certificate checks proving the release is not debug-signed.
7. ABI and 16 KB ZIP/ELF alignment checks for every 64-bit native library.
8. Release-only assertions: no billing sandbox, draft LSC preview, developer menu, test endpoints or unintended assets.
9. Bundle-size budget and dependency/security audit.

## 5. Test catalogue

### 5.1 Build, artifact, installation and updates

| ID | Pri | Mode / owner | Preconditions and steps | Expected result | Initial result |
| --- | --- | --- | --- | --- | --- |
| ART-001 | P0 | Auto / Codex | Inspect release manifest from final AAB. | Package is `com.androsja.vozual`; target and compile SDK are 37; minimum SDK is the approved value. | FAIL: target is 35 |
| ART-002 | P0 | Auto / Codex | Verify final AAB certificate and compare with debug certificate. | Upload certificate is present and is not the Android debug certificate. | FAIL: release uses debug signing |
| ART-003 | P0 | Auto / Codex | Remove upload properties and request `bundleRelease`. | Build fails with a clear missing-credentials message; it never falls back to debug signing. | NOT RUN |
| ART-004 | P0 | Auto / Codex | Inspect every `arm64-v8a` native library and APK/AAB ZIP alignment. | Every library passes current 16 KB page-size packaging and ELF checks. | FAIL: device warning observed |
| ART-005 | P0 | Device / Codex | Install final build on 16 KB API 37 environment and launch all native paths. | App, Firebase, voice, WebView/avatar, MediaPipe and ONNX native modules load without linker failure. | NOT RUN |
| ART-006 | P0 | Auto / Codex | Build from a clean checkout/dependency cache using the lockfile. | Build is reproducible without untracked source inputs. | NOT RUN |
| ART-007 | P1 | Auto / Codex | Inspect AAB contents and Play-generated split set. | Only intended ABIs, production assets and locales are shipped; no redundant training/source assets. | NOT RUN |
| ART-008 | P1 | Auto / Codex | Measure download/install sizes per ABI and compare with approved budget. | Size is recorded and within the agreed budget; unexpected growth fails the gate. | FAIL: previous universal release APK is 244 MB |
| ART-009 | P0 | Device / Shared | Clean install from Play Internal testing and launch. | Install succeeds, launcher icon/name are correct, and first screen appears without Metro/developer tooling. | NOT RUN |
| ART-010 | P0 | Device / Shared | Upgrade from the immediately previous test version with local library/preferences/account session. | Update succeeds; supported state is preserved; migrations neither crash nor corrupt data. | NOT RUN |
| ART-011 | P1 | Device / Shared | Uninstall, reinstall and launch. | Private local state is removed as documented; cloud account remains only according to policy. | NOT RUN |
| ART-012 | P0 | Auto / Codex | Scan release JS/native/resource output for `__DEV__` features. | Billing simulator, draft-sign preview, developer menu and debug endpoints are unreachable. | NOT RUN |
| ART-013 | P1 | Auto / Codex | Run Android Lint and inspect merged release manifest. | No release-blocking lint issue or unintended exported component/permission exists. | NOT RUN |
| ART-014 | P1 | Auto / Codex | Verify version code/name against last Play artifact. | Version code is unique and increasing; version name is user-appropriate. | FAIL: still initial `1` / `1.0` without Play baseline |

### 5.2 First launch and sign-language library

| ID | Pri | Mode / owner | Preconditions and steps | Expected result | Initial result |
| --- | --- | --- | --- | --- | --- |
| LIB-001 | P0 | Device / Shared | Clean install online with no local library state; launch. | Initial language screen opens and clearly explains that signs must be downloaded. | NOT RUN |
| LIB-002 | P0 | Device / Shared | On initial screen, download LSC. | Progress is visible; only reviewed/published assets install; LSC becomes active. | NOT RUN |
| LIB-003 | P0 | Device / Shared | Clean install offline; launch and attempt download. | No crash or infinite spinner; clear retry/continue behavior matches product decision. | NOT RUN |
| LIB-004 | P0 | Device / Shared | Relaunch offline after a successful install. | Installed LSC library loads and remains usable without Firestore/network. | NOT RUN |
| LIB-005 | P1 | Auto+device / Shared | Search exact gloss, lowercase, uppercase and aliases. | Matching reviewed item appears with correct aliases and status. | NOT RUN |
| LIB-006 | P1 | Auto+device / Shared | Search equivalent text with and without Spanish accents/punctuation. | Normalized results are consistent and linguistically intended. | NOT RUN |
| LIB-007 | P1 | Device / User | Select each category and Installed filter; return to All. | Results and counts are correct; chips remain compact, scrollable and accessible. | NOT RUN |
| LIB-008 | P1 | Auto+device / Shared | Load a synthetic/fixture catalogue over 1,000 entries; scroll and search. | Initial list is bounded, scrolling remains responsive, and all filtered results are reachable. | NOT RUN |
| LIB-009 | P0 | Device / Shared | Interrupt network/app during an update, then relaunch offline. | Last valid installed library remains intact; partial payload is not activated. | NOT RUN |
| LIB-010 | P0 | Auto / Codex | Feed invalid IDs, hashes, schemas, paths and corrupt motion payloads. | Validation rejects them safely without path traversal, overwrite or playback. | NOT RUN |
| LIB-011 | P1 | Device / Shared | Publish one valid update and one removal, then open app. | Change prompt/count is accurate; applying changes is atomic and idempotent. | NOT RUN |
| LIB-012 | P0 | Auto / Codex | Compare catalogue claims with installed motion manifest in release mode. | Every displayed approved sign has an integrity-verified playable motion; no draft is labeled approved. | NOT RUN |
| LIB-013 | P0 | Auto / Codex | Build release with zero approved phrase entries. | App does not imply unavailable translation; release gate blocks claims requiring missing assets. | FAIL: phrase catalogue currently has 0 entries |
| LIB-014 | P1 | Device / Shared | Open/close catalogue repeatedly, rotate/rescale large-screen window and use Back. | Navigation/state remain stable without clipping, duplicate download or memory growth. | NOT RUN |

### 5.3 Microphone and offline speech recognition

| ID | Pri | Mode / owner | Preconditions and steps | Expected result | Initial result |
| --- | --- | --- | --- | --- | --- |
| MIC-001 | P0 | Device / Shared | Fresh permission state; tap microphone and Allow. | System prompt is contextual; listening reaches a visible ready state. | NOT RUN |
| MIC-002 | P0 | Device / Shared | Fresh permission state; tap microphone and Deny. | No capture starts; app explains recovery and remains usable. | NOT RUN |
| MIC-003 | P0 | Device / Shared | Deny permanently, tap again, then grant from Settings and return. | App directs user to Settings and recovers without reinstall. | NOT RUN |
| MIC-004 | P0 | Device / Shared | Revoke microphone permission while installed, relaunch and activate. | No crash/service loop; permission is requested or a recovery message is shown. | NOT RUN |
| MIC-005 | P0 | Device / Shared | Enable airplane mode and disable Wi-Fi; activate microphone. | Recognition starts only if an on-device Spanish pack exists; no network request is required. | NOT RUN |
| MIC-006 | P0 | Device / Shared | Remove/disable on-device Spanish recognition pack and activate. | App does not use network recognition; it explains how to install the local language. | NOT RUN |
| MIC-007 | P1 | Device / Shared | Make `es-CO` unavailable while another supported local Spanish locale exists. | Documented local fallback is attempted in order and remains offline-only. | NOT RUN |
| MIC-008 | P1 | Device / Shared | Stay silent through recognizer timeout in continuous mode. | Service recovers/rearms without accumulating visible errors or false animation. | NOT RUN |
| MIC-009 | P0 | Device / Shared | Speak an unknown/non-catalogue phrase. | Transcript may show input, but no unrelated sign is forced or animated. | NOT RUN |
| MIC-010 | P1 | Device / Shared | Speak rapidly, slowly, softly and with moderate background noise. | App remains responsive; supported phrases are stable or safely rejected. | NOT RUN |
| MIC-011 | P1 | Device / Shared | Start/stop listening repeatedly 20 times. | No recognizer-busy loop, duplicate service, crash or leaked notification. | NOT RUN |
| MIC-012 | P0 | Auto+device / Shared | Monitor traffic while offline speech is active. | No audio or transcript is uploaded; recognition-related traffic is absent. | NOT RUN |
| MIC-013 | P1 | Device / Shared | Receive an audio interruption/call and return. | Listening and external audio recover predictably without stealing focus indefinitely. | NOT RUN |
| MIC-014 | P1 | Device / Shared | Connect/disconnect wired/Bluetooth audio before and during listening. | Selected route is handled without crash; limitations are stated if unsupported. | NOT RUN |

### 5.4 Phrase resolution and playback decisions

| ID | Pri | Mode / owner | Preconditions and steps | Expected result | Initial result |
| --- | --- | --- | --- | --- | --- |
| PHR-001 | P0 | Auto+device / Shared | Say `hola` with approved HOLA installed. | HOLA is selected once and playback visibly starts. | NOT RUN |
| PHR-002 | P0 | Auto+device / Shared | Say `como estas` naturally, with COMO and COMO-ESTAS candidates present. | Resolver waits for the ambiguous prefix and selects the complete phrase, not COMO followed by another guess. | Unit coverage exists; device NOT RUN |
| PHR-003 | P0 | Auto+device / Shared | Say only `como`, then remain silent beyond the deferral window. | COMO plays once after the bounded wait when it is independently approved. | Unit coverage exists; device NOT RUN |
| PHR-004 | P1 | Auto / Codex | Resolve punctuation/case/accent variants of an approved phrase. | Equivalent speech normalizes to the same intended entry. | NOT RUN |
| PHR-005 | P0 | Auto+device / Shared | Repeat the same final result/callback for one utterance. | One utterance creates one playback sequence; no duplicate queue/TTS event. | NOT RUN |
| PHR-006 | P0 | Auto / Codex | Provide a partial known prefix followed by unrelated/unknown text. | App neither commits early nor fabricates an approved completion. | NOT RUN |
| PHR-007 | P1 | Auto+device / Shared | Speak two independently approved signs in sequence. | Playback order matches speech order and transitions complete without overlap. | NOT RUN |
| PHR-008 | P1 | Device / User | Compare displayed Spanish transcript, planned LSC glosses and observed sign. | Copy is understandable and does not present Spanish word order as native LSC grammar. | NOT RUN |
| PHR-009 | P0 | Auto / Codex | Attempt release resolution using installed unreviewed draft motion. | Draft is rejected with safe unsupported behavior; development preview is absent. | NOT RUN |
| PHR-010 | P1 | Auto / Codex | Change catalogue while an utterance is pending. | Resolution uses a consistent snapshot and never references a removed/corrupt asset. | NOT RUN |

### 5.5 Avatar, presentation and Picture-in-Picture

| ID | Pri | Mode / owner | Preconditions and steps | Expected result | Initial result |
| --- | --- | --- | --- | --- | --- |
| AVA-001 | P0 | Device / User | Launch with approved signs and wait for avatar readiness. | Avatar renders fully without blank/black view, clipped body or missing assets. | NOT RUN |
| AVA-002 | P0 | Device / User | Trigger every release-approved motion once. | Each motion visibly begins, completes, returns to idle and matches its reviewed LSC meaning. | NOT RUN |
| AVA-003 | P1 | Device / User | Play at 1x, 2x, 3x and 4x. | Speed changes timing without skipping the communicative motion; preference persists. | NOT RUN |
| AVA-004 | P1 | Device / User | Exercise zoom minimum/maximum and render modes. | Controls are bounded, persistent, visually usable and never hide critical signing space. | NOT RUN |
| AVA-005 | P0 | Auto+device / Shared | Remove/corrupt a test motion and request it. | Clear safe error; no crash, stale previous sign or misleading playback. | NOT RUN |
| AVA-006 | P1 | Device / Shared | Start a new recognized sign while another is completing. | Queue/transition policy is deterministic; no overlapping or lost final state. | NOT RUN |
| PIP-001 | P0 | Device / Shared | After avatar ready, enter PiP while listening. | PiP opens, foreground notification appears, microphone remains intentional and avatar is visible. | NOT RUN |
| PIP-002 | P0 | Device / Shared | Speak approved phrase in PiP. | Correct motion plays once and is legible; native frame clock does not freeze. | NOT RUN |
| PIP-003 | P0 | Device / Shared | Use PiP primary action in continuous and phrase modes. | Action label/state and microphone behavior match the selected mode. | NOT RUN |
| PIP-004 | P1 | Device / Shared | Return from PiP, close PiP, swipe app away and relaunch. | Foreground service/notification stop when appropriate; main UI and recognizer recover. | NOT RUN |
| PIP-005 | P1 | Device / Shared | Try PiP before avatar readiness or on unsupported API/device policy. | Entry is refused with a useful message and no orphan microphone service. | NOT RUN |
| PIP-006 | P1 | Device / Shared | Play external media, start VOZUAL/PiP and stop it. | External audio is preserved according to product policy; VOZUAL does not leave volume/focus altered. | NOT RUN |

### 5.6 Account activation, access and local state

| ID | Pri | Mode / owner | Preconditions and steps | Expected result | Initial result |
| --- | --- | --- | --- | --- | --- |
| AUTH-001 | P0 | Device / User | Online, signed out; choose Google and complete consent. | Firebase session is created, activation screen closes and account identity is displayed correctly. | PASS on debug; release NOT RUN |
| AUTH-002 | P1 | Device / User | Cancel Google account picker/consent. | Friendly cancellation state; free local use remains available when activation is optional. | NOT RUN |
| AUTH-003 | P0 | Device / User | Disable network and attempt Google activation. | Clear retryable error; app does not misreport success or block optional free use. | NOT RUN |
| AUTH-004 | P0 | Device / User | Install from Play Internal testing and activate Google. | OAuth succeeds with upload/Play App Signing SHA configuration. | BLOCKED until Internal track |
| AUTH-005 | P1 | Device / User | Force invalid web client/provider configuration. | Safe actionable error; no token or internal Firebase detail is displayed/logged. | NOT RUN |
| AUTH-006 | P0 | Device / User | Force-stop/reboot/relaunch after activation. | Session persists and app opens without repeated consent. | NOT RUN |
| AUTH-007 | P0 | Device / User | Sign out, relaunch, then activate a different test account. | Session closes fully; account-scoped display/usage state does not leak across accounts. | NOT RUN |
| AUTH-008 | P0 | Device / User | Open account settings and request deletion; complete confirmation. | Discoverable in-app flow deletes/requests deletion of account and associated data, signs out and explains retention. | FAIL: no implementation found |
| AUTH-009 | P0 | Web+manual / User | Open deletion URL from Play listing without the app. | User can request deletion externally; identity verification is proportionate and retention is disclosed. | FAIL: no URL documented |
| AUTH-010 | P0 | Shared | Verify Firebase Auth and Firestore after deletion completes. | Auth identity and app-associated profile/data are deleted or retained only under disclosed lawful policy. | NOT RUN |
| ACC-001 | P0 | Auto+device / Shared | Remote Config unavailable on launch. | Safe local defaults apply; translation remains available and no paid entitlement is granted. | Unit coverage exists; release NOT RUN |
| ACC-002 | P0 | Auto / Codex | Inspect release bundle and exercise settings. | Billing sandbox is compiled out; Remote Config cannot independently grant paid access. | NOT RUN |
| ACC-003 | P1 | Auto+device / Shared | Accumulate active playback usage, restart, change account and cross month boundary. | Only active playback time is counted; state persists and remains account/month scoped. | Unit coverage exists; device NOT RUN |

### 5.7 Lifecycle, reliability and recovery

| ID | Pri | Mode / owner | Preconditions and steps | Expected result | Initial result |
| --- | --- | --- | --- | --- | --- |
| LIFE-001 | P0 | Device / Shared | Cold launch, background/foreground 20 times, then use core flow. | No crash/ANR, blank screen, duplicate listener or lost usable state. | NOT RUN |
| LIFE-002 | P0 | Device / Shared | Force-stop during idle, listening, download and playback; relaunch each time. | Each state recovers safely; incomplete download is not activated. | NOT RUN |
| LIFE-003 | P1 | Device / Shared | Reboot with app previously listening/PiP, then launch manually. | No unintended microphone/service auto-start; user can resume normally. | NOT RUN |
| LIFE-004 | P1 | Device / Shared | Enable battery saver/background restriction and test main/PiP flows. | Foreground limitations are handled without silent privacy-impacting behavior. | NOT RUN |
| LIFE-005 | P0 | Device / Shared | Fill storage near capacity, then install/update library. | Operation fails safely; existing valid library and app startup remain intact. | NOT RUN |
| LIFE-006 | P1 | Device / Shared | Change locale/time zone/date and cross month boundary. | Spanish UI remains coherent; usage period and timestamps do not corrupt access state. | NOT RUN |
| LIFE-007 | P0 | Device / Shared | API 37 large screen: resize, rotate and enter/exit multi-window during each primary screen. | No state loss, inaccessible control or assumption that portrait is enforced. | NOT RUN |
| LIFE-008 | P1 | Auto+device / Shared | Run a 60-minute repeated speech/playback/PiP session. | No unbounded memory/CPU growth, thermal failure, notification leak, crash or ANR. | NOT RUN |

### 5.8 Accessibility and user experience

| ID | Pri | Mode / owner | Preconditions and steps | Expected result | Initial result |
| --- | --- | --- | --- | --- | --- |
| A11Y-001 | P0 | Device / User | Navigate every screen and primary action with TalkBack only. | Reading/focus order is logical; controls have role, name, state and actionable feedback. | NOT RUN |
| A11Y-002 | P1 | Device / User | Set Android font/display size to maximum supported values. | Text remains readable; primary buttons and results are not clipped or hidden. | NOT RUN |
| A11Y-003 | P1 | Device / User | Check touch targets and one-handed use on phone. | Interactive targets are at least 48 dp or equivalently usable and do not overlap. | NOT RUN |
| A11Y-004 | P1 | Device / User | Inspect contrast in normal, pressed, disabled, error and selected states. | Essential text/control contrast remains perceivable and state is not color-only. | NOT RUN |
| A11Y-005 | P0 | Device / User | Complete first launch, microphone recovery, catalogue and activation without sight of transient animation. | Instructions and state changes are available in text/accessibility output. | NOT RUN |
| UX-001 | P1 | Device / User | Review all Spanish copy and error/recovery messages. | Copy is Colombian-Spanish appropriate, concise and does not overclaim LSC capability. | NOT RUN |
| UX-002 | P1 | Device / User | Use system Back/gesture on catalogue, activation, settings, PiP and main screen. | Navigation is predictable and never exits/loses work unexpectedly. | NOT RUN |

### 5.9 Performance and device compatibility

| ID | Pri | Mode / owner | Preconditions and steps | Expected result | Initial result |
| --- | --- | --- | --- | --- | --- |
| PERF-001 | P1 | Auto+device / Codex | Measure cold/warm launch on representative release devices. | Baseline and budget are recorded; no regression above agreed threshold. | NOT RUN |
| PERF-002 | P0 | Device / Shared | Measure time from microphone tap to ready and final phrase to motion start offline. | Latencies are recorded and acceptable for conversational use; no indefinite state. | NOT RUN |
| PERF-003 | P1 | Device / Codex | Profile memory before/after 100 playbacks, catalogue scroll and PiP transitions. | Memory returns to a stable range; no repeatable leak or OOM. | NOT RUN |
| PERF-004 | P1 | Device / Codex | Observe CPU/frame rendering at each playback speed and in PiP. | UI/sign remains responsive without sustained jank that harms comprehension. | NOT RUN |
| PERF-005 | P1 | Device / Shared | Run core flow on minimum API/low-memory emulator. | App installs, launches and safely handles resource pressure. | NOT RUN |
| PERF-006 | P1 | Device / Shared | Compare arm64 Play split with x86_64 emulator build where applicable. | Supported ABIs behave consistently; unsupported ABI policy is explicit. | NOT RUN |

### 5.10 Security, privacy and permissions

| ID | Pri | Mode / owner | Preconditions and steps | Expected result | Initial result |
| --- | --- | --- | --- | --- | --- |
| SEC-001 | P0 | Auto / Codex | Scan tracked diff and final artifact for keys, passwords, tokens, private certificates and service accounts. | No secret material is committed or packaged. OAuth client IDs are treated as public configuration only. | NOT RUN |
| SEC-002 | P0 | Auto+manual / Shared | Compare manifest/runtime requests with feature need and Play declarations. | Every sensitive permission is necessary, disclosed and requested in context; no storage/location/contact permission exists. | NOT RUN |
| SEC-003 | P0 | Auto+device / Codex | Inspect traffic during launch, library, activation, voice and playback. | Only documented Firebase/catalogue/account metadata traffic occurs; no audio, transcript, frames or landmarks leave device. | NOT RUN |
| SEC-004 | P0 | Auto / Codex | Validate Firestore rules against own-user reads, client entitlement writes and cross-user access. | Clients cannot write authoritative entitlement/usage or access another user's data. | NOT RUN |
| SEC-005 | P0 | Auto / Codex | Feed hostile catalogue IDs/URLs/payload sizes/hashes and WebView messages. | Input is bounded and validated; no path traversal, script injection or arbitrary native/file load occurs. | NOT RUN |
| SEC-006 | P1 | Auto / Codex | Run production dependency audit and review native SDK privacy behavior. | Critical/high exploitable findings are fixed or explicitly blocked; SDK data use is reflected in Data safety. | NOT RUN |
| SEC-007 | P0 | Auto / Codex | Inspect exported activities/services/receivers and invoke externally where possible. | Only launcher activity is intentionally exported; internal components reject external invocation. | NOT RUN |
| SEC-008 | P1 | Auto / Codex | Inspect backup, logs and local files. | Backup behavior matches policy; logs contain no transcript/token/PII; files use private storage. | NOT RUN |
| SEC-009 | P0 | Manual / User | Review privacy policy and in-app disclosures against observed behavior. | Policy URL is public, current and names account/Firebase data, local audio handling, deletion and contact route. | NOT RUN |

### 5.11 Google Play Console and rollout

| ID | Pri | Mode / owner | Preconditions and steps | Expected result | Initial result |
| --- | --- | --- | --- | --- | --- |
| PLAY-001 | P0 | Manual / User | Create/select Play app with exact package and complete developer identity verification. | Package ownership is correct and dashboard has no identity blocker. | NOT RUN |
| PLAY-002 | P0 | Manual / User | Complete main/custom store listing. | Name, descriptions, category, support contacts, icon, screenshots and feature graphic are accurate and policy-safe. | NOT RUN |
| PLAY-003 | P0 | Manual / User | Complete App content: privacy, Data safety, ads, content rating, target audience, app access, government/news/health declarations as applicable. | Every declaration matches runtime evidence; no required section is incomplete. | NOT RUN |
| PLAY-004 | P0 | Manual / User | Enter external deletion URL and verify it signed out/incognito. | URL is reachable, clearly tied to VOZUAL and provides a working deletion request. | FAIL: URL absent |
| PLAY-005 | P0 | Shared | Upload authorized AAB to Internal testing. | Play accepts target API, signing, 16 KB/native, version and bundle; no blocking error. | BLOCKED |
| PLAY-006 | P0 | Shared | Install from opt-in link on clean physical device. | Play-delivered app launches and passes ART-009, MIC-005, PHR-001, AUTH-004 and AVA-002. | BLOCKED |
| PLAY-007 | P0 | Shared | Review pre-launch report across available device/API set. | No crash, ANR, security, accessibility or compatibility blocker remains. | BLOCKED |
| PLAY-008 | P1 | Manual / User | Confirm personal-account production-access status. | If applicable, closed test has at least 12 continuously opted-in testers for 14 days before applying. | NOT RUN |
| PLAY-009 | P0 | Shared | Promote identical validated artifact to Closed testing; monitor vitals/feedback. | No artifact substitution; rollout is staged and has stop criteria/owner. | BLOCKED |
| PLAY-010 | P0 | Shared | Before production, rerun release gate and review all P0/P1 results. | Explicit GO is documented; otherwise rollout stops. | BLOCKED |
| PLAY-011 | P1 | Manual / User | Define halt/rollback response for crash, auth, voice, semantic or privacy regression. | Owner, thresholds, communication and replacement-build procedure are documented. | NOT RUN |

## 6. Required user-assisted checks

The product owner or an invited human tester must provide the final judgment for:

- Whether every displayed motion is the intended, semantically reviewed LSC sign.
- Whether complete phrases such as `¿cómo estás?` are understandable and not incorrectly decomposed.
- Whether the Spanish wording is natural, accessible and does not overclaim translation coverage.
- Real Google account consent, switching and deletion behavior.
- TalkBack usability, maximum font scaling, touch targets and visual comprehension.
- Google Play Console declarations, tester access and final upload authorization.

Codex can prepare artifacts, automate deterministic tests, collect device diagnostics and guide each manual case, but must not mark these human judgments PASS without the named tester's evidence.

## 7. Exit criteria

The first Android version may proceed from Internal to Closed testing only when:

- The automated release command passes from a clean dependency installation.
- The AAB targets API 37, is upload-signed, and every 64-bit native library passes 16 KB checks.
- At least one approved phrase/sign visibly plays from offline speech on the Play-delivered build.
- All release-listed LSC items are semantically approved and integrity-verified.
- Account activation, sign-out and deletion pass, including the external deletion URL.
- Data safety/privacy/permissions match measured runtime behavior.
- Physical phone, minimum API, API 37/16 KB and large-screen coverage are recorded.
- There is no unresolved critical security issue, crash, ANR or failed P0/P1 case.

Production additionally requires a successful Closed test when Play account rules demand it, resolved pre-launch findings, an explicit product-owner GO, and a documented staged-rollout/rollback decision.
