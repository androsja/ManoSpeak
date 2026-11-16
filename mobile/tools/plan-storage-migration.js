#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const REPOSITORY_ROOT = path.resolve(MOBILE_ROOT, '..');
const DEFAULT_SEED_PATH = path.join(
  MOBILE_ROOT,
  'build/published-signs/lsc-co/approved-signs.firestore.json',
);
const DEFAULT_JSON_PATH = path.join(
  MOBILE_ROOT,
  'build/reports/storage-migration-plan.json',
);
const DEFAULT_MARKDOWN_PATH = path.join(
  MOBILE_ROOT,
  'build/reports/storage-migration-plan.md',
);
const HASH_FIELDS = ['sha256', 'profileSha256', 'releaseSha256'];
const PATH_FIELDS = ['storagePath', 'semanticPath', 'profilePath'];
const COMPARED_FIELDS = ['version', ...HASH_FIELDS, ...PATH_FIELDS, 'downloadUrl'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function idFromDocumentName(name) {
  if (typeof name !== 'string' || !name.trim()) return undefined;
  const segment = name.split('/').pop();
  return segment ? decodeURIComponent(segment) : undefined;
}

function normalizeEntry(entry, index) {
  const document = isRecord(entry?.document) ? entry.document : entry;
  const id = document?.id ?? idFromDocumentName(document?.name) ?? `entry-${index + 1}`;
  let data;
  if (isRecord(document?.fields)) {
    data = plainFirestoreDocument(document);
  } else if (isRecord(document?.data)) {
    data = document.data;
  } else if (isRecord(document)) {
    data = document;
  } else {
    data = {};
  }
  return {id: String(id), data};
}

function entriesFromCatalog(input, label) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.signs)) return input.signs;
  if (Array.isArray(input?.documents)) return input.documents;
  if (isRecord(input?.documents)) {
    return Object.entries(input.documents).map(([id, data]) => ({id, data}));
  }
  throw new Error(`${label} must contain a signs or documents array.`);
}

function normalizeCatalog(input, label) {
  const seen = new Set();
  return entriesFromCatalog(input, label).map((entry, index) => {
    const normalized = normalizeEntry(entry, index);
    if (seen.has(normalized.id)) {
      throw new Error(`${label} contains duplicate sign ID ${normalized.id}.`);
    }
    seen.add(normalized.id);
    return normalized;
  });
}

function normalizeLocalSeed(seed) {
  const signs = (seed?.signs ?? []).map(sign => ({
    id: sign.id,
    data: sign.data ?? {},
  }));
  return normalizeCatalog({signs}, 'Local seed');
}

function normalizeRemoteSnapshot(snapshot) {
  return normalizeCatalog(snapshot, 'Remote snapshot');
}

function nullable(value) {
  return value === undefined || value === null ? null : value;
}

