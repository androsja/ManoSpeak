'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  RigCapabilityError,
  canonicalJson,
  profileSha256,
  validateRigCapabilityProfile,
  verifyCandidateAsset,
} = require('./rig-capability-profile.cjs');

const MANIFEST_RELATIVE_PATH = '.dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/luna_high_review/TASK_3_14B_MECHANICAL_EVIDENCE_MANIFEST.v1.json';
const EXPECTED_MANIFEST_SCHEMA = 'vozual.task3-14.mechanical-observation-evidence-manifest';
const EXPECTED_REPORT_SCHEMA = 'vozual.task3-14.full-inventory-pose-channel-diagnostic';
const PROFILE_PATH = 'schemas/rig-profiles/vozual-rig-1.v2.json';
const VALID_SHA256 = /^[a-f0-9]{64}$/;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fail(message) {
  throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', `Mechanical observation evidence rejected: ${message}`);
}

function declaredFile(root, relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) fail(`${label} path is invalid`);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) fail(`${label} path escapes the evidence root`);
  try {
    return fs.readFileSync(resolved);
  } catch (error) {
    fail(`${label} is unavailable (${error.code || 'read error'})`);
  }
}

function visit(value, callback) {
  callback(value);
  if (Array.isArray(value)) value.forEach(item => visit(item, callback));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => visit(item, callback));
}

