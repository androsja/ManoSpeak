const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

const NUMBER_DRAFTS = path.resolve(__dirname, '../../assets/motions/drafts/numbers');

function readMotion(gloss: string): {
  avatarProfile: {
    rigLeftFingerStates: Record<string, string>;
    rigLeftFingerSplayDegrees?: number;
  };
  semantic: {
    gloss: string;
    source?: {title: string; pages?: string; url: string};
    handshapePresentationNote?: string;
    movementPresentationNote?: string;
    locationPresentationNote: string;
  };
  frames: Array<{bodyHands: number[][]}>;
} {
  return JSON.parse(fs.readFileSync(path.join(NUMBER_DRAFTS, `${gloss.toLowerCase()}.motion.json`), 'utf8'));
}

describe('LSC number motion drafts', () => {
  it('keeps the four long CINCO fingers extended and visibly separated', () => {
    const motion = readMotion('CINCO');
    const lastFrame = motion.frames[motion.frames.length - 1].bodyHands;
    const fingerRoots = [38, 42, 46, 50].map(index => lastFrame[index][0]);
    const lateralGaps = fingerRoots.slice(1).map((x, index) => Number((x - fingerRoots[index]).toFixed(5)));

    expect(motion.avatarProfile.rigLeftFingerStates).toEqual({
      thumb: 'extended',
      index: 'extended',
      middle: 'extended',
      ring: 'extended',
      pinky: 'extended',
    });
    expect(lateralGaps).toEqual([0.0522, 0.054, 0.0522]);
    expect(motion.avatarProfile.rigLeftFingerSplayDegrees).toBe(20);
    expect(motion.semantic.handshapePresentationNote).toMatch(/not regional performance evidence/);
  });

  it('separates the extended fingers in DOS, TRES, and CUATRO', () => {
    const extendedFingerRoots: Record<string, number[]> = {
      DOS: [38, 42],
      TRES: [38, 42, 46],
      CUATRO: [38, 42, 46, 50],
    };
    for (const [gloss, landmarks] of Object.entries(extendedFingerRoots)) {
      const motion = readMotion(gloss);
      const lastFrame = motion.frames[motion.frames.length - 1].bodyHands;
      const gaps = landmarks.slice(1).map((landmark, index) => (
        Number((lastFrame[landmark][0] - lastFrame[landmarks[index]][0]).toFixed(5))
      ));

      expect(gaps.every(gap => gap >= 0.0522)).toBe(true);
      expect(motion.semantic.handshapePresentationNote).toMatch(/1.8 lateral landmark spread factor/);
      expect(motion.avatarProfile.rigLeftFingerSplayDegrees).toBe(
        gloss === 'DOS' ? 28 : gloss === 'TRES' ? 22 : 16,
      );
    }
  });

  it('keeps the inactive right hand absent in every generated number pose', () => {
    for (const gloss of ['UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS']) {
      const motion = readMotion(gloss);
      expect(motion.frames.every(frame => (
        frame.bodyHands.slice(54, 75).every(point => point.every(value => value === 0))
      ))).toBe(true);
    }
  });

  it('raises the active hand beside the face for every number from one to six', () => {
    for (const gloss of ['UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS']) {
      const motion = readMotion(gloss);
      const lastFrame = motion.frames[motion.frames.length - 1].bodyHands;

      expect(lastFrame[13]).toEqual([0.82, 0.75, -0.02]);
      expect(lastFrame[15]).toEqual([0.77, 0.58, -0.04]);
      expect(lastFrame[15][0]).toBeGreaterThan(0.7);
      expect(lastFrame[15][1]).toBeLessThan(0.6);
      expect(motion.semantic.locationPresentationNote).toMatch(/not centered in front of the face/);
    }
  });

  it('animates the SEIS index flex while keeping the other fingers folded', () => {
    const motion = readMotion('SEIS');
    const indexExtensionRatio = (frameIndex: number) => {
      const hands = motion.frames[frameIndex].bodyHands;
      const chain = [38, 39, 40, 41];
      const distance = (from: number, to: number) => Math.hypot(
        ...hands[to].map((value, axis) => value - hands[from][axis]),
      );
      const length = chain.slice(1).reduce((sum, point, index) => (
        sum + distance(chain[index], point)
      ), 0);
      return distance(chain[0], chain[3]) / length;
    };

    expect(motion.frames).toHaveLength(48);
    expect(motion.avatarProfile.rigLeftFingerStates).toEqual({
      thumb: 'closed',
      index: 'captured',
      middle: 'closed',
      ring: 'closed',
      pinky: 'closed',
    });
    expect(indexExtensionRatio(24)).toBeLessThan(indexExtensionRatio(9));
    expect(indexExtensionRatio(47)).toBeCloseTo(indexExtensionRatio(9), 5);
    expect(motion.semantic.source).toMatchObject({
      title: 'Elementos para una didáctica del lenguaje y las matemáticas en estudiantes sordos de niveles iniciales',
      pages: '94-96',
    });
    expect(motion.semantic.movementPresentationNote).toMatch(/index extends and flexes/);
  });
});
