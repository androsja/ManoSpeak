const crypto = require('crypto');
const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v1.json');
const mechanicalEnvelope = require('../../../schemas/rig-profiles/vozual-rig-1.mechanical-limits.v1.json');
const {
  canonicalJson,
  rigProfileSha256,
  validateKinematicMotionV3,
} = require('../kinematic-motion-v3.cjs');

function hand() {
  const finger = () => ({mcp: {flexionDeg: 0, abductionDeg: 0, twistDeg: 0}, pip: {flexionDeg: 0}, dip: {flexionDeg: 0}});
  return {
    wrist: {positionM: [0, 0, 0], orientationQuat: [0, 0, 0, 1]},
    joints: {
      thumb: {cmc: {flexionDeg: 0, abductionDeg: 0, twistDeg: 0}, mcp: {flexionDeg: 0, abductionDeg: 0, twistDeg: 0}, ip: {flexionDeg: 0}},
      index: finger(), middle: finger(), ring: finger(), pinky: finger(),
    },
  };
}

function motion() {
  const keyframe = (id: string, timeMs: number) => ({id, timeMs, hands: {left: hand(), right: hand()}});
  return {
    schema: 'vozual.motion-schema', schemaVersion: 3, kind: 'authored-kinematic-motion', id: 'fixture.v3', revision: 1,
    rig: {profileId: profile.id, profileRevision: profile.revision, sha256: profile.sha256, jointMapRevision: 1, landmarkMapRevision: 1},
    units: {length: 'm', angle: 'deg', time: 'ms'},
    linguisticIntent: {language: 'lsc-CO', glossSequence: ['SYNTHETIC_TEST'], regionalVariant: 'not-applicable', phases: [{id: 'stroke', role: 'stroke', fromMs: 0, toMs: 400, nonManualIds: []}]},
    kinematicRealization: {
      durationMs: 400, keyframes: [keyframe('start', 0), keyframe('end', 400)], nonManuals: [],
      contacts: [{id: 'thumb-index', fromMs: 50, toMs: 200, strength: 'required', a: 'hand.right.thumb.tip', b: 'hand.right.index.tip', maxSeparationM: 0.004}],
      proximities: [], relativePoses: [], jointRelations: [], trajectories: [],
      transitions: [{id: 'start-end', fromKeyframeId: 'start', toKeyframeId: 'end', curve: 'cubic', continuous: ['position', 'orientation', 'velocity'], maxSpeedMps: 1, maxAccelerationMps2: 2, maxJerkMps3: 4}],
    },
    provenance: {authorId: 'fixture', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', sourceSha256: 'b'.repeat(64)},
    linguisticReview: {status: 'draft', language: 'lsc-CO', reviewerId: null, reviewedAt: null},
  };
}

describe('kinematic motion v3 validation', () => {
  it('accepts a complete bilateral authored motion and verifies the rig checksum', () => {
    expect(rigProfileSha256(profile)).toBe(profile.sha256);
    expect(validateKinematicMotionV3(motion(), profile)).toEqual(expect.objectContaining({durationMs: 400, keyframeCount: 2}));
  });

  it('keeps the published mechanical envelope synchronized with the v1 profile', () => {
    const {sha256, ...unsignedEnvelope} = mechanicalEnvelope;
    expect(sha256).toBe(crypto.createHash('sha256').update(canonicalJson(unsignedEnvelope)).digest('hex'));
    expect(mechanicalEnvelope.profileId).toBe(profile.id);
    expect(mechanicalEnvelope.profileRevision).toBe(profile.revision);
    expect(mechanicalEnvelope.profileSha256).toBe(profile.sha256);
    expect(mechanicalEnvelope.jointLimitsDeg).toEqual(profile.jointLimitsDeg);
    expect(mechanicalEnvelope.anatomicalStatus).toBe('unsupported');
  });

  it('rejects a finger outside the anatomy defined by the rig', () => {
    const document = motion();
    document.kinematicRealization.keyframes[1].hands.right.joints.index.pip.flexionDeg = 200;
    expect(() => validateKinematicMotionV3(document, profile)).toThrow(expect.objectContaining({code: 'KINEMATIC.JOINT_LIMIT'}));
  });

  it('rejects a contact that names the same endpoint twice', () => {
    const document = motion();
    document.kinematicRealization.contacts[0].b = 'hand.right.thumb.tip';
    expect(() => validateKinematicMotionV3(document, profile)).toThrow(expect.objectContaining({code: 'KINEMATIC.SELF_CONTACT'}));
  });

  it('rejects a body-local orientation that contradicts the declared palm direction', () => {
    const document = motion();
    document.kinematicRealization.keyframes[0].hands.left.wrist.orientationSpace = 'body-local';
    document.kinematicRealization.keyframes[0].hands.left.wrist.palmFacingDirection = [0, 1, 0];
    expect(() => validateKinematicMotionV3(document, profile)).toThrow(expect.objectContaining({code: 'KINEMATIC.PALM_FACING'}));
  });
});
