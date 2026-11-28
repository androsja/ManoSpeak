'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {buildFrames} = require('./generate-buenos-dias-motion-draft.cjs');
const directory = path.resolve(__dirname, '../assets/motions/drafts/courtesy');

function buildMotion(recipe) {
  const keyframes = recipe.keyframes.map(pose => ({
    ms: pose.ms,
    rightWrist: pose.wrist,
    rightElbow: pose.elbow,
    rightDirection: pose.direction ?? [0.24, -1, 0.05],
    rightAcross: pose.across ?? [-0.48, 0, 0.88],
    leftWrist: [0.74, 1.27, -0.16],
    leftElbow: [0.74, 0.97, -0.07],
    leftDirection: [0.02, 1, -0.12],
    headPitch: 0,
  }));
  const frames = buildFrames({...recipe, keyframes});
  for (const {bodyHands} of frames) {
    // Keep the A thumb close to the index side and pointing past the fist.
    const wrist = bodyHands[54];
    const forward = bodyHands[66].map((value, axis) => (value - wrist[axis]) / 0.18);
    const lateral = bodyHands[59].map((value, axis) => (value - bodyHands[71][axis] - 0.004 * forward[axis]) / 0.07);
    const thumb = [[0.024, 0.015], [0.043, 0.047], [0.045, 0.082], [0.043, 0.112]];
    thumb.forEach(([across, along], index) => {
      bodyHands[55 + index] = wrist.map((value, axis) => Number((value + lateral[axis] * across + forward[axis] * along).toFixed(5)));
    });
  }
  return {
    version: 2,
    fps: recipe.fps,
    layout: 'pose33_left21_right21_face468',
    description: recipe.description,
    reference: recipe.reference,
    publicationReview: {status: 'draft', scope: 'INSOR page 58; awaiting owner visual review.'},
    authoring: {source: 'procedural-keyframes', recipe: 'agua.authoring.json', referencePage: 58, speechAliases: ['agua']},
    avatarProfile: {
      activeHand: 'right',
      forceTwoHands: true,
      rigArmDepthSpace: 'shoulder-relative',
      rigRightHandShape: 'thumb-up',
      rigRightPalmScaleMin: 0.84,
      rigRightPalmScaleMax: 0.84,
      contactAnchor: 'chin',
      rigContactWindows: recipe.contactWindows,
      rigContactLandmark: 4,
      rigContactUseAvatarAnchor: true,
      rigContactSnap: 1,
      rigContactFadeFrames: 3,
    },
    frames,
  };
}

if (require.main === module) {
  const recipe = JSON.parse(fs.readFileSync(path.join(directory, 'agua.authoring.json'), 'utf8'));
  const motion = buildMotion(recipe);
  fs.writeFileSync(path.join(directory, 'agua.motion.json'), JSON.stringify(motion) + '\n');
  console.log(`AGUA: ${motion.frames.length} authored frames; local draft.`);
}
module.exports = {buildMotion};
