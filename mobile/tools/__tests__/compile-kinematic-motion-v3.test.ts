const profile = require('../../../schemas/rig-profiles/vozual-rig-1.v1.json');
const adios = require('../../assets/motions/adios.motion.v3.json');
const {compileKinematicMotionV3, transitionProgress} = require('../compile-kinematic-motion-v3.cjs');

function hand(positionX = 0) {
  const finger = () => ({mcp: {flexionDeg: 0, abductionDeg: 0, twistDeg: 0}, pip: {flexionDeg: 0}, dip: {flexionDeg: 0}});
  return {wrist: {positionM: [positionX, 0, 0], orientationQuat: [0, 0, 0, 1]}, joints: {thumb: {cmc: {flexionDeg: 0, abductionDeg: 0, twistDeg: 0}, mcp: {flexionDeg: 0, abductionDeg: 0, twistDeg: 0}, ip: {flexionDeg: 0}}, index: finger(), middle: finger(), ring: finger(), pinky: finger()}};
}

function sourceMotion() {
  return {
    schema: 'vozual.motion-schema', schemaVersion: 3, kind: 'authored-kinematic-motion', id: 'fixture.compiled-v3', revision: 1,
    rig: {profileId: profile.id, profileRevision: profile.revision, sha256: profile.sha256, jointMapRevision: 1, landmarkMapRevision: 1}, units: {length: 'm', angle: 'deg', time: 'ms'},
    linguisticIntent: {language: 'lsc-CO', glossSequence: ['SYNTHETIC_TEST'], regionalVariant: 'not-applicable', phases: [{id: 'stroke', role: 'stroke', fromMs: 0, toMs: 1000, nonManualIds: ['smile']}]},
    kinematicRealization: {
      durationMs: 1000,
      keyframes: [{id: 'start', timeMs: 0, hands: {left: hand(0), right: hand(0)}}, {id: 'end', timeMs: 1000, hands: {left: hand(1), right: hand(1)}}],
      nonManuals: [{id: 'smile', fromMs: 0, toMs: 1000, headRotationDeg: [0, 0, 0], gazeDirection: [0, 0, 1], browRaise: 0.2, mouthOpening: 0, mouthPucker: 0}],
      contacts: [], proximities: [], relativePoses: [], jointRelations: [], trajectories: [],
      transitions: [{id: 'start-end', fromKeyframeId: 'start', toKeyframeId: 'end', curve: 'cubic', continuous: ['position', 'orientation'], maxSpeedMps: 2, maxAccelerationMps2: 4, maxJerkMps3: 8}],
    },
    provenance: {authorId: 'fixture', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', sourceSha256: 'b'.repeat(64)}, linguisticReview: {status: 'draft', language: 'lsc-CO', reviewerId: null, reviewedAt: null},
  };
}

describe('compileKinematicMotionV3', () => {
  it('raises ADIOS once and alternates the forearm from the elbow while preserving the palm', () => {
    const {plan} = compileKinematicMotionV3(adios, profile, {sampleRateHz: 120});
    const raised = plan.frames.find((item: {timeMs: number}) => item.timeMs === 900);
    const raiseArc = plan.frames.find((item: {timeMs: number}) => item.timeMs === 450);
    const waveRight1 = plan.frames.find((item: {timeMs: number}) => item.timeMs === 1400);
    const waveLeft1 = plan.frames.find((item: {timeMs: number}) => item.timeMs === 1900);
    const waveRight2 = plan.frames.find((item: {timeMs: number}) => item.timeMs === 2400);
    const waveLeft2 = plan.frames.find((item: {timeMs: number}) => item.timeMs === 2900);
    const waveFrames = [waveRight1, waveLeft1, waveRight2, waveLeft2];

    expect(plan.source.revision).toBe(adios.revision);
    expect(raiseArc.hands.left.wrist.positionM).toEqual([0.28, 0.13, 0.05]);
    expect(raised.hands.left.wrist.positionM[1]).toBeGreaterThanOrEqual(0.18);
    waveFrames.forEach(frame => {
      frame.hands.left.wrist.positionM.forEach((value: number, index: number) => {
        expect(value).toBeCloseTo(raised.hands.left.wrist.positionM[index]);
      });
      expect(frame.hands.left.wrist.orientationSpace).toBe('body-local');
      expect(frame.hands.left.wrist.palmFacingDirection).toEqual([0, 0, 1]);
      expect(frame.hands.left.joints).toEqual(raised.hands.left.joints);
      expect(frame.hands.right.wrist.positionM).toEqual([0, 0, 0]);
    });
    expect(raised.hands.left.arm.elbow.rotationDeg).toEqual([0, 0, 0]);
    expect(waveRight1.hands.left.arm.elbow.rotationDeg).toEqual([0, 0, 10]);
    expect(waveLeft1.hands.left.arm.elbow.rotationDeg).toEqual([0, 0, -10]);
    expect(waveRight2.hands.left.arm.elbow.rotationDeg).toEqual([0, 0, 10]);
    expect(waveLeft2.hands.left.arm.elbow.rotationDeg).toEqual([0, 0, -10]);
    expect(waveRight1.hands.left.wrist.relativeToForearmDeg).toEqual([0, 0, 5]);
    expect(waveLeft1.hands.left.wrist.relativeToForearmDeg).toEqual([0, 0, -5]);
    expect(waveRight1.hands.left.wrist.orientationQuat).toEqual(waveRight2.hands.left.wrist.orientationQuat);
    expect(waveLeft1.hands.left.wrist.orientationQuat).toEqual(waveLeft2.hands.left.wrist.orientationQuat);
    expect(raised.hands.left.wrist.orientationQuat).toEqual([0, 0, 0, 1]);
    expect(waveRight1.hands.left.wrist.orientationQuat[2]).toBeGreaterThan(0);
    expect(waveLeft1.hands.left.wrist.orientationQuat[2]).toBeLessThan(0);
    expect(waveRight1.hands.left.wrist.orientationQuat[3]).toBe(waveLeft1.hands.left.wrist.orientationQuat[3]);
    expect(plan.frames.every((frame: {nonManual: {smile: number}}) => frame.nonManual.smile === 0.9)).toBe(true);
    expect(raised.hands.right.wrist.positionM).toEqual([0, 0, 0]);
  });
  it('produces a deterministic sampled execution plan from the authored JSON', () => {
    const first = compileKinematicMotionV3(sourceMotion(), profile, {sampleRateHz: 60});
    const second = compileKinematicMotionV3(sourceMotion(), profile, {sampleRateHz: 60});
    expect(first.sha256).toBe(second.sha256);
    expect(first.plan.frames[0].hands.right.wrist.positionM[0]).toBe(0);
    expect(first.plan.frames.at(-1).hands.right.wrist.positionM[0]).toBe(1);
    expect(first.plan.frames.find((frame: {timeMs: number}) => frame.timeMs === 500)?.hands.right.wrist.positionM[0]).toBe(0.5);
    expect(first.plan.frames.find((frame: {timeMs: number}) => frame.timeMs === 250)?.hands.right.wrist.positionM[0]).toBe(0.15625);
    expect(first.plan.frames[0].nonManual.id).toBe('smile');
  });

  it('honors linear and cubic transition curves', () => {
    expect(transitionProgress('linear', 0.25)).toBe(0.25);
    expect(transitionProgress('cubic', 0.25)).toBe(0.15625);
    expect(transitionProgress('cubic', 0.75)).toBe(0.84375);
  });

  it('compiles a reusable stationary-arm wrist rotation', () => {
    const source = sourceMotion();
    source.kinematicRealization.keyframes[1].hands.left.wrist.positionM = [0, 0, 0];
    source.kinematicRealization.keyframes[1].hands.left.wrist.orientationQuat = [0, 0, 1, 0];

    const {plan} = compileKinematicMotionV3(source, profile, {sampleRateHz: 60});
    const midpoint = plan.frames.find((frame: {timeMs: number}) => frame.timeMs === 500);

    expect(plan.frames.every((frame: {hands: {left: {wrist: {positionM: number[]}}}}) => (
      frame.hands.left.wrist.positionM.every(value => value === 0)
    ))).toBe(true);
    expect(midpoint.hands.left.wrist.orientationQuat[2]).toBeCloseTo(Math.SQRT1_2);
    expect(midpoint.hands.left.wrist.orientationQuat[3]).toBeCloseTo(Math.SQRT1_2);
    expect(midpoint.hands.left.arm).toBeUndefined();
  });
});
