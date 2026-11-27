import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {parseJsonMotionDocument} from '../../src/services/JsonMotionLoader';
import type {MotionFrame} from '../../src/services/CompactSignMotion';

const directory = path.resolve(__dirname, '../../assets/motions/drafts/courtesy');
const bytes = fs.readFileSync(path.join(directory, 'gracias.motion.json'));
const motion = JSON.parse(bytes.toString());
const recipe = JSON.parse(fs.readFileSync(path.join(directory, 'gracias.authoring.json'), 'utf8'));
const {buildMotion} = require('../generate-gracias-motion-draft.cjs');

describe('Authored GRACIAS draft', () => {
  it('reproduces the draft from its recipe without recorded motion input', () => {
    expect(buildMotion(recipe)).toEqual(motion);
    expect(motion.frames).toHaveLength(73);
    expect(parseJsonMotionDocument(motion).frames).toHaveLength(73);
    expect(motion.frames.every((frame: MotionFrame) => frame.bodyHands.length === 75
      && frame.face.length === 468
      && frame.face.flat().every((value: number) => value === 0)
      && frame.bodyHands.flat().every(Number.isFinite))).toBe(true);
  });

  it('orders the two contact holds before returning to rest', () => {
    const profile = motion.avatarProfile;
    expect(profile.contactAnchor).toBe('chin');
    expect(profile.contactEndFrame).toBeLessThan(profile.rigInterHandContact.startFrame);
    expect(profile.rigInterHandContact.endFrame).toBeLessThan(motion.frames.length - 1);
    expect(motion.frames[0]).toEqual(motion.frames.at(-1));
    expect(motion.frames[45].headOrientation.pitch).toBeGreaterThan(0);
    expect(motion.publicationReview.status).toBe('draft');
  });

  it('reduces the compressed payload substantially relative to the old motion', () => {
    // Measured gzip size of the retired recorded GRACIAS payload.
    expect(zlib.gzipSync(bytes).length).toBeLessThan(510_999 * 0.1);
  });

  it('rests the right hand at the abdomen and keeps the support palm facing up', () => {
    const first = motion.frames[0].bodyHands;
    expect(first[16][1]).toBeGreaterThan(first[15][1]);
    expect(first[66][1]).toBeGreaterThan(first[54][1]);
    for (const frame of motion.frames) {
      const hand = frame.bodyHands.slice(33, 54);
      const forward = hand[9].map((v: number, i: number) => v - hand[0][i]);
      const across = hand[5].map((v: number, i: number) => v - hand[17][i]);
      // Up is negative Y in the authored body coordinate system.
      const palmNormalY = forward[2] * across[0] - forward[0] * across[2];
      expect(palmNormalY).toBeLessThan(0);
    }
  });
});
