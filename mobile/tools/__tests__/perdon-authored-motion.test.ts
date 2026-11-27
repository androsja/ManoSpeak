import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {parseJsonMotionDocument} from '../../src/services/JsonMotionLoader';

const directory = path.resolve(__dirname, '../../assets/motions/drafts/courtesy');
const recipe = JSON.parse(
  fs.readFileSync(path.join(directory, 'perdon.authoring.json'), 'utf8'),
);
const bytes = fs.readFileSync(path.join(directory, 'perdon.motion.json'));
const motion = parseJsonMotionDocument(JSON.parse(bytes.toString()));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {buildMotion} = require('../generate-perdon-motion-draft.cjs') as {
  buildMotion: (recipe: unknown) => typeof motion;
};

describe('Authored PERDÓN draft — owner fist-on-left-pectoral variant', () => {
  it('reproduces a playable JSON without recorded facial landmarks', () => {
    expect(buildMotion(recipe)).toEqual(motion);
    expect(motion.frames).toHaveLength(73);
    expect(
      motion.frames.every(frame => frame.face.flat().every(value => value === 0)),
    ).toBe(true);
    // first and last frames must be identical (rest)
    expect(motion.frames[0]).toEqual(motion.frames[72]);
  });

  it('uses a right-hand fist with no active left hand', () => {
    expect(motion.avatarProfile.activeHand).toBe('right');
    expect(motion.avatarProfile.forceTwoHands).toBe(false);
    expect(motion.avatarProfile.rigRightHandShape).toBe('fist');
    const states = motion.avatarProfile.rigRightFingerStates;
    expect(states.thumb).toBe('closed');
    expect(states.index).toBe('closed');
    expect(states.middle).toBe('closed');
    expect(states.ring).toBe('closed');
    expect(states.pinky).toBe('closed');
    // left-hand slot (bodyHands[33..53]) must be all zeros in every frame
    expect(
      motion.frames.every(frame =>
        frame.bodyHands.slice(33, 54).every(pt => pt.every(v => v === 0)),
      ),
    ).toBe(true);
  });

  it('places the fist in front of the avatar\'s left pectoral (opposite chest side) tracing a frontal XY circle', () => {
    // During the circle phase (frames 12-47) the right wrist (bodyHands[16])
    // must trace an XY circle centered at [0.58, 0.83] with constant Z=-0.38
    // in front of the chest mesh so the hand and forearm do not clip the torso.
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 12; i <= 47; i++) {
      const wrist = motion.frames[i].bodyHands[16];
      xs.push(wrist[0]);
      ys.push(wrist[1]);
      expect(wrist[0]).toBeGreaterThan(0.51);        // opposite chest side (left of center 0.50)
      expect(wrist[0]).toBeLessThan(0.65);
      expect(wrist[1]).toBeGreaterThan(0.77);        // y-down: below collarbone
      expect(wrist[1]).toBeLessThan(0.89);           // y-down: upper chest
      expect(wrist[2]).toBeCloseTo(-0.38, 3);        // z: clear in front of chest, constant
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.10);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.09);
    // Entry and exit must connect continuously to the circle start point (frame 12)
    expect(motion.frames[11].bodyHands[16][1]).toBeGreaterThan(motion.frames[12].bodyHands[16][1]);
    expect(motion.frames[48].bodyHands[16]).toEqual(motion.frames[12].bodyHands[16]);
  });

  it('traces two complete circles (turn boundaries align)', () => {
    // Turn 1 start (frame 12) must equal Turn 2 start (frame 30)
    expect(motion.frames[12].bodyHands[16]).toEqual(motion.frames[30].bodyHands[16]);

    // Turn 1 end (frame 29) ≈ Turn 2 end (frame 47)
    const end1 = motion.frames[29].bodyHands[16];
    const end2 = motion.frames[47].bodyHands[16];
    expect(end1[0]).toBeCloseTo(end2[0], 3);
    expect(end1[1]).toBeCloseTo(end2[1], 3);
    expect(end1[2]).toBeCloseTo(end2[2], 3);
  });

  it('starts and ends at the abdomen rest position', () => {
    expect(motion.frames[0].bodyHands[16]).toEqual([0.4, 1.13, -0.36]);
    expect(motion.frames[72].bodyHands[16]).toEqual([0.4, 1.13, -0.36]);
  });

  it('includes the approved sign in the released library and reduces download size', () => {
    const published = JSON.parse(
      fs.readFileSync(path.resolve(directory, '../../published_signs.json'), 'utf8'),
    ) as {publishedGlosses: string[]};
    expect(published.publishedGlosses).toContain('PERDÓN');
    // The gzipped motion must be much smaller than the old 669 KB recorded motion
    expect(zlib.gzipSync(bytes, {level: 9}).length).toBeLessThan(669_720 * 0.1);
  });
});
