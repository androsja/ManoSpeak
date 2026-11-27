'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {spawnSync} = require('child_process');
const {motionAssetName} = require('./compact-sign-motion');

const PROJECT_ID = 'vozual-lsc-prod';
const LANGUAGE_ID = 'lsc-co';
const LOCALE = 'es-CO';
const CHUNK_CHARACTERS = 180_000;
const MOBILE_ROOT = path.resolve(__dirname, '..');
const MOTION_DIRECTORY = path.join(MOBILE_ROOT, 'assets/motions');
const OVERRIDES_PATH = path.join(MOTION_DIRECTORY, 'avatar_profile_overrides.json');
const CATALOG_PATH = path.join(MOBILE_ROOT, 'build/published-signs/lsc-co/approved-signs.firestore.json');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function firestoreValue(value) {
  if (value === null) return {nullValue: null};
  if (typeof value === 'string') return {stringValue: value};
  if (typeof value === 'boolean') return {booleanValue: value};
  if (typeof value === 'number') {
    return Number.isInteger(value) ? {integerValue: String(value)} : {doubleValue: value};
  }
  if (Array.isArray(value)) return {arrayValue: {values: value.map(firestoreValue)}};
  if (typeof value === 'object') {
    return {mapValue: {fields: Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, firestoreValue(item)]),
    )}};
  }
  throw new Error(`Unsupported Firestore value type: ${typeof value}`);
}

function firestoreDocument(fields) {
  return {fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)]))};
}

