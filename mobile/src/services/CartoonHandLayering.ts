import {CartoonHandPoint, isCapturedHandPoint} from './CartoonHandGeometry';

export type CartoonHandStart = 33 | 54;

const DEPTH_SEPARATION = 0.08;
const SCALE_SEPARATION = 0.18;

function squaredDistance(first: CartoonHandPoint, second: CartoonHandPoint): number {
  return (first[0] - second[0]) ** 2 + (first[1] - second[1]) ** 2;
}

/**
 * Uses only captured hand geometry to choose a drawing order. The result is
 * presentation metadata: it never changes the source landmark coordinates.
 */
export function capturedHandScale(points: ReadonlyArray<CartoonHandPoint>): number {
  const wrist = points[0];
  const middleBase = points[9];
  const middleTip = points[12];
  if (!isCapturedHandPoint(wrist) || !isCapturedHandPoint(middleBase) || !isCapturedHandPoint(middleTip)) {
    return 0;
  }
  return Math.sqrt(squaredDistance(wrist, middleBase)) + Math.sqrt(squaredDistance(middleBase, middleTip));
}

/**
 * Selects which captured hand is painted last. MediaPipe's smaller Z is
 * closer to the camera; when it is ambiguous, apparent scale is a safer cue.
 * Keeping the previous result in the hysteresis band prevents layer flicker.
 */
export function chooseFrontCartoonHand(
  first: ReadonlyArray<CartoonHandPoint>,
  second: ReadonlyArray<CartoonHandPoint>,
  previous: CartoonHandStart,
): CartoonHandStart {
  const firstScale = capturedHandScale(first);
  const secondScale = capturedHandScale(second);
  if (firstScale === 0) return 54;
  if (secondScale === 0) return 33;

  const firstWrist = first[0];
  const secondWrist = second[0];
  if (isCapturedHandPoint(firstWrist) && isCapturedHandPoint(secondWrist)) {
    const depthDifference = firstWrist[2] - secondWrist[2];
    if (Math.abs(depthDifference) >= DEPTH_SEPARATION) return depthDifference < 0 ? 33 : 54;
  }

  const relativeScaleDifference = (firstScale - secondScale) / Math.max(firstScale, secondScale);
  if (Math.abs(relativeScaleDifference) >= SCALE_SEPARATION) return relativeScaleDifference > 0 ? 33 : 54;
  return previous;
}
