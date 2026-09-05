'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {compileMotion, motionAssetName} = require('./compact-sign-motion');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const LANGUAGE_ID = 'lsc-co';
const APPROVED_PATH = path.join(MOBILE_ROOT, 'assets/motions/published_signs.json');
const CATALOG_PATH = path.join(MOBILE_ROOT, 'assets/data/lsc_linguistic_catalog.json');
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
  try {
    const previous = JSON.parse(fs.readFileSync(firestorePath, 'utf8'));
    previousSigns = new Map((previous.signs ?? []).map(sign => [sign.id, sign.data]));
  } catch {
    previousSigns = new Map();
  }

  const signs = approvedGlosses.map(gloss => {
    const entry = approvedCatalogEntry(catalog.entries, gloss);
    if (!entry) throw new Error(`${gloss} is listed for publication but lacks owner approval.`);
    const assetName = `${motionAssetName(gloss)}.motion.bin`;
    const sourcePath = path.join(MOTION_SOURCE_DIR, `${gloss.toLowerCase()}.motion.json`);
    if (!fs.existsSync(sourcePath)) {
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
        avatarProfile,
        assetDocumentPath: `signs/${signId}/versions/v${version}`,
        approved: true,
        compiled: true,
        published: false,
        status: 'awaiting_storage',
        approvedAt: entry.review.ownerApproval.approvedAt,
        approvedBy: entry.review.ownerApproval.approvedBy,
      },
    };
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
  };
  fs.writeFileSync(firestorePath, JSON.stringify(firestoreSeed, null, 2));
  return {
    outputDirectory: OUTPUT_DIR,
    firestorePath,
    signCount: signs.length,
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
};
