'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const {
  buildPublishedSigns,
  phraseReleaseSha256,
  signReleaseSha256,
} = require('./build-published-signs');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const REPOSITORY_ROOT = path.resolve(MOBILE_ROOT, '..');

function readFirebaseProject() {
  const configuration = JSON.parse(
    fs.readFileSync(path.join(REPOSITORY_ROOT, '.firebaserc'), 'utf8'),
  );
  return process.env.VOZUAL_FIREBASE_PROJECT || configuration.projects?.default;
}

function gcloudExecutable() {
  const configured = process.env.VOZUAL_GCLOUD_BIN;
  const candidates = [
    configured,
    process.env.HOME && path.join(process.env.HOME, 'google-cloud-sdk/bin/gcloud'),
    '/opt/homebrew/bin/gcloud',
    '/usr/local/bin/gcloud',
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) ?? 'gcloud';
}

function firestoreValue(value) {
  if (value === null) return {nullValue: null};
  if (Array.isArray(value)) {
    return {arrayValue: {values: value.map(firestoreValue)}};
  }
  if (typeof value === 'object') {
    return {mapValue: {fields: firestoreFields(value)}};
  }
  if (typeof value === 'boolean') return {booleanValue: value};
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? {integerValue: String(value)}
      : {doubleValue: value};
  }
  return {stringValue: String(value)};
}

function firestoreFields(data) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, firestoreValue(value)]),
  );
}

async function writeDocument(token, project, documentPath, data) {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}`
    + `/databases/(default)/documents/${documentPath}`;
  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({fields: firestoreFields(data)}),
  });
  if (!response.ok) {
    throw new Error(`Firestore rejected ${documentPath}: ${response.status} ${await response.text()}`);
  }
}

async function readDocument(token, project, documentPath) {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}`
    + `/databases/(default)/documents/${documentPath}`;
  const response = await fetch(endpoint, {
    headers: {Authorization: `Bearer ${token}`},
  });
  if (!response.ok) {
    throw new Error(`Firestore could not read ${documentPath}: ${response.status} ${await response.text()}`);
  }
  return response.json();
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

