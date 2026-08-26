export type CartoonHandPoint = [number, number, number];

export type CartoonHandSegment = {
  from: number;
  to: number;
};

export type CartoonHandGeometry = {
  palm: number[];
  segments: CartoonHandSegment[];
  joints: number[];
};

// MediaPipe Hands landmark topology. These indexes are part of the capture
// contract: geometry may decorate them, but it must never replace their pose.
export const HAND_FINGER_CHAINS: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
];

export const PALM_OUTLINE: ReadonlyArray<number> = [0, 1, 5, 9, 13, 17];

export function isCapturedHandPoint(point: CartoonHandPoint | undefined): point is CartoonHandPoint {
  return point != null && point.some(value => Math.abs(value) > 1e-8);
}

/**
 * Builds only topology derived from the captured hand. The renderer owns
 * colour and thickness; all vertices continue to be read from the source
 * landmarks for the current frame.
 */
export function buildCartoonHandGeometry(points: ReadonlyArray<CartoonHandPoint>): CartoonHandGeometry {
  const segments = HAND_FINGER_CHAINS.flatMap(chain => chain.slice(0, -1).flatMap((from, index) => {
    const to = chain[index + 1];
    return isCapturedHandPoint(points[from]) && isCapturedHandPoint(points[to]) ? [{from, to}] : [];
  }));
  const joints = points.flatMap((point, index) => isCapturedHandPoint(point) ? [index] : []);
  // A partial palm could bridge an absent finger and suggest an invented pose.
  // Draw the fill only when its six anatomical anchors are all present.
  const palm = PALM_OUTLINE.every(index => isCapturedHandPoint(points[index]))
    ? [...PALM_OUTLINE]
    : [];
  return {palm, segments, joints};
}
