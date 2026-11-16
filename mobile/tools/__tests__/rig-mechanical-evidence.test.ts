const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {assertMechanicalObservationEvidence, MANIFEST_RELATIVE_PATH} = require('../rig-mechanical-evidence.cjs');
const {canonicalJson, profileSha256} = require('../rig-capability-profile.cjs');
const {
  createMechanicalEvidenceFixture,
  disposeMechanicalEvidenceFixture,
  rebindFixtureManifest,
} = require('./helpers/task3-14b-mechanical-evidence-fixture');

function sha256(bytes: Buffer) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function evidenceFile(root: string, relative: string) {
  return path.join(root, relative);
}

describe('v4 mechanical observation evidence with synthetic fixture', () => {
  let fixture: ReturnType<typeof createMechanicalEvidenceFixture>;

  beforeEach(() => {
    fixture = createMechanicalEvidenceFixture();
  });

  afterEach(() => {
    disposeMechanicalEvidenceFixture(fixture);
  });

  it('verifies the canonical evidence chain and complete signed synthetic inventory', () => {
    const result = assertMechanicalObservationEvidence(fixture.profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    });
    const historicalBasis = JSON.parse(JSON.stringify(fixture.profile));
    delete historicalBasis.descriptor.mechanicalObservationEvidence;
    delete historicalBasis.descriptor.visualFidelityEvidence;
    expect(result.reportProfileBasisSha256).toBe(fixture.report.profileSha256);
    expect(result.reportProfileBasisSha256).toBe(profileSha256(historicalBasis));
    expect(result).toMatchObject({
      manifestSha256: fixture.profile.descriptor.mechanicalObservationEvidence.manifestSha256,
      reportProjectionSha256: fixture.profile.descriptor.mechanicalObservationEvidence.reportProjectionSha256,
      reportRawSha256: fixture.manifest.mechanicalObservation.reportRawSha256,
      candidateSha256: fixture.profile.asset.candidateSha256,
      restAxesInventorySha256: fixture.profile.descriptor.boneInventory.restAxesInventory.sha256,
      claim: 'observed-mechanical-response-only',
      boneCount: 171,
      signedAxisSampleCount: 1026,
      samplesWithWeightedDisplacement: 1026,
      executableCapability: false,
    });
    expect(fixture.profile.descriptor.degreesOfFreedom.status).toBe('unsupported');
    expect(fixture.profile.descriptor.jointLimits.status).toBe('unsupported');
  });

  it('rejects a changed non-evidence profile field against the synthetic report basis', () => {
    const changedProfile = JSON.parse(JSON.stringify(fixture.profile));
    changedProfile.anthropometricsM.shoulderWidth += 0.001;
    changedProfile.sha256 = profileSha256(changedProfile);
    expect(() => assertMechanicalObservationEvidence(changedProfile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({
      code: 'COMPATIBILITY.RIG_PROFILE',
      message: expect.stringContaining('profile basis'),
    }));
  });

  it('rejects a tampered report profileSha256 after repairing raw-report and manifest bindings', () => {
    const manifest = JSON.parse(JSON.stringify(fixture.manifest));
    const reportPath = evidenceFile(fixture.evidenceRoot, manifest.mechanicalObservation.reportPath);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    report.profileSha256 = '0'.repeat(64);
    const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(reportPath, reportBytes);
    manifest.mechanicalObservation.reportRawSha256 = sha256(reportBytes);

    const projection = {...report};
    delete projection.profileSha256;
    expect(sha256(Buffer.from(canonicalJson(projection), 'utf8')))
      .toBe(fixture.profile.descriptor.mechanicalObservationEvidence.reportProjectionSha256);

    const profile = rebindFixtureManifest(fixture, manifest);
    expect(() => assertMechanicalObservationEvidence(profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({
      code: 'COMPATIBILITY.RIG_PROFILE',
      message: expect.stringContaining('profile basis'),
    }));
  });

  it('rejects a stale report inventory after repairing its raw, projection, manifest, and profile references', () => {
    const manifest = JSON.parse(JSON.stringify(fixture.manifest));
    const reportPath = evidenceFile(fixture.evidenceRoot, manifest.mechanicalObservation.reportPath);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    report.records[0].bone = 'stale-inventory-entry';
    const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(reportPath, reportBytes);
    manifest.mechanicalObservation.reportRawSha256 = sha256(reportBytes);
    const projection = {...report};
    delete projection.profileSha256;
    const projectionSha256 = sha256(Buffer.from(canonicalJson(projection), 'utf8'));
    manifest.mechanicalObservation.contentProjectionSha256 = projectionSha256;
    fixture.profile.descriptor.mechanicalObservationEvidence.reportProjectionSha256 = projectionSha256;
    const profile = rebindFixtureManifest(fixture, manifest);

    expect(() => assertMechanicalObservationEvidence(profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({
      code: 'COMPATIBILITY.RIG_PROFILE',
      message: expect.stringContaining('exact profile bone inventory'),
    }));
  });

  it('rejects a report bound to another candidate after repairing all report and manifest digests', () => {
    const manifest = JSON.parse(JSON.stringify(fixture.manifest));
    const reportPath = evidenceFile(fixture.evidenceRoot, manifest.mechanicalObservation.reportPath);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    report.candidateSha256 = '0'.repeat(64);
    const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(reportPath, reportBytes);
    manifest.mechanicalObservation.reportRawSha256 = sha256(reportBytes);
    const projection = {...report};
    delete projection.profileSha256;
    const projectionSha256 = sha256(Buffer.from(canonicalJson(projection), 'utf8'));
    manifest.mechanicalObservation.contentProjectionSha256 = projectionSha256;
    fixture.profile.descriptor.mechanicalObservationEvidence.reportProjectionSha256 = projectionSha256;
    const profile = rebindFixtureManifest(fixture, manifest);

    expect(() => assertMechanicalObservationEvidence(profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({
      code: 'COMPATIBILITY.RIG_PROFILE',
      message: expect.stringContaining('profile basis, identity'),
    }));
  });

  it('rejects a manifest candidate digest that differs from the profile and candidate bytes', () => {
    const manifest = JSON.parse(JSON.stringify(fixture.manifest));
    manifest.candidate.sha256 = '0'.repeat(64);
    const profile = rebindFixtureManifest(fixture, manifest);
    expect(() => assertMechanicalObservationEvidence(profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({
      code: 'COMPATIBILITY.RIG_PROFILE',
      message: expect.stringContaining('candidate bytes do not match'),
    }));
  });

  it('rejects a manifest inventory digest that differs from the profile inventory', () => {
    const manifest = JSON.parse(JSON.stringify(fixture.manifest));
    manifest.restAxesInventory.sha256 = '0'.repeat(64);
    const profile = rebindFixtureManifest(fixture, manifest);
    expect(() => assertMechanicalObservationEvidence(profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({
      code: 'COMPATIBILITY.RIG_PROFILE',
      message: expect.stringContaining('rest-axis inventory binding'),
    }));
  });

  it('rejects a candidate that does not match the synthetic profile-bound bytes', () => {
    expect(() => assertMechanicalObservationEvidence(fixture.profile, Buffer.from('different candidate'), {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('rejects manifest bytes that do not match the profile-bound canonical digest', () => {
    const localManifest = evidenceFile(fixture.evidenceRoot, MANIFEST_RELATIVE_PATH);
    fs.appendFileSync(localManifest, '\n');
    expect(() => assertMechanicalObservationEvidence(fixture.profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('rejects changed report/tool bytes and missing candidate evidence files', () => {
    const manifest = fixture.manifest;
    const reportPath = evidenceFile(fixture.evidenceRoot, manifest.mechanicalObservation.reportPath);
    const reportOriginal = fs.readFileSync(reportPath);
    fs.writeFileSync(reportPath, Buffer.concat([reportOriginal, Buffer.from('tamper')]));
    expect(() => assertMechanicalObservationEvidence(fixture.profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    fs.writeFileSync(reportPath, reportOriginal);

    const toolPath = evidenceFile(fixture.evidenceRoot, manifest.measurementTool.path);
    const toolOriginal = fs.readFileSync(toolPath);
    fs.writeFileSync(toolPath, Buffer.concat([toolOriginal, Buffer.from('\n# tamper\n')]));
    expect(() => assertMechanicalObservationEvidence(fixture.profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    fs.writeFileSync(toolPath, toolOriginal);

    fs.rmSync(evidenceFile(fixture.evidenceRoot, manifest.candidate.path));
    expect(() => assertMechanicalObservationEvidence(fixture.profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('rejects a manifest that contains any profile digest field, preventing a hash cycle', () => {
    const manifest = JSON.parse(JSON.stringify(fixture.manifest));
    manifest.profileSha256 = '0'.repeat(64);
    const profile = rebindFixtureManifest(fixture, manifest);
    expect(() => assertMechanicalObservationEvidence(profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('rejects a profile reference whose rest-axis digest differs from the declared inventory', () => {
    const profile = JSON.parse(JSON.stringify(fixture.profile));
    profile.descriptor.mechanicalObservationEvidence.restAxesInventorySha256 = '0'.repeat(64);
    profile.sha256 = profileSha256(profile);
    expect(() => assertMechanicalObservationEvidence(profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });
});

const runRealEvidenceIntegration = process.env.VOZUAL_RUN_TASK3_14B_REAL_EVIDENCE === '1';
const realEvidenceIntegration = runRealEvidenceIntegration ? it : it.skip;

realEvidenceIntegration('optional local integration verifies the real ignored evidence (set VOZUAL_RUN_TASK3_14B_REAL_EVIDENCE=1)', () => {
  const repositoryRoot = path.resolve(__dirname, '../../..');
  const profilePath = path.join(repositoryRoot, 'schemas/rig-profiles/vozual-rig-1.v2.json');
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const manifestPath = path.join(repositoryRoot, MANIFEST_RELATIVE_PATH);
  const missing = [profilePath, manifestPath].filter(file => !fs.existsSync(file));
  if (missing.length) {
    throw new Error(`Real Task 3.14b evidence opt-in requested but required local files are missing: ${missing.join(', ')}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const candidatePath = path.join(repositoryRoot, manifest.candidate.path);
  const requiredEvidencePaths = [
    candidatePath,
    path.join(repositoryRoot, manifest.canonicalizer.path),
    path.join(repositoryRoot, manifest.measurementTool.path),
    path.join(repositoryRoot, manifest.mechanicalObservation.reportPath),
  ];
  const missingEvidence = requiredEvidencePaths.filter(file => !fs.existsSync(file));
  if (missingEvidence.length) {
    throw new Error(`Real Task 3.14b evidence opt-in requested but evidence files are missing: ${missingEvidence.join(', ')}`);
  }
  const candidateBytes = fs.readFileSync(candidatePath);
  const result = assertMechanicalObservationEvidence(profile, candidateBytes, {evidenceRoot: repositoryRoot});
  expect(result).toMatchObject({
    reportProfileBasisSha256: 'c8d77d81161fcc70a6340637c3eb3635e26ce231a16afcddf941f5e9317eec8d',
    boneCount: 171,
    signedAxisSampleCount: 1026,
    samplesWithWeightedDisplacement: 1026,
    executableCapability: false,
  });
  expect(profile.descriptor.degreesOfFreedom.status).toBe('unsupported');
  expect(profile.descriptor.jointLimits.status).toBe('unsupported');
});
