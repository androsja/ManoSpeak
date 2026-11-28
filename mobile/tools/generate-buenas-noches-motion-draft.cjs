'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {buildFrames} = require('./generate-buenos-dias-motion-draft.cjs');
const {buildMotion: buildCourtesyMotion} = require('./generate-buenas-tardes-motion-draft.cjs');

const directory = path.resolve(__dirname, '../assets/motions/drafts/courtesy');

function buildMotion(recipe) {
  const motion = buildCourtesyMotion(recipe);
  motion.publicationReview = {status: 'draft', scope: 'INSOR page 486; awaiting owner visual review.'};
  motion.authoring = {
    source: 'procedural-keyframes',
    recipe: 'buenas-noches.authoring.json',
    referencePage: 486,
    speechAliases: ['buenas noches', 'buena noche'],
    phases: [
      {id: 'chin-contact', fromMs: 550, toMs: 700},
      {id: 'opposite-palm-contact', fromMs: 1050, toMs: 1200},
      {id: 'raise-open-hands', fromMs: 1200, toMs: 1500},
      {id: 'cross-and-close', fromMs: 1500, toMs: 2020},
      {id: 'crossed-hold', fromMs: 2020, toMs: 2400},
      {id: 'return-rest', fromMs: 2400, toMs: 3000},
    ],
  };
  motion.avatarProfile.contactStartFrame = 16;
  motion.avatarProfile.contactEndFrame = 21;
  motion.avatarProfile.rigInterHandContact = {
    ...motion.avatarProfile.rigInterHandContact,
    startFrame: 31,
    endFrame: 36,
    fadeFrames: 4,
  };
  motion.avatarProfile.rigHandKeyframes = [
    {frame: 0, transitionFrames: 4, smile: 0.25, left: {fist: 0}, right: {fist: 0}},
    {frame: 45, transitionFrames: 4, smile: 0.3, left: {fist: 0}, right: {fist: 0}},
    {
      frame: 60,
      transitionFrames: 12,
      smile: 0.35,
      left: {fist: 1, fingers: {thumb: 0.75}},
      right: {fist: 1, fingers: {thumb: 0.75}},
    },
    {
      frame: 72,
      transitionFrames: 4,
      smile: 0.35,
      left: {fist: 1, fingers: {thumb: 0.75}},
      right: {fist: 1, fingers: {thumb: 0.75}},
    },
    {
      frame: 89,
      transitionFrames: 16,
      smile: 0.3,
      left: {fist: 0, fingers: {thumb: 0}},
      right: {fist: 0, fingers: {thumb: 0}},
    },
  ];
  return motion;
}

if (require.main === module) {
  const recipe = JSON.parse(fs.readFileSync(path.join(directory, 'buenas-noches.authoring.json'), 'utf8'));
  const motion = buildMotion(recipe);
  fs.writeFileSync(path.join(directory, 'buenas-noches.motion.json'), JSON.stringify(motion) + '\n');
  console.log(`BUENAS NOCHES: ${motion.frames.length} authored frames; local draft.`);
}
module.exports = {buildMotion, buildFrames};
