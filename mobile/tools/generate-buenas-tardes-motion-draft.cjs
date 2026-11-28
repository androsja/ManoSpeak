'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {buildFrames} = require('./generate-buenos-dias-motion-draft.cjs');

const directory = path.resolve(__dirname, '../assets/motions/drafts/courtesy');

function buildMotion(recipe) {
  const frames = buildFrames(recipe);
  return {
    version: 2,
    fps: recipe.fps,
    layout: 'pose33_left21_right21_face468',
    description: recipe.description,
    reference: recipe.reference,
    publicationReview: {
      status: 'draft',
      scope: 'INSOR page 487; awaiting owner visual review.',
    },
    authoring: {
      source: 'procedural-keyframes',
      recipe: 'buenas-tardes.authoring.json',
      referencePage: 487,
      speechAliases: ['buenas tardes', 'buena tarde'],
      strokes: [{fromMs: 500, toMs: 1080}, {fromMs: 1400, toMs: 2200}],
    },
    avatarProfile: {
      activeHand: 'right',
      forceTwoHands: true,
      rigArmDepthSpace: 'shoulder-relative',
      rigRightHandShape: 'captured',
      rigLeftHandShape: 'captured',
      rigRightPalmScaleMin: 0.84,
      rigRightPalmScaleMax: 0.84,
      rigLeftPalmScaleMin: 0.84,
      rigLeftPalmScaleMax: 0.84,
      contactAnchor: 'chin',
      contactStartFrame: 15,
      contactEndFrame: 19,
      rigContactLandmark: 12,
      rigContactUseAvatarAnchor: true,
      rigContactSnap: 1,
      rigContactFadeFrames: 4,
      rigInterHandContact: {
        movingSide: 'R',
        movingLandmarks: [8, 12, 16],
        supportSide: 'L',
        supportLandmarks: [0, 5, 9, 13, 17],
        preserveCapturedOffset: false,
        snap: 1,
        startFrame: 29,
        endFrame: 32,
        fadeFrames: 3,
        maximumCorrection: 0.3,
      },
      rigHandKeyframes: [
        {
          frame: 0,
          transitionFrames: 4,
          smile: 0.25,
          left: {fist: 0},
          right: {fist: 0},
        },
        {
          frame: 50,
          transitionFrames: 6,
          smile: 0.4,
          left: {fist: 0, fingers: {thumb: 0}},
          right: {fist: 0, fingers: {thumb: 0}},
        },
      ],
    },
    frames,
  };
}

if (require.main === module) {
  const recipe = JSON.parse(
    fs.readFileSync(path.join(directory, 'buenas-tardes.authoring.json'), 'utf8'),
  );
  const motion = buildMotion(recipe);
  fs.writeFileSync(
    path.join(directory, 'buenas-tardes.motion.json'),
    JSON.stringify(motion) + '\n',
  );
  console.log(`BUENAS TARDES: ${motion.frames.length} authored frames; draft only.`);
}

module.exports = {buildMotion, buildFrames};
