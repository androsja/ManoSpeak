import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {parseJsonMotionDocument} from '../../src/services/JsonMotionLoader';
import type {MotionFrame} from '../../src/services/CompactSignMotion';

const directory = path.resolve(__dirname, '../../assets/motions/drafts/courtesy');
const bytes = fs.readFileSync(path.join(directory, 'buenos-dias.motion.json'));
const motion = JSON.parse(bytes.toString());
const recipe = JSON.parse(
  fs.readFileSync(path.join(directory, 'buenos-dias.authoring.json'), 'utf8'),
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {buildMotion} = require('../generate-buenos-dias-motion-draft.cjs');

describe('Authored BUENOS DÍAS draft (INSOR p.487)', () => {
  it('reproduces a playable JSON without recorded facial landmarks', () => {
    expect(buildMotion(recipe)).toEqual(motion);
    expect(motion.frames).toHaveLength(91);
    expect(parseJsonMotionDocument(motion).frames).toHaveLength(91);
    expect(
      motion.frames.every(
        (frame: MotionFrame) =>
          frame.bodyHands.length === 75
          && frame.face.length === 468
          && frame.face.flat().every((value: number) => value === 0)
          && frame.bodyHands.flat().every(Number.isFinite),
      ),
    ).toBe(true);
    expect(motion.frames[0]).toEqual(motion.frames[90]);
  });

  it('orders chin contact, opposite-palm contact, cross-chest close, and wide open palms', () => {
    const profile = motion.avatarProfile;
    expect(profile.contactAnchor).toBe('chin');
    expect(profile.contactEndFrame).toBeLessThan(profile.rigInterHandContact.startFrame);
    expect(profile.rigInterHandContact.endFrame).toBeLessThan(48);

    // At frame 49 (arms crossed), right wrist is on the avatar's left side (x > 0.5)
    // and left wrist is on the avatar's right side (x < 0.5), clear in front of the torso.
    const crossed = motion.frames[49].bodyHands;
    expect(crossed[16][0]).toBeGreaterThan(0.5);
    expect(crossed[15][0]).toBeLessThan(0.5);
    expect(crossed[16][2]).toBeLessThan(-0.4);
    expect(crossed[15][2]).toBeLessThan(-0.32);

    // At frame 69 (arms separated), both hands open outward with palms facing forward toward the camera.
    const opened = motion.frames[69].bodyHands;
    expect(opened[16][0]).toBeLessThan(0.25);
    expect(opened[15][0]).toBeGreaterThan(0.75);
    expect(opened[54 + 5][0]).toBeGreaterThan(opened[16][0]);
    expect(opened[54 + 17][0]).toBeLessThan(opened[16][0]);
    expect(opened[33 + 5][0]).toBeLessThan(opened[15][0]);
    expect(opened[33 + 17][0]).toBeGreaterThan(opened[15][0]);
  });

  it('reduces payload size dramatically relative to the old recorded motion', () => {
    // Old recorded buenos días.motion.json was 1,678,119 bytes.
    expect(zlib.gzipSync(bytes, {level: 9}).length).toBeLessThan(50_000);
  });

  it('includes the approved sign in published_signs.json matching the authored draft', () => {
    const published = JSON.parse(
      fs.readFileSync(path.resolve(directory, '../../published_signs.json'), 'utf8'),
    ) as {publishedGlosses: string[]};
    const released = JSON.parse(
      fs.readFileSync(path.resolve(directory, '../../buenos días.motion.json'), 'utf8'),
    );
    expect(published.publishedGlosses).toContain('BUENOS DÍAS');
    expect(released.publicationReview?.status).toBe('approved');
    expect(released.frames).toEqual(motion.frames);
    expect(released.avatarProfile).toEqual(motion.avatarProfile);
  });
});
