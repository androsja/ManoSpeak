import {
  MotionPoint,
  SignMotion,
} from './CompactSignMotion';

export type LivelyFaceExpression =
  | 'smile'
  | 'smirk-left'
  | 'smirk-right'
  | 'blink'
  | 'wink-left'
  | 'wink-right';

export type LivelyFacePresentation = {
  expression: LivelyFaceExpression;
  intensity: number;
};

export type LivelyIdleBodyPresentation = {
  verticalOffset: number;
  rotationZ: number;
  scale: number;
};

export type LivelyIdleGazePresentation = {
  eyeYaw: number;
  headYaw: number;
  headTilt: number;
};

export type CapturedFacePresentation = {
  headYaw: number;
  headPitch: number;
  headRoll: number;
  leftEyeClosure: number;
  rightEyeClosure: number;
  leftEyeWidening: number;
  rightEyeWidening: number;
  mouthOpening: number;
  mouthPucker: number;
  leftMouthCornerDrop: number;
  rightMouthCornerDrop: number;
  leftMouthCornerRaise: number;
  rightMouthCornerRaise: number;
  leftInnerBrowLift: number;
  rightInnerBrowLift: number;
  leftInnerBrowLower: number;
  rightInnerBrowLower: number;
};

export type CapturedFaceCalibration = {
  mouthOpeningRatioBaseline: number;
  mouthWidthReference: number;
  leftEyeOpenReference: number;
  rightEyeOpenReference: number;
  leftEyeWideningBaseline: number;
  rightEyeWideningBaseline: number;
  leftMouthCornerBaseline: number;
  rightMouthCornerBaseline: number;
  leftInnerBrowBaseline: number;
  rightInnerBrowBaseline: number;
};

export type CapturedHeadOrientation = {
  yaw: number;
  pitch: number;
  roll: number;
};

export type CapturedNeckHeadOrientation = {
  neck: CapturedHeadOrientation;
  head: CapturedHeadOrientation;
};

export type FaceOverlayAnchors = {
  leftEye: MotionPoint;
  rightEye: MotionPoint;
  mouth: MotionPoint;
  chin: MotionPoint;
};

export type RiggedHandPresentation =
  | 'captured'
  | 'anatomical'
  | 'open'
  | 'open-palm'
  | 'soft-curl'
  | 'fist'
  | 'pointing'
  | 'self-pointing'
  | 'index-only'
  | 'thumb-up';

/**
 * Copies the 21 captured landmarks without changing their configuration.
 * This mode is used when the recording already contains the intended hand
 * shape and the rig must follow it point by point. The copy keeps presentation
 * code from ever mutating the published motion data.
 */
export function presentCapturedHandLandmarkFrames(
  hands: MotionPoint[][],
): MotionPoint[][] {
  return hands.map(hand => hand.map(point => [...point] as MotionPoint));
}

/**
 * Returns a bounded presentation scale for a rigged palm. A fist must retain
 * the authored palm size: overlapping knuckles make the captured span look
 * smaller, but human hand bones do not shrink while the fingers close.
 */
export function riggedPalmScaleFactor(
  targetLongitudinal: number,
  actualLongitudinal: number,
  targetLateral: number,
  actualLateral: number,
  preserveAuthoredSize = false,
  minimumScale = 0.72,
  maximumScale = 1.18,
): number {
  if (preserveAuthoredSize) return 1;
  const longitudinalRatio = targetLongitudinal / Math.max(0.0001, actualLongitudinal);
  const lateralRatio = targetLateral / Math.max(0.0001, actualLateral);
  const safeMinimum = Math.max(0.5, Math.min(2, minimumScale));
  const safeMaximum = Math.max(safeMinimum, Math.min(2, maximumScale));
  return Math.min(safeMaximum, Math.max(
    safeMinimum,
    (longitudinalRatio + lateralRatio) / 2,
  ));
}

/**
 * Decides whether incidental tracker noise from the quieter hand should be
 * hidden on the rigged character. Some genuinely two-handed signs keep one
 * hand almost still (for example HAMBRE), so authored overrides must win over
 * the motion-ratio heuristic.
 */
export function shouldUseSingleHandRig(
  leftMotionScore: number,
  rightMotionScore: number,
  forceTwoHands = false,
  bothHandsCaptured = false,
): boolean {
  if (forceTwoHands || bothHandsCaptured) return false;
  const activeScore = Math.max(leftMotionScore, rightMotionScore);
  const restingScore = Math.min(leftMotionScore, rightMotionScore);
  return activeScore > 0.01 && activeScore >= restingScore * 1.8;
}

type FaceMetrics = {
  headRoll: number;
  headYaw: number;
  headPitch: number;
  leftEyeOpening: number;
  rightEyeOpening: number;
  mouthOpening: number;
  mouthWidth: number;
  leftMouthCornerDrop: number;
  rightMouthCornerDrop: number;
  leftInnerBrowLift: number;
  rightInnerBrowLift: number;
};

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampSigned(value: number, limit: number): number {
  if (Math.abs(value) < 1e-12) return 0;
  return Math.min(limit, Math.max(-limit, value));
}

function averagePoint(...points: MotionPoint[]): MotionPoint {
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
    points.reduce((sum, point) => sum + point[2], 0) / points.length,
  ];
}

type FaceOverlayBasis = {
  center: MotionPoint;
  horizontal: MotionPoint;
  vertical: MotionPoint;
  eyeDistance: number;
  mouthX: number;
  mouthY: number;
  chinX: number;
  chinY: number;
};

function faceOverlayBasis(anchors: FaceOverlayAnchors): FaceOverlayBasis | undefined {
  const center = averagePoint(anchors.leftEye, anchors.rightEye);
  const horizontal = normalize([
    anchors.rightEye[0] - anchors.leftEye[0],
    anchors.rightEye[1] - anchors.leftEye[1],
    0,
  ]);
  if (!horizontal) return undefined;
  let vertical: MotionPoint = [-horizontal[1], horizontal[0], 0];
  const towardChin: MotionPoint = [
    anchors.chin[0] - center[0],
    anchors.chin[1] - center[1],
    0,
  ];
  if (dot(vertical, towardChin) < 0) {
    vertical = [-vertical[0], -vertical[1], 0];
  }
  const local = (point: MotionPoint): [number, number] => {
    const offset: MotionPoint = [point[0] - center[0], point[1] - center[1], 0];
    return [dot(offset, horizontal), dot(offset, vertical)];
  };
  const [mouthX, mouthY] = local(anchors.mouth);
  const [chinX, chinY] = local(anchors.chin);
  const eyeDistance = Math.hypot(
    anchors.rightEye[0] - anchors.leftEye[0],
    anchors.rightEye[1] - anchors.leftEye[1],
  );
  if (eyeDistance < 1e-8 || mouthY < 1e-8 || chinY <= mouthY + 1e-8) return undefined;
  return {center, horizontal, vertical, eyeDistance, mouthX, mouthY, chinX, chinY};
}

function faceOverlayAnchorValue(
  sourceY: number,
  sourceMouthY: number,
  sourceChinY: number,
  targetMouthValue: number,
  targetChinValue: number,
): number {
  if (sourceY <= sourceMouthY) {
    return targetMouthValue * (sourceY / sourceMouthY);
  }
  const ratio = (sourceY - sourceMouthY) / (sourceChinY - sourceMouthY);
  return targetMouthValue + (targetChinValue - targetMouthValue) * ratio;
}

