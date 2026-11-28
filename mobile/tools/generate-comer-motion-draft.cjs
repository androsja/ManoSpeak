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
    rightDirection: pose.direction,
    rightAcross: pose.across,
    leftWrist: [0.74, 1.27, -0.16],
    leftElbow: [0.74, 0.97, -0.07],
    leftDirection: [0.02, 1, -0.12],
    headPitch: 0,
  }));
  return {
    version: 2,
    fps: recipe.fps,
    layout: 'pose33_left21_right21_face468',
    reference: recipe.reference,
    description: recipe.description,
    publicationReview: {status: 'draft', scope: 'INSOR page 32, open-hand variant 2 and owner visual reference; awaiting visual review.'},
    authoring: {
      source: 'procedural-keyframes', recipe: 'comer.authoring.json', referencePage: 32,
      speechAliases: recipe.releaseMetadata.speechAliases,
    },
    avatarProfile: {
      activeHand: 'right', forceTwoHands: true, rigArmDepthSpace: 'shoulder-relative',
      rigRightHandShape: 'captured', rigRightPalmScaleMin: 0.84, rigRightPalmScaleMax: 0.84,
      rigRightForearmAxialRollDegrees: -30,
      contactAnchor: 'none',
      rigHandKeyframes: recipe.handKeyframes.map(({frame, transitionFrames, bend, mouthOpening}) => ({
        frame,
        transitionFrames,
        mouthOpening,
        right: {
          fist: 0,
          fingerJoints: {
            index: [bend, 0, 0],
            middle: [bend, 0, 0],
            ring: [bend, 0, 0],
            pinky: [bend, 0, 0],
          },
        },
      })),
    },
    frames: buildFrames({...recipe, keyframes}),
  };
}

if (require.main === module) {
  const recipe = JSON.parse(fs.readFileSync(path.join(directory, 'comer.authoring.json'), 'utf8'));
  const motion = buildMotion(recipe);
  fs.writeFileSync(path.join(directory, 'comer.motion.json'), JSON.stringify(motion) + '\n');
  console.log(`COMER: ${motion.frames.length} authored frames; local draft.`);
}
module.exports = {buildMotion};
