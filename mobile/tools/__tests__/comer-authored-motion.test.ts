import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {parseJsonMotionDocument} from '../../src/services/JsonMotionLoader';
import {resolveInstalledSignPlan} from '../../src/services/LinguisticCatalogService';
import {riggedFacialEditAtFrame, riggedHandsEditPoseAtFrame} from '../../src/services/AvatarMotionPresentation';

const directory = path.resolve(__dirname, '../../assets/motions/drafts/courtesy');
const recipe = JSON.parse(fs.readFileSync(path.join(directory, 'comer.authoring.json'), 'utf8'));
const motion = JSON.parse(fs.readFileSync(path.join(directory, 'comer.motion.json'), 'utf8'));
const {buildMotion} = require('../generate-comer-motion-draft.cjs');

describe('Authored COMER and planned release aliases', () => {
  it('publishes the approved animation with its authored profile', () => {
    const published = JSON.parse(fs.readFileSync(path.resolve(directory, '../../comer.motion.json'), 'utf8'));
    const overrides = JSON.parse(fs.readFileSync(path.resolve(directory, '../../avatar_profile_overrides.json'), 'utf8'));
    expect(published.publicationReview.status).toBe('approved');
    expect(published.frames).toEqual(motion.frames);
    expect({...published.avatarProfile, ...overrides.COMER}).toEqual(motion.avatarProfile);
  });
  it('builds an open hand with four synchronized finger flaps near the mouth', () => {
    expect(buildMotion(recipe)).toEqual(motion);
    expect(parseJsonMotionDocument(motion).frames).toHaveLength(85);
    expect(motion.frames[0]).toEqual(motion.frames[84]);
    expect(motion.avatarProfile.rigRightHandShape).toBe('captured');
    const keyframes = motion.avatarProfile.rigHandKeyframes;
    for (const frame of [21, 33, 45, 57]) {
      const pose = riggedHandsEditPoseAtFrame(keyframes, frame).right;
      expect(pose.fist).toBe(0);
      for (const finger of ['index', 'middle', 'ring', 'pinky'] as const) {
        expect(pose.fingerJoints[finger]).toEqual([1, 0, 0]);
      }
      expect(pose.fingerJoints.thumb).toEqual([0, 0, 0]);
    }
    for (const frame of [16, 28, 40, 52, 64, 84]) {
      expect(riggedHandsEditPoseAtFrame(keyframes, frame).right.fingerJoints.index).toEqual([0, 0, 0]);
    }
    expect(zlib.gzipSync(Buffer.from(JSON.stringify(motion))).length).toBeLessThan(30000);
  });

  it.each(['como', 'comes', 'comí', 'comimos', 'comeré', 'comeríamos', 'comiendo', 'comido', 'comida', 'coman', 'cómete'])(
    'resolves the downloaded speech alias %s to COMER', form => {
      const plan = resolveInstalledSignPlan(form, [recipe.releaseMetadata]);
      expect(plan.tokens.map(token => token.gloss)).toEqual(['COMER']);
    },
  );

  it('opens and closes the mouth four times and keeps the palm aligned with the forearm', () => {
    const keyframes = motion.avatarProfile.rigHandKeyframes;
    for (const [open, closed] of [[16, 23], [28, 35], [40, 47], [52, 59]]) {
      expect(riggedFacialEditAtFrame(keyframes, open).mouthOpening).toBe(.85);
      expect(riggedFacialEditAtFrame(keyframes, closed).mouthOpening).toBe(.03);
    }
    expect(riggedFacialEditAtFrame(keyframes, 84).mouthOpening).toBe(0);
    const points = motion.frames[28].bodyHands;
    const forearm = points[16].map((value: number, axis: number) => value - points[14][axis]);
    const palm = points[54].map((value: number, axis: number) => (
      [59, 63, 67, 71].reduce((sum, index) => sum + points[index][axis], 0) / 4 - value
    ));
    const dot = forearm.reduce((sum: number, value: number, axis: number) => sum + value * palm[axis], 0);
    expect(dot / (Math.hypot(...forearm) * Math.hypot(...palm))).toBeGreaterThan(.95);
  });

  it('retains every spoken occurrence and only uses installed subject markers', () => {
    expect(resolveInstalledSignPlan('comí comiendo comeremos', [recipe.releaseMetadata]).tokens
      .map(token => token.gloss)).toEqual(['COMER', 'COMER', 'COMER']);
    const subject = {...recipe.releaseMetadata, gloss: 'YO', speechAliases: ['yo'], lexicalClass: 'pronoun', requiresSubjectMarker: false};
    expect(resolveInstalledSignPlan('yo como', [recipe.releaseMetadata, subject]).tokens
      .map(token => token.gloss)).toEqual(['YO', 'COMER']);
    const greeting = {...subject, gloss: '¿CÓMO ESTÁS?', speechAliases: ['cómo estás']};
    expect(resolveInstalledSignPlan('cómo estás', [recipe.releaseMetadata, greeting]).tokens
      .map(token => token.gloss)).toEqual(['¿CÓMO ESTÁS?']);
  });
});
