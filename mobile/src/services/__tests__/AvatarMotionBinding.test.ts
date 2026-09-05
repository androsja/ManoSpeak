import {
  armMotionScore,
  bindHandsToArms,
  bindingsForMotion,
  createNeutralAvatarAlignmentFrame,
  presentationArmIndexes,
} from '../AvatarMotionBinding';
import {MotionFrame, MotionPoint, SignMotion} from '../CompactSignMotion';

const missing = (): MotionPoint => [0, 0, 0];
const point = (x: number, y: number, z = 0): MotionPoint => [x, y, z];

function frame(
  firstPoseWrist: MotionPoint,
  secondPoseWrist: MotionPoint,
  firstHand?: MotionPoint,
  secondHand?: MotionPoint,
): MotionFrame {
  const bodyHands = Array.from({length: 75}, missing);
  bodyHands[13] = point(firstPoseWrist[0], firstPoseWrist[1] - 0.1);
  bodyHands[14] = point(secondPoseWrist[0], secondPoseWrist[1] - 0.1);
  bodyHands[15] = firstPoseWrist;
  bodyHands[16] = secondPoseWrist;
  if (firstHand) {
    for (let index = 0; index < 21; index += 1) {
      bodyHands[33 + index] = point(firstHand[0], firstHand[1] + index * 0.001);
    }
  }
  if (secondHand) {
    for (let index = 0; index < 21; index += 1) {
      bodyHands[54 + index] = point(secondHand[0], secondHand[1] + index * 0.001);
    }
  }
  return {bodyHands, face: []};
}

describe('avatar hand-to-arm binding', () => {
  it('provides alignment geometry before optional signs are downloaded', () => {
    const neutral = createNeutralAvatarAlignmentFrame();

    expect(neutral.bodyHands).toHaveLength(75);
    expect(neutral.bodyHands[11]).not.toEqual(missing());
    expect(neutral.bodyHands[12]).not.toEqual(missing());
    expect(neutral.bodyHands[23]).not.toEqual(missing());
    expect(neutral.bodyHands[24]).not.toEqual(missing());
    expect(neutral.bodyHands[11][0]).toBeGreaterThan(neutral.bodyHands[12][0]);
    expect(neutral.bodyHands[11][0] - neutral.bodyHands[12][0]).toBeCloseTo(0.42);
    expect((neutral.bodyHands[11][0] + neutral.bodyHands[12][0]) / 2).toBeCloseTo(0.5);
    expect(neutral.bodyHands[11][1]).toBeCloseTo(neutral.bodyHands[12][1]);
    expect(neutral.bodyHands[23][1]).toBeGreaterThan(neutral.bodyHands[11][1]);
    expect(neutral.bodyHands[24][1]).toBeGreaterThan(neutral.bodyHands[12][1]);
    expect(neutral.face).toEqual([]);
  });

  it('applies presentation profiles to both arms for two-handed signs', () => {
    expect(presentationArmIndexes()).toEqual([0, 1]);
    expect(presentationArmIndexes('L')).toEqual([0]);
    expect(presentationArmIndexes('R')).toEqual([1]);
  });

  it('binds crossed MediaPipe hand blocks to their anatomical pose wrists', () => {
    const captured = frame(
      point(0.25, 0.5),
      point(0.75, 0.5),
      point(0.74, 0.5),
      point(0.26, 0.5),
    );

    const bindings = bindHandsToArms(captured);

    expect(bindings[0].handStart).toBe(54);
    expect(bindings[1].handStart).toBe(33);
  });

  it('uses a whole-sign vote instead of one crossing frame', () => {
    const direct = frame(
      point(0.25, 0.5),
      point(0.75, 0.5),
      point(0.25, 0.5),
      point(0.75, 0.5),
    );
    const crossingNoise = frame(
      point(0.25, 0.5),
      point(0.75, 0.5),
      point(0.74, 0.5),
      point(0.26, 0.5),
    );
    const motion: SignMotion = {fps: 30, frames: [direct, direct, crossingNoise]};

    const bindings = bindingsForMotion(motion);

    expect(bindings[0].handStart).toBe(33);
    expect(bindings[1].handStart).toBe(54);
  });

  it('measures the hand assigned to an arm instead of a fixed label block', () => {
    const first = frame(
      point(0.25, 0.5),
      point(0.75, 0.5),
      point(0.75, 0.5),
      point(0.25, 0.5),
    );
    const second = frame(
      point(0.3, 0.5),
      point(0.75, 0.5),
      point(0.75, 0.5),
      point(0.3, 0.5),
    );
    const motion: SignMotion = {fps: 30, frames: [first, second]};
    const bindings = bindingsForMotion(motion);

    expect(bindings[0].handStart).toBe(54);
    expect(armMotionScore(motion, 0, bindings)).toBeGreaterThan(
      armMotionScore(motion, 1, bindings),
    );
  });
});
