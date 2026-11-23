'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {compileMotion, motionAssetName} = require('./compact-sign-motion');
const {storagePaths} = require('./storage-asset-contract');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const LANGUAGE_ID = 'lsc-co';
const APPROVED_PATH = path.join(MOBILE_ROOT, 'assets/motions/published_signs.json');
const CATALOG_PATH = path.join(MOBILE_ROOT, 'assets/data/lsc_linguistic_catalog.json');
// Authoring input only. It is consumed by this publishing tool and is not
// imported by the mobile runtime, so phrase suggestions are not baked into
// an APK.
const PHRASE_SOURCE_PATH = path.join(MOBILE_ROOT, 'assets/data/lsc_recommended_phrases.json');
const MOTION_SOURCE_DIR = path.join(MOBILE_ROOT, 'assets/motions');
const PROFILE_OVERRIDES_PATH = path.join(MOTION_SOURCE_DIR, 'avatar_profile_overrides.json');
const BUNDLED_PROFILES_PATH = path.join(
  MOBILE_ROOT,
  'android/app/src/main/assets/avatar/motions/avatar_profiles.json',
);
const OUTPUT_DIR = path.join(MOBILE_ROOT, 'build/published-signs', LANGUAGE_ID);

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function readJsonIfPresent(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function serializedProfile(profile) {
  return JSON.stringify(profile ?? {});
}

function signReleaseDescriptor(data) {
  return {
    sha256: String(data?.sha256 ?? ''),
    profileSha256: String(data?.profileSha256 ?? ''),
    speechAliases: Array.isArray(data?.speechAliases) ? data.speechAliases.map(String) : [],
    categories: Array.isArray(data?.categories) ? data.categories.map(String) : [],
    lexicalClass: String(data?.lexicalClass ?? ''),
    verbType: String(data?.verbType ?? ''),
    requiresSubjectMarker: data?.requiresSubjectMarker === true,
  };
}

function signReleaseSha256(data) {
  return sha256(Buffer.from(JSON.stringify(signReleaseDescriptor(data)), 'utf8'));
}

function phraseReleaseDescriptor(data) {
  return {
    languageId: String(data?.languageId ?? ''),
    spanish: String(data?.spanish ?? '').trim(),
    glossSequence: Array.isArray(data?.glossSequence)
      ? data.glossSequence.map(gloss => String(gloss).trim().toLocaleUpperCase('es-CO'))
      : [],
  };
}

function phraseReleaseSha256(data) {
  return sha256(Buffer.from(JSON.stringify(phraseReleaseDescriptor(data)), 'utf8'));
}

function approvedCatalogEntry(entries, gloss) {
  return entries.find(entry => (
    entry.motion?.clip === gloss
    && entry.motion?.published === true
    && entry.review?.status !== 'blocked'
    && entry.review?.ownerApproval?.status === 'approved'
  ));
}

function speechAliases(entry) {
  return Array.from(new Set([
    entry.gloss,
    ...(entry.spanish?.lemmas ?? []),
    ...(entry.spanish?.synonyms ?? []),
    ...(entry.spanish?.forms ?? []).map(form => form.text),
  ].map(value => String(value).trim()).filter(Boolean)));
}

function buildPublishedSigns() {
  const approved = JSON.parse(fs.readFileSync(APPROVED_PATH, 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const phraseSource = JSON.parse(fs.readFileSync(PHRASE_SOURCE_PATH, 'utf8'));
  const profileOverrides = readJsonIfPresent(PROFILE_OVERRIDES_PATH, {});
  // This is the presentation metadata shipped by the last APK. It provides a
  // migration baseline for documents published before profile hashes existed,
  // so adding profile-aware downloads updates only signs that really changed.
  const bundledProfiles = readJsonIfPresent(BUNDLED_PROFILES_PATH, {});
  const approvedGlosses = Array.isArray(approved.publishedGlosses)
    ? approved.publishedGlosses.map(value => String(value).trim()).filter(Boolean)
    : [];
  fs.mkdirSync(OUTPUT_DIR, {recursive: true});
  const firestorePath = path.join(OUTPUT_DIR, 'approved-signs.firestore.json');
  let previousSigns = new Map();
  let previousPhrases = new Map();
  try {
    const previous = JSON.parse(fs.readFileSync(firestorePath, 'utf8'));
    previousSigns = new Map((previous.signs ?? []).map(sign => [sign.id, sign.data]));
    previousPhrases = new Map((previous.phrases ?? []).map(phrase => [phrase.id, phrase.data]));
  } catch {
    previousSigns = new Map();
  }

  const signs = approvedGlosses.map(gloss => {
    const entry = approvedCatalogEntry(catalog.entries, gloss);
    if (!entry) throw new Error(`${gloss} is listed for publication but lacks owner approval.`);
    const assetName = `${motionAssetName(gloss)}.motion.bin`;
    const sourceNames = [gloss, entry.gloss, ...(entry.spanish?.lemmas ?? []), ...(entry.spanish?.forms ?? []).map(form => form.text)];
    const sourcePath = sourceNames
      .map(value => path.join(MOTION_SOURCE_DIR, `${String(value).toLocaleLowerCase('es-CO')}.motion.json`))
      .find(candidate => fs.existsSync(candidate));
    if (!sourcePath) {
      throw new Error(`${gloss} is approved but its source motion is missing.`);
    }
    const sourceMotion = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const avatarProfile = {
      ...(sourceMotion.avatarProfile ?? {}),
      ...(profileOverrides[gloss.toUpperCase()] ?? {}),
    };
    const profileJson = serializedProfile(avatarProfile);
    const profileSha256 = sha256(Buffer.from(profileJson, 'utf8'));
    const content = compileMotion(sourceMotion, undefined, sourcePath);
    const signId = `${LANGUAGE_ID}-${motionAssetName(gloss).slice(2)}`;
    const digest = sha256(content);
    const previous = previousSigns.get(signId);
    const previousProfileSha256 = previous?.profileSha256
      ?? sha256(Buffer.from(serializedProfile(bundledProfiles[gloss.toUpperCase()] ?? avatarProfile), 'utf8'));
    const releaseData = {
      sha256: digest,
      profileSha256,
      speechAliases: speechAliases(entry),
      categories: entry.categories,
      lexicalClass: entry.lexicalClass,
      verbType: entry.lsc.verbType,
      requiresSubjectMarker: entry.lsc.requiresSubjectMarker,
    };
    const releaseSha256 = signReleaseSha256(releaseData);
    const previousReleaseSha256 = previous?.releaseSha256 ?? signReleaseSha256({
      ...previous,
      profileSha256: previousProfileSha256,
    });
    const version = previousReleaseSha256 === releaseSha256
      ? previous.version
      : Math.max(0, Number(previous?.version) || 0) + 1;
    const storageMetadata = storagePaths({
      languageId: LANGUAGE_ID,
      signId,
      version,
      assetName,
    });
    fs.writeFileSync(path.join(OUTPUT_DIR, assetName), content);
    return {
      id: signId,
      data: {
        languageId: LANGUAGE_ID,
        gloss,
        version,
        assetName,
        sizeBytes: content.byteLength,
        ...releaseData,
        releaseSha256,
        ...storageMetadata,
        avatarProfile,
        assetDocumentPath: `signs/${signId}/versions/v${version}`,
        approved: true,
        compiled: true,
        published: false,
        status: 'awaiting_storage',
        approvedAt: entry.review.ownerApproval.approvedAt,
        approvedBy: entry.review.ownerApproval.approvedBy,
        ...(entry.review.publicationStatus
          ? {publicationStatus: entry.review.publicationStatus}
          : {}),
        ...(entry.review.reviewScope ? {reviewScope: entry.review.reviewScope} : {}),
      },
    };
  });

  const publishedGlosses = new Set(signs.map(sign => sign.data.gloss.toLocaleUpperCase('es-CO')));
  const phraseEntries = Array.isArray(phraseSource.entries) ? phraseSource.entries : [];
  const phrases = phraseEntries.flatMap(entry => {
    const sourceId = String(entry?.id ?? '').trim();
    const spanish = String(entry?.spanish ?? '').trim();
    const glossSequence = Array.isArray(entry?.glossSequence)
      ? entry.glossSequence.map(gloss => String(gloss).trim().toLocaleUpperCase('es-CO')).filter(Boolean)
      : [];
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(sourceId) || !spanish || glossSequence.length === 0) {
      throw new Error('Every published phrase requires a safe ID, Spanish text, and a gloss sequence.');
    }
    // Keep source phrases whose signs are still awaiting review out of the
    // public catalogue. They can be published automatically on a later run.
    if (!glossSequence.every(gloss => publishedGlosses.has(gloss))) return [];
    const id = `${LANGUAGE_ID}-${sourceId}`;
    const releaseData = {languageId: LANGUAGE_ID, spanish, glossSequence};
    const releaseSha256 = phraseReleaseSha256(releaseData);
    const previous = previousPhrases.get(id);
    const previousReleaseSha256 = previous?.releaseSha256 ?? phraseReleaseSha256(previous);
    const version = previousReleaseSha256 === releaseSha256
      ? Math.max(1, Number(previous?.version) || 1)
      : Math.max(0, Number(previous?.version) || 0) + 1;
    return [{
      id,
      data: {
        ...releaseData,
        version,
        releaseSha256,
        approved: true,
        published: false,
        status: 'awaiting_publication',
      },
    }];
  });

  const firestoreSeed = {
    language: {
      id: LANGUAGE_ID,
      data: {
        code: LANGUAGE_ID,
        name: 'Lengua de Señas Colombiana',
        region: 'Colombia',
        published: true,
      },
    },
    signs,
    phrases,
  };
  fs.writeFileSync(firestorePath, JSON.stringify(firestoreSeed, null, 2));
  return {
    outputDirectory: OUTPUT_DIR,
    firestorePath,
    signCount: signs.length,
    phraseCount: phrases.length,
    totalSizeBytes: signs.reduce((total, sign) => total + sign.data.sizeBytes, 0),
  };
}

if (require.main === module) {
  console.log(JSON.stringify(buildPublishedSigns(), null, 2));
}

module.exports = {
  buildPublishedSigns,
  signReleaseDescriptor,
  signReleaseSha256,
  phraseReleaseDescriptor,
  phraseReleaseSha256,
};
