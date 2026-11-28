import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {parseJsonMotionDocument} from '../../src/services/JsonMotionLoader';
import {riggedHandsEditPoseAtFrame} from '../../src/services/AvatarMotionPresentation';
import type {MotionFrame} from '../../src/services/CompactSignMotion';

const directory = path.resolve(__dirname, '../../assets/motions/drafts/courtesy');
const bytes = fs.readFileSync(path.join(directory, 'buenas-noches.motion.json'));
const motion = JSON.parse(bytes.toString());
const recipe = JSON.parse(fs.readFileSync(path.join(directory, 'buenas-noches.authoring.json'), 'utf8'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {buildMotion} = require('../generate-buenas-noches-motion-draft.cjs');

describe('Authored BUENAS NOCHES (INSOR page 486)', () => {
  it('rebuilds playable frames from the authored recipe with no captured face', () => {
    expect(buildMotion(recipe)).toEqual(motion);
    expect(parseJsonMotionDocument(motion).frames).toHaveLength(97);
    expect(motion.frames.every((f: MotionFrame) => f.face.flat().every(v => v === 0)
      && f.bodyHands.length === 75 && f.bodyHands.flat().every(Number.isFinite))).toBe(true);
    expect(motion.frames[0]).toEqual(motion.frames[96]);
  });

  it('finishes both contacts before crossing and closing both symmetric fists', () => {
    const p = motion.avatarProfile;
    expect(p.contactEndFrame).toBeLessThan(p.rigInterHandContact.startFrame);
    expect(p.rigInterHandContact.endFrame).toBeLessThan(45);

    const open = motion.frames[45].bodyHands;
    const closed = motion.frames[62].bodyHands;

    // Frame 45: hands open high and symmetrically in front of shoulders with palms facing outward/forward (opposite roll before pronating into fists).
    expect(open[16][0]).toBeLessThan(open[15][0]);
    expect(open[16][1]).toBeLessThan(0.75);
    expect(open[15][1]).toBeLessThan(0.75);
    for (const start of [33, 54]) {
      expect(open[start + 9][1]).toBeLessThan(open[start][1]);
    }
    expect(open[54 + 5][2]).toBeGreaterThan(open[54 + 17][2]); // right thumb/index back (+Z), pinky forward (-Z)
    expect(open[33 + 5][2]).toBeGreaterThan(open[33 + 17][2]); // left thumb/index back (+Z), pinky forward (-Z)

    // Frame 62: fists meet near chest center (x ≈ 0.50) with knuckles up/forward and palms curling toward the chest.
    expect(closed[16][1]).toBeGreaterThan(open[16][1]);
    expect(closed[15][1]).toBeGreaterThan(open[15][1]);
    expect(Math.abs(closed[16][0] - closed[15][0])).toBeLessThan(0.08);
    expect((closed[16][0] + closed[15][0]) / 2).toBeCloseTo(0.5, 2);
    expect(closed[16][2]).toBeLessThan(closed[15][2]);
    expect(closed[54 + 5][1]).toBeLessThan(closed[54 + 17][1]); // right thumb upper (-Y), palm faces chest/down
    expect(closed[33 + 5][1]).toBeLessThan(closed[33 + 17][1]); // left thumb upper (-Y), palm faces chest/down

    const keyframes = p.rigHandKeyframes;
    expect(riggedHandsEditPoseAtFrame(keyframes, 45).right.fist).toBe(0);
    const middle = riggedHandsEditPoseAtFrame(keyframes, 54);
    expect(middle.right.fist).toBeGreaterThan(0);
    expect(middle.right.fist).toBeLessThan(1);
    expect(middle.left.fist).toBe(middle.right.fist);
    expect(riggedHandsEditPoseAtFrame(keyframes, 62).left.fist).toBe(1);
    expect(riggedHandsEditPoseAtFrame(keyframes, 62).left.fingers.thumb).toBe(0.75);
    expect(riggedHandsEditPoseAtFrame(keyframes, 62).right.fist).toBe(1);
    expect(riggedHandsEditPoseAtFrame(keyframes, 62).right.fingers.thumb).toBe(0.75);
    expect(riggedHandsEditPoseAtFrame(keyframes, 96).right.fist).toBe(0);
  });

  it('includes the approved sign in published_signs.json matching the authored draft', () => {
    expect(zlib.gzipSync(bytes, {level: 9}).length).toBeLessThan(50000);
    expect(motion.publicationReview.status).toBe('draft');
    const catalog = JSON.parse(fs.readFileSync(path.resolve(directory, '../../published_signs.json'), 'utf8'));
    const released = JSON.parse(
      fs.readFileSync(path.resolve(directory, '../../buenas noches.motion.json'), 'utf8'),
    );
    expect(catalog.publishedGlosses).toContain('BUENAS NOCHES');
    expect(released.publicationReview?.status).toBe('approved');
    expect(released.frames).toEqual(motion.frames);
    expect(released.avatarProfile).toEqual(motion.avatarProfile);
  });
});
