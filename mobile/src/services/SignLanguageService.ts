import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  where,
} from '@react-native-firebase/firestore';
import RNFS from 'react-native-fs';

const LIBRARY_ROOT = `${RNFS.DocumentDirectoryPath}/vozual-sign-languages`;
const LIBRARY_STATE_PATH = `${LIBRARY_ROOT}/library.json`;
const SETUP_COMPLETE_PATH = `${LIBRARY_ROOT}/setup-complete`;

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
  profileSha256?: string;
  avatarProfile?: Record<string, unknown>;
  installedAt: string;
  localPath: string;
};

export type SignLanguageStatus = SignLanguage & {
  signs: PublishedSign[];
  pendingSigns: PublishedSign[];
  removedSigns: InstalledSign[];
  installedSigns: InstalledSign[];
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
  followedLanguageIds: string[];
  dismissedRevisions: Record<string, string>;
  selectedLanguageId?: string;
};

const EMPTY_LIBRARY_STATE: SignLibraryState = {
  installedSigns: {},
  followedLanguageIds: [],
  dismissedRevisions: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
  const assetDocumentPath = requiredString(data.assetDocumentPath, 'assetDocumentPath');
  if (!assetDocumentPath.startsWith(`signs/${id}/versions/`)) {
    throw new Error(`Sign ${id} has an invalid asset document path.`);
  }
  const sha256 = requiredString(data.sha256, 'sha256').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`Sign ${id} has an invalid SHA-256.`);
  }
  const profileSha256 = requiredString(data.profileSha256, 'profileSha256').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(profileSha256)) {
    throw new Error(`Sign ${id} has an invalid profile SHA-256.`);
  }
  if (data.approved !== true || data.compiled !== true || data.published !== true) {
    throw new Error(`Sign ${id} is not approved, compiled, and published.`);
  }
  return {
    id,
    languageId: requiredString(data.languageId, 'languageId'),
    gloss: requiredString(data.gloss, 'gloss').toUpperCase(),
    version: positiveInteger(data.version, 'version'),
    assetName: requiredString(data.assetName, 'assetName'),
    sizeBytes: positiveInteger(data.sizeBytes, 'sizeBytes'),
    assetDocumentPath,
    sha256,
    profileSha256,
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

function normalizeState(value: unknown): SignLibraryState {
  if (!isRecord(value)) return {...EMPTY_LIBRARY_STATE};
  return {
    installedSigns: isRecord(value.installedSigns)
      ? value.installedSigns as Record<string, InstalledSign>
      : {},
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
  try {
    return normalizeState(JSON.parse(await RNFS.readFile(LIBRARY_STATE_PATH, 'utf8')) as unknown);
  } catch {
    return {...EMPTY_LIBRARY_STATE};
  }
}

async function writeLibraryState(state: SignLibraryState): Promise<void> {
  await RNFS.mkdir(LIBRARY_ROOT);
  const temporaryPath = `${LIBRARY_STATE_PATH}.download`;
  await RNFS.writeFile(temporaryPath, JSON.stringify(state), 'utf8');
  if (await RNFS.exists(LIBRARY_STATE_PATH)) await RNFS.unlink(LIBRARY_STATE_PATH);
  await RNFS.moveFile(temporaryPath, LIBRARY_STATE_PATH);
}

function signRevision(signs: readonly PublishedSign[]): string {
  return signs
    .map(sign => `${sign.id}:${sign.version}:${sign.sha256}:${sign.profileSha256}`)
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
        // Libraries installed before visual profiles became independently
        // downloadable keep using the equivalent profile bundled in the APK.
        // A future profile edit still increments the sign version and updates it.
        || (local.profileSha256 !== undefined && local.profileSha256 !== sign.profileSha256);
    });
    const removedSigns = installed.filter(sign => !remoteIds.has(sign.id));
    const revision = signRevision(languageSigns);
    return {
      ...language,
      signs: languageSigns,
      pendingSigns,
      removedSigns,
      installedSigns: installed,
      installedSignCount: installed.length,
      changeCount: pendingSigns.length + removedSigns.length,
      totalSizeBytes: languageSigns.reduce((total, sign) => total + sign.sizeBytes, 0),
      pendingSizeBytes: pendingSigns.reduce((total, sign) => total + sign.sizeBytes, 0),
      revision,
      followed: followed.has(language.id) || installed.length > 0,
      dismissed: state.dismissedRevisions[language.id] === revision,
      selected: state.selectedLanguageId === language.id,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export function hasUnpromptedSignChanges(statuses: readonly SignLanguageStatus[]): boolean {
  const hasFollowedLanguage = statuses.some(status => status.followed);
  return statuses.some(status => (
    status.changeCount > 0
    && !status.dismissed
    && (!hasFollowedLanguage || status.followed)
  ));
}

export async function listSignLanguages(): Promise<SignLanguageStatus[]> {
  const database = getFirestore();
  const [languageSnapshot, signSnapshot, state] = await Promise.all([
    getDocs(query(
      collection(database, 'signLanguages'),
      where('published', '==', true),
    )),
    getDocs(query(
      collection(database, 'signs'),
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
  return mergeSignLanguageStatuses(languages, signs, state);
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

export async function installedSignGlosses(): Promise<string[]> {
  return (await installedSignsForSelectedLanguage()).map(sign => sign.gloss);
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
    if (status.signs.length === 0 && status.removedSigns.length === 0) return;
    state.dismissedRevisions[status.id] = status.revision;
  });
  await writeLibraryState(state);
}

export async function installSignLanguageChanges(
  status: SignLanguageStatus,
  onProgress?: (fraction: number) => void,
): Promise<number> {
  if (status.pendingSigns.length === 0 && status.removedSigns.length === 0) return 0;
  const languageDirectory = `${LIBRARY_ROOT}/${status.id}`;
  await RNFS.mkdir(languageDirectory);
  const state = await readLibraryState();
  let completedBytes = 0;
  const totalBytes = Math.max(1, status.pendingSizeBytes);

  for (const sign of status.pendingSigns) {
    const finalPath = `${languageDirectory}/${sign.assetName}`;
    const temporaryPath = `${finalPath}.download`;
    if (await RNFS.exists(temporaryPath)) await RNFS.unlink(temporaryPath);
    try {
      const assetSnapshot = await getDoc(doc(getFirestore(), sign.assetDocumentPath));
      if (!assetSnapshot.exists()) throw new Error(`Sign ${sign.gloss} has no published asset.`);
      const asset = assetSnapshot.data();
      if (
        asset.approved !== true
        || asset.compiled !== true
        || asset.published !== true
        || asset.sha256 !== sign.sha256
        || asset.profileSha256 !== sign.profileSha256
        || asset.sizeBytes !== sign.sizeBytes
        || typeof asset.contentBase64 !== 'string'
        || !isRecord(asset.avatarProfile)
      ) throw new Error(`Sign ${sign.gloss} has invalid asset metadata.`);
      await RNFS.writeFile(temporaryPath, asset.contentBase64, 'base64');
      onProgress?.(Math.min(1, (completedBytes + sign.sizeBytes) / totalBytes));
      const digest = (await RNFS.hash(temporaryPath, 'sha256')).toLowerCase();
      if (digest !== sign.sha256) throw new Error(`Sign ${sign.gloss} failed its integrity check.`);
      if (await RNFS.exists(finalPath)) await RNFS.unlink(finalPath);
      await RNFS.moveFile(temporaryPath, finalPath);
      state.installedSigns[sign.id] = {
        id: sign.id,
        languageId: sign.languageId,
        gloss: sign.gloss,
        version: sign.version,
        assetName: sign.assetName,
        sizeBytes: sign.sizeBytes,
        sha256: sign.sha256,
        profileSha256: sign.profileSha256,
        avatarProfile: asset.avatarProfile,
        speechAliases: sign.speechAliases,
        categories: sign.categories,
        lexicalClass: sign.lexicalClass,
        verbType: sign.verbType,
        requiresSubjectMarker: sign.requiresSubjectMarker,
        installedAt: new Date().toISOString(),
        localPath: finalPath,
      };
      completedBytes += sign.sizeBytes;
      onProgress?.(Math.min(1, completedBytes / totalBytes));
    } catch (error) {
      if (await RNFS.exists(temporaryPath)) await RNFS.unlink(temporaryPath);
      throw error;
    }
  }

  for (const sign of status.removedSigns) {
    if (await RNFS.exists(sign.localPath)) await RNFS.unlink(sign.localPath);
    delete state.installedSigns[sign.id];
  }
  if (!state.followedLanguageIds.includes(status.id)) state.followedLanguageIds.push(status.id);
  state.selectedLanguageId = status.id;
  state.dismissedRevisions[status.id] = status.revision;
  await writeLibraryState(state);
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
  const state = await readLibraryState();
  const installed = Object.values(state.installedSigns)
    .filter(sign => sign.languageId === languageId);
  for (const sign of installed) {
    if (await RNFS.exists(sign.localPath)) await RNFS.unlink(sign.localPath);
    delete state.installedSigns[sign.id];
  }
  state.followedLanguageIds = state.followedLanguageIds.filter(id => id !== languageId);
  delete state.dismissedRevisions[languageId];
  if (state.selectedLanguageId === languageId) {
    state.selectedLanguageId = Object.values(state.installedSigns)[0]?.languageId;
  }
  await writeLibraryState(state);
}
