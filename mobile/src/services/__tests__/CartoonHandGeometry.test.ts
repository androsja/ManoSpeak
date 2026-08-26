import {
  buildCartoonHandGeometry,
  HAND_FINGER_CHAINS,
  PALM_OUTLINE,
} from '../CartoonHandGeometry';

const hand = Array.from({length: 21}, (_, index) => [0.1 + index / 100, 0.1 + index / 80, 0] as [number, number, number]);

describe('cartoon hand geometry', () => {
  it('uses the canonical 21-landmark finger chains without creating new joints', () => {
    const geometry = buildCartoonHandGeometry(hand);

    expect(HAND_FINGER_CHAINS).toEqual([
      [0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12],
      [0, 13, 14, 15, 16], [0, 17, 18, 19, 20],
    ]);
    expect(geometry.segments).toHaveLength(20);
    expect(geometry.joints).toEqual(Array.from({length: 21}, (_, index) => index));
    expect(geometry.palm).toEqual(PALM_OUTLINE);
  });

  it('does not draw geometry across a missing captured landmark', () => {
    const incomplete = hand.map(point => [...point] as [number, number, number]);
    incomplete[6] = [0, 0, 0];
    const geometry = buildCartoonHandGeometry(incomplete);

    expect(geometry.segments.some(segment => segment.from === 5 && segment.to === 6)).toBe(false);
    expect(geometry.segments.some(segment => segment.from === 6 && segment.to === 7)).toBe(false);
    expect(geometry.joints).not.toContain(6);
    expect(geometry.palm).toEqual(PALM_OUTLINE);
  });

  it('withholds the palm when one of its anchors is absent', () => {
    const incomplete = hand.map(point => [...point] as [number, number, number]);
    incomplete[13] = [0, 0, 0];
    expect(buildCartoonHandGeometry(incomplete).palm).toEqual([]);
  });
});
