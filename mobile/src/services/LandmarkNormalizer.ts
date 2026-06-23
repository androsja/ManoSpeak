const POSE_LEFT_SHOULDER_IDX = 11;
const POSE_RIGHT_SHOULDER_IDX = 12;
const EPSILON = 1e-5;

function isZeroLandmark(lm: number[]): boolean {
  return lm[0] === 0.0 && lm[1] === 0.0 && lm[2] === 0.0;
}

function euclidean(a: number[], b: number[]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function normVec3(v: [number, number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

export class LandmarkNormalizer {
  /**
   * Per-frame translational + scale normalization, ported from ml/src/normalizers.py.
   *
   * Primary path (shoulders detected at pose[11] and pose[12]):
   *   ref_anchor  = midpoint(left_shoulder, right_shoulder)
   *   scale_factor = clavicular distance (euclidean)
   *
   * Fallback path (either shoulder is all-zero / undetected):
   *   ref_anchor  = centroid of all non-zero landmarks
   *   scale_factor = bounding-box diagonal of all non-zero landmarks
   *
   * Guards:
   *   - All-zero frame → ref_anchor=[0,0,0], scale_factor=1.0 (no mutation)
   *   - scale_factor < 1e-5 → scale_factor=1.0 (no division by zero)
   *   - Zero landmarks (undetected) remain [0, 0, 0] after normalization
   *   - Output coordinates clipped to [-1.0, 1.0]
   *
   * Input:  number[][] — 543 landmarks, each [x, y, z]
   * Output: number[][] — same shape, normalized
   */
  static normalizeFrame(frame: number[][]): number[][] {
    const leftShoulder = frame[POSE_LEFT_SHOULDER_IDX];
    const rightShoulder = frame[POSE_RIGHT_SHOULDER_IDX];
    const hasLeft = !isZeroLandmark(leftShoulder);
    const hasRight = !isZeroLandmark(rightShoulder);

    let refX: number;
    let refY: number;
    let refZ: number;
    let scaleFactor: number;

    if (hasLeft && hasRight) {
      refX = (leftShoulder[0] + rightShoulder[0]) / 2.0;
      refY = (leftShoulder[1] + rightShoulder[1]) / 2.0;
      refZ = (leftShoulder[2] + rightShoulder[2]) / 2.0;
      scaleFactor = euclidean(leftShoulder, rightShoulder);
    } else {
      let sumX = 0.0;
      let sumY = 0.0;
      let sumZ = 0.0;
      let count = 0;
      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;

      for (let i = 0; i < frame.length; i++) {
        const lm = frame[i];
        if (!isZeroLandmark(lm)) {
          sumX += lm[0];
          sumY += lm[1];
          sumZ += lm[2];
          count += 1;
          if (lm[0] < minX) minX = lm[0];
          if (lm[1] < minY) minY = lm[1];
          if (lm[2] < minZ) minZ = lm[2];
          if (lm[0] > maxX) maxX = lm[0];
          if (lm[1] > maxY) maxY = lm[1];
          if (lm[2] > maxZ) maxZ = lm[2];
        }
      }

      if (count > 0) {
        refX = sumX / count;
        refY = sumY / count;
        refZ = sumZ / count;
        scaleFactor = normVec3([maxX - minX, maxY - minY, maxZ - minZ]);
      } else {
        refX = 0.0;
        refY = 0.0;
        refZ = 0.0;
        scaleFactor = 1.0;
      }
    }

    if (scaleFactor < EPSILON) {
      scaleFactor = 1.0;
    }

    const result: number[][] = new Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      const lm = frame[i];
      if (isZeroLandmark(lm)) {
        result[i] = [0.0, 0.0, 0.0];
      } else {
        result[i] = [
          clamp((lm[0] - refX) / scaleFactor, -1.0, 1.0),
          clamp((lm[1] - refY) / scaleFactor, -1.0, 1.0),
          clamp((lm[2] - refZ) / scaleFactor, -1.0, 1.0),
        ];
      }
    }

    return result;
  }
}