async function listDocuments(token, project, collectionId) {
  const documents = [];
  let pageToken = '';
  do {
    const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}`
      + `/databases/(default)/documents/${collectionId}?pageSize=300`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const response = await fetch(endpoint, {
      headers: {Authorization: `Bearer ${token}`},
    });
    if (!response.ok) {
      throw new Error(`Firestore could not list ${collectionId}: ${response.status} ${await response.text()}`);
    }
    const payload = await response.json();
    documents.push(...(payload.documents ?? []));
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);
  return documents;
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function isCurrentPublishedSign(existing, signData) {
  if (!existing) return false;
  const existingReleaseSha256 = existing.releaseSha256
    ?? signReleaseSha256(existing);
  return existing.published === true
    && existing.approved === true
    && existing.compiled === true
    && Number(existing.version) === signData.version
    && existingReleaseSha256 === signData.releaseSha256;
}

function reconcileSignVersion(existing, signData) {
  if (!existing) return signData;
  const remoteVersion = Math.max(0, Number(existing.version) || 0);
  const existingReleaseSha256 = existing.releaseSha256
    ?? signReleaseSha256(existing);
  const version = existingReleaseSha256 === signData.releaseSha256
    ? Math.max(1, remoteVersion)
    : remoteVersion + 1;
  return {
    ...signData,
    version,
  };
}

function isCurrentPublishedPhrase(existing, phraseData) {
  if (!existing) return false;
  const existingReleaseSha256 = existing.releaseSha256
    ?? phraseReleaseSha256(existing);
  return existing.published === true
    && existing.approved === true
    && Number(existing.version) === phraseData.version
    && existingReleaseSha256 === phraseData.releaseSha256;
}

function reconcilePhraseVersion(existing, phraseData) {
  if (!existing) return phraseData;
  const remoteVersion = Math.max(0, Number(existing.version) || 0);
  const existingReleaseSha256 = existing.releaseSha256
    ?? phraseReleaseSha256(existing);
  const version = existingReleaseSha256 === phraseData.releaseSha256
    ? Math.max(1, remoteVersion)
    : remoteVersion + 1;
  return {...phraseData, version};
}

function requestedGlosses(argumentsList) {
  const glosses = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = String(argumentsList[index]);
    if (argument === '--gloss' && argumentsList[index + 1]) {
      glosses.push(String(argumentsList[index + 1]).trim().toUpperCase());
      index += 1;
    } else if (argument.startsWith('--gloss=')) {
      glosses.push(argument.slice('--gloss='.length).trim().toUpperCase());
    }
  }
  return Array.from(new Set(glosses.filter(Boolean)));
}

function selectSignsForPublication(signs, glosses) {
  if (glosses.length === 0) return signs;
  const requested = new Set(glosses.map(gloss => String(gloss).trim().toUpperCase()));
  const selected = signs.filter(sign => requested.has(String(sign.data.gloss).trim().toUpperCase()));
  const found = new Set(selected.map(sign => String(sign.data.gloss).trim().toUpperCase()));
  const missing = [...requested].filter(gloss => !found.has(gloss));
  if (missing.length > 0) {
    throw new Error(`Approved signs not found for publication: ${missing.join(', ')}.`);
  }
  return selected;
}

async function publishApprovedSigns(options = {}) {
  const build = buildPublishedSigns();
  const project = readFirebaseProject();
  if (!project) throw new Error('The Firebase project is not configured.');
  const token = execFileSync(gcloudExecutable(), ['auth', 'print-access-token'], {
    encoding: 'utf8',
  }).trim();
  if (!token) throw new Error('Google Cloud authentication is required.');
  const seed = JSON.parse(fs.readFileSync(build.firestorePath, 'utf8'));
  const selectedSigns = selectSignsForPublication(seed.signs, options.glosses ?? []);
  const partialPublication = (options.glosses ?? []).length > 0;
  const selectedGlosses = new Set(selectedSigns.map(sign => sign.data.gloss));
  await writeDocument(token, project, `signLanguages/${seed.language.id}`, seed.language.data);
  const approvedIds = new Set(seed.signs.map(sign => sign.id));
  const existingDocuments = await listDocuments(token, project, 'signs');
  const existingSigns = new Map(existingDocuments.map(document => [
    document.name.split('/').pop(),
    plainFirestoreDocument(document),
  ]));
  const existingPhraseDocuments = await listDocuments(token, project, 'phrases');
  const existingPhrases = new Map(existingPhraseDocuments.map(document => [
    document.name.split('/').pop(),
    plainFirestoreDocument(document),
  ]));
  for (const sign of selectedSigns) {
    sign.data = reconcileSignVersion(existingSigns.get(sign.id), sign.data);
    // The sign ID is authoritative. Avoid reconstructing it from an asset name
    // when updating a version derived from the remote document.
    sign.data.assetDocumentPath = `signs/${sign.id}/versions/v${sign.data.version}`;
  }
  fs.writeFileSync(build.firestorePath, JSON.stringify(seed, null, 2));
  const retired = [];
  if (!partialPublication) {
    for (const [existingId, existing] of existingSigns) {
      if (approvedIds.has(existingId)) continue;
      if (
        existing.languageId !== seed.language.id
        && !existingId.startsWith(`${seed.language.id}-`)
      ) continue;
      await writeDocument(token, project, `signs/${existingId}`, {
        ...existing,
        published: false,
        approved: false,
        compiled: false,
        status: 'retired',
        updatedAt: new Date().toISOString(),
      });
      retired.push(existingId);
    }
  }

  const published = [];
  const unchanged = [];
  for (const sign of selectedSigns) {
    const localPath = path.join(build.outputDirectory, sign.data.assetName);
    if (!sign.data.approved || !sign.data.compiled || !fs.existsSync(localPath)) {
      throw new Error(`${sign.id} is not both approved and compiled.`);
    }
    const content = fs.readFileSync(localPath);
    const contentBase64 = content.toString('base64');
    if (contentBase64.length > 900_000) {
      throw new Error(`${sign.id} exceeds the safe Firestore document size.`);
    }
    const existing = existingSigns.get(sign.id);
    const isCurrent = isCurrentPublishedSign(existing, sign.data);
    if (isCurrent) {
      // Older documents can be semantically current but lack the explicit
      // release hash. Add it without uploading the unchanged motion again.
      if (existing.releaseSha256 !== sign.data.releaseSha256) {
        await writeDocument(token, project, `signs/${sign.id}`, {
          ...sign.data,
          published: true,
          status: 'published',
          updatedAt: new Date().toISOString(),
        });
      }
      unchanged.push({id: sign.id, gloss: sign.data.gloss, version: sign.data.version});
      continue;
    }
    await writeDocument(token, project, `signs/${sign.id}`, {
      ...sign.data,
      published: false,
      status: 'uploading',
      updatedAt: new Date().toISOString(),
    });
    await writeDocument(token, project, sign.data.assetDocumentPath, {
      contentBase64,
      sha256: sign.data.sha256,
      profileSha256: sign.data.profileSha256,
      releaseSha256: sign.data.releaseSha256,
      avatarProfile: sign.data.avatarProfile,
      sizeBytes: sign.data.sizeBytes,
      approved: true,
      compiled: true,
      published: true,
      updatedAt: new Date().toISOString(),
    });
    const uploadedDocument = await readDocument(
      token,
      project,
      sign.data.assetDocumentPath,
    );
    const uploaded = Buffer.from(
      uploadedDocument.fields?.contentBase64?.stringValue ?? '',
      'base64',
    );
    if (
      sha256(uploaded) !== sign.data.sha256
      || uploadedDocument.fields?.profileSha256?.stringValue
        !== sign.data.profileSha256
      || uploadedDocument.fields?.releaseSha256?.stringValue
        !== sign.data.releaseSha256
    ) {
      throw new Error(`${sign.id} failed its post-upload SHA-256 check.`);
    }
    await writeDocument(token, project, `signs/${sign.id}`, {
      ...sign.data,
      published: true,
      status: 'published',
      updatedAt: new Date().toISOString(),
    });
    const publishedDocument = plainFirestoreDocument(await readDocument(
      token,
      project,
      `signs/${sign.id}`,
    ));
    if (
      publishedDocument.published !== true
      || Number(publishedDocument.version) !== sign.data.version
      || publishedDocument.releaseSha256 !== sign.data.releaseSha256
    ) {
      throw new Error(`${sign.id} failed its final publication check.`);
    }
    published.push({id: sign.id, gloss: sign.data.gloss, version: sign.data.version});
  }

  const publishedPhrases = [];
  const unchangedPhrases = [];
  const retiredPhrases = [];
  const approvedPhraseIds = new Set((seed.phrases ?? []).map(phrase => phrase.id));
  // A single-sign editor publication only evaluates phrases that use that
  // sign. This lets the editor publish confirmed phrase proposals immediately
  // after their final required sign becomes available, without retiring other
  // language phrases during a partial upload.
  const phrasesToPublish = partialPublication
    ? (seed.phrases ?? []).filter(phrase => (
      phrase.data.glossSequence.some(gloss => selectedGlosses.has(gloss))
    ))
    : (seed.phrases ?? []);
  if (!partialPublication) {
    for (const [existingId, existing] of existingPhrases) {
      if (approvedPhraseIds.has(existingId)) continue;
      if (
        existing.languageId !== seed.language.id
        && !existingId.startsWith(`${seed.language.id}-`)
      ) continue;
      await writeDocument(token, project, `phrases/${existingId}`, {
        ...existing,
        published: false,
        approved: false,
        status: 'retired',
        updatedAt: new Date().toISOString(),
      });
      retiredPhrases.push(existingId);
    }
  }

  // Phrases are published after their signs. A client can therefore never
  // observe a newly suggested phrase before all of its downloadable signs
  // have been made public.
  for (const phrase of phrasesToPublish) {
    phrase.data = reconcilePhraseVersion(existingPhrases.get(phrase.id), phrase.data);
    const existing = existingPhrases.get(phrase.id);
    if (isCurrentPublishedPhrase(existing, phrase.data)) {
      unchangedPhrases.push({id: phrase.id, spanish: phrase.data.spanish, version: phrase.data.version});
      continue;
    }
    await writeDocument(token, project, `phrases/${phrase.id}`, {
      ...phrase.data,
      published: false,
      status: 'uploading',
      updatedAt: new Date().toISOString(),
    });
    await writeDocument(token, project, `phrases/${phrase.id}`, {
      ...phrase.data,
      published: true,
      status: 'published',
      updatedAt: new Date().toISOString(),
    });
    const publishedDocument = plainFirestoreDocument(await readDocument(
      token,
      project,
      `phrases/${phrase.id}`,
    ));
    if (
      publishedDocument.published !== true
      || publishedDocument.approved !== true
      || Number(publishedDocument.version) !== phrase.data.version
      || publishedDocument.releaseSha256 !== phrase.data.releaseSha256
    ) throw new Error(`${phrase.id} failed its final publication check.`);
    publishedPhrases.push({id: phrase.id, spanish: phrase.data.spanish, version: phrase.data.version});
  }
  return {
    project,
    published,
    unchanged,
    retired,
    publishedPhrases,
    unchangedPhrases,
    retiredPhrases,
  };
}

if (require.main === module) {
  publishApprovedSigns({glosses: requestedGlosses(process.argv.slice(2))})
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

module.exports = {
  gcloudExecutable,
  isCurrentPublishedSign,
  isCurrentPublishedPhrase,
  plainFirestoreDocument,
  publishApprovedSigns,
  reconcileSignVersion,
  reconcilePhraseVersion,
  requestedGlosses,
  selectSignsForPublication,
};
