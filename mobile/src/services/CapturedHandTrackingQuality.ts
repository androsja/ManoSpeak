import {MotionPoint} from './CompactSignMotion';

const PALM_INDEX_ROOT = 5;
const PALM_PINKY_ROOT = 17;
const HAND_LANDMARK_COUNT = 21;
const HAND_SEGMENTS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
];

export type CapturedHandTrackingAudit = {
  frameCount: number;
  validFrameCount: number;
  dominantPalmOrientation: -1 | 0 | 1;
  palmOrientationFlipFrames: number[];
  palmCollapseFrames: number[];
  phalanxOutlierFrames: number[];
  unstableFrames: number[];
};

export type RiggedHandTrackingRepair = 'stable-palm';

function isValid(point: MotionPoint | undefined): point is MotionPoint {
  return point != null
    && point.every(Number.isFinite)
    && point.some(value => Math.abs(value) > 1e-8);
}

function distance(first: MotionPoint, second: MotionPoint): number {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  );
}

function quantile(values: number[], amount: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const position = Math.max(0, Math.min(1, amount)) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const mix = position - lowerIndex;
  return sorted[lowerIndex] * (1 - mix) + sorted[upperIndex] * mix;
}

function palmSignedArea(hand: MotionPoint[]): number {
  const wrist = hand[0];
  const indexRoot = hand[PALM_INDEX_ROOT];
  const pinkyRoot = hand[PALM_PINKY_ROOT];
  if (![wrist, indexRoot, pinkyRoot].every(isValid)) return 0;
  return (
    (indexRoot[0] - wrist[0]) * (pinkyRoot[1] - wrist[1])
    - (indexRoot[1] - wrist[1]) * (pinkyRoot[0] - wrist[0])
  );
}

function palmSpan(hand: MotionPoint[]): number {
  return isValid(hand[PALM_INDEX_ROOT]) && isValid(hand[PALM_PINKY_ROOT])
    ? distance(hand[PALM_INDEX_ROOT], hand[PALM_PINKY_ROOT])
    : 0;
}

