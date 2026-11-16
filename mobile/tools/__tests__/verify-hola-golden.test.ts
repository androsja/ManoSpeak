import fs from 'fs';
import path from 'path';

const {
  HOLA_GOLDEN,
  verifyHolaGolden,
  verifyHolaGoldenBytes,
} = require('../verify-hola-golden');

const assetPath = path.join(__dirname, '..', '..', 'assets', 'motions', 'hola.motion.json');

describe('verify-hola-golden', () => {
  it('keeps HOLA bytes and playback contract stable', () => {
    const report = verifyHolaGolden(assetPath);

    expect(report).toEqual({
      asset: assetPath,
      byteLength: HOLA_GOLDEN.byteLength,
      sha256: HOLA_GOLDEN.sha256,
      fps: 30,
      frameCount: 36,
      layout: 'pose33_left21_right21_face468',
      activeHand: 'left',
      contact: {
        anchor: 'forehead',
        startFrame: 0,
        endFrame: 12,
        palm: 'camera',
      },
    });
  });

  it('fails when a byte changes even if the JSON contract remains valid', () => {
    const bytes = Buffer.from(fs.readFileSync(assetPath));
    bytes[bytes.length - 2] = bytes[bytes.length - 2] === 0x20 ? 0x21 : 0x20;

    expect(() => verifyHolaGoldenBytes(bytes, 'mutated-hola.motion.json'))
      .toThrow('sha256');
  });
});
