import {
  adaptFaceOverlayPoint,
  capturedFacePresentation,
  capturedFaceCalibration,
  capturedHeadOrientation,
  chooseLivelyFaceExpression,
  contactPresentationWeight,
  hasRiggedHandTransformEdit,
  hasStaticFaceForLivelyExpression,
  initialRiggedHandFrontDepth,
  livelyIdleBodyPresentation,
  livelyIdleFacePresentation,
  livelyIdleGazePresentation,
  livelyFaceExpressionIntensity,
  presentAnatomicalHandLandmarkFrames,
  presentCapturedHandLandmarkFrames,
  presentConfiguredHandLandmarkFrames,
  presentFistHandLandmarkFrames,
  presentIndexOnlyHandLandmarkFrames,
  presentMoneyRubHandLandmarkFrames,
  riggedElbowPivotTarget,
  riggedHandBoneTarget,
  riggedHandPositionOffset,
  riggedPalmScaleFactor,
  riggedApproachPalmScaleEnvelope,
  riggedApproachPalmScaleFactor,
  riggedHandsEditPoseAtFrame,
  riggedSmileEditAtFrame,
  riggedWristDepth,
  shouldDriveFlatPalmSegment,
  shouldDriveConfiguredExtendedFingerSegment,
  shouldDriveFullyOpenHandSegment,
  presentPointingHandLandmarkFrames,
  presentPinchedHandLandmarkFrames,
  presentQuestionQHandLandmarkFrames,
  preserveMinimumProjectedForearmLength,
  presentSelfPointingHandLandmarkFrames,
  presentThumbUpHandLandmarkFrames,
  shouldDrivePointingHandSegment,
  shouldDriveThumbUpHandSegment,
  shouldDriveStableOpenHandSegment,
  shouldUseSingleHandRig,
  softenFingerCurlLandmarks,
  splitCapturedHeadOrientation,
  stabilizeFistHandLandmarkFrames,
  straightenOpenHandLandmarks,
} from '../AvatarMotionPresentation';
import {MotionPoint, SignMotion} from '../CompactSignMotion';

const point = (x: number, y: number, z = 0): MotionPoint => [x, y, z];

function neutralFace(): MotionPoint[] {
  const face = Array.from({length: 468}, () => point(0, 0));
  face[1] = point(0, 0.04);
  face[10] = point(0, -0.42);
  face[13] = point(0, 0.22);
  face[14] = point(0, 0.221);
  face[33] = point(-0.2, 0);
  face[61] = point(-0.12, 0.23);
  face[70] = point(-0.15, -0.12);
  face[107] = point(-0.05, -0.14);
  face[145] = point(-0.1, 0.025);
  face[152] = point(0, 0.48);
  face[159] = point(-0.1, -0.025);
  face[234] = point(-0.32, 0.04);
  face[263] = point(0.2, 0);
  face[291] = point(0.12, 0.23);
  face[300] = point(0.15, -0.12);
  face[336] = point(0.05, -0.14);
  face[374] = point(0.1, 0.025);
  face[386] = point(0.1, -0.025);
  face[454] = point(0.32, 0.04);
  return face;
}

function rotateFace(face: MotionPoint[], yaw: number, pitch: number): MotionPoint[] {
  return face.map(([x, y, z]) => {
    const yawX = x * Math.cos(yaw) + z * Math.sin(yaw);
    const yawZ = -x * Math.sin(yaw) + z * Math.cos(yaw);
    return [
      yawX,
      y * Math.cos(pitch) - yawZ * Math.sin(pitch),
      y * Math.sin(pitch) + yawZ * Math.cos(pitch),
    ];
  });
}

