import fs from 'fs';
import path from 'path';
import {parseJsonMotionDocument} from '../../src/services/JsonMotionLoader';

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
      frameCount: 73,
      layout: 'pose33_left21_right21_face468',
      activeHand: 'right',
      contact: {
        anchor: 'temple',
        startFrame: 16,
        endFrame: 19,
        palm: 'camera',
      },
    });
  });

  it('raises the right fingertips diagonally, releases before descending and returns to rest', () => {
    const motion = parseJsonMotionDocument(JSON.parse(fs.readFileSync(assetPath, 'utf8')));
    const {frames, avatarProfile} = motion;
    expect(avatarProfile).toMatchObject({
      rigArmDepthSpace: 'shoulder-relative',
      rigContactUseAvatarAnchor: true,
      rigContactLandmark: 8,
      rigContactSnap: 1,
    });
    const wrist = 54; // Pose (33) and left hand (21) precede the right hand.
    const contact = frames[16].bodyHands;
    const indexTip = contact[wrist + 8];
    expect(indexTip[0]).toBeGreaterThan(contact[wrist][0]);
    expect(indexTip[1]).toBeLessThan(contact[wrist][1]);
    const release = frames[28].bodyHands[wrist];
    expect(release[0]).toBeLessThan(contact[wrist][0]);
    expect(release[1]).toBeLessThan(contact[wrist][1]);
    expect(release[2]).toBeLessThan(contact[wrist][2]);
    expect(frames[39].bodyHands[wrist][1]).toBeGreaterThan(contact[wrist][1]);
    expect(frames.at(-1)?.bodyHands).toEqual(frames[0].bodyHands);
  });

  it('fails when a byte changes even if the JSON contract remains valid', () => {
    const bytes = Buffer.from(fs.readFileSync(assetPath));
    bytes[bytes.length - 2] = bytes[bytes.length - 2] === 0x20 ? 0x21 : 0x20;

    expect(() => verifyHolaGoldenBytes(bytes, 'mutated-hola.motion.json'))
      .toThrow('sha256');
  });
});
