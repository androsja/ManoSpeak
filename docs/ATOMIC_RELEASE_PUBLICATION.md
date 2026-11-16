# Atomic Release Publication

Task 19 publishes a complete, immutable release only after every compiled
artifact and manifest is present and byte-verified in Storage. The privileged
publisher is `mobile/tools/atomic-release-publisher.cjs`; it has no mobile
runtime dependency and is deliberately composed with privileged Admin SDK
adapters outside the client application.

## Order of operations

1. Validate every candidate: published approval, validation-report hash,
   exact compiler/rig compatibility, required runtime artifacts, size, and
   SHA-256.
2. Replace candidate artifact paths with canonical immutable distribution
   paths and create every object with its content-addressed metadata.
3. Read every object back and verify its exact bytes before creating the next
   publication layer: artifacts, then fragments, then signed root.
4. In one metadata transaction, remember the release pointer, replace the
   active pointer, and append an audit record.

If a write or verification fails, the transaction that changes the pointer is
never reached. Existing immutable objects may remain safely unreachable; the
previous active release stays active.

The root's `manifestSha256` is the digest of its signed payload (the root
without its self-referential integrity fields). `rootManifestSha256` in the
active pointer and the root Storage path hash the complete stored root bytes.
Thus the client can verify downloaded object bytes exactly without creating a
recursive "JSON contains its own hash" definition.

## Trust and rollback

`HmacManifestSigner` is a testable authenticity mechanism. Production must
provide its key from a server-only secret manager (or replace the port with a
KMS/Ed25519 signer); never ship a signing secret in the mobile app. The active
pointer is tiny and stores only the release ID and hashed root location.

Release pointers are retained by language and locale. Rollback selects a
previous remembered pointer and changes only the active pointer in the same
transaction while writing an audit record containing the operator reason and
previous release ID. Client applications receive no write-capable publisher
port and cannot publish or roll back releases.