function accessToken() {
  const result = spawnSync('gcloud', ['auth', 'print-access-token'], {encoding: 'utf8'});
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Could not read the active gcloud access token: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function releaseInputs(gloss, options = {}) {
  const catalogPath = options.catalogPath ?? CATALOG_PATH;
  const motionDirectory = options.motionDirectory ?? MOTION_DIRECTORY;
  if (!fs.existsSync(catalogPath)) {
    const build = spawnSync(process.execPath, [path.join(__dirname, 'build-published-signs.js')], {
      cwd: MOBILE_ROOT,
      encoding: 'utf8',
    });
    if (build.status !== 0) throw new Error(build.stderr || build.stdout);
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const existing = catalog.signs.find(sign => sign.data.gloss === gloss);
  if (!existing || existing.data.approved !== true || existing.data.compiled !== true) {
    throw new Error(`${gloss} is not an approved compiled sign in the local publishing catalog.`);
  }
  const motionCatalogPath = path.join(motionDirectory, 'sign-catalog.json');
  const motionCatalog = fs.existsSync(motionCatalogPath)
    ? JSON.parse(fs.readFileSync(motionCatalogPath, 'utf8'))
    : undefined;
  const motionCatalogEntry = Array.isArray(motionCatalog?.entries)
    ? motionCatalog.entries.find(entry => entry?.gloss === gloss)
    : undefined;
  const speechAliases = motionCatalogEntry?.speechAliases ?? existing.data.speechAliases;
  if (!Array.isArray(speechAliases) || speechAliases.some(alias => typeof alias !== 'string' || !alias.trim())) {
    throw new Error(`${gloss} has invalid speechAliases in its release catalog.`);
  }
  const sourceNames = [gloss, ...speechAliases];
  const sourcePath = sourceNames
    .map(value => path.join(motionDirectory, `${String(value).toLocaleLowerCase('es-CO')}.motion.json`))
    .find(candidate => fs.existsSync(candidate));
  if (!sourcePath) throw new Error(`Missing JSON motion source for ${gloss}.`);
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const overridesPath = path.join(motionDirectory, path.basename(OVERRIDES_PATH));
  const overrides = fs.existsSync(overridesPath)
    ? JSON.parse(fs.readFileSync(overridesPath, 'utf8'))
    : {};
  const avatarProfile = {...(source.avatarProfile ?? {}), ...(overrides[gloss] ?? {})};
  const motionDocument = {...source, avatarProfile};
  const bytes = Buffer.from(JSON.stringify(motionDocument), 'utf8');
  const motionSha256 = sha256(bytes);
  const profileSha256 = sha256(Buffer.from(JSON.stringify(avatarProfile), 'utf8'));
  const descriptor = {
    sha256: motionSha256,
    profileSha256,
    speechAliases,
    categories: existing.data.categories,
    lexicalClass: existing.data.lexicalClass,
    verbType: existing.data.verbType,
    requiresSubjectMarker: existing.data.requiresSubjectMarker === true,
  };
  if (profileSha256 !== existing.data.profileSha256) {
    throw new Error(`${gloss} runtime profile differs from the compiled Android profile.`);
  }
  return {
    id: existing.id,
    gloss,
    bytes,
    motionSha256,
    profileSha256,
    descriptor,
    releaseSha256: sha256(Buffer.from(JSON.stringify(descriptor), 'utf8')),
    metadata: existing.data,
  };
}

function buildRelease(releaseId, version, glosses, inputs = {}) {
  const signs = glosses.map(gloss => {
    const input = releaseInputs(gloss, inputs);
    const base64 = input.bytes.toString('base64');
    const compressed = zlib.gzipSync(input.bytes, {level: 9});
    const compressedBase64 = compressed.toString('base64');
    const chunks = [];
    const compressedChunks = [];
    for (let start = 0; start < base64.length; start += CHUNK_CHARACTERS) {
      chunks.push(base64.slice(start, start + CHUNK_CHARACTERS));
    }
    for (let start = 0; start < compressedBase64.length; start += CHUNK_CHARACTERS) {
      compressedChunks.push(compressedBase64.slice(start, start + CHUNK_CHARACTERS));
    }
    return {
      metadata: {
        id: input.id,
        languageId: LANGUAGE_ID,
        gloss: input.gloss,
        version,
        assetName: `${motionAssetName(gloss)}.motion.json`,
        sizeBytes: input.bytes.byteLength,
        sha256: input.motionSha256,
        profileSha256: input.profileSha256,
        releaseSha256: input.releaseSha256,
        speechAliases: input.descriptor.speechAliases,
        categories: input.descriptor.categories,
        lexicalClass: input.descriptor.lexicalClass,
        verbType: input.descriptor.verbType,
        requiresSubjectMarker: input.descriptor.requiresSubjectMarker,
        motionFormat: 'legacy-json-v2',
        jsonChunkCount: chunks.length,
        jsonCompression: 'gzip',
        jsonCompressedChunkCount: compressedChunks.length,
        compressedSizeBytes: compressed.byteLength,
        approved: true,
        compiled: true,
        published: true,
        ...(input.metadata.publicationStatus
          ? {publicationStatus: input.metadata.publicationStatus}
          : {}),
        ...(input.metadata.reviewScope ? {reviewScope: input.metadata.reviewScope} : {}),
      },
      chunks,
      compressedChunks,
    };
  });
  return {
    manifest: {
      schema: 'vozual.sign-json-release',
      releaseId,
      languageId: LANGUAGE_ID,
      code: LANGUAGE_ID,
      name: 'Lengua de Señas Colombiana',
      region: 'Colombia',
      locale: LOCALE,
      version,
      published: true,
      createdAt: new Date().toISOString(),
      signs: signs.map(sign => sign.metadata),
    },
    signs,
  };
}

async function firestoreRequest(token, method, documentPath, body) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${documentPath}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Firestore ${method} ${documentPath} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : undefined;
}

async function documentExists(token, documentPath) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${documentPath}`;
  const response = await fetch(url, {headers: {Authorization: `Bearer ${token}`}});
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Firestore GET ${documentPath} failed (${response.status}).`);
  return true;
}

