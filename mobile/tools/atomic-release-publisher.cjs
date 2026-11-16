'use strict';

/**
 * Privileged release publisher (Task 19).
 *
 * This module intentionally has no Firebase credentials or mobile imports.
 * Production composes its two ports with Admin SDK adapters; tests compose
 * them with the in-memory adapters below.  Bytes are completely written and
 * read back from immutable Storage before the small Firestore-style pointer is
 * changed in one metadata transaction.
 */
const crypto = require('crypto');
const {canonicalJson} = require('./kinematic-motion-v3.cjs');

const FORMAT_VERSION = 1;
const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

class ReleasePublicationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReleasePublicationError';
    this.code = code;
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function utf8(value) {
  return Buffer.from(canonicalJson(value), 'utf8');
}

function requireId(value, name) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new ReleasePublicationError('INVALID_ID', `${name} must be a safe lowercase identifier.`);
  return value;
}

function requireHash(value, name) {
  if (typeof value !== 'string' || !HASH.test(value)) throw new ReleasePublicationError('INVALID_HASH', `${name} must be a lowercase SHA-256 hash.`);
  return value;
}

function artifactPath(releaseId, signId, artifact) {
  const extension = artifact.kind === 'motion-binary' ? 'artifact.bin' : 'artifact.json';
  return `distribution/releases/${releaseId}/signs/${signId}/${artifact.kind}/${artifact.sha256}/${extension}`;
}

function fragmentPath(releaseId, fragmentId, digest) {
  return `distribution/releases/${releaseId}/fragments/${fragmentId}/${digest}/fragment.json`;
}

function rootPath(releaseId, digest) {
  return `distribution/releases/${releaseId}/root/${digest}/manifest.json`;
}

function normalizedGlossPrefix(gloss, prefixLength) {
  if (typeof gloss !== 'string' || !gloss.trim()) throw new ReleasePublicationError('INVALID_GLOSS', 'A published entry requires a non-empty gloss.');
  const normalized = gloss.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.length < prefixLength) throw new ReleasePublicationError('INVALID_GLOSS', 'Gloss cannot produce the configured fragment prefix.');
  return normalized.slice(0, prefixLength);
}

function compareSemver(left, right) {
  const parse = value => /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+].*)?$/.exec(value)?.slice(1, 4).map(Number);
  const a = parse(left); const b = parse(right);
  if (!a || !b) throw new ReleasePublicationError('INVALID_COMPATIBILITY', 'minimumAppVersion must be a semantic version.');
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

function assertCandidate(release, candidate) {
  const entry = candidate?.entry;
  if (!entry || entry.schema !== 'vozual.release-sign-entry' || entry.formatVersion !== FORMAT_VERSION
      || entry.status !== 'published' || entry.approved !== true) {
    throw new ReleasePublicationError('UNAPPROVED_ENTRY', 'Every release entry must be approved and published.');
  }
  requireId(entry.id, 'entry.id');
  if (entry.languageId !== release.languageId) throw new ReleasePublicationError('LANGUAGE_MISMATCH', `Entry ${entry.id} has a different language.`);
  const approval = candidate.approval;
  if (!approval || approval.status !== 'approved' || !requireHash(approval.validationReportSha256, 'approval.validationReportSha256')) {
    throw new ReleasePublicationError('MISSING_APPROVAL', `Entry ${entry.id} needs an approved validation report.`);
  }
  const compatibility = entry.compatibility;
  if (!compatibility || compatibility.compilerVersion !== release.compilerVersion
      || compatibility.rig?.profileId !== release.rig.profileId
      || compatibility.rig?.profileRevision !== release.rig.profileRevision
      || compatibility.rig?.sha256 !== release.rig.sha256
      || compareSemver(compatibility.minimumAppVersion, release.minimumAppVersion) < 0) {
    throw new ReleasePublicationError('INCOMPATIBLE_ENTRY', `Entry ${entry.id} is not compatible with this release.`);
  }
  if (!Array.isArray(entry.artifacts) || entry.artifacts.length === 0 || !candidate.artifactBytes) {
    throw new ReleasePublicationError('MISSING_ARTIFACT', `Entry ${entry.id} needs compiled artifact bytes.`);
  }
  const kinds = new Set();
  for (const artifact of entry.artifacts) {
    if (!['motion-binary', 'execution-plan'].includes(artifact.kind) || kinds.has(artifact.kind)) throw new ReleasePublicationError('INVALID_ARTIFACT', `Entry ${entry.id} has duplicate or unsupported artifacts.`);
    kinds.add(artifact.kind);
    requireHash(artifact.sha256, `artifact ${artifact.kind} sha256`);
    const bytes = candidate.artifactBytes[artifact.kind];
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== artifact.sizeBytes || sha256(bytes) !== artifact.sha256) {
      throw new ReleasePublicationError('ARTIFACT_INTEGRITY', `Artifact ${entry.id}/${artifact.kind} does not match its declared hash and size.`);
    }
  }
  if (!kinds.has('motion-binary') || (compatibility.sourceMotionSchemaVersion === 3 && !kinds.has('execution-plan'))) {
    throw new ReleasePublicationError('MISSING_ARTIFACT', `Entry ${entry.id} is missing a required runtime artifact.`);
  }
}

