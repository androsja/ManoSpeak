# Security and Privacy — VOZUAL

## 1. Local-first translation boundary

VOZUAL's core speech-to-LSC playback path is local-first. After the user has installed the required on-device Spanish speech pack and downloaded the selected sign-language package, speech recognition, transcript matching, motion playback and camera landmark processing do not require VOZUAL servers.

- Microphone audio and recognized phrases are processed in memory and are not uploaded or retained by VOZUAL.
- Camera frames and extracted landmarks are processed in volatile memory and are not written to storage or sent to Firebase.
- The local usage preview records only account-scoped playback duration in the app's private document directory. It does not contain audio, transcripts or sign content.
- Core translation must continue when optional Firebase services are unavailable.

## 2. Optional network boundary

The app has deliberate network features and must not claim to be entirely network-free:

| Service | Data and purpose |
| --- | --- |
| Google or Apple identity | Optional sign-in and identity confirmation for account deletion. |
| Firebase Authentication | User ID and provider account fields needed to persist an optional account. |
| Cloud Firestore | Account profile and published sign-language catalogue/resources. Authenticated Firestore requests include the Firebase user ID. |
| Firebase Remote Config | A Firebase installation ID used to deliver non-secret rollout configuration. |
| Firebase Hosting | Public privacy and account-deletion pages; the hosting provider processes request IP addresses for delivery and abuse prevention. |

The app does not include Firebase Analytics, Crashlytics, advertising SDKs or cross-app tracking. Remote Config must never contain secrets, paid entitlements, raw receipts, audio, transcripts or per-user balances.

## 3. Optional account data

Account creation is optional while `activation_required` remains false. A signed-in profile can contain the Firebase user ID, email, display name, identity providers, country, selected sign language, profile timestamps and the provider's photo URL in Firebase Authentication. Server-owned access and usage documents are reserved for future verified store entitlement work.

Firestore rules allow users to read their own account records but not grant themselves access or entitlements. Users may delete their own profile, access and usage records only as part of the deletion flow. Public sign resources are read-only and must satisfy publication state checks.

## 4. Account deletion

The in-app deletion path is **Settings → Account → Delete account and data**. It performs the following ordered operation:

1. Reauthenticate with the linked identity provider.
2. Read usage periods from the Firestore server.
3. Delete the user's profile, access, usage and usage-period documents.
4. Wait until Firestore confirms pending writes.
5. Delete account-scoped usage from private local storage.
6. Revoke the provider grant where supported and delete the Firebase Authentication user.

If server deletion cannot be confirmed, Authentication remains active and the UI provides the external request route. The public routes are:

- Privacy policy: `https://vozual-lsc-prod.web.app/privacidad`
- Account deletion: `https://vozual-lsc-prod.web.app/eliminar-cuenta`

Support must verify ownership without requesting passwords, one-time codes or access tokens. Any manually processed request must remove Authentication and associated Firestore data, then confirm completion. Legal or fraud-related retention must be disclosed to the requester.

## 5. On-device model and asset security

- Packaged model and motion assets must be integrity-checked before production use.
- Runtime-downloaded sign resources are accepted only when their declared SHA-256, size, publication and compilation metadata validate.
- Temporary downloads and catalogue state updates must be transactional.
- Model code must not load executable content from arbitrary external locations.

## 6. Engineering requirements

- Do not add analytics, advertising, telemetry or remote logging without a new data inventory, consent analysis and security review.
- Never log audio, transcripts, identity tokens, account identifiers or private deletion-request content.
- Keep signing keys, service accounts and passwords outside git. OAuth client IDs and Firebase mobile configuration identify the project but do not authorize administrative access; they still belong only in the platform configuration locations.
- Request microphone, camera and notification permissions only at the user action that needs them. Do not request storage or contact access.
- Reconcile the privacy policy and Google Play Data safety form whenever Firebase or another SDK changes.
