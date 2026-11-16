'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {isDeepStrictEqual} = require('util');
const {
  requestedGlosses,
  selectSignsForPublication,
} = require('./publish-approved-signs');
const {validateStorageAssetMetadata} = require('./storage-asset-contract');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const REPOSITORY_ROOT = path.resolve(MOBILE_ROOT, '..');
const SEED_PATH = path.join(
  MOBILE_ROOT,
  'build/published-signs/lsc-co/approved-signs.firestore.json',
);

function configuration() {
  const firebase = JSON.parse(
    fs.readFileSync(path.join(REPOSITORY_ROOT, '.firebaserc'), 'utf8'),
  );
  return {project: firebase.projects.default};
}

async function publicDocument(project, documentPath) {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}`
    + `/databases/(default)/documents/${documentPath}`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Public read failed for ${documentPath}: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function plainFirestoreValue(value) {
  if (value?.nullValue !== undefined) return null;
  if (value?.stringValue !== undefined) return value.stringValue;
  if (value?.booleanValue !== undefined) return value.booleanValue;
  if (value?.integerValue !== undefined) return Number(value.integerValue);
  if (value?.doubleValue !== undefined) return Number(value.doubleValue);
  if (value?.arrayValue !== undefined) {
    return (value.arrayValue.values ?? []).map(plainFirestoreValue);
  }
  if (value?.mapValue !== undefined) {
    return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(
      ([key, nested]) => [key, plainFirestoreValue(nested)],
    ));
  }
  return undefined;
}

function plainFirestoreDocument(document) {
  return Object.fromEntries(Object.entries(document.fields ?? {}).map(
    ([key, value]) => [key, plainFirestoreValue(value)],
  ));
}

async function verifyPublishedSigns(options = {}) {
  const {project} = configuration();
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const selectedSigns = selectSignsForPublication(seed.signs, options.glosses ?? []);
  const selectedGlosses = new Set(selectedSigns.map(sign => sign.data.gloss));
  const verified = [];
  for (const sign of selectedSigns) {
    const metadata = await publicDocument(project, `signs/${sign.id}`);
    if (metadata.fields?.published?.booleanValue !== true) {
      throw new Error(`${sign.id} is not publicly published.`);
    }
    if (
      Number(metadata.fields?.version?.integerValue) !== sign.data.version
      || metadata.fields?.profileSha256?.stringValue !== sign.data.profileSha256
      || metadata.fields?.releaseSha256?.stringValue !== sign.data.releaseSha256
    ) throw new Error(`${sign.id} has stale public version metadata.`);
    const asset = await publicDocument(project, sign.data.assetDocumentPath);
    const plainAsset = plainFirestoreDocument(asset);
    validateStorageAssetMetadata({...plainAsset, ...sign.data}, {allowLegacy: true});
    const downloadUrl = plainAsset.downloadUrl ?? sign.data.downloadUrl;
    let content;
    if (downloadUrl) {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`${sign.id} Storage download failed: ${response.status}.`);
      }
      content = Buffer.from(await response.arrayBuffer());
    } else if (typeof plainAsset.contentBase64 === 'string' && plainAsset.contentBase64.length > 0) {
      content = Buffer.from(plainAsset.contentBase64, 'base64');
    } else {
      throw new Error(`${sign.id} has storagePath metadata but no downloadUrl; Storage verification is not configured.`);
    }
    const avatarProfile = plainFirestoreValue(asset.fields?.avatarProfile);
    if (
      plainAsset.storagePath !== undefined
      && plainAsset.storagePath !== sign.data.storagePath
      || plainAsset.downloadUrl !== undefined
      && plainAsset.downloadUrl !== sign.data.downloadUrl
      || plainAsset.semanticPath !== undefined
      && plainAsset.semanticPath !== sign.data.semanticPath
      || plainAsset.profilePath !== undefined
      && plainAsset.profilePath !== sign.data.profilePath
      ||
      content.byteLength !== sign.data.sizeBytes
      || sha256(content) !== sign.data.sha256
      || asset.fields?.profileSha256?.stringValue !== sign.data.profileSha256
      || (
        asset.fields?.releaseSha256?.stringValue !== undefined
        && asset.fields.releaseSha256.stringValue !== sign.data.releaseSha256
      )
      || !isDeepStrictEqual(avatarProfile, sign.data.avatarProfile)
    ) throw new Error(`${sign.id} failed its public content verification.`);
    verified.push({
      id: sign.id,
      gloss: sign.data.gloss,
      version: sign.data.version,
      bytes: content.byteLength,
    });
  }
  const verifiedPhrases = [];
  const phrasesToVerify = (options.glosses ?? []).length === 0
    ? (seed.phrases ?? [])
    : (seed.phrases ?? []).filter(phrase => (
      phrase.data.glossSequence.some(gloss => selectedGlosses.has(gloss))
    ));
  for (const phrase of phrasesToVerify) {
    const metadata = await publicDocument(project, `phrases/${phrase.id}`);
    const published = plainFirestoreDocument(metadata);
    if (
      published.published !== true
      || published.approved !== true
      || Number(published.version) !== phrase.data.version
      || published.releaseSha256 !== phrase.data.releaseSha256
      || published.languageId !== phrase.data.languageId
      || published.spanish !== phrase.data.spanish
      || !isDeepStrictEqual(published.glossSequence, phrase.data.glossSequence)
    ) throw new Error(`${phrase.id} has stale public phrase metadata.`);
    verifiedPhrases.push({
      id: phrase.id,
      spanish: phrase.data.spanish,
      version: phrase.data.version,
    });
  }
  return {project, verified, verifiedPhrases};
}

if (require.main === module) {
  verifyPublishedSigns({glosses: requestedGlosses(process.argv.slice(2))})
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

module.exports = {verifyPublishedSigns};
