# Android Data Safety Inventory

This document is the engineering source for VOZUAL's Google Play Data safety answers. The product owner must compare it with the exact Play Console form and the final release artifact before publishing.

## Release behavior

- Account creation is optional and user-initiated.
- Core speech recognition and avatar playback operate locally after required language/sign resources are installed.
- The release does not include advertising, Firebase Analytics, Crashlytics or social tracking.
- Data is encrypted in transit. Firebase Authentication and Cloud Firestore also encrypt stored customer data.
- VOZUAL does not sell personal data or share it for advertising.

## Proposed Play declarations

| Play data type | Collected | Shared | Required | Purpose / source |
| --- | --- | --- | --- | --- |
| Name | Optional | No | No | Google/Apple sign-in and account display. |
| Email address | Optional | No | No | Authentication, support and account recovery/deletion. |
| User IDs | Optional for account; Firebase installation ID for Remote Config | No | Account ID optional | Authentication, security, profile access and remote configuration. |
| Photos | Optional | No | No | Identity provider may attach a profile-photo URL to the Firebase Auth record; VOZUAL does not upload camera images. |
| App interactions | Yes when network catalogue/config/account features are used | No | Catalogue/config requests occur automatically or by user action | App functionality and service delivery; signed-in Firestore requests include the user ID. |
| Device or other IDs | Yes | No | Yes for Remote Config when bundled | Firebase installation ID for configuration delivery. |
| Diagnostics / device metadata | Limited service processing | No | Yes when Firebase is used | Firebase user agent, OS/device/app/SDK version and temporary security/abuse signals. |

The following are **not collected off device by VOZUAL**: microphone audio, recognized speech text, camera frames, face/body/hand landmarks, local playback-duration ledger, contacts, precise location, health data, messages, files, payment card data and browsing history.

Google Play's definition of “collected” includes data transmitted from the device even when a service processes it transiently. Therefore the Console answers must not treat the local-first translation path as proof that all SDK behavior is offline.

## Account deletion answers

- **Does the app support account creation?** Yes, optionally through Google on Android and Google/Apple on iOS.
- **In-app deletion path:** Settings → Account → Delete account and data.
- **External deletion URL:** `https://vozual-lsc-prod.web.app/eliminar-cuenta`
- **Privacy policy URL:** `https://vozual-lsc-prod.web.app/privacidad`
- **Deleted active data:** Firebase Authentication identity; Firestore user profile, access document, usage root and usage periods; account-scoped local usage.
- **Possible retained data:** Firebase backup copies during its documented deletion window and narrowly required security/legal records. The public policy discloses this boundary.

## Verification before Console submission

1. Deploy the public Hosting pages and Firestore rules; open both URLs without authentication.
2. Delete a dedicated test account in the release build and verify Authentication plus every listed Firestore path is absent.
3. Submit an external deletion request and complete the documented support procedure.
4. Capture release traffic during launch, activation, catalogue update, translation and deletion; update this inventory for any additional endpoint or SDK behavior.
5. Review the current Firebase Android disclosure page after every SDK update.
6. Complete Play's form using the final artifact, not this worksheet alone.

## Authoritative references

- [Google Play account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Google Play User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311)
- [Firebase Android data disclosure guidance](https://firebase.google.com/docs/android/play-data-disclosure)
- [Firebase privacy and data-retention information](https://firebase.google.com/support/privacy/)
- [Firebase user deletion and recent-sign-in requirement](https://firebase.google.com/docs/auth/android/manage-users)
