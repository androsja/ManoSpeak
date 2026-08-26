import {decodeCompactMotion} from '../CompactSignMotion';

const {compileMotion} = require('../../../tools/compact-sign-motion');
const {motionAssetName} = require('../../../tools/compact-sign-motion');

describe('compact sign motion', () => {
  it('keeps the authored thumb-to-chin contact for AGUA', () => {
    const overrides = require('../../../assets/motions/avatar_profile_overrides.json');
    expect(overrides.AGUA).toEqual(expect.objectContaining({
      rigLeftHandShape: 'thumb-up',
      rigContactLandmark: 4,
      rigContactSnap: 1,
      rigContactUseAvatarAnchor: true,
      contactAnchor: 'chin',
    }));
    expect(overrides.AGUA.contactEndFrame).toBeGreaterThan(overrides.AGUA.contactStartFrame);
  });

  it('keeps the authored support hand for AYUDAR', () => {
    const overrides = require('../../../assets/motions/avatar_profile_overrides.json');
    expect(overrides.AYUDAR.forceTwoHands).toBe(true);
  });

  it('keeps the authored two-hand override for HAMBRE', () => {
    const overrides = require('../../../assets/motions/avatar_profile_overrides.json');
    expect(overrides.HAMBRE.forceTwoHands).toBe(true);
    expect(overrides.HAMBRE.rigFistHands).toBe(true);
    expect(overrides.HAMBRE.rigHandFrontDepth).toBeGreaterThan(0);
  });

  it('keeps the index finger stable for personal-pronoun signs', () => {
    const overrides = require('../../../assets/motions/avatar_profile_overrides.json');
    expect(overrides.TÚ.rigPointingHand).toBe(true);
    expect(overrides.YO.rigSelfPointingHand).toBe(true);
  });

  it('reconstructs every landmark within the fixed quantization tolerance', () => {
    const source = {
      fps: 30,
      frames: [
        {bodyHands: [[0.123456, -0.234567, 1.5]], face: [[-1.25, 0, 3.106]]},
        {bodyHands: [[0.987654, 0.456789, -2.75]], face: [[0.25, -0.5, 0.75]]},
      ],
    };

    const encoded: Buffer = compileMotion(source);
    const decoded = decodeCompactMotion(new Uint8Array(encoded));

    expect(decoded.fps).toBe(source.fps);
    expect(decoded.frames).toHaveLength(source.frames.length);
    source.frames.forEach((frame, frameIndex) => {
      [...frame.bodyHands, ...frame.face].forEach((point, pointIndex) => {
        const decodedPoints = [
          ...decoded.frames[frameIndex].bodyHands,
          ...decoded.frames[frameIndex].face,
        ];
        point.forEach((coordinate, coordinateIndex) => {
          expect(Math.abs(decodedPoints[pointIndex][coordinateIndex] - coordinate)).toBeLessThanOrEqual(0.00005);
        });
      });
    });
  });

  it('rejects coordinates that cannot be represented safely', () => {
    expect(() => compileMotion({
      fps: 30,
      frames: [{bodyHands: [[4, 0, 0]], face: [[0, 0, 0]]}],
    })).toThrow('outside the compact range');
  });

  it('uses safe asset filenames without collapsing distinct Spanish accents', () => {
    expect(motionAssetName('EL')).toBe('m_00006500006c');
    expect(motionAssetName('ÉL')).toBe('m_0000e900006c');
    expect(motionAssetName('¿CÓMO ESTÁS?')).toBe('m_0000bf0000630000f300006d00006f0000200000650000730000740000e100007300003f');
  });
});