function materializeEntry(release, candidate) {
  assertCandidate(release, candidate);
  const entry = candidate.entry;
  return Object.freeze({...entry, artifacts: Object.freeze(entry.artifacts.map(artifact => Object.freeze({
    ...artifact,
    storagePath: artifactPath(release.releaseId, entry.id, artifact),
  })))});
}

function unsignedRoot(root) {
  const copy = {...root};
  delete copy.manifestSha256;
  delete copy.manifestSignature;
  return copy;
}

class HmacManifestSigner {
  constructor(secret, keyId = 'publisher-hmac-v1') {
    if (!(secret instanceof Uint8Array) || secret.byteLength < 32) throw new Error('A 32-byte publisher signing secret is required.');
    this.secret = secret;
    this.keyId = keyId;
  }

  sign(bytes) {
    return `${this.keyId}:${crypto.createHmac('sha256', this.secret).update(bytes).digest('hex')}`;
  }
}

/** A create-once object port. Admin Storage adapters must reject overwrites. */
class InMemoryImmutableObjectStore {
  constructor() { this.objects = new Map(); this.failOnPath = undefined; }
  async putImmutable(path, bytes, metadata) {
    if (this.failOnPath === path) throw new Error(`Injected Storage failure for ${path}.`);
    const existing = this.objects.get(path);
    const copy = Buffer.from(bytes);
    if (existing && !existing.bytes.equals(copy)) throw new Error(`Immutable object collision at ${path}.`);
    if (!existing) this.objects.set(path, {bytes: copy, metadata: {...metadata}});
  }
  async get(path) { const value = this.objects.get(path); return value ? Buffer.from(value.bytes) : undefined; }
}

class InMemoryReleasePointerStore {
  constructor() { this.pointers = new Map(); this.releasePointers = new Map(); this.audit = []; this.failTransaction = false; }
  async transaction(operation) {
    if (this.failTransaction) throw new Error('Injected pointer transaction failure.');
    const pointers = new Map(this.pointers); const releases = new Map(this.releasePointers); const audit = [...this.audit];
    const transaction = {
      getActive: (languageId, locale) => pointers.get(`${languageId}:${locale}`),
      getRelease: (languageId, locale, releaseId) => releases.get(`${languageId}:${locale}:${releaseId}`),
      putActive: pointer => pointers.set(`${pointer.languageId}:${pointer.locale}`, Object.freeze({...pointer})),
      rememberRelease: pointer => releases.set(`${pointer.languageId}:${pointer.locale}:${pointer.releaseId}`, Object.freeze({...pointer})),
      appendAudit: record => audit.push(Object.freeze({...record})),
    };
    const result = await operation(transaction);
    this.pointers = pointers; this.releasePointers = releases; this.audit = audit;
    return result;
  }
}

async function verifyStored(objectStore, path, expectedBytes) {
  const stored = await objectStore.get(path);
  if (!stored || stored.byteLength !== expectedBytes.byteLength || sha256(stored) !== sha256(expectedBytes)) {
    throw new ReleasePublicationError('STORAGE_VERIFICATION', `Storage did not return the exact immutable bytes for ${path}.`);
  }
}

function distributionMetadata(release, digest, formatVersion) {
  return Object.freeze({sha256: digest, releaseId: release.releaseId, compilerVersion: release.compilerVersion,
    rigProfileId: release.rig.profileId, rigProfileRevision: String(release.rig.profileRevision), formatVersion: String(formatVersion)});
}

class AtomicReleasePublisher {
  constructor({objectStore, pointerStore, signer, clock = () => new Date().toISOString()}) {
    if (!objectStore || !pointerStore || !signer) throw new Error('objectStore, pointerStore, and signer are required.');
    this.objectStore = objectStore; this.pointerStore = pointerStore; this.signer = signer; this.clock = clock;
  }

