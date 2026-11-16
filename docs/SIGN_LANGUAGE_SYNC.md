# Vozual Sign and Phrase Synchronization

Vozual publishes and downloads each sign independently. It also publishes compact
reviewed phrase metadata through Firestore, so new phrases do not require a new
APK. A downloaded phrase becomes usable only when every sign in its ordered LSC
sequence is installed and integrity-verified.

## `signLanguages`

This collection contains only the sign-language types that a user may choose. Stable document IDs include `lsc-co` and `lsm-mx`.

```json
{
  "code": "lsc-co",
  "name": "Lengua de Señas Colombiana",
  "region": "Colombia",
  "published": true
}
```

## `signs`

Each document represents one independently downloadable sign.

```json
{
  "languageId": "lsc-co",
  "gloss": "AGUA",
  "version": 1,
  "assetName": "m_000061000067000075000061.motion.bin",
  "sizeBytes": 116000,
  "sha256": "64-lowercase-hexadecimal-characters",
  "profileSha256": "64-lowercase-hexadecimal-characters",
  "releaseSha256": "64-lowercase-hexadecimal-characters",
  "speechAliases": ["agua"],
  "categories": ["sustantivos"],
  "lexicalClass": "noun",
  "verbType": "none",
  "requiresSubjectMarker": false,
  "assetDocumentPath": "signs/lsc-co-agua/versions/v1",
  "storagePath": "lsc-co/signs/lsc-co-agua/v1/m_000061000067000075000061.motion.bin",
  "downloadUrl": "https://firebasestorage.googleapis.com/v0/b/example/o/...",
  "semanticPath": "lsc-co/signs/lsc-co-agua/v1/m_000061000067000075000061.semantic.json",
  "profilePath": "lsc-co/signs/lsc-co-agua/v1/m_000061000067000075000061.profile.json",
  "approved": true,
  "compiled": true,
  "published": true,
  "updatedAt": "server timestamp"
}
```

The publishing tool uses the intersection of the owner-approved manifest, the linguistic catalogue approval recorded by the authoring-page button, and the internally generated `.motion.bin` output. A sign missing any of those requirements remains unpublished. The internal binary generation is a technical publication step and is not exposed as a separate editor action.

The current release stores the compact binary and its avatar-presentation profile in the sign's own `signs/{signId}/versions/{version}` document. The migration contract also permits Firebase Storage metadata: `storagePath` is the canonical object reference, `downloadUrl` is an optional resolvable HTTPS URL, and `semanticPath`/`profilePath` identify future sidecars. `sha256` and `sizeBytes` always describe the motion binary; `profileSha256` continues to describe the profile. Metadata queries never return these heavier version documents; the app reads them individually only after the user accepts a download. `releaseSha256` fingerprints the motion, avatar profile, spoken aliases, categories and linguistic behavior. A change to any downloadable part increments only that sign's version. Administrative timestamps do not create a new version.

### Storage migration compatibility

`mobile/tools/build-published-signs.js` emits deterministic Storage paths in the local seed and `publish-approved-signs.js` carries those fields into version metadata. This is contract-only preparation: the publisher still writes legacy `contentBase64`, does not upload to Storage, and does not delete the Firestore copy.

Readers use this order:

1. HTTPS `downloadUrl`, when present; downloaded bytes must match `sizeBytes` and `sha256`.
2. An injected `FirebaseStorageAdapter`, when only `storagePath` is present; it writes the resolved object to the requested local file and the service verifies `sizeBytes` and `sha256`.
3. Legacy `contentBase64`, when no usable Storage source is available.

The mobile boundary is `installSignLanguageChanges(status, onProgress, storageAdapter)`. A
production caller can build the adapter with `createFirebaseStorageAdapter` by
supplying a Firebase SDK `getDownloadURL(ref(storage, storagePath))` resolver.
The service does not hold credentials, initialize Firebase Storage, or deploy
anything. If a Storage adapter is absent, a record carrying both `storagePath`
and legacy `contentBase64` still installs through the legacy fallback. If it
has only `storagePath`, installation fails safely rather than activating
unverified bytes; an adapter failure is also surfaced and is not silently
replaced with stale content.

`semanticPath` and `profilePath` are references only in this migration step. The app still requires inline `avatarProfile` for the current renderer and does not download sidecars. A future Storage rollout must upload and verify those sidecars before removing legacy fields.

### Local Storage migration planner

`mobile/tools/plan-storage-migration.js` generates a read-only migration
manifest. It compares the local approved-signs seed with either a local
Firestore REST snapshot or the publicly readable `signs` collection. It never
writes Firestore, uploads Storage objects, deletes legacy content, or installs
an APK.

Use a local snapshot when validating a proposed catalog without network access:

```bash
cd mobile
node tools/plan-storage-migration.js \
  --seed build/published-signs/lsc-co/approved-signs.firestore.json \
  --snapshot tools/fixtures/storage-migration-firestore.snapshot.json \
  --out-json build/reports/storage-migration-plan.json \
  --out-md build/reports/storage-migration-plan.md
```

