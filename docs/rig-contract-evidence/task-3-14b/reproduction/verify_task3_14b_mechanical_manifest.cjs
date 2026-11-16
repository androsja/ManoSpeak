'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const ROOT = path.resolve(__dirname, '../../../../../../');
const MANIFEST_PATH = path.join(__dirname, 'TASK_3_14B_MECHANICAL_EVIDENCE_MANIFEST.v1.json');
const EXPECTED_REPORT_RAW_SHA256 = '72356f1006f9dd43a87204f529b45a9874dd4fc2cd224ee866bc2fefeca9dc5c';
const EXPECTED_PROFILE_SHA256_FOR_CYCLE_GUARD = '7651784cc5aa3b3f48fcbc0176e8ef50dd4728fabe73ef181c9662907f4324a0';

function fail(message) {
  throw new Error(`MANIFEST.INVALID: ${message}`);
}
function bytesAt(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath));
}
function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function visit(value, callback) {
  callback(value);
  if (Array.isArray(value)) value.forEach(item => visit(item, callback));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => visit(item, callback));
}
function hashZipMember(archivePath, memberName) {
  const py = [
    'import hashlib, sys, zipfile',
    'with zipfile.ZipFile(sys.argv[1]) as z:',
    ' names=[n for n in z.namelist() if n == sys.argv[2]]',
    ' if names != [sys.argv[2]]: raise SystemExit("zip member missing or duplicate")',
    ' with z.open(names[0]) as f:',
    '  h=hashlib.sha256()',
    '  for chunk in iter(lambda:f.read(1024*1024), b""): h.update(chunk)',
    '  print(h.hexdigest())',
  ].join('\n');
  return execFileSync('python3', ['-c', py, path.join(ROOT, archivePath), memberName], {encoding: 'utf8'}).trim();
}