/**
 * Warps a captured facial landmark onto a stylized avatar using anatomical
 * anchors instead of body proportions. Eye spacing controls horizontal size;
 * the eye-to-mouth and mouth-to-chin spans are mapped independently so a
 * large cartoon forehead or short jaw cannot pull the overlay downward.
 */
export function adaptFaceOverlayPoint(
  point: MotionPoint,
  sourceAnchors: FaceOverlayAnchors,
  targetAnchors: FaceOverlayAnchors,
): MotionPoint {
  const source = faceOverlayBasis(sourceAnchors);
  const target = faceOverlayBasis(targetAnchors);
  if (!source || !target) return [...point] as MotionPoint;
  const sourceOffset: MotionPoint = [
    point[0] - source.center[0],
    point[1] - source.center[1],
    0,
  ];
  const sourceX = dot(sourceOffset, source.horizontal);
  const sourceY = dot(sourceOffset, source.vertical);
  const sourceCenterX = faceOverlayAnchorValue(
    sourceY,
    source.mouthY,
    source.chinY,
    source.mouthX,
    source.chinX,
  );
  const targetCenterX = faceOverlayAnchorValue(
    sourceY,
    source.mouthY,
    source.chinY,
    target.mouthX,
    target.chinX,
  );
  const targetY = faceOverlayAnchorValue(
    sourceY,
    source.mouthY,
    source.chinY,
    target.mouthY,
    target.chinY,
  );
  const targetX = targetCenterX
    + (sourceX - sourceCenterX) * (target.eyeDistance / source.eyeDistance);
  return [
    target.center[0]
      + target.horizontal[0] * targetX
      + target.vertical[0] * targetY,
    target.center[1]
      + target.horizontal[1] * targetX
      + target.vertical[1] * targetY,
    target.center[2],
  ];
}

function faceMetrics(face: MotionPoint[]): FaceMetrics | undefined {
  const requiredIndexes = [1, 10, 13, 14, 33, 61, 70, 107, 145, 152, 159, 234, 263, 291, 300, 336, 374, 386, 454];
  if (!requiredIndexes.every(index => isValid(face[index]))) return undefined;

  const leftEyeOuter = face[33];
  const rightEyeOuter = face[263];
  const horizontalX = rightEyeOuter[0] - leftEyeOuter[0];
  const horizontalY = rightEyeOuter[1] - leftEyeOuter[1];
  const scale = Math.hypot(horizontalX, horizontalY);
  if (scale < 0.0001) return undefined;

  const horizontal = [horizontalX / scale, horizontalY / scale] as const;
  let vertical = [-horizontal[1], horizontal[0]] as [number, number];
  const eyeCenter = averagePoint(leftEyeOuter, rightEyeOuter);
  const chinDirection = [face[152][0] - eyeCenter[0], face[152][1] - eyeCenter[1]];
  if (chinDirection[0] * vertical[0] + chinDirection[1] * vertical[1] < 0) {
    vertical = [-vertical[0], -vertical[1]];
  }
  const verticalDistance = (point: MotionPoint, origin: MotionPoint) => (
    ((point[0] - origin[0]) * vertical[0] + (point[1] - origin[1]) * vertical[1]) / scale
  );
  const horizontalDistance = (point: MotionPoint, origin: MotionPoint) => (
    ((point[0] - origin[0]) * horizontal[0] + (point[1] - origin[1]) * horizontal[1]) / scale
  );

  const mouthCenter = averagePoint(face[13], face[14]);
  const leftEyeCenter = averagePoint(face[159], face[145]);
  const rightEyeCenter = averagePoint(face[386], face[374]);
  const faceHorizontal = [
    face[454][0] - face[234][0],
    face[454][1] - face[234][1],
    face[454][2] - face[234][2],
  ];
  const faceVertical = [
    face[152][0] - face[10][0],
    face[152][1] - face[10][1],
    face[152][2] - face[10][2],
  ];
  let faceNormal = [
    faceHorizontal[1] * faceVertical[2] - faceHorizontal[2] * faceVertical[1],
    faceHorizontal[2] * faceVertical[0] - faceHorizontal[0] * faceVertical[2],
    faceHorizontal[0] * faceVertical[1] - faceHorizontal[1] * faceVertical[0],
  ];
  const normalLength = Math.hypot(...faceNormal);
  if (normalLength < 0.0001) return undefined;
  faceNormal = faceNormal.map(value => value / normalLength);
  if (faceNormal[2] < 0) faceNormal = faceNormal.map(value => -value);
  return {
    headRoll: Math.atan2(horizontalY, horizontalX),
    // MediaPipe uses image-space Y (downward). The signs below convert its
    // face-plane normal into the avatar's world-space head directions. A
    // positive screen-space normal means the signer raised the chin, which is
    // a negative X rotation in the avatar rig.
    headYaw: -Math.atan2(faceNormal[0], Math.abs(faceNormal[2])),
    headPitch: -Math.atan2(faceNormal[1], Math.abs(faceNormal[2])),
    leftEyeOpening: Math.abs(verticalDistance(face[145], face[159])),
    rightEyeOpening: Math.abs(verticalDistance(face[374], face[386])),
    mouthOpening: Math.abs(verticalDistance(face[14], face[13])),
    mouthWidth: Math.abs(horizontalDistance(face[291], face[61])),
    leftMouthCornerDrop: verticalDistance(face[61], mouthCenter),
    rightMouthCornerDrop: verticalDistance(face[291], mouthCenter),
    leftInnerBrowLift: verticalDistance(face[70], leftEyeCenter)
      - verticalDistance(face[107], leftEyeCenter),
    rightInnerBrowLift: verticalDistance(face[300], rightEyeCenter)
      - verticalDistance(face[336], rightEyeCenter),
  };
}

export function capturedHeadOrientation(
  face: MotionPoint[],
): CapturedHeadOrientation | undefined {
  const metrics = faceMetrics(face);
  if (!metrics) return undefined;
  return {
    yaw: clampSigned(metrics.headYaw, 0.8),
    pitch: clampSigned(metrics.headPitch, 0.55),
    roll: clampSigned(-metrics.headRoll, 0.7),
  };
}

/**
 * Shares a captured orientation between the neck and head while preserving
 * the exact total turn. Moving only the head bone leaves the neck unnaturally
 * vertical during large turns and makes the head appear detached from it.
 */
export function splitCapturedHeadOrientation(
  orientation: CapturedHeadOrientation,
): CapturedNeckHeadOrientation {
  const neck = {
    yaw: orientation.yaw * 0.28,
    pitch: orientation.pitch * 0.22,
    roll: orientation.roll * 0.35,
  };
  return {
    neck,
    head: {
      yaw: orientation.yaw - neck.yaw,
      pitch: orientation.pitch - neck.pitch,
      roll: orientation.roll - neck.roll,
    },
  };
}

/**
 * Returns a robust percentile without allowing a single noisy frame to
 * become the neutral reference for a complete facial performance.
 */
function quantile(values: number[], amount: number): number {
  const sorted = [...values].sort((first, second) => first - second);
  const position = Math.max(0, Math.min(1, amount)) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const mix = position - lowerIndex;
  return sorted[lowerIndex] * (1 - mix) + sorted[upperIndex] * mix;
}