function palmNormal(hand: MotionPoint[]): MotionPoint | undefined {
  const wrist = hand[0];
  const indexRoot = hand[PALM_INDEX_ROOT];
  const pinkyRoot = hand[PALM_PINKY_ROOT];
  if (![wrist, indexRoot, pinkyRoot].every(isValid)) return undefined;
  const first = indexRoot.map((value, axis) => value - wrist[axis]);
  const second = pinkyRoot.map((value, axis) => value - wrist[axis]);
  const normal: MotionPoint = [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
  const length = Math.hypot(...normal);
  return length < 1e-8
    ? undefined
    : normal.map(value => value / length) as MotionPoint;
}

function dominantOrientation(areas: number[]): -1 | 0 | 1 {
  const meaningful = areas.filter(area => Math.abs(area) > 1e-8);
  if (meaningful.length === 0) return 0;
  const negativeCount = meaningful.filter(area => area < 0).length;
  return negativeCount >= meaningful.length - negativeCount ? -1 : 1;
}

function segmentLengths(hand: MotionPoint[]): number[] | undefined {
  const lengths = HAND_SEGMENTS.map(([from, to]) => (
    isValid(hand[from]) && isValid(hand[to])
      ? distance(hand[from], hand[to])
      : Number.NaN
  ));
  return lengths.every(Number.isFinite) ? lengths : undefined;
}

/**
 * Finds capture failures without deciding that an intentional hand rotation is
 * linguistically wrong. The report is therefore a review queue, not an
 * automatic rewrite of published landmarks.
 */
export function auditCapturedHandTracking(
  hands: MotionPoint[][],
): CapturedHandTrackingAudit {
  const validFrames = hands.map(hand => (
    hand.length === HAND_LANDMARK_COUNT && hand.every(isValid)
  ));
  const areas = hands.map((hand, index) => validFrames[index] ? palmSignedArea(hand) : 0);
  const spans = hands.map((hand, index) => validFrames[index] ? palmSpan(hand) : 0);
  const validSpans = spans.filter((span, index) => validFrames[index] && span > 1e-8);
  const medianSpan = quantile(validSpans, 0.5);
  const dominantPalmOrientation = dominantOrientation(areas);
  const normals = hands.map((hand, index) => (
    validFrames[index] ? palmNormal(hand) : undefined
  ));
  const palmOrientationFlipFrames = normals.flatMap((normal, frameIndex) => {
    const previous = normals[frameIndex - 1];
    if (!normal || !previous) return [];
    const dot = normal.reduce((sum, value, axis) => sum + value * previous[axis], 0);
    return dot < -0.25 ? [frameIndex] : [];
  });
  const palmCollapseFrames = spans.flatMap((span, frameIndex) => (
    validFrames[frameIndex]
    && medianSpan > 1e-8
    && span < medianSpan * 0.55
      ? [frameIndex]
      : []
  ));

  const segmentFrames = hands.map((hand, index) => (
    validFrames[index] ? segmentLengths(hand) : undefined
  ));
  const phalanxOutlierFrames = segmentFrames.flatMap((lengths, frameIndex) => {
    const previous = segmentFrames[frameIndex - 1];
    if (!lengths || !previous) return [];
    const outlierCount = lengths.filter((length, segmentIndex) => {
      const baseline = previous[segmentIndex];
      if (baseline < 1e-8) return false;
      const ratio = length / baseline;
      return ratio < 0.45 || ratio > 2.2;
    }).length;
    return outlierCount >= 3 ? [frameIndex] : [];
  });
  const unstableFrames = [...new Set([
    ...palmOrientationFlipFrames,
    ...palmCollapseFrames,
    ...phalanxOutlierFrames,
  ])].sort((first, second) => first - second);

  return {
    frameCount: hands.length,
    validFrameCount: validFrames.filter(Boolean).length,
    dominantPalmOrientation,
    palmOrientationFlipFrames,
    palmCollapseFrames,
    phalanxOutlierFrames,
    unstableFrames,
  };
}

function localPoint(point: MotionPoint, wrist: MotionPoint): MotionPoint {
  return [
    point[0] - wrist[0],
    point[1] - wrist[1],
    point[2] - wrist[2],
  ];
}

function mix(first: number, second: number, amount: number): number {
  return first + (second - first) * amount;
}

/**
 * Repairs only frames that a stable-palm author profile has explicitly marked
 * as tracker failures. Reliable captured frames remain byte-for-byte equal,
 * while failed local hand shapes are interpolated between their nearest
 * reliable captured neighbours. The current captured wrist trajectory is
 * always retained.
 */
export function repairStablePalmHandLandmarkFrames(
  hands: MotionPoint[][],
): MotionPoint[][] {
  const output = hands.map(hand => hand.map(point => [...point] as MotionPoint));
  const audit = auditCapturedHandTracking(hands);
  const areas = hands.map(palmSignedArea);
  const spans = hands.map(palmSpan);
  const medianSpan = quantile(spans.filter(value => value > 1e-8), 0.5);
  const stablePalmFailures = hands.flatMap((hand, frameIndex) => {
    if (hand.length !== HAND_LANDMARK_COUNT || !hand.every(isValid)) return [frameIndex];
    const orientationMismatch = audit.dominantPalmOrientation !== 0
      && Math.sign(areas[frameIndex]) !== audit.dominantPalmOrientation;
    const collapsed = medianSpan > 1e-8 && spans[frameIndex] < medianSpan * 0.72;
    return orientationMismatch || collapsed || audit.phalanxOutlierFrames.includes(frameIndex)
      ? [frameIndex]
      : [];
  });
  if (stablePalmFailures.length === 0) return output;
  const unstable = new Set(stablePalmFailures);
  const reliable = hands.map((hand, frameIndex) => (
    hand.length === HAND_LANDMARK_COUNT
    && hand.every(isValid)
    && !unstable.has(frameIndex)
  ));

  stablePalmFailures.forEach(frameIndex => {
    const current = hands[frameIndex];
    if (!current || !isValid(current[0])) return;
    let previousIndex = frameIndex - 1;
    while (previousIndex >= 0 && !reliable[previousIndex]) previousIndex -= 1;
    let nextIndex = frameIndex + 1;
    while (nextIndex < hands.length && !reliable[nextIndex]) nextIndex += 1;
    if (previousIndex < 0 && nextIndex >= hands.length) return;
    const startIndex = previousIndex >= 0 ? previousIndex : nextIndex;
    const endIndex = nextIndex < hands.length ? nextIndex : previousIndex;
    const start = hands[startIndex];
    const end = hands[endIndex];
    if (!start?.every(isValid) || !end?.every(isValid)) return;
    const amount = startIndex === endIndex
      ? 0
      : (frameIndex - startIndex) / (endIndex - startIndex);
    const wrist = current[0];
    output[frameIndex] = start.map((startPoint, pointIndex) => {
      if (pointIndex === 0) return [...wrist] as MotionPoint;
      const startLocal = localPoint(startPoint, start[0]);
      const endLocal = localPoint(end[pointIndex], end[0]);
      return [
        wrist[0] + mix(startLocal[0], endLocal[0], amount),
        wrist[1] + mix(startLocal[1], endLocal[1], amount),
        wrist[2] + mix(startLocal[2], endLocal[2], amount),
      ];
    });
  });
  return output;
}