function version(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function hashes(data) {
  return Object.fromEntries(HASH_FIELDS.map(field => [field, nullable(data?.[field])]));
}

function storagePaths(data) {
  return Object.fromEntries(PATH_FIELDS.map(field => [field, nullable(data?.[field])]));
}

function isHttpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function comparableValue(field, data) {
  if (field === 'version') return version(data?.[field]);
  return nullable(data?.[field]);
}

function sameRelease(localData, remoteData) {
  return COMPARED_FIELDS.every(field => (
    comparableValue(field, localData) === comparableValue(field, remoteData)
  ));
}

function proposedAction(local, remote) {
  if (!remote) return 'create';
  if (
    sameRelease(local?.data ?? {}, remote.data)
    && remote.data.approved === true
    && remote.data.compiled === true
    && remote.data.published === true
  ) return 'unchanged';
  return 'update';
}

function migrationBlockers(local, remote) {
  const blockers = [];
  const localData = local?.data ?? {};
  const remoteData = remote?.data ?? {};
  const targetData = local ? localData : remoteData;

  if (!local) blockers.push('missing-local-seed');
  if (local && localData.approved !== true) blockers.push('local-not-approved');
  if (remote && remoteData.approved !== true) blockers.push('remote-not-approved');
  if (remote && remoteData.compiled !== true) blockers.push('remote-not-compiled');
  if (remote && remoteData.published !== true) blockers.push('remote-not-published');
  if (!targetData.storagePath && !remoteData.storagePath) blockers.push('missing-storagePath');

  const downloadUrl = localData.downloadUrl ?? remoteData.downloadUrl;
  if (!downloadUrl) {
    blockers.push('missing-downloadUrl');
  } else if (!isHttpsUrl(downloadUrl)) {
    blockers.push('invalid-downloadUrl');
  }
  return blockers;
}

function legacyAvailability(local, remote) {
  const hasContent = data => typeof data?.contentBase64 === 'string'
    && data.contentBase64.length > 0;
  return {
    localContentBase64: hasContent(local?.data ?? {}),
    remoteContentBase64: hasContent(remote?.data ?? {}),
  };
}

function migrationEntry(signId, local, remote) {
  const localData = local?.data ?? {};
  const remoteData = remote?.data ?? {};
  const effectiveData = local ? localData : remoteData;
  const blockers = migrationBlockers(local, remote);
  return {
    signId,
    localVersion: version(localData.version),
    remoteVersion: version(remoteData.version),
    hashes: {
      local: hashes(localData),
      remote: hashes(remoteData),
    },
    storagePaths: {
      local: storagePaths(localData),
      remote: storagePaths(remoteData),
      effective: storagePaths(effectiveData),
    },
    downloadUrls: {
      local: nullable(localData.downloadUrl),
      remote: nullable(remoteData.downloadUrl),
      effective: nullable(localData.downloadUrl ?? remoteData.downloadUrl),
    },
    legacy: legacyAvailability(local, remote),
    action: proposedAction(local, remote),
    blocked: blockers.length > 0,
    blockers,
  };
}

function summarize(entries) {
  const blockerCounts = {};
  for (const entry of entries) {
    for (const blocker of entry.blockers) {
      blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1;
    }
  }
  return {
    total: entries.length,
    create: entries.filter(entry => entry.action === 'create').length,
    update: entries.filter(entry => entry.action === 'update').length,
    unchanged: entries.filter(entry => entry.action === 'unchanged').length,
    blocked: entries.filter(entry => entry.blocked).length,
    blockerCounts,
  };
}

function createMigrationPlan(localSeed, remoteCatalog, metadata = {}) {
  const localEntries = normalizeLocalSeed(localSeed);
  const remoteEntries = normalizeRemoteSnapshot(remoteCatalog);
  const localById = new Map(localEntries.map(entry => [entry.id, entry]));
  const remoteById = new Map(remoteEntries.map(entry => [entry.id, entry]));
  const signIds = Array.from(new Set([...localById.keys(), ...remoteById.keys()])).sort();
  const entries = signIds.map(signId => migrationEntry(
    signId,
    localById.get(signId),
    remoteById.get(signId),
  ));
  return {
    schemaVersion: 1,
    readOnly: true,
    source: metadata,
    summary: summarize(entries),
    entries,
  };
}

function markdownValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).replaceAll('|', '\\|');
}

function pair(local, remote) {
  return `${markdownValue(local)} / ${markdownValue(remote)}`;
}

function hashSummary(hashes) {
  return [
    `sha256=${markdownValue(hashes.sha256)}`,
    `profile=${markdownValue(hashes.profileSha256)}`,
    `release=${markdownValue(hashes.releaseSha256)}`,
  ].join('; ');
}

function pathSummary(paths) {
  return [
    `motion=${markdownValue(paths.storagePath)}`,
    `semantic=${markdownValue(paths.semanticPath)}`,
    `profile=${markdownValue(paths.profilePath)}`,
  ].join('; ');
}

