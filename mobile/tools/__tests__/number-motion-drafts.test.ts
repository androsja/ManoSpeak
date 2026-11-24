const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

const NUMBER_DRAFTS = path.resolve(__dirname, '../../assets/motions/drafts/numbers');
const AUTHORING_CATALOG = path.join(NUMBER_DRAFTS, 'number-motion-authoring.json');

type NumberMovementPlan = {
  type: string;
  finger: string;
  repetitions: number;
  startFrame: number;
  flexionFrames: number;
  returnFrames: number;
  pauseFrames: number;
  holdFrames: number;
  flexAmount: number;
};

function readAuthoringEntry(gloss: string): {movement?: NumberMovementPlan} {
  const catalog = JSON.parse(fs.readFileSync(AUTHORING_CATALOG, 'utf8')) as {
    entries: Array<{gloss: string; movement?: NumberMovementPlan}>;
  };
  const entry = catalog.entries.find(candidate => candidate.gloss === gloss);
  if (!entry) throw new Error(`Missing authoring entry for ${gloss}.`);
  return entry;
}

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
  it('includes the existing owner-approved SIETE, OCHO, and NUEVE motions in the published catalogs', () => {
    const assets = path.resolve(__dirname, '../../assets');
    const draftCatalog = JSON.parse(fs.readFileSync(
      path.join(assets, 'motions/drafts/numbers/sign-catalog.json'),
      'utf8',
    )) as {entries: Array<{gloss: string; speechAliases: string[]; approvalStatus: string}>};
    const published = JSON.parse(fs.readFileSync(
      path.join(assets, 'motions/published_signs.json'),
      'utf8',
    )) as {publishedGlosses: string[]};
    const linguistic = JSON.parse(fs.readFileSync(
      path.join(assets, 'data/lsc_linguistic_catalog.json'),
      'utf8',
    )) as {entries: Array<{gloss: string; motion: {published: boolean}; review: {publicationStatus?: string}}>};

    const numbers = [['SIETE', 'siete', '7'], ['OCHO', 'ocho', '8'], ['NUEVE', 'nueve', '9']] as const;
    for (const [gloss, alias, digit] of numbers) {
      const draft = draftCatalog.entries.find(entry => entry.gloss === gloss);
      const sign = linguistic.entries.find(entry => entry.gloss === gloss);
      const source = readMotion(gloss);
      const publishedMotion = JSON.parse(fs.readFileSync(
        path.join(assets, `motions/${gloss.toLowerCase()}.motion.json`),
        'utf8',
      )) as {frames: unknown[]};

      expect(draft).toMatchObject({
        gloss,
        speechAliases: [alias, digit],
        approvalStatus: 'owner-approved-prototype',
      });
      expect(published.publishedGlosses).toContain(gloss);
      expect(sign).toMatchObject({
        gloss,
        motion: {published: true},
        review: {publicationStatus: 'owner-approved-prototype'},
      });
      expect(publishedMotion.frames).toEqual(source.frames);
    }
  });

  it('keeps the four long CINCO fingers extended and visibly separated', () => {
    const motion = readMotion('CINCO');
    const lastFrame = motion.frames[motion.frames.length - 1].bodyHands;
    const fingerRoots = [59, 63, 67, 71].map(index => lastFrame[index][0]);
    const lateralGaps = fingerRoots.slice(1).map((x, index) => Number(Math.abs(x - fingerRoots[index]).toFixed(5)));

    expect(motion.avatarProfile.rigRightFingerStates).toEqual({
      thumb: 'extended',
      index: 'extended',
      middle: 'extended',
      ring: 'extended',
      pinky: 'extended',
    });
    expect(lateralGaps).toEqual([0.0522, 0.054, 0.0522]);
    expect(motion.avatarProfile.rigRightFingerSplayDegrees).toBe(20);
    expect(motion.semantic.handshapePresentationNote).toMatch(/not regional performance evidence/);
  });

  it('separates the extended fingers in DOS, TRES, and CUATRO', () => {
    const extendedFingerRoots: Record<string, number[]> = {
      DOS: [59, 63],
      TRES: [59, 63, 67],
      CUATRO: [59, 63, 67, 71],
    };
    for (const [gloss, landmarks] of Object.entries(extendedFingerRoots)) {
      const motion = readMotion(gloss);
      const lastFrame = motion.frames[motion.frames.length - 1].bodyHands;
      const gaps = landmarks.slice(1).map((landmark, index) => (
        Number(Math.abs(lastFrame[landmark][0] - lastFrame[landmarks[index]][0]).toFixed(5))
      ));

      expect(gaps.every(gap => gap >= 0.0522)).toBe(true);
      expect(motion.semantic.handshapePresentationNote).toMatch(/1.8 lateral landmark spread factor/);
      expect(motion.avatarProfile.rigRightFingerSplayDegrees).toBe(
        gloss === 'DOS' ? 28 : gloss === 'TRES' ? 22 : 16,
      );
    }
  });

  it('keeps the inactive left hand absent in every generated number pose', () => {
    for (const gloss of ['UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS']) {
      const motion = readMotion(gloss);
      expect(motion.frames.every(frame => (
        frame.bodyHands.slice(33, 54).every(point => point.every(value => value === 0))
      ))).toBe(true);
    }
  });

  it('raises the active hand beside the face for every number from one to six', () => {
    for (const gloss of ['UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS']) {
      const motion = readMotion(gloss);
      const lastFrame = motion.frames[motion.frames.length - 1].bodyHands;

      expect(lastFrame[14]).toEqual([0.18, 0.75, -0.02]);
      expect(lastFrame[16]).toEqual([0.23, 0.58, -0.04]);
      expect(lastFrame[16][0]).toBeLessThan(0.3);
      expect(lastFrame[16][1]).toBeLessThan(0.6);
      expect(motion.semantic.locationPresentationNote).toMatch(/active right hand is placed high beside the avatar face/);
    }
  });

  it('interprets the SEIS two-flexion plan while keeping the other fingers folded', () => {
    const motion = readMotion('SEIS');
    const authoring = readAuthoringEntry('SEIS');
    const indexExtensionRatio = (frameIndex: number) => {
      const hands = motion.frames[frameIndex].bodyHands;
      const chain = [59, 60, 61, 62];
      const distance = (from: number, to: number) => Math.hypot(
        ...hands[to].map((value, axis) => value - hands[from][axis]),
      );
      const length = chain.slice(1).reduce((sum, point, index) => (
        sum + distance(chain[index], point)
      ), 0);
      return distance(chain[0], chain[3]) / length;
    };

    expect(authoring.movement).toMatchObject({
      type: 'finger-flexion-repetitions',
      finger: 'index',
      repetitions: 2,
    });
    expect(motion.frames).toHaveLength(72);
    expect(motion.avatarProfile.rigRightFingerStates).toEqual({
      thumb: 'closed',
      index: 'captured',
      middle: 'closed',
      ring: 'closed',
      pinky: 'closed',
    });
    expect(indexExtensionRatio(22)).toBeLessThan(indexExtensionRatio(9));
    expect(indexExtensionRatio(32)).toBeGreaterThan(indexExtensionRatio(22));
    expect(indexExtensionRatio(46)).toBeLessThan(indexExtensionRatio(32));
    expect(indexExtensionRatio(56)).toBeGreaterThan(indexExtensionRatio(46));
    expect(indexExtensionRatio(71)).toBeCloseTo(indexExtensionRatio(9), 5);
    expect(motion.semantic.source).toMatchObject({
      title: 'Elementos para una didáctica del lenguaje y las matemáticas en estudiantes sordos de niveles iniciales',
      pages: '94-96',
    });
    expect(motion.semantic.movementPresentationNote).toMatch(/extends and flex down 2 times/);
  });
});
