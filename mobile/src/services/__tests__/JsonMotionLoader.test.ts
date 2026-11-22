import {parseJsonMotionDocument} from '../JsonMotionLoader';

function numberMotion(): Record<string, unknown> {
  const point = (): [number, number, number] => [0, 0, 0];
  const frame = () => ({
    bodyHands: Array.from({length: 75}, point),
    face: Array.from({length: 468}, point),
  });
  return {
    version: 2,
    fps: 30,
    frames: [frame(), frame()],
    layout: 'pose33_left21_right21_face468',
    avatarProfile: {
      activeHand: 'left',
      rigLeftHandShape: 'fully-open',
      rigLeftFingerStates: {
        thumb: 'closed',
        index: 'extended',
        middle: 'closed',
        ring: 'closed',
        pinky: 'closed',
      },
    },
    semantic: {schema: 'vozual.number-motion-draft', gloss: 'UNO', number: 1},
  };
}

describe('parseJsonMotionDocument', () => {
  it('accepts the Android landmark frame layout and explicit finger-state profile', () => {
    const parsed = parseJsonMotionDocument(numberMotion(), 'UNO');

    expect(parsed.frames).toHaveLength(2);
    expect(parsed.frames[0].bodyHands).toHaveLength(75);
    expect(parsed.frames[0].face).toHaveLength(468);
    expect(parsed.avatarProfile?.rigLeftFingerStates).toEqual({
      thumb: 'closed',
      index: 'extended',
      middle: 'closed',
      ring: 'closed',
      pinky: 'closed',
    });
  });

  it('rejects a finger state the rig does not understand', () => {
    const document = numberMotion();
    (document.avatarProfile as Record<string, unknown>).rigLeftFingerStates = {
      index: 'pointing',
    };

    expect(() => parseJsonMotionDocument(document, 'UNO')).toThrow(
      'UNO has invalid rigLeftFingerStates.',
    );
  });
  it('rejects non-finite or excessive configured finger splay', () => {
    const document = numberMotion();
    (document.avatarProfile as Record<string, unknown>).rigLeftFingerSplayDegrees = 90;

    expect(() => parseJsonMotionDocument(document, 'DOS')).toThrow(
      'DOS has invalid rigLeftFingerSplayDegrees.',
    );
  });
  it.each([
    ['UNO', 'uno', {thumb: 'closed', index: 'extended', middle: 'closed', ring: 'closed', pinky: 'closed'}],
    ['DOS', 'dos', {thumb: 'closed', index: 'extended', middle: 'extended', ring: 'closed', pinky: 'closed'}],
    ['TRES', 'tres', {thumb: 'closed', index: 'extended', middle: 'extended', ring: 'extended', pinky: 'closed'}],
    ['CUATRO', 'cuatro', {thumb: 'closed', index: 'extended', middle: 'extended', ring: 'extended', pinky: 'extended'}],
    ['CINCO', 'cinco', {thumb: 'extended', index: 'extended', middle: 'extended', ring: 'extended', pinky: 'extended'}],
  ] as const)('reads the generated %s motion and its finger geometry', (gloss, fileName, states) => {
    const source = require(`../../../assets/motions/drafts/numbers/${fileName}.motion.json`) as unknown;
    const parsed = parseJsonMotionDocument(source, gloss);
    const hand = parsed.frames[parsed.frames.length - 1].bodyHands.slice(33, 54);
    const chains = {
      thumb: [1, 2, 3, 4],
      index: [5, 6, 7, 8],
      middle: [9, 10, 11, 12],
      ring: [13, 14, 15, 16],
      pinky: [17, 18, 19, 20],
    } as const;

    expect(parsed.frames).toHaveLength(36);
    expect(parsed.fps).toBe(30);
    expect(parsed.avatarProfile?.rigLeftFingerStates).toEqual(states);
    const expectedSplay = gloss === 'DOS' ? 28
      : gloss === 'TRES' ? 22
        : gloss === 'CUATRO' ? 16
          : gloss === 'CINCO' ? 20
            : undefined;
    expect(parsed.avatarProfile?.rigLeftFingerSplayDegrees).toBe(expectedSplay);
    Object.entries(chains).forEach(([finger, chain]) => {
      const totalLength = chain.slice(1).reduce((sum, to, index) => (
        sum + Math.hypot(...hand[to].map((value, axis) => value - hand[chain[index]][axis]))
      ), 0);
      const straightness = Math.hypot(
        ...hand[chain[3]].map((value, axis) => value - hand[chain[0]][axis]),
      ) / totalLength;
      if (states[finger as keyof typeof states] === 'extended') {
        expect(straightness).toBeGreaterThan(0.9);
      } else {
        expect(straightness).toBeLessThan(0.8);
      }
    });
  });
});
