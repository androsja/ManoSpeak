'use strict';

const SAFE_STORAGE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*[A-Za-z0-9]$/;
const SHA256 = /^[a-f0-9]{64}$/i;

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Storage asset metadata has an invalid ${field}.`);
  }
  return value.trim();
}

function optionalStoragePath(value, field) {
  if (value === undefined || value === null) return undefined;
  const path = requiredText(value, field);
  if (path.startsWith('/') || path.includes('..') || !SAFE_STORAGE_PATH.test(path)) {
    throw new Error(`Storage asset metadata has an invalid ${field}.`);
  }
  return path;
}

function optionalDownloadUrl(value) {
  if (value === undefined || value === null) return undefined;
  const url = requiredText(value, 'downloadUrl');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Storage asset metadata has an invalid downloadUrl.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Storage asset metadata has an invalid downloadUrl.');
  }
  return url;
}

function validateStorageAssetMetadata(data, {allowLegacy = true} = {}) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Storage asset metadata must be an object.');
  }
  const storagePath = optionalStoragePath(data.storagePath, 'storagePath');
  const downloadUrl = optionalDownloadUrl(data.downloadUrl);
  const semanticPath = optionalStoragePath(data.semanticPath, 'semanticPath');
  const profilePath = optionalStoragePath(data.profilePath, 'profilePath');
  const hasLegacy = typeof data.contentBase64 === 'string' && data.contentBase64.length > 0;
  if (!storagePath && !downloadUrl && !hasLegacy && !allowLegacy) {
    throw new Error('Storage asset metadata requires storagePath, downloadUrl, or legacy contentBase64.');
  }
  if (!storagePath && !downloadUrl && !hasLegacy) {
    throw new Error('Storage asset metadata has no content source.');
  }
  if (data.sha256 !== undefined && (!SHA256.test(String(data.sha256)) || String(data.sha256).toLowerCase() !== String(data.sha256))) {
    throw new Error('Storage asset metadata has an invalid sha256.');
  }
  if (data.sizeBytes !== undefined && (!Number.isInteger(data.sizeBytes) || data.sizeBytes < 1)) {
    throw new Error('Storage asset metadata has an invalid sizeBytes.');
  }
  return {storagePath, downloadUrl, semanticPath, profilePath, hasLegacy};
}

function storagePaths({languageId, signId, version, assetName}) {
  const root = `${languageId}/signs/${signId}/v${version}`;
  return {
    storagePath: `${root}/${assetName}`,
    semanticPath: `${root}/${assetName.replace(/\.motion\.bin$/, '.semantic.json')}`,
    profilePath: `${root}/${assetName.replace(/\.motion\.bin$/, '.profile.json')}`,
  };
}

module.exports = {storagePaths, validateStorageAssetMetadata};
