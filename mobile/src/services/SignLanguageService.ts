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
  assetDocumentPath: string;
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
  approved: boolean;
  compiled: boolean;
  published: boolean;
  updatedAt?: unknown;
};

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
  | 'sha256'
  | 'speechAliases'
  | 'categories'
  | 'lexicalClass'
  | 'verbType'
  | 'requiresSubjectMarker'
> & {
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
  const assetDocumentPath = requiredString(data.assetDocumentPath, 'assetDocumentPath');
  if (!assetDocumentPath.startsWith(`signs/${id}/versions/`)) {
    throw new Error(`Sign ${id} has an invalid asset document path.`);
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
    sha256,
    profileSha256,
    releaseSha256: sha256Digest(data.releaseSha256, 'releaseSha256'),
    speechAliases: stringArray(data.speechAliases, 'speechAliases'),
    categories: stringArray(data.categories, 'categories'),
    lexicalClass: requiredString(data.lexicalClass, 'lexicalClass'),
    verbType: verbType(data.verbType),
    requiresSubjectMarker: data.requiresSubjectMarker === true,
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
      return !local
        || local.version !== sign.version
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
      totalSizeBytes: languageSigns.reduce((total, sign) => total + sign.sizeBytes, 0),
      pendingSizeBytes: pendingSigns.reduce((total, sign) => total + sign.sizeBytes, 0),
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

export function hasUnpromptedSignChanges(statuses: readonly SignLanguageStatus[]): boolean {
  return unpromptedSignChangeCount(statuses) > 0;
}

export async function listSignLanguages(): Promise<SignLanguageStatus[]> {
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
  return (await readInstalledSignPayload(gloss))?.contentBase64;
}

export type InstalledSignPayload = {
  contentBase64: string;
  avatarProfile?: Record<string, unknown>;
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
  return {
    contentBase64: await RNFS.readFile(sign.localPath, 'base64'),
    avatarProfile: sign.avatarProfile,
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

export async function installSignLanguageChanges(
  status: SignLanguageStatus,
  onProgress?: (fraction: number) => void,
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
  const staged: Array<{
    sign: PublishedSign;
    avatarProfile: Record<string, unknown>;
    temporaryPath: string;
    finalPath: string;
  }> = [];
  const temporaryPaths: string[] = [];
  const stagedPhrases: PublishedPhrase[] = [];

  try {
    for (const sign of status.pendingSigns) {
      const finalPath = immutableAssetPath(languageDirectory, sign);
      const temporaryPath = `${finalPath}.download`;
      if (await RNFS.exists(temporaryPath)) await RNFS.unlink(temporaryPath);
      temporaryPaths.push(temporaryPath);
      const assetSnapshot = await getDoc(doc(getFirestore(), sign.assetDocumentPath));
      if (!assetSnapshot.exists()) throw new Error(`Sign ${sign.gloss} has no published asset.`);
      const asset = assetSnapshot.data();
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
        || typeof asset.contentBase64 !== 'string'
        || !isRecord(asset.avatarProfile)
      ) throw new Error(`Sign ${sign.gloss} has invalid asset metadata.`);
      await RNFS.writeFile(temporaryPath, asset.contentBase64, 'base64');
      onProgress?.(Math.min(1, (completedBytes + sign.sizeBytes) / totalBytes));
      const digest = (await RNFS.hash(temporaryPath, 'sha256')).toLowerCase();
      if (digest !== sign.sha256) throw new Error(`Sign ${sign.gloss} failed its integrity check.`);
      staged.push({sign, avatarProfile: asset.avatarProfile, temporaryPath, finalPath});
      completedBytes += sign.sizeBytes;
      onProgress?.(Math.min(1, completedBytes / totalBytes));
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
      const phraseSnapshot = await getDoc(doc(getFirestore(), `phrases/${phrase.id}`));
      if (!phraseSnapshot.exists()) throw new Error(`Phrase ${phrase.spanish} is no longer published.`);
      const publishedPhrase = parsePublishedPhrase(phrase.id, phraseSnapshot.data());
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
        avatarProfile: item.avatarProfile,
        speechAliases: item.sign.speechAliases,
        categories: item.sign.categories,
        lexicalClass: item.sign.lexicalClass,
        verbType: item.sign.verbType,
        requiresSubjectMarker: item.sign.requiresSubjectMarker,
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
    nextState.dismissedRevisions[status.id] = status.revision;
    await writeLibraryState(nextState);
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
