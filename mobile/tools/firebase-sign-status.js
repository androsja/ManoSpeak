'use strict';

const fs = require('fs');
const path = require('path');
const {buildPublishedSigns} = require('./build-published-signs');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const REPOSITORY_ROOT = path.resolve(MOBILE_ROOT, '..');

function configuration() {
  const firebase = JSON.parse(
    fs.readFileSync(path.join(REPOSITORY_ROOT, '.firebaserc'), 'utf8'),
  );
  return {project: firebase.projects.default};
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

async function listPublishedSigns(project) {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}`
    + '/databases/(default)/documents:runQuery';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      structuredQuery: {
        from: [{collectionId: 'signs'}],
        where: {
          fieldFilter: {
            field: {fieldPath: 'published'},
            op: 'EQUAL',
            value: {booleanValue: true},
          },
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Firestore status query failed: ${response.status} ${await response.text()}`);
  }
  const rows = await response.json();
  return rows.flatMap(row => row.document ? [plainFirestoreDocument(row.document)] : []);
}

function classifyFirebaseState(local, remote) {
  if (!remote) return 'not_published';
  if (!local) return 'published_not_approved';
  return remote.releaseSha256 === local.releaseSha256
    ? 'current'
    : 'changes_pending';
}

async function firebaseSignStatuses() {
  const build = buildPublishedSigns();
  const seed = JSON.parse(fs.readFileSync(build.firestorePath, 'utf8'));
  const {project} = configuration();
  const remoteSigns = await listPublishedSigns(project);
  const localByGloss = new Map((seed.signs ?? []).map(sign => [
    String(sign.data?.gloss ?? '').trim().toUpperCase(),
    sign.data,
  ]));
  const remoteByGloss = new Map(remoteSigns.map(sign => [
    String(sign.gloss ?? '').trim().toUpperCase(),
    sign,
  ]));
  const glosses = Array.from(new Set([
    ...localByGloss.keys(),
    ...remoteByGloss.keys(),
  ])).filter(Boolean).sort();
  return {
    project,
    statuses: glosses.map(gloss => {
      const local = localByGloss.get(gloss);
      const remote = remoteByGloss.get(gloss);
      return {
        gloss,
        state: classifyFirebaseState(local, remote),
        version: remote ? Number(remote.version) || null : null,
      };
    }),
  };
}

if (require.main === module) {
  firebaseSignStatuses()
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

module.exports = {
  classifyFirebaseState,
  firebaseSignStatuses,
  listPublishedSigns,
};
