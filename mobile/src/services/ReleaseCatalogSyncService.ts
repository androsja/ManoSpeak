import {
  assertReleaseContract,
  validateActiveReleasePointer,
  validateReleaseFragment,
  validateReleaseRootManifest,
  type ActiveReleasePointer,
  type ReleaseFragment,
  type ReleaseRootManifest,
} from './ReleaseCatalogContract';
import type {ReleaseCatalogRepository} from './repositories/ReleaseRepositories';

/**
 * A cryptographic adapter belongs at the mobile composition root. Keeping it
 * behind a port prevents a JavaScript-only fallback from silently weakening
 * release verification on a device.
 */
export interface ReleaseCatalogueIntegrity {
  sha256Utf8(value: string): Promise<string>;
  verifyManifestSignature(payload: string, signature: string): Promise<boolean>;
}

export type CachedReleaseCatalogue = Readonly<{
  pointer: ActiveReleasePointer;
  root: ReleaseRootManifest;
  fragments: readonly ReleaseFragment[];
  activatedAt: string;
}>;

/** A separate read model: catalogue sync never pretends artifacts are installed. */
export interface ReleaseCatalogueCacheRepository {
  getActive(languageId: string, locale: string): Promise<CachedReleaseCatalogue | undefined>;
  beginStage(catalogue: CachedReleaseCatalogue): Promise<void>;
  activateStage(releaseId: string): Promise<void>;
  discardStage(releaseId: string): Promise<void>;
}

export class InMemoryReleaseCatalogueCacheRepository implements ReleaseCatalogueCacheRepository {
  private readonly active = new Map<string, CachedReleaseCatalogue>();
  private readonly stages = new Map<string, CachedReleaseCatalogue>();

  async getActive(languageId: string, locale: string): Promise<CachedReleaseCatalogue | undefined> {
    return this.active.get(`${languageId}:${locale}`);
  }

  async beginStage(catalogue: CachedReleaseCatalogue): Promise<void> {
    if (this.stages.has(catalogue.pointer.releaseId)) {
      throw new Error(`Release ${catalogue.pointer.releaseId} is already being staged.`);
    }
    this.stages.set(catalogue.pointer.releaseId, catalogue);
  }

  async activateStage(releaseId: string): Promise<void> {
    const catalogue = this.stages.get(releaseId);
    if (!catalogue) throw new Error(`Release ${releaseId} has no catalogue stage.`);
    this.active.set(`${catalogue.pointer.languageId}:${catalogue.pointer.locale}`, catalogue);
    this.stages.delete(releaseId);
  }

  async discardStage(releaseId: string): Promise<void> {
    this.stages.delete(releaseId);
  }
}

export type ReleaseCatalogueSyncRequest = Readonly<{
  languageId: string;
  locale: string;
  appVersion: string;
  /** Fragment IDs selected by search, pack, or selected language flow. */
  requiredFragmentIds?: readonly string[];
  /** Temporary migration only. It is false unless explicitly supplied. */
  allowLegacyMigration?: boolean;
  legacyMigration?: () => Promise<void>;
}>;

export type ReleaseCatalogueSyncResult =
  | Readonly<{status: 'unchanged'; catalogue: CachedReleaseCatalogue}>
  | Readonly<{status: 'updated'; catalogue: CachedReleaseCatalogue}>
  | Readonly<{status: 'offline'; catalogue?: CachedReleaseCatalogue}>
  | Readonly<{status: 'migration-required'; catalogue?: CachedReleaseCatalogue}>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function unsignedRoot(root: ReleaseRootManifest): Omit<ReleaseRootManifest, 'manifestSha256' | 'manifestSignature'> {
  const unsigned: Record<string, unknown> = {...root};
  delete unsigned.manifestSha256;
  delete unsigned.manifestSignature;
  return unsigned as Omit<ReleaseRootManifest, 'manifestSha256' | 'manifestSignature'>;
}

function compareSemver(left: string, right: string): number {
  const parse = (value: string): number[] | undefined => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) throw new Error('Release compatibility contains an invalid semantic version.');
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

