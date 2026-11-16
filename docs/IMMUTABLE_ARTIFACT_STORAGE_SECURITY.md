# Immutable Artifact Storage and Security

This document is the Storage data-plane contract for the scalable LSC release
catalogue. It complements `SCALABLE_RELEASE_CATALOG_CONTRACT.md`: Firestore is
the small control plane; Cloud Storage contains immutable source and compiled
objects. A Firestore document must never contain `contentBase64` or another
encoding of executable motion bytes.

## Object namespaces

| Namespace | Contents | Reader | Writer | Mutability |
| --- | --- | --- | --- | --- |
| `authoring/{authorId}/...` | source v2/v3 recipes, recordings, consent, provenance | owning author only | owning author with `lscAuthor` claim | author workflow only |
| `review/{releaseId}/reports/{sha256}.json` | compiler and linguistic review report | reviewer/publisher | author creates once | immutable |
| `distribution/releases/{releaseId}/...` | root, fragments, compiled plans and motion binaries | public mobile client | publisher with `lscPublisher` claim | create once, never update/delete |

The mobile runtime has no Storage rule that reads `authoring/` or `review/`.
Consent records and reference recordings must remain below `authoring/`; they
must never be copied into a release fragment, executable plan, or public
metadata.

## Content-addressed distribution paths

All lowercase SHA-256 hashes are 64 hexadecimal characters. The filename and
the custom metadata value `sha256` must be identical.

```text
distribution/releases/{releaseId}/root/{sha256}/manifest.json
distribution/releases/{releaseId}/fragments/{fragmentId}/{sha256}/fragment.json
distribution/releases/{releaseId}/signs/{signId}/motion-binary/{sha256}/artifact.bin
distribution/releases/{releaseId}/signs/{signId}/execution-plan/{sha256}/artifact.json
```

Every distribution object must have non-zero object size and these custom
metadata values: `sha256`, `releaseId`, `compilerVersion`, `rigProfileId`,
`rigProfileRevision`, and `formatVersion`. Storage Rules enforce their
presence, format, and path/hash/release consistency. Rules cannot calculate a
SHA-256 digest, so the publisher computes it before upload and the device must
verify the downloaded bytes against the manifest's `sha256` and `sizeBytes`
before an artifact is staged or activated.

`ReleaseCatalogContract.ts` rejects mutable aliases such as `current.json`.
It accepts a release fragment only when each embedded artifact path is the
canonical content-addressed path for that fragment's release and sign ID.

## Firestore boundary

Legacy `signs/{signId}/versions/{versionId}` documents can expose only compact
metadata while migration is in progress. Read rules require `storagePath`,
`sha256`, positive `sizeBytes`, approval and publication fields, and reject any
document with `contentBase64`. Client writes to sign, version, phrase, or
release catalogue records are denied. Trusted server-side publisher tooling
uses the Admin SDK and is subject to the release validation pipeline, not
mobile Firestore rules.

The final release path is the catalog pointer and manifest model, not a client
query over legacy sign versions. Task 19 will publish immutable objects before
atomically moving that pointer; Task 20 will read the pointer and manifest.

## Authorization claims

Claims are issued only by a privileged server workflow:

- `lscAuthor`: may read and modify only their own authoring namespace.
- `lscReviewer`: may read review reports, but no source/consent material.
- `lscPublisher`: may read reports and create immutable distribution objects.

No rule grants an update or delete on a public artifact. A correction therefore
creates a new hash and release ID, followed by a controlled pointer change.

## Required validation sequence

1. The compiler emits artifact bytes, hash, size and compatibility metadata.
2. The publisher validates them against the release contract before upload.
3. Storage accepts a create only if the immutable path and metadata agree.
4. The device downloads to staging, checks exact size and SHA-256, then marks
   the artifact `verified`.
5. The transactional local library activates only verified artifacts.

Failures remove the staging data and retain the prior active release. The
download implementation is deliberately scheduled for Task 21; this contract
prevents it from accepting a weak or legacy artifact source.
