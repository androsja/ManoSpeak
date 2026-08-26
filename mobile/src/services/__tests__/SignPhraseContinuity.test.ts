import {MotionFrame, MotionPoint, SignMotion} from '../CompactSignMotion';
import {coarticulateSignMotion, signPlaybackRange} from '../SignPhraseContinuity';

const point = (x: number, y: number, z = 0): MotionPoint => [x, y, z];

function frame(leftHandY?: number, rightHandY?: number): MotionFrame {
  const bodyHands = Array.from({length: 75}, () => point(0, 0));
  bodyHands[11] = point(0.35, 0.4);
  bodyHands[12] = point(0.65, 0.4);
  bodyHands[23] = point(0.4, 0.9);
  bodyHands[24] = point(0.6, 0.9);
  if (leftHandY !== undefined) bodyHands[33] = point(0.35, leftHandY);
  if (rightHandY !== undefined) bodyHands[54] = point(0.65, rightHandY);
  return {bodyHands, face: []};
}

function motion(frames: MotionFrame[]): SignMotion {
  return {fps: 30, frames};
}

describe('sign phrase continuity', () => {
  it('skips only a lower neutral preparation when joining a following sign', () => {
    const frames = [0.84, 0.79, 0.72, 0.64, 0.57, 0.55, 0.58, 0.61, 0.63, 0.64]
      .map(y => frame(y, y));

    expect(signPlaybackRange(motion(frames))).toEqual({
      continuationStartFrame: 3,
      endFrame: 9,
    });
  });

  it('keeps the first frame when the next sign starts in signing space', () => {
    const frames = [0.58, 0.55, 0.52, 0.56].map(y => frame(y));

    expect(signPlaybackRange(motion(frames)).continuationStartFrame).toBe(0);
  });

  it('does not remove a meaningful gesture that remains in lower space', () => {
    const frames = [0.84, 0.82, 0.8, 0.81, 0.83].map((y, index) => frame(y, y + index * 0.005));

    expect(signPlaybackRange(motion(frames)).continuationStartFrame).toBe(0);
  });

  it('ends before a captured return to neutral followed by missing hands', () => {
    const frames = [frame(0.5), frame(0.52), frame(0.62), frame(0.82), frame(), frame()];

    expect(signPlaybackRange(motion(frames)).endFrame).toBe(2);
  });

  it('keeps the complete clip when hands remain captured through its end', () => {
    const frames = [frame(0.5), frame(0.6), frame(0.76), frame(0.82)];

    expect(signPlaybackRange(motion(frames)).endFrame).toBe(3);
  });

  it('joins the next hand near the previous pose and releases the offset smoothly', () => {
    const preceding = frame(0.42);
    const next = motion([frame(0.8), frame(0.72), frame(0.64), frame(0.58), frame(0.55)]);
    const binding = {elbow: 13, wrist: 15, handStart: 33};

    const presented = coarticulateSignMotion(next, preceding, 0, 4, [binding], [binding]);

    expect(presented).not.toBe(next);
    expect(presented.frames[0].bodyHands[33][1]).toBeCloseTo(0.4884, 4);
    expect(presented.frames[1].bodyHands[33][1]).toBeLessThan(next.frames[1].bodyHands[33][1]);
    expect(presented.frames[2].bodyHands[33]).toEqual(next.frames[2].bodyHands[33]);
    expect(next.frames[0].bodyHands[33][1]).toBe(0.8);
  });
});
