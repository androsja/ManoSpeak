import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {parseJsonMotionDocument} from '../../src/services/JsonMotionLoader';
import {resolveInstalledSignPlan} from '../../src/services/LinguisticCatalogService';
import {riggedHandsEditPoseAtFrame} from '../../src/services/AvatarMotionPresentation';
import type {MotionFrame} from '../../src/services/CompactSignMotion';

const directory = path.resolve(__dirname, '../../assets/motions/drafts/courtesy');
const recipe = JSON.parse(fs.readFileSync(path.join(directory, 'querer.authoring.json'), 'utf8'));
const bytes = fs.readFileSync(path.join(directory, 'querer.motion.json'));
const motion = JSON.parse(bytes.toString());
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {buildMotion} = require('../generate-querer-motion-draft.cjs');

describe('Authored QUERER draft (INSOR page 266)', () => {
  it('rebuilds symmetric two-hand frames from the authored recipe with no captured face', () => {
    expect(buildMotion(recipe)).toEqual(motion);
    expect(parseJsonMotionDocument(motion).frames).toHaveLength(48);
    expect(motion.frames.every((frame: MotionFrame) => frame.face.flat().every(value => value === 0)
      && frame.bodyHands.length === 75 && frame.bodyHands.flat().every(Number.isFinite))).toBe(true);
    expect(motion.publicationReview.status).toBe('draft');
    expect(zlib.gzipSync(bytes, {level: 9}).length).toBeLessThan(30000);
  });

  it('rises into a wide open spider shape at the chest, then lowers clearly while closing fingers further', () => {
    const start = motion.frames[15].bodyHands;
    const apex = motion.frames[29].bodyHands;
    const end = motion.frames[47].bodyHands;

    // Symmetric left/right wrists and all 21 hand landmarks around the midline (x = 0.50).
    expect(start[16][0]).toBeLessThan(0.5);
    expect(start[15][0]).toBeGreaterThan(0.5);
    expect(start[16][0] + start[15][0]).toBeCloseTo(1, 3);
    expect(start[16][1]).toBeCloseTo(start[15][1], 3);
    expect(start[16][1]).toBeGreaterThan(1.08);
    for (let index = 0; index < 21; index += 1) {
      expect(apex[33 + index][0] + apex[54 + index][0]).toBeCloseTo(1, 3);
      expect(apex[33 + index][1]).toBeCloseTo(apex[54 + index][1], 3);
      expect(apex[33 + index][2]).toBeCloseTo(apex[54 + index][2], 3);
      expect(end[33 + index][0] + end[54 + index][0]).toBeCloseTo(1, 3);
      expect(end[33 + index][1]).toBeCloseTo(end[54 + index][1], 3);
      expect(end[33 + index][2]).toBeCloseTo(end[54 + index][2], 3);
    }

    // Rises smoothly into the chest apex, then makes a clear downward descent to finish.
    expect(apex[16][1]).toBeLessThan(start[16][1] - 0.18);
    expect(apex[15][1]).toBeLessThan(start[15][1] - 0.18);
    expect(end[16][1]).toBeGreaterThan(apex[16][1] + 0.12);
    expect(end[15][1]).toBeGreaterThan(apex[15][1] + 0.12);
    expect(end[16][2]).toBeGreaterThan(start[16][2] + 0.14);
    expect(motion.frames[14].bodyHands[16][1]).not.toBeCloseTo(motion.frames[16].bodyHands[16][1], 3);

    // Fingers stay open in spider shape at the apex, then close noticeably tighter at the bottom.
    expect(start[54 + 9][2]).toBeLessThan(start[54][2]);
    expect(start[33 + 9][2]).toBeLessThan(start[33][2]);
    expect(apex[54 + 9][1]).toBeLessThan(apex[54][1]);
    expect(start[54 + 5][0]).toBeLessThan(start[54 + 17][0]);
    expect(start[33 + 5][0]).toBeGreaterThan(start[33 + 17][0]);

    const keyframes = motion.avatarProfile.rigHandKeyframes;
    const startPose = riggedHandsEditPoseAtFrame(keyframes, 15);
    const apexPose = riggedHandsEditPoseAtFrame(keyframes, 29);
    const endPose = riggedHandsEditPoseAtFrame(keyframes, 47);
    for (const side of ['left', 'right'] as const) {
      expect(startPose[side].fist).toBe(0);
      expect(apexPose[side].fist).toBe(0);
      expect(endPose[side].fist).toBe(0);
      expect(apexPose[side].fingerJoints.index[1]).toBeLessThan(0.5);
      expect(endPose[side].fingerJoints.index[1]).toBeGreaterThan(0.8);
      expect(endPose[side].fingerJoints.pinky[1]).toBeGreaterThan(endPose[side].fingerJoints.index[1]);
      expect(endPose[side].fingerJoints.thumb).toEqual([0.24, 0.72, 0.78]);
    }
  });

  it.each(['quiero', 'quieres', 'quiere', 'queremos', 'quieren', 'quería', 'querré', 'desear', 'deseo'])(
    'resolves the speech alias %s to QUERER',
    form => {
      const plan = resolveInstalledSignPlan(form, [recipe.releaseMetadata]);
      expect(plan.tokens.map(token => token.gloss)).toEqual(['QUERER']);
    },
  );

  it('includes the approved sign in published_signs.json matching the authored draft', () => {
    expect(motion.publicationReview.status).toBe('draft');
    const catalog = JSON.parse(fs.readFileSync(path.resolve(directory, '../../published_signs.json'), 'utf8'));
    const released = JSON.parse(
      fs.readFileSync(path.resolve(directory, '../../querer.motion.json'), 'utf8'),
    );
    expect(catalog.publishedGlosses).toContain('QUERER');
    expect(released.publicationReview?.status).toBe('approved');
    expect(released.frames).toEqual(motion.frames);
    expect(released.avatarProfile).toEqual(motion.avatarProfile);
  });
});
