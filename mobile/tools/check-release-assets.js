#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const PUBLISHED_ROOT = path.join(MOBILE_ROOT, 'build/published-signs/lsc-co');
const SEED_PATH = path.join(PUBLISHED_ROOT, 'approved-signs.firestore.json');
const AUDIT_PATH = path.join(MOBILE_ROOT, 'build/reports/avatar-sign-audit.json');

function fail(message) {
  throw new Error(`Release asset verification failed: ${message}`);
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function main() {
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'));
  const signs = Array.isArray(seed.signs) ? seed.signs : [];
  const audits = Array.isArray(audit.audits) ? audit.audits : [];
  if (signs.length === 0) fail('no technically approved sign resources were generated.');
  if (audits.length !== signs.length) fail('generated and audited sign counts differ.');

  const ids = new Set();
  const assetNames = new Set();
  for (const sign of signs) {
    const data = sign.data ?? {};
    if (ids.has(sign.id)) fail(`duplicate sign ID ${sign.id}.`);
    if (assetNames.has(data.assetName)) fail(`duplicate asset name ${data.assetName}.`);
    ids.add(sign.id);
    assetNames.add(data.assetName);
    if (data.approved !== true || data.compiled !== true || data.published !== false) {
      fail(`${sign.id} has invalid pre-publication state.`);
    }
    const binaryPath = path.join(PUBLISHED_ROOT, data.assetName ?? '');
    if (!fs.existsSync(binaryPath)) fail(`${sign.id} binary is missing.`);
    const content = fs.readFileSync(binaryPath);
    if (content.byteLength !== data.sizeBytes || sha256(content) !== data.sha256) {
      fail(`${sign.id} binary size or SHA-256 does not match metadata.`);
    }
  }

  const structuralErrors = audits.filter(item => item.status === 'ERROR');
  if (structuralErrors.length > 0) {
    fail(`${structuralErrors.length} sign motions contain structural errors.`);
  }
  const visualReview = audits.filter(item => item.status === 'REVIEW').length;
  console.log(
    `Release asset verification passed: ${signs.length} compiled resources, 0 structural errors, ${visualReview} queued for Task 9 human review.`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