  async publish(input) {
    const release = {...input};
    requireId(release.releaseId, 'releaseId'); requireId(release.languageId, 'languageId');
    if (typeof release.locale !== 'string' || !release.locale.trim() || !release.rig || !release.compilerVersion || !release.minimumAppVersion) throw new ReleasePublicationError('INVALID_RELEASE', 'Release identity and compatibility metadata are required.');
    if (!Array.isArray(release.entries) || release.entries.length === 0) throw new ReleasePublicationError('EMPTY_RELEASE', 'A release needs at least one approved entry.');
    const prefixLength = release.prefixLength ?? 2;
    if (!Number.isInteger(prefixLength) || prefixLength < 1 || prefixLength > 8) throw new ReleasePublicationError('INVALID_FRAGMENT_STRATEGY', 'prefixLength must be between 1 and 8.');
    const publishedAt = release.publishedAt ?? this.clock(); const createdAt = release.createdAt ?? publishedAt;
    const entries = release.entries.map(candidate => materializeEntry(release, candidate));
    if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new ReleasePublicationError('DUPLICATE_ENTRY', 'A release may contain a sign only once.');

    // Write and read back every executable object before we even construct a pointer.
    for (let index = 0; index < entries.length; index += 1) {
      for (const artifact of entries[index].artifacts) {
        const bytes = release.entries[index].artifactBytes[artifact.kind];
        await this.objectStore.putImmutable(artifact.storagePath, bytes, distributionMetadata(release, artifact.sha256, artifact.formatVersion));
        await verifyStored(this.objectStore, artifact.storagePath, bytes);
      }
    }
    const byFragment = new Map();
    for (const entry of entries) {
      const fragmentId = normalizedGlossPrefix(entry.gloss, prefixLength);
      const values = byFragment.get(fragmentId) ?? []; values.push(entry); byFragment.set(fragmentId, values);
    }
    const fragmentReferences = [];
    for (const [fragmentId, fragmentEntries] of [...byFragment.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const fragment = Object.freeze({schema: 'vozual.release-fragment', formatVersion: FORMAT_VERSION, releaseId: release.releaseId, fragmentId, entries: fragmentEntries.sort((a, b) => a.id.localeCompare(b.id))});
      const bytes = utf8(fragment); const digest = sha256(bytes); const path = fragmentPath(release.releaseId, fragmentId, digest);
      await this.objectStore.putImmutable(path, bytes, distributionMetadata(release, digest, FORMAT_VERSION));
      await verifyStored(this.objectStore, path, bytes);
      fragmentReferences.push(Object.freeze({id: fragmentId, storagePath: path, sha256: digest, sizeBytes: bytes.byteLength, entryCount: fragment.entries.length}));
    }
    const unsigned = {schema: 'vozual.release-root', formatVersion: FORMAT_VERSION, releaseId: release.releaseId, languageId: release.languageId, locale: release.locale,
      status: 'published', createdAt, publishedAt, minimumAppVersion: release.minimumAppVersion, compilerVersion: release.compilerVersion, rig: release.rig,
      fragmentStrategy: {kind: 'gloss-prefix-v1', prefixLength}, fragments: fragmentReferences};
    // `manifestSha256` hashes the signed payload (without self-referential
    // integrity fields). The Storage path and pointer hash the full stored
    // bytes. Keeping both avoids an impossible "document contains its own
    // byte hash" cycle while still making every downloaded byte verifiable.
    const manifestPayloadDigest = sha256(utf8(unsigned));
    const root = Object.freeze({...unsigned, manifestSha256: manifestPayloadDigest, manifestSignature: this.signer.sign(utf8(unsigned))});
    const rootBytes = utf8(root); const rootObjectDigest = sha256(rootBytes); const path = rootPath(release.releaseId, rootObjectDigest);
    await this.objectStore.putImmutable(path, rootBytes, distributionMetadata(release, rootObjectDigest, FORMAT_VERSION));
    await verifyStored(this.objectStore, path, rootBytes);
    const pointer = Object.freeze({schema: 'vozual.active-release-pointer', formatVersion: FORMAT_VERSION, languageId: release.languageId, locale: release.locale,
      releaseId: release.releaseId, status: 'published', rootManifestPath: path, rootManifestSha256: rootObjectDigest, updatedAt: publishedAt});
    const previous = await this.pointerStore.transaction(transaction => {
      const current = transaction.getActive(release.languageId, release.locale);
      transaction.rememberRelease(pointer); transaction.putActive(pointer);
      transaction.appendAudit({action: 'publish', at: publishedAt, languageId: release.languageId, locale: release.locale, releaseId: release.releaseId, previousReleaseId: current?.releaseId ?? null, rootManifestSha256: rootObjectDigest});
      return current;
    });
    return Object.freeze({pointer, root, previousPointer: previous});
  }

  async rollback({languageId, locale, releaseId, reason = 'operator-request'}) {
    requireId(languageId, 'languageId'); requireId(releaseId, 'releaseId');
    const at = this.clock();
    return this.pointerStore.transaction(transaction => {
      const target = transaction.getRelease(languageId, locale, releaseId);
      if (!target) throw new ReleasePublicationError('UNKNOWN_RELEASE', `Release ${releaseId} is not available for rollback.`);
      const previous = transaction.getActive(languageId, locale);
      transaction.putActive({...target, updatedAt: at});
      transaction.appendAudit({action: 'rollback', at, languageId, locale, releaseId, previousReleaseId: previous?.releaseId ?? null, reason, rootManifestSha256: target.rootManifestSha256});
      return target;
    });
  }
}

module.exports = {AtomicReleasePublisher, HmacManifestSigner, InMemoryImmutableObjectStore, InMemoryReleasePointerStore, ReleasePublicationError, artifactPath, fragmentPath, rootPath, sha256, unsignedRoot};
