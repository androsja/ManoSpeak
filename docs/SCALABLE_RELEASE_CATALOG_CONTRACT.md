# Scalable Release Catalogue Contract

This contract is the read boundary between Vozual mobile clients and published
LSC content. It is designed for many thousands of signs: clients read one
active-release pointer, then a small immutable root manifest, and only the
deterministic manifest fragments and binary artifacts they need. A client must
never query every sign document to discover an update.

## Planes and visibility

| Plane | Contents | Visibility |
| --- | --- | --- |
| Authoring | Source recipe (`motion-schema` v2/v3), recordings, provenance | Private to authorised authors/reviewers |
| Validation | Linguistic/kinematic report and compiler diagnostics | Private to reviewers/publishers |
| Distribution | Root, fragments, compiled execution plans and motion binaries | Readable only after publication according to Storage rules |
| Client state | Verified active release and downloaded artifacts | Local to the device |

Source recipes are not runtime assets. The client never treats a source recipe,
recording, or validation report as executable content.

## Immutable objects

The JSON Schemas in `schemas/` define four versioned public documents:

1. `active-release-pointer-v1`: one language/locale pointer to the active root.
2. `release-root-v1`: signed release metadata and fragment references.
3. `release-fragment-v1`: a deterministic group of searchable sign entries.
4. `release-sign-entry-v1`: compact metadata and verified runtime artifact references.

Each object is immutable once published. A correction creates a new release
ID and updates only the active pointer atomically in a future publisher task.
Fragments use `gloss-prefix-v1`; adding a sign changes only its fragment and a
new root, rather than a monolithic catalog document.

## Execution trust boundary

`ReleaseCatalogContract.ts` fails closed. A sign entry is executable only if it
is `approved: true` and `published`, identifies a hashed versioned rig,
declares a compiler and minimum app version, and supplies hashed non-empty
artifact references. Every entry needs a `motion-binary`; source schema v3
also needs its compiled `execution-plan`. Hashes and sizes are checked before
activation by the later installation task.

The lifecycle is `draft -> review -> approved -> published -> withdrawn`.
Only `published` values may occur in public root, fragment, entry, and active
pointer documents. A withdrawn sign is removed in the next release; it is not
silently repurposed in place.

## Compatibility

The field `compatibility.sourceMotionSchemaVersion` explicitly supports `2`
and `3`. Version 2 may retain the legacy verified motion binary route. Version
3 requires a compiled execution plan in addition to that binary. Future source
schemas require a new catalogue format version or an explicitly extended
validator; unknown format versions are rejected.

The runtime renderer is intentionally absent from this contract. A future
repository/sync layer converts only verified entries into the existing runtime
asset interface, so adding a sign or a fragment does not require a renderer
change.

## Repository boundary and local installation

`mobile/src/services/repositories/ReleaseRepositories.ts` separates the
published catalogue, compiled artifact download, authoring recipe, and local
device library concerns. `ReleaseCatalogRepository` and `ArtifactRepository`
are client read-side ports. `RecipeRepository` is an authoring-only compiler
port and must not be composed into the mobile runtime.

The device library is represented as transactional logical tables: releases,
active release pointers, installed entries, and incomplete stages. A release
is staged with verified artifact metadata and becomes visible only when
`activateStage` atomically swaps its active pointer. The previous installed
release remains available for explicit rollback. This model is ready for a
SQLite or Realm adapter and intentionally does not introduce another growing
`library.json` file.

`LegacyInstalledLibraryAdapter` is a temporary, narrow read bridge to the
existing installed motion files. It returns an artifact only when its hash and
size exactly match a published artifact reference; it neither uploads nor
exposes the legacy library state to the catalogue API.

## Mobile release synchronization

`ReleaseCatalogueSynchronizer` is the mobile read-side implementation. On a
normal startup it reads only the active pointer. If the pointer identifies the
already verified root, synchronization ends without downloading a root or a
fragment. When it changes, the client verifies the pointer, full root bytes,
signed root payload, signature, and app compatibility before it requests only
the explicitly selected fragment IDs. Each fragment is verified for its byte
size, hash, release identity, entry count, and entry compatibility before a
separate catalogue cache is transactionally activated.

The catalogue cache is deliberately separate from downloaded runtime
artifacts: synchronization does not claim a sign is playable. Task 21 owns
on-demand artifact installation. If the network fails or any verification
fails, the cache retains the previous verified release. The old global
Firestore scan remains available only through an explicit, false-by-default
`enableLegacyCatalogMigration` option; it is not a startup discovery path.
