import catalogJson from '../../assets/data/lsc_phrase_asset_catalog.json';
import {normalizeSpeech, type SpeechSign} from './VoiceCommandService';

export type LscPhraseEntryStatus =
  | 'candidate'
  | 'in_review'
  | 'active'
  | 'rejected'
  | 'withdrawn';

type EvidenceStatus = 'pending' | 'verified' | 'rejected' | 'withdrawn';
type ConsentStatus = 'pending' | 'granted' | 'denied' | 'withdrawn';
type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type LscPhraseAssetEntry = {
  id: string;
  status: LscPhraseEntryStatus;
  spanish: {
    variants: string[];
    intendedMeaning: string;
  };
  lsc: {
    glossSequence: string[];
    regionalVariant: string;
  };
  clips: Array<{
    id: string;
    sha256: string;
  }>;
  licence: {
    status: EvidenceStatus;
    recordId: string | null;
  };
  performerConsent: {
    status: ConsentStatus;
    recordId: string | null;
    version: string | null;
  };
  review: {
    status: ReviewStatus;
    reviewerId: string | null;
    version: string | null;
    reviewedAt: string | null;
  };
};

export type LscPhraseAssetCatalog = {
  schemaVersion: 1;
  catalogVersion: string;
  language: 'lsc-CO';
  unsupportedOutcome: {
    title: string;
    message: string;
    retryLabel: string;
  };
  entries: LscPhraseAssetEntry[];
};

export type InstalledLscAsset = {
  id: string;
  gloss: string;
  sha256: string;
};

export type CatalogValidationResult =
  | {valid: true; activeEntries: LscPhraseAssetEntry[]}
  | {valid: false; errors: string[]; activeEntries: []};

export type LscPhraseResolution =
  | {status: 'matched'; entry: LscPhraseAssetEntry}
  | {
    status: 'ambiguous';
    candidates: Array<Pick<LscPhraseAssetEntry, 'id'> & {intendedMeaning: string}>;
    message: string;
  }
  | {
    status: 'unsupported';
    title: string;
    message: string;
    retryLabel: string;
  };

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ENTRY_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const ENTRY_STATUSES: readonly LscPhraseEntryStatus[] = [
  'candidate', 'in_review', 'active', 'rejected', 'withdrawn',
];
const LICENCE_STATUSES: readonly EvidenceStatus[] = [
  'pending', 'verified', 'rejected', 'withdrawn',
];
const CONSENT_STATUSES: readonly ConsentStatus[] = [
  'pending', 'granted', 'denied', 'withdrawn',
];
const REVIEW_STATUSES: readonly ReviewStatus[] = [
  'pending', 'approved', 'rejected', 'expired',
];
const SAFE_UNSUPPORTED_OUTCOME = {
  title: 'Frase no disponible',
  message: 'Esta frase todavía no tiene una interpretación en LSC revisada. Puedes intentar otra frase del catálogo.',
  retryLabel: 'Intentar otra frase',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(hasText);
}

function validReviewedAt(value: unknown): value is string {
  return hasText(value) && !Number.isNaN(Date.parse(value));
}

