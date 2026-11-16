import fs = require('fs');
import os = require('os');
import path = require('path');
import crypto = require('crypto');
import profileTemplate = require('../../../../schemas/rig-profiles/vozual-rig-1.v2.json');
import {canonicalJson, profileSha256, restAxesInventorySha256} from '../../rig-capability-profile.cjs';
import {MANIFEST_RELATIVE_PATH} from '../../rig-mechanical-evidence.cjs';

const REPORT_RELATIVE_PATH = 'fixtures/synthetic-full-inventory-report.json';
const CANDIDATE_RELATIVE_PATH = 'fixtures/synthetic-candidate.glb';
const TOOL_RELATIVE_PATH = 'fixtures/synthetic-measurement-tool.txt';
const CANONICALIZER_RELATIVE_PATH = 'mobile/tools/rig-capability-profile.cjs';
const SYNTHETIC_SURFACE = 'synthetic-test-surface';

function sha256(bytes: Buffer) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function writeRelative(root: string, relativePath: string, bytes: Buffer) {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.writeFileSync(destination, bytes);
}

export function createMechanicalEvidenceFixture() {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vozual-task3-14b-synthetic-'));
  const candidateBytes = Buffer.from('synthetic Task 3.14b test candidate v1\n', 'utf8');
  const toolBytes = Buffer.from('synthetic measurement-tool identity for tests\n', 'utf8');
  const canonicalizerPath = require.resolve('../../rig-capability-profile.cjs');
  const canonicalizerBytes = fs.readFileSync(canonicalizerPath);

  writeRelative(evidenceRoot, CANDIDATE_RELATIVE_PATH, candidateBytes);
  writeRelative(evidenceRoot, TOOL_RELATIVE_PATH, toolBytes);
  writeRelative(evidenceRoot, CANONICALIZER_RELATIVE_PATH, canonicalizerBytes);

  const profile = JSON.parse(JSON.stringify(profileTemplate));
  const candidateSha256 = sha256(candidateBytes);
  profile.asset.candidateSha256 = candidateSha256;
  const inventory = profile.descriptor.boneInventory.restAxesInventory;
  inventory.candidateSha256 = candidateSha256;
  inventory.sha256 = restAxesInventorySha256(inventory);

  const reference = profile.descriptor.mechanicalObservationEvidence;
  reference.candidateSha256 = candidateSha256;
  reference.restAxesInventorySha256 = inventory.sha256;
  reference.manifestSha256 = '0'.repeat(64);
  reference.reportProjectionSha256 = '0'.repeat(64);

  const baseProfile = JSON.parse(JSON.stringify(profile));
  delete baseProfile.descriptor.mechanicalObservationEvidence;
  delete baseProfile.descriptor.visualFidelityEvidence;
  const reportProfileBasisSha256 = profileSha256(baseProfile);
  const boneIds = Object.keys(inventory.bones).sort();
  const records = boneIds.map(bone => {
    const surfaces = () => ({
      [SYNTHETIC_SURFACE]: {
        maxDisplacementM: 0.001,
        rmsDisplacementM: 0.0005,
        weightedVertexCount: 1,
      },
    });
    const signed = () => ({'+1': {surfaces: surfaces()}, '-1': {surfaces: surfaces()}});
    return {
      bone,
      measuredRotationChannels: ['x', 'y', 'z'],
      signed10DegreeProbes: {x: signed(), y: signed(), z: signed()},
    };
  });
  const report = {
    schema: 'vozual.task3-14.full-inventory-pose-channel-diagnostic',
    schemaVersion: 1,
    profileSha256: reportProfileBasisSha256,
    candidateSha256,
    inventoryCount: boneIds.length,
    probeDegrees: [-10, 10],
    records,
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const reportProjection = {...report};
  delete (reportProjection as {profileSha256?: string}).profileSha256;
  const reportProjectionSha256 = sha256(Buffer.from(canonicalJson(reportProjection), 'utf8'));
  writeRelative(evidenceRoot, REPORT_RELATIVE_PATH, reportBytes);

  const manifest = {
    schema: 'vozual.task3-14.mechanical-observation-evidence-manifest',
    schemaVersion: 1,
    canonicalization: 'compact-sorted-json-utf8-v1',
    canonicalizer: {
      function: 'canonicalJson',
      path: CANONICALIZER_RELATIVE_PATH,
      sha256: sha256(canonicalizerBytes),
    },
    candidate: {
      path: CANDIDATE_RELATIVE_PATH,
      sha256: candidateSha256,
      bytes: candidateBytes.length,
    },
    source: {kind: 'synthetic-test-only; no licensed source data included'},
    restAxesInventory: {
      descriptorPath: 'descriptor.boneInventory.restAxesInventory',
      profilePath: 'schemas/rig-profiles/vozual-rig-1.v2.json',
      axisSemantics: 'geometric-rest-basis-not-anatomical-joint-axis',
      sha256: inventory.sha256,
      boneCount: boneIds.length,
    },
    measurementTool: {path: TOOL_RELATIVE_PATH, sha256: sha256(toolBytes)},
    mechanicalObservation: {
      claim: 'observed-mechanical-response-only',
      anatomicalDegreesOfFreedom: 'unsupported',
      safeJointRanges: 'unsupported',
      contentProjectionSha256: reportProjectionSha256,
      excludedTopLevelFields: ['profile identity digest'],
      projectionCanonicalization: 'compact-sorted-json-utf8-v1',
      inventoryCount: boneIds.length,
      recordCount: records.length,
      probeDegrees: [-10, 10],
      reportPath: REPORT_RELATIVE_PATH,
      reportRawSha256: sha256(reportBytes),
      reportSchema: report.schema,
      reportSchemaVersion: report.schemaVersion,
      signedAxisSampleCount: boneIds.length * 6,
      samplesWithWeightedDisplacement: boneIds.length * 6,
      weightedSurfaces: [SYNTHETIC_SURFACE],
    },
  };
  const manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8');
  writeRelative(evidenceRoot, MANIFEST_RELATIVE_PATH, manifestBytes);
  reference.manifestSha256 = sha256(manifestBytes);
  reference.reportProjectionSha256 = reportProjectionSha256;
  profile.sha256 = profileSha256(profile);

  return {evidenceRoot, candidateBytes, profile, manifest, report};
}

export function rebindFixtureManifest(fixture: ReturnType<typeof createMechanicalEvidenceFixture>, manifest: any) {
  const manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8');
  writeRelative(fixture.evidenceRoot, MANIFEST_RELATIVE_PATH, manifestBytes);
  fixture.profile.descriptor.mechanicalObservationEvidence.manifestSha256 = sha256(manifestBytes);
  fixture.profile.sha256 = profileSha256(fixture.profile);
  return fixture.profile;
}

export function disposeMechanicalEvidenceFixture(fixture: ReturnType<typeof createMechanicalEvidenceFixture>) {
  fs.rmSync(fixture.evidenceRoot, {recursive: true, force: true});
}

