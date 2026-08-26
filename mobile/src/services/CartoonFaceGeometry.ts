import {CartoonHandPoint, isCapturedHandPoint} from './CartoonHandGeometry';

export type CartoonFaceGeometry = {
  forehead: CartoonHandPoint;
  chin: CartoonHandPoint;
  leftEye: CartoonHandPoint;
  rightEye: CartoonHandPoint;
  leftEyeWidth: number;
  rightEyeWidth: number;
  leftEyeOpening: number;
  rightEyeOpening: number;
  leftBrow: [CartoonHandPoint, CartoonHandPoint];
  rightBrow: [CartoonHandPoint, CartoonHandPoint];
  nose: CartoonHandPoint;
  mouthCenter: CartoonHandPoint;
  mouthLeft: CartoonHandPoint;
  mouthRight: CartoonHandPoint;
  mouthUpper: CartoonHandPoint;
  mouthLower: CartoonHandPoint;
  mouthWidth: number;
  mouthOpening: number;
};

function distance(first: CartoonHandPoint, second: CartoonHandPoint): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

function midpoint(first: CartoonHandPoint, second: CartoonHandPoint): CartoonHandPoint {
  return [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2, (first[2] + second[2]) / 2];
}

/** Builds visual-only face features from the captured Face Mesh landmarks. */
export function buildCartoonFaceGeometry(points: ReadonlyArray<CartoonHandPoint>): CartoonFaceGeometry | undefined {
  const indexes = [10, 152, 33, 133, 159, 145, 263, 362, 386, 374, 70, 107, 336, 300, 1, 61, 291, 13, 14];
  if (!indexes.every(index => isCapturedHandPoint(points[index]))) return undefined;
  const mouthWidth = distance(points[61], points[291]);
  if (mouthWidth < 0.0001) return undefined;
  return {
    forehead: points[10], chin: points[152],
    leftEye: midpoint(points[33], points[133]), rightEye: midpoint(points[263], points[362]),
    leftEyeWidth: distance(points[33], points[133]), rightEyeWidth: distance(points[263], points[362]),
    leftEyeOpening: distance(points[159], points[145]), rightEyeOpening: distance(points[386], points[374]),
    leftBrow: [points[70], points[107]], rightBrow: [points[336], points[300]],
    nose: points[1], mouthCenter: midpoint(points[13], points[14]),
    mouthLeft: points[61], mouthRight: points[291], mouthUpper: points[13], mouthLower: points[14],
    mouthWidth, mouthOpening: distance(points[13], points[14]),
  };
}