function entryErrors(value: unknown, index: number): string[] {
  if (!isRecord(value)) return [`Entry ${index + 1} must be an object.`];

  const id = hasText(value.id) ? value.id : `at index ${index}`;
  const prefix = `Entry ${id}`;
  const errors: string[] = [];
  const status = value.status;
  const spanish = value.spanish;
  const lsc = value.lsc;
  const clips = value.clips;
  const licence = value.licence;
  const consent = value.performerConsent;
  const review = value.review;

  if (!hasText(value.id) || !ENTRY_ID_PATTERN.test(value.id)) {
    errors.push(`${prefix} has an invalid ID.`);
  }
  if (!ENTRY_STATUSES.includes(status as LscPhraseEntryStatus)) {
    errors.push(`${prefix} has an invalid status.`);
  }
  if (
    !isRecord(spanish)
    || !stringList(spanish.variants)
    || spanish.variants.length === 0
    || !hasText(spanish.intendedMeaning)
  ) {
    errors.push(`${prefix} has incomplete Spanish semantic metadata.`);
  }
  if (
    !isRecord(lsc)
    || !Array.isArray(lsc.glossSequence)
    || !lsc.glossSequence.every(hasText)
    || typeof lsc.regionalVariant !== 'string'
  ) {
    errors.push(`${prefix} has invalid LSC metadata.`);
  }
  if (!Array.isArray(clips)) {
    errors.push(`${prefix} has no ordered avatar clip list.`);
  } else {
    clips.forEach((clip, clipIndex) => {
      if (
        !isRecord(clip)
        || !hasText(clip.id)
        || !hasText(clip.sha256)
        || !SHA256_PATTERN.test(clip.sha256)
      ) {
        errors.push(`${prefix} clip ${clipIndex + 1} has invalid identity or checksum evidence.`);
      }
    });
  }
  if (
    !isRecord(licence)
    || !LICENCE_STATUSES.includes(licence.status as EvidenceStatus)
    || !(licence.recordId === null || typeof licence.recordId === 'string')
  ) {
    errors.push(`${prefix} has invalid licence metadata.`);
  }
  if (
    !isRecord(consent)
    || !CONSENT_STATUSES.includes(consent.status as ConsentStatus)
    || !(consent.recordId === null || typeof consent.recordId === 'string')
    || !(consent.version === null || typeof consent.version === 'string')
  ) {
    errors.push(`${prefix} has invalid performer consent metadata.`);
  }
  if (
    !isRecord(review)
    || !REVIEW_STATUSES.includes(review.status as ReviewStatus)
    || !(review.reviewerId === null || typeof review.reviewerId === 'string')
    || !(review.version === null || typeof review.version === 'string')
    || !(review.reviewedAt === null || typeof review.reviewedAt === 'string')
  ) {
    errors.push(`${prefix} has invalid reviewer metadata.`);
  }

  if (status !== 'active') return errors;

  if (!isRecord(lsc) || !stringList(lsc.glossSequence) || lsc.glossSequence.length === 0) {
    errors.push(`${prefix} has no reviewed LSC gloss sequence.`);
  }
  if (!isRecord(lsc) || !hasText(lsc.regionalVariant)) {
    errors.push(`${prefix} has no reviewed LSC regional variant.`);
  }
  if (!Array.isArray(clips) || clips.length === 0) {
    errors.push(`${prefix} has no ordered avatar clips.`);
  }
  if (
    Array.isArray(clips)
    && isRecord(lsc)
    && Array.isArray(lsc.glossSequence)
    && clips.length !== lsc.glossSequence.length
  ) {
    errors.push(`${prefix} must map each LSC gloss to exactly one ordered clip.`);
  }
  if (!isRecord(licence) || licence.status !== 'verified' || !hasText(licence.recordId)) {
    errors.push(`${prefix} has no verified licence record.`);
  }
  if (
    !isRecord(consent)
    || consent.status !== 'granted'
    || !hasText(consent.recordId)
    || !hasText(consent.version)
  ) {
    errors.push(`${prefix} has no current performer consent record.`);
  }
  if (
    !isRecord(review)
    || review.status !== 'approved'
    || !hasText(review.reviewerId)
    || !hasText(review.version)
    || !validReviewedAt(review.reviewedAt)
  ) {
    errors.push(`${prefix} has no complete LSC reviewer approval.`);
  }
  return errors;
}

/**
 * Validates the runtime trust boundary. Draft records may carry pending
 * evidence, but every field must have the schema shape and an active phrase
 * must pass all linguistic, asset, rights, consent, and review gates. A single
 * invalid record closes the complete catalogue.
 */
export function validateLscPhraseAssetCatalog(
  catalog: unknown,
): CatalogValidationResult {
  if (!isRecord(catalog)) {
    return {valid: false, errors: ['The LSC asset catalog must be an object.'], activeEntries: []};
  }

  const errors: string[] = [];
  if (catalog.schemaVersion !== 1) errors.push('Unsupported catalog schema version.');
  if (!hasText(catalog.catalogVersion)) errors.push('Catalog version is required.');
  if (catalog.language !== 'lsc-CO') errors.push('Catalog language must be lsc-CO.');
  if (
    !isRecord(catalog.unsupportedOutcome)
    || !hasText(catalog.unsupportedOutcome.title)
    || !hasText(catalog.unsupportedOutcome.message)
    || !hasText(catalog.unsupportedOutcome.retryLabel)
  ) {
    errors.push('A complete unsupported-phrase outcome is required.');
  }
  if (!Array.isArray(catalog.entries)) {
    errors.push('Catalog entries must be an array.');
  } else {
    const ids = new Set<string>();
    catalog.entries.forEach((entry, index) => {
      errors.push(...entryErrors(entry, index));
      if (!isRecord(entry) || !hasText(entry.id)) return;
      if (ids.has(entry.id)) errors.push(`Duplicate entry ID: ${entry.id}.`);
      ids.add(entry.id);
    });
  }

  if (errors.length > 0 || !Array.isArray(catalog.entries)) {
    return {valid: false, errors, activeEntries: []};
  }
  return {
    valid: true,
    activeEntries: catalog.entries.filter(
      (entry): entry is LscPhraseAssetEntry => isRecord(entry) && entry.status === 'active',
    ) as LscPhraseAssetEntry[],
  };
}