function renderMarkdown(plan) {
  const lines = [
    '# Firebase Storage Migration Plan',
    '',
    'This manifest is read-only planning output. It does not publish, delete, or modify Firestore data.',
    '',
    `- Schema version: ${plan.schemaVersion}`,
    `- Local source: ${markdownValue(plan.source.localSeed)}`,
    `- Remote source: ${markdownValue(plan.source.remote)}`,
    `- Summary: ${plan.summary.total} signs; ${plan.summary.create} create; ${plan.summary.update} update; ${plan.summary.unchanged} unchanged; ${plan.summary.blocked} blocked.`,
    '',
    '| Sign ID | Action | Blocked | Version local / remote | Hashes local / remote | Storage paths local / remote | URL local / remote | Blockers |',
    '| --- | --- | --- | ---: | --- | --- | --- | --- |',
  ];
  for (const entry of plan.entries) {
    lines.push([
      entry.signId,
      entry.action,
      entry.blocked ? 'yes' : 'no',
      pair(entry.localVersion, entry.remoteVersion),
      pair(hashSummary(entry.hashes.local), hashSummary(entry.hashes.remote)),
      pair(pathSummary(entry.storagePaths.local), pathSummary(entry.storagePaths.remote)),
      pair(entry.downloadUrls.local, entry.downloadUrls.remote),
      entry.blockers.length > 0 ? entry.blockers.join(', ') : '—',
    ].map(markdownValue).join(' | '));
  }
  lines.push('', '## Blocker counts', '');
  const blockerEntries = Object.entries(plan.summary.blockerCounts);
  if (blockerEntries.length === 0) {
    lines.push('None.');
  } else {
    for (const [blocker, count] of blockerEntries) lines.push(`- ${blocker}: ${count}`);
  }
  lines.push('');
  return lines.join('\n');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function firebaseProject() {
  const configPath = path.join(REPOSITORY_ROOT, '.firebaserc');
  const config = readJson(configPath);
  return config.projects?.default;
}

async function fetchRemoteCatalog(project, fetchImpl = globalThis.fetch) {
  if (!project) throw new Error('A Firebase project is required for Firestore reads.');
  if (typeof fetchImpl !== 'function') throw new Error('This Node runtime does not provide fetch.');
  const documents = [];
  let pageToken = '';
  do {
    const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}`
      + `/databases/(default)/documents/signs?pageSize=300`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const response = await fetchImpl(endpoint);
    if (!response.ok) {
      throw new Error(`Firestore read failed: ${response.status} ${await response.text()}`);
    }
    const payload = await response.json();
    documents.push(...(payload.documents ?? []));
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);
  return {documents};
}

function parseArguments(argv) {
  const options = {
    seedPath: DEFAULT_SEED_PATH,
    snapshotPath: undefined,
    useFirestore: false,
    project: undefined,
    jsonPath: DEFAULT_JSON_PATH,
    markdownPath: DEFAULT_MARKDOWN_PATH,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      index += 1;
      return value;
    };
    if (argument === '--seed') options.seedPath = next();
    else if (argument === '--snapshot') options.snapshotPath = next();
    else if (argument === '--firestore') options.useFirestore = true;
    else if (argument === '--project') options.project = next();
    else if (argument === '--out-json') options.jsonPath = next();
    else if (argument === '--out-md') options.markdownPath = next();
    else throw new Error(`Unknown argument ${argument}.`);
  }
  if (options.snapshotPath && options.useFirestore) {
    throw new Error('Choose either --snapshot or --firestore, not both.');
  }
  if (!options.help && !options.snapshotPath && !options.useFirestore) {
    throw new Error('Provide --snapshot <file> or --firestore for a read-only catalog query.');
  }
  return options;
}

function usage() {
  return [
    'Usage:',
    '  node tools/plan-storage-migration.js --snapshot <firestore-snapshot.json>',
    '  node tools/plan-storage-migration.js --firestore [--project <project-id>]',
    '',
    'Options:',
    '  --seed <file>       Local approved-signs seed JSON.',
    '  --snapshot <file>   Local Firestore REST/canonical snapshot; no network.',
    '  --firestore         Read the public signs collection with GET requests only.',
    '  --project <id>      Firebase project; defaults to .firebaserc.',
    '  --out-json <file>   JSON manifest output path.',
    '  --out-md <file>     Markdown manifest output path.',
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(usage());
    return null;
  }
  const seed = readJson(path.resolve(options.seedPath));
  const remote = options.snapshotPath
    ? readJson(path.resolve(options.snapshotPath))
    : await fetchRemoteCatalog(options.project ?? firebaseProject());
  const plan = createMigrationPlan(seed, remote, {
    localSeed: path.resolve(options.seedPath),
    remote: options.snapshotPath
      ? `snapshot:${path.resolve(options.snapshotPath)}`
      : `firestore:${options.project ?? firebaseProject()}`,
  });
  const jsonPath = path.resolve(options.jsonPath);
  const markdownPath = path.resolve(options.markdownPath);
  fs.mkdirSync(path.dirname(jsonPath), {recursive: true});
  fs.mkdirSync(path.dirname(markdownPath), {recursive: true});
  fs.writeFileSync(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(plan));
  console.log(JSON.stringify({jsonPath, markdownPath, summary: plan.summary}, null, 2));
  return plan;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  createMigrationPlan,
  fetchRemoteCatalog,
  normalizeRemoteSnapshot,
  renderMarkdown,
};
