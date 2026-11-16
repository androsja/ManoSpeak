const crypto = require('crypto');
const sourceProfile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');
const {profileSha256, restAxesInventorySha256} = require('../rig-capability-profile.cjs');
const {assertV4CompiledRigBinding, bindRigForV4Compilation} = require('../v4-rig-compile-binding.cjs');

describe('v4 rig compile binding', () => {
  function artifact(binding: any) {
    return {
      rig: binding,
      conformanceDiagnostics: {
        mechanicalObservation: {
          manifestSha256: binding.mechanicalObservationManifestSha256,
          reportRawSha256: binding.mechanicalObservationReportRawSha256,
          reportProjectionSha256: binding.mechanicalObservationReportProjectionSha256,
          candidateSha256: binding.candidateSha256,
          restAxesInventorySha256: binding.restAxesInventorySha256,
          claim: 'observed-mechanical-response-only',
          disposition: 'provenance-only-no-executable-authorization',
          boneCount: 171,
          signedAxisSampleCount: 1026,
          samplesWithWeightedDisplacement: 1026,
        },
      },
    };
  }

  function fixture() {
    const candidateBytes = Buffer.from('temporary validation candidate');
    const profile = JSON.parse(JSON.stringify(sourceProfile));
    profile.asset.candidateSha256 = crypto.createHash('sha256').update(candidateBytes).digest('hex');
    profile.descriptor.boneInventory.restAxesInventory.candidateSha256 = profile.asset.candidateSha256;
    profile.descriptor.boneInventory.restAxesInventory.sha256 = restAxesInventorySha256(profile.descriptor.boneInventory.restAxesInventory);
    profile.descriptor.mechanicalObservationEvidence.candidateSha256 = profile.asset.candidateSha256;
    profile.descriptor.mechanicalObservationEvidence.restAxesInventorySha256 = profile.descriptor.boneInventory.restAxesInventory.sha256;
    profile.sha256 = profileSha256(profile);
    const mechanicalObservation = {
      manifestSha256: profile.descriptor.mechanicalObservationEvidence.manifestSha256,
      reportProjectionSha256: profile.descriptor.mechanicalObservationEvidence.reportProjectionSha256,
      reportRawSha256: 'a'.repeat(64),
      candidateSha256: profile.asset.candidateSha256,
      restAxesInventorySha256: profile.descriptor.boneInventory.restAxesInventory.sha256,
    };
    return {candidateBytes, profile, mechanicalObservation};
  }

  it('binds the exact profile, candidate bytes, and required declared capabilities', () => {
    const {candidateBytes, profile, mechanicalObservation} = fixture();
    const binding = bindRigForV4Compilation(profile, candidateBytes, ['arm.parentHierarchy', 'manual.fingerJoints'], mechanicalObservation);
    expect(binding).toMatchObject({
      profileId: profile.id,
      profileRevision: profile.revision,
      profileSha256: profile.sha256,
      candidateSha256: profile.asset.candidateSha256,
      restAxesInventorySha256: profile.descriptor.boneInventory.restAxesInventory.sha256,
      mechanicalObservationManifestSha256: profile.descriptor.mechanicalObservationEvidence.manifestSha256,
      mechanicalObservationReportProjectionSha256: profile.descriptor.mechanicalObservationEvidence.reportProjectionSha256,
      mechanicalObservationReportRawSha256: mechanicalObservation.reportRawSha256,
      requiredCapabilities: ['arm.parentHierarchy', 'manual.fingerJoints'],
      candidateStatus: 'temporary-uncertified',
    });
    expect(() => assertV4CompiledRigBinding(artifact(binding), binding)).not.toThrow();
    expect(Object.isFrozen(binding)).toBe(true);
  });

  it('rejects an unbound asset, unsupported capability, or mismatched artifact hash', () => {
    const {candidateBytes, profile, mechanicalObservation} = fixture();
    expect(() => bindRigForV4Compilation(profile, Buffer.from('different bytes'), ['manual.fingerJoints'], mechanicalObservation))
      .toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    expect(() => bindRigForV4Compilation(profile, candidateBytes, ['arm.reachability'], mechanicalObservation))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    const binding = bindRigForV4Compilation(profile, candidateBytes, ['manual.fingerJoints'], mechanicalObservation);
    expect(() => assertV4CompiledRigBinding({...artifact(binding), rig: {...binding, profileSha256: '0'.repeat(64)}}, binding))
      .toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    expect(() => assertV4CompiledRigBinding({...artifact(binding), rig: {...binding, mechanicalObservationManifestSha256: '0'.repeat(64)}}, binding))
      .toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    expect(() => assertV4CompiledRigBinding({...artifact(binding), conformanceDiagnostics: {mechanicalObservation: {
      ...artifact(binding).conformanceDiagnostics.mechanicalObservation, reportRawSha256: '0'.repeat(64),
    }}}, binding)).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    for (const key of ['candidateSha256', 'restAxesInventorySha256']) {
      expect(() => assertV4CompiledRigBinding({...artifact(binding), conformanceDiagnostics: {mechanicalObservation: {
        ...artifact(binding).conformanceDiagnostics.mechanicalObservation, [key]: '0'.repeat(64),
      }}}, binding)).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    }
    const missingManifestBinding = {...binding};
    delete missingManifestBinding.mechanicalObservationManifestSha256;
    expect(() => assertV4CompiledRigBinding({...artifact(binding), rig: missingManifestBinding}, binding))
      .toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    expect(() => assertV4CompiledRigBinding({...artifact(binding), conformanceDiagnostics: undefined}, binding))
      .toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });
});
