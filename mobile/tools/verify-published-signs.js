'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {isDeepStrictEqual} = require('util');
const {
  requestedGlosses,
  selectSignsForPublication,
} = require('./publish-approved-signs');

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

async function verifyPublishedSigns(options = {}) {
  const {project} = configuration();
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const selectedSigns = selectSignsForPublication(seed.signs, options.glosses ?? []);
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
    const content = Buffer.from(asset.fields?.contentBase64?.stringValue ?? '', 'base64');
    const avatarProfile = plainFirestoreValue(asset.fields?.avatarProfile);
    if (
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
  return {project, verified};
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
