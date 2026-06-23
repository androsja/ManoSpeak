/**
 * End-to-end pipeline integration tests:
 *   raw landmarks → LandmarkNormalizer → FrameBuffer → getFlatArray (TFLite input)
 *
 * Uses real implementations of LandmarkNormalizer and FrameBuffer (no mocks).
 * Verifies that normalized values land in the correct positions of the
 * Float32Array that feeds the TFLite model.
 */

import { LandmarkNormalizer } from '../LandmarkNormalizer';
import { FrameBuffer } from '../FrameBuffer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeZeroFrame(): number[][] {
  return Array.from({ length: 543 }, () => [0.0, 0.0, 0.0]);
}

const BUFFER_CAPACITY = 5;
const LANDMARK_COUNT = 543;
const COORDS = 3;

// Flat index for landmark [frameIdx, landmarkIdx, coordIdx] inside getFlatArray.
// The buffer pads missing frames with zeros at the START of the array.
function flatIdx(
  padFrames: number,
  frameIdx: number, // 0-based among FILLED frames (not counting padding)
  landmarkIdx: number,
  coordIdx: number,
): number {
  const filledStart = padFrames * LANDMARK_COUNT * COORDS;
  return filledStart + frameIdx * LANDMARK_COUNT * COORDS + landmarkIdx * COORDS + coordIdx;
}

// ---------------------------------------------------------------------------

