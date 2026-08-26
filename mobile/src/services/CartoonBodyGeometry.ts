import {CartoonHandPoint, isCapturedHandPoint} from './CartoonHandGeometry';

export type CartoonBodySegment = {from: number; to: number};

export type CartoonBodyGeometry = {
  torso: number[];
  armSegments: CartoonBodySegment[];
};

// These are pose-landmark indexes, not a replacement skeleton. The renderer
// reads their current captured positions for every single frame.
export const CARTOON_TORSO_OUTLINE: ReadonlyArray<number> = [11, 12, 24, 23];
export const CARTOON_ARM_SEGMENTS: ReadonlyArray<CartoonBodySegment> = [
  {from: 11, to: 13}, {from: 13, to: 15},
  {from: 12, to: 14}, {from: 14, to: 16},
];

export function buildCartoonBodyGeometry(points: ReadonlyArray<CartoonHandPoint>): CartoonBodyGeometry {
  const torso = CARTOON_TORSO_OUTLINE.every(index => isCapturedHandPoint(points[index]))
    ? [...CARTOON_TORSO_OUTLINE]
    : [];
  const armSegments = CARTOON_ARM_SEGMENTS.filter(({from, to}) =>
    isCapturedHandPoint(points[from]) && isCapturedHandPoint(points[to]),
  );
  return {torso, armSegments};
}