function unsupported(catalog: unknown, message?: string): LscPhraseResolution {
  const configured = isRecord(catalog)
    && isRecord(catalog.unsupportedOutcome)
    && hasText(catalog.unsupportedOutcome.title)
    && hasText(catalog.unsupportedOutcome.message)
    && hasText(catalog.unsupportedOutcome.retryLabel)
    ? catalog.unsupportedOutcome as LscPhraseAssetCatalog['unsupportedOutcome']
    : SAFE_UNSUPPORTED_OUTCOME;
  return {status: 'unsupported', ...configured, ...(message ? {message} : {})};
}

/** Resolves one confirmed Spanish phrase without composing or approximating signs. */
export function resolveReviewedLscPhrase(
  text: string,
  catalog: unknown = catalogJson,
  selectedEntryId?: string,
): LscPhraseResolution {
  const validation = validateLscPhraseAssetCatalog(catalog);
  if (!validation.valid) return unsupported(catalog);

  const normalizedText = normalizeSpeech(text);
  if (!normalizedText) return unsupported(catalog);
  const matches = validation.activeEntries.filter(entry => entry.spanish.variants.some(
    variant => normalizeSpeech(variant) === normalizedText,
  ));
  if (matches.length === 0) return unsupported(catalog);
  if (matches.length > 1) {
    const selected = selectedEntryId
      ? matches.find(entry => entry.id === selectedEntryId)
      : undefined;
    if (selected) return {status: 'matched', entry: selected};
    return {
      status: 'ambiguous',
      candidates: matches.map(entry => ({
        id: entry.id,
        intendedMeaning: entry.spanish.intendedMeaning,
      })),
      message: 'Esta frase puede tener más de un significado en LSC. Elige una opción del catálogo.',
    };
  }
  return {status: 'matched', entry: matches[0]};
}

function installedAssetsById(assets: readonly InstalledLscAsset[]): Map<string, InstalledLscAsset> {
  return new Map(assets.map(asset => [asset.id, asset]));
}

function hasEveryInstalledAsset(
  entry: LscPhraseAssetEntry,
  assets: ReadonlyMap<string, InstalledLscAsset>,
): boolean {
  return entry.clips.every((clip, index) => {
    const installed = assets.get(clip.id);
    return installed?.sha256.toLowerCase() === clip.sha256
      && normalizeSpeech(installed.gloss) === normalizeSpeech(entry.lsc.glossSequence[index]);
  });
}

/** Resolves only phrases whose reviewed, checksummed clips are installed. */
export function resolvePlayableLscPhrase(
  text: string,
  installedAssets: readonly InstalledLscAsset[],
  catalog: unknown = catalogJson,
  selectedEntryId?: string,
): LscPhraseResolution {
  const resolution = resolveReviewedLscPhrase(text, catalog, selectedEntryId);
  if (resolution.status !== 'matched') return resolution;
  if (!hasEveryInstalledAsset(resolution.entry, installedAssetsById(installedAssets))) {
    return unsupported(
      catalog,
      'La interpretación revisada existe, pero sus recursos todavía no están instalados o no superaron la verificación de integridad.',
    );
  }
  return resolution;
}

/** Vocabulary exposed to speech recognition is limited to playable phrases. */
export function playableLscPhraseVocabulary(
  installedAssets: readonly InstalledLscAsset[],
  catalog: unknown = catalogJson,
): SpeechSign[] {
  const validation = validateLscPhraseAssetCatalog(catalog);
  if (!validation.valid) return [];
  const assets = installedAssetsById(installedAssets);
  return validation.activeEntries.filter(entry => hasEveryInstalledAsset(entry, assets)).map(entry => ({
    gloss: entry.spanish.variants[0],
    aliases: entry.spanish.variants.slice(1),
  }));
}

export function playableLscPhraseSuggestions(
  installedAssets: readonly InstalledLscAsset[],
  catalog: unknown = catalogJson,
): string[] {
  const validation = validateLscPhraseAssetCatalog(catalog);
  if (!validation.valid) return [];
  const assets = installedAssetsById(installedAssets);
  return validation.activeEntries
    .filter(entry => hasEveryInstalledAsset(entry, assets))
    .map(entry => entry.spanish.variants[0]);
}

export const LSC_PHRASE_ASSET_CATALOG = catalogJson as LscPhraseAssetCatalog;