describe('Normalization Pipeline (raw → normalize → buffer → getFlatArray)', () => {
  let buffer: FrameBuffer;

  beforeEach(() => {
    buffer = new FrameBuffer(BUFFER_CAPACITY);
  });

  test('normalized frame values appear at correct positions in getFlatArray', () => {
    // Build a raw frame with known shoulders:
    // left=[1, 0, 0], right=[3, 0, 0] → anchor=[2,0,0], scale=2.0
    // landmark[33] = [4, 0, 0] → normalized = (4-2)/2 = 1.0 (clips exactly at 1.0)
    const rawFrame = makeZeroFrame();
    rawFrame[11] = [1.0, 0.0, 0.0];
    rawFrame[12] = [3.0, 0.0, 0.0];
    rawFrame[33] = [4.0, 0.0, 0.0];

    const normalized = LandmarkNormalizer.normalizeFrame(rawFrame);
    buffer.addFrame(normalized);

    const flat = buffer.getFlatArray();

    // Buffer has 1 frame in capacity=5 → 4 padding frames, then 1 real frame
    const padFrames = BUFFER_CAPACITY - 1;

    // Landmark 11 (left shoulder): normalized = (1-2)/2 = -0.5
    expect(flat[flatIdx(padFrames, 0, 11, 0)]).toBeCloseTo(-0.5, 6);
    expect(flat[flatIdx(padFrames, 0, 11, 1)]).toBeCloseTo(0.0, 6);
    expect(flat[flatIdx(padFrames, 0, 11, 2)]).toBeCloseTo(0.0, 6);

    // Landmark 12 (right shoulder): normalized = (3-2)/2 = 0.5
    expect(flat[flatIdx(padFrames, 0, 12, 0)]).toBeCloseTo(0.5, 6);

    // Landmark 33: (4-2)/2 = 1.0 → clipped to 1.0
    expect(flat[flatIdx(padFrames, 0, 33, 0)]).toBeCloseTo(1.0, 6);

    // Landmark 0 (zero/undetected): remains 0
    expect(flat[flatIdx(padFrames, 0, 0, 0)]).toBe(0.0);
  });

  test('padding frames are all zeros when buffer is not full', () => {
    const rawFrame = makeZeroFrame();
    rawFrame[11] = [1.0, 0.0, 0.0];
    rawFrame[12] = [3.0, 0.0, 0.0];
    buffer.addFrame(LandmarkNormalizer.normalizeFrame(rawFrame));

    const flat = buffer.getFlatArray();

    // 4 padding frames × 543 × 3 values must all be zero
    const paddedElements = (BUFFER_CAPACITY - 1) * LANDMARK_COUNT * COORDS;
    for (let i = 0; i < paddedElements; i++) {
      expect(flat[i]).toBe(0.0);
    }
  });

  test('multiple normalized frames are ordered correctly in the flat array', () => {
    // Frame 0: shoulders [0,0,0]/[2,0,0] — no left shoulder → fallback
    //   only right shoulder non-zero → centroid=[2,0,0], scale=0 → 1.0
    //   right shoulder normalized = (2-2)/1 = [0,0,0]
    //   Actually let me use a clearer frame.

    // Frame A: shoulders at [1,0,0] and [3,0,0], lm[40]=[2,2,0]
    // anchor=[2,0,0], scale=2 → lm[40] normalized = [0, 1, 0]
    const frameA = makeZeroFrame();
    frameA[11] = [1.0, 0.0, 0.0];
    frameA[12] = [3.0, 0.0, 0.0];
    frameA[40] = [2.0, 2.0, 0.0]; // normalized: (0, 1, 0)

    // Frame B: shoulders at [0,0,0] and [0,2,0], lm[40]=[0,4,0]
    // anchor=[0,1,0], scale=euclidean([0,0,0],[0,2,0])=2 → lm[40] = (0,1.5,0) → clip → (0,1,0)
    const frameB = makeZeroFrame();
    frameB[11] = [0.0, 0.0, 0.0]; // all zero → has_left = false
    frameB[12] = [0.0, 2.0, 0.0]; // has_right = true, but has_left = false → fallback

    // Fallback: non-zero = [[0,2,0],[0,4,0]] at indices 12 and 40
    // centroid = [0, 3, 0], scale = norm([0, 2, 0]) = 2.0
    // lm[12]: (0-0)/2=0, (2-3)/2=-0.5
    // lm[40]: (0-0)/2=0, (4-3)/2=0.5
    frameB[40] = [0.0, 4.0, 0.0];

    buffer.addFrame(LandmarkNormalizer.normalizeFrame(frameA));
    buffer.addFrame(LandmarkNormalizer.normalizeFrame(frameB));

    const flat = buffer.getFlatArray();
    const padFrames = BUFFER_CAPACITY - 2;

    // Frame A lm[40]: y = (2-0)/2 = 1.0
    const frameA_lm40_y = flat[flatIdx(padFrames, 0, 40, 1)];
    expect(frameA_lm40_y).toBeCloseTo(1.0, 6);

    // Frame B lm[40]: y = (4-3)/2 = 0.5
    const frameB_lm40_y = flat[flatIdx(padFrames, 1, 40, 1)];
    expect(frameB_lm40_y).toBeCloseTo(0.5, 6);
  });

  test('sliding window discards oldest frame when buffer is full', () => {
    // Fill buffer to capacity=5 with distinct normalized frames, then add a 6th
    for (let i = 0; i < BUFFER_CAPACITY; i++) {
      const frame = makeZeroFrame();
      // Each frame gets unique shoulder values so normalized lm[11] is predictable
      // shoulders: left=[i, 0, 0], right=[i+2, 0, 0] → anchor=[i+1, 0, 0], scale=2
      // lm[11] normalized: (i-(i+1))/2 = -0.5 for all frames
      // lm[50]: [i+3, 0, 0] → (i+3-(i+1))/2 = 1.0 → clipped to 1.0
      frame[11] = [i, 0.0, 0.0];
      frame[12] = [i + 2.0, 0.0, 0.0];
      frame[50] = [i + 3.0, 0.0, 0.0]; // always clips to 1.0
      buffer.addFrame(LandmarkNormalizer.normalizeFrame(frame));
    }

    expect(buffer.size()).toBe(BUFFER_CAPACITY);

    // Add one more — oldest frame (i=0) is dropped, newest (i=5) is at end
    const extraFrame = makeZeroFrame();
    extraFrame[11] = [10.0, 0.0, 0.0];
    extraFrame[12] = [12.0, 0.0, 0.0];
    extraFrame[50] = [11.0, 0.0, 0.0]; // (11 - 11)/2 = 0.0
    buffer.addFrame(LandmarkNormalizer.normalizeFrame(extraFrame));

    expect(buffer.size()).toBe(BUFFER_CAPACITY);

    const flat = buffer.getFlatArray();
    // Last frame (index 4 in flat, 0 pad frames since buffer is full):
    // lm[50] should be 0.0 (not 1.0 from older frames)
    const lastFrame_lm50_x = flat[flatIdx(0, BUFFER_CAPACITY - 1, 50, 0)];
    expect(lastFrame_lm50_x).toBeCloseTo(0.0, 6);
  });

  test('flat array total byte length matches expected TFLite input size', () => {
    // TFLite model expects [capacity × 543 × 3] Float32Array
    const rawFrame = makeZeroFrame();
    rawFrame[11] = [1.0, 0.0, 0.0];
    rawFrame[12] = [3.0, 0.0, 0.0];
    buffer.addFrame(LandmarkNormalizer.normalizeFrame(rawFrame));

    const flat = buffer.getFlatArray();

    const expectedElements = BUFFER_CAPACITY * LANDMARK_COUNT * COORDS;
    const expectedBytes = expectedElements * Float32Array.BYTES_PER_ELEMENT;
    expect(flat.length).toBe(expectedElements);
    expect(flat.byteLength).toBe(expectedBytes);
  });
});