function assertMechanicalObservationEvidence(profile, candidateBytes, options = {}) {
  validateRigCapabilityProfile(profile);
  verifyCandidateAsset(profile, candidateBytes);

  const configuredRoot = options.evidenceRoot || process.env.VOZUAL_TASK3_14B_EVIDENCE_ROOT;
  if (typeof configuredRoot !== 'string' || !configuredRoot) {
    fail('an explicit evidenceRoot or VOZUAL_TASK3_14B_EVIDENCE_ROOT is required');
  }
  const root = path.resolve(configuredRoot);
  const manifestBytes = declaredFile(root, MANIFEST_RELATIVE_PATH, 'canonical manifest');
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    fail('manifest is not valid JSON');
  }
  const manifestSha256 = sha256(manifestBytes);
  const reference = profile.descriptor.mechanicalObservationEvidence;
  if (manifestSha256 !== reference.manifestSha256 ||
      !manifestBytes.equals(Buffer.from(canonicalJson(manifest), 'utf8'))) {
    fail('manifest canonical bytes or profile-bound digest mismatch');
  }
  if (manifest.schema !== EXPECTED_MANIFEST_SCHEMA || manifest.schemaVersion !== reference.schemaVersion ||
      manifest.canonicalization !== 'compact-sorted-json-utf8-v1' ||
      manifest.mechanicalObservation?.claim !== reference.claim ||
      manifest.mechanicalObservation?.contentProjectionSha256 !== reference.reportProjectionSha256 ||
      manifest.mechanicalObservation?.anatomicalDegreesOfFreedom !== 'unsupported' ||
      manifest.mechanicalObservation?.safeJointRanges !== 'unsupported' ||
      manifest.mechanicalObservation?.reportSchema !== EXPECTED_REPORT_SCHEMA ||
      manifest.mechanicalObservation?.reportSchemaVersion !== 1 ||
      !VALID_SHA256.test(manifest.mechanicalObservation?.reportRawSha256 || '')) {
    fail('manifest schema, claim, report digest, or unsupported-scope declarations mismatch');
  }
  let containsProfileDigest = false;
  let containsProfileDigestField = false;
  visit(manifest, value => {
    if (value === profile.sha256) containsProfileDigest = true;
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'profileSha256')) {
      containsProfileDigestField = true;
    }
  });
  if (containsProfileDigest || containsProfileDigestField) fail('manifest contains a profile digest and would create a hash cycle');

  const canonicalizer = manifest.canonicalizer;
  if (canonicalizer?.function !== 'canonicalJson' || canonicalizer.path !== 'mobile/tools/rig-capability-profile.cjs' ||
      !VALID_SHA256.test(canonicalizer.sha256 || '')) {
    fail('manifest canonicalizer declaration is invalid');
  }
  const canonicalizerBytes = declaredFile(root, canonicalizer.path, 'canonicalizer source');
  if (sha256(canonicalizerBytes) !== canonicalizer.sha256) fail('canonicalizer source digest mismatch');

  const candidate = manifest.candidate;
  const declaredCandidateBytes = declaredFile(root, candidate?.path, 'candidate asset');
  if (candidate?.sha256 !== profile.asset.candidateSha256 || candidate.sha256 !== reference.candidateSha256 ||
      candidate.bytes !== candidateBytes.length || candidate.bytes !== declaredCandidateBytes.length ||
      sha256(candidateBytes) !== candidate.sha256 || sha256(declaredCandidateBytes) !== candidate.sha256 ||
      !candidateBytes.equals(declaredCandidateBytes)) {
    fail('candidate bytes do not match the manifest and profile');
  }
  const inventory = profile.descriptor.boneInventory.restAxesInventory;
  if (manifest.restAxesInventory?.descriptorPath !== 'descriptor.boneInventory.restAxesInventory' ||
      manifest.restAxesInventory?.profilePath !== PROFILE_PATH ||
      manifest.restAxesInventory?.axisSemantics !== 'geometric-rest-basis-not-anatomical-joint-axis' ||
      manifest.restAxesInventory?.sha256 !== inventory.sha256 ||
      manifest.restAxesInventory?.sha256 !== reference.restAxesInventorySha256 ||
      manifest.restAxesInventory?.boneCount !== profile.descriptor.boneInventory.count ||
      manifest.mechanicalObservation?.inventoryCount !== profile.descriptor.boneInventory.count) {
    fail('rest-axis inventory binding or geometric-only semantics mismatch');
  }

  const toolBytes = declaredFile(root, manifest.measurementTool?.path, 'measurement tool');
  if (!VALID_SHA256.test(manifest.measurementTool?.sha256 || '') || sha256(toolBytes) !== manifest.measurementTool.sha256) {
    fail('measurement tool digest mismatch');
  }
  const reportBytes = declaredFile(root, manifest.mechanicalObservation.reportPath, 'response report');
  if (sha256(reportBytes) !== manifest.mechanicalObservation.reportRawSha256) fail('response report raw digest mismatch');
  let report;
  try {
    report = JSON.parse(reportBytes.toString('utf8'));
  } catch {
    fail('response report is not valid JSON');
  }
  const reportProfileBasis = {...profile, descriptor: {...profile.descriptor}};
  delete reportProfileBasis.descriptor.mechanicalObservationEvidence;
  delete reportProfileBasis.descriptor.visualFidelityEvidence;
  const reportProfileBasisSha256 = profileSha256(reportProfileBasis);
  if (report.schema !== manifest.mechanicalObservation.reportSchema ||
      report.schemaVersion !== manifest.mechanicalObservation.reportSchemaVersion ||
      report.candidateSha256 !== candidate.sha256 || !VALID_SHA256.test(report.profileSha256 || '') ||
      report.profileSha256 !== reportProfileBasisSha256 ||
      report.inventoryCount !== profile.descriptor.boneInventory.count ||
      JSON.stringify(report.probeDegrees) !== JSON.stringify([-10, 10])) {
    fail('response report profile basis, identity, schema, or finite sample domain mismatch');
  }
  const reportProjection = {...report};
  delete reportProjection.profileSha256;
  const reportProjectionSha256 = sha256(Buffer.from(canonicalJson(reportProjection), 'utf8'));
  if (reportProjectionSha256 !== manifest.mechanicalObservation.contentProjectionSha256 ||
      reportProjectionSha256 !== reference.reportProjectionSha256) {
    fail('response report canonical projection digest mismatch');
  }

  const records = report.records;
  const inventoryIds = Object.keys(inventory.bones).sort();
  const recordIds = Array.isArray(records) ? records.map(record => record.bone).sort() : [];
  if (!Array.isArray(records) || records.length !== inventoryIds.length ||
      new Set(recordIds).size !== recordIds.length || JSON.stringify(recordIds) !== JSON.stringify(inventoryIds)) {
    fail('response report does not cover the exact profile bone inventory');
  }
  const axes = ['x', 'y', 'z'];
  const signs = ['+1', '-1'];
  const surfaces = new Set();
  let sampleCount = 0;
  let responsiveCount = 0;
  for (const record of records) {
    if (JSON.stringify(record.measuredRotationChannels) !== JSON.stringify(axes) ||
        !record.signed10DegreeProbes || JSON.stringify(Object.keys(record.signed10DegreeProbes).sort()) !== JSON.stringify(axes)) {
      fail(`incomplete XYZ coverage for ${record.bone}`);
    }
    for (const axis of axes) {
      const signed = record.signed10DegreeProbes[axis];
      if (!signed || JSON.stringify(Object.keys(signed).sort()) !== JSON.stringify(signs)) fail(`incomplete signed sample coverage for ${record.bone}/${axis}`);
      for (const sign of signs) {
        sampleCount += 1;
        const responseSurfaces = Object.entries(signed[sign].surfaces || {});
        let movedWeightedSurface = false;
        if (!responseSurfaces.length) fail(`no surface response for ${record.bone}/${axis}/${sign}`);
        for (const [surface, values] of responseSurfaces) {
          surfaces.add(surface);
          if (!Number.isFinite(values.maxDisplacementM) || !Number.isFinite(values.rmsDisplacementM) ||
              !Number.isInteger(values.weightedVertexCount) || values.weightedVertexCount < 0) {
            fail(`invalid response metrics for ${record.bone}/${axis}/${sign}/${surface}`);
          }
          if (values.weightedVertexCount > 0 && values.maxDisplacementM > 0) movedWeightedSurface = true;
        }
        if (!movedWeightedSurface) fail(`sample has no positive weighted displacement for ${record.bone}/${axis}/${sign}`);
        responsiveCount += 1;
      }
    }
  }
  const expectedSurfaces = [...manifest.mechanicalObservation.weightedSurfaces].sort();
  if (sampleCount !== manifest.mechanicalObservation.signedAxisSampleCount ||
      responsiveCount !== manifest.mechanicalObservation.samplesWithWeightedDisplacement ||
      JSON.stringify([...surfaces].sort()) !== JSON.stringify(expectedSurfaces)) {
    fail('manifest sample or weighted-surface totals mismatch');
  }

  return Object.freeze({
    manifestSha256,
    reportProjectionSha256,
    reportRawSha256: manifest.mechanicalObservation.reportRawSha256,
    candidateSha256: candidate.sha256,
    restAxesInventorySha256: inventory.sha256,
    reportProfileBasisSha256,
    claim: 'observed-mechanical-response-only',
    boneCount: records.length,
    signedAxisSampleCount: sampleCount,
    samplesWithWeightedDisplacement: responsiveCount,
    executableCapability: false,
  });
}

module.exports = {MANIFEST_RELATIVE_PATH, assertMechanicalObservationEvidence};
