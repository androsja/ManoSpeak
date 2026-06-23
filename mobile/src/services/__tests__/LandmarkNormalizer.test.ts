import { LandmarkNormalizer } from '../LandmarkNormalizer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeZeroFrame(): number[][] {
  return Array.from({ length: 543 }, () => [0.0, 0.0, 0.0]);
}

/** Set a single landmark in a cloned frame. */
function setLm(frame: number[][], idx: number, x: number, y: number, z: number): number[][] {
  const f = frame.map(lm => [...lm]);
  f[idx] = [x, y, z];
  return f;
}

const PRECISION = 6; // decimal places for numerical parity with Python

function expectClose(actual: number, expected: number, decimals = PRECISION): void {
  expect(actual).toBeCloseTo(expected, decimals);
}

function expectLmClose(actual: number[], expected: number[], decimals = PRECISION): void {
  expectClose(actual[0], expected[0], decimals);
  expectClose(actual[1], expected[1], decimals);
  expectClose(actual[2], expected[2], decimals);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('LandmarkNormalizer.normalizeFrame', () => {
  // -------------------------------------------------------------------------
  // PRIMARY PATH: both shoulders detected
  // -------------------------------------------------------------------------

  describe('primary path (shoulders detected at pose[11] and pose[12])', () => {
    test('translates landmarks relative to shoulder midpoint and scales by clavicular distance', () => {
      // left_shoulder = [1, 0, 0], right_shoulder = [3, 0, 0]
      // ref_anchor = [2, 0, 0], scale_factor = euclidean = 2.0
      let frame = makeZeroFrame();
      frame[11] = [1.0, 0.0, 0.0]; // left shoulder
      frame[12] = [3.0, 0.0, 0.0]; // right shoulder
      frame[33] = [2.0, 1.0, 0.0]; // a detected hand landmark

      const result = LandmarkNormalizer.normalizeFrame(frame);

      // left_shoulder: (1-2)/2 = -0.5
      expectLmClose(result[11], [-0.5, 0.0, 0.0]);
      // right_shoulder: (3-2)/2 = 0.5
      expectLmClose(result[12], [0.5, 0.0, 0.0]);
      // hand landmark: (2-2)/2 = 0, (1-0)/2 = 0.5
      expectLmClose(result[33], [0.0, 0.5, 0.0]);
    });

    test('zero (undetected) landmarks remain exactly [0, 0, 0] after normalization', () => {
      let frame = makeZeroFrame();
      frame[11] = [1.0, 0.0, 0.0];
      frame[12] = [3.0, 0.0, 0.0];
      // All other landmarks stay [0, 0, 0]

      const result = LandmarkNormalizer.normalizeFrame(frame);

      // Spot-check several zero indices (face, undetected hands)
      expect(result[0]).toEqual([0.0, 0.0, 0.0]);
      expect(result[75]).toEqual([0.0, 0.0, 0.0]);
      expect(result[200]).toEqual([0.0, 0.0, 0.0]);
      expect(result[542]).toEqual([0.0, 0.0, 0.0]);
    });

    test('clips large values to the [-1.0, 1.0] range', () => {
      let frame = makeZeroFrame();
      frame[11] = [1.0, 0.0, 0.0]; // left shoulder
      frame[12] = [3.0, 0.0, 0.0]; // right shoulder — scale = 2.0, anchor = [2, 0, 0]
      frame[5] = [10.0, 0.0, 0.0]; // (10-2)/2 = 4.0 → clipped to 1.0
      frame[6] = [-4.0, 0.0, 0.0]; // (-4-2)/2 = -3.0 → clipped to -1.0

      const result = LandmarkNormalizer.normalizeFrame(frame);

      expectLmClose(result[5], [1.0, 0.0, 0.0]);
      expectLmClose(result[6], [-1.0, 0.0, 0.0]);
    });

    test('handles 3D clavicular distance correctly', () => {
      // left = [0, 0, 0], right = [0, 3, 4] → distance = sqrt(9+16) = 5.0
      let frame = makeZeroFrame();
      frame[11] = [0.0, 0.0, 0.0]; // all zeros → has_left = false
      // Use explicit non-zero shoulders for 3D test
      frame[11] = [1.0, 2.0, 2.0];
      frame[12] = [1.0, 2.0, -2.0];
      // euclidean = sqrt(0+0+16) = 4.0; anchor = [1, 2, 0]
      frame[20] = [1.0, 2.0, 2.0]; // same as left shoulder
      const result = LandmarkNormalizer.normalizeFrame(frame);
      // (2-0)/4 = 0.5
      expectLmClose(result[20], [0.0, 0.0, 0.5]);
    });
  });

  // -------------------------------------------------------------------------
  // FALLBACK PATH: one or both shoulders undetected (all-zero)
  // -------------------------------------------------------------------------

  describe('fallback path (shoulder undetected — all-zero at pose[11] or pose[12])', () => {
    test('uses centroid of non-zero landmarks as ref_anchor', () => {
      // Only index 33 and 54 are non-zero
      // centroid = mean([0,2,0], [0,4,0]) = [0,3,0]
      // bounding box diagonal = norm([0, 2, 0]) = 2.0
      let frame = makeZeroFrame();
      frame[33] = [0.0, 2.0, 0.0];
      frame[54] = [0.0, 4.0, 0.0];

      const result = LandmarkNormalizer.normalizeFrame(frame);

      // (0-0)/2 = 0, (2-3)/2 = -0.5, (0-0)/2 = 0
      expectLmClose(result[33], [0.0, -0.5, 0.0]);
      // (0-0)/2 = 0, (4-3)/2 = 0.5, (0-0)/2 = 0
      expectLmClose(result[54], [0.0, 0.5, 0.0]);
      // Zero landmarks remain zero
      expect(result[0]).toEqual([0.0, 0.0, 0.0]);
      expect(result[11]).toEqual([0.0, 0.0, 0.0]);
    });

    test('falls back even when only one shoulder is missing', () => {
      // Left shoulder missing, right shoulder present — triggers fallback
      let frame = makeZeroFrame();
      frame[12] = [2.0, 0.0, 0.0]; // right shoulder (has_left = false)
      frame[33] = [4.0, 0.0, 0.0]; // another landmark

      const result = LandmarkNormalizer.normalizeFrame(frame);

      // Non-zero: [2,0,0] and [4,0,0]
      // centroid = [3, 0, 0], scale = norm([2, 0, 0]) = 2.0
      expectLmClose(result[12], [-0.5, 0.0, 0.0]); // (2-3)/2 = -0.5
      expectLmClose(result[33], [0.5, 0.0, 0.0]);  // (4-3)/2 = 0.5
    });
  });

  // -------------------------------------------------------------------------
  // ALL-ZERO FRAME
  // -------------------------------------------------------------------------

  describe('all-zero frame (no detected landmarks)', () => {
    test('returns an all-zero frame unchanged', () => {
      const frame = makeZeroFrame();
      const result = LandmarkNormalizer.normalizeFrame(frame);

      for (let i = 0; i < 543; i++) {
        expect(result[i]).toEqual([0.0, 0.0, 0.0]);
      }
    });
  });

  // -------------------------------------------------------------------------
  // SCALE FACTOR GUARD: scale < 1e-5 → use 1.0
  // -------------------------------------------------------------------------

  describe('scale factor guard (clavicular distance ≈ 0)', () => {
    test('uses scale_factor = 1.0 when both shoulders are at the same point', () => {
      // left = right = [1, 0.5, 0] → scale = 0 < 1e-5 → use 1.0
      // ref_anchor = [1, 0.5, 0]
      let frame = makeZeroFrame();
      frame[11] = [1.0, 0.5, 0.0];
      frame[12] = [1.0, 0.5, 0.0];
      frame[20] = [2.0, 0.5, 0.0]; // (2-1)/1.0 = 1.0 → clips exactly at boundary

      const result = LandmarkNormalizer.normalizeFrame(frame);

      expectLmClose(result[11], [0.0, 0.0, 0.0]); // (1-1)/1 = 0
      expectLmClose(result[12], [0.0, 0.0, 0.0]);
      expectLmClose(result[20], [1.0, 0.0, 0.0]); // (2-1)/1 = 1.0, not clipped (exactly 1.0)
    });

    test('uses scale_factor = 1.0 when fallback bounding box is a single point', () => {
      // Only one non-zero landmark → bounding box is degenerate → scale = 0 → use 1.0
      let frame = makeZeroFrame();
      frame[33] = [5.0, 3.0, 1.0]; // only non-zero landmark
      // centroid = [5, 3, 1]; scale = norm([0, 0, 0]) = 0.0 → 1.0
      // result: (5-5)/1, (3-3)/1, (1-1)/1 = [0, 0, 0]

      const result = LandmarkNormalizer.normalizeFrame(frame);

      expectLmClose(result[33], [0.0, 0.0, 0.0]);
    });
  });

  // -------------------------------------------------------------------------
  // OUTPUT SHAPE AND IMMUTABILITY
  // -------------------------------------------------------------------------

  describe('output guarantees', () => {
    test('output has the same shape as input (543 landmarks, each [x, y, z])', () => {
      let frame = makeZeroFrame();
      frame[11] = [1.0, 0.0, 0.0];
      frame[12] = [3.0, 0.0, 0.0];

      const result = LandmarkNormalizer.normalizeFrame(frame);

      expect(result.length).toBe(543);
      result.forEach(lm => expect(lm.length).toBe(3));
    });

    test('does not mutate the input frame', () => {
      let frame = makeZeroFrame();
      frame[11] = [1.0, 0.0, 0.0];
      frame[12] = [3.0, 0.0, 0.0];
      frame[33] = [5.0, 0.0, 0.0];

      const originalValue = frame[33][0];
      LandmarkNormalizer.normalizeFrame(frame);

      expect(frame[33][0]).toBe(originalValue); // must not be mutated
    });

    test('all output coordinates are within [-1.0, 1.0]', () => {
      let frame = makeZeroFrame();
      frame[11] = [1.0, 0.0, 0.0];
      frame[12] = [3.0, 0.0, 0.0];
      // Add many far landmarks to stress the clip
      for (let i = 20; i < 100; i++) {
        frame[i] = [100.0 * (i % 2 === 0 ? 1 : -1), 50.0, -75.0];
      }

      const result = LandmarkNormalizer.normalizeFrame(frame);

      result.forEach(lm => {
        expect(lm[0]).toBeGreaterThanOrEqual(-1.0);
        expect(lm[0]).toBeLessThanOrEqual(1.0);
        expect(lm[1]).toBeGreaterThanOrEqual(-1.0);
        expect(lm[1]).toBeLessThanOrEqual(1.0);
        expect(lm[2]).toBeGreaterThanOrEqual(-1.0);
        expect(lm[2]).toBeLessThanOrEqual(1.0);
      });
    });
  });

  // -------------------------------------------------------------------------
  // NUMERICAL PARITY WITH PYTHON REFERENCE (ml/src/normalizers.py)
  // -------------------------------------------------------------------------

  describe('numerical parity with Python reference', () => {
    test('matches Python output for reference vector A (symmetric shoulders on X axis)', () => {
      // Python: left=[1,0,0], right=[3,0,0] → anchor=[2,0,0], scale=2
      // frame[50] = [4, 2, 1] → ((4-2)/2, (2-0)/2, (1-0)/2) = (1.0, 1.0, 0.5) → clip → (1.0, 1.0, 0.5)
      // frame[100] = [0, -3, 0] → ((0-2)/2, (-3-0)/2, 0) = (-1.0, -1.5, 0) → clip → (-1.0, -1.0, 0)
      let frame = makeZeroFrame();
      frame[11] = [1.0, 0.0, 0.0];
      frame[12] = [3.0, 0.0, 0.0];
      frame[50] = [4.0, 2.0, 1.0];
      frame[100] = [0.0, -3.0, 0.0];

      const result = LandmarkNormalizer.normalizeFrame(frame);

      expectLmClose(result[50], [1.0, 1.0, 0.5]);
      expectLmClose(result[100], [-1.0, -1.0, 0.0]);
    });

    test('matches Python output for reference vector B (fallback — 3 non-zero hand landmarks)', () => {
      // non_zero = [[1,0,0], [3,0,0], [2,4,0]] (indices 33, 54, 60)
      // centroid = [2, 4/3, 0]
      // min = [1, 0, 0], max = [3, 4, 0]
      // scale = norm([2, 4, 0]) = sqrt(4+16+0) = sqrt(20) ≈ 4.472135954999579
      let frame = makeZeroFrame();
      frame[33] = [1.0, 0.0, 0.0];
      frame[54] = [3.0, 0.0, 0.0];
      frame[60] = [2.0, 4.0, 0.0];

      const centroidX = (1 + 3 + 2) / 3;         // 2.0
      const centroidY = (0 + 0 + 4) / 3;         // 1.3333...
      const centroidZ = 0.0;
      const scale = Math.sqrt(4 + 16 + 0);        // sqrt(20)

      const result = LandmarkNormalizer.normalizeFrame(frame);

      // frame[33]: (1-2)/sqrt(20), (0-4/3)/sqrt(20), 0
      expectClose(result[33][0], (1 - centroidX) / scale);
      expectClose(result[33][1], (0 - centroidY) / scale);
      expectClose(result[33][2], 0.0);

      // frame[54]: (3-2)/sqrt(20), (0-4/3)/sqrt(20), 0
      expectClose(result[54][0], (3 - centroidX) / scale);
      expectClose(result[54][1], (0 - centroidY) / scale);
      expectClose(result[54][2], 0.0);

      // frame[60]: (2-2)/sqrt(20), (4-4/3)/sqrt(20), 0
      expectClose(result[60][0], (2 - centroidX) / scale);
      expectClose(result[60][1], (4 - centroidY) / scale);
      expectClose(result[60][2], 0.0);
    });
  });
});
