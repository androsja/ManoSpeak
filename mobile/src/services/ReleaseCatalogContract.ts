/**
 * Immutable, client-readable release catalogue contract.
 *
 * This is deliberately a pure contract module. It neither reads Firestore nor
 * downloads Storage objects; later repository and synchronisation tasks own
 * those concerns. A caller must validate every network payload before using it.
 */

export const RELEASE_CATALOG_FORMAT_VERSION = 1 as const;

export type MotionSchemaVersion = 2 | 3;
export type ReleaseLifecycleStatus = 'draft' | 'review' | 'approved' | 'published' | 'withdrawn';
export type ArtifactKind = 'motion-binary' | 'execution-plan';

export type ReleaseArtifact = Readonly<{
  kind: ArtifactKind;
  storagePath: string;
  sha256: string;
  sizeBytes: number;
  formatVersion: number;
}>;

export type ReleaseRig = Readonly<{
  profileId: string;
  profileRevision: number;
  sha256: string;
}>;

export type ReleaseCompatibility = Readonly<{
  sourceMotionSchemaVersion: MotionSchemaVersion;
  minimumAppVersion: string;
  compilerVersion: string;
  rig: ReleaseRig;
}>;

export type ReleaseFragmentReference = Readonly<{
  id: string;
  storagePath: string;
  sha256: string;
  sizeBytes: number;
  entryCount: number;
}>;

export type ReleaseRootManifest = Readonly<{
  schema: 'vozual.release-root';
  formatVersion: typeof RELEASE_CATALOG_FORMAT_VERSION;
  releaseId: string;
  languageId: string;
  locale: string;
  status: ReleaseLifecycleStatus;
  createdAt: string;
  publishedAt: string;
  minimumAppVersion: string;
  compilerVersion: string;
  rig: ReleaseRig;
  manifestSha256: string;
  manifestSignature: string;
  fragmentStrategy: Readonly<{kind: 'gloss-prefix-v1'; prefixLength: number}>;
  fragments: readonly ReleaseFragmentReference[];
}>;

export type ReleaseSignEntry = Readonly<{
  schema: 'vozual.release-sign-entry';
  formatVersion: typeof RELEASE_CATALOG_FORMAT_VERSION;
  id: string;
  languageId: string;
  gloss: string;
  aliases: readonly string[];
  categories: readonly string[];
  status: ReleaseLifecycleStatus;
  approved: boolean;
  compatibility: ReleaseCompatibility;
  artifacts: readonly ReleaseArtifact[];
}>;

export type ReleaseFragment = Readonly<{
  schema: 'vozual.release-fragment';
  formatVersion: typeof RELEASE_CATALOG_FORMAT_VERSION;
  releaseId: string;
  fragmentId: string;
  entries: readonly ReleaseSignEntry[];
}>;

export type ActiveReleasePointer = Readonly<{
  schema: 'vozual.active-release-pointer';
  formatVersion: typeof RELEASE_CATALOG_FORMAT_VERSION;
  languageId: string;
  locale: string;
  releaseId: string;
  status: 'published';
  rootManifestPath: string;
  rootManifestSha256: string;
  updatedAt: string;
}>;

export type ContractValidation = Readonly<{valid: boolean; errors: readonly string[]}>;