async function publish(releaseId, version, glosses, dryRun, inputs = {}) {
  const {manifest, signs} = buildRelease(releaseId, version, glosses, inputs);
  const pointerPath = `signJsonReleasePointers/${LANGUAGE_ID}`;
  const releasePath = `signJsonReleases/${releaseId}`;
  const summary = {
    projectId: PROJECT_ID,
    pointerPath,
    releasePath,
    version,
    signs: signs.map(({metadata, chunks, compressedChunks}) => ({
      id: metadata.id,
      gloss: metadata.gloss,
      sizeBytes: metadata.sizeBytes,
      sha256: metadata.sha256,
      chunkCount: chunks.length,
      compressedSizeBytes: metadata.compressedSizeBytes,
      compressedChunkCount: compressedChunks.length,
    })),
  };
  if (dryRun) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  const token = accessToken();
  if (await documentExists(token, releasePath)) {
    throw new Error(`Immutable release ${releaseId} already exists; choose a new release ID.`);
  }
  if (await documentExists(token, pointerPath)) {
    const currentPointer = await firestoreRequest(token, 'GET', pointerPath);
    const currentVersion = Number(currentPointer.fields?.version?.integerValue ?? 0);
    if (version <= currentVersion) throw new Error('New release version must be greater than the active version.');
  }
  await firestoreRequest(token, 'POST', `signJsonReleases?documentId=${encodeURIComponent(releaseId)}`, firestoreDocument(manifest));
  for (const {metadata, chunks, compressedChunks} of signs) {
    for (const [index, contentBase64] of chunks.entries()) {
      const documentId = String(index).padStart(4, '0');
      const chunkPath = `${releasePath}/motions/${metadata.id}/chunks?documentId=${documentId}`;
      await firestoreRequest(token, 'POST', chunkPath, firestoreDocument({
        releaseId,
        signId: metadata.id,
        index,
        count: chunks.length,
        sha256: metadata.sha256,
        contentBase64,
      }));
    }
    for (const [index, contentBase64] of compressedChunks.entries()) {
      const documentId = String(index).padStart(4, '0');
      const chunkPath = `${releasePath}/motions/${metadata.id}/compressedChunks?documentId=${documentId}`;
      await firestoreRequest(token, 'POST', chunkPath, firestoreDocument({
        releaseId,
        signId: metadata.id,
        index,
        count: compressedChunks.length,
        sha256: metadata.sha256,
        contentBase64,
      }));
    }
  }
  const pointer = {
    schema: 'vozual.sign-json-release-pointer',
    languageId: LANGUAGE_ID,
    releaseId,
    version,
    published: true,
    updatedAt: new Date().toISOString(),
  };
  const pointerBody = firestoreDocument(pointer);
  if (await documentExists(token, pointerPath)) {
    await firestoreRequest(token, 'PATCH', pointerPath, pointerBody);
  } else {
    await firestoreRequest(token, 'POST', `signJsonReleasePointers?documentId=${LANGUAGE_ID}`, pointerBody);
  }
  process.stdout.write(`${JSON.stringify({...summary, published: true}, null, 2)}\n`);
}

function parseArguments(argv) {
  const options = {
    releaseId: 'lsc-co-json-v1',
    version: 1,
    glosses: ['ADIÓS'],
    dryRun: true,
    motionDirectory: MOTION_DIRECTORY,
    catalogPath: CATALOG_PATH,
  };
  let glossesSpecified = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--publish') options.dryRun = false;
    else if (argument === '--release-id') options.releaseId = argv[++index];
    else if (argument === '--version') options.version = Number(argv[++index]);
    else if (argument === '--gloss') {
      if (!glossesSpecified) options.glosses = [];
      glossesSpecified = true;
      options.glosses.push(argv[++index]);
    }
    else if (argument === '--motion-dir') options.motionDirectory = argv[++index];
    else if (argument === '--catalog') options.catalogPath = argv[++index];
    else if (argument === '--help') {
      process.stdout.write('Usage: node tools/publish-json-motion-release.cjs [--publish] [--release-id ID] [--version N] [--gloss GLOSS ...] [--motion-dir PATH] [--catalog PATH]\n');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(options.releaseId)
      || !Number.isSafeInteger(options.version) || options.version < 1
      || options.glosses.some(gloss => typeof gloss !== 'string' || !gloss.trim())
      || typeof options.motionDirectory !== 'string' || !options.motionDirectory.trim()
      || typeof options.catalogPath !== 'string' || !options.catalogPath.trim()) {
    throw new Error('Invalid release ID, version, or gloss.');
  }
  options.glosses = Array.from(new Set(options.glosses.map(gloss => gloss.trim().toLocaleUpperCase('es-CO'))));
  return options;
}

if (require.main === module) {
  const options = parseArguments(process.argv.slice(2));
  publish(options.releaseId, options.version, options.glosses, options.dryRun, options)
    .catch(error => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {buildRelease, parseArguments, publish, releaseInputs};