async function assertRootIntegrity(
  pointer: ActiveReleasePointer,
  root: ReleaseRootManifest,
  integrity: ReleaseCatalogueIntegrity,
  appVersion: string,
): Promise<void> {
  assertReleaseContract(validateReleaseRootManifest(root));
  if (root.releaseId !== pointer.releaseId || root.languageId !== pointer.languageId || root.locale !== pointer.locale) {
    throw new Error('Release root does not match the active pointer.');
  }
  if (await integrity.sha256Utf8(canonicalJson(root)) !== pointer.rootManifestSha256) {
    throw new Error('Release root bytes do not match the active pointer hash.');
  }
  const payload = canonicalJson(unsignedRoot(root));
  if (await integrity.sha256Utf8(payload) !== root.manifestSha256) {
    throw new Error('Release root signed payload hash is invalid.');
  }
  if (!await integrity.verifyManifestSignature(payload, root.manifestSignature)) {
    throw new Error('Release root signature is invalid.');
  }
  if (compareSemver(appVersion, root.minimumAppVersion) < 0) {
    throw new Error(`Release requires app version ${root.minimumAppVersion} or newer.`);
  }
}

async function assertFragmentIntegrity(
  root: ReleaseRootManifest,
  fragment: ReleaseFragment,
  integrity: ReleaseCatalogueIntegrity,
  appVersion: string,
): Promise<void> {
  assertReleaseContract(validateReleaseFragment(fragment));
  const reference = root.fragments.find(candidate => candidate.id === fragment.fragmentId);
  if (!reference || fragment.releaseId !== root.releaseId) {
    throw new Error('Downloaded fragment is not referenced by the verified release root.');
  }
  const serialized = canonicalJson(fragment);
  if (new TextEncoder().encode(serialized).byteLength !== reference.sizeBytes
      || await integrity.sha256Utf8(serialized) !== reference.sha256) {
    throw new Error(`Release fragment ${fragment.fragmentId} failed integrity verification.`);
  }
  if (fragment.entries.length !== reference.entryCount) {
    throw new Error(`Release fragment ${fragment.fragmentId} entry count is invalid.`);
  }
  for (const entry of fragment.entries) {
    if (compareSemver(appVersion, entry.compatibility.minimumAppVersion) < 0) {
      throw new Error(`Release fragment ${fragment.fragmentId} requires a newer app version.`);
    }
  }
}

/**
 * Cache-aside synchronizer. It reads exactly one pointer on every check and
 * fetches no root or fragment when that pointer names the already verified
 * release. Failed network/verification attempts never replace active cache.
 */
export class ReleaseCatalogueSynchronizer {
  constructor(
    private readonly catalogue: ReleaseCatalogRepository,
    private readonly cache: ReleaseCatalogueCacheRepository,
    private readonly integrity: ReleaseCatalogueIntegrity,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async sync(request: ReleaseCatalogueSyncRequest): Promise<ReleaseCatalogueSyncResult> {
    const previous = await this.cache.getActive(request.languageId, request.locale);
    let pointer: ActiveReleasePointer | undefined;
    try {
      pointer = await this.catalogue.getActiveRelease(request.languageId, request.locale);
    } catch {
      return {status: 'offline', catalogue: previous};
    }
    if (!pointer) {
      if (request.allowLegacyMigration === true && request.legacyMigration) {
        await request.legacyMigration();
        return {status: 'migration-required', catalogue: previous};
      }
      return {status: 'offline', catalogue: previous};
    }
    try {
      assertReleaseContract(validateActiveReleasePointer(pointer));
      if (previous
        && previous.pointer.releaseId === pointer.releaseId
        && previous.pointer.rootManifestSha256 === pointer.rootManifestSha256) {
        return {status: 'unchanged', catalogue: previous};
      }
      const root = await this.catalogue.getRootManifest(pointer);
      await assertRootIntegrity(pointer, root, this.integrity, request.appVersion);
      const ids = [...new Set(request.requiredFragmentIds ?? [])];
      const available = new Set(root.fragments.map(fragment => fragment.id));
      if (ids.some(id => !available.has(id))) throw new Error('Requested release fragment is not in the verified root.');
      const fragments = await Promise.all(ids.map(async id => {
        const fragment = await this.catalogue.getFragment(root.releaseId, id);
        await assertFragmentIntegrity(root, fragment, this.integrity, request.appVersion);
        return fragment;
      }));
      const next: CachedReleaseCatalogue = {pointer, root, fragments, activatedAt: this.clock()};
      await this.cache.beginStage(next);
      try {
        await this.cache.activateStage(pointer.releaseId);
      } catch (error) {
        await this.cache.discardStage(pointer.releaseId);
        throw error;
      }
      return {status: 'updated', catalogue: next};
    } catch {
      // A cryptographic or compatibility failure is intentionally presented as
      // offline fallback: the prior verified release stays usable and the
      // untrusted network response is never made visible to playback.
      return {status: 'offline', catalogue: previous};
    }
  }
}

export const releaseCatalogueCanonicalJson = canonicalJson;