const SHA_256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SAFE_STORAGE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?\/)[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && SHA_256.test(value);
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function validPath(value: unknown): value is string {
  return typeof value === 'string' && SAFE_STORAGE_PATH.test(value);
}

function distributionRootPath(releaseId: string, digest: string): string {
  return `distribution/releases/${releaseId}/root/${digest}/manifest.json`;
}

function distributionFragmentPath(releaseId: string, fragmentId: string, digest: string): string {
  return `distribution/releases/${releaseId}/fragments/${fragmentId}/${digest}/fragment.json`;
}

function distributionArtifactPath(releaseId: string, signId: string, artifact: ReleaseArtifact): string {
  const fileName = artifact.kind === 'motion-binary' ? 'artifact.bin' : 'artifact.json';
  return `distribution/releases/${releaseId}/signs/${signId}/${artifact.kind}/${artifact.sha256}/${fileName}`;
}

function validStatus(value: unknown): value is ReleaseLifecycleStatus {
  return value === 'draft' || value === 'review' || value === 'approved'
    || value === 'published' || value === 'withdrawn';
}

function validateRig(value: unknown, errors: string[], name: string): value is ReleaseRig {
  if (!isObject(value) || !hasOnlyKeys(value, ['profileId', 'profileRevision', 'sha256'])
      || !validId(value.profileId) || !Number.isInteger(value.profileRevision)
      || (value.profileRevision as number) < 1 || !validHash(value.sha256)) {
    errors.push(`${name} must identify a versioned, hashed rig profile`);
    return false;
  }
  return true;
}

function validateArtifact(value: unknown, errors: string[], name: string): value is ReleaseArtifact {
  if (!isObject(value) || !hasOnlyKeys(value, ['kind', 'storagePath', 'sha256', 'sizeBytes', 'formatVersion'])
      || (value.kind !== 'motion-binary' && value.kind !== 'execution-plan')
      || !validPath(value.storagePath) || !validHash(value.sha256)
      || !Number.isInteger(value.sizeBytes) || (value.sizeBytes as number) < 1
      || !Number.isInteger(value.formatVersion) || (value.formatVersion as number) < 1) {
    errors.push(`${name} must be a hashed, non-empty immutable artifact reference`);
    return false;
  }
  return true;
}

/** A sign can execute only when every runtime trust dependency is present. */
export function validateReleaseSignEntry(value: unknown): ContractValidation {
  const errors: string[] = [];
  if (!isObject(value) || !hasOnlyKeys(value, [
    'schema', 'formatVersion', 'id', 'languageId', 'gloss', 'aliases', 'categories',
    'status', 'approved', 'compatibility', 'artifacts',
  ])) {
    return {valid: false, errors: ['entry has unknown or missing fields']};
  }
  if (value.schema !== 'vozual.release-sign-entry' || value.formatVersion !== RELEASE_CATALOG_FORMAT_VERSION) {
    errors.push('entry schema or formatVersion is unsupported');
  }
  if (!validId(value.id) || !validId(value.languageId) || typeof value.gloss !== 'string' || value.gloss.trim() === '') {
    errors.push('entry identity is invalid');
  }
  if (!Array.isArray(value.aliases) || !value.aliases.every(alias => typeof alias === 'string' && alias.trim() !== '')
      || !Array.isArray(value.categories) || !value.categories.every(category => typeof category === 'string' && category.trim() !== '')) {
    errors.push('entry search metadata is invalid');
  }
  if (!validStatus(value.status) || value.status !== 'published' || value.approved !== true) {
    errors.push('entry must be approved and published');
  }
  if (!isObject(value.compatibility) || !hasOnlyKeys(value.compatibility, [
    'sourceMotionSchemaVersion', 'minimumAppVersion', 'compilerVersion', 'rig',
  ]) || (value.compatibility.sourceMotionSchemaVersion !== 2 && value.compatibility.sourceMotionSchemaVersion !== 3)
      || typeof value.compatibility.minimumAppVersion !== 'string' || !SEMVER.test(value.compatibility.minimumAppVersion)
      || typeof value.compatibility.compilerVersion !== 'string' || value.compatibility.compilerVersion.trim() === '') {
    errors.push('entry compatibility is invalid or does not explicitly support v2/v3');
  } else {
    validateRig(value.compatibility.rig, errors, 'entry compatibility.rig');
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) {
    errors.push('entry needs runtime artifacts');
  } else {
    value.artifacts.forEach((artifact, index) => validateArtifact(artifact, errors, `artifacts[${index}]`));
    const kinds = value.artifacts.map(artifact => isObject(artifact) ? artifact.kind : undefined);
    if (!kinds.includes('motion-binary')) errors.push('entry needs a motion-binary artifact');
    if (isObject(value.compatibility) && value.compatibility.sourceMotionSchemaVersion === 3 && !kinds.includes('execution-plan')) {
      errors.push('v3 entry needs an execution-plan artifact');
    }
  }
  return {valid: errors.length === 0, errors};
}

export function validateReleaseRootManifest(value: unknown): ContractValidation {
  const errors: string[] = [];
  if (!isObject(value) || !hasOnlyKeys(value, [
    'schema', 'formatVersion', 'releaseId', 'languageId', 'locale', 'status', 'createdAt', 'publishedAt',
    'minimumAppVersion', 'compilerVersion', 'rig', 'manifestSha256', 'manifestSignature', 'fragmentStrategy', 'fragments',
  ])) return {valid: false, errors: ['root manifest has unknown or missing fields']};
  if (value.schema !== 'vozual.release-root' || value.formatVersion !== RELEASE_CATALOG_FORMAT_VERSION) errors.push('root schema is unsupported');
  if (!validId(value.releaseId) || !validId(value.languageId) || typeof value.locale !== 'string' || value.locale.trim() === '') errors.push('root identity is invalid');
  if (value.status !== 'published' || !validDate(value.createdAt) || !validDate(value.publishedAt)) errors.push('root must be a dated published release');
  if (typeof value.minimumAppVersion !== 'string' || !SEMVER.test(value.minimumAppVersion) || typeof value.compilerVersion !== 'string' || value.compilerVersion.trim() === '') errors.push('root compatibility is invalid');
  validateRig(value.rig, errors, 'root rig');
  if (!validHash(value.manifestSha256) || typeof value.manifestSignature !== 'string' || value.manifestSignature.trim() === '') errors.push('root integrity metadata is invalid');
  if (!isObject(value.fragmentStrategy) || !hasOnlyKeys(value.fragmentStrategy, ['kind', 'prefixLength'])
      || value.fragmentStrategy.kind !== 'gloss-prefix-v1' || !Number.isInteger(value.fragmentStrategy.prefixLength)
      || (value.fragmentStrategy.prefixLength as number) < 1) errors.push('root fragment strategy is invalid');
  if (!Array.isArray(value.fragments) || value.fragments.length === 0) errors.push('root needs fragment references');
  else value.fragments.forEach((fragment, index) => {
    if (!isObject(fragment) || !hasOnlyKeys(fragment, ['id', 'storagePath', 'sha256', 'sizeBytes', 'entryCount'])
        || !validId(fragment.id) || !validPath(fragment.storagePath) || !validHash(fragment.sha256)
        || !Number.isInteger(fragment.sizeBytes) || (fragment.sizeBytes as number) < 1
        || !Number.isInteger(fragment.entryCount) || (fragment.entryCount as number) < 0) errors.push(`fragments[${index}] is invalid`);
    else if (validId(value.releaseId) && fragment.storagePath !== distributionFragmentPath(value.releaseId, fragment.id, fragment.sha256)) {
      errors.push(`fragments[${index}] must use an immutable content-addressed distribution path`);
    }
  });
  return {valid: errors.length === 0, errors};
}

export function validateReleaseFragment(value: unknown): ContractValidation {
  const errors: string[] = [];
  if (!isObject(value) || !hasOnlyKeys(value, ['schema', 'formatVersion', 'releaseId', 'fragmentId', 'entries'])) return {valid: false, errors: ['fragment has unknown or missing fields']};
  if (value.schema !== 'vozual.release-fragment' || value.formatVersion !== RELEASE_CATALOG_FORMAT_VERSION || !validId(value.releaseId) || !validId(value.fragmentId)) errors.push('fragment identity is invalid');
  if (!Array.isArray(value.entries) || value.entries.length === 0) errors.push('fragment needs entries');
  else value.entries.forEach((entry, index) => {
    const result = validateReleaseSignEntry(entry);
    if (!result.valid) errors.push(`entries[${index}]: ${result.errors.join('; ')}`);
    if (isObject(entry) && validId(value.releaseId) && validId(entry.id) && Array.isArray(entry.artifacts)) {
      entry.artifacts.forEach((artifact, artifactIndex) => {
        if (validateArtifact(artifact, [], `entries[${index}].artifacts[${artifactIndex}]`)
            && artifact.storagePath !== distributionArtifactPath(value.releaseId as string, entry.id as string, artifact)) {
          errors.push(`entries[${index}].artifacts[${artifactIndex}] must use an immutable content-addressed distribution path`);
        }
      });
    }
  });
  return {valid: errors.length === 0, errors};
}

export function validateActiveReleasePointer(value: unknown): ContractValidation {
  const errors: string[] = [];
  if (!isObject(value) || !hasOnlyKeys(value, ['schema', 'formatVersion', 'languageId', 'locale', 'releaseId', 'status', 'rootManifestPath', 'rootManifestSha256', 'updatedAt'])) return {valid: false, errors: ['active release pointer has unknown or missing fields']};
  if (value.schema !== 'vozual.active-release-pointer' || value.formatVersion !== RELEASE_CATALOG_FORMAT_VERSION
      || !validId(value.languageId) || !validId(value.releaseId) || typeof value.locale !== 'string' || value.locale.trim() === ''
      || value.status !== 'published' || !validPath(value.rootManifestPath) || !validHash(value.rootManifestSha256) || !validDate(value.updatedAt)
      || (validId(value.releaseId) && validHash(value.rootManifestSha256)
        && value.rootManifestPath !== distributionRootPath(value.releaseId, value.rootManifestSha256))) errors.push('active release pointer is invalid');
  return {valid: errors.length === 0, errors};
}

export function assertReleaseContract(result: ContractValidation): void {
  if (!result.valid) throw new Error(`Invalid release catalogue contract: ${result.errors.join('; ')}`);
}