export function capturedFaceCalibration(
  motion: SignMotion,
): CapturedFaceCalibration | undefined {
  const metrics = motion.frames
    .map(frame => faceMetrics(frame.face))
    .filter((value): value is FaceMetrics => value != null);
  if (metrics.length === 0) return undefined;
  const values = (select: (value: FaceMetrics) => number) => metrics.map(select);
  return {
    // Robust percentiles ignore isolated tracker collapses while preserving a
    // mouth or blink that was already active in the first captured frame.
    mouthOpeningRatioBaseline: quantile(values(value => (
      value.mouthOpening / Math.max(0.1, value.mouthWidth)
    )), 0.1),
    mouthWidthReference: quantile(values(value => value.mouthWidth), 0.8),
    leftEyeOpenReference: quantile(values(value => value.leftEyeOpening), 0.9),
    rightEyeOpenReference: quantile(values(value => value.rightEyeOpening), 0.9),
    leftEyeWideningBaseline: quantile(values(value => value.leftEyeOpening), 0.5),
    rightEyeWideningBaseline: quantile(values(value => value.rightEyeOpening), 0.5),
    leftMouthCornerBaseline: quantile(values(value => value.leftMouthCornerDrop), 0.5),
    rightMouthCornerBaseline: quantile(values(value => value.rightMouthCornerDrop), 0.5),
    leftInnerBrowBaseline: quantile(values(value => value.leftInnerBrowLift), 0.5),
    rightInnerBrowBaseline: quantile(values(value => value.rightInnerBrowLift), 0.5),
  };
}

/**
 * Converts recorded MediaPipe facial landmarks into a small, renderer-only
 * control set. Measurements use a face-local coordinate system so head tilt
 * and distance from the camera do not become false expressions.
 */
export function capturedFacePresentation(
  face: MotionPoint[],
  referenceFace: MotionPoint[],
  calibration?: CapturedFaceCalibration,
): CapturedFacePresentation | undefined {
  const current = faceMetrics(face);
  const reference = faceMetrics(referenceFace);
  if (!current || !reference) return undefined;
  const calibrated = calibration ?? {
    mouthOpeningRatioBaseline: reference.mouthOpening / Math.max(0.1, reference.mouthWidth),
    mouthWidthReference: reference.mouthWidth,
    leftEyeOpenReference: reference.leftEyeOpening,
    rightEyeOpenReference: reference.rightEyeOpening,
    leftEyeWideningBaseline: reference.leftEyeOpening,
    rightEyeWideningBaseline: reference.rightEyeOpening,
    leftMouthCornerBaseline: reference.leftMouthCornerDrop,
    rightMouthCornerBaseline: reference.rightMouthCornerDrop,
    leftInnerBrowBaseline: reference.leftInnerBrowLift,
    rightInnerBrowBaseline: reference.rightInnerBrowLift,
  };

  const eyeClosure = (opening: number, referenceOpening: number) => {
    const relativeClosure = referenceOpening > 0.001
      ? (referenceOpening - opening) / (referenceOpening * 0.72)
      : 0;
    const absoluteClosure = (0.105 - opening) / 0.075;
    return clampUnit(Math.max(relativeClosure, absoluteClosure));
  };
  const eyeWidening = (opening: number, referenceOpening: number) => (
    clampUnit((opening - referenceOpening) / Math.max(0.025, referenceOpening * 0.75))
  );
  const leftCornerDelta = current.leftMouthCornerDrop - calibrated.leftMouthCornerBaseline;
  const rightCornerDelta = current.rightMouthCornerDrop - calibrated.rightMouthCornerBaseline;
  const leftBrowDelta = calibrated.leftInnerBrowBaseline - current.leftInnerBrowLift;
  const rightBrowDelta = calibrated.rightInnerBrowBaseline - current.rightInnerBrowLift;
  const mouthOpeningRatio = current.mouthOpening / Math.max(0.1, current.mouthWidth);
  return {
    headYaw: clampSigned(current.headYaw, 0.8),
    headPitch: clampSigned(current.headPitch, 0.55),
    headRoll: clampSigned(-current.headRoll, 0.7),
    leftEyeClosure: eyeClosure(current.leftEyeOpening, calibrated.leftEyeOpenReference),
    rightEyeClosure: eyeClosure(current.rightEyeOpening, calibrated.rightEyeOpenReference),
    leftEyeWidening: eyeWidening(current.leftEyeOpening, calibrated.leftEyeWideningBaseline),
    rightEyeWidening: eyeWidening(current.rightEyeOpening, calibrated.rightEyeWideningBaseline),
    mouthOpening: clampUnit(Math.max(
      (mouthOpeningRatio - calibrated.mouthOpeningRatioBaseline) / 0.05,
      (mouthOpeningRatio - 0.003) / 0.12,
    )),
    mouthPucker: clampUnit(Math.max(
      (calibrated.mouthWidthReference - current.mouthWidth)
        / Math.max(0.04, calibrated.mouthWidthReference * 0.12),
      (0.58 - current.mouthWidth) / 0.16,
    )),
    leftMouthCornerDrop: clampUnit(leftCornerDelta / 0.045),
    rightMouthCornerDrop: clampUnit(rightCornerDelta / 0.045),
    leftMouthCornerRaise: clampUnit(-leftCornerDelta / 0.045),
    rightMouthCornerRaise: clampUnit(-rightCornerDelta / 0.045),
    leftInnerBrowLift: clampUnit(leftBrowDelta / 0.06),
    rightInnerBrowLift: clampUnit(rightBrowDelta / 0.06),
    leftInnerBrowLower: clampUnit(-leftBrowDelta / 0.06),
    rightInnerBrowLower: clampUnit(-rightBrowDelta / 0.06),
  };
}

const LONG_FINGER_CHAINS = [
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
] as const;
const THUMB_CHAIN = [1, 2, 3, 4] as const;
const FIST_FINGER_CHAINS = [THUMB_CHAIN, ...LONG_FINGER_CHAINS] as const;
const POINTING_INDEX_CHAIN = LONG_FINGER_CHAINS[0];
const STABLE_OPEN_HAND_PROXIMAL_JOINTS = new Set([1, 5, 9, 13, 17]);

const FACE_FEATURE_PAIRS = [
  [159, 145],
  [386, 374],
  [13, 14],
  [61, 291],
  [105, 159],
  [334, 386],
] as const;

function isValid(point: MotionPoint | undefined): point is MotionPoint {
  return point != null && point.some(value => Math.abs(value) > 1e-8);
}

function distance(first: MotionPoint, second: MotionPoint): number {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  );
}

function unitVector(first: MotionPoint, second: MotionPoint): MotionPoint | undefined {
  const length = distance(first, second);
  if (length < 1e-8) return undefined;
  return [
    (second[0] - first[0]) / length,
    (second[1] - first[1]) / length,
    (second[2] - first[2]) / length,
  ];
}

function normalize(vector: MotionPoint): MotionPoint | undefined {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 1e-8) return undefined;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function subtract(first: MotionPoint, second: MotionPoint): MotionPoint {
  return [
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  ];
}

function dot(first: MotionPoint, second: MotionPoint): number {
  return first[0] * second[0]
    + first[1] * second[1]
    + first[2] * second[2];
}

