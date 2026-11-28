import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {parseJsonMotionDocument} from '../../src/services/JsonMotionLoader';
import type {MotionFrame} from '../../src/services/CompactSignMotion';

const directory = path.resolve(__dirname, '../../assets/motions/drafts/courtesy');
const bytes = fs.readFileSync(path.join(directory, 'buenas-tardes.motion.json'));
const motion = JSON.parse(bytes.toString());
const recipe = JSON.parse(
  fs.readFileSync(path.join(directory, 'buenas-tardes.authoring.json'), 'utf8'),
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {buildMotion} = require('../generate-buenas-tardes-motion-draft.cjs');

describe('Authored BUENAS TARDES draft (INSOR p.487)', () => {
  it('reproduces a playable JSON without recorded facial landmarks', () => {
    expect(buildMotion(recipe)).toEqual(motion);
    expect(motion.frames).toHaveLength(85);
    expect(parseJsonMotionDocument(motion).frames).toHaveLength(85);
    expect(motion.frames.every((frame: MotionFrame) => frame.bodyHands.length === 75
      && frame.face.length === 468
      && frame.face.flat().every((value: number) => value === 0)
      && frame.bodyHands.flat().every(Number.isFinite))).toBe(true);
    expect(motion.frames[0]).toEqual(motion.frames.at(-1));
  });

  it('orders chin contact, opposite-palm contact, and stacked palms facing down', () => {
    const profile = motion.avatarProfile;
    expect(profile.contactAnchor).toBe('chin');
    expect(profile.contactEndFrame).toBeLessThan(profile.rigInterHandContact.startFrame);
    expect(profile.rigInterHandContact.endFrame).toBeLessThan(50);

    // At frame 30 (palm-contact), the support left palm faces upward (+Y world).
    const palmNormalWorldY = (hand: number[][], side: 'L' | 'R') => {
      const yAxis = [hand[9][0] - hand[0][0], -(hand[9][1] - hand[0][1]), -(hand[9][2] - hand[0][2])];
      const xAxis = [hand[17][0] - hand[5][0], -(hand[17][1] - hand[5][1]), -(hand[17][2] - hand[5][2])];
      const zx = xAxis[1] * yAxis[2] - xAxis[2] * yAxis[1];
      const zy = xAxis[2] * yAxis[0] - xAxis[0] * yAxis[2];
      const zz = xAxis[0] * yAxis[1] - xAxis[1] * yAxis[0];
      const len = Math.hypot(zx, zy, zz);
      return (side === 'L' ? zy : -zy) / len;
    };
    const contact = motion.frames[30].bodyHands;
    expect(palmNormalWorldY(contact.slice(33, 54), 'L')).toBeGreaterThan(0.8);

    // At frame 42 (hands-stacked-lift), the right hand rises higher (-Y) before tapping down.
    const lift = motion.frames[42].bodyHands;
    expect(lift[16][1]).toBeLessThan(contact[16][1]);

    // At frame 50 (hands-stacked-tap), the right hand drops down onto the left hand
    // with both palms facing downward (-Y world).
    const stacked = motion.frames[50].bodyHands;
    expect(stacked[16][1]).toBeGreaterThan(lift[16][1]);
    expect(stacked[16][1]).toBeLessThan(stacked[15][1]); // y-down: right wrist above left wrist
    expect(palmNormalWorldY(stacked.slice(54, 75), 'R')).toBeLessThan(-0.8);
    expect(palmNormalWorldY(stacked.slice(33, 54), 'L')).toBeLessThan(-0.8);
  });

  it('reduces payload size substantially relative to a full recorded capture', () => {
    expect(zlib.gzipSync(bytes, {level: 9}).length).toBeLessThan(50_000);
  });

  it('includes the approved sign in published_signs.json matching the authored draft', () => {
    const published = JSON.parse(
      fs.readFileSync(path.resolve(directory, '../../published_signs.json'), 'utf8'),
    ) as {publishedGlosses: string[]};
    const released = JSON.parse(
      fs.readFileSync(path.resolve(directory, '../../buenas tardes.motion.json'), 'utf8'),
    );
    expect(published.publishedGlosses).toContain('BUENAS TARDES');
    expect(released.publicationReview?.status).toBe('approved');
    expect(released.frames).toEqual(motion.frames);
    expect(released.avatarProfile).toEqual(motion.avatarProfile);
  });
});
