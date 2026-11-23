const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');
const {anthropometricToMeters, assertReachableTarget, profileSha256, restAxesInventorySha256, requireRigCapabilities, validateRigCapabilityProfile, verifyCandidateAsset} = require('../rig-capability-profile.cjs');

describe('rig capability profile', () => {
  function bindSyntheticCandidate(candidate: any, bytes: Buffer) {
    candidate.asset.candidateSha256 = require('crypto').createHash('sha256').update(bytes).digest('hex');
    candidate.descriptor.boneInventory.restAxesInventory.candidateSha256 = candidate.asset.candidateSha256;
    candidate.descriptor.boneInventory.restAxesInventory.sha256 = restAxesInventorySha256(candidate.descriptor.boneInventory.restAxesInventory);
    candidate.descriptor.mechanicalObservationEvidence.candidateSha256 = candidate.asset.candidateSha256;
    candidate.descriptor.mechanicalObservationEvidence.restAxesInventorySha256 = candidate.descriptor.boneInventory.restAxesInventory.sha256;
    candidate.sha256 = profileSha256(candidate);
  }

  it('binds the measured profile by checksum and accepts its verified manual capabilities', () => {
    expect(validateRigCapabilityProfile(profile)).toBe(profile);
    expect(() => requireRigCapabilities(profile, ['manual.fingerJoints', 'arm.parentHierarchy', 'face.parentHierarchy', 'skin.deformation'])).not.toThrow();
    expect(() => requireRigCapabilities(profile, ['manual.palmOrientation'])).toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
  });

  it('rejects a recipe requirement that the profile does not declare', () => {
    expect(() => requireRigCapabilities(profile, ['contactSolving'])).toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
  });

  it('reports the measured reach limit for an unreachable target', () => {
    try {
      assertReachableTarget(profile, 1, 'left');
      throw new Error('expected an unreachable target');
    } catch (error) {
      expect(error).toMatchObject({code: 'KINEMATIC.UNREACHABLE'});
      expect((error as {details: {maximumReachM: number}}).details.maximumReachM).toBeCloseTo(0.652148);
    }
  });

  it('rejects incomplete profiles even when their checksum is valid', () => {
    const incomplete = JSON.parse(JSON.stringify(profile));
    delete incomplete.anthropometricsM.leftForearmLength;
    incomplete.sha256 = profileSha256(incomplete);
    expect(() => assertReachableTarget(incomplete, 1000, 'left')).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    const empty = {schema: profile.schema, schemaVersion: 2, sha256: ''};
    empty.sha256 = profileSha256(empty);
    expect(() => validateRigCapabilityProfile(empty)).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));

    const missingDescriptor = JSON.parse(JSON.stringify(profile));
    delete missingDescriptor.descriptor.endpointGeometry;
    missingDescriptor.sha256 = profileSha256(missingDescriptor);
    expect(() => validateRigCapabilityProfile(missingDescriptor)).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));

    const overTolerance = JSON.parse(JSON.stringify(profile));
    overTolerance.descriptor.skinning.maxObservedSurfaceDeviationM = 0.02;
    overTolerance.sha256 = profileSha256(overTolerance);
    expect(() => validateRigCapabilityProfile(overTolerance)).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('does not declare an inner-bound target reachable without a solver', () => {
    expect(() => assertReachableTarget(profile, 0.5, 'left')).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('requires an explicit side and uses the measured right arm lengths', () => {
    expect(() => assertReachableTarget(profile, 1)).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    try {
      assertReachableTarget(profile, 1, 'right');
      throw new Error('expected an unreachable target');
    } catch (error) {
      expect(error).toMatchObject({code: 'KINEMATIC.UNREACHABLE', details: {side: 'right'}});
      expect((error as {details: {maximumReachM: number}}).details.maximumReachM).toBeCloseTo(0.653762);
    }
  });

  it('rejects malformed chains and capability status even when rehashed', () => {
    const invalid = JSON.parse(JSON.stringify(profile));
    invalid.deformChains.right = [];
    invalid.sha256 = profileSha256(invalid);
    expect(() => validateRigCapabilityProfile(invalid)).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    invalid.deformChains.right = [...profile.deformChains.right];
    invalid.capabilities.endpointGeometry = 'invented';
    invalid.sha256 = profileSha256(invalid);
    expect(() => validateRigCapabilityProfile(invalid)).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('binds the candidate bytes and rejects a different asset', () => {
    const bytes = Buffer.from('synthetic candidate');
    const candidate = JSON.parse(JSON.stringify(profile));
    bindSyntheticCandidate(candidate, bytes);
    expect(() => verifyCandidateAsset(candidate, bytes)).not.toThrow();
    expect(() => verifyCandidateAsset(candidate, Buffer.from('different asset'))).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('converts calibrated body and explicitly sided units to metres', () => {
    expect(anthropometricToMeters(profile, 2, 'shoulderWidth')).toBeCloseTo(0.584638);
    expect(anthropometricToMeters(profile, 1, 'handLength', 'right')).toBeCloseTo(0.173771);
    expect(anthropometricToMeters(profile, -0.5, 'forearmLength', 'left')).toBeCloseTo(-0.101204);
    expect(() => anthropometricToMeters(profile, 1, 'handLength')).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    expect(() => anthropometricToMeters(profile, Infinity, 'shoulderWidth')).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    expect(() => anthropometricToMeters(profile, 1, 'toString')).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('rejects malformed capability requests instead of skipping the check', () => {
    expect(() => requireRigCapabilities(profile, 'manual.fingerJoints')).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    expect(() => requireRigCapabilities(profile, [null])).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('rejects a rehashed profile with incomplete measured coordinate calibration', () => {
    const invalid = JSON.parse(JSON.stringify(profile));
    invalid.descriptor.coordinateCalibration.endpointConformancePose.targetBodyOrientationQuat = [0, 0, 0];
    invalid.sha256 = profileSha256(invalid);
    expect(() => validateRigCapabilityProfile(invalid)).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('validates a candidate-bound measured rest-axis inventory without claiming joint limits', () => {
    const inventory = profile.descriptor.boneInventory.restAxesInventory;
    expect(profile.revision).toBe(8);
    expect(profile.descriptor.boneInventory.localAxes).toBe('measured');
    expect(Object.keys(inventory.bones)).toHaveLength(profile.descriptor.boneInventory.count);
    expect(inventory.candidateSha256).toBe(profile.asset.candidateSha256);
    expect(profile.descriptor.degreesOfFreedom.status).toBe('unsupported');
    expect(profile.descriptor.jointLimits.status).toBe('unsupported');
    expect(validateRigCapabilityProfile(profile)).toBe(profile);
  });

  it('rejects measured axes with a recomputed profile checksum but missing or invalid inventory', () => {
    const missing = JSON.parse(JSON.stringify(profile));
    delete missing.descriptor.boneInventory.restAxesInventory;
    missing.sha256 = profileSha256(missing);
    expect(() => validateRigCapabilityProfile(missing)).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));

    const malformed = JSON.parse(JSON.stringify(profile));
    malformed.descriptor.boneInventory.restAxesInventory.bones['DEF-thumb.01.L'].axes.x = [2, 0, 0];
    malformed.descriptor.boneInventory.restAxesInventory.sha256 = restAxesInventorySha256(malformed.descriptor.boneInventory.restAxesInventory);
    malformed.descriptor.mechanicalObservationEvidence.restAxesInventorySha256 = malformed.descriptor.boneInventory.restAxesInventory.sha256;
    malformed.sha256 = profileSha256(malformed);
    expect(() => validateRigCapabilityProfile(malformed)).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('requires a hash-shaped, candidate/inventory-bound observation reference without claiming executable support', () => {
    const reference = profile.descriptor.mechanicalObservationEvidence;
    expect(reference).toMatchObject({
      schema: 'vozual.task3-14.mechanical-observation-evidence-manifest',
      schemaVersion: 1,
      claim: 'observed-mechanical-response-only',
      executableCapability: false,
      candidateSha256: profile.asset.candidateSha256,
      restAxesInventorySha256: profile.descriptor.boneInventory.restAxesInventory.sha256,
    });
    expect(reference.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(reference.reportProjectionSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(profile.descriptor.degreesOfFreedom.status).toBe('unsupported');
    expect(profile.descriptor.jointLimits.status).toBe('unsupported');

    const missing = JSON.parse(JSON.stringify(profile));
    delete missing.descriptor.mechanicalObservationEvidence;
    missing.sha256 = profileSha256(missing);
    expect(() => validateRigCapabilityProfile(missing)).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));

    const wrongCandidate = JSON.parse(JSON.stringify(profile));
    wrongCandidate.descriptor.mechanicalObservationEvidence.candidateSha256 = '0'.repeat(64);
    wrongCandidate.sha256 = profileSha256(wrongCandidate);
    expect(() => validateRigCapabilityProfile(wrongCandidate)).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));

    const claimedDof = JSON.parse(JSON.stringify(profile));
    claimedDof.descriptor.degreesOfFreedom.status = 'measured';
    claimedDof.sha256 = profileSha256(claimedDof);
    expect(() => validateRigCapabilityProfile(claimedDof)).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));

    const claimedJointLimits = JSON.parse(JSON.stringify(profile));
    claimedJointLimits.descriptor.jointLimits = {status: 'measured', valuesDeg: {'DEF-thumb.01.L.x': [-10, 10]}};
    claimedJointLimits.sha256 = profileSha256(claimedJointLimits);
    expect(() => validateRigCapabilityProfile(claimedJointLimits)).toThrow(expect.objectContaining({
      code: 'COMPATIBILITY.RIG_PROFILE',
      message: expect.stringContaining('Observed mechanical responses cannot declare anatomical degrees of freedom or joint limits'),
    }));
  });

});