function cross(first: MotionPoint, second: MotionPoint): MotionPoint {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

type HandBasis = {
  lateral: MotionPoint;
  longitudinal: MotionPoint;
  normal: MotionPoint;
};

function handBasis(hand: MotionPoint[]): HandBasis | undefined {
  if (![0, 5, 9, 13, 17].every(index => isValid(hand[index]))) return undefined;
  const palmCenter = averagePoint(hand[5], hand[9], hand[13], hand[17]);
  const longitudinal = normalize(subtract(palmCenter, hand[0]));
  if (!longitudinal) return undefined;
  const capturedLateral = subtract(hand[17], hand[5]);
  const lateral = normalize([
    capturedLateral[0] - longitudinal[0] * dot(capturedLateral, longitudinal),
    capturedLateral[1] - longitudinal[1] * dot(capturedLateral, longitudinal),
    capturedLateral[2] - longitudinal[2] * dot(capturedLateral, longitudinal),
  ]);
  if (!lateral) return undefined;
  const normal = normalize(cross(lateral, longitudinal));
  return normal ? {lateral, longitudinal, normal} : undefined;
}

function localDirection(direction: MotionPoint, basis: HandBasis): MotionPoint {
  return [
    dot(direction, basis.lateral),
    dot(direction, basis.longitudinal),
    dot(direction, basis.normal),
  ];
}

function worldDirection(direction: MotionPoint, basis: HandBasis): MotionPoint | undefined {
  return normalize([
    basis.lateral[0] * direction[0]
      + basis.longitudinal[0] * direction[1]
      + basis.normal[0] * direction[2],
    basis.lateral[1] * direction[0]
      + basis.longitudinal[1] * direction[1]
      + basis.normal[1] * direction[2],
    basis.lateral[2] * direction[0]
      + basis.longitudinal[2] * direction[1]
      + basis.normal[2] * direction[2],
  ]);
}

function median(values: number[]): number {
  const ordered = [...values].sort((first, second) => first - second);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

/**
 * Builds a rig-only open-hand presentation from the captured landmarks.
 * MCP roots and every original phalanx length remain unchanged. The four long
 * finger chains become straight and near-parallel; the thumb keeps its own
 * open angle while removing an isolated bent distal landmark.
 */
export function straightenOpenHandLandmarks(hand: MotionPoint[]): MotionPoint[] {
  const result = hand.map(point => [...point] as MotionPoint);
  const directions = LONG_FINGER_CHAINS.map(chain => {
    const base = hand[chain[0]];
    const tip = hand[chain[chain.length - 1]];
    return isValid(base) && isValid(tip) ? unitVector(base, tip) : undefined;
  });
  const reference = directions[1] ?? directions.find(Boolean);
  if (!reference) return result;

  const alignedDirections = directions
    .filter((direction): direction is MotionPoint => direction != null)
    .map(direction => {
      const dot = direction[0] * reference[0]
        + direction[1] * reference[1]
        + direction[2] * reference[2];
      return dot < 0
        ? [-direction[0], -direction[1], -direction[2]] as MotionPoint
        : direction;
    });
  const shared = normalize(alignedDirections.reduce<MotionPoint>(
    (sum, direction) => [
      sum[0] + direction[0],
      sum[1] + direction[1],
      sum[2] + direction[2],
    ],
    [0, 0, 0],
  ));
  if (!shared) return result;

  LONG_FINGER_CHAINS.forEach((chain, chainIndex) => {
    const personal = directions[chainIndex];
    const base = hand[chain[0]];
    if (!personal || !isValid(base) || !chain.every(index => isValid(hand[index]))) return;
    const dot = personal[0] * shared[0] + personal[1] * shared[1] + personal[2] * shared[2];
    const alignedPersonal: MotionPoint = dot < 0
      ? [-personal[0], -personal[1], -personal[2]]
      : personal;
    const direction = normalize([
      shared[0] * 0.82 + alignedPersonal[0] * 0.18,
      shared[1] * 0.82 + alignedPersonal[1] * 0.18,
      shared[2] * 0.82 + alignedPersonal[2] * 0.18,
    ]);
    if (!direction) return;

    let cursor = [...base] as MotionPoint;
    for (let jointIndex = 1; jointIndex < chain.length; jointIndex += 1) {
      const segmentLength = distance(hand[chain[jointIndex - 1]], hand[chain[jointIndex]]);
      cursor = [
        cursor[0] + direction[0] * segmentLength,
        cursor[1] + direction[1] * segmentLength,
        cursor[2] + direction[2] * segmentLength,
      ];
      result[chain[jointIndex]] = cursor;
    }
  });

  const thumbBase = hand[THUMB_CHAIN[0]];
  const thumbTip = hand[THUMB_CHAIN[THUMB_CHAIN.length - 1]];
  const thumbDirection = isValid(thumbBase) && isValid(thumbTip)
    ? unitVector(thumbBase, thumbTip)
    : undefined;
  if (thumbDirection && THUMB_CHAIN.every(index => isValid(hand[index]))) {
    let cursor = [...thumbBase] as MotionPoint;
    for (let jointIndex = 1; jointIndex < THUMB_CHAIN.length; jointIndex += 1) {
      const previousIndex = THUMB_CHAIN[jointIndex - 1];
      const currentIndex = THUMB_CHAIN[jointIndex];
      const segmentLength = distance(hand[previousIndex], hand[currentIndex]);
      cursor = [
        cursor[0] + thumbDirection[0] * segmentLength,
        cursor[1] + thumbDirection[1] * segmentLength,
        cursor[2] + thumbDirection[2] * segmentLength,
      ];
      result[currentIndex] = cursor;
    }
  }

  return result;
}

/**
 * Legacy entry point retained for older profiles. An open support hand must
 * still come from the 21 recorded landmarks: deriving a clip-wide template
 * changes thumb abduction and finger separation, which can change a sign.
 */
export function presentStableOpenPalmHandLandmarkFrames(
  hands: MotionPoint[][],
): MotionPoint[][] {
  return presentCapturedHandLandmarkFrames(hands);
}

/**
 * Stable open-hand signs only need the proximal bone of each finger driven.
 * Distal bones inherit their authored local alignment, preventing independent
 * per-phalanx rotations from visually twisting an otherwise straight finger.
 */
export function shouldDriveStableOpenHandSegment(fromIndex: number): boolean {
  return STABLE_OPEN_HAND_PROXIMAL_JOINTS.has(fromIndex);
}

/**
 * Drives only the proximal index bone for a pointing hand. The distal bones
 * inherit the model's straight authored alignment, preventing independent
 * collinear solves from introducing a visible axial twist.
 */
export function shouldDrivePointingHandSegment(fromIndex: number): boolean {
  return fromIndex !== 6 && fromIndex !== 7;
}

/**
 * Reduces abrupt changes between consecutive phalanges without replacing the
 * captured handshape. Roots and segment lengths remain unchanged; only the
 * derived rig presentation receives this profile-specific correction.
 */
export function softenFingerCurlLandmarks(
  hand: MotionPoint[],
  strength = 0.46,
): MotionPoint[] {
  const result = hand.map(point => [...point] as MotionPoint);
  const safeStrength = Math.min(0.8, Math.max(0, strength));
  const chains = [THUMB_CHAIN, ...LONG_FINGER_CHAINS] as const;

  chains.forEach((chain, chainIndex) => {
    if (!chain.every(index => isValid(hand[index]))) return;
    let cursor = [...hand[chain[0]]] as MotionPoint;
    let previousDirection: MotionPoint | undefined;
    const chainStrength = chainIndex === 0 ? safeStrength * 0.45 : safeStrength;

    for (let jointIndex = 1; jointIndex < chain.length; jointIndex += 1) {
      const previousIndex = chain[jointIndex - 1];
      const currentIndex = chain[jointIndex];
      const originalDirection = unitVector(hand[previousIndex], hand[currentIndex]);
      const segmentLength = distance(hand[previousIndex], hand[currentIndex]);
      if (!originalDirection || segmentLength < 1e-8) continue;
      const direction = previousDirection
        ? normalize([
          originalDirection[0] * (1 - chainStrength) + previousDirection[0] * chainStrength,
          originalDirection[1] * (1 - chainStrength) + previousDirection[1] * chainStrength,
          originalDirection[2] * (1 - chainStrength) + previousDirection[2] * chainStrength,
        ]) ?? originalDirection
        : originalDirection;
      cursor = [
        cursor[0] + direction[0] * segmentLength,
        cursor[1] + direction[1] * segmentLength,
        cursor[2] + direction[2] * segmentLength,
      ];
      result[currentIndex] = cursor;
      previousDirection = direction;
    }
  });

  return result;
}

function clampDirectionBend(
  previous: MotionPoint,
  requested: MotionPoint,
  maximumAngleRadians: number,
): MotionPoint {
  const cosine = Math.min(1, Math.max(-1, dot(previous, requested)));
  const angle = Math.acos(cosine);
  if (angle <= maximumAngleRadians) return requested;
  const perpendicular = normalize([
    requested[0] - previous[0] * cosine,
    requested[1] - previous[1] * cosine,
    requested[2] - previous[2] * cosine,
  ]);
  if (!perpendicular) return previous;
  return normalize([
    previous[0] * Math.cos(maximumAngleRadians)
      + perpendicular[0] * Math.sin(maximumAngleRadians),
    previous[1] * Math.cos(maximumAngleRadians)
      + perpendicular[1] * Math.sin(maximumAngleRadians),
    previous[2] * Math.cos(maximumAngleRadians)
      + perpendicular[2] * Math.sin(maximumAngleRadians),
  ]) ?? requested;
}

/**
 * Produces a conservative, rig-only hand presentation for every sign.
 * Directions are stabilized in palm-local space across one neighboring frame
 * on each side. PIP and DIP joints also receive anatomical side-bend and
 * reversal limits, while their captured flexion remains intact. This avoids
 * tracker spikes becoming twisted or claw-like skinned fingers.
 *
 * The wrist, MCP roots, source landmarks, frame count and timestamps are never
 * changed. Every rebuilt segment retains the length captured in that frame.
 */
export function presentAnatomicalHandLandmarkFrames(
  hands: MotionPoint[][],
): MotionPoint[][] {
  const bases = hands.map(handBasis);
  const chains = [THUMB_CHAIN, ...LONG_FINGER_CHAINS] as const;

  return hands.map((hand, frameIndex) => {
    const result = hand.map(point => [...point] as MotionPoint);
    const basis = bases[frameIndex];
    if (!basis) return result;

    chains.forEach((chain, chainIndex) => {
      if (!chain.every(index => isValid(hand[index]))) return;
      let cursor = [...hand[chain[0]]] as MotionPoint;
      let previousLocalDirection: MotionPoint | undefined;

      for (let segmentIndex = 0; segmentIndex < chain.length - 1; segmentIndex += 1) {
        const fromIndex = chain[segmentIndex];
        const toIndex = chain[segmentIndex + 1];
        const capturedDirection = unitVector(hand[fromIndex], hand[toIndex]);
        const segmentLength = distance(hand[fromIndex], hand[toIndex]);
        if (!capturedDirection || segmentLength < 1e-8) continue;
        const capturedLocal = localDirection(capturedDirection, basis);
        const samples: Array<{direction: MotionPoint; weight: number}> = [];

        [-1, 0, 1].forEach(offset => {
          const sampleHand = hands[frameIndex + offset];
          const sampleBasis = bases[frameIndex + offset];
          if (!sampleHand || !sampleBasis) return;
          const direction = unitVector(sampleHand[fromIndex], sampleHand[toIndex]);
          if (!direction) return;
          let local = localDirection(direction, sampleBasis);
          if (dot(local, capturedLocal) < 0) {
            local = [-local[0], -local[1], -local[2]];
          }
          samples.push({direction: local, weight: offset === 0 ? 2 : 1});
        });

        const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
        let localDirectionValue = normalize(samples.reduce<MotionPoint>(
          (sum, sample) => [
            sum[0] + sample.direction[0] * sample.weight,
            sum[1] + sample.direction[1] * sample.weight,
            sum[2] + sample.direction[2] * sample.weight,
          ],
          [0, 0, 0],
        ).map(value => value / Math.max(1, totalWeight)) as MotionPoint) ?? capturedLocal;

        if (previousLocalDirection) {
          if (chainIndex > 0) {
            // Human PIP and DIP joints do not bend far sideways. Preserve the
            // captured flexion plane while suppressing isolated lateral flips.
            const maximumLateralDelta = segmentIndex === 1 ? 0.42 : 0.3;
            localDirectionValue = normalize([
              previousLocalDirection[0] + Math.min(
                maximumLateralDelta,
                Math.max(
                  -maximumLateralDelta,
                  localDirectionValue[0] - previousLocalDirection[0],
                ),
              ),
              localDirectionValue[1],
              localDirectionValue[2],
            ]) ?? localDirectionValue;
          }
          localDirectionValue = clampDirectionBend(
            previousLocalDirection,
            localDirectionValue,
            chainIndex === 0 ? Math.PI * 0.75 : Math.PI * 0.69,
          );
        }

        const direction = worldDirection(localDirectionValue, basis);
        if (!direction) continue;
        cursor = [
          cursor[0] + direction[0] * segmentLength,
          cursor[1] + direction[1] * segmentLength,
          cursor[2] + direction[2] * segmentLength,
        ];
        result[toIndex] = cursor;
        previousLocalDirection = localDirectionValue;
      }
    });
    return result;
  });
}

/**
 * Keeps a captured fist coherent while its wrist and palm continue following
 * the original sign. Each phalanx direction is reduced to a robust hand-local
 * template across the clip, so detector noise from overlapping fingers does
 * not become a different claw shape on every frame. This is presentation-only:
 * wrists, MCP roots, frame count and timing are never changed.
 */
export function stabilizeFistHandLandmarkFrames(
  hands: MotionPoint[][],
): MotionPoint[][] {
  const bases = hands.map(handBasis);
  const closureScores = hands.map(hand => {
    const ratios = LONG_FINGER_CHAINS.flatMap(chain => {
      if (!chain.every(index => isValid(hand[index]))) return [];
      const totalLength = chain.slice(1).reduce((sum, toIndex, segmentIndex) => (
        sum + distance(hand[chain[segmentIndex]], hand[toIndex])
      ), 0);
      if (totalLength < 1e-8) return [];
      return [distance(hand[chain[0]], hand[chain[chain.length - 1]]) / totalLength];
    });
    return ratios.length > 0
      ? ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length
      : Number.POSITIVE_INFINITY;
  });
  // Overlapping fingers are the hardest MediaPipe hand pose to recover. In a
  // recorded fist, some frames are reliable while others briefly look open or
  // claw-like. Build the hand-local template only from the most compact
  // quarter of the clip, then keep the captured wrist/palm trajectory for
  // every frame. This preserves the sign while preventing tracker dropouts
  // from opening the rendered fist halfway through HAMBRE.
  const reliableFrameCount = Math.max(1, Math.ceil(hands.length * 0.25));
  const reliableFrameIndexes = new Set(closureScores
    .map((score, frameIndex) => ({score, frameIndex}))
    .filter(candidate => Number.isFinite(candidate.score) && bases[candidate.frameIndex])
    .sort((first, second) => first.score - second.score)
    .slice(0, reliableFrameCount)
    .map(candidate => candidate.frameIndex));
  const templates = FIST_FINGER_CHAINS.map(chain => (
    chain.slice(0, -1).map((fromIndex, segmentIndex) => {
      const toIndex = chain[segmentIndex + 1];
      const samples = hands.flatMap((hand, frameIndex) => {
        if (!reliableFrameIndexes.has(frameIndex)) return [];
        const basis = bases[frameIndex];
        if (!basis || !isValid(hand[fromIndex]) || !isValid(hand[toIndex])) return [];
        const direction = unitVector(hand[fromIndex], hand[toIndex]);
        return direction ? [localDirection(direction, basis)] : [];
      });
      if (samples.length === 0) return undefined;
      return normalize([
        median(samples.map(sample => sample[0])),
        median(samples.map(sample => sample[1])),
        median(samples.map(sample => sample[2])),
      ]);
    })
  ));

  return hands.map((hand, frameIndex) => {
    const result = hand.map(point => [...point] as MotionPoint);
    const basis = bases[frameIndex];
    if (!basis) return result;

    FIST_FINGER_CHAINS.forEach((chain, chainIndex) => {
      if (!chain.every(index => isValid(hand[index]))) return;
      let cursor = [...hand[chain[0]]] as MotionPoint;
      for (let segmentIndex = 0; segmentIndex < chain.length - 1; segmentIndex += 1) {
        const fromIndex = chain[segmentIndex];
        const toIndex = chain[segmentIndex + 1];
        const template = templates[chainIndex][segmentIndex];
        const direction = template ? worldDirection(template, basis) : undefined;
        const segmentLength = distance(hand[fromIndex], hand[toIndex]);
        if (!direction || segmentLength < 1e-8) continue;
        cursor = [
          cursor[0] + direction[0] * segmentLength,
          cursor[1] + direction[1] * segmentLength,
          cursor[2] + direction[2] * segmentLength,
        ];
        result[toIndex] = cursor;
      }
    });
    return result;
  });
}

/**
 * Builds the final rig-only fist presentation used by signs such as HAMBRE.
 * The clip-wide template removes detector outliers first; the small local
 * blend rounds discontinuities between neighboring phalanges afterwards.
 * Roots, segment lengths, frame count and source landmarks stay unchanged.
 */
export function presentFistHandLandmarkFrames(
  hands: MotionPoint[][],
): MotionPoint[][] {
  return stabilizeFistHandLandmarkFrames(hands).map(hand =>
    softenFingerCurlLandmarks(hand, 0.06),
  );
}

/**
 * Builds the two distinct components of the AYUDAR handshape: a stable
 * captured fist for the four long fingers and the original extended thumb.
 * The wrist, palm roots, phalanx lengths, frame count and timing remain the
 * captured values. Only the rigged presentation receives this correction.
 */
export function presentThumbUpHandLandmarkFrames(
  hands: MotionPoint[][],
): MotionPoint[][] {
  const anatomical = presentAnatomicalHandLandmarkFrames(hands);
  return anatomical.map((hand, frameIndex) => {
    const result = hand.map(point => [...point] as MotionPoint);
    const basis = handBasis(hand);
    if (basis) {
      LONG_FINGER_CHAINS.forEach((chain, chainIndex) => {
        if (!chain.every(index => isValid(hand[index]))) return;
        const spread = (1.5 - chainIndex) * 0.055;
        const localDirections: MotionPoint[] = [
          normalize([spread, 0.2, 0.98]) ?? [0, 0.2, 0.98],
          normalize([spread * 0.35, -0.72, 0.69]) ?? [0, -0.72, 0.69],
          normalize([0, -0.96, 0.28]) ?? [0, -0.96, 0.28],
        ];
        let cursor = [...hand[chain[0]]] as MotionPoint;
        for (let segmentIndex = 0; segmentIndex < chain.length - 1; segmentIndex += 1) {
          const fromIndex = chain[segmentIndex];
          const toIndex = chain[segmentIndex + 1];
          const direction = worldDirection(localDirections[segmentIndex], basis);
          const segmentLength = distance(hand[fromIndex], hand[toIndex]);
          if (!direction || segmentLength < 1e-8) continue;
          cursor = [
            cursor[0] + direction[0] * segmentLength,
            cursor[1] + direction[1] * segmentLength,
            cursor[2] + direction[2] * segmentLength,
          ];
          result[toIndex] = cursor;
        }
      });
    }
    THUMB_CHAIN.forEach(index => {
      result[index] = [...anatomical[frameIndex][index]] as MotionPoint;
    });
    return result;
  });
}

/**
 * Builds a compact rig-only pointing hand for signs such as TÚ. The index
 * keeps one clip-wide captured direction while the remaining long fingers use
 * the robust clip-wide captured fold built by the fist stabilizer. Wrist, palm
 * roots, phalanx lengths, frame count and timing remain unchanged. Preserving
 * that captured fold avoids imposing a generic claw shape on the TÚ sign.
 */
export function presentPointingHandLandmarkFrames(
  hands: MotionPoint[][],
): MotionPoint[][] {
  // Round the clip-wide captured fold before extending the index. This keeps
  // the non-pointing fingers compact without replacing their source pose or
  // changing any phalanx length.
  const stabilized = stabilizeFistHandLandmarkFrames(hands).map(hand =>
    softenFingerCurlLandmarks(hand, 0.34),
  );
  const bases = stabilized.map(handBasis);
  const indexSamples = stabilized.flatMap((hand, frameIndex) => {
    const basis = bases[frameIndex];
    if (!basis || !POINTING_INDEX_CHAIN.every(index => isValid(hand[index]))) return [];
    return POINTING_INDEX_CHAIN.slice(0, -1).flatMap((fromIndex, segmentIndex) => {
      const direction = unitVector(hand[fromIndex], hand[POINTING_INDEX_CHAIN[segmentIndex + 1]]);
      return direction ? [localDirection(direction, basis)] : [];
    });
  });
  const indexDirection = indexSamples.length > 0
    ? normalize([
      median(indexSamples.map(sample => sample[0])),
      median(indexSamples.map(sample => sample[1])),
      median(indexSamples.map(sample => sample[2])),
    ])
    : undefined;

  return stabilized.map((hand, frameIndex) => {
    const result = hand.map(point => [...point] as MotionPoint);
    const basis = bases[frameIndex];
    if (!basis) return result;

    const rebuildChain = (
      chain: readonly number[],
      localDirections: readonly MotionPoint[],
    ) => {
      if (!chain.every(index => isValid(hand[index]))) return;
      let cursor = [...hand[chain[0]]] as MotionPoint;
      for (let segmentIndex = 0; segmentIndex < chain.length - 1; segmentIndex += 1) {
        const fromIndex = chain[segmentIndex];
        const toIndex = chain[segmentIndex + 1];
        const direction = worldDirection(localDirections[segmentIndex], basis);
        const segmentLength = distance(hand[fromIndex], hand[toIndex]);
        if (!direction || segmentLength < 1e-8) continue;
        cursor = [
          cursor[0] + direction[0] * segmentLength,
          cursor[1] + direction[1] * segmentLength,
          cursor[2] + direction[2] * segmentLength,
        ];
        result[toIndex] = cursor;
      }
    };

    if (indexDirection) {
      rebuildChain(POINTING_INDEX_CHAIN, [indexDirection, indexDirection, indexDirection]);
    }
    return result;
  });
}

/**
 * Builds the first-person pronoun handshape: a closed fist with only the
 * index extended. YO contains reliable captured folds at different moments
 * for the thumb, middle, ring and little fingers, so each folded chain uses
 * its most compact source frame instead of a clip-wide average. Wrist and MCP
 * roots keep following the capture and every phalanx retains its source
 * length; this only prevents the rig from presenting the hand as a K/V shape.
 */
export function presentSelfPointingHandLandmarkFrames(
  hands: MotionPoint[][],
): MotionPoint[][] {
  const bases = hands.map(handBasis);
  const pointingHands = presentPointingHandLandmarkFrames(hands);
  const foldedChains = [THUMB_CHAIN, ...LONG_FINGER_CHAINS.slice(1)] as const;
  const compactTemplates = foldedChains.map(chain => {
    let compactFrameIndex = -1;
    let compactExtensionRatio = Number.POSITIVE_INFINITY;
    hands.forEach((hand, frameIndex) => {
      if (!bases[frameIndex] || !chain.every(index => isValid(hand[index]))) return;
      const totalLength = chain.slice(1).reduce((sum, toIndex, segmentIndex) => (
        sum + distance(hand[chain[segmentIndex]], hand[toIndex])
      ), 0);
      if (totalLength < 1e-8) return;
      const extensionRatio = distance(hand[chain[0]], hand[chain[chain.length - 1]]) / totalLength;
      if (extensionRatio < compactExtensionRatio) {
        compactExtensionRatio = extensionRatio;
        compactFrameIndex = frameIndex;
      }
    });
    if (compactFrameIndex < 0) return undefined;
    const compactHand = hands[compactFrameIndex];
    const compactBasis = bases[compactFrameIndex]!;
    return chain.slice(0, -1).map((fromIndex, segmentIndex) => {
      const direction = unitVector(compactHand[fromIndex], compactHand[chain[segmentIndex + 1]]);
      return direction ? localDirection(direction, compactBasis) : undefined;
    }).filter((direction): direction is MotionPoint => direction != null);
  });

  return pointingHands.map((hand, frameIndex) => {
    const result = hand.map(point => [...point] as MotionPoint);
    const basis = bases[frameIndex];
    const sourceHand = hands[frameIndex];
    if (!basis) return result;

    foldedChains.forEach((chain, chainIndex) => {
      const template = compactTemplates[chainIndex];
      if (!template || !chain.every(index => isValid(sourceHand[index]))) return;
      let cursor = [...sourceHand[chain[0]]] as MotionPoint;
      for (let segmentIndex = 0; segmentIndex < chain.length - 1; segmentIndex += 1) {
        const fromIndex = chain[segmentIndex];
        const toIndex = chain[segmentIndex + 1];
        const direction = worldDirection(template[segmentIndex], basis);
        const segmentLength = distance(sourceHand[fromIndex], sourceHand[toIndex]);
        if (!direction || segmentLength < 1e-8) continue;
        cursor = [
          cursor[0] + direction[0] * segmentLength,
          cursor[1] + direction[1] * segmentLength,
          cursor[2] + direction[2] * segmentLength,
        ];
        result[toIndex] = cursor;
      }
    });
    return result;
  });
}

/**
 * Builds a reliable closed hand with only the index extended. This differs
 * from the self-pointing presentation because two-hand signs such as AMIGO
 * frequently occlude their folded fingers. MediaPipe can then report a
 * compact but anatomically impossible frame. The index keeps its captured
 * frame-by-frame direction, while the thumb and the other three fingers use
 * one palm-local human curl. Wrist, MCP roots, segment lengths, frame count
 * and timing remain captured values.
 */
export function presentIndexOnlyHandLandmarkFrames(
  hands: MotionPoint[][],
): MotionPoint[][] {
  const anatomicalHands = presentAnatomicalHandLandmarkFrames(hands);
  const bases = anatomicalHands.map(handBasis);
  const foldedLongFingerDirections = LONG_FINGER_CHAINS.slice(1).map((_, chainIndex) => {
    const spread = (1 - chainIndex) * 0.045;
    return [
      normalize([spread, 0.67, 0.74]) ?? [spread, 0.67, 0.74],
      normalize([spread * 0.25, -0.37, 0.93]) ?? [spread * 0.25, -0.37, 0.93],
      normalize([0, -0.98, 0.21]) ?? [0, -0.98, 0.21],
    ] as MotionPoint[];
  });
  // The thumb lies across the closed fingers instead of protruding beside the
  // index. Positive lateral always points from the index side toward pinky.
  const foldedThumbDirections: MotionPoint[] = [
    normalize([0.58, 0.73, 0.36]) ?? [0.58, 0.73, 0.36],
    normalize([0.90, 0.08, 0.43]) ?? [0.90, 0.08, 0.43],
    normalize([0.72, -0.04, -0.69]) ?? [0.72, -0.04, -0.69],
  ];

  return anatomicalHands.map((hand, frameIndex) => {
    const result = hand.map(point => [...point] as MotionPoint);
    const basis = bases[frameIndex];
    if (!basis) return result;

    const rebuildChain = (
      chain: readonly number[],
      localDirections: readonly MotionPoint[],
    ) => {
      if (!chain.every(index => isValid(hand[index]))) return;
      let cursor = [...hand[chain[0]]] as MotionPoint;
      for (let segmentIndex = 0; segmentIndex < chain.length - 1; segmentIndex += 1) {
        const fromIndex = chain[segmentIndex];
        const toIndex = chain[segmentIndex + 1];
        const direction = worldDirection(localDirections[segmentIndex], basis);
        const segmentLength = distance(hand[fromIndex], hand[toIndex]);
        if (!direction || segmentLength < 1e-8) continue;
        cursor = [
          cursor[0] + direction[0] * segmentLength,
          cursor[1] + direction[1] * segmentLength,
          cursor[2] + direction[2] * segmentLength,
        ];
        result[toIndex] = cursor;
      }
    };

    const capturedIndexDirection = unitVector(
      hand[POINTING_INDEX_CHAIN[0]],
      hand[POINTING_INDEX_CHAIN[POINTING_INDEX_CHAIN.length - 1]],
    );
    const capturedIndexLocal = capturedIndexDirection
      ? localDirection(capturedIndexDirection, basis)
      : undefined;
    const indexSamples = [-1, 0, 1].flatMap(offset => {
      const sampleHand = anatomicalHands[frameIndex + offset];
      const sampleBasis = bases[frameIndex + offset];
      if (!sampleHand || !sampleBasis || !capturedIndexLocal) return [];
      const sampleDirection = unitVector(
        sampleHand[POINTING_INDEX_CHAIN[0]],
        sampleHand[POINTING_INDEX_CHAIN[POINTING_INDEX_CHAIN.length - 1]],
      );
      if (!sampleDirection) return [];
      let sampleLocal = localDirection(sampleDirection, sampleBasis);
      if (dot(sampleLocal, capturedIndexLocal) < 0) {
        sampleLocal = [-sampleLocal[0], -sampleLocal[1], -sampleLocal[2]];
      }
      return [{direction: sampleLocal, weight: offset === 0 ? 2 : 1}];
    });
    const totalIndexWeight = indexSamples.reduce((sum, sample) => sum + sample.weight, 0);
    const indexDirection = indexSamples.length > 0
      ? normalize(indexSamples.reduce<MotionPoint>(
        (sum, sample) => [
          sum[0] + sample.direction[0] * sample.weight,
          sum[1] + sample.direction[1] * sample.weight,
          sum[2] + sample.direction[2] * sample.weight,
        ],
        [0, 0, 0],
      ).map(value => value / Math.max(1, totalIndexWeight)) as MotionPoint)
      : undefined;

    if (indexDirection) {
      rebuildChain(POINTING_INDEX_CHAIN, [indexDirection, indexDirection, indexDirection]);
    }
    rebuildChain(THUMB_CHAIN, foldedThumbDirections);
    LONG_FINGER_CHAINS.slice(1).forEach((chain, chainIndex) => {
      rebuildChain(chain, foldedLongFingerDirections[chainIndex]);
    });
    return result;
  });
}

function faceFeatures(face: MotionPoint[]): number[] | undefined {
  const leftEye = face[33];
  const rightEye = face[263];
  if (!isValid(leftEye) || !isValid(rightEye)) return undefined;
  const eyeDistance = Math.hypot(leftEye[0] - rightEye[0], leftEye[1] - rightEye[1]);
  if (eyeDistance < 1e-8) return undefined;
  const features = FACE_FEATURE_PAIRS.map(([firstIndex, secondIndex]) => {
    const first = face[firstIndex];
    const second = face[secondIndex];
    if (!isValid(first) || !isValid(second)) return undefined;
    return Math.hypot(first[0] - second[0], first[1] - second[1]) / eyeDistance;
  });
  return features.every(value => value != null) ? features as number[] : undefined;
}

export function normalizedFaceMotionScore(motion: SignMotion): number {
  const samples = motion.frames.map(frame => faceFeatures(frame.face)).filter((value): value is number[] => value != null);
  if (samples.length < 2) return Number.POSITIVE_INFINITY;
  const ranges = samples[0].map((_, featureIndex) => {
    const values = samples.map(sample => sample[featureIndex]);
    return Math.max(...values) - Math.min(...values);
  });
  return ranges.reduce((sum, range) => sum + range, 0) / ranges.length;
}

export function hasStaticFaceForLivelyExpression(motion: SignMotion): boolean {
  return normalizedFaceMotionScore(motion) <= 0.025;
}

export function chooseLivelyFaceExpression(seed: string): LivelyFaceExpression {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  // Playback id is part of the seed, so repeated signs feel alive without
  // introducing non-deterministic test or rendering behavior. Smiles remain
  // the most common presentation; occasional winks add visible variety.
  return (
    ['smile', 'smile', 'smirk-left', 'smirk-right', 'wink-left', 'wink-right'] as const
  )[Math.abs(hash) % 6];
}

export function livelyFaceExpressionIntensity(progress: number): number {
  const normalizedProgress = Math.min(1, Math.max(0, progress));
  // Keep the synthetic gesture visible through most of a static-face sign.
  // It still starts and ends at neutral so adjacent signs can coarticulate.
  if (normalizedProgress <= 0.08 || normalizedProgress >= 0.92) return 0;
  const gestureProgress = Math.min(1, Math.max(0, (normalizedProgress - 0.08) / 0.84));
  return Math.sin(Math.PI * gestureProgress);
}

/**
 * Returns a deterministic idle expression for the rigged avatar. Idle life is
 * deliberately separate from captured sign motion so it can never overwrite
 * a linguistically meaningful facial expression.
 */
export function livelyIdleFacePresentation(elapsedMs: number): LivelyFacePresentation {
  const cycleDurationMs = 6000;
  const safeElapsedMs = Math.max(0, elapsedMs);
  const cycleIndex = Math.floor(safeElapsedMs / cycleDurationMs);
  const cycleProgress = (safeElapsedMs % cycleDurationMs) / cycleDurationMs;
  const pulse = (start: number, end: number): number => {
    if (cycleProgress < start || cycleProgress > end) return 0;
    return Math.sin(Math.PI * (cycleProgress - start) / (end - start));
  };
  const heldPulse = (
    start: number,
    fullyClosedAt: number,
    startsOpeningAt: number,
    end: number,
  ): number => {
    if (cycleProgress < start || cycleProgress > end) return 0;
    if (cycleProgress < fullyClosedAt) {
      return (cycleProgress - start) / (fullyClosedAt - start);
    }
    if (cycleProgress <= startsOpeningAt) return 1;
    return 1 - (cycleProgress - startsOpeningAt) / (end - startsOpeningAt);
  };

  // A short full-close plateau is essential on a stylized face: a sine pulse
  // reaches its maximum for only one instant and looked like a half blink on
  // a 60 Hz mobile display.
  const blinkIntensity = heldPulse(0.36, 0.378, 0.392, 0.41);
  if (blinkIntensity > 0) return {expression: 'blink', intensity: blinkIntensity};

  const winkIntensity = cycleIndex % 2 === 1 ? pulse(0.72, 0.82) : 0;
  if (winkIntensity > 0) {
    return {
      expression: cycleIndex % 4 === 1 ? 'wink-left' : 'wink-right',
      intensity: winkIntensity,
    };
  }

  return {
    expression: 'smile',
    intensity: 0.24 + 0.06 * Math.sin(Math.PI * 2 * cycleProgress),
  };
}

/**
 * Presentation-only contact weight for signs authored with a facial anchor.
 * The source landmarks remain untouched; the fade prevents a rig correction
 * from appearing abruptly on the first or last contact frame.
 */
export function contactPresentationWeight(
  frameIndex: number,
  contactStartFrame: number,
  contactEndFrame: number,
  fadeFrames = 2,
): number {
  if (frameIndex < 0 || contactStartFrame < 0 || contactEndFrame < contactStartFrame) return 0;
  const safeFadeFrames = Math.max(0, fadeFrames);
  if (frameIndex >= contactStartFrame && frameIndex <= contactEndFrame) return 1;
  if (safeFadeFrames === 0) return 0;
  const fadeInStart = contactStartFrame - safeFadeFrames;
  if (frameIndex >= fadeInStart && frameIndex < contactStartFrame) {
    const progress = (frameIndex - fadeInStart) / safeFadeFrames;
    return progress * progress * (3 - 2 * progress);
  }
  const fadeOutEnd = contactEndFrame + safeFadeFrames;
  if (frameIndex > contactEndFrame && frameIndex <= fadeOutEnd) {
    const progress = (fadeOutEnd - frameIndex) / safeFadeFrames;
    return progress * progress * (3 - 2 * progress);
  }
  return 0;
}

/**
 * Produces a very small breathing and weight-shift loop for the idle avatar.
 * The values are presentation-only and are removed before any captured sign
 * frame is retargeted.
 */
export function livelyIdleBodyPresentation(elapsedMs: number): LivelyIdleBodyPresentation {
  const seconds = Math.max(0, elapsedMs) / 1000;
  const breathing = Math.sin(seconds * Math.PI * 2 / 4.8);
  const weightShift = Math.sin(seconds * Math.PI * 2 / 8.5);
  return {
    verticalOffset: breathing * 0.006,
    rotationZ: weightShift * 0.0065,
    scale: 1 + breathing * 0.0015,
  };
}

/**
 * Slow deterministic glances make the waiting avatar feel attentive while
 * remaining visually distinct from captured sign movement.
 */
export function livelyIdleGazePresentation(elapsedMs: number): LivelyIdleGazePresentation {
  const seconds = Math.max(0, elapsedMs) / 1000;
  const horizontal = Math.sin(seconds * Math.PI * 2 / 9.5);
  const secondary = Math.sin(seconds * Math.PI * 2 / 13.0 + 0.8);
  return {
    eyeYaw: horizontal * 0.095,
    headYaw: horizontal * 0.028,
    headTilt: secondary * 0.012,
  };
}