For a read-only public Firestore comparison, use `--firestore` and optionally
`--project`; when omitted, the project is read from `.firebaserc`:

```bash
node tools/plan-storage-migration.js --firestore
```

Each entry contains `signId`, local and remote versions, motion/profile/release
hashes, local/remote/effective Storage paths, download URLs, legacy-content
availability, and one of `create`, `update`, or `unchanged`. The planner adds
blocking reasons such as `missing-downloadUrl`, `local-not-approved`,
`remote-not-approved`, `remote-not-published`, `missing-storagePath`, or
`missing-local-seed`; blocked entries remain planning output and are never
automatically published or removed.

### Real Firebase validation blocker

The repository tests use a mock adapter and do not contact Firebase. A real
integration test remains blocked until a non-production Firebase project,
Storage object, read rules, initialized SDK, and a resolver for the published
`storagePath` are provided. It also requires an approved test environment;
this change does not install an APK, modify a device, upload objects, or
deploy Firebase configuration.

## `phrases`

Each document is a compact, reviewed phrase suggestion. It contains metadata,
not motion bytes, and belongs to exactly one sign language. The app saves these
documents in its local library state during the same update action that saves
signs.

```json
{
  "languageId": "lsc-co",
  "version": 1,
  "spanish": "Necesito agua.",
  "glossSequence": ["NECESITAR", "AGUA"],
  "releaseSha256": "64-lowercase-hexadecimal-characters",
  "approved": true,
  "published": true,
  "status": "published",
  "updatedAt": "server timestamp"
}
```

Use a stable, safe document ID such as `lsc-co-necesito-agua`. The
`releaseSha256` is the SHA-256 of the canonical JSON object containing only
`languageId`, trimmed `spanish`, and the upper-case `glossSequence`, in that
field order. Increase `version` whenever any of those fields changes. Do not
publish a phrase until every referenced sign is already public and approved.

The trusted publishing command derives phrase documents from
`mobile/assets/data/lsc_recommended_phrases.json`; that file is authoring input
only and is not imported by the mobile runtime. You may also create a document
directly in Firestore with the exact schema above. Client writes are denied by
the rules, so Console or trusted administrative tooling is required.

To add a phrase through the reviewed publishing workflow, append an entry with
`id`, `spanish`, and `glossSequence` to that JSON file, then run:

```bash
cd mobile
npm run build:published-signs
npm run publish:approved-signs
```

The build lists only phrases whose complete gloss sequence already has an
approved published sign. The publisher writes phrase documents only after the
sign publication succeeds.

When a newly approved sign is sent from VOZUAL Editor, the editor also
proposes three contextual phrase drafts. It shows their Spanish text and LSC
gloss sequence for human confirmation before adding them to the same authoring
file. A proposal is sent with that sign when its complete sequence is already
available; otherwise it remains local and is sent automatically when the last
required sign is published. This workflow never treats generated Spanish text
as an unreviewed final LSC grammar decision.

## Application flow

1. A fresh installation contains the avatar runtime but no sign-motion binaries.
2. The app lists the published documents from `signLanguages`.
3. For each language, it counts only `signs` documents that are approved, compiled, published, and reference their own version document.
4. The user may download the available signs and phrases or choose **AHORA NO**.
5. Every downloaded motion file is verified against its SHA-256 before becoming active.
6. The local library records every sign ID, content version, motion hash, profile hash, visual profile, file path, and downloaded phrase revision.
7. A phrase is committed only after every gloss in its sequence is present in the same local-library update; otherwise the previous library stays unchanged.
8. On a later launch, a new sign, phrase, or changed motion/profile/phrase revision produces an update prompt.
9. Dismissing a revision prevents repeated prompts for the same set; a later independent sign or phrase change creates a new revision and prompts again.
10. The sign counter on the translator opens the language library at any time.
11. If several languages are installed, only the one marked **EN USO** supplies vocabulary, phrase suggestions, and motion files to the translator.

## Publication order

For each sign:

1. review the sign and mark **APROBADA POR MÍ** in the authoring page or editor;
2. press **PUBLICAR CAMBIOS EN FIREBASE** in VOZUAL Editor;
3. the editor internally creates the compact motion and compares its release fingerprint;
4. only a new or changed sign is written to its individual Firestore version document;
5. the editor reads the version document back and verifies its SHA-256;
6. the editor writes or updates its Firestore `signs` document with `published: true` last.
7. after the referenced signs are public, the publisher writes eligible `phrases` documents with `published: true`.

Setting `published` last prevents clients from observing metadata for a missing file. Client writes to metadata and version documents are denied; publication requires trusted administrative tooling.

The editor button runs the same trusted workflow as `npm run publish:approved-signs`, which remains available as a command-line alternative. It ignores approved signs and phrases whose release fingerprints are already current, writes `published: false` before a changed resource, verifies every stored motion SHA-256, and only then exposes the resource to applications. It does not rebuild the mobile application. Firebase Storage is not required for the current compact motions. No Firebase deployment or data deletion is part of this migration preparation.

Run `npm run verify:published-signs` to repeat the same reads available to an unauthenticated application client and validate every public motion byte count, SHA-256, and phrase revision.
