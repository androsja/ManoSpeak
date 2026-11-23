const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sourceProfile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');
const {compileV4RigConformanceRecipe} = require('../compile-motion-v4.cjs');
const {profileSha256, restAxesInventorySha256} = require('../rig-capability-profile.cjs');
const {mechanicalConformanceContract, validateMechanicalConformanceProbes} = require('../rig-mechanical-conformance.cjs');
const isolatedCatalog = require('../../../schemas/rig-profiles/vozual-rig-1.isolated-probes.v2.json');
const {canonicalJson} = require('../rig-capability-profile.cjs');
const repositoryRoot = path.resolve(__dirname, '../../..');
const evidenceRoot = repositoryRoot;
const candidateBytesForProfile = fs.readFileSync(path.join(repositoryRoot,
  '.dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/rig_candidates/748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a.glb'));

function compile(source: any, profile: any, candidateBytes: Buffer) {
  return compileV4RigConformanceRecipe(source, profile, candidateBytes, {evidenceRoot});
}

describe('v4 rig-conformance compiler', () => {
  it('rejects manual authoring intent before producing a plan, even without declared capabilities', () => {
    const intent = structuredClone(require('../../../schemas/fixtures/manual-articulator-intent-v1/asymmetric-draft.json'));
    intent.requiredRigCapabilities = [];
    expect(() => compile(intent, sourceProfile, candidateBytesForProfile)).toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    expect(() => compile(intent, sourceProfile, Buffer.from('wrong'))).toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    intent.hands.left.events[0].toMs = intent.durationMs + 1;
    expect(() => compile(intent, sourceProfile, candidateBytesForProfile)).toThrow(expect.objectContaining({code: 'SCHEMA.INVALID_MANUAL_INTENT'}));
  });
  function fixture(requiredRigCapabilities = ['arm.parentHierarchy']) {
    const candidateBytes = Buffer.from(candidateBytesForProfile);
    const profile = JSON.parse(JSON.stringify(sourceProfile));
    const source = {
      schema: 'vozual.motion-source',
      schemaVersion: 4,
      purpose: 'rig-conformance',
      id: 'rig-conformance-neutral',
      revision: 1,
      linguisticIntent: {requiredRigCapabilities},
      temporalGraph: {nodes: []},
      constraints: {reachabilityProbes: []},
      rigRealizationOverrides: {},
      provenanceAndReview: {technicalConformanceOnly: true},
    };
    return {candidateBytes, profile, source, evidenceRoot};
  }

  describe('calibrated relative hand-pose diagnostics', () => {
    const relativeFixture = require('../../../schemas/fixtures/rig-conformance-v4/relative-hand-pose.json');

    function handPoseFixture() {
      const {candidateBytes, profile} = fixture();
      const source = structuredClone(relativeFixture.source);
      const [constraint] = source.constraints.relativeHandPoses;
      return {candidateBytes, profile, source, constraint};
    }

    it('accepts the calibrated neutral palm relation and emits repeatable transform diagnostics', () => {
      const {candidateBytes, profile, source, constraint} = handPoseFixture();
      const first = compile(source, profile, candidateBytes);
      const second = compile(source, profile, candidateBytes);
      expect(first.bytes.equals(second.bytes)).toBe(true);
      expect(first.artifact.compiler.build).toBe('task7-relative-hand-pose-1');
      expect(first.artifact.frames).toEqual([]);
      expect(first.artifact.rig.requiredCapabilities).toEqual(['endpoint.pointAnchors']);
      const [diagnostic] = first.artifact.conformanceDiagnostics.relativeHandPoses;
      expect(diagnostic).toMatchObject({
        constraintId: constraint.id,
        anchorIds: constraint.anchorIds,
        frameId: 'first-anchor',
        sampleCount: 1,
        worstSample: {timeMs: 0, poseId: 'neutral-rest'},
      });
      expect(diagnostic.worstSample.positionErrorM).toBeLessThan(0.000001);
      expect(diagnostic.worstSample.orientationErrorDeg).toBeLessThan(0.01);
    });

    it('rejects a deliberately incompatible relative position or orientation', () => {
      const positionCase = handPoseFixture();
      positionCase.constraint.targetRelativePositionM[0] += 0.1;
      expect(() => compile(positionCase.source, positionCase.profile, positionCase.candidateBytes))
        .toThrow(expect.objectContaining({code: 'KINEMATIC.RELATIVE_HAND_POSE_OUTSIDE_TOLERANCE'}));

      const orientationCase = handPoseFixture();
      orientationCase.constraint.targetRelativeOrientationWxyz = [0, 0, 0, 1];
      expect(() => compile(orientationCase.source, orientationCase.profile, orientationCase.candidateBytes))
        .toThrow(expect.objectContaining({code: 'KINEMATIC.RELATIVE_HAND_POSE_OUTSIDE_TOLERANCE'}));
    });

    it('rejects malformed relative frames and pose IDs outside the measured evidence', () => {
      const {candidateBytes, profile, source, constraint} = handPoseFixture();
      constraint.frameId = 'body';
      expect(() => compile(source, profile, candidateBytes))
        .toThrow(expect.objectContaining({code: 'SCHEMA.INVALID_RELATIVE_HAND_POSE'}));
      constraint.frameId = 'first-anchor';
      constraint.samples[0].poseId = 'unmeasured-wrist-pose';
      expect(() => compile(source, profile, candidateBytes))
        .toThrow(expect.objectContaining({code: 'KINEMATIC.RELATIVE_HAND_POSE_EVIDENCE_UNAVAILABLE'}));
    });
  });

  describe('calibrated hand-frame normal alignment diagnostics', () => {
    const normalFixture = require('../../../schemas/fixtures/rig-conformance-v4/hand-frame-normal-alignment.json');

    function normalAlignmentFixture() {
      const {candidateBytes, profile} = fixture();
      const source = structuredClone(normalFixture.source);
      const [constraint] = source.constraints.handFrameNormalAlignments;
      return {candidateBytes, profile, source, constraint};
    }

    it('accepts the calibrated hand-frame Z direction and emits deterministic diagnostics', () => {
      const {candidateBytes, profile, source, constraint} = normalAlignmentFixture();
      const first = compile(source, profile, candidateBytes);
      expect(first.bytes.equals(compile(source, profile, candidateBytes).bytes)).toBe(true);
      expect(first.artifact.compiler.build).toBe('task7-hand-frame-normal-1');
      expect(first.artifact.frames).toEqual([]);
      const [diagnostic] = first.artifact.conformanceDiagnostics.handFrameNormalAlignments;
      expect(diagnostic).toMatchObject({
        constraintId: constraint.id,
        anchorId: constraint.anchorId,
        frameId: 'body',
        sampleCount: 1,
        minDot: 0.99,
        worstSample: {timeMs: 0, poseId: 'neutral-rest'},
      });
      expect(diagnostic.worstSample.alignmentDot).toBeGreaterThan(0.999999);
    });

    it('rejects a reversed normal and malformed target vectors', () => {
      const reversed = normalAlignmentFixture();
      reversed.constraint.targetNormalBody = reversed.constraint.targetNormalBody.map(value => -value);
      expect(() => compile(reversed.source, reversed.profile, reversed.candidateBytes))
        .toThrow(expect.objectContaining({code: 'KINEMATIC.HAND_FRAME_NORMAL_MISALIGNED'}));

      const malformed = normalAlignmentFixture();
      malformed.constraint.targetNormalBody[0] *= 2;
      expect(() => compile(malformed.source, malformed.profile, malformed.candidateBytes))
        .toThrow(expect.objectContaining({code: 'SCHEMA.INVALID_HAND_FRAME_NORMAL_ALIGNMENT'}));
    });

    it('rejects unmeasured hand poses and non-palm anchors', () => {
      const {candidateBytes, profile, source, constraint} = normalAlignmentFixture();
      constraint.samples[0].poseId = 'unmeasured-hand-pose';
      expect(() => compile(source, profile, candidateBytes))
        .toThrow(expect.objectContaining({code: 'KINEMATIC.HAND_FRAME_NORMAL_EVIDENCE_UNAVAILABLE'}));
      constraint.samples[0].poseId = 'neutral-rest';
      constraint.anchorId = 'hand.index.tip.left';
      expect(() => compile(source, profile, candidateBytes))
        .toThrow(expect.objectContaining({code: 'SCHEMA.INVALID_HAND_FRAME_NORMAL_ALIGNMENT'}));
    });
  });

  describe('measured body-surface approach diagnostics', () => {
    const bodySurfaceFixture = require('../../../schemas/fixtures/rig-conformance-v4/body-surface-approach.json');

    function bodyApproachFixture() {
      const {candidateBytes, profile} = fixture();
      const source = structuredClone(bodySurfaceFixture.source);
      const [approach] = source.constraints.bodySurfaceApproaches;
      return {candidateBytes, profile, source, approach};
    }

    it('accepts the measured torso approach with a reconstructed surface normal and repeatable diagnostics', () => {
      const {candidateBytes, profile, source, approach} = bodyApproachFixture();
      const before = JSON.stringify(source);
      const first = compile(source, profile, candidateBytes);
      const repeat = compile(source, profile, candidateBytes);
      expect(first.bytes.equals(repeat.bytes)).toBe(true);
      expect(JSON.stringify(source)).toBe(before);
      expect(first.artifact.compiler.build).toBe('task7-body-surface-approach-1');
      expect(first.artifact.frames).toEqual([]);
      expect(first.artifact.rig.requiredCapabilities).toEqual(['endpoint.pointAnchors']);
      const [diagnostic] = first.artifact.conformanceDiagnostics.bodySurfaceApproaches;
      expect(diagnostic).toMatchObject({
        constraintId: approach.id,
        anchorId: approach.anchorId,
        surfaceId: approach.surfaceId,
        frameId: 'body',
        sampleCount: 1,
        contactToleranceM: profile.conformance.contactToleranceM,
        collisionEvidenceScope: 'single-measured-pose-torso-dominant-mask',
        worstSample: {timeMs: 0, poseId: bodySurfaceFixture.expected.poseId},
      });
      expect(diagnostic.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(diagnostic.worstSample.distanceM).toBeCloseTo(bodySurfaceFixture.expected.distanceM, 6);
      expect(diagnostic.worstSample.approachNormalDot).toBeCloseTo(bodySurfaceFixture.expected.approachNormalDot, 6);
      expect(Object.values(diagnostic.worstSample.collisionCounts)).toEqual([0, 0, 0]);
    });

    it('rejects a surface gap or approach angle outside its requested limit', () => {
      const distanceCase = bodyApproachFixture();
      distanceCase.approach.maxDistanceM = 0.005;
      expect(() => compile(distanceCase.source, distanceCase.profile, distanceCase.candidateBytes))
        .toThrow(expect.objectContaining({
          code: 'KINEMATIC.BODY_SURFACE_APPROACH_OUTSIDE_RANGE',
          details: expect.objectContaining({
            worstSample: expect.objectContaining({distanceM: expect.closeTo(bodySurfaceFixture.expected.distanceM, 6)}),
          }),
        }));

      const normalCase = bodyApproachFixture();
      normalCase.approach.minApproachNormalDot = 0.99;
      expect(() => compile(normalCase.source, normalCase.profile, normalCase.candidateBytes))
        .toThrow(expect.objectContaining({code: 'KINEMATIC.BODY_SURFACE_APPROACH_MISALIGNED'}));
    });

    it('rejects an unmeasured pose and unsupported surface references', () => {
      const poseCase = bodyApproachFixture();
      poseCase.approach.samples[0].poseId = 'unmeasured-torso-approach';
      expect(() => compile(poseCase.source, poseCase.profile, poseCase.candidateBytes))
        .toThrow(expect.objectContaining({code: 'KINEMATIC.BODY_SURFACE_APPROACH_EVIDENCE_UNAVAILABLE'}));

      const surfaceCase = bodyApproachFixture();
      surfaceCase.approach.surfaceId = 'unmeasured-surface';
      expect(() => compile(surfaceCase.source, surfaceCase.profile, surfaceCase.candidateBytes))
        .toThrow(expect.objectContaining({code: 'SCHEMA.INVALID_BODY_SURFACE_APPROACH'}));
    });
  });

  describe('measured anchor pair contact diagnostics', () => {
    const pairFixture = require('../../../schemas/fixtures/rig-conformance-v4/anchor-pair-contact.json');
    const {bilateralApproach, bilateralRest, rightIndexMiddleOverlap, thresholdM} = pairFixture.blenderMeasurements;

    function contactFixture() {
      const {candidateBytes, profile} = fixture();
      const source = structuredClone(pairFixture.source);
      const [contact] = source.constraints.anchorPairContacts;
      return {candidateBytes, profile, source, contact};
    }

    it('accepts the measured bilateral pose and reproduces Blender within one micrometer', () => {
      const {candidateBytes, profile, source, contact} = contactFixture();
      const before = JSON.stringify(source);
      const result = compile(source, profile, candidateBytes);
      expect(result.bytes.equals(compile(source, profile, candidateBytes).bytes)).toBe(true);
      expect(JSON.stringify(source)).toBe(before);
      expect(result.artifact.compiler.build).toBe('task7-anchor-pair-contact-1');
      expect(result.artifact.frames).toEqual([]);
      expect(result.artifact.rig.requiredCapabilities).toEqual(['endpoint.pointAnchors']);
      const [diagnostic] = result.artifact.conformanceDiagnostics.anchorPairContacts;
      expect(diagnostic).toMatchObject({
        constraintId: contact.id, anchorIds: contact.anchorIds, frameId: 'body', sampleCount: 1, thresholdM,
        collisionEvidenceScope: 'discrete-measured-pose-scoped-overlaps',
        evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        worstSample: {poseId: 'bilateral-index-approach', timeMs: 0},
      });
      expect(diagnostic.worstSample.distanceM).toBeCloseTo(bilateralApproach.distanceM, 6);
      expect(Object.values(diagnostic.worstSample.overlapCounts)).toEqual(Array(5).fill(bilateralApproach.overlapCount));
      diagnostic.worstSample.anchorBodyPositionsM.forEach((point, anchor) => {
        const error = Math.hypot(...point.map((coordinate, axis) => coordinate - bilateralApproach.positionM[anchor][axis]));
        expect(error).toBeLessThan(0.000001);
      });
    });

    it('retains input anchor order while using the same pair evidence', () => {
      const {candidateBytes, profile, source, contact} = contactFixture();
      contact.anchorIds.reverse();
      const [diagnostic] = compile(source, profile, candidateBytes).artifact.conformanceDiagnostics.anchorPairContacts;
      expect(diagnostic.anchorIds).toEqual(contact.anchorIds);
      expect(diagnostic.worstSample.anchorBodyPositionsM[0][0]).toBeCloseTo(bilateralApproach.positionM[1][0], 6);
      expect(diagnostic.worstSample.distanceM).toBeCloseTo(bilateralApproach.distanceM, 6);
    });

    it('rejects the rest pose as the worst sample for the same two anchors', () => {
      const {candidateBytes, profile, source, contact} = contactFixture();
      contact.samples.unshift({timeMs: 0, poseId: bilateralRest.poseId});
      contact.samples[1].timeMs = 100;
      expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
        code: bilateralRest.error,
        details: expect.objectContaining({
          anchorIds: contact.anchorIds, thresholdM, sampleCount: 2,
          worstSample: expect.objectContaining({
            poseId: bilateralRest.poseId, timeMs: 0, distanceM: expect.closeTo(bilateralRest.distanceM, 6),
          }),
        }),
      }));
    });

    it('rejects measured overlaps even when the pair is within tolerance', () => {
      const {candidateBytes, profile, source, contact} = contactFixture();
      contact.anchorIds = rightIndexMiddleOverlap.anchorIds;
      const {poseId, error, overlapCounts, distanceM} = rightIndexMiddleOverlap;
      expect(distanceM).toBeLessThan(thresholdM);
      contact.samples = [{timeMs: 100, poseId}];
      expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
        code: error,
        details: expect.objectContaining({
          collisionSample: expect.objectContaining({
            timeMs: 100, poseId, distanceM: expect.closeTo(distanceM, 6), overlapCounts,
          }),
        }),
      }));
    });

    it('rejects unknown anchors and unsupported combinations of measured pairs and poses', () => {
      const {candidateBytes, profile, source, contact} = contactFixture();
      const original = contact.anchorIds[1];
      contact.anchorIds[1] = 'hand.unknown.tip.right';
      expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
        code: 'KINEMATIC.UNKNOWN_ANCHOR',
        details: expect.objectContaining({anchorId: contact.anchorIds[1]}),
      }));
      contact.anchorIds[1] = original;
      contact.samples[0].poseId = rightIndexMiddleOverlap.poseId;
      expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
        code: 'KINEMATIC.ANCHOR_PAIR_EVIDENCE_UNAVAILABLE',
      }));
      contact.samples[0].poseId = bilateralRest.poseId;
      contact.anchorIds[1] = 'hand.pinky.tip.right';
      expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
        code: 'KINEMATIC.ANCHOR_PAIR_EVIDENCE_UNAVAILABLE',
      }));
    });

    it('rejects identical anchor IDs, the wrong frame and source-provided pose changes', () => {
      const {candidateBytes, profile, source, contact} = contactFixture();
      const invalid = expect.objectContaining({code: 'SCHEMA.INVALID_ANCHOR_PAIR_CONTACT'});
      const original = contact.anchorIds[1];
      contact.anchorIds[1] = contact.anchorIds[0];
      expect(() => compile(source, profile, candidateBytes)).toThrow(invalid);
      contact.anchorIds[1] = original;
      contact.frameId = 'hand';
      expect(() => compile(source, profile, candidateBytes)).toThrow(invalid);
      contact.frameId = 'body';
      contact.samples[0].rotationCommandsWxyz = {};
      expect(() => compile(source, profile, candidateBytes)).toThrow(invalid);
    });

    describe('ordered contact phases', () => {
      const nearPose = 'bilateral-index-approach';
      const restPose = bilateralRest.poseId;

      function phaseFixture(phase: string, poseIds: string[]) {
        const {candidateBytes, profile, source, contact} = contactFixture();
        contact.phase = phase;
        contact.samples = poseIds.map((poseId, index) => ({timeMs: index * 100, poseId}));
        return {candidateBytes, profile, source, contact};
      }

      it('checks approach, hold and release with the calibrated pair', () => {
        const {candidateBytes, profile, source, contact} = phaseFixture('approach', [restPose, nearPose]);
        source.constraints.anchorPairContacts.push({
          ...contact, id: 'hold-pair', phase: 'hold',
          samples: [{timeMs: 100, poseId: nearPose}, {timeMs: 250, poseId: nearPose}],
        }, {
          ...contact, id: 'release-pair', phase: 'release',
          samples: [{timeMs: 250, poseId: nearPose}, {timeMs: 350, poseId: restPose}],
        });
        const result = compile(source, profile, candidateBytes);
        expect(result.bytes.equals(compile(source, profile, candidateBytes).bytes)).toBe(true);
        expect(result.artifact.compiler.build).toBe('task7-anchor-pair-phase-1');
        expect(result.artifact.frames).toEqual([]);
        const [approach, hold, release] = result.artifact.conformanceDiagnostics.anchorPairContacts;
        expect(approach).toMatchObject({
          phase: 'approach', thresholdM, startSample: {timeMs: 0, poseId: restPose},
          endSample: {timeMs: 100, distanceM: expect.closeTo(bilateralApproach.distanceM, 6)},
          worstSample: {timeMs: 0, distanceM: expect.closeTo(bilateralRest.distanceM, 6)},
        });
        expect(hold).toMatchObject({
          phase: 'hold', endSample: {timeMs: 250, poseId: nearPose},
          worstSample: {timeMs: 100, distanceM: expect.closeTo(bilateralApproach.distanceM, 6)},
        });
        expect(release).toMatchObject({
          phase: 'release', startSample: {timeMs: 250, poseId: nearPose},
          endSample: {timeMs: 350, poseId: restPose}, worstSample: {timeMs: 350, poseId: restPose},
        });
      });

      it.each([
        {phase: 'approach', poseIds: [restPose, restPose], contactTimeMs: 100, separatedTimeMs: 0},
        {phase: 'release', poseIds: [nearPose, nearPose], contactTimeMs: 0, separatedTimeMs: 100},
      ])('rejects a $phase that never crosses the threshold', ({phase, poseIds, contactTimeMs, separatedTimeMs}) => {
        const {candidateBytes, profile, source} = phaseFixture(phase, poseIds);
        expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
          code: 'KINEMATIC.ANCHOR_PAIR_PHASE_BOUNDARY',
          details: expect.objectContaining({
            phase, thresholdM, contactSample: expect.objectContaining({timeMs: contactTimeMs}),
            separatedSample: expect.objectContaining({timeMs: separatedTimeMs}),
          }),
        }));
      });

      it('reports a separated middle sample during a hold', () => {
        const {candidateBytes, profile, source} = phaseFixture('hold', [nearPose, restPose, nearPose]);
        expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
          code: bilateralRest.error,
          details: expect.objectContaining({phase: 'hold', worstSample: expect.objectContaining({timeMs: 100, poseId: restPose})}),
        }));
      });

      it.each([
        {phase: 'approach', poseIds: [restPose, nearPose, restPose, nearPose]},
        {phase: 'release', poseIds: [nearPose, restPose, nearPose, restPose]},
      ])('reports the worst reversal during $phase despite valid endpoints', ({phase, poseIds}) => {
        const {candidateBytes, profile, source} = phaseFixture(phase, poseIds);
        expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
          code: 'KINEMATIC.ANCHOR_PAIR_PHASE_REVERSAL',
          details: expect.objectContaining({
            phase,
            worstReversal: {
              fromSample: expect.objectContaining({timeMs: 100, poseId: poseIds[1]}),
              toSample: expect.objectContaining({timeMs: 200, poseId: poseIds[2]}),
              reversalM: expect.closeTo(bilateralRest.distanceM - bilateralApproach.distanceM, 6),
            },
          }),
        }));
      });

      it('rejects an approach with a measured overlap even when its distance decreases', () => {
        const {candidateBytes, profile, source, contact} = phaseFixture('approach', [restPose, rightIndexMiddleOverlap.poseId]);
        contact.anchorIds = rightIndexMiddleOverlap.anchorIds;
        expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
          code: rightIndexMiddleOverlap.error,
          details: expect.objectContaining({
            phase: 'approach', collisionSample: expect.objectContaining({timeMs: 100, overlapCounts: rightIndexMiddleOverlap.overlapCounts}),
          }),
        }));
      });

      it.each([
        {phase: 'approach', poseIds: [nearPose]},
        {phase: 'unknown', poseIds: [restPose, nearPose]},
      ])('rejects an unsupported or undersampled phase (%j)', ({phase, poseIds}) => {
        const {candidateBytes, profile, source} = phaseFixture(phase, poseIds);
        expect(() => compile(source, profile, candidateBytes))
          .toThrow(expect.objectContaining({code: 'SCHEMA.INVALID_ANCHOR_PAIR_CONTACT'}));
      });
    });

    describe('anchor pair proximity', () => {
      function proximityFixture(minDistanceM: number, maxDistanceM: number) {
        const {candidateBytes, profile, source, contact} = contactFixture();
        const proximity = {
          ...contact, id: 'finger-proximity', minDistanceM, maxDistanceM,
          anchorIds: rightIndexMiddleOverlap.anchorIds,
          samples: [{timeMs: 100, poseId: bilateralRest.poseId}],
        };
        source.constraints.anchorPairProximities = [proximity];
        delete source.constraints.anchorPairContacts;
        return {candidateBytes, profile, source, proximity};
      }

      it('accepts measured proximity outside the contact threshold', () => {
        const {candidateBytes, profile, source, proximity} = proximityFixture(0.012, 0.02);
        const result = compile(source, profile, candidateBytes);
        expect(result.bytes.equals(compile(source, profile, candidateBytes).bytes)).toBe(true);
        expect(result.artifact.compiler.build).toBe('task7-anchor-pair-proximity-1');
        expect(result.artifact.rig.requiredCapabilities).toEqual(['endpoint.pointAnchors']);
        expect(result.artifact.frames).toEqual([]);
        expect(result.artifact.conformanceDiagnostics.anchorPairProximities).toEqual([expect.objectContaining({
          constraintId: proximity.id, frameId: 'body', minDistanceM: 0.012, maxDistanceM: 0.02,
          worstMarginM: expect.closeTo(0.002968, 6),
          worstSample: expect.objectContaining({timeMs: 100, distanceM: expect.closeTo(0.017032, 6)}),
        })]);
      });

      it('measures neutral-rest proximity for any two declared calibrated hand endpoints without claiming overlap evidence', () => {
        const {candidateBytes, profile, source, proximity} = proximityFixture(0.017, 0.018);
        proximity.anchorIds = ['hand.index.tip.left', 'hand.middle.tip.left'];
        proximity.samples = [{timeMs: 0, poseId: 'neutral-rest'}];
        const result = compile(source, profile, candidateBytes);
        const [diagnostic] = result.artifact.conformanceDiagnostics.anchorPairProximities;
        expect(result.artifact.compiler.build).toBe('task7-calibrated-endpoint-proximity-1');
        expect(result.artifact.frames).toEqual([]);
        expect(diagnostic).toMatchObject({
          anchorIds: proximity.anchorIds,
          evaluationScope: 'blender-cross-checked-calibrated-endpoint-pose-distance-no-overlap-evidence',
          worstSample: {timeMs: 0, poseId: 'neutral-rest', distanceM: expect.closeTo(0.017608885, 8)},
        });
        expect(diagnostic.worstSample.overlapCounts).toBeUndefined();
      });

      it('rejects neutral-rest proximity when the calibrated endpoints fall outside the requested range', () => {
        const {candidateBytes, profile, source, proximity} = proximityFixture(0.01, 0.015);
        proximity.anchorIds = ['hand.index.tip.left', 'hand.middle.tip.left'];
        proximity.samples = [{timeMs: 0, poseId: 'neutral-rest'}];
        expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
          code: 'KINEMATIC.ANCHOR_PAIR_OUTSIDE_PROXIMITY',
          details: expect.objectContaining({
            evaluationScope: 'blender-cross-checked-calibrated-endpoint-pose-distance-no-overlap-evidence',
            worstSample: expect.objectContaining({distanceM: expect.closeTo(0.017608885, 8)}),
          }),
        }));
      });

      it('fails closed when an unevidenced endpoint pair requests a pose absent from the measured inventory', () => {
        const {candidateBytes, profile, source, proximity} = proximityFixture(0.01, 0.03);
        proximity.anchorIds = ['hand.index.tip.left', 'hand.middle.tip.left'];
        proximity.samples = [{timeMs: 0, poseId: 'unmeasured-pose'}];
        expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
          code: 'KINEMATIC.ANCHOR_PAIR_EVIDENCE_UNAVAILABLE',
        }));
      });

      it('evaluates a non-rest proximity pair against Blender-cross-checked endpoint poses without collision claims', () => {
        const {candidateBytes, profile, source, proximity} = proximityFixture(0.0963, 0.0965);
        proximity.anchorIds = ['hand.index.tip.left', 'hand.middle.tip.left'];
        proximity.samples = [{timeMs: 120, poseId: 'bilateral-index-approach'}];
        const result = compile(source, profile, candidateBytes);
        const [diagnostic] = result.artifact.conformanceDiagnostics.anchorPairProximities;
        expect(result.artifact.compiler.build).toBe('task7-calibrated-endpoint-proximity-1');
        expect(diagnostic).toMatchObject({
          evaluationScope: 'blender-cross-checked-calibrated-endpoint-pose-distance-no-overlap-evidence',
          sourcePoseEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          worstSample: expect.objectContaining({
            timeMs: 120,
            poseId: 'bilateral-index-approach',
            distanceM: expect.closeTo(0.096379716, 8),
            maximumMeasurementErrorM: expect.any(Number),
          }),
        });
        expect(diagnostic.worstSample.maximumMeasurementErrorM).toBeLessThan(0.000001);
        expect(diagnostic.worstSample.overlapCounts).toBeUndefined();
      });

      it('rejects mixing pair-scoped overlap samples with endpoint-only pose samples', () => {
        const {candidateBytes, profile, source, proximity} = proximityFixture(0.008, 0.02);
        proximity.samples.push({timeMs: 200, poseId: 'bilateral-index-approach'});
        expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
          code: 'KINEMATIC.ANCHOR_PAIR_EVIDENCE_UNAVAILABLE',
        }));
      });

      it.each([
        {minDistanceM: 0.018, maxDistanceM: 0.02},
        {minDistanceM: 0.01, maxDistanceM: 0.016},
      ])('rejects a sample outside the required range (%j)', ({minDistanceM, maxDistanceM}) => {
        const {candidateBytes, profile, source} = proximityFixture(minDistanceM, maxDistanceM);
        const worstMarginM = Math.min(0.017032 - minDistanceM, maxDistanceM - 0.017032);
        expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
          code: 'KINEMATIC.ANCHOR_PAIR_OUTSIDE_PROXIMITY',
          details: expect.objectContaining({
            minDistanceM, maxDistanceM, worstMarginM: expect.closeTo(worstMarginM, 6),
            worstSample: expect.objectContaining({timeMs: 100, distanceM: expect.closeTo(0.017032, 6)}),
          }),
        }));
      });

      it('finds the largest range violation when different samples miss opposite bounds', () => {
        const {candidateBytes, profile, source, proximity} = proximityFixture(0.012, 1.411);
        proximity.anchorIds = pairFixture.source.constraints.anchorPairContacts[0].anchorIds;
        proximity.samples.push({timeMs: 200, poseId: 'bilateral-index-approach'});
        expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
          code: 'KINEMATIC.ANCHOR_PAIR_OUTSIDE_PROXIMITY',
          details: expect.objectContaining({
            worstMarginM: expect.closeTo(bilateralApproach.distanceM - 0.012, 6),
            worstSample: expect.objectContaining({timeMs: 200, poseId: 'bilateral-index-approach'}),
          }),
        }));
      });

      it('also enforces the measured overlap evidence for proximity', () => {
        const {candidateBytes, profile, source, proximity} = proximityFixture(0.008, 0.02);
        proximity.samples.push({timeMs: 200, poseId: rightIndexMiddleOverlap.poseId});
        expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
          code: rightIndexMiddleOverlap.error,
          details: expect.objectContaining({
            collisionSample: expect.objectContaining({timeMs: 200, overlapCounts: rightIndexMiddleOverlap.overlapCounts}),
          }),
        }));
      });

      it('rejects a malformed proximity range instead of omitting the check', () => {
        const {candidateBytes, profile, source} = proximityFixture(0.02, 0.01);
        expect(() => compile(source, profile, candidateBytes))
          .toThrow(expect.objectContaining({code: 'SCHEMA.INVALID_ANCHOR_PAIR_PROXIMITY'}));
      });
    });

    describe('measured anchor pair trajectories', () => {
      const staggered = 'bilateral-index-ring-first';

      function trajectoryFixture(trajectoryId: string, phase: string) {
        const {candidateBytes, profile, source, contact} = contactFixture();
        delete contact.samples;
        contact.phase = phase;
        contact.trajectory = {id: trajectoryId, fromMs: 100, toMs: 1100};
        return {candidateBytes, profile, source, contact};
      }

      it.each([
        {phase: 'approach', start: bilateralRest.distanceM, end: bilateralApproach.distanceM},
        {phase: 'release', start: bilateralApproach.distanceM, end: bilateralRest.distanceM},
      ])('validates all 101 measured poses during $phase', ({phase, start, end}) => {
        const {candidateBytes, profile, source} = trajectoryFixture(staggered, phase);
        const result = compile(source, profile, candidateBytes);
        expect(result.bytes.equals(compile(source, profile, candidateBytes).bytes)).toBe(true);
        expect(result.artifact.compiler.build).toBe('task7-anchor-pair-trajectory-1');
        expect(result.artifact.frames).toEqual([]);
        const [diagnostic] = result.artifact.conformanceDiagnostics.anchorPairContacts;
        expect(diagnostic).toMatchObject({
          phase, trajectoryId: staggered, sampleCount: 101, thresholdM,
          trajectoryEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          startSample: {timeMs: 100, distanceM: expect.closeTo(start, 6)},
          endSample: {timeMs: 1100, distanceM: expect.closeTo(end, 6)},
        });
      });

      it('rejects the uniform trajectory at its worst measured collision despite acceptable endpoints', () => {
        const {candidateBytes, profile, source} = trajectoryFixture('bilateral-index-uniform', 'approach');
        expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
          code: 'KINEMATIC.ANCHOR_PAIR_SCOPED_OVERLAP',
          details: expect.objectContaining({
            sampleCount: 101,
            startSample: expect.objectContaining({distanceM: expect.closeTo(bilateralRest.distanceM, 6)}),
            endSample: expect.objectContaining({distanceM: expect.closeTo(bilateralApproach.distanceM, 6)}),
            collisionSample: expect.objectContaining({
              timeMs: 270, trajectoryFraction: 0.17,
              overlapCounts: expect.objectContaining({'left-digits': 7, 'right-digits': 6}),
            }),
          }),
        }));
      });

      it('fails closed for an unmeasured trajectory or a trajectory bound to the wrong pair', () => {
        const {candidateBytes, profile, source, contact} = trajectoryFixture('unknown-trajectory', 'approach');
        const error = expect.objectContaining({code: 'KINEMATIC.ANCHOR_PAIR_TRAJECTORY_UNAVAILABLE'});
        expect(() => compile(source, profile, candidateBytes)).toThrow(error);
        contact.trajectory.id = staggered;
        contact.anchorIds = rightIndexMiddleOverlap.anchorIds;
        expect(() => compile(source, profile, candidateBytes)).toThrow(error);
      });

      it('requires a valid phase and a trajectory interval without manual samples', () => {
        const {candidateBytes, profile, source, contact} = trajectoryFixture(staggered, 'hold');
        const error = expect.objectContaining({code: 'SCHEMA.INVALID_ANCHOR_PAIR_CONTACT'});
        expect(() => compile(source, profile, candidateBytes)).toThrow(error);
        contact.phase = 'approach';
        contact.trajectory.toMs = contact.trajectory.fromMs;
        expect(() => compile(source, profile, candidateBytes)).toThrow(error);
        contact.trajectory.toMs = 1100;
        contact.samples = [{timeMs: 100, poseId: 'bilateral-index-approach'}];
        expect(() => compile(source, profile, candidateBytes)).toThrow(error);
      });
    });
  });

  describe('fixed point contact diagnostics', () => {
    const pointFixture = require('../../../schemas/fixtures/rig-conformance-v4/fixed-point-contact.json');
    const {poses, thresholdM} = pointFixture.expected;
    const {anchorId, target} = pointFixture.source.constraints.pointContacts[0];
    const curl = 'left-index-curl-v1';
    const rest = 'neutral-rest';

    function contactFixture(poseIds = [curl]) {
      const {candidateBytes, profile} = fixture();
      const source = structuredClone(pointFixture.source);
      const [contact] = source.constraints.pointContacts;
      contact.samples = poseIds.map((poseId, index) => ({timeMs: index * 100, poseId}));
      return {candidateBytes, profile, source, contact};
    }

    it('matches the Blender curl measurement and emits deterministic diagnostics', () => {
      const {candidateBytes, profile, source} = contactFixture();
      const before = JSON.stringify(source);
      const first = compile(source, profile, candidateBytes);
      const repeat = compile(source, profile, candidateBytes);
      expect(first.bytes.equals(repeat.bytes)).toBe(true);
      expect(JSON.stringify(source)).toBe(before);
      expect(first.artifact.compiler.build).toBe('task7-fixed-point-contact-1');
      expect(first.artifact.frames).toEqual([]);
      expect(first.artifact.rig.requiredCapabilities).toContain('endpoint.pointAnchors');
      const [diagnostic] = first.artifact.conformanceDiagnostics.pointContacts;
      expect(diagnostic).toMatchObject({
        constraintId: 'index-target', anchorId, frameId: 'body',
        targetBodyPositionM: target.positionM, thresholdM, sampleCount: 1,
        worstSample: {timeMs: 0, poseId: curl},
      });
      const expected = poses[curl];
      expect(diagnostic.worstSample.distanceM).toBeCloseTo(expected.distanceM, 6);
      diagnostic.worstSample.anchorBodyPositionM.forEach((coordinate, index) => {
        expect(coordinate).toBeCloseTo(expected.bodyPositionM[index], 6);
      });
    });

    it('accepts a point just inside the calibrated 10 mm limit and rejects one 1 um beyond it', () => {
      const baseline = contactFixture();
      const baselineArtifact = compile(baseline.source, baseline.profile, baseline.candidateBytes).artifact;
      const measuredAnchor = baselineArtifact.conformanceDiagnostics.pointContacts[0].worstSample.anchorBodyPositionM;
      const atBoundary = contactFixture();
      atBoundary.contact.target.positionM = [measuredAnchor[0] + thresholdM - 0.000000001, measuredAnchor[1], measuredAnchor[2]];
      const {artifact} = compile(atBoundary.source, atBoundary.profile, atBoundary.candidateBytes);
      const [diagnostic] = artifact.conformanceDiagnostics.pointContacts;
      expect(diagnostic.frameId).toBe('body');
      expect(diagnostic.thresholdM).toBe(0.01);
      expect(diagnostic.worstSample.distanceM).toBeLessThanOrEqual(thresholdM);
      expect(diagnostic.worstSample.distanceM).toBeGreaterThan(thresholdM - 0.00000001);

      const outside = contactFixture();
      outside.contact.target.positionM = [measuredAnchor[0] + thresholdM + 0.000001, measuredAnchor[1], measuredAnchor[2]];
      expect(() => compile(outside.source, outside.profile, outside.candidateBytes)).toThrow(expect.objectContaining({
        code: 'KINEMATIC.POINT_CONTACT_OUTSIDE_TOLERANCE',
        details: expect.objectContaining({
          frameId: 'body', thresholdM: 0.01,
          worstSample: expect.objectContaining({distanceM: expect.any(Number)}),
        }),
      }));
    });

    it.each([
      {sampleOrder: [curl, rest], expectedTimeMs: 100},
      {sampleOrder: [rest, curl], expectedTimeMs: 0},
    ])('reports the largest separation at $expectedTimeMs ms', ({sampleOrder, expectedTimeMs}) => {
      const {candidateBytes, profile, source} = contactFixture(sampleOrder);
      expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
        code: 'KINEMATIC.POINT_CONTACT_OUTSIDE_TOLERANCE',
        details: expect.objectContaining({
          constraintId: 'index-target', anchorId, frameId: 'body', thresholdM, sampleCount: 2,
          targetBodyPositionM: target.positionM,
          worstSample: expect.objectContaining({
            timeMs: expectedTimeMs, poseId: rest,
            distanceM: expect.closeTo(poses[rest].distanceM, 6),
          }),
        }),
      }));
    });

    it('measures the supplied target instead of using the fixture target', () => {
      const {candidateBytes, profile, source, contact} = contactFixture();
      contact.target.positionM[0] += 0.020;
      expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
        code: 'KINEMATIC.POINT_CONTACT_OUTSIDE_TOLERANCE',
        details: expect.objectContaining({
          worstSample: expect.objectContaining({distanceM: expect.closeTo(0.025, 6)}),
        }),
      }));
    });

    it('rejects an unknown endpoint anchor with its own diagnostic', () => {
      const {candidateBytes, profile, source, contact} = contactFixture();
      contact.anchorId = 'hand.unknown.tip.left';
      expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
        code: 'KINEMATIC.UNKNOWN_ANCHOR',
        details: {constraintId: 'index-target', anchorId: contact.anchorId},
      }));
    });

    it('rejects an endpoint paired with a pose outside its calibrated evidence', () => {
      const alternate = contactFixture();
      alternate.contact.anchorId = 'hand.index.tip.right';
      expect(() => compile(alternate.source, alternate.profile, alternate.candidateBytes))
        .toThrow(expect.objectContaining({code: 'KINEMATIC.UNKNOWN_POSE'}));
      const unknownPose = contactFixture(['unknown-pose']);
      expect(() => compile(unknownPose.source, unknownPose.profile, unknownPose.candidateBytes))
        .toThrow(expect.objectContaining({code: 'KINEMATIC.UNKNOWN_POSE'}));
    });

    it('rejects an uncalibrated target frame, malformed positions and duplicate sample times', () => {
      const {candidateBytes, profile, source, contact} = contactFixture([curl, rest]);
      const invalid = expect.objectContaining({code: 'SCHEMA.INVALID_POINT_CONTACT'});
      contact.target.frameId = 'object';
      expect(() => compile(source, profile, candidateBytes)).toThrow(invalid);
      contact.target.frameId = 'body';
      contact.target.positionM[0] = Number.NaN;
      expect(() => compile(source, profile, candidateBytes)).toThrow(invalid);
      contact.target.positionM[0] = target.positionM[0];
      contact.samples[1].timeMs = contact.samples[0].timeMs;
      expect(() => compile(source, profile, candidateBytes)).toThrow(invalid);
    });
  });

  describe('profile-bound multi-endpoint fixed point diagnostics', () => {
    const endpointPoseEvidence = require('../../../schemas/rig-profiles/vozual-rig-1.endpoint-pose-evidence.v1.json');
    const endpointId = 'hand.middle.tip.left';
    const poseId = 'bilateral-index-approach';

    function endpointPointFixture(targetPositionM = endpointPoseEvidence.poses[poseId][endpointId], samplePoseId = poseId) {
      const {candidateBytes, profile, source} = fixture();
      source.constraints.pointContacts = [{
        id: 'measured-endpoint-target',
        anchorId: endpointId,
        target: {frameId: 'body', positionM: [...targetPositionM]},
        samples: [{timeMs: 25, poseId: samplePoseId}],
      }];
      return {candidateBytes, profile, source};
    }

    it('accepts a profile-bound measured endpoint and emits distance-only diagnostics', () => {
      const {candidateBytes, profile, source} = endpointPointFixture();
      const result = compile(source, profile, candidateBytes);
      const [diagnostic] = result.artifact.conformanceDiagnostics.pointContacts;
      expect(result.artifact.compiler.build).toBe('task7-fixed-point-contact-2');
      expect(result.artifact.frames).toEqual([]);
      expect(diagnostic).toMatchObject({
        constraintId: 'measured-endpoint-target',
        anchorId: endpointId,
        frameId: 'body',
        thresholdM: profile.conformance.contactToleranceM,
        evaluationScope: 'blender-cross-checked-calibrated-endpoint-pose-distance-no-overlap-evidence',
        evidenceSha256: '8fa25424a4b7e7a2ea594dc07f31502c643a55e7d4ea3ab7c28d2b2f9de7f4d4',
        sourcePoseEvidenceSha256: '33988e842cb0f1e9a6d21c84246272e5c3bcde81283a351bc28084404a5ba35f',
        maximumMeasurementErrorM: expect.any(Number),
        worstSample: {timeMs: 25, poseId, distanceM: 0, anchorBodyPositionM: endpointPoseEvidence.poses[poseId][endpointId]},
      });
      expect(diagnostic.worstSample.overlapCounts).toBeUndefined();
      expect(diagnostic.collisionEvidenceScope).toBeUndefined();
    });

    it('rejects a deliberately impossible target distance using the profile tolerance', () => {
      const target = [2, 2, 2];
      const {candidateBytes, profile, source} = endpointPointFixture(target);
      const point = endpointPoseEvidence.poses[poseId][endpointId];
      const expectedDistance = Math.hypot(...point.map((value: number, index: number) => value - target[index]));
      expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
        code: 'KINEMATIC.POINT_CONTACT_OUTSIDE_TOLERANCE',
        details: expect.objectContaining({
          evaluationScope: 'blender-cross-checked-calibrated-endpoint-pose-distance-no-overlap-evidence',
          thresholdM: profile.conformance.contactToleranceM,
          worstSample: expect.objectContaining({poseId, distanceM: expect.closeTo(expectedDistance, 12)}),
        }),
      }));
    });

    it('rejects a pose absent from the pinned endpoint measurement inventory', () => {
      const {candidateBytes, profile, source} = endpointPointFixture();
      source.constraints.pointContacts[0].samples.push({timeMs: 50, poseId: 'unmeasured-endpoint-pose'});
      expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
        code: 'KINEMATIC.UNKNOWN_POSE',
        details: expect.objectContaining({poseId: 'unmeasured-endpoint-pose', timeMs: 50}),
      }));
    });

    it('rejects endpoint evidence whose bytes differ from the compiler pin', () => {
      const {candidateBytes, profile, source} = endpointPointFixture();
      const endpointEvidencePath = path.join(repositoryRoot, 'schemas/rig-profiles/vozual-rig-1.endpoint-pose-evidence.v1.json');
      const originalReadFileSync = fs.readFileSync;
      const readSpy = jest.spyOn(fs, 'readFileSync').mockImplementation(((file: any, ...args: any[]) => {
        if (path.resolve(String(file)) === endpointEvidencePath) {
          const tampered = JSON.parse(originalReadFileSync.call(fs, file, ...args).toString('utf8'));
          tampered.profileSha256 = '0'.repeat(64);
          return Buffer.from(JSON.stringify(tampered));
        }
        return originalReadFileSync.call(fs, file, ...args);
      }) as any);
      try {
        expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
          code: 'COMPATIBILITY.RIG_PROFILE',
          message: expect.stringContaining('Calibrated endpoint pose evidence checksum mismatch'),
        }));
      } finally {
        readSpy.mockRestore();
      }
    });
  });

  it('compiles deterministic bytes through an exact profile and asset binding', () => {
    const {candidateBytes, profile, source} = fixture();
    const first = compile(source, profile, candidateBytes);
    const second = compile(source, profile, candidateBytes);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.sha256).toBe(second.sha256);
    expect(first.artifact).toMatchObject({
      schema: 'vozual.runtime-execution-plan',
      compiler: {id: 'vozual-motion-v4', build: 'task3-rig-conformance-5'},
      rig: {
        profileId: profile.id,
        profileRevision: profile.revision,
        profileSha256: profile.sha256,
        candidateSha256: profile.asset.candidateSha256,
        restAxesInventorySha256: profile.descriptor.boneInventory.restAxesInventory.sha256,
        mechanicalObservationManifestSha256: profile.descriptor.mechanicalObservationEvidence.manifestSha256,
        mechanicalObservationReportRawSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        requiredCapabilities: ['arm.parentHierarchy'],
      },
      initialization: {
        neutralReferencePoseId: 'rest',
        referenceFrameSource: 'profile-neutral-rest',
      },
    });
    expect(first.artifact.conformanceDiagnostics.mechanicalObservation).toMatchObject({
      manifestSha256: profile.descriptor.mechanicalObservationEvidence.manifestSha256,
      reportRawSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      reportProjectionSha256: profile.descriptor.mechanicalObservationEvidence.reportProjectionSha256,
      candidateSha256: profile.asset.candidateSha256,
      restAxesInventorySha256: profile.descriptor.boneInventory.restAxesInventory.sha256,
      claim: 'observed-mechanical-response-only',
      disposition: 'provenance-only-no-executable-authorization',
      boneCount: 171,
      signedAxisSampleCount: 1026,
      samplesWithWeightedDisplacement: 1026,
    });
    expect(first.artifact.rig.requiredCapabilities).not.toContain('rig.mechanicalObservation');
    expect(first.artifact.frames).toEqual([]);
  });

  it('rejects unsupported capabilities and candidate bytes before emitting an artifact', () => {
    const unsupported = fixture(['arm.reachability']);
    expect(() => compile(unsupported.source, unsupported.profile, unsupported.candidateBytes))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    const supported = fixture();
    expect(() => compile(supported.source, supported.profile, Buffer.from('wrong candidate')))
      .toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it.each(['anatomical.degreesOfFreedom', 'anatomical.jointLimits', 'manual.thumbJoints', 'manual.thumb.flexion', 'sign.future-placeholder', 'linguistic.sign.future-placeholder'])
  ('rejects unreviewed anatomical and future-sign requests before artifact emission: %s', capability => {
    const {candidateBytes, profile, source} = fixture([capability]);
    profile.capabilities[capability] = 'structurally_verified';
    profile.sha256 = profileSha256(profile);
    const sourceBefore = JSON.stringify(source);
    const profileBefore = JSON.stringify(profile);
    expect(() => compile(source, profile, candidateBytes)).toThrow(expect.objectContaining({
      code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY',
      details: expect.objectContaining({capability, profileId: profile.id, profileRevision: profile.revision}),
    }));
    expect(JSON.stringify(source)).toBe(sourceBefore);
    expect(JSON.stringify(profile)).toBe(profileBefore);
  });

  it('fails closed when the local evidence root is not explicitly supplied', () => {
    const {candidateBytes, profile, source} = fixture();
    const previousRoot = process.env.VOZUAL_TASK3_14B_EVIDENCE_ROOT;
    delete process.env.VOZUAL_TASK3_14B_EVIDENCE_ROOT;
    try {
      expect(() => compileV4RigConformanceRecipe(source, profile, candidateBytes))
        .toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    } finally {
      if (previousRoot === undefined) delete process.env.VOZUAL_TASK3_14B_EVIDENCE_ROOT;
      else process.env.VOZUAL_TASK3_14B_EVIDENCE_ROOT = previousRoot;
    }
  });

  it('fails an unreachable probe with measured bilateral diagnostics', () => {
    const {candidateBytes, profile, source} = fixture();
    source.constraints.reachabilityProbes = [{side: 'right', targetDistanceM: 0.8}];
    try {
      compile(source, profile, candidateBytes);
      throw new Error('expected an unreachable diagnostic');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'KINEMATIC.UNREACHABLE',
        details: {
          side: 'right',
          targetDistanceM: 0.8,
          maximumReachM: 0.653762,
          excessDistanceM: 0.146238,
          requiredCapability: 'arm.reachability',
          profileId: profile.id,
          profileRevision: profile.revision,
          profileSha256: profile.sha256,
        },
      });
    }
  });

  it('rejects motion nodes instead of implying later v4 compiler semantics', () => {
    const {candidateBytes, profile, source} = fixture();
    source.temporalGraph.nodes = [{id: 'future-node'}];
    expect(() => compile(source, profile, candidateBytes))
      .toThrow(expect.objectContaining({
        code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY',
        details: {requiredCapability: 'compiler.temporalGraph'},
      }));
  });

  it('rejects sign execution purposes and rig overrides until motion compilation exists', () => {
    const sign = fixture();
    sign.source.purpose = 'sign-execution';
    expect(() => compile(sign.source, sign.profile, sign.candidateBytes))
      .toThrow(expect.objectContaining({code: 'SCHEMA.UNSUPPORTED_VERSION'}));

    const override = fixture();
    override.source.rigRealizationOverrides = {'DEF-thumb.01.L': {rotationRad: [0.1, 0, 0]}};
    expect(() => compile(override.source, override.profile, override.candidateBytes))
      .toThrow(expect.objectContaining({
        code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY',
        details: {requiredCapability: 'compiler.rigRealizationOverrides'},
      }));
  });

  it('does not treat structural finger presence as thumb-motion authorization', () => {
    const {candidateBytes, profile, source} = fixture(['manual.fingerJoints']);
    source.temporalGraph.nodes = [{id: 'thumb-flexion', channel: 'manual.thumbJoints'}];
    expect(() => compile(source, profile, candidateBytes))
      .toThrow(expect.objectContaining({
        code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY',
        details: {requiredCapability: 'compiler.temporalGraph'},
      }));
  });

  it('binds discrete mechanical diagnostics without emitting motion frames', () => {
    const {candidateBytes, profile, source} = fixture();
    const pose = profile.descriptor.coordinateCalibration.endpointConformancePose;
    source.constraints.mechanicalPoseProbes = [{
      poseId: pose.id,
      rotationCommandsRad: Object.fromEntries(Object.entries(pose.rotationCommandsRad)
        .map(([bone, angle]) => [bone, [angle, 0, 0]])),
    }, {poseId: 'neutral-rest', rotationCommandsRad: {}}];
    const first = compile(source, profile, candidateBytes);
    expect(first.bytes.equals(compile(source, profile, candidateBytes).bytes)).toBe(true);
    expect(first.artifact.conformanceDiagnostics.mechanicalProbes).toMatchObject({
      contractSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      poseIds: [pose.id, 'neutral-rest'],
      disposition: 'diagnostic-only-no-motion-emitted',
    });
    expect(first.artifact.frames).toEqual([]);
    expect(first.artifact.rig.requiredCapabilities).toContain('endpoint.pointAnchors');
    expect(first.artifact.conformanceDiagnostics.mechanicalObservation.manifestSha256)
      .toBe(profile.descriptor.mechanicalObservationEvidence.manifestSha256);
  });

  it('accepts corrected diagnostic poses only for the exact evidenced candidate profile', () => {
    const mechanicalBasis = JSON.parse(JSON.stringify(sourceProfile));
    delete mechanicalBasis.descriptor.visualFidelityEvidence;
    expect(sourceProfile.sha256).toBe('c97937e3642cfae25dbbbb91fdd4ed62228ecc17d062a6c13443c556097ced54');
    expect(profileSha256(mechanicalBasis)).toBe('7651784cc5aa3b3f48fcbc0176e8ef50dd4728fabe73ef181c9662907f4324a0');
    expect(isolatedCatalog.profileSha256).toBe(profileSha256(mechanicalBasis));
    const contract = mechanicalConformanceContract(sourceProfile);
    const left = contract.configurations.find(pose => pose.id === 'corrected-hand-diagnostic-left-v1');
    const right = contract.configurations.find(pose => pose.id === 'corrected-hand-diagnostic-right-v1');
    expect(Object.keys(left.rotationCommandsRad)).toHaveLength(15);
    expect(left.rotationCommandsRad['DEF-thumb.01.L']).toEqual([0.15, 0, 0.2]);
    expect(right.rotationCommandsRad['DEF-thumb.01.R']).toEqual([0.15, 0, -0.1]);
    expect(validateMechanicalConformanceProbes(sourceProfile, [{poseId: left.id, rotationCommandsRad: left.rotationCommandsRad}]).poseIds).toEqual([left.id]);
    const changed = JSON.parse(JSON.stringify(left.rotationCommandsRad));
    changed['DEF-thumb.01.L'][2] += 0.001;
    expect(() => validateMechanicalConformanceProbes(sourceProfile, [{poseId: left.id, rotationCommandsRad: changed}]))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    const other = JSON.parse(JSON.stringify(sourceProfile));
    other.asset.candidateSha256 = '0'.repeat(64);
    other.descriptor.boneInventory.restAxesInventory.candidateSha256 = other.asset.candidateSha256;
    other.descriptor.boneInventory.restAxesInventory.sha256 = restAxesInventorySha256(other.descriptor.boneInventory.restAxesInventory);
    other.descriptor.mechanicalObservationEvidence.candidateSha256 = other.asset.candidateSha256;
    other.descriptor.mechanicalObservationEvidence.restAxesInventorySha256 = other.descriptor.boneInventory.restAxesInventory.sha256;
    other.sha256 = profileSha256(other);
    expect(mechanicalConformanceContract(other).configurations.some(pose => pose.id === left.id)).toBe(false);
  });

  it('accepts only exact non-colliding isolated measurements and rejects combinations', () => {
    const single = (v: number[]) => [{poseId: 'isolated-bone-probe-v1', rotationCommandsRad: {'DEF-f_index.01.L': v}}];
    expect(validateMechanicalConformanceProbes(sourceProfile, single([0.1, 0, 0])).poseIds).toEqual(['isolated-bone-probe-v1']);
    expect(() => validateMechanicalConformanceProbes(sourceProfile, single([0, 0, -0.1])))
      .toThrow(expect.objectContaining({code: 'KINEMATIC.DIAGNOSTIC_COLLISION', details: expect.objectContaining({overlapCount: 161})}));
    expect(() => validateMechanicalConformanceProbes(sourceProfile, single([0.101, 0, 0])))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    expect(() => validateMechanicalConformanceProbes(sourceProfile, single([0.1, 0.1, 0])))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    const otherProfile = JSON.parse(JSON.stringify(sourceProfile));
    otherProfile.asset.candidateSha256 = '0'.repeat(64);
    otherProfile.descriptor.boneInventory.restAxesInventory.candidateSha256 = otherProfile.asset.candidateSha256;
    otherProfile.descriptor.boneInventory.restAxesInventory.sha256 = restAxesInventorySha256(otherProfile.descriptor.boneInventory.restAxesInventory);
    otherProfile.descriptor.mechanicalObservationEvidence.candidateSha256 = otherProfile.asset.candidateSha256;
    otherProfile.descriptor.mechanicalObservationEvidence.restAxesInventorySha256 = otherProfile.descriptor.boneInventory.restAxesInventory.sha256;
    otherProfile.sha256 = profileSha256(otherProfile);
    expect(() => validateMechanicalConformanceProbes(otherProfile, single([0.1, 0, 0])))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    const tenDegrees = -10 * Math.PI / 180;
    expect(validateMechanicalConformanceProbes(sourceProfile,
      single([-10 * Math.PI / 180, 0, 0])).poseIds).toEqual(['isolated-bone-probe-v1']);
    expect(() => validateMechanicalConformanceProbes(sourceProfile,
      single([0, 0, tenDegrees])))
      .toThrow(expect.objectContaining({code: 'KINEMATIC.DIAGNOSTIC_COLLISION', details: expect.objectContaining({overlapCount: 156})}));

    const {candidateBytes, profile, source} = fixture();
    source.constraints.mechanicalPoseProbes = single([0.101, 0, 0]);
    expect(() => compile(source, profile, candidateBytes))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
  });

  it('rejects a modified catalog even if its self-checksum is recomputed', () => {
    const sample = isolatedCatalog.bones['DEF-f_index.01.L'].x.find(item => item[0] === 0.1);
    const originalCount = sample[1];
    const originalSha = isolatedCatalog.sha256;
    try {
      sample[1] = originalCount + 1;
      const unsigned = {...isolatedCatalog};
      delete unsigned.sha256;
      isolatedCatalog.sha256 = crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
      expect(() => validateMechanicalConformanceProbes(sourceProfile, [{poseId: 'isolated-bone-probe-v1',
        rotationCommandsRad: {'DEF-f_index.01.L': [0.1, 0, 0]}}]))
        .toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    } finally {
      sample[1] = originalCount;
      isolatedCatalog.sha256 = originalSha;
    }
  });

  it('rejects an isolated catalog bound to a stale rest-axis inventory even if rehashed', () => {
    const originalInventorySha = isolatedCatalog.restAxesInventorySha256;
    const originalSha = isolatedCatalog.sha256;
    try {
      isolatedCatalog.restAxesInventorySha256 = '0'.repeat(64);
      const unsigned = {...isolatedCatalog};
      delete unsigned.sha256;
      isolatedCatalog.sha256 = crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
      expect(() => validateMechanicalConformanceProbes(sourceProfile, [{poseId: 'isolated-bone-probe-v1',
        rotationCommandsRad: {'DEF-f_index.01.L': [0.1, 0, 0]}}]))
        .toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE', message: expect.stringContaining('catalog checksum or binding mismatch')}));
    } finally {
      isolatedCatalog.restAxesInventorySha256 = originalInventorySha;
      isolatedCatalog.sha256 = originalSha;
    }
  });

  it.each([
    {poseId: 'neutral-rest', rotationCommandsRad: {'DEF-thumb.01.L': [0.1, 0, 0]}},
    {poseId: 'left-index-curl-v1', rotationCommandsRad: {'DEF-f_index.01.L': [0.15, 0, 0]}},
    {poseId: 'left-index-curl-v1', rotationCommandsRad: {
      'DEF-f_index.01.L': [0.15, 0.01, 0],
      'DEF-f_index.02.L': [0.2, 0, 0],
      'DEF-f_index.03.L': [0.15, 0, 0],
    }},
    {poseId: 'unknown-pose', rotationCommandsRad: {}},
  ])('rejects unsupported or combined mechanical configurations: %j', probe => {
    const {candidateBytes, profile, source} = fixture();
    source.constraints.mechanicalPoseProbes = [probe];
    expect(() => compile(source, profile, candidateBytes))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
  });

  it('rejects malformed probes and previously ignored realizations or constraints', () => {
    const {candidateBytes, profile, source} = fixture();
    source.constraints.mechanicalPoseProbes = [];
    expect(() => compile(source, profile, candidateBytes))
      .toThrow(expect.objectContaining({code: 'SCHEMA.UNSUPPORTED_VERSION'}));
    delete source.constraints.mechanicalPoseProbes;
    source.rigRealizationOverrides = {boneRotations: {'DEF-thumb.01.L': 0.2}};
    expect(() => compile(source, profile, candidateBytes))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    source.rigRealizationOverrides = {};
    source.constraints.jointLimits = {minimum: -1, maximum: 1};
    expect(() => compile(source, profile, candidateBytes))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
  });

  it.each(['anatomicalJointLimits', 'selfCollision', 'bodyPenetration', 'visibilityPolicies', 'coupledConstraints'])
    ('fails closed for deferred Task 7 family %s', family => {
      const {candidateBytes, profile, source} = fixture();
      source.constraints[family] = [{id: 'unsupported-v1-request'}];
      expect(() => compile(source, profile, candidateBytes))
        .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    });
});