try {
  const manifestBytes = fs.readFileSync(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const canonicalizerBytes = bytesAt(manifest.canonicalizer.path);
  if (sha256(canonicalizerBytes) !== manifest.canonicalizer.sha256) fail('canonicalizer file SHA mismatch');
  const {canonicalJson, profileSha256} = require(path.join(ROOT, manifest.canonicalizer.path));
  if (!manifestBytes.equals(Buffer.from(canonicalJson(manifest), 'utf8'))) fail('manifest is not canonical compact sorted JSON');
  if (manifest.schema !== 'vozual.task3-14.mechanical-observation-evidence-manifest' || manifest.schemaVersion !== 1) {
    fail('unsupported manifest schema');
  }
  const observation = manifest.mechanicalObservation;
  if (observation?.claim !== 'observed-mechanical-response-only') {
    fail('mechanical observation claim must be observed-mechanical-response-only');
  }
  if (observation.anatomicalDegreesOfFreedom !== 'unsupported') {
    fail('anatomicalDegreesOfFreedom must remain unsupported');
  }
  if (observation.safeJointRanges !== 'unsupported') {
    fail('safeJointRanges must remain unsupported');
  }

  const profile = JSON.parse(bytesAt(manifest.restAxesInventory.profilePath).toString('utf8'));
  visit(manifest, value => {
    if (value === EXPECTED_PROFILE_SHA256_FOR_CYCLE_GUARD) fail('profile digest must not appear in canonical manifest');
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'profileSha256')) {
      fail('profileSha256 field must not appear in canonical manifest');
    }
  });

  const candidateBytes = bytesAt(manifest.candidate.path);
  if (sha256(candidateBytes) !== manifest.candidate.sha256 || candidateBytes.length !== manifest.candidate.bytes) {
    fail('candidate bytes or declared size mismatch');
  }
  if (profile.asset.candidateSha256 !== manifest.candidate.sha256) fail('profile candidate binding mismatch');

  const archiveBytes = bytesAt(manifest.source.archivePath);
  if (sha256(archiveBytes) !== manifest.source.archiveSha256) fail('source archive SHA mismatch');
  if (hashZipMember(manifest.source.archivePath, manifest.source.blendMember) !== manifest.source.blendSha256) {
    fail('source blend member SHA mismatch');
  }
  if (sha256(bytesAt(manifest.source.blendPath)) !== manifest.source.blendSha256) fail('source blend copy SHA mismatch');

  const inventory = profile.descriptor?.boneInventory?.restAxesInventory;
  if (!inventory || inventory.axisSemantics !== 'geometric-rest-basis-not-anatomical-joint-axis') {
    fail('geometric rest-axis inventory is absent or has different semantics');
  }
  const inventoryUnsigned = {...inventory};
  delete inventoryUnsigned.sha256;
  if (sha256(Buffer.from(canonicalJson(inventoryUnsigned), 'utf8')) !== inventory.sha256) fail('profile rest-axis inventory self-hash mismatch');
  if (inventory.sha256 !== manifest.restAxesInventory.sha256 || Object.keys(inventory.bones).length !== manifest.restAxesInventory.boneCount) {
    fail('profile rest-axis inventory binding or count mismatch');
  }
  if (profile.descriptor.degreesOfFreedom.status !== 'unsupported' || profile.descriptor.jointLimits.status !== 'unsupported') {
    fail('manifest must not promote DOFs or joint limits');
  }

  const toolBytes = bytesAt(manifest.measurementTool.path);
  if (sha256(toolBytes) !== manifest.measurementTool.sha256) fail('measurement tool SHA mismatch');

  const reportBytes = bytesAt(manifest.mechanicalObservation.reportPath);
  if (sha256(reportBytes) !== EXPECTED_REPORT_RAW_SHA256 ||
      sha256(reportBytes) !== manifest.mechanicalObservation.reportRawSha256) fail('raw response report SHA mismatch');
  const report = JSON.parse(reportBytes.toString('utf8'));
  if (report.schema !== manifest.mechanicalObservation.reportSchema || report.schemaVersion !== manifest.mechanicalObservation.reportSchemaVersion) {
    fail('response report schema mismatch');
  }
  if (report.candidateSha256 !== manifest.candidate.sha256) fail('response report candidate binding mismatch');
  const reportProfileBasis = {...profile, descriptor: {...profile.descriptor}};
  delete reportProfileBasis.descriptor.mechanicalObservationEvidence;
  delete reportProfileBasis.descriptor.visualFidelityEvidence;
  const reportProfileBasisSha256 = profileSha256(reportProfileBasis);
  if (report.profileSha256 !== reportProfileBasisSha256) {
    fail('response report profile digest does not match the derived measurement basis');
  }
  const reportProjection = {...report};
  delete reportProjection.profileSha256;
  const reportProjectionSha = sha256(Buffer.from(canonicalJson(reportProjection), 'utf8'));
  if (reportProjectionSha !== manifest.mechanicalObservation.contentProjectionSha256) fail('non-profile report projection SHA mismatch');

  const records = report.records;
  const inventoryIds = Object.keys(inventory.bones).sort();
  const recordIds = records.map(record => record.bone).sort();
  if (report.inventoryCount !== manifest.restAxesInventory.boneCount || records.length !== manifest.restAxesInventory.boneCount ||
      new Set(recordIds).size !== recordIds.length || JSON.stringify(recordIds) !== JSON.stringify(inventoryIds)) {
    fail('report does not cover the exact rest-axis bone inventory');
  }
  if (JSON.stringify(report.probeDegrees) !== JSON.stringify([-10, 10])) fail('expected exact +/-10 degree probe set');
  const axes = ['x', 'y', 'z'];
  const signs = ['+1', '-1'];
  let sampleCount = 0;
  let responsiveCount = 0;
  const surfaces = new Set();
  for (const record of records) {
    if (JSON.stringify(record.measuredRotationChannels) !== JSON.stringify(axes)) fail(`channel coverage mismatch for ${record.bone}`);
    if (!record.signed10DegreeProbes || JSON.stringify(Object.keys(record.signed10DegreeProbes).sort()) !== JSON.stringify(axes)) {
      fail(`axis probe coverage mismatch for ${record.bone}`);
    }
    for (const axis of axes) {
      const signed = record.signed10DegreeProbes[axis];
      if (JSON.stringify(Object.keys(signed).sort()) !== JSON.stringify(signs)) fail(`sign coverage mismatch for ${record.bone}/${axis}`);
      for (const sign of signs) {
        sampleCount += 1;
        const sample = signed[sign];
        const entries = Object.entries(sample.surfaces || {});
        if (!entries.length) fail(`no measured surfaces for ${record.bone}/${axis}/${sign}`);
        let movedWeightedSurface = false;
        for (const [surface, values] of entries) {
          surfaces.add(surface);
          if (!Number.isFinite(values.maxDisplacementM) || !Number.isFinite(values.rmsDisplacementM) ||
              !Number.isInteger(values.weightedVertexCount) || values.weightedVertexCount < 0) {
            fail(`invalid response metrics for ${record.bone}/${axis}/${sign}/${surface}`);
          }
          if (values.weightedVertexCount > 0 && values.maxDisplacementM > 0) movedWeightedSurface = true;
        }
        if (movedWeightedSurface) responsiveCount += 1;
        else fail(`no positive weighted displacement for ${record.bone}/${axis}/${sign}`);
      }
    }
  }
  const expectedSurfaces = [...manifest.mechanicalObservation.weightedSurfaces].sort();
  if (sampleCount !== manifest.mechanicalObservation.signedAxisSampleCount ||
      responsiveCount !== manifest.mechanicalObservation.samplesWithWeightedDisplacement ||
      JSON.stringify([...surfaces].sort()) !== JSON.stringify(expectedSurfaces)) {
    fail('manifest response coverage summary mismatch');
  }

  console.log('MANIFEST.VERIFIED');
  console.log(`manifestSha256=${sha256(manifestBytes)}`);
  console.log(`candidateSha256=${manifest.candidate.sha256}`);
  console.log(`sourceArchiveSha256=${manifest.source.archiveSha256}`);
  console.log(`sourceBlendSha256=${manifest.source.blendSha256}`);
  console.log(`restAxesInventorySha256=${manifest.restAxesInventory.sha256}`);
  console.log(`reportContentProjectionSha256=${reportProjectionSha}`);
  console.log(`reportRawSha256=${sha256(reportBytes)}`);
  console.log(`measurementToolSha256=${manifest.measurementTool.sha256}`);
  console.log(`coverage=${records.length} bones; ${sampleCount} signed axis samples; ${responsiveCount} with weighted displacement`);
  console.log('claims=observed mechanical response only; anatomical DOFs unsupported; safe joint ranges unsupported');
} catch (error) {
  console.error(error.message || String(error));
  process.exitCode = 1;
}
