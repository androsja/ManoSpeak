import {
  collection,
  doc,
  getDoc,
  getDocsFromServer,
  getFirestore,
  query,
  where,
} from '@react-native-firebase/firestore';
import RNFS from 'react-native-fs';
import {fromByteArray, toByteArray} from 'base64-js';
import {gunzipSync} from 'fflate';
import {parseJsonMotionDocument, type JsonMotionDocument} from './JsonMotionLoader';

const LIBRARY_ROOT = `${RNFS.DocumentDirectoryPath}/vozual-sign-languages`;
const LIBRARY_STATE_PATH = `${LIBRARY_ROOT}/library.json`;
const LIBRARY_STATE_BACKUP_PATH = `${LIBRARY_STATE_PATH}.backup`;
const SETUP_COMPLETE_PATH = `${LIBRARY_ROOT}/setup-complete`;
const LIBRARY_PATH_MARKER = '/vozual-sign-languages/';
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export type SignLanguage = {
  id: string;
  code: string;
  name: string;
  region: string;
  published: boolean;
};

export type PublishedSign = {
  id: string;
  languageId: string;
  gloss: string;
  version: number;
  assetName: string;
  sizeBytes: number;
  assetDocumentPath?: string;
  storagePath?: string;
  downloadUrl?: string;
  semanticPath?: string;
  profilePath?: string;
  sha256: string;
  profileSha256: string;
  // This digest covers the complete independently published release,
  // including speech aliases. Motion bytes alone cannot detect a vocabulary
  // update because an editor can change a spoken form without changing the
  // animation file.
  releaseSha256: string;
  speechAliases: string[];
  categories: string[];
  lexicalClass: string;
  verbType: 'none' | 'plain' | 'directional_review_required' | 'spatial_review_required';
  requiresSubjectMarker: boolean;
  motionFormat: 'compact-v2' | 'legacy-json-v2';
  jsonReleaseId?: string;
  jsonChunkCount?: number;
  jsonCompressedChunkCount?: number;
  compressedSizeBytes?: number;
  approved: boolean;
  compiled: boolean;
  published: boolean;
  updatedAt?: unknown;
};

function transferSizeBytes(sign: PublishedSign): number {
  return sign.compressedSizeBytes ?? sign.sizeBytes;
}

/**
 * A reviewed Spanish phrase that can be suggested after its complete sign
 * sequence has been installed. Phrase metadata is published separately from
 * motion binaries so the catalogue can grow without a new app build.
 */
export type PublishedPhrase = {
  id: string;
  languageId: string;
  version: number;
  spanish: string;
  glossSequence: string[];
  releaseSha256: string;
  jsonReleaseId?: string;
  approved: boolean;
  published: boolean;
  updatedAt?: unknown;
};

export type InstalledSign = Pick<PublishedSign,
  | 'id'
  | 'languageId'
  | 'gloss'
  | 'version'
  | 'assetName'
  | 'sizeBytes'
  | 'storagePath'
  | 'downloadUrl'
  | 'semanticPath'
  | 'profilePath'
  | 'sha256'
  | 'speechAliases'
  | 'categories'
  | 'lexicalClass'
  | 'verbType'
  | 'requiresSubjectMarker'
> & {
  motionFormat?: PublishedSign['motionFormat'];
  // Older local libraries did not persist the semantic release digest. Keep
  // this optional for migration; its absence intentionally triggers one
  // refresh from Firebase so aliases cannot remain stale on a device.
  releaseSha256?: string;
  profileSha256?: string;
  avatarProfile?: Record<string, unknown>;
  installedAt: string;
  localPath: string;
};

export type InstalledPhrase = Pick<PublishedPhrase,
  | 'id'
  | 'languageId'
  | 'version'
  | 'spanish'
  | 'glossSequence'
  | 'releaseSha256'
> & {
  installedAt: string;
};

export type SignLanguageStatus = SignLanguage & {
  signs: PublishedSign[];
  pendingSigns: PublishedSign[];
  removedSigns: InstalledSign[];
  installedSigns: InstalledSign[];
  phrases: PublishedPhrase[];
  pendingPhrases: PublishedPhrase[];
  removedPhrases: InstalledPhrase[];
  installedPhrases: InstalledPhrase[];
  installedSignCount: number;
  changeCount: number;
  totalSizeBytes: number;
  pendingSizeBytes: number;
  revision: string;
  followed: boolean;
  dismissed: boolean;
  selected: boolean;
};

export type SignLibraryState = {
  installedSigns: Record<string, InstalledSign>;
  installedPhrases: Record<string, InstalledPhrase>;
  followedLanguageIds: string[];
  dismissedRevisions: Record<string, string>;
  selectedLanguageId?: string;
};

const EMPTY_LIBRARY_STATE: SignLibraryState = {
  installedSigns: {},
  installedPhrases: {},
  followedLanguageIds: [],
  dismissedRevisions: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function currentLibraryPath(storedPath: string): string {
  const markerIndex = storedPath.indexOf(LIBRARY_PATH_MARKER);
  if (markerIndex < 0) return storedPath;
  const relativePath = storedPath.slice(markerIndex + LIBRARY_PATH_MARKER.length);
  const pathSegments = relativePath.split('/');
  if (
    pathSegments.length === 0
    || pathSegments.some(segment => !segment || segment === '.' || segment === '..')
  ) return storedPath;
  return `${LIBRARY_ROOT}/${relativePath}`;
}

function normalizeInstalledSigns(value: unknown): Record<string, InstalledSign> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([id, sign]) => {
    if (!isRecord(sign) || typeof sign.localPath !== 'string') {
      return [id, sign as InstalledSign];
    }
    return [id, {
      ...sign,
      localPath: currentLibraryPath(sign.localPath),
    } as InstalledSign];
  }));
}

