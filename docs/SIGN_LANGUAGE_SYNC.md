# Vozual Independent Sign Synchronization

Vozual publishes and downloads each sign independently. A new approved sign never requires rebuilding or downloading a complete language package.

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
  "approved": true,
  "compiled": true,
  "published": true,
  "updatedAt": "server timestamp"
}
```

The publishing tool uses the intersection of the owner-approved manifest, the linguistic catalogue approval recorded by the authoring-page button, and the internally generated `.motion.bin` output. A sign missing any of those requirements remains unpublished. The internal binary generation is a technical publication step and is not exposed as a separate editor action.

The compact binary and its avatar-presentation profile are stored in the sign's own `signs/{signId}/versions/{version}` document. Metadata queries never return these heavier version documents; the app reads them individually only after the user accepts a download. `releaseSha256` fingerprints the motion, avatar profile, spoken aliases, categories and linguistic behavior. A change to any downloadable part increments only that sign's version. Administrative timestamps do not create a new version. The publisher rejects assets whose encoded size could approach Firestore's document limit.

## Application flow

1. A fresh installation contains the avatar runtime but no sign-motion binaries.
2. The app lists the published documents from `signLanguages`.
3. For each language, it counts only `signs` documents that are approved, compiled, published, and reference their own version document.
4. The user may download the available signs or choose **AHORA NO**.
5. Every downloaded file is verified against its SHA-256 before becoming active.
6. The local library records every sign ID, content version, motion hash, profile hash, visual profile, and file path.
7. On a later launch, a new sign or a changed motion/profile version produces a prompt naming the pending signs.
8. Dismissing a revision prevents repeated prompts for the same set; a later independent sign change creates a new revision and prompts again.
9. The sign counter on the translator opens the language library at any time.
10. If several languages are installed, only the one marked **EN USO** supplies vocabulary and motion files to the translator.

## Publication order

For each sign:

1. review the sign and mark **APROBADA POR MÍ** in the authoring page or editor;
2. press **PUBLICAR CAMBIOS EN FIREBASE** in VOZUAL Editor;
3. the editor internally creates the compact motion and compares its release fingerprint;
4. only a new or changed sign is written to its individual Firestore version document;
5. the editor reads the version document back and verifies its SHA-256;
6. the editor writes or updates its Firestore `signs` document with `published: true` last.

Setting `published` last prevents clients from observing metadata for a missing file. Client writes to metadata and version documents are denied; publication requires trusted administrative tooling.

The editor button runs the same trusted workflow as `npm run publish:approved-signs`, which remains available as a command-line alternative. It ignores approved signs whose release fingerprint is already current, writes `published: false` before a changed version document, verifies the stored SHA-256, and only then exposes that sign to applications. It does not rebuild the mobile application. Firebase Storage is not required for the current compact motions.

Run `npm run verify:published-signs` to repeat the same reads available to an unauthenticated application client and validate every public byte count and SHA-256.
