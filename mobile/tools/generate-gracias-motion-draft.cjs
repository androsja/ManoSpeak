'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../assets/motions/drafts/courtesy');
const round = x => Math.round(x * 100000) / 100000;
const normalize = v => v.map(x => x / Math.hypot(...v));
const mix = (a, b, t) => a.map((x, i) => round(x + (b[i] - x) * t));

// Analytic open hand, authored independently of recorded landmarks.
function hand(wrist, direction, side, acrossDirection) {
  const forward = normalize(direction);
  const seed = acrossDirection ?? (side === 'right' ? [-1, 0, 0] : [0, 0, -1]);
  const dot = seed.reduce((sum, x, i) => sum + x * forward[i], 0);
  const across = normalize(seed.map((x, i) => x - dot * forward[i]));
  const point = (u, v) => wrist.map((x, i) => round(x + across[i] * u + forward[i] * v));
  const points = [[...wrist], point(.025,.015), point(.05,.03), point(.07,.045), point(.085,.06)];
  [.035,.012,-.012,-.035].forEach((u, i) => {
    const length = [.16,.18,.165,.14][i];
    [.20,.52,.80,1].forEach(t => points.push(point(u, length * t)));
  });
  return points;
}

function buildFrames(recipe) {
  const frames = [];
  const keys = recipe.keyframes;
  for (let index = 0; index <= recipe.durationMs * recipe.fps / 1000; index++) {
    const ms = index * 1000 / recipe.fps;
    const next = keys.findIndex(k => k.ms >= ms);
    const a = keys[Math.max(0, next - 1)], b = keys[next];
    const amount = a.ms === b.ms ? 0 : (ms - a.ms) / (b.ms - a.ms);
    const t = amount * amount * (3 - 2 * amount);
    const pose = {};
    ['rightWrist','rightElbow','leftWrist','leftElbow','rightDirection','leftDirection']
      .forEach(key => { pose[key] = mix(a[key], b[key], t); });
    const bodyHands = Array.from({length: 75}, () => [0,0,0]);
    bodyHands[11] = [.71,.68,0]; bodyHands[12] = [.29,.68,0];
    bodyHands[23] = [.59,1.15,0]; bodyHands[24] = [.41,1.15,0];
    bodyHands[13] = pose.leftElbow; bodyHands[14] = pose.rightElbow;
    bodyHands[15] = pose.leftWrist; bodyHands[16] = pose.rightWrist;
    hand(pose.leftWrist, pose.leftDirection, 'left').forEach((p, i) => { bodyHands[33+i] = p; });
    const rightAcross = mix(a.rightAcross ?? [-1,0,0], b.rightAcross ?? [-1,0,0], t);
    hand(pose.rightWrist, pose.rightDirection, 'right', rightAcross)
      .forEach((p, i) => { bodyHands[54+i] = p; });
    frames.push({bodyHands, face: Array.from({length: 468}, () => [0,0,0]),
      headOrientation: {yaw: 0, pitch: round(a.headPitch + (b.headPitch-a.headPitch)*t), roll: 0}});
  }
  return frames;
}

function buildMotion(recipe) {
  const frames = buildFrames(recipe);
  return {
    version: 2, fps: recipe.fps, layout: 'pose33_left21_right21_face468',
    description: recipe.description, reference: recipe.reference,
    publicationReview: {status: 'draft', scope: 'INSOR page 485; awaiting owner visual and linguistic review.'},
    authoring: {source: 'procedural-keyframes', recipe: 'gracias.authoring.json', referencePage: 485, speechAliases: ['gracias', 'agradecer']},
    avatarProfile: {
      activeHand: 'right', forceTwoHands: true, rigArmDepthSpace: 'shoulder-relative',
      rigRightHandShape: 'captured', rigLeftHandShape: 'captured',
      rigRightPalmScaleMin: .84, rigRightPalmScaleMax: .84,
      rigLeftPalmScaleMin: .84, rigLeftPalmScaleMax: .84,
      contactAnchor: 'chin', contactStartFrame: 21, contactEndFrame: 27,
      rigContactLandmark: 12, rigContactUseAvatarAnchor: true, rigContactSnap: 1, rigContactFadeFrames: 5,
      rigInterHandContact: {movingSide: 'R', movingLandmarks: [8,12,16], supportSide: 'L',
        supportLandmarks: [0,5,9,13,17], preserveCapturedOffset: false, snap: 1,
        startFrame: 42, endFrame: 48, fadeFrames: 6, maximumCorrection: .3}
    }, frames,
  };
}
if (require.main === module) {
  const recipe = JSON.parse(fs.readFileSync(path.join(root, 'gracias.authoring.json'), 'utf8'));
  const motion = buildMotion(recipe);
  fs.writeFileSync(path.join(root, 'gracias.motion.json'), JSON.stringify(motion) + '\n');
  console.log(`GRACIAS: ${motion.frames.length} authored frames; draft only.`);
}
module.exports = {buildMotion, buildFrames};
