import {
  buildCartoonBodyGeometry,
  CARTOON_ARM_SEGMENTS,
  CARTOON_TORSO_OUTLINE,
} from '../CartoonBodyGeometry';

const pose = Array.from({length: 33}, (_, index) => [0.1 + index / 100, 0.2 + index / 100, 0] as [number, number, number]);

describe('cartoon body geometry', () => {
  it('uses only the captured torso and arm landmark indexes', () => {
    const geometry = buildCartoonBodyGeometry(pose);

    expect(geometry.torso).toEqual(CARTOON_TORSO_OUTLINE);
    expect(geometry.armSegments).toEqual(CARTOON_ARM_SEGMENTS);
  });

  it('does not bridge a missing elbow and withholds an incomplete torso', () => {
    const incomplete = pose.map(point => [...point] as [number, number, number]);
    incomplete[13] = [0, 0, 0];
    incomplete[24] = [0, 0, 0];

    const geometry = buildCartoonBodyGeometry(incomplete);
    expect(geometry.armSegments).not.toContainEqual({from: 11, to: 13});
    expect(geometry.armSegments).not.toContainEqual({from: 13, to: 15});
    expect(geometry.torso).toEqual([]);
  });
});
