const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');
const {assertReachableTarget, requireRigCapabilities, validateRigCapabilityProfile} = require('../rig-capability-profile.cjs');

describe('rig capability profile', () => {
  it('binds the measured profile by checksum and accepts its verified manual capabilities', () => {
    expect(validateRigCapabilityProfile(profile)).toBe(profile);
    expect(() => requireRigCapabilities(profile, ['manual.fingerJoints', 'manual.palmOrientation', 'arm.parentHierarchy'])).not.toThrow();
  });

  it('rejects a recipe requirement that the profile does not declare', () => {
    expect(() => requireRigCapabilities(profile, ['contactSolving'])).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('reports the measured reach limit for an unreachable target', () => {
    try {
      assertReachableTarget(profile, 1);
      throw new Error('expected an unreachable target');
    } catch (error) {
      expect(error).toMatchObject({code: 'KINEMATIC.UNREACHABLE'});
      expect((error as {details: {maximumReachM: number}}).details.maximumReachM).toBeCloseTo(0.652148);
    }
  });
});
