import fs = require('fs');
import path = require('path');

const {profileSha256} = require('../rig-capability-profile.cjs');
const {assertVisualFidelityEvidence} = require('../rig-visual-fidelity-evidence.cjs');
const {
  createVisualFidelityEvidenceFixture,
  disposeVisualFidelityEvidenceFixture,
  refreshManifest,
  sha256,
} = require('./helpers/task3-20-visual-fidelity-evidence-fixture');

describe('v2 visual-fidelity evidence binding with synthetic fixtures', () => {
  let fixture: ReturnType<typeof createVisualFidelityEvidenceFixture>;

  beforeEach(() => {
    fixture = createVisualFidelityEvidenceFixture();
  });

  afterEach(() => {
    disposeVisualFidelityEvidenceFixture(fixture);
  });

  it('verifies an acyclic, candidate-bound, observations-only evidence graph', () => {
    const result = assertVisualFidelityEvidence(fixture.profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    });
    expect(result).toMatchObject({
      manifestSha256: fixture.profile.descriptor.visualFidelityEvidence.manifestSha256,
      profileBasisSha256: fixture.profileBasisSha256,
      candidateSha256: fixture.candidateSha256,
      claim: 'visual-fidelity-observations-only',
      disposition: 'provenance-only-no-visual-approval',
      evidenceFileCount: 9,
    });
    expect(result).not.toHaveProperty('approval');
    expect(fixture.profile.asset.candidateStatus).toBe('temporary-uncertified');
    expect(fixture.profile.descriptor.degreesOfFreedom.status).toBe('unsupported');
    expect(fixture.profile.descriptor.jointLimits.status).toBe('unsupported');
  });

  it('fails closed when evidence root or manifest is missing', () => {
    expect(() => assertVisualFidelityEvidence(fixture.profile, fixture.candidateBytes))
      .toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    expect(() => assertVisualFidelityEvidence(fixture.profile, fixture.candidateBytes, {
      evidenceRoot: path.join(fixture.evidenceRoot, 'missing'),
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    fs.rmSync(path.join(fixture.evidenceRoot, fixture.manifestPath));
    expect(() => assertVisualFidelityEvidence(fixture.profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('rejects evidence paths that escape the explicitly selected root', () => {
    const manifest = JSON.parse(JSON.stringify(fixture.manifest));
    manifest.candidate.path = '../outside-candidate.glb';
    refreshManifest(fixture, manifest);
    expect(() => assertVisualFidelityEvidence(fixture.profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE', message: expect.stringContaining('escapes')}));
  });

  it('rejects a changed report when its manifest entry is stale', () => {
    const renderEntry = fixture.manifest.evidenceFiles.find((entry: any) => entry.role === 'render-comparison-json');
    fs.appendFileSync(path.join(fixture.evidenceRoot, renderEntry.path), 'tampered\n');
    expect(() => assertVisualFidelityEvidence(fixture.profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE', message: expect.stringContaining('digest mismatch')}));
  });

  it('rejects a report/profile-basis mismatch after report and manifest hashes are repaired', () => {
    const manifest = JSON.parse(JSON.stringify(fixture.manifest));
    const entry = manifest.evidenceFiles.find((item: any) => item.role === 'render-comparison-json');
    const reportPath = path.join(fixture.evidenceRoot, entry.path);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    report.profile.canonicalSha256 = '0'.repeat(64);
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    entry.sha256 = sha256(fs.readFileSync(reportPath));
    refreshManifest(fixture, manifest);
    expect(() => assertVisualFidelityEvidence(fixture.profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE', message: expect.stringContaining('report profile or candidate binding')}));
  });

  it('rejects changed non-evidence profile fields even when the profile self-hash is repaired', () => {
    const changed = JSON.parse(JSON.stringify(fixture.profile));
    changed.anthropometricsM.shoulderWidth += 0.001;
    changed.sha256 = profileSha256(changed);
    expect(() => assertVisualFidelityEvidence(changed, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE', message: expect.stringContaining('profile-basis binding mismatch')}));
  });

  it('rejects candidate-byte mismatch and report candidate mismatch after dependent hashes are repaired', () => {
    expect(() => assertVisualFidelityEvidence(fixture.profile, Buffer.from('wrong candidate'), {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));

    const manifest = JSON.parse(JSON.stringify(fixture.manifest));
    const entry = manifest.evidenceFiles.find((item: any) => item.role === 'optical-property-matrix');
    const matrixPath = path.join(fixture.evidenceRoot, entry.path);
    const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
    matrix.rev8Glb.sha256 = '0'.repeat(64);
    fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);
    entry.sha256 = sha256(fs.readFileSync(matrixPath));
    refreshManifest(fixture, manifest);
    expect(() => assertVisualFidelityEvidence(fixture.profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE', message: expect.stringContaining('report profile or candidate binding')}));
  });

  it('rejects a circular full-profile digest field even when the manifest is rehashed', () => {
    const manifest = JSON.parse(JSON.stringify(fixture.manifest));
    manifest.profileSha256 = fixture.profile.sha256;
    refreshManifest(fixture, manifest);
    expect(() => assertVisualFidelityEvidence(fixture.profile, fixture.candidateBytes, {
      evidenceRoot: fixture.evidenceRoot,
    })).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE', message: expect.stringContaining('hash cycle')}));
  });
});
