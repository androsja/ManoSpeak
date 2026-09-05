# Firebase activation and access model

VOZUAL uses Firebase for account activation and remotely controlled rollout. Store billing remains the authority for consumer purchases; Remote Config must never grant a paid entitlement on its own.

## Product responsibilities

| Product | Responsibility |
| --- | --- |
| Firebase Authentication | Google and Apple account identity and persisted sessions. |
| Firebase Remote Config | Global rollout flags, trial duration, monthly allowance and UX thresholds. |
| Cloud Firestore | Per-user profile, trial timestamps and monthly usage ledger. |
| Cloud Functions | Receipt verification, trusted usage mutations and entitlement updates. |
| App Store / Google Play | Localized prices, subscription purchase and renewal authority. |
| Cloud Storage or CDN | Signed, versioned sign-language data packs. |

## Remote Config contract

The canonical defaults live in `remoteconfig.template.json` and in the mobile fallback service. Keep both representations synchronized.

Remote Config may change feature availability and presentation. It must not contain secrets, authoritative balances, raw receipts, audio, transcripts or per-user data. Store prices must come from StoreKit and Google Play Billing rather than a remotely entered string.

## Proposed Firestore documents

`users/{uid}` contains the account-facing profile:

```json
{
  "email": "person@example.com",
  "displayName": "Person",
  "providers": ["google.com"],
  "country": "CO",
  "selectedSignLanguage": "lsc-co",
  "createdAt": "server timestamp",
  "lastSeenAt": "server timestamp"
}
```

`access/{uid}` is server-owned and contains trial and subscription state:

```json
{
  "plan": "free",
  "trialStartedAt": "server timestamp",
  "trialEndsAt": "server timestamp",
  "entitlementExpiresAt": null,
  "entitlementSource": null
}
```

`usage/{uid}/periods/{periodId}` is server-owned and contains:

```json
{
  "includedSeconds": 3600,
  "consumedSeconds": 0,
  "periodStartsAt": "server timestamp",
  "periodEndsAt": "server timestamp",
  "revision": 1
}
```

The mobile client may read its own access and usage documents. Only trusted Cloud Functions may change paid entitlements or authoritative usage balances.

## Privacy boundary

VOZUAL keeps microphone audio, speech transcripts and landmark animation data on device by default. Usage accounting sends duration deltas and event identifiers, never the spoken content.

Account deletion is fail-closed and ordered: provider reauthentication, Firestore profile/access/usage deletion with a server-write barrier, local account-scoped usage removal, and finally Firebase Authentication deletion. If cloud deletion cannot be confirmed, the account remains active and the user is directed to the public deletion-request page. Firestore rules allow an owner to delete these account documents without allowing client entitlement creation or updates.

## Current implementation state

- Google and Apple authentication are connected to Firebase Authentication, with persisted sessions and explicit sign-out.
- Settings includes direct account deletion plus public privacy and deletion-request links. The activation screen exposes the privacy policy before sign-in.
- The app synchronizes the signed-in user's profile on a best-effort basis. A Firestore outage or missing database never blocks local translation.
- The mobile app keeps a monthly, account-scoped usage preview in its private document directory. It measures active avatar playback seconds and never stores audio or transcript content.
- The settings screen shows the current launch-access status and measured minutes. It does not enforce a quota while `monetization_enabled` is false.
- `firestore.rules` reserves entitlement and authoritative usage writes for a future trusted backend. These rules must be deployed only after a Firestore location is selected.

The local usage preview is not a billing ledger and must never unlock or revoke a paid entitlement. Cloud Functions and validated store transactions remain the future source of truth.

## Purchase testing without real charges

Development builds include a local VOZUAL Plus simulator for reviewing the complete paywall UX before store products are available. It is visibly labelled **test environment**, supports approved, rejected, cancelled, restored and reset states, and stores the simulated entitlement only in the app's private document directory. It is compiled behind `__DEV__`; it cannot unlock Plus in a release build and is not a substitute for receipt validation.

Production-like testing must use the stores' official sandboxes rather than invented credit-card numbers:

- **Android:** create the subscription products in Google Play Console, add the tester as a license tester and install the app through an internal or closed test track. Google Play then offers test payment methods that never create a real charge.
- **iOS:** create matching subscriptions in App Store Connect and use a Sandbox Apple Account, or use an Xcode StoreKit configuration for fully local purchase scenarios. StoreKit sandbox transactions never charge the tester.

The product identifiers, entitlement names and billing periods must match across both stores. Localized price strings shown in release builds must always come from Google Play Billing or StoreKit. Firebase Remote Config controls rollout and feature gates, but it must not supply a price or declare that a user has paid.

## Safe rollout

1. Keep `activation_required`, `monetization_enabled` and `quota_enforcement_enabled` disabled.
2. Test Google and Apple activation on physical devices.
3. Select the Firestore location, create the database and deploy `firestore.rules`.
4. Validate store receipts and monthly usage accounting.
5. Enable activation for internal testers, then for a small percentage of production users.
6. Deploy and verify the public privacy/deletion site and the owner-delete Firestore rules.
7. Enable monetization only after purchase restoration and account deletion pass end-to-end tests.