function normalizeInstalledPhrases(value: unknown): Record<string, InstalledPhrase> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, phrase]) => (
    isRecord(phrase)
    && typeof phrase.languageId === 'string'
    && typeof phrase.spanish === 'string'
    && Array.isArray(phrase.glossSequence)
  ))) as Record<string, InstalledPhrase>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Sign metadata has an invalid ${field}.`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`Sign metadata has an invalid ${field}.`);
  }
  return value;
}

function sha256Digest(value: unknown, field: string): string {
  const digest = requiredString(value, field).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`Sign metadata has an invalid ${field}.`);
  }
  return digest;
}

function optionalStoragePath(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const path = requiredString(value, field);
  if (path.startsWith('/') || path.split('/').some(segment => !SAFE_PATH_SEGMENT.test(segment))) {
    throw new Error(`Sign metadata has an invalid ${field}.`);
  }
  return path;
}

function optionalDownloadUrl(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const url = requiredString(value, 'downloadUrl');
  try {
    if (new URL(url).protocol !== 'https:') throw new Error();
  } catch {
    throw new Error('Sign metadata has an invalid downloadUrl.');
  }
  return url;
}

export type PublishedAssetReference = {
  storagePath?: string;
  downloadUrl?: string;
  semanticPath?: string;
  profilePath?: string;
};

/**
 * Minimal boundary between the sign installer and Firebase Storage.
 * Implementations must write the object bytes to `destinationPath`.
 */
export type FirebaseStorageAdapter = {
  downloadToFile: (storagePath: string, destinationPath: string) => Promise<void>;
};

export type FirebaseStorageAdapterOptions = {
  resolveDownloadUrl: (storagePath: string) => Promise<string>;
  downloadToFile?: (downloadUrl: string, destinationPath: string) => Promise<void>;
};

/**
 * Creates an adapter without importing or configuring the Firebase Storage SDK.
 * The caller supplies the SDK-specific `storagePath` resolver, which keeps
 * credentials and Firebase initialization outside this service and its tests.
 */
export function createFirebaseStorageAdapter(
  options: FirebaseStorageAdapterOptions,
): FirebaseStorageAdapter {
  const downloadResolvedUrl = options.downloadToFile ?? (async (
    downloadUrl: string,
    destinationPath: string,
  ) => {
    await RNFS.downloadFile({fromUrl: downloadUrl, toFile: destinationPath}).promise;
  });
  return {
    async downloadToFile(storagePath: string, destinationPath: string): Promise<void> {
      const downloadUrl = await options.resolveDownloadUrl(storagePath);
      optionalDownloadUrl(downloadUrl);
      await downloadResolvedUrl(downloadUrl, destinationPath);
    },
  };
}

export function parsePublishedAssetReference(data: unknown): PublishedAssetReference {
  if (!isRecord(data)) throw new Error('Sign metadata has an invalid asset reference.');
  const reference = {
    storagePath: optionalStoragePath(data.storagePath, 'storagePath'),
    downloadUrl: optionalDownloadUrl(data.downloadUrl),
    semanticPath: optionalStoragePath(data.semanticPath, 'semanticPath'),
    profilePath: optionalStoragePath(data.profilePath, 'profilePath'),
  };
  if (!reference.storagePath && !reference.downloadUrl) {
    throw new Error('Sign metadata requires storagePath or downloadUrl.');
  }
  return reference;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`Sign metadata has an invalid ${field}.`);
  }
  return Array.from(new Set(value.map(item => item.trim()).filter(Boolean)));
}

function verbType(value: unknown): PublishedSign['verbType'] {
  const supported: PublishedSign['verbType'][] = [
    'none',
    'plain',
    'directional_review_required',
    'spatial_review_required',
  ];
  if (!supported.includes(value as PublishedSign['verbType'])) {
    throw new Error('Sign metadata has an invalid verbType.');
  }
  return value as PublishedSign['verbType'];
}

export function parseSignLanguage(id: string, data: unknown): SignLanguage {
  if (!isRecord(data)) throw new Error(`Sign language ${id} is not an object.`);
  if (!SAFE_PATH_SEGMENT.test(id)) throw new Error(`Sign language ${id} has an invalid ID.`);
  return {
    id,
    code: requiredString(data.code, 'code'),
    name: requiredString(data.name, 'name'),
    region: requiredString(data.region, 'region'),
    published: data.published === true,
  };
}

export function parsePublishedSign(id: string, data: unknown): PublishedSign {
  if (!isRecord(data)) throw new Error(`Sign ${id} is not an object.`);
  if (!SAFE_PATH_SEGMENT.test(id)) throw new Error(`Sign ${id} has an invalid ID.`);
  const assetDocumentPath = data.assetDocumentPath === undefined
    ? undefined
    : requiredString(data.assetDocumentPath, 'assetDocumentPath');
  if (assetDocumentPath && !assetDocumentPath.startsWith(`signs/${id}/versions/`)) {
    throw new Error(`Sign ${id} has an invalid asset document path.`);
  }
  const assetReference = data.storagePath !== undefined || data.downloadUrl !== undefined
    ? parsePublishedAssetReference(data)
    : {};
  const motionFormat = data.motionFormat === undefined ? 'compact-v2' : data.motionFormat;
  if (motionFormat !== 'compact-v2' && motionFormat !== 'legacy-json-v2') {
    throw new Error(`Sign ${id} has an unsupported motion format.`);
  }
  const jsonReleaseId = data.jsonReleaseId === undefined
    ? undefined
    : requiredString(data.jsonReleaseId, 'jsonReleaseId');
  if (jsonReleaseId && !SAFE_PATH_SEGMENT.test(jsonReleaseId)) {
    throw new Error(`Sign ${id} has an invalid JSON release ID.`);
  }
  const jsonChunkCount = data.jsonChunkCount === undefined
    ? undefined
    : positiveInteger(data.jsonChunkCount, 'jsonChunkCount');
  const jsonCompressedChunkCount = data.jsonCompressedChunkCount === undefined
    ? undefined
    : positiveInteger(data.jsonCompressedChunkCount, 'jsonCompressedChunkCount');
  const compressedSizeBytes = data.compressedSizeBytes === undefined
    ? undefined
    : positiveInteger(data.compressedSizeBytes, 'compressedSizeBytes');
  if ((jsonCompressedChunkCount !== undefined || compressedSizeBytes !== undefined || data.jsonCompression !== undefined)
      && (motionFormat !== 'legacy-json-v2' || data.jsonCompression !== 'gzip'
        || jsonCompressedChunkCount === undefined || compressedSizeBytes === undefined)) {
    throw new Error(`Sign ${id} has invalid compressed JSON metadata.`);
  }
  const hasChunkedJsonSource = motionFormat === 'legacy-json-v2'
    && Boolean(jsonReleaseId)
    && jsonChunkCount !== undefined;
  if (!assetDocumentPath && !assetReference.storagePath && !assetReference.downloadUrl && !hasChunkedJsonSource) {
    throw new Error(`Sign ${id} has no asset source.`);
  }
  const sha256 = sha256Digest(data.sha256, 'sha256');
  const profileSha256 = sha256Digest(data.profileSha256, 'profileSha256');
  if (data.approved !== true || data.compiled !== true || data.published !== true) {
    throw new Error(`Sign ${id} is not approved, compiled, and published.`);
  }
  const assetName = requiredString(data.assetName, 'assetName');
  if (!SAFE_PATH_SEGMENT.test(assetName)) {
    throw new Error(`Sign ${id} has an invalid asset name.`);
  }
  return {
    id,
    languageId: requiredString(data.languageId, 'languageId'),
    gloss: requiredString(data.gloss, 'gloss').toUpperCase(),
    version: positiveInteger(data.version, 'version'),
    assetName,
    sizeBytes: positiveInteger(data.sizeBytes, 'sizeBytes'),
    assetDocumentPath,
    ...assetReference,
    sha256,
    profileSha256,
    releaseSha256: sha256Digest(data.releaseSha256, 'releaseSha256'),
    speechAliases: stringArray(data.speechAliases, 'speechAliases'),
    categories: stringArray(data.categories, 'categories'),
    lexicalClass: requiredString(data.lexicalClass, 'lexicalClass'),
    verbType: verbType(data.verbType),
    requiresSubjectMarker: data.requiresSubjectMarker === true,
    motionFormat,
    jsonReleaseId,
    jsonChunkCount,
    jsonCompressedChunkCount,
    compressedSizeBytes,
    approved: true,
    compiled: true,
    published: true,
    updatedAt: data.updatedAt,
  };
}

export function parsePublishedPhrase(id: string, data: unknown): PublishedPhrase {
  if (!isRecord(data)) throw new Error(`Phrase ${id} is not an object.`);
  if (!SAFE_PATH_SEGMENT.test(id)) throw new Error(`Phrase ${id} has an invalid ID.`);
  if (data.approved !== true || data.published !== true) {
    throw new Error(`Phrase ${id} is not approved and published.`);
  }
  const glossSequence = stringArray(data.glossSequence, 'glossSequence')
    .map(gloss => gloss.toLocaleUpperCase('es-CO'));
  if (glossSequence.length === 0) {
    throw new Error(`Phrase ${id} has an empty gloss sequence.`);
  }
  return {
    id,
    languageId: requiredString(data.languageId, 'languageId'),
    version: positiveInteger(data.version, 'version'),
    spanish: requiredString(data.spanish, 'spanish'),
    glossSequence,
    releaseSha256: sha256Digest(data.releaseSha256, 'releaseSha256'),
    approved: true,
    published: true,
    updatedAt: data.updatedAt,
  };
}

function normalizeState(value: unknown): SignLibraryState {
  if (!isRecord(value)) return {...EMPTY_LIBRARY_STATE};
  return {
    installedSigns: normalizeInstalledSigns(value.installedSigns),
    installedPhrases: normalizeInstalledPhrases(value.installedPhrases),
    followedLanguageIds: Array.isArray(value.followedLanguageIds)
      ? value.followedLanguageIds.map(String)
      : [],
    dismissedRevisions: isRecord(value.dismissedRevisions)
      ? Object.fromEntries(Object.entries(value.dismissedRevisions).map(([key, revision]) => [key, String(revision)]))
      : {},
    selectedLanguageId: typeof value.selectedLanguageId === 'string'
      ? value.selectedLanguageId
      : undefined,
  };
}

async function readLibraryState(): Promise<SignLibraryState> {
  for (const path of [LIBRARY_STATE_PATH, LIBRARY_STATE_BACKUP_PATH]) {
    try {
      return normalizeState(JSON.parse(await RNFS.readFile(path, 'utf8')) as unknown);
    } catch {
      // Try the recoverable backup before treating the library as empty.
    }
  }
  return {...EMPTY_LIBRARY_STATE};
}

async function writeLibraryState(state: SignLibraryState): Promise<void> {
  await RNFS.mkdir(LIBRARY_ROOT);
  const temporaryPath = `${LIBRARY_STATE_PATH}.download`;
  await RNFS.writeFile(temporaryPath, JSON.stringify(state), 'utf8');
  let backedUpCurrentState = false;
  try {
    if (await RNFS.exists(LIBRARY_STATE_BACKUP_PATH)) {
      await RNFS.unlink(LIBRARY_STATE_BACKUP_PATH);
    }
    if (await RNFS.exists(LIBRARY_STATE_PATH)) {
      await RNFS.moveFile(LIBRARY_STATE_PATH, LIBRARY_STATE_BACKUP_PATH);
      backedUpCurrentState = true;
    }
    await RNFS.moveFile(temporaryPath, LIBRARY_STATE_PATH);
    if (backedUpCurrentState && await RNFS.exists(LIBRARY_STATE_BACKUP_PATH)) {
      await RNFS.unlink(LIBRARY_STATE_BACKUP_PATH);
    }
  } catch (error) {
    if (
      backedUpCurrentState
      && !await RNFS.exists(LIBRARY_STATE_PATH)
      && await RNFS.exists(LIBRARY_STATE_BACKUP_PATH)
    ) {
      await RNFS.moveFile(LIBRARY_STATE_BACKUP_PATH, LIBRARY_STATE_PATH);
    }
    if (await RNFS.exists(temporaryPath)) await RNFS.unlink(temporaryPath);
    throw error;
  }
}

async function bestEffortDelete(path: string): Promise<void> {
  try {
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  } catch {
    // Orphan cleanup must not roll back an already committed library state.
  }
}

function immutableAssetPath(languageDirectory: string, sign: PublishedSign): string {
  return `${languageDirectory}/${sign.version}-${sign.sha256.slice(0, 16)}-`
    + `${sign.profileSha256.slice(0, 16)}-${sign.assetName}`;
}

function signRevision(signs: readonly PublishedSign[]): string {
  return signs
    .map(sign => `${sign.id}:${sign.version}:${sign.sha256}:${sign.profileSha256}:${sign.releaseSha256}`)
    .sort()
    .join('|');
}

function phraseRevision(phrases: readonly PublishedPhrase[]): string {
  return phrases
    .map(phrase => `${phrase.id}:${phrase.version}:${phrase.releaseSha256}`)
    .sort()
    .join('|');
}

function searchableSignText(sign: PublishedSign): string {
  return [sign.gloss, ...sign.speechAliases, ...sign.categories]
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-CO');
}

export function filterPublishedSigns(
  signs: readonly PublishedSign[],
  search: string,
): PublishedSign[] {
  const normalizedSearch = search
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-CO');
  if (!normalizedSearch) return [...signs];
  const terms = normalizedSearch.split(/\s+/);
  return signs.filter(sign => {
    const searchable = searchableSignText(sign);
    return terms.every(term => searchable.includes(term));
  });
}

export function mergeSignLanguageStatuses(
  languages: readonly SignLanguage[],
  signs: readonly PublishedSign[],
  state: SignLibraryState,
  phrases: readonly PublishedPhrase[] = [],
): SignLanguageStatus[] {
  const followed = new Set(state.followedLanguageIds);
  return languages.map(language => {
    const languageSigns = signs
      .filter(sign => sign.languageId === language.id)
      .sort((left, right) => left.gloss.localeCompare(right.gloss));
    const remoteIds = new Set(languageSigns.map(sign => sign.id));
    const installed = Object.values(state.installedSigns)
      .filter(sign => sign.languageId === language.id);
    const pendingSigns = languageSigns.filter(sign => {
      const local = state.installedSigns[sign.id];
      // A release may include an unchanged sign at a higher catalog version.
      // Prompt only when its motion, visual profile, or semantic metadata changed.
      return !local
        || local.sha256 !== sign.sha256
        || local.releaseSha256 !== sign.releaseSha256
        // Libraries installed before visual profiles became independently
        // downloadable keep using the equivalent profile bundled in the APK.
        // A future profile edit still increments the sign version and updates it.
        || (local.profileSha256 !== undefined && local.profileSha256 !== sign.profileSha256);
    });
    const removedSigns = installed.filter(sign => !remoteIds.has(sign.id));
    const availableGlosses = new Set(languageSigns.map(sign => sign.gloss));
    // A phrase is only distributable when every ordered sign is currently a
    // public resource of the same language. This closes a publisher mistake
    // without hiding unrelated signs from the library.
    const languagePhrases = phrases
      .filter(phrase => (
        phrase.languageId === language.id
        && phrase.glossSequence.every(gloss => availableGlosses.has(gloss))
      ))
      .sort((left, right) => left.spanish.localeCompare(right.spanish, 'es-CO'));
    const remotePhraseIds = new Set(languagePhrases.map(phrase => phrase.id));
    const installedPhrases = Object.values(state.installedPhrases)
      .filter(phrase => phrase.languageId === language.id);
    const pendingPhrases = languagePhrases.filter(phrase => {
      const local = state.installedPhrases[phrase.id];
      return !local
        || local.version !== phrase.version
        || local.releaseSha256 !== phrase.releaseSha256;
    });
    const removedPhrases = installedPhrases.filter(phrase => !remotePhraseIds.has(phrase.id));
    const revision = `${signRevision(languageSigns)}||${phraseRevision(languagePhrases)}`;
    return {
      ...language,
      signs: languageSigns,
      pendingSigns,
      removedSigns,
      installedSigns: installed,
      phrases: languagePhrases,
      pendingPhrases,
      removedPhrases,
      installedPhrases,
      installedSignCount: installed.length,
      changeCount: pendingSigns.length + removedSigns.length
        + pendingPhrases.length + removedPhrases.length,
      totalSizeBytes: languageSigns.reduce((total, sign) => total + transferSizeBytes(sign), 0),
      pendingSizeBytes: pendingSigns.reduce((total, sign) => total + transferSizeBytes(sign), 0),
      revision,
      followed: followed.has(language.id) || installed.length > 0,
      dismissed: state.dismissedRevisions[language.id] === revision,
      selected: state.selectedLanguageId === language.id,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export function unpromptedSignChangeCount(statuses: readonly SignLanguageStatus[]): number {
  const hasFollowedLanguage = statuses.some(status => status.followed);
  return statuses.reduce((total, status) => (
    status.changeCount > 0
    && !status.dismissed
    && (!hasFollowedLanguage || status.followed)
      ? total + status.changeCount
      : total
  ), 0);
}

function localLibraryStatuses(state: SignLibraryState): SignLanguageStatus[] {
  const languageIds = [...new Set(Object.values(state.installedSigns).map(sign => sign.languageId))];
  return languageIds.map(id => {
    const installedSigns = Object.values(state.installedSigns)
      .filter(sign => sign.languageId === id)
      .sort((left, right) => left.gloss.localeCompare(right.gloss));
    const installedPhrases = Object.values(state.installedPhrases)
      .filter(phrase => phrase.languageId === id)
      .sort((left, right) => left.spanish.localeCompare(right.spanish, 'es-CO'));
    const signs = installedSigns.map(sign => ({
      ...sign,
      motionFormat: sign.motionFormat ?? 'compact-v2',
      profileSha256: sign.profileSha256 ?? '0'.repeat(64),
      releaseSha256: sign.releaseSha256 ?? '0'.repeat(64),
      approved: true,
      compiled: true,
      published: true,
    }));
    const revision = `${signRevision(signs)}||${phraseRevision(installedPhrases.map(phrase => ({
      ...phrase,
      approved: true,
      published: true,
    })))}`;
    return {
      id,
      code: id,
      name: id,
      region: '',
      published: true,
      signs,
      pendingSigns: [],
      removedSigns: [],
      installedSigns,
      phrases: [],
      pendingPhrases: [],
      removedPhrases: [],
      installedPhrases,
      installedSignCount: installedSigns.length,
      changeCount: 0,
      totalSizeBytes: signs.reduce((total, sign) => total + transferSizeBytes(sign), 0),
      pendingSizeBytes: 0,
      revision,
      followed: true,
      dismissed: true,
      selected: state.selectedLanguageId === id,
    } satisfies SignLanguageStatus;
  });
}

function parseVersionedJsonReleaseSign(id: string, releaseId: string, value: unknown): PublishedSign {
  if (!isRecord(value)) throw new Error(`JSON release sign ${id} is not an object.`);
  if (value.motionFormat !== 'legacy-json-v2') {
    throw new Error(`JSON release sign ${id} is not a supported motion JSON.`);
  }
  return parsePublishedSign(id, {...value, jsonReleaseId: releaseId});
}

/** Reads only the versioned JSON-release pointer and its immutable manifest. */
export async function listVersionedJsonReleaseLanguages(): Promise<SignLanguageStatus[]> {
  const database = getFirestore();
  const state = await readLibraryState();
  const languageId = 'lsc-co';
  const pointerSnapshot = await getDoc(doc(database, 'signJsonReleasePointers', languageId));
  if (!pointerSnapshot.exists()) return localLibraryStatuses(state);
  const pointer = pointerSnapshot.data();
  if (pointer.schema !== 'vozual.sign-json-release-pointer'
      || pointer.languageId !== languageId
      || pointer.published !== true
      || typeof pointer.releaseId !== 'string'
      || !SAFE_PATH_SEGMENT.test(pointer.releaseId)
      || !Number.isInteger(pointer.version)
      || (pointer.version as number) < 1) {
    throw new Error('The active JSON sign release pointer is invalid.');
  }
  const releaseSnapshot = await getDoc(doc(database, 'signJsonReleases', pointer.releaseId));
  if (!releaseSnapshot.exists()) throw new Error('The active JSON sign release manifest is missing.');
  const release = releaseSnapshot.data();
  if (release.schema !== 'vozual.sign-json-release'
      || release.releaseId !== pointer.releaseId
      || release.languageId !== languageId
      || release.version !== pointer.version
      || release.published !== true
      || !Array.isArray(release.signs)) {
    throw new Error('The active JSON sign release manifest is invalid.');
  }
  const signs = release.signs.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') {
      throw new Error('The active JSON sign release contains an invalid sign entry.');
    }
    return parseVersionedJsonReleaseSign(entry.id, pointer.releaseId, entry);
  });
  const phrases: PublishedPhrase[] = Array.isArray(release.phrases)
    ? release.phrases.flatMap((entry: unknown) => {
      if (!isRecord(entry) || typeof entry.id !== 'string') return [];
      try {
        return [{
          ...parsePublishedPhrase(entry.id, entry),
          jsonReleaseId: pointer.releaseId as string,
        }];
      } catch {
        return [];
      }
    })
    : [];
  const language: SignLanguage = {
    id: languageId,
    code: typeof release.code === 'string' ? release.code : languageId,
    name: typeof release.name === 'string' ? release.name : 'Lengua de Señas Colombiana',
    region: typeof release.region === 'string' ? release.region : 'Colombia',
    published: true,
  };
  return mergeSignLanguageStatuses([language], signs, state, phrases);
}

export function hasUnpromptedSignChanges(statuses: readonly SignLanguageStatus[]): boolean {
  return unpromptedSignChangeCount(statuses) > 0;
}

export async function listSignLanguages(): Promise<SignLanguageStatus[]> {
  try {
    return await listVersionedJsonReleaseLanguages();
  } catch {
    return localLibraryStatuses(await readLibraryState());
  }
}

/**
 * Legacy global catalogue reads are migration-only. The normal startup route
 * uses ReleaseCatalogueSynchronizer (Task 20), which reads one release pointer
 * and selected immutable fragments rather than all signs and phrases.
 */
export async function listSignLanguagesWithMigration(
  {enableLegacyCatalogMigration}: Readonly<{enableLegacyCatalogMigration: boolean}>,
): Promise<SignLanguageStatus[]> {
  if (!enableLegacyCatalogMigration) {
    const state = await readLibraryState();
    return localLibraryStatuses(state);
  }
  const database = getFirestore();
  const [languageSnapshot, signSnapshot, phraseSnapshot, state] = await Promise.all([
    getDocsFromServer(query(
      collection(database, 'signLanguages'),
      where('published', '==', true),
    )),
    getDocsFromServer(query(
      collection(database, 'signs'),
      where('published', '==', true),
    )),
    getDocsFromServer(query(
      collection(database, 'phrases'),
      where('published', '==', true),
    )),
    readLibraryState(),
  ]);
  const languages = languageSnapshot.docs.map(document => (
    parseSignLanguage(document.id, document.data())
  ));
  // A stale or partially published document must never make the complete
  // catalogue unavailable. Only independently downloadable signs are shown.
  const signs = signSnapshot.docs.flatMap(document => {
    try {
      return [parsePublishedSign(document.id, document.data())];
    } catch {
      return [];
    }
  });
  const phrases = phraseSnapshot.docs.flatMap(document => {
    try {
      return [parsePublishedPhrase(document.id, document.data())];
    } catch {
      return [];
    }
  });
  return mergeSignLanguageStatuses(languages, signs, state, phrases);
}

export async function installedSignsForSelectedLanguage(): Promise<InstalledSign[]> {
  const state = await readLibraryState();
  const installed = Object.values(state.installedSigns);
  const selectedLanguageId = state.selectedLanguageId
    ?? installed[0]?.languageId;
  if (!selectedLanguageId) return [];
  return installed
    .filter(sign => sign.languageId === selectedLanguageId)
    .sort((left, right) => left.gloss.localeCompare(right.gloss));
}

export async function selectedSignLanguageId(): Promise<string | undefined> {
  const state = await readLibraryState();
  return state.selectedLanguageId
    ?? Object.values(state.installedSigns)[0]?.languageId;
}

export async function installedSignGlosses(): Promise<string[]> {
  return (await installedSignsForSelectedLanguage()).map(sign => sign.gloss);
}

export async function installedPhrasesForSelectedLanguage(): Promise<InstalledPhrase[]> {
  const state = await readLibraryState();
  const selectedLanguageId = state.selectedLanguageId
    ?? Object.values(state.installedSigns)[0]?.languageId;
  if (!selectedLanguageId) return [];
  return Object.values(state.installedPhrases)
    .filter(phrase => phrase.languageId === selectedLanguageId)
    .sort((left, right) => left.spanish.localeCompare(right.spanish, 'es-CO'));
}

export async function readInstalledSignMotionBase64(gloss: string): Promise<string | undefined> {
  const payload = await readInstalledSignPayload(gloss);
  return payload?.motionDocument ? undefined : payload?.contentBase64;
}

export type InstalledSignPayload = {
  contentBase64: string;
  motionDocument?: JsonMotionDocument;
  avatarProfile?: Record<string, unknown>;
  storagePath?: string;
  downloadUrl?: string;
  semanticPath?: string;
  profilePath?: string;
};

export async function readInstalledSignPayload(
  gloss: string,
): Promise<InstalledSignPayload | undefined> {
  const normalizedGloss = gloss.trim().toUpperCase();
  if (!normalizedGloss || normalizedGloss === 'IDLE' || normalizedGloss === 'PHRASE_WAIT') {
    return undefined;
  }
  const state = await readLibraryState();
  const selectedLanguageId = state.selectedLanguageId
    ?? Object.values(state.installedSigns)[0]?.languageId;
  const sign = Object.values(state.installedSigns).find(candidate => (
    candidate.languageId === selectedLanguageId
    &&
    candidate.gloss.trim().toUpperCase() === normalizedGloss
  ));
  if (!sign || !await RNFS.exists(sign.localPath)) return undefined;
  if (sign.motionFormat === 'legacy-json-v2') {
    const motionDocument = parseJsonMotionDocument(
      JSON.parse(await RNFS.readFile(sign.localPath, 'utf8')) as unknown,
      sign.assetName,
    );
    return {
      contentBase64: '',
      motionDocument,
      avatarProfile: isRecord(motionDocument.avatarProfile) ? motionDocument.avatarProfile : undefined,
      storagePath: sign.storagePath,
      downloadUrl: sign.downloadUrl,
      semanticPath: sign.semanticPath,
      profilePath: sign.profilePath,
    };
  }
  return {
    contentBase64: await RNFS.readFile(sign.localPath, 'base64'),
    avatarProfile: sign.avatarProfile,
    storagePath: sign.storagePath,
    downloadUrl: sign.downloadUrl,
    semanticPath: sign.semanticPath,
    profilePath: sign.profilePath,
  };
}

export async function hasCompletedSignLanguageSetup(): Promise<boolean> {
  return RNFS.exists(SETUP_COMPLETE_PATH);
}

export async function completeSignLanguageSetup(): Promise<void> {
  await RNFS.mkdir(LIBRARY_ROOT);
  await RNFS.writeFile(SETUP_COMPLETE_PATH, new Date().toISOString(), 'utf8');
}

export async function dismissSignLanguageChanges(
  statuses: readonly SignLanguageStatus[],
): Promise<void> {
  const state = await readLibraryState();
  statuses.forEach(status => {
    if (
      status.signs.length === 0
      && status.phrases.length === 0
      && status.removedSigns.length === 0
      && status.removedPhrases.length === 0
    ) return;
    state.dismissedRevisions[status.id] = status.revision;
  });
  await writeLibraryState(state);
}

export type SignLibraryInstallStage =
  | 'preparing'
  | 'downloading'
  | 'verifying'
  | 'phrases'
  | 'saving';

export type SignLibraryInstallProgress = {
  fraction: number;
  stage: SignLibraryInstallStage;
  currentGloss?: string;
  completedSigns: number;
  totalSigns: number;
};

export async function installSignLanguageChanges(
  status: SignLanguageStatus,
  onProgress?: (fraction: number, detail?: SignLibraryInstallProgress) => void,
  storageAdapter?: FirebaseStorageAdapter,
): Promise<number> {
  if (
    status.pendingSigns.length === 0
    && status.removedSigns.length === 0
    && status.pendingPhrases.length === 0
    && status.removedPhrases.length === 0
  ) return 0;
  const languageDirectory = `${LIBRARY_ROOT}/${status.id}`;
  await RNFS.mkdir(languageDirectory);
  const currentState = await readLibraryState();
  const nextState: SignLibraryState = {
    installedSigns: {...currentState.installedSigns},
    installedPhrases: {...currentState.installedPhrases},
    followedLanguageIds: [...currentState.followedLanguageIds],
    dismissedRevisions: {...currentState.dismissedRevisions},
    selectedLanguageId: currentState.selectedLanguageId,
  };
  let completedBytes = 0;
  const totalBytes = Math.max(1, status.pendingSizeBytes);
  const totalSigns = status.pendingSigns.length;
  const emitProgress = (
    fraction: number,
    stage: SignLibraryInstallStage,
    completedSigns: number,
    currentGloss?: string,
  ) => {
    const clamped = Math.max(0, Math.min(1, fraction));
    onProgress?.(clamped, {
      fraction: clamped,
      stage,
      currentGloss,
      completedSigns,
      totalSigns,
    });
  };
  emitProgress(0, 'preparing', 0);
  const staged: Array<{
    sign: PublishedSign;
    avatarProfile: Record<string, unknown>;
    temporaryPath: string;
    finalPath: string;
  }> = [];
  const temporaryPaths: string[] = [];
  const stagedPhrases: PublishedPhrase[] = [];

  try {
    for (let signIndex = 0; signIndex < status.pendingSigns.length; signIndex += 1) {
      const sign = status.pendingSigns[signIndex];
      emitProgress(completedBytes / totalBytes, 'downloading', signIndex, sign.gloss);
      const finalPath = immutableAssetPath(languageDirectory, sign);
      const temporaryPath = `${finalPath}.download`;
      if (await RNFS.exists(temporaryPath)) await RNFS.unlink(temporaryPath);
      temporaryPaths.push(temporaryPath);
      const assetSnapshot = sign.assetDocumentPath
        ? await getDoc(doc(getFirestore(), sign.assetDocumentPath))
        : undefined;
      if (sign.assetDocumentPath && !assetSnapshot?.exists()) {
        throw new Error(`Sign ${sign.gloss} has no published asset.`);
      }
      const asset = {...sign, ...(assetSnapshot?.data() ?? {})} as Record<string, unknown>;
      const assetReference = asset.storagePath !== undefined || asset.downloadUrl !== undefined
        ? parsePublishedAssetReference(asset)
        : undefined;
      const downloadUrl = assetReference?.downloadUrl;
      const legacyContent = typeof asset.contentBase64 === 'string' && asset.contentBase64.length > 0
        ? asset.contentBase64
        : undefined;
      const hasChunkedJsonSource = sign.motionFormat === 'legacy-json-v2'
        && sign.jsonReleaseId !== undefined
        && sign.jsonChunkCount !== undefined;
      if (
        asset.approved !== true
        || asset.compiled !== true
        || asset.published !== true
        || asset.sha256 !== sign.sha256
        || asset.profileSha256 !== sign.profileSha256
        // The root sign document owns the semantic release digest (including
        // voice aliases). Older immutable motion documents predate that
        // field, so accept a missing asset-level value while still rejecting
        // a present value that disagrees with the signed release metadata.
        || (asset.releaseSha256 !== undefined && asset.releaseSha256 !== sign.releaseSha256)
        || asset.sizeBytes !== sign.sizeBytes
        || (!downloadUrl && !assetReference?.storagePath && !legacyContent && !hasChunkedJsonSource)
        || (sign.motionFormat === 'compact-v2' && !isRecord(asset.avatarProfile))
      ) throw new Error(`Sign ${sign.gloss} has invalid asset metadata.`);
      if (hasChunkedJsonSource) {
        const compressed = sign.jsonCompressedChunkCount !== undefined;
        const chunkCount = compressed ? sign.jsonCompressedChunkCount! : sign.jsonChunkCount!;
        const chunkKind = compressed ? 'compressedChunks' : 'chunks';
        const chunkCollection = `signJsonReleases/${sign.jsonReleaseId}/motions/${sign.id}/${chunkKind}`;
        const chunks = await Promise.all(Array.from({length: chunkCount}, async (_, index) => {
          const chunkId = String(index).padStart(4, '0');
          const chunkSnapshot = await getDoc(doc(getFirestore(), `${chunkCollection}/${chunkId}`));
          if (!chunkSnapshot.exists()) throw new Error(`Sign ${sign.gloss} is missing JSON chunk ${index}.`);
          return chunkSnapshot.data();
        }));
        if (chunks.length !== chunkCount || chunks.some((chunk, index) => (
          chunk.releaseId !== sign.jsonReleaseId
          || chunk.signId !== sign.id
          || chunk.index !== index
          || chunk.count !== chunkCount
          || typeof chunk.contentBase64 !== 'string'
        ))) throw new Error(`Sign ${sign.gloss} has incomplete JSON motion chunks.`);
        const encoded = chunks.map(chunk => chunk.contentBase64).join('');
        if (compressed) {
          const zipped = toByteArray(encoded);
          if (zipped.byteLength !== sign.compressedSizeBytes) {
            throw new Error(`Sign ${sign.gloss} has an invalid compressed size.`);
          }
          await RNFS.writeFile(temporaryPath, fromByteArray(gunzipSync(zipped)), 'base64');
        } else {
          await RNFS.writeFile(temporaryPath, encoded, 'base64');
        }
      } else if (downloadUrl) {
        await RNFS.downloadFile({fromUrl: downloadUrl, toFile: temporaryPath}).promise;
      } else if (assetReference?.storagePath && storageAdapter) {
        await storageAdapter.downloadToFile(assetReference.storagePath, temporaryPath);
      } else if (legacyContent) {
        await RNFS.writeFile(temporaryPath, legacyContent, 'base64');
      } else {
        throw new Error(`Sign ${sign.gloss} has storagePath metadata but no Firebase Storage adapter or legacy content.`);
      }
      const downloadedFraction = Math.min(1, (completedBytes + transferSizeBytes(sign)) / totalBytes);
      emitProgress(downloadedFraction, 'verifying', signIndex, sign.gloss);
      const fileStat = await RNFS.stat(temporaryPath);
      if (fileStat.size !== sign.sizeBytes) {
        throw new Error(`Sign ${sign.gloss} has an invalid downloaded size.`);
      }
      const digest = (await RNFS.hash(temporaryPath, 'sha256')).toLowerCase();
      if (digest !== sign.sha256) throw new Error(`Sign ${sign.gloss} failed its integrity check.`);
      let avatarProfile: Record<string, unknown> | undefined = isRecord(asset.avatarProfile)
        ? asset.avatarProfile
        : undefined;
      if (sign.motionFormat === 'legacy-json-v2') {
        const document = parseJsonMotionDocument(
          JSON.parse(await RNFS.readFile(temporaryPath, 'utf8')) as unknown,
          sign.assetName,
        );
        if (!Number.isInteger(document.fps) || document.fps <= 0
            || !Array.isArray(document.frames) || document.frames.length < 2) {
          throw new Error(`Sign ${sign.gloss} JSON motion has no playable frames.`);
        }
        avatarProfile = isRecord(document.avatarProfile) ? document.avatarProfile : avatarProfile;
      }
      if (!avatarProfile) throw new Error(`Sign ${sign.gloss} has no avatar profile.`);
      staged.push({
        sign: {...sign, ...assetReference},
        avatarProfile,
        temporaryPath,
        finalPath,
      });
      completedBytes += transferSizeBytes(sign);
      emitProgress(completedBytes / totalBytes, 'verifying', staged.length, sign.gloss);
    }

    if (status.pendingPhrases.length > 0) {
      emitProgress(Math.max(0.95, completedBytes / totalBytes), 'phrases', totalSigns);
    }

    // Validate against the resulting local library, rather than merely the
    // remote catalogue. A phrase-only update must not become usable on a
    // device that is missing one of its component signs.
    const downloadableGlosses = new Set(Object.values(currentState.installedSigns)
      .filter(sign => sign.languageId === status.id)
      .map(sign => sign.gloss));
    for (const item of staged) downloadableGlosses.add(item.sign.gloss);
    for (const sign of status.removedSigns) downloadableGlosses.delete(sign.gloss);
    for (const phrase of status.pendingPhrases) {
      let publishedPhrase: PublishedPhrase;
      if (phrase.jsonReleaseId) {
        publishedPhrase = phrase;
      } else {
        const phraseSnapshot = await getDoc(doc(getFirestore(), `phrases/${phrase.id}`));
        if (!phraseSnapshot.exists()) throw new Error(`Phrase ${phrase.spanish} is no longer published.`);
        publishedPhrase = parsePublishedPhrase(phrase.id, phraseSnapshot.data());
      }
      if (
        publishedPhrase.languageId !== status.id
        || publishedPhrase.version !== phrase.version
        || publishedPhrase.releaseSha256 !== phrase.releaseSha256
        || !publishedPhrase.glossSequence.every(gloss => downloadableGlosses.has(gloss))
      ) throw new Error(`Phrase ${phrase.spanish} has invalid published metadata.`);
      stagedPhrases.push(publishedPhrase);
    }

    for (const item of staged) {
      if (await RNFS.exists(item.finalPath)) await RNFS.unlink(item.finalPath);
      await RNFS.moveFile(item.temporaryPath, item.finalPath);
      nextState.installedSigns[item.sign.id] = {
        id: item.sign.id,
        languageId: item.sign.languageId,
        gloss: item.sign.gloss,
        version: item.sign.version,
        assetName: item.sign.assetName,
        sizeBytes: item.sign.sizeBytes,
        sha256: item.sign.sha256,
        profileSha256: item.sign.profileSha256,
        releaseSha256: item.sign.releaseSha256,
        storagePath: item.sign.storagePath,
        downloadUrl: item.sign.downloadUrl,
        semanticPath: item.sign.semanticPath,
        profilePath: item.sign.profilePath,
        avatarProfile: item.avatarProfile,
        speechAliases: item.sign.speechAliases,
        categories: item.sign.categories,
        lexicalClass: item.sign.lexicalClass,
        verbType: item.sign.verbType,
        requiresSubjectMarker: item.sign.requiresSubjectMarker,
        motionFormat: item.sign.motionFormat,
        installedAt: new Date().toISOString(),
        localPath: item.finalPath,
      };
    }

    for (const sign of status.removedSigns) delete nextState.installedSigns[sign.id];
    for (const phrase of stagedPhrases) {
      nextState.installedPhrases[phrase.id] = {
        id: phrase.id,
        languageId: phrase.languageId,
        version: phrase.version,
        spanish: phrase.spanish,
        glossSequence: phrase.glossSequence,
        releaseSha256: phrase.releaseSha256,
        installedAt: new Date().toISOString(),
      };
    }
    for (const phrase of status.removedPhrases) delete nextState.installedPhrases[phrase.id];
    if (!nextState.followedLanguageIds.includes(status.id)) {
      nextState.followedLanguageIds.push(status.id);
    }
    nextState.selectedLanguageId = status.id;
    const appliedChangeCount = status.pendingSigns.length
      + status.removedSigns.length
      + status.pendingPhrases.length
      + status.removedPhrases.length;
    if (appliedChangeCount >= status.changeCount) {
      nextState.dismissedRevisions[status.id] = status.revision;
    }
    emitProgress(0.99, 'saving', totalSigns);
    await writeLibraryState(nextState);
    emitProgress(1, 'saving', totalSigns);
  } catch (error) {
    for (const temporaryPath of temporaryPaths) await bestEffortDelete(temporaryPath);
    for (const item of staged) {
      if (item.finalPath !== currentState.installedSigns[item.sign.id]?.localPath) {
        await bestEffortDelete(item.finalPath);
      }
    }
    throw error;
  }

  const obsoletePaths = [
    ...staged.map(item => currentState.installedSigns[item.sign.id]?.localPath),
    ...status.removedSigns.map(sign => sign.localPath),
  ].filter((path): path is string => Boolean(path) && !Object.values(nextState.installedSigns).some(
    sign => sign.localPath === path,
  ));
  for (const path of obsoletePaths) await bestEffortDelete(path);
  await completeSignLanguageSetup();
  return status.changeCount;
}

export async function selectSignLanguage(languageId: string): Promise<void> {
  const state = await readLibraryState();
  const hasInstalledSigns = Object.values(state.installedSigns).some(sign => (
    sign.languageId === languageId
  ));
  if (!hasInstalledSigns) throw new Error('The selected sign language is not installed.');
  state.selectedLanguageId = languageId;
  if (!state.followedLanguageIds.includes(languageId)) state.followedLanguageIds.push(languageId);
  await writeLibraryState(state);
}

export async function removeSignLanguage(languageId: string): Promise<void> {
  const currentState = await readLibraryState();
  const nextState: SignLibraryState = {
    installedSigns: {...currentState.installedSigns},
    installedPhrases: {...currentState.installedPhrases},
    followedLanguageIds: currentState.followedLanguageIds.filter(id => id !== languageId),
    dismissedRevisions: {...currentState.dismissedRevisions},
    selectedLanguageId: currentState.selectedLanguageId,
  };
  const installed = Object.values(currentState.installedSigns)
    .filter(sign => sign.languageId === languageId);
  const installedPhrases = Object.values(currentState.installedPhrases)
    .filter(phrase => phrase.languageId === languageId);
  for (const sign of installed) delete nextState.installedSigns[sign.id];
  for (const phrase of installedPhrases) delete nextState.installedPhrases[phrase.id];
  delete nextState.dismissedRevisions[languageId];
  if (nextState.selectedLanguageId === languageId) {
    nextState.selectedLanguageId = Object.values(nextState.installedSigns)[0]?.languageId;
  }
  await writeLibraryState(nextState);
  for (const sign of installed) await bestEffortDelete(sign.localPath);
}