describe('avatar motion presentation', () => {
  it('keeps a foreshortened forearm visible without moving its wrist', () => {
    const elbow = point(0.1, 0.1, 0.35);
    const wrist = point(0, 0, 0.8);

    const adjusted = preserveMinimumProjectedForearmLength(elbow, wrist, 0.4);

    expect(Math.hypot(adjusted[0] - wrist[0], adjusted[1] - wrist[1]))
      .toBeCloseTo(0.4, 8);
    expect(adjusted[2]).toBe(elbow[2]);
    expect(wrist).toEqual(point(0, 0, 0.8));
  });

  it('maps human facial anchors onto stylized avatar proportions', () => {
    const source = {
      leftEye: point(-1, 0),
      rightEye: point(1, 0),
      mouth: point(0.1, 1),
      chin: point(0.2, 2),
    };
    const target = {
      leftEye: point(0, -2),
      rightEye: point(0, 2),
      mouth: point(-0.5, 0.1),
      chin: point(-1, 0.2),
    };

    expect(adaptFaceOverlayPoint(source.leftEye, source, target)).toEqual(target.leftEye);
    expect(adaptFaceOverlayPoint(source.rightEye, source, target)).toEqual(target.rightEye);
    expect(adaptFaceOverlayPoint(source.mouth, source, target)).toEqual(target.mouth);
    expect(adaptFaceOverlayPoint(source.chin, source, target)).toEqual(target.chin);
    expect(adaptFaceOverlayPoint(point(0.65, 1.5), source, target)).toEqual([
      -0.75,
      1.15,
      0,
    ]);
  });

  it('preserves an absolute head turn already present in the first frame', () => {
    const reference = neutralFace();
    const turned = rotateFace(reference, 0.34, -0.12);
    const presentation = capturedFacePresentation(turned, turned);

    expect(presentation).toBeDefined();
    expect(Math.abs(presentation!.headYaw)).toBeGreaterThan(0.2);
    expect(Math.abs(presentation!.headPitch)).toBeGreaterThan(0.05);
  });

  it('maps an upward captured chin tilt to the rig pitch direction', () => {
    const tiltedUp = rotateFace(neutralFace(), -0.2, -0.24);
    const orientation = capturedHeadOrientation(tiltedUp);

    expect(orientation).toBeDefined();
    expect(orientation!.pitch).toBeLessThan(0);
  });

  it('preserves the upward head angle captured in AGUA', () => {
    const agua = require('../../../assets/motions/agua.motion.json');
    const contactFrame = agua.frames[20];
    const orientation = capturedHeadOrientation(contactFrame.face);

    expect(orientation).toBeDefined();
    expect(orientation!.pitch).toBeLessThan(-0.2);
  });

  it('keeps a neutral captured head neutral', () => {
    const face = neutralFace();
    const presentation = capturedFacePresentation(face, face);

    expect(presentation).toBeDefined();
    expect(presentation!.headYaw).toBe(0);
    expect(presentation!.headPitch).toBe(0);
    expect(presentation!.headRoll).toBe(0);
  });

  it('shares head turns with the neck without changing the captured angle', () => {
    const captured = {yaw: 0.48, pitch: -0.24, roll: 0.32};
    const distributed = splitCapturedHeadOrientation(captured);

    expect(distributed.neck.yaw).toBeGreaterThan(0);
    expect(distributed.neck.pitch).toBeLessThan(0);
    expect(distributed.neck.roll).toBeGreaterThan(0);
    expect(distributed.neck.yaw + distributed.head.yaw).toBeCloseTo(captured.yaw, 10);
    expect(distributed.neck.pitch + distributed.head.pitch).toBeCloseTo(captured.pitch, 10);
    expect(distributed.neck.roll + distributed.head.roll).toBeCloseTo(captured.roll, 10);
  });

  it('preserves a captured rounded mouth opening', () => {
    const reference = neutralFace();
    const rounded = neutralFace();
    rounded[14] = point(0, 0.227);
    rounded[61] = point(-0.095, 0.23);
    rounded[291] = point(0.095, 0.23);

    const presentation = capturedFacePresentation(rounded, reference);

    expect(presentation).toBeDefined();
    expect(presentation!.mouthOpening).toBeGreaterThan(0.45);
    expect(presentation!.mouthPucker).toBeGreaterThan(0.35);
  });

  it('keeps a neutral captured mouth neutral', () => {
    const face = neutralFace();
    const presentation = capturedFacePresentation(face, face);

    expect(presentation).toBeDefined();
    expect(presentation!.leftMouthCornerRaise).toBe(0);
    expect(presentation!.rightMouthCornerRaise).toBe(0);
  });

  it('preserves the smile held throughout the BIEN recording', () => {
    const motion = require('../../../assets/motions/bien.motion.json') as SignMotion;
    const calibration = capturedFaceCalibration(motion);
    const presentations = motion.frames
      .map(frame => capturedFacePresentation(
        frame.face,
        motion.frames[0].face,
        calibration,
      ))
      .filter((value): value is NonNullable<typeof value> => value != null);
    const averageSmile = presentations.reduce((sum, presentation) => (
      sum + (
        presentation.leftMouthCornerRaise
        + presentation.rightMouthCornerRaise
      ) / 2
    ), 0) / presentations.length;

    expect(presentations).toHaveLength(motion.frames.length);
    expect(averageSmile).toBeGreaterThan(0.5);
  });

  it('calibrates mouth motion from the least-open frame instead of frame zero', () => {
    const initiallyRounded = neutralFace();
    initiallyRounded[14] = point(0, 0.226);
    const closed = neutralFace();
    const moreRounded = neutralFace();
    moreRounded[14] = point(0, 0.228);
    const motion: SignMotion = {
      fps: 30,
      frames: [initiallyRounded, closed, moreRounded].map(face => ({bodyHands: [], face})),
    };
    const calibration = capturedFaceCalibration(motion);

    expect(calibration).toBeDefined();
    expect(capturedFacePresentation(
      moreRounded,
      initiallyRounded,
      calibration,
    )!.mouthOpening).toBeGreaterThan(0.45);
  });

  it('detects an eye closure even when recording begins with closed eyes', () => {
    const closed = neutralFace();
    closed[145] = point(-0.1, 0.001);
    closed[159] = point(-0.1, -0.001);
    closed[374] = point(0.1, 0.001);
    closed[386] = point(0.1, -0.001);
    const open = neutralFace();
    const motion: SignMotion = {
      fps: 30,
      frames: [closed, open, closed].map(face => ({bodyHands: [], face})),
    };
    const calibration = capturedFaceCalibration(motion);
    const presentation = capturedFacePresentation(closed, closed, calibration);

    expect(presentation).toBeDefined();
    expect(presentation!.leftEyeClosure).toBeGreaterThan(0.8);
    expect(presentation!.rightEyeClosure).toBeGreaterThan(0.8);
  });

  it('keeps the authored palm size while a fist closes', () => {
    expect(riggedPalmScaleFactor(0.45, 1, 0.35, 1, true)).toBe(1);
    expect(riggedPalmScaleFactor(0.45, 1, 0.35, 1, false)).toBe(0.72);
  });

  it('maps every captured hand landmark used by rig contact to a deform bone', () => {
    expect(riggedHandBoneTarget(0)).toEqual({boneName: 'hand', endpoint: false});
    expect(riggedHandBoneTarget(5)).toEqual({boneName: 'f_index.01', endpoint: false});
    expect(riggedHandBoneTarget(9)).toEqual({boneName: 'f_middle.01', endpoint: false});
    expect(riggedHandBoneTarget(13)).toEqual({boneName: 'f_ring.01', endpoint: false});
    expect(riggedHandBoneTarget(17)).toEqual({boneName: 'f_pinky.01', endpoint: false});
    expect(riggedHandBoneTarget(20)).toEqual({boneName: 'f_pinky.03', endpoint: true});
    expect(Array.from({length: 21}, (_, index) => riggedHandBoneTarget(index)))
      .not.toContain(undefined);
    expect(riggedHandBoneTarget(21)).toBeUndefined();
  });

  it('allows an approaching hand to retain its captured apparent growth', () => {
    expect(riggedPalmScaleFactor(2, 1, 2, 1, false, 1, 1.55)).toBe(1.55);
    expect(riggedPalmScaleFactor(0.5, 1, 0.5, 1, false, 1, 1.55)).toBe(1);
  });

  it('shares the apparent approach scale of a reliable captured palm', () => {
    const hand = Array.from({length: 21}, () => [0, 0, 0] as MotionPoint);
    hand[5] = [-1, 1, 0];
    hand[9] = [-0.5, 1, 0];
    hand[13] = [0.5, 1, 0];
    hand[17] = [1, 1, 0];
    const approaching = hand.map(point => point.map(value => value * 1.4) as MotionPoint);

    expect(riggedApproachPalmScaleFactor(approaching, hand, 1, 1.5)).toBeCloseTo(1.4);
    expect(riggedApproachPalmScaleFactor(hand, approaching, 1, 1.5)).toBe(1);
    expect(riggedApproachPalmScaleFactor(approaching, hand, 1, 1.75, 1.5))
      .toBeCloseTo(1.6);
    expect(riggedApproachPalmScaleEnvelope(
      [hand, approaching, hand],
      2,
      1,
      1.75,
      1.5,
    )).toBeCloseTo(1.6);
  });

  it('smoothly reaches an edited hand keyframe without changing earlier frames', () => {
    const keyframes = [{
      frame: 12,
      transitionFrames: 4,
      left: {
        elbowRotation: 30,
        wristRoll: 40,
        horizontalOffset: 0.6,
        verticalOffset: -0.4,
        depthOffset: 0.8,
        fist: 1,
        fingers: {index: 0.5},
        fingerJoints: {index: [0.2, 0.6, 0.9]},
      },
    }];

    expect(riggedHandsEditPoseAtFrame(keyframes, 7).left.wristRoll).toBe(0);
    expect(riggedHandsEditPoseAtFrame(keyframes, 10).left.wristRoll).toBeCloseTo(20);
    expect(riggedHandsEditPoseAtFrame(keyframes, 10).left.elbowRotation).toBeCloseTo(15);
    expect(riggedHandsEditPoseAtFrame(keyframes, 10).left.horizontalOffset).toBeCloseTo(0.3);
    expect(riggedHandsEditPoseAtFrame(keyframes, 10).left.verticalOffset).toBeCloseTo(-0.2);
    expect(riggedHandsEditPoseAtFrame(keyframes, 10).left.depthOffset).toBeCloseTo(0.4);
    expect(riggedHandsEditPoseAtFrame(keyframes, 12).left).toEqual(expect.objectContaining({
      elbowRotation: 30,
      wristRoll: 40,
      horizontalOffset: 0.6,
      verticalOffset: -0.4,
      depthOffset: 0.8,
      fist: 1,
      fingers: expect.objectContaining({index: 0.5}),
      fingerJoints: expect.objectContaining({index: [0.2, 0.6, 0.9]}),
    }));
  });

  it('interpolates each finger joint independently for precise hand shapes', () => {
    const keyframes = [{
      frame: 8,
      transitionFrames: 4,
      right: {fingerJoints: {index: [0.2, 0.5, 0.8]}},
    }];

    expect(riggedHandsEditPoseAtFrame(keyframes, 4).right.fingerJoints.index)
      .toEqual([0, 0, 0]);
    expect(riggedHandsEditPoseAtFrame(keyframes, 6).right.fingerJoints.index)
      .toEqual([0.1, 0.25, 0.4]);
    expect(riggedHandsEditPoseAtFrame(keyframes, 8).right.fingerJoints.index)
      .toEqual([0.2, 0.5, 0.8]);
  });

  it('smoothly adds and removes an editor-authored smile', () => {
    const keyframes = [
      {frame: 8, transitionFrames: 4, smile: 0.2},
      {frame: 16, transitionFrames: 4, smile: 0},
    ];

    expect(riggedSmileEditAtFrame(keyframes, 3)).toBe(0);
    expect(riggedSmileEditAtFrame(keyframes, 6)).toBeCloseTo(0.1);
    expect(riggedSmileEditAtFrame(keyframes, 8)).toBeCloseTo(0.2);
    expect(riggedSmileEditAtFrame(keyframes, 14)).toBeCloseTo(0.1);
    expect(riggedSmileEditAtFrame(keyframes, 16)).toBe(0);
  });

  it('bounds hand alignment offsets without changing depth', () => {
    expect(riggedHandPositionOffset({
      horizontalOffset: 1.4,
      verticalOffset: -0.35,
      depthOffset: 0.8,
    })).toEqual([1, -0.35, 0]);
  });

  it('rotates the wrist target around the elbow without changing its depth', () => {
    const target = riggedElbowPivotTarget([1, 2, 0.4], [2, 2, 0.7], 90);
    expect(target[0]).toBeCloseTo(1);
    expect(target[1]).toBeCloseTo(3);
    expect(target[2]).toBeCloseTo(0.7);
  });

  it('detects a transform edit on only the hand that was changed', () => {
    expect(hasRiggedHandTransformEdit({elbowRotation: -12})).toBe(true);
    expect(hasRiggedHandTransformEdit({wristPitch: 18})).toBe(true);
    expect(hasRiggedHandTransformEdit({horizontalOffset: -0.25})).toBe(true);
    expect(hasRiggedHandTransformEdit({fist: 1})).toBe(false);
    expect(hasRiggedHandTransformEdit(undefined)).toBe(false);
  });

  it('interpolates independently between generic left and right hand edits', () => {
    const keyframes = [
      {frame: 4, right: {wristYaw: -30, fingers: {thumb: -1}}},
      {frame: 10, transitionFrames: 2, left: {wristPitch: 20}},
    ];

    expect(riggedHandsEditPoseAtFrame(keyframes, 4).right.wristYaw).toBe(-30);
    expect(riggedHandsEditPoseAtFrame(keyframes, 4).right.fingers.thumb).toBe(-1);
    expect(riggedHandsEditPoseAtFrame(keyframes, 8).left.wristPitch).toBe(0);
    expect(riggedHandsEditPoseAtFrame(keyframes, 9).left.wristPitch).toBeCloseTo(10);
    expect(riggedHandsEditPoseAtFrame(keyframes, 10).right.wristYaw).toBe(0);
  });

  it('keeps AYUDAR captured facial expression ahead of random idle gestures', () => {
    const motion = require('../../../assets/motions/ayudar.motion.json') as SignMotion;
    expect(hasStaticFaceForLivelyExpression(motion)).toBe(false);
  });

  it('presents AYUDAR with a captured thumb and stable folded long fingers', () => {
    const motion = require('../../../assets/motions/ayudar.motion.json') as SignMotion;
    const capturedHands = motion.frames.map(frame => frame.bodyHands.slice(33, 54));
    const anatomical = presentAnatomicalHandLandmarkFrames(capturedHands);
    const presented = presentThumbUpHandLandmarkFrames(capturedHands);

    presented.forEach((hand, frameIndex) => {
      [1, 2, 3, 4].forEach(index => {
        expect(hand[index]).toEqual(anatomical[frameIndex][index]);
      });
      [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]
        .forEach(chain => {
          const segmentLengths = chain.slice(1).map((toIndex, segmentIndex) => {
            const fromIndex = chain[segmentIndex];
            const capturedLength = Math.hypot(
              ...capturedHands[frameIndex][toIndex].map(
                (value, axis) => value - capturedHands[frameIndex][fromIndex][axis],
              ),
            );
            const presentedLength = Math.hypot(
              ...hand[toIndex].map((value, axis) => value - hand[fromIndex][axis]),
            );
            expect(presentedLength).toBeCloseTo(capturedLength, 6);
            return presentedLength;
          });
          const rootToTip = Math.hypot(
            ...hand[chain[3]].map((value, axis) => value - hand[chain[0]][axis]),
          );
          expect(rootToTip / segmentLengths.reduce((sum, length) => sum + length, 0))
            .toBeLessThan(0.62);

          const middleDirection = hand[chain[2]].map(
            (value, axis) => (value - hand[chain[1]][axis]) / segmentLengths[1],
          );
          const distalDirection = hand[chain[3]].map(
            (value, axis) => (value - hand[chain[2]][axis]) / segmentLengths[2],
          );
          const distalAlignment = middleDirection.reduce(
            (sum, value, axis) => sum + value * distalDirection[axis],
            0,
          );
          expect(distalAlignment).toBeLessThan(0.25);
        });
    });
  });

  it('drives only the captured thumb inside a thumb-up fist', () => {
    expect([1, 2, 3].filter(shouldDriveThumbUpHandSegment)).toEqual([1, 2, 3]);
    expect([5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19]
      .filter(shouldDriveThumbUpHandSegment)).toEqual([]);
  });

  it('keeps all 21 landmarks of both AYUDAR hands unchanged', () => {
    const motion = require('../../../assets/motions/ayudar.motion.json') as SignMotion;
    [33, 54].forEach(handStart => {
      const capturedHands = motion.frames.map(frame => (
        frame.bodyHands.slice(handStart, handStart + 21)
      ));
      const presented = presentCapturedHandLandmarkFrames(capturedHands);

      presented.forEach((hand, frameIndex) => {
        expect(hand).toEqual(capturedHands[frameIndex]);
        expect(hand).not.toBe(capturedHands[frameIndex]);
        hand.forEach((point, pointIndex) => {
          expect(point).not.toBe(capturedHands[frameIndex][pointIndex]);
        });
      });
    });
  });

  it('configures AYUDAR to move both contacted palms toward the camera together', () => {
    const profiles = require('../../../assets/motions/avatar_profile_overrides.json');
    const motion = require('../../../assets/motions/ayudar.motion.json') as SignMotion;
    const profile = profiles.AYUDAR;

    expect(profile.rigLeftHandShape).toBe('thumb-up');
    expect(profile.rigRightHandShape).toBe('open-palm');
    expect(profile.rigLeftPalmScaleMin).toBe(1);
    expect(profile.rigLeftPalmScaleMax).toBe(2.25);
    expect(profile.rigRightPalmScaleMin).toBe(1);
    expect(profile.rigRightPalmScaleMax).toBe(2.25);
    expect(profile.rigSynchronizedPalmApproach).toBe(true);
    expect(profile.rigPalmApproachGain).toBe(3);
    expect(profile.rigPalmApproachVerticalOffset).toBe(0.22);
    expect(profile.rigLeftPalmAxialRollDegrees).toBe(-28);
    const approachHands = motion.frames.map(frame => frame.bodyHands.slice(33, 54));
    expect(riggedApproachPalmScaleEnvelope(
      approachHands,
      motion.frames.length - 1,
      profile.rigLeftPalmScaleMin,
      profile.rigLeftPalmScaleMax,
      profile.rigPalmApproachGain,
    )).toBeGreaterThan(2.1);
    expect(profile.rigRightHandDepthFlip).toBe(false);
    expect(profile.rigRightHandTrackingRepair).toBe('locked-palm');
    expect(profile.rigInterHandContact).toEqual(expect.objectContaining({
      movingSide: 'L',
      movingLandmarks: [5, 9, 13, 17],
      supportSide: 'R',
      supportLandmarks: [5, 9, 13, 17],
      snap: 1,
    }));
  });

  it('preserves the recorded non-manual expression in HAMBRE', () => {
    const motion = require('../../../assets/motions/hambre.motion.json');
    const firstFace = motion.frames[0].face;
    const expressiveFace = motion.frames[motion.frames.length - 1].face;
    const presentation = capturedFacePresentation(expressiveFace, firstFace);

    expect(presentation).toBeDefined();
    expect(presentation!.leftEyeClosure).toBeGreaterThan(0.2);
    expect(presentation!.rightEyeClosure).toBeGreaterThan(0.2);
    expect(Math.max(
      presentation!.leftInnerBrowLift,
      presentation!.rightInnerBrowLift,
    )).toBeGreaterThan(0.1);
  });

  it('keeps authored two-handed signs even when one hand barely moves', () => {
    expect(shouldUseSingleHandRig(0.0146, 0.0695)).toBe(true);
    expect(shouldUseSingleHandRig(0.0146, 0.0695, true)).toBe(false);
    expect(shouldUseSingleHandRig(0.0146, 0.0695, false, true)).toBe(false);
  });

  it('straightens the long fingers while preserving roots and phalanx lengths', () => {
    const hand = Array.from({length: 21}, () => point(0, 0));
    hand[0] = point(0, 0);
    hand[1] = point(-0.03, 0.03);
    hand[2] = point(-0.05, 0.06);
    hand[3] = point(-0.07, 0.08);
    hand[4] = point(-0.09, 0.1);
    [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]].forEach((chain, fingerIndex) => {
      const rootX = (fingerIndex - 1.5) * 0.018;
      hand[chain[0]] = point(rootX, 0.04);
      hand[chain[1]] = point(rootX + 0.008 * fingerIndex, 0.085);
      hand[chain[2]] = point(rootX - 0.006 * fingerIndex, 0.125);
      hand[chain[3]] = point(rootX + 0.004 * fingerIndex, 0.16);
    });

    const presented = straightenOpenHandLandmarks(hand);

    expect(presented[0]).toEqual(hand[0]);
    for (const chain of [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]) {
      expect(presented[chain[0]]).toEqual(hand[chain[0]]);
      for (let index = 1; index < chain.length; index += 1) {
        const originalLength = Math.hypot(...hand[chain[index]].map((value, axis) => value - hand[chain[index - 1]][axis]));
        const presentedLength = Math.hypot(...presented[chain[index]].map((value, axis) => value - presented[chain[index - 1]][axis]));
        expect(presentedLength).toBeCloseTo(originalLength, 8);
      }
      const firstSegment = point(
        presented[chain[1]][0] - presented[chain[0]][0],
        presented[chain[1]][1] - presented[chain[0]][1],
        presented[chain[1]][2] - presented[chain[0]][2],
      );
      const lastSegment = point(
        presented[chain[3]][0] - presented[chain[2]][0],
        presented[chain[3]][1] - presented[chain[2]][1],
        presented[chain[3]][2] - presented[chain[2]][2],
      );
      expect(Math.abs(firstSegment[0] * lastSegment[1] - firstSegment[1] * lastSegment[0])).toBeLessThan(1e-10);
    }
  });

  it('keeps BLANCO pointing with the thumb and index extended', () => {
    const motion = require('../../../assets/motions/blanco.motion.json') as SignMotion;
    const capturedHands = motion.frames.map(frame => frame.bodyHands.slice(33, 54));
    const anatomicalHands = presentAnatomicalHandLandmarkFrames(capturedHands);
    const indexChain = [5, 6, 7, 8];
    const closedChains = [
      [9, 10, 11, 12],
      [13, 14, 15, 16],
      [17, 18, 19, 20],
    ];

    const presentedHands = presentPointingHandLandmarkFrames(anatomicalHands);

    anatomicalHands.forEach((hand, frameIndex) => {
      const presented = presentedHands[frameIndex];
      const indexDirection = presented[8].map(
        (value, axis) => value - presented[5][axis],
      );
      // In BLANCO the captured index always travels upward on screen. Keep
      // that sign even when the edge-on middle/ring landmarks briefly point
      // the opposite way because they occlude one another.
      expect(indexDirection[1]).toBeLessThan(0);
      const extensionRatio = (chain: number[]) => {
        const totalLength = chain.slice(1).reduce((sum, toIndex, segmentIndex) => (
          sum + Math.hypot(...presented[toIndex].map(
            (value, axis) => value - presented[chain[segmentIndex]][axis],
          ))
        ), 0);
        const rootToTip = Math.hypot(...presented[chain[3]].map(
          (value, axis) => value - presented[chain[0]][axis],
        ));
        return rootToTip / totalLength;
      };
      expect(extensionRatio(indexChain)).toBeGreaterThan(0.98);
      closedChains.forEach(chain => expect(extensionRatio(chain)).toBeLessThan(0.97));
      expect(extensionRatio([1, 2, 3, 4])).toBeGreaterThan(0.9);
    });
  });

  it('keeps all COMER fingertips grouped without changing roots or phalanx lengths', () => {
    const motion = require('../../../assets/motions/comer.motion.json') as SignMotion;
    const hands = motion.frames.map(frame => frame.bodyHands.slice(33, 54));
    const presented = presentPinchedHandLandmarkFrames(hands);
    const chains = [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
      [17, 18, 19, 20],
    ];

    presented.forEach((hand, frameIndex) => {
      expect(hand[0]).toEqual(hands[frameIndex][0]);
      chains.forEach(chain => {
        expect(hand[chain[0]]).toEqual(hands[frameIndex][chain[0]]);
        chain.slice(1).forEach((toIndex, segmentIndex) => {
          const fromIndex = chain[segmentIndex];
          const originalLength = Math.hypot(...hands[frameIndex][toIndex].map(
            (value, axis) => value - hands[frameIndex][fromIndex][axis],
          ));
          const presentedLength = Math.hypot(...hand[toIndex].map(
            (value, axis) => value - hand[fromIndex][axis],
          ));
          expect(presentedLength).toBeCloseTo(originalLength, 6);
        });
      });
      const fingertips = [4, 8, 12, 16, 20].map(index => hand[index]);
      const maximumSeparation = Math.max(...fingertips.flatMap((first, firstIndex) => (
        fingertips.slice(firstIndex + 1).map(second => Math.hypot(...second.map(
          (value, axis) => value - first[axis],
        )))
      )));
      const palmWidth = Math.hypot(...hand[17].map(
        (value, axis) => value - hand[5][axis],
      ));
      const capturedTips = [4, 8, 12, 16, 20].map(index => hands[frameIndex][index]);
      const capturedMaximumSeparation = Math.max(...capturedTips.flatMap((first, firstIndex) => (
        capturedTips.slice(firstIndex + 1).map(second => Math.hypot(...second.map(
          (value, axis) => value - first[axis],
        )))
      )));
      expect(maximumSeparation).toBeLessThan(palmWidth * 0.42);
      expect(maximumSeparation).toBeLessThan(capturedMaximumSeparation * 0.65);
    });

    const profiles = require('../../../assets/motions/avatar_profile_overrides.json');
    expect(profiles.COMER.rigLeftHandShape).toBe('pinched');
    expect(profiles.COMER.activeHand).toBe('left');
    expect(profiles.COMER.contactAnchor).toBe('mouth');
    expect(profiles.COMER.rigContactLandmark).toBe(12);
    expect(profiles.COMER.rigContactWindows).toEqual([{startFrame: 18, endFrame: 35}]);
  });

  it('keeps DINERO index and middle together while the thumb rubs them', () => {
    const motion = require('../../../assets/motions/dinero.motion.json') as SignMotion;
    const hands = motion.frames.map(frame => frame.bodyHands.slice(33, 54));
    const presented = presentMoneyRubHandLandmarkFrames(hands);
    const rubbingOffsets: number[] = [];

    presented.forEach((hand, frameIndex) => {
      const palmWidth = Math.hypot(...hand[17].map(
        (value, axis) => value - hand[5][axis],
      ));
      const thumbToIndexDistance = Math.hypot(...hand[8].map(
        (value, axis) => value - hand[4][axis],
      ));
      const thumbToMiddleDistance = Math.hypot(...hand[12].map(
        (value, axis) => value - hand[4][axis],
      ));
      const joinedFingertipDistance = Math.hypot(...hand[12].map(
        (value, axis) => value - hand[8][axis],
      ));
      expect(thumbToIndexDistance).toBeLessThan(palmWidth * 0.04);
      expect(thumbToMiddleDistance).toBeLessThan(palmWidth * 0.04);
      expect(joinedFingertipDistance).toBeLessThan(palmWidth * 0.01);
      expect(hand[1]).toEqual(hands[frameIndex][1]);
      expect(hand[5]).toEqual(hands[frameIndex][5]);
      expect(hand[9]).toEqual(hands[frameIndex][9]);

      const palmCenter = hand[5].map((value, axis) => (
        (value + hand[9][axis] + hand[13][axis] + hand[17][axis]) / 4
      ));
      const palmDirection = palmCenter.map(
        (value, axis) => value - hand[0][axis],
      );
      const palmLength = Math.hypot(...palmDirection);
      const joinedTip = hand[8].map((value, axis) => (
        (value + hand[12][axis]) / 2
      ));
      const tipDelta = joinedTip.map((value, axis) => value - hand[4][axis]);
      rubbingOffsets.push(tipDelta.reduce(
        (sum, value, axis) => sum + value * palmDirection[axis] / palmLength,
        0,
      ) / palmWidth);

      for (const chain of [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]) {
        chain.slice(1).forEach((toIndex, segmentIndex) => {
          const fromIndex = chain[segmentIndex];
          const sourceLength = Math.hypot(...hands[frameIndex][toIndex].map(
            (value, axis) => value - hands[frameIndex][fromIndex][axis],
          ));
          const presentedLength = Math.hypot(...hand[toIndex].map(
            (value, axis) => value - hand[fromIndex][axis],
          ));
          expect(presentedLength).toBeCloseTo(sourceLength, 6);
        });
      }
    });

    expect(Math.max(...rubbingOffsets) - Math.min(...rubbingOffsets)).toBeGreaterThan(0.045);
    const directionChanges = rubbingOffsets.slice(1).filter((value, index) => (
      value * rubbingOffsets[index] < 0
    ));
    expect(directionChanges.length).toBeGreaterThanOrEqual(5);

    const profiles = require('../../../assets/motions/avatar_profile_overrides.json');
    expect(profiles.DINERO.rigLeftHandShape).toBe('money-rub');
  });

  it('presents both CUÁNTO hands as an initial Q that opens fully', () => {
    const motion = require('../../../assets/motions/cuánto.motion.json') as SignMotion;
    const profiles = require('../../../assets/motions/avatar_profile_overrides.json');
    const profile = profiles['CUÁNTO'];
    const fingerChains = [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
      [17, 18, 19, 20],
    ];
    const fingertipSeparation = (hand: MotionPoint[]) => {
      const tips = [4, 8, 12, 16, 20].map(index => hand[index]);
      return Math.max(...tips.flatMap((first, firstIndex) => (
        tips.slice(firstIndex + 1).map(second => Math.hypot(...second.map(
          (value, axis) => value - first[axis],
        )))
      )));
    };

    expect(profile.forceTwoHands).toBe(true);
    expect(profile.rigLeftHandShape).toBe('question-q');
    expect(profile.rigRightHandShape).toBe('question-q');
    [33, 54].forEach(handStart => {
      const captured = motion.frames.map(frame => frame.bodyHands.slice(handStart, handStart + 21));
      const presented = presentQuestionQHandLandmarkFrames(captured);
      const palmWidth = Math.hypot(...presented[0][17].map(
        (value, axis) => value - presented[0][5][axis],
      ));
      expect(fingertipSeparation(presented[0])).toBeLessThan(palmWidth * 0.5);
      expect(fingertipSeparation(presented[presented.length - 1]))
        .toBeGreaterThan(fingertipSeparation(presented[0]) * 2);
      presented.forEach((hand, frameIndex) => {
        [0, 1, 5, 9, 13, 17].forEach(root => {
          expect(hand[root]).toEqual(captured[frameIndex][root]);
        });
        fingerChains.forEach(chain => {
          chain.slice(1).forEach((toIndex, segmentIndex) => {
            const fromIndex = chain[segmentIndex];
            const capturedLength = Math.hypot(...captured[frameIndex][toIndex].map(
              (value, axis) => value - captured[frameIndex][fromIndex][axis],
            ));
            const presentedLength = Math.hypot(...hand[toIndex].map(
              (value, axis) => value - hand[fromIndex][axis],
            ));
            expect(presentedLength).toBeCloseTo(capturedLength, 7);
          });
        });
      });
    });
  });

  it('applies editor-authored states independently to each finger', () => {
    const motion = require('../../../assets/motions/blanco.motion.json') as SignMotion;
    const hands = motion.frames.map(frame => frame.bodyHands.slice(33, 54));
    const presented = presentConfiguredHandLandmarkFrames(hands, {
      thumb: 'extended',
      index: 'extended',
      middle: 'closed',
      ring: 'closed',
      pinky: 'closed',
    });
    const extensionRatio = (hand: MotionPoint[], chain: number[]) => {
      const totalLength = chain.slice(1).reduce((sum, to, index) => (
        sum + Math.hypot(...hand[to].map(
          (value, axis) => value - hand[chain[index]][axis],
        ))
      ), 0);
      return Math.hypot(...hand[chain[3]].map(
        (value, axis) => value - hand[chain[0]][axis],
      )) / totalLength;
    };

    presented.forEach(hand => {
      expect(extensionRatio(hand, [1, 2, 3, 4])).toBeGreaterThan(0.9);
      expect(extensionRatio(hand, [5, 6, 7, 8])).toBeGreaterThan(0.98);
      for (const chain of [[9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]) {
        expect(extensionRatio(hand, chain)).toBeLessThan(0.97);
      }
    });
  });

  it('drives only proximal finger bones for a stable open-hand rig', () => {
    expect([1, 5, 9, 13, 17].filter(shouldDriveStableOpenHandSegment)).toEqual([1, 5, 9, 13, 17]);
    expect([2, 3, 6, 7, 10, 11, 14, 15, 18, 19].some(shouldDriveStableOpenHandSegment)).toBe(false);
  });

  it('drives the full thumb and proximal long-finger bones for a fully open hand', () => {
    expect([1, 2, 3, 5, 9, 13, 17]
      .every(shouldDriveFullyOpenHandSegment)).toBe(true);
    expect([0, 4, 6, 7, 8, 10, 11, 12, 14, 15, 16, 18, 19, 20, 21]
      .some(shouldDriveFullyOpenHandSegment)).toBe(false);
  });

  it('keeps an extended thumb authored while driving every long-finger segment', () => {
    expect([1, 2, 3].some(fromIndex => (
      shouldDriveConfiguredExtendedFingerSegment('thumb', fromIndex)
    ))).toBe(false);
    expect([5, 6, 7].every(fromIndex => (
      shouldDriveConfiguredExtendedFingerSegment('index', fromIndex)
    ))).toBe(true);
    expect([9, 10, 11].every(fromIndex => (
      shouldDriveConfiguredExtendedFingerSegment('middle', fromIndex)
    ))).toBe(true);
    expect(shouldDriveConfiguredExtendedFingerSegment('index', 9)).toBe(false);
  });

  it('drives only proximal bones for a flat palm so its upright thumb cannot twist', () => {
    expect([1, 5, 9, 13, 17].every(shouldDriveFlatPalmSegment)).toBe(true);
    expect([2, 3, 6, 7, 10, 11, 14, 15, 18, 19].some(shouldDriveFlatPalmSegment)).toBe(false);
  });

  it('lets a pointing index inherit its straight distal alignment', () => {
    expect([5, 6, 7].filter(shouldDrivePointingHandSegment)).toEqual([5]);
    expect([1, 2, 3, 9, 10, 11].every(shouldDrivePointingHandSegment)).toBe(true);
  });

  it('softens abrupt finger curls without changing roots or segment lengths', () => {
    const hand = Array.from({length: 21}, () => point(0, 0));
    hand[5] = point(0.1, 0.1);
    hand[6] = point(0.1, 0.14);
    hand[7] = point(0.135, 0.155);
    hand[8] = point(0.165, 0.13);

    const presented = softenFingerCurlLandmarks(hand, 0.5);
    expect(presented[5]).toEqual(hand[5]);
    for (const [from, to] of [[5, 6], [6, 7], [7, 8]]) {
      const originalLength = Math.hypot(...hand[to].map((value, axis) => value - hand[from][axis]));
      const presentedLength = Math.hypot(...presented[to].map((value, axis) => value - presented[from][axis]));
      expect(presentedLength).toBeCloseTo(originalLength, 8);
    }
    expect(presented[8][1]).toBeGreaterThan(hand[8][1]);
  });

  it('stabilizes anatomical finger bends without moving roots or changing lengths', () => {
    const makeHand = () => {
      const hand = Array.from({length: 21}, () => point(0.5, 0.5));
      hand[0] = point(0.5, 0.5);
      hand[1] = point(0.455, 0.535);
      hand[2] = point(0.43, 0.565);
      hand[3] = point(0.42, 0.595);
      hand[4] = point(0.425, 0.62);
      [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]].forEach((chain, fingerIndex) => {
        const rootX = 0.5 + (fingerIndex - 1.5) * 0.022;
        hand[chain[0]] = point(rootX, 0.545);
        hand[chain[1]] = point(rootX, 0.585);
        hand[chain[2]] = point(rootX, 0.62);
        hand[chain[3]] = point(rootX, 0.65);
      });
      return hand;
    };
    const first = makeHand();
    const noisy = makeHand();
    const last = makeHand();
    noisy[7] = point(0.69, 0.575, 0.04);
    noisy[8] = point(0.38, 0.555, -0.05);

    const presented = presentAnatomicalHandLandmarkFrames([first, noisy, last]);

    [0, 1, 5, 9, 13, 17].forEach(root => {
      expect(presented[1][root]).toEqual(noisy[root]);
    });
    for (const [from, to] of [[5, 6], [6, 7], [7, 8]]) {
      const sourceLength = Math.hypot(...noisy[to].map(
        (value, axis) => value - noisy[from][axis],
      ));
      const presentedLength = Math.hypot(...presented[1][to].map(
        (value, axis) => value - presented[1][from][axis],
      ));
      expect(presentedLength).toBeCloseTo(sourceLength, 8);
    }
    expect(Math.abs(presented[1][7][0] - presented[1][6][0]))
      .toBeLessThan(Math.abs(noisy[7][0] - noisy[6][0]));
    expect(presented[1].every(value => value.every(Number.isFinite))).toBe(true);
  });

  it('preserves the captured palm turn in BUENAS TARDES while stabilizing fingers', () => {
    const motion = require('../../../assets/motions/buenas tardes.motion.json') as SignMotion;
    const capturedHands = motion.frames.map(frame => frame.bodyHands.slice(33, 54));
    const presentedHands = presentAnatomicalHandLandmarkFrames(capturedHands);
    const normal = (hand: MotionPoint[]) => {
      const wrist = hand[0];
      const index = hand[5].map((value, axis) => value - wrist[axis]);
      const pinky = hand[17].map((value, axis) => value - wrist[axis]);
      const cross = point(
        index[1] * pinky[2] - index[2] * pinky[1],
        index[2] * pinky[0] - index[0] * pinky[2],
        index[0] * pinky[1] - index[1] * pinky[0],
      );
      const length = Math.hypot(...cross);
      return cross.map(value => value / length);
    };
    const initialNormal = normal(presentedHands[0]);
    const alignment = (hand: MotionPoint[]) => normal(hand).reduce(
      (sum, value, axis) => sum + value * initialNormal[axis],
      0,
    );

    presentedHands.forEach((hand, frameIndex) => {
      [0, 5, 9, 13, 17].forEach(root => {
        expect(hand[root]).toEqual(capturedHands[frameIndex][root]);
      });
    });
    expect(Math.min(...presentedHands.map(alignment))).toBeLessThan(-0.6);
  });

  it('keeps both DESPACIO hands open with every finger extended', () => {
    const profiles = require('../../../assets/motions/avatar_profile_overrides.json');
    const motion = require('../../../assets/motions/despacio.motion.json') as SignMotion;
    const profile = profiles.DESPACIO;
    const expectedStates = {
      thumb: 'extended',
      index: 'extended',
      middle: 'extended',
      ring: 'extended',
      pinky: 'extended',
    } as const;

    expect(profile.forceTwoHands).toBe(true);
    expect(profile.rigLeftHandShape).toBe('fully-open');
    expect(profile.rigRightHandShape).toBe('fully-open');
    expect(profile.rigLeftFingerStates).toEqual(expectedStates);
    expect(profile.rigRightFingerStates).toEqual(expectedStates);

    const longFingerChains = [
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
      [17, 18, 19, 20],
    ];
    let checkedFrames = 0;
    [33, 54].forEach(handStart => {
      const hands = motion.frames.map(frame => frame.bodyHands.slice(handStart, handStart + 21));
      const presented = presentConfiguredHandLandmarkFrames(hands, expectedStates);
      presented.forEach(hand => {
        if (!longFingerChains.every(chain => chain.every(index => (
          hand[index].some(value => Math.abs(value) > 1e-8)
        )))) return;
        const directions = longFingerChains.map(chain => {
          const vector = hand[chain[3]].map(
            (value, axis) => value - hand[chain[0]][axis],
          );
          const length = Math.hypot(...vector);
          expect(length).toBeGreaterThan(1e-8);
          return vector.map(value => value / length);
        });
        directions.slice(1).forEach(direction => {
          const alignment = direction.reduce(
            (sum, value, axis) => sum + value * directions[0][axis],
            0,
          );
          expect(alignment).toBeGreaterThan(0.995);
        });
        checkedFrames += 1;
      });
    });
    expect(checkedFrames).toBeGreaterThan(0);
  });

  it('stabilizes a fist in palm-local space without moving its anatomical roots', () => {
    const base = Array.from({length: 21}, () => point(0, 0));
    base[0] = point(0, 0);
    base[1] = point(-0.04, 0.03);
    base[2] = point(-0.065, 0.055);
    base[3] = point(-0.045, 0.078);
    base[4] = point(-0.015, 0.07);
    [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]].forEach((chain, fingerIndex) => {
      const rootX = (fingerIndex - 1.5) * 0.025;
      base[chain[0]] = point(rootX, 0.06);
      base[chain[1]] = point(rootX, 0.095);
      base[chain[2]] = point(rootX + 0.022, 0.105);
      base[chain[3]] = point(rootX + 0.035, 0.085);
    });
    const rotate = (source: MotionPoint[]) => source.map(([x, y, z]) => point(-y, x, z));
    const outlier = base.map(value => [...value] as MotionPoint);
    outlier[8] = point(0.3, -0.2, 0.1);
    outlier[12] = point(-0.25, 0.28, -0.1);

    const [first, rotated] = stabilizeFistHandLandmarkFrames([
      base,
      rotate(base),
      outlier,
    ]);

    for (const root of [0, 1, 5, 9, 13, 17]) {
      expect(first[root]).toEqual(base[root]);
      expect(rotated[root]).toEqual(rotate(base)[root]);
    }
    for (const chain of [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]) {
      for (let index = 1; index < chain.length; index += 1) {
        const from = chain[index - 1];
        const to = chain[index];
        const originalLength = Math.hypot(...base[to].map((value, axis) => value - base[from][axis]));
        const stableLength = Math.hypot(...first[to].map((value, axis) => value - first[from][axis]));
        expect(stableLength).toBeCloseTo(originalLength, 8);
        expect(rotated[to][0]).toBeCloseTo(-first[to][1], 8);
        expect(rotated[to][1]).toBeCloseTo(first[to][0], 8);
        expect(rotated[to][2]).toBeCloseTo(first[to][2], 8);
      }
    }
  });

  it('rounds a fist presentation without moving roots or changing phalanx lengths', () => {
    const hand = Array.from({length: 21}, () => point(0, 0));
    hand[0] = point(0, 0);
    hand[5] = point(0.02, 0.05, 0);
    hand[6] = point(0.02, 0.09, -0.01);
    hand[7] = point(0.05, 0.095, -0.025);
    hand[8] = point(0.065, 0.07, -0.035);
    hand[9] = point(0, 0.06, 0);
    hand[13] = point(-0.02, 0.05, 0);
    hand[17] = point(-0.04, 0.04, 0);

    const [presented] = presentFistHandLandmarkFrames([hand]);

    expect(presented[5]).toEqual(hand[5]);
    for (const [from, to] of [[5, 6], [6, 7], [7, 8]]) {
      const sourceLength = Math.hypot(...hand[to].map((value, axis) => value - hand[from][axis]));
      const presentedLength = Math.hypot(...presented[to].map((value, axis) => value - presented[from][axis]));
      expect(presentedLength).toBeCloseTo(sourceLength, 8);
    }
  });

  it('keeps a fist closed when later tracking frames briefly look open', () => {
    const closed = Array.from({length: 21}, () => point(0, 0));
    const open = Array.from({length: 21}, () => point(0, 0));
    closed[0] = point(0, 0);
    open[0] = point(0, 0);
    closed[1] = point(-0.045, 0.025);
    closed[2] = point(-0.065, 0.05);
    closed[3] = point(-0.04, 0.065);
    closed[4] = point(-0.015, 0.045);
    open[1] = point(-0.045, 0.025);
    open[2] = point(-0.07, 0.045);
    open[3] = point(-0.09, 0.065);
    open[4] = point(-0.11, 0.085);

    [[5, -0.035], [9, -0.012], [13, 0.012], [17, 0.035]].forEach(([rootIndex, x]) => {
      const chain = [rootIndex, rootIndex + 1, rootIndex + 2, rootIndex + 3];
      closed[chain[0]] = point(x, 0.055);
      closed[chain[1]] = point(x, 0.09);
      closed[chain[2]] = point(x + 0.025, 0.095);
      closed[chain[3]] = point(x + 0.03, 0.065);
      open[chain[0]] = point(x, 0.055);
      open[chain[1]] = point(x, 0.095);
      open[chain[2]] = point(x, 0.135);
      open[chain[3]] = point(x, 0.175);
    });

    const translate = (hand: MotionPoint[]) => hand.map(([x, y, z]) => (
      point(x + 0.5, y + 0.5, z)
    ));
    const translatedClosed = translate(closed);
    const translatedOpen = translate(open);
    const frames = [
      translatedClosed,
      translatedClosed,
      translatedOpen,
      translatedOpen,
      translatedOpen,
      translatedOpen,
      translatedOpen,
      translatedOpen,
    ].map(hand => hand.map(value => [...value] as MotionPoint));
    const presented = presentFistHandLandmarkFrames(frames);
    const finalHand = presented[presented.length - 1];
    const indexChain = [5, 6, 7, 8];
    const totalLength = indexChain.slice(1).reduce((sum, toIndex, segmentIndex) => (
      sum + Math.hypot(...finalHand[toIndex].map(
        (value, axis) => value - finalHand[indexChain[segmentIndex]][axis],
      ))
    ), 0);
    const rootToTip = Math.hypot(...finalHand[8].map(
      (value, axis) => value - finalHand[5][axis],
    ));

    expect(finalHand[5]).toEqual(translatedOpen[5]);
    expect(rootToTip / totalLength).toBeLessThan(0.6);
  });

  it('keeps TÚ pointing with a straight index and captured stable folded fingers', () => {
    const motion = require('../../../assets/motions/tú.motion.json');
    const hands: MotionPoint[][] = motion.frames.map((frame: {bodyHands: MotionPoint[]}) => (
      frame.bodyHands.slice(33, 54)
    ));
    const presented = presentPointingHandLandmarkFrames(hands);
    const chains = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];

    presented.forEach((hand, frameIndex) => {
      for (const root of [0, 1, 5, 9, 13, 17]) {
        expect(hand[root]).toEqual(hands[frameIndex][root]);
      }
      chains.forEach(chain => {
        for (let index = 1; index < chain.length; index += 1) {
          const from = chain[index - 1];
          const to = chain[index];
          const sourceLength = Math.hypot(...hands[frameIndex][to].map(
            (value, axis) => value - hands[frameIndex][from][axis],
          ));
          const presentedLength = Math.hypot(...hand[to].map(
            (value, axis) => value - hand[from][axis],
          ));
          expect(presentedLength).toBeCloseTo(sourceLength, 8);
        }
      });

      const extensionRatio = (chain: number[]) => {
        const rootToTip = Math.hypot(...hand[chain[3]].map(
          (value, axis) => value - hand[chain[0]][axis],
        ));
        const totalLength = chain.slice(1).reduce((sum, to, index) => (
          sum + Math.hypot(...hand[to].map(
            (value, axis) => value - hand[chain[index]][axis],
          ))
        ), 0);
        return rootToTip / totalLength;
      };
      expect(extensionRatio([5, 6, 7, 8])).toBeGreaterThan(0.98);
      for (const chain of [[9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]) {
        expect(extensionRatio(chain)).toBeLessThan(0.97);
        expect(hand[chain[3]].every(Number.isFinite)).toBe(true);
      }
    });
  });

  it('keeps YO as one index pointing from a closed captured fist', () => {
    const motion = require('../../../assets/motions/yo.motion.json');
    const hands: MotionPoint[][] = motion.frames.map((frame: {bodyHands: MotionPoint[]}) => (
      frame.bodyHands.slice(33, 54)
    ));
    const presented = presentSelfPointingHandLandmarkFrames(hands);
    const chains = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
    const extensionRatio = (hand: MotionPoint[], chain: number[]) => {
      const totalLength = chain.slice(1).reduce((sum, to, index) => (
        sum + Math.hypot(...hand[to].map(
          (value, axis) => value - hand[chain[index]][axis],
        ))
      ), 0);
      return Math.hypot(...hand[chain[3]].map(
        (value, axis) => value - hand[chain[0]][axis],
      )) / totalLength;
    };

    presented.forEach((hand, frameIndex) => {
      for (const root of [0, 1, 5, 9, 13, 17]) {
        expect(hand[root]).toEqual(hands[frameIndex][root]);
      }
      chains.forEach(chain => {
        for (let index = 1; index < chain.length; index += 1) {
          const from = chain[index - 1];
          const to = chain[index];
          const sourceLength = Math.hypot(...hands[frameIndex][to].map(
            (value, axis) => value - hands[frameIndex][from][axis],
          ));
          const presentedLength = Math.hypot(...hand[to].map(
            (value, axis) => value - hand[from][axis],
          ));
          expect(presentedLength).toBeCloseTo(sourceLength, 8);
        }
      });
      expect(extensionRatio(hand, [5, 6, 7, 8])).toBeGreaterThan(0.98);
      expect(extensionRatio(hand, [1, 2, 3, 4])).toBeLessThan(0.8);
      expect(extensionRatio(hand, [9, 10, 11, 12])).toBeLessThan(0.85);
      expect(extensionRatio(hand, [13, 14, 15, 16])).toBeLessThan(0.85);
      expect(extensionRatio(hand, [17, 18, 19, 20])).toBeLessThan(0.85);
      expect(hand.every(value => value.every(Number.isFinite))).toBe(true);
    });
  });

  it('keeps both AMIGO hands as closed fists with only the indexes extended', () => {
    const motion = require('../../../assets/motions/amigo.motion.json');
    const profiles = require('../../../assets/motions/avatar_profile_overrides.json');
    const chains = {
      thumb: [1, 2, 3, 4],
      index: [5, 6, 7, 8],
      middle: [9, 10, 11, 12],
      ring: [13, 14, 15, 16],
      pinky: [17, 18, 19, 20],
    };
    const extensionRatio = (hand: MotionPoint[], chain: number[]) => {
      const totalLength = chain.slice(1).reduce((sum, toIndex, segmentIndex) => (
        sum + Math.hypot(...hand[toIndex].map(
          (value, axis) => value - hand[chain[segmentIndex]][axis],
        ))
      ), 0);
      return Math.hypot(...hand[chain[3]].map(
        (value, axis) => value - hand[chain[0]][axis],
      )) / totalLength;
    };

    expect(profiles.AMIGO).toEqual(expect.objectContaining({
      forceTwoHands: true,
      rigLeftHandShape: 'index-only',
      rigRightHandShape: 'index-only',
    }));
    [33, 54].forEach(handStart => {
      const capturedHands: MotionPoint[][] = motion.frames.map(
        (frame: {bodyHands: MotionPoint[]}) => frame.bodyHands.slice(handStart, handStart + 21),
      );
      const presented = presentIndexOnlyHandLandmarkFrames(capturedHands);
      presented.forEach((hand, frameIndex) => {
        for (const root of [0, 1, 5, 9, 13, 17]) {
          expect(hand[root]).toEqual(capturedHands[frameIndex][root]);
        }
        Object.values(chains).forEach(chain => {
          for (let index = 1; index < chain.length; index += 1) {
            const sourceLength = Math.hypot(...capturedHands[frameIndex][chain[index]].map(
              (value, axis) => value - capturedHands[frameIndex][chain[index - 1]][axis],
            ));
            const presentedLength = Math.hypot(...hand[chain[index]].map(
              (value, axis) => value - hand[chain[index - 1]][axis],
            ));
            expect(presentedLength).toBeCloseTo(sourceLength, 8);
          }
        });
        expect(extensionRatio(hand, chains.index)).toBeGreaterThan(0.995);
        expect(extensionRatio(hand, chains.thumb)).toBeLessThan(0.9);
        const palmCenter = [5, 9, 13, 17].reduce<MotionPoint>(
          (sum, index) => sum.map((value, axis) => value + hand[index][axis]) as MotionPoint,
          [0, 0, 0],
        ).map(value => value / 4) as MotionPoint;
        const palmLongitudinal = palmCenter.map(
          (value, axis) => value - hand[0][axis],
        ) as MotionPoint;
        const thumbDirection = hand[4].map(
          (value, axis) => value - hand[1][axis],
        ) as MotionPoint;
        const thumbTowardFist = thumbDirection.reduce(
          (sum, value, axis) => sum + value * palmLongitudinal[axis],
          0,
        ) / (Math.hypot(...thumbDirection) * Math.hypot(...palmLongitudinal));
        expect(thumbTowardFist).toBeGreaterThan(0.25);
        for (const chain of [chains.middle, chains.ring, chains.pinky]) {
          expect(extensionRatio(hand, chain)).toBeLessThan(0.86);
          const segmentDirections = chain.slice(1).map((toIndex, segmentIndex) => {
            const from = hand[chain[segmentIndex]];
            const to = hand[toIndex];
            const length = Math.hypot(...to.map((value, axis) => value - from[axis]));
            return to.map((value, axis) => (value - from[axis]) / length);
          });
          const firstBend = segmentDirections[0].reduce(
            (sum, value, axis) => sum + value * segmentDirections[1][axis],
            0,
          );
          const secondBend = segmentDirections[1].reduce(
            (sum, value, axis) => sum + value * segmentDirections[2][axis],
            0,
          );
          expect(firstBend).toBeGreaterThan(0.35);
          expect(firstBend).toBeLessThan(0.75);
          expect(secondBend).toBeGreaterThan(0.55);
          expect(secondBend).toBeLessThan(0.85);
        }
        expect(hand.every(point => point.every(Number.isFinite))).toBe(true);
      });
    });
  });

  it('renders CABALLO as two compact aligned fists', () => {
    const profiles = require('../../../assets/motions/avatar_profile_overrides.json');

    expect(profiles.CABALLO).toEqual(expect.objectContaining({
      forceTwoHands: true,
      rigLeftHandShape: 'fist',
      rigRightHandShape: 'fist',
      rigLeftPalmScaleMin: 1,
      rigRightPalmScaleMin: 1,
      rigInterHandContact: expect.objectContaining({
        movingSide: 'L',
        supportSide: 'R',
        snap: 1,
      }),
    }));
  });

  it('adds life only to captures whose normalized facial features remain static', () => {
    const face = Array.from({length: 468}, () => point(0.5, 0.5));
    face[33] = point(0.4, 0.45);
    face[263] = point(0.6, 0.45);
    face[159] = point(0.43, 0.44);
    face[145] = point(0.43, 0.46);
    face[386] = point(0.57, 0.44);
    face[374] = point(0.57, 0.46);
    face[13] = point(0.5, 0.52);
    face[14] = point(0.5, 0.53);
    face[61] = point(0.47, 0.525);
    face[291] = point(0.53, 0.525);
    face[105] = point(0.43, 0.41);
    face[334] = point(0.57, 0.41);
    const staticMotion: SignMotion = {fps: 30, frames: [face, face].map(value => ({bodyHands: [], face: value.map(item => [...item] as MotionPoint)}))};
    expect(hasStaticFaceForLivelyExpression(staticMotion)).toBe(true);

    const expressiveFace = face.map(item => [...item] as MotionPoint);
    expressiveFace[14] = point(0.5, 0.59);
    const expressiveMotion: SignMotion = {fps: 30, frames: [{bodyHands: [], face}, {bodyHands: [], face: expressiveFace}]};
    expect(hasStaticFaceForLivelyExpression(expressiveMotion)).toBe(false);
  });

  it('chooses repeatable gestures and fades them in and out', () => {
    expect(chooseLivelyFaceExpression('HOLA:7')).toBe(chooseLivelyFaceExpression('HOLA:7'));
    expect(livelyFaceExpressionIntensity(0)).toBe(0);
    expect(livelyFaceExpressionIntensity(0.5)).toBeCloseTo(1, 8);
    expect(livelyFaceExpressionIntensity(0.25)).toBeGreaterThan(0.5);
    expect(livelyFaceExpressionIntensity(1)).toBe(0);
  });

  it('keeps the idle face alive without touching captured sign timing', () => {
    expect(livelyIdleFacePresentation(0)).toEqual({expression: 'smile', intensity: 0.24});
    expect(livelyIdleFacePresentation(2295).expression).toBe('blink');
    expect(livelyIdleFacePresentation(2295).intensity).toBeCloseTo(1, 8);
    expect(livelyIdleFacePresentation(6000 + 4620).expression).toBe('wink-left');
    expect(livelyIdleFacePresentation(6000 + 4620).intensity).toBeCloseTo(1, 8);
    expect(livelyIdleFacePresentation(12000 + 4620).expression).toBe('smile');
  });

  it('keeps idle breathing and weight shift inside subtle presentation bounds', () => {
    const samples = Array.from({length: 1000}, (_, index) => livelyIdleBodyPresentation(index * 25));
    expect(Math.max(...samples.map(sample => Math.abs(sample.verticalOffset)))).toBeLessThanOrEqual(0.006);
    expect(Math.max(...samples.map(sample => Math.abs(sample.rotationZ)))).toBeLessThanOrEqual(0.0065);
    expect(Math.min(...samples.map(sample => sample.scale))).toBeGreaterThanOrEqual(0.9985);
    expect(Math.max(...samples.map(sample => sample.scale))).toBeLessThanOrEqual(1.0015);
  });

  it('keeps idle gaze and head motion subtle', () => {
    const samples = Array.from({length: 1000}, (_, index) => livelyIdleGazePresentation(index * 25));
    expect(Math.max(...samples.map(sample => Math.abs(sample.eyeYaw)))).toBeLessThanOrEqual(0.095);
    expect(Math.max(...samples.map(sample => Math.abs(sample.headYaw)))).toBeLessThanOrEqual(0.028);
    expect(Math.max(...samples.map(sample => Math.abs(sample.headTilt)))).toBeLessThanOrEqual(0.012);
  });

  it('fades rig-only facial contact corrections around the authored frames', () => {
    expect(contactPresentationWeight(5, 7, 11)).toBe(0);
    expect(contactPresentationWeight(6, 7, 11)).toBeCloseTo(0.5, 8);
    expect(contactPresentationWeight(7, 7, 11)).toBe(1);
    expect(contactPresentationWeight(11, 7, 11)).toBe(1);
    expect(contactPresentationWeight(12, 7, 11)).toBeCloseTo(0.5, 8);
    expect(contactPresentationWeight(13, 7, 11)).toBe(0);
  });

  it('moves a profiled wrist behind the head without changing its screen trajectory', () => {
    expect(riggedWristDepth(0.2, 0.55)).toBeCloseTo(0.55, 8);
    expect(riggedWristDepth(0.2, 0.55, 'back')).toBeCloseTo(-0.15, 8);
    expect(riggedWristDepth(0.2, 0.55, 'back', 0.5)).toBeCloseTo(0.2, 8);
    expect(riggedWristDepth(0.2, 0.55, 'back', -1)).toBeCloseTo(0.55, 8);
    expect(riggedWristDepth(0.2, 0.55, 'back', 2)).toBeCloseTo(-0.15, 8);
    expect(riggedWristDepth(0.2, 0.2, 'back', 1, 0.48)).toBeCloseTo(-0.28, 8);
  });

  it('keeps a resting hand in front and fades to its signing depth smoothly', () => {
    expect(initialRiggedHandFrontDepth(0.28, 0.54, 0, 12, 7)).toBe(0.54);
    expect(initialRiggedHandFrontDepth(0.28, 0.54, 12, 12, 7)).toBe(0.54);
    expect(initialRiggedHandFrontDepth(0.28, 0.54, 15.5, 12, 7)).toBeCloseTo(0.41, 8);
    expect(initialRiggedHandFrontDepth(0.28, 0.54, 19, 12, 7)).toBe(0.28);
  });
});
